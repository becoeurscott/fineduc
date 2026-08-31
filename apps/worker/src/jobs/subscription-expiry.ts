import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { withTenant, type PrismaClient } from '@fineduc/db'
import {
  daysUntil,
  expiryNoticeFor,
  priceFor,
  toTenantDate,
  type SubscriptionBillingPeriod,
  type SubscriptionPlan,
} from '@fineduc/domain'
import { consoleLogger, type Logger } from '@fineduc/services'
import { QUEUE_SPECS, queueOptions, type JobEnvelope } from '../queues/index.js'

/**
 * `subscription-expiry` — warns a school before its subscription lapses, then
 * marks it past_due once it has.
 *
 * Nothing renews itself: there is no card on file, and a school pays each
 * period by mobile money, from a phone, deliberately. That makes the warning
 * part of the product rather than a courtesy — a school that is not told
 * simply stops working one morning with no idea why, and the first it hears
 * is a bursar who cannot take a payment.
 *
 * ## Why this sends directly, unlike every parent-facing job
 *
 * AGENTS.md rule #7 routes parent messages through `message-sender` so quiet
 * hours, opt-out and CREDITS are applied. None of that applies here, and the
 * credit rule actively must not: `message-sender` debits the school's own
 * prepaid balance, so routing Fineduc's dunning notice through it would
 * charge a school to be chased for money it owes us. Fineduc pays for this
 * one. It also cannot use that path at all — `message.guardian_id` is NOT
 * NULL, and a director is a User, not a Guardian.
 *
 * ## Idempotency
 *
 * A `subscription_notice` row is claimed BEFORE the provider is called, keyed
 * on (tenant, periodEnd, daysRemaining). A duplicate insert means the notice
 * already went out, so the job stops. Claim-then-send follows the same
 * trade-off `message-sender` documents: a crash between the two loses one
 * notice rather than sending two, and under-sending is the failure this
 * product can live with. The next notice in the schedule still fires.
 */

export type SubscriptionExpiryData = JobEnvelope

/** Sends the notice. Injected so tests never touch a real provider. */
export interface ExpirySms {
  send(message: { toPhoneE164: string; body: string; idempotencyKey: string }): Promise<unknown>
}

export interface SubscriptionExpiryDeps {
  readonly prisma: PrismaClient
  readonly logger: Logger
  readonly now: () => Date
  /**
   * Absent in environments with no SMS credentials. The job still records the
   * decision and marks the lapse — it simply cannot send, which is logged
   * rather than thrown, because a missing provider must not stop a
   * subscription being marked past_due.
   */
  readonly sms?: ExpirySms
  /** Where a director goes to renew. Baked into the message. */
  readonly renewUrl?: string
}

export interface SubscriptionExpiryResult {
  /** Which notice fired, or null on a day that is not a warning day. */
  readonly notified: number | null
  readonly expired: boolean
  /** What the school must pay to renew, in minor units. */
  readonly priceMinor: bigint
  readonly periodEnd: string
  /** True when an SMS actually left. False on a duplicate, or with no phone. */
  readonly sent?: boolean
  /** Why nothing was sent, when nothing was. */
  readonly skipped?: 'already_sent' | 'no_phone' | 'no_provider'
}

export async function runSubscriptionExpiry(
  deps: SubscriptionExpiryDeps,
  data: SubscriptionExpiryData,
): Promise<SubscriptionExpiryResult> {
  return withTenant(deps.prisma, data.tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: data.tenantId } })
    const subscription = await tx.subscription.findUnique({ where: { tenantId: data.tenantId } })

    // No subscription row is not an error worth retrying — it is a tenant
    // that was never fully provisioned, and the sweep will surface it.
    if (!subscription) {
      deps.logger.warn(`no subscription row for tenant ${data.tenantId}`)
      return { notified: null, expired: false, priceMinor: 0n, periodEnd: '' }
    }

    /*
     * A cancelled school is not chased. It already decided.
     *
     * `past_due` IS still warned: it has lapsed and the whole point of the
     * message is to tell it how to come back.
     */
    if (subscription.status === 'cancelled') {
      return {
        notified: null,
        expired: false,
        priceMinor: subscription.priceMinor,
        periodEnd: subscription.currentPeriodEnd.toISOString(),
      }
    }

    // "How many days until the 30th" is a question about the school's
    // calendar, not the server's — a school in Douala and one in Dakar do
    // not cross into tomorrow at the same instant.
    const today = toTenantDate(deps.now(), tenant.timezone)
    const remaining = daysUntil(today, subscription.currentPeriodEnd)
    const notice = expiryNoticeFor(remaining)

    const priceMinor =
      subscription.priceMinor > 0n
        ? subscription.priceMinor
        : priceFor(subscription.plan as SubscriptionPlan, subscription.billingPeriod as SubscriptionBillingPeriod)

    if (!notice) {
      return {
        notified: null,
        expired: false,
        priceMinor,
        periodEnd: subscription.currentPeriodEnd.toISOString(),
      }
    }

    /*
     * A lapsed subscription is marked past_due, once.
     *
     * Guarded on the current status rather than written unconditionally, so
     * a school that renewed between this job being queued and running is not
     * dragged back to past_due by a stale job.
     */
    if (notice.expired && subscription.status !== 'past_due') {
      await tx.subscription.updateMany({
        where: { tenantId: data.tenantId, status: { in: ['trialing', 'active'] } },
        data: { status: 'past_due' },
      })
    }

    const endsOn = subscription.currentPeriodEnd.toISOString().slice(0, 10)
    deps.logger.log(
      notice.expired
        ? `"${tenant.name}" lapsed on ${endsOn} — marked past_due`
        : `"${tenant.name}" expires in ${notice.daysRemaining} day(s), on ${endsOn}`,
    )

    const outcome = await notify(deps, tx, {
      tenantId: data.tenantId,
      tenantName: tenant.name,
      locale: tenant.locale ?? 'fr',
      periodEnd: subscription.currentPeriodEnd,
      endsOn,
      daysRemaining: notice.daysRemaining,
      expired: notice.expired,
      priceMinor,
    })

    return {
      notified: notice.daysRemaining,
      expired: notice.expired,
      priceMinor,
      periodEnd: subscription.currentPeriodEnd.toISOString(),
      ...outcome,
    }
  })
}

