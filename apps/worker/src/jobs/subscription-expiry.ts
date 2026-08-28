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
 * `subscription-expiry` — warns a school before its subscription lapses.
 *
 * Moneroo has no recurring billing: there is no card on file and nothing
 * renews itself. A school pays each period by mobile money, from a phone,
 * deliberately. That makes the warning part of the product rather than a
 * courtesy — a school that is not told simply stops working one morning with
 * no idea why, and the first it hears of it is a bursar who cannot take a
 * payment.
 *
 * The job only DECIDES and records. It writes an outbox row and lets the
 * existing sender apply every limit that governs sending — quiet hours,
 * opt-out, credits (AGENTS.md rule #7). A job that sent directly would
 * bypass all of them.
 *
 * Re-runnable by construction: a notice is unique on
 * (subscription, periodEnd, daysRemaining), so a day that runs twice warns
 * once. That matters because the schedule is daily and a retry is normal.
 */

export type SubscriptionExpiryData = JobEnvelope

export interface SubscriptionExpiryDeps {
  readonly prisma: PrismaClient
  readonly logger: Logger
  readonly now: () => Date
}

export interface SubscriptionExpiryResult {
  /** Which notice fired, or null on a day that is not a warning day. */
  readonly notified: number | null
  readonly expired: boolean
  /** What the school must pay to renew, in minor units. */
  readonly priceMinor: bigint
  readonly periodEnd: string
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

    return {
      notified: notice.daysRemaining,
      expired: notice.expired,
      priceMinor,
      periodEnd: subscription.currentPeriodEnd.toISOString(),
    }
  })
}

export function createSubscriptionExpiryWorker(
  connection: Redis,
  deps: Omit<SubscriptionExpiryDeps, 'logger' | 'now'> & Partial<Pick<SubscriptionExpiryDeps, 'logger' | 'now'>>,
): Worker<SubscriptionExpiryData> {
  const logger = deps.logger ?? consoleLogger('subscription-expiry')
  const now = deps.now ?? (() => new Date())

  return new Worker<SubscriptionExpiryData>(
    'subscription-expiry',
    async (job: Job<SubscriptionExpiryData>) => runSubscriptionExpiry({ prisma: deps.prisma, logger, now }, job.data),
    { ...queueOptions(connection), concurrency: QUEUE_SPECS['subscription-expiry'].concurrency },
  )
}