interface NotifyInput {
  readonly tenantId: string
  readonly tenantName: string
  readonly locale: string
  readonly periodEnd: Date
  readonly endsOn: string
  readonly daysRemaining: number
  readonly expired: boolean
  readonly priceMinor: bigint
}

/**
 * Claim the notice, then send it.
 *
 * Every failure here is swallowed into a logged outcome rather than thrown:
 * the caller has already marked the subscription past_due, and a provider
 * outage must not roll that back. Losing the SMS costs a school one warning;
 * losing the past_due write would silently give away the product.
 */
async function notify(
  deps: SubscriptionExpiryDeps,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  input: NotifyInput,
): Promise<{ sent?: boolean; skipped?: 'already_sent' | 'no_phone' | 'no_provider' }> {
  const phone = await directorPhone(tx, input.tenantId)

  /*
   * Claimed BEFORE sending, and recorded even when there is no phone or no
   * provider. A school nobody could reach is then visible in the data rather
   * than indistinguishable from one that was successfully warned.
   */
  try {
    await tx.subscriptionNotice.create({
      data: {
        tenantId: input.tenantId,
        periodEnd: input.periodEnd,
        daysRemaining: input.daysRemaining,
        channel: phone && deps.sms ? 'sms' : 'none',
        toPhoneE164: phone ?? null,
      },
    })
  } catch {
    // Unique violation on (tenant, periodEnd, daysRemaining): this exact
    // notice already went out. A retry or a second run of the day lands here,
    // which is precisely what the constraint is for.
    return { sent: false, skipped: 'already_sent' }
  }

  if (!phone) {
    deps.logger.warn(`"${input.tenantName}" has no director phone — expiry notice not sent`)
    return { sent: false, skipped: 'no_phone' }
  }
  if (!deps.sms) {
    deps.logger.warn('no SMS provider configured — expiry notice not sent')
    return { sent: false, skipped: 'no_provider' }
  }

  try {
    await deps.sms.send({
      toPhoneE164: phone,
      body: expiryMessage(input, deps.renewUrl),
      // Stable across retries so a provider that dedupes does not double-send.
      idempotencyKey: `sub-expiry:${input.tenantId}:${input.endsOn}:${input.daysRemaining}`,
    })
    return { sent: true }
  } catch (error) {
    deps.logger.error(`expiry SMS failed for "${input.tenantName}": ${String(error)}`)
    return { sent: false }
  }
}

/**
 * The director's phone.
 *
 * The director, specifically — they are the only role that can pay, and a
 * cashier told the subscription is lapsing can do nothing with that. `phone`
 * is optional on User, so this returns null often enough that the caller must
 * handle it rather than assume.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function directorPhone(tx: any, tenantId: string): Promise<string | null> {
  const membership = await tx.membership.findFirst({
    where: { tenantId, role: 'director', status: 'active' },
    select: { user: { select: { phone: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const phone = membership?.user?.phone
  return typeof phone === 'string' && phone.startsWith('+') ? phone : null
}

/** Short, French by default, and it names the date and the amount. */
function expiryMessage(input: NotifyInput, renewUrl = 'https://app.fineeduc.com/abonnement'): string {
  const amount = `${Number(input.priceMinor).toLocaleString('fr-FR').replace(/ | /g, ' ')} FCFA`
  if (input.locale.startsWith('en')) {
    return input.expired
      ? `Fineduc: your subscription ended on ${input.endsOn} and access is suspended. Renew (${amount}): ${renewUrl}`
      : `Fineduc: your subscription ends in ${input.daysRemaining} day(s), on ${input.endsOn}. Renew (${amount}): ${renewUrl}`
  }
  return input.expired
    ? `Fineduc : votre abonnement a expiré le ${input.endsOn}, l'accès est suspendu. Renouveler (${amount}) : ${renewUrl}`
    : `Fineduc : votre abonnement expire dans ${input.daysRemaining} jour(s), le ${input.endsOn}. Renouveler (${amount}) : ${renewUrl}`
}

export function createSubscriptionExpiryWorker(
  connection: Redis,
  deps: Omit<SubscriptionExpiryDeps, 'logger' | 'now'> & Partial<Pick<SubscriptionExpiryDeps, 'logger' | 'now'>>,
): Worker<SubscriptionExpiryData> {
  const logger = deps.logger ?? consoleLogger('subscription-expiry')
  const now = deps.now ?? (() => new Date())

  return new Worker<SubscriptionExpiryData>(
    'subscription-expiry',
    async (job: Job<SubscriptionExpiryData>) =>
      runSubscriptionExpiry(
        { prisma: deps.prisma, logger, now, sms: deps.sms, renewUrl: deps.renewUrl },
        job.data,
      ),
    { ...queueOptions(connection), concurrency: QUEUE_SPECS['subscription-expiry'].concurrency },
  )
}
