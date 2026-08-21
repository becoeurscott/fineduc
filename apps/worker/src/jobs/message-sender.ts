import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { createPrismaClient, resolveAppDatabaseUrl, withTenant, type PrismaClient, type TenantTransactionClient } from '@fineduc/db'
import { loadEnv } from '@fineduc/config'
import { readMessagingSettings } from '@fineduc/contracts'
import { Money, assertCurrencyCode, format } from '@fineduc/money'
import {
  addCalendarDays,
  decideEligibility,
  effectiveDueOn,
  isMoratoriumActive,
  placeholdersIn,
  render,
  resolveChannel,
  tenantLocalToInstant,
  toTenantDate,
  type EligibilityDecision,
  type MoratoriumStatus,
} from '@fineduc/domain'
import { consoleLogger, mintTenantToken, type Logger } from '@fineduc/services'
import type { MessagingProvider, OutboundMessage } from '@fineduc/providers'
import { QUEUE_SPECS, queueOptions, type JobEnvelope } from '../queues/index.js'

/**
 * `message-sender` — every 15 minutes (ARCHITECTURE.md §11).
 *
 * Where AGENTS.md rule #7 is actually enforced. The scheduler decided hours
 * or days ago; everything can have changed since, so every limit is
 * re-evaluated HERE against the live row, and `settled` is re-checked first.
 *
 * ## The transaction boundary IS the design
 *
 * The `message` row, the credit debit and the schedule's flip to `sent` all
 * commit TOGETHER, and the provider is called only after that commits:
 *
 *   - crash between the debit and the flip → the row is still `scheduled`,
 *     the next tick re-sends, and the school is charged twice;
 *   - call the provider first → a crash loses the charge and the audit of a
 *     message a family definitely received.
 *
 * Neither is acceptable, so the write is atomic and the network call is
 * outside it. The residual risk is narrow and deliberate: a crash between
 * COMMIT and the provider call means a family misses one reminder rather
 * than getting two. Under-sending is the failure this product can live with.
 */

export type MessageSenderData = JobEnvelope

export interface SenderHandlerDeps {
  readonly prisma: PrismaClient
  /** Resolves an adapter per channel. Injected so tests pass a fake. */
  readonly resolveProvider: (channel: 'whatsapp' | 'sms') => MessagingProvider
  readonly logger: Logger
  readonly now: () => Date
  readonly publicPayUrl: string
}

export interface SenderResult {
  readonly considered: number
  readonly sent: number
  readonly skipped: number
  readonly deferred: number
  readonly failed: number
}

/** What survives eligibility and is ready to hand to a provider. */
interface Prepared {
  readonly messageId: string
  readonly outbound: OutboundMessage
  readonly provider: MessagingProvider
}

type Outcome =
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'defer'; readonly reason: string }
  | { readonly kind: 'prepared'; readonly prepared: Prepared }

export async function runMessageSender(deps: SenderHandlerDeps, data: MessageSenderData): Promise<SenderResult> {
  const now = deps.now()

  const due = await withTenant(deps.prisma, data.tenantId, (tx) =>
    tx.reminderSchedule.findMany({
      where: { tenantId: data.tenantId, status: 'scheduled', scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      select: { id: true },
    }),
  )

  let sent = 0
  let skipped = 0
  let deferred = 0
  let failed = 0

  for (const row of due) {
    /*
     * One transaction PER message, not one for the batch. A batch
     * transaction would hold locks across a whole school's reminders and
     * would roll every send back on one bad row — including the credit
     * debits for messages that had already left.
     */
    const outcome = await withTenant(deps.prisma, data.tenantId, (tx) =>
      prepareOne(tx, deps, data.tenantId, row.id, now),
    )

    if (outcome.kind === 'skip') {
      skipped += 1
      continue
    }
    if (outcome.kind === 'defer') {
      deferred += 1
      continue
    }

    // Outside the transaction, on purpose. See the header.
    const { prepared } = outcome
    try {
      const result = await prepared.provider.send(prepared.outbound)
      await withTenant(deps.prisma, data.tenantId, (tx) =>
        tx.message.update({
          where: { id: prepared.messageId },
          data: { providerMessageId: result.providerMessageId, status: 'sent', sentAt: deps.now() },
        }),
      )
      sent += 1
    } catch (error) {
      failed += 1
      await withTenant(deps.prisma, data.tenantId, (tx) => markFailed(tx, data.tenantId, prepared.messageId, error))
      // Never the phone number, never the body (AGENTS.md rule #11).
      deps.logger.error(`message ${prepared.messageId} failed to send: ${(error as Error).message}`)
    }
  }

  return { considered: due.length, sent, skipped, deferred, failed }
}

/**
 * Re-decide against the LIVE row, and if it survives, write the message,
 * debit the wallet and flip the schedule — atomically.
 */
async function prepareOne(
  tx: TenantTransactionClient,
  deps: SenderHandlerDeps,
  tenantId: string,
  scheduleId: string,
  now: Date,
): Promise<Outcome> {
  const schedule = await tx.reminderSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      reminderRule: true,
      guardian: true,
      instalment: { include: { invoice: { include: { enrollment: { include: { student: true } } } } } },
    },
  })
  // Already handled by a concurrent tick.
  if (!schedule || schedule.status !== 'scheduled') return { kind: 'skip', reason: 'already_handled' }

  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
  const settings = readMessagingSettings(tenant.settings)
  const currency = assertCurrencyCode(tenant.currency)
  const today = toTenantDate(now, tenant.timezone)
  const localHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tenant.timezone, hourCycle: 'h23', hour: '2-digit' }).format(now),
  )

  const { instalment, guardian, reminderRule: rule } = schedule
  const student = instalment.invoice.enrollment.student

  const moratorium = await tx.moratorium.findFirst({
    where: { tenantId, instalmentId: instalment.id, status: { in: ['pending', 'granted'] } },
  })
  const moratoriumView = moratorium
    ? {
        status: moratorium.status as MoratoriumStatus,
        deferredDueOn: toTenantDate(moratorium.deferredDueOn, 'UTC'),
      }
    : null

  // Counted over the TENANT-LOCAL day, not a UTC one: a cap that resets at
  // midnight UTC resets in the middle of a Douala afternoon.
  const dayStart = tenantLocalToInstant(today, 0, tenant.timezone)
  const dayEnd = tenantLocalToInstant(addCalendarDays(today, 1), 0, tenant.timezone)
  const [toGuardianToday, forTenantToday, lastCredit] = await Promise.all([
    tx.message.count({ where: { tenantId, guardianId: guardian.id, createdAt: { gte: dayStart, lt: dayEnd } } }),
    tx.message.count({ where: { tenantId, createdAt: { gte: dayStart, lt: dayEnd } } }),
    tx.messageCreditLedgerEntry.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
  ])

  const decision: EligibilityDecision = decideEligibility({
    instalment: {
      status: instalment.status,
      amountMinor: instalment.amountMinor,
      allocatedMinor: instalment.allocatedMinor,
    },
    reminder: { basis: rule.basis === 'moratorium_end' ? 'moratorium_end' : 'due_date' },
    moratoriumActive: isMoratoriumActive(moratoriumView, today),
    guardian: {
      phoneE164: guardian.phoneE164,
      optedOut: Boolean(guardian.optOutAt),
      quarantined: Boolean(guardian.quarantinedAt),
    },
    localHour,
    quietHours: settings.quietHours,
    messagesToGuardianToday: toGuardianToday,
    guardianDailyCap: settings.guardianDailyCap,
    messagesForTenantToday: forTenantToday,
    tenantDailyCap: settings.tenantDailyCap,
    creditBalanceMinor: lastCredit?.balanceAfterMinor ?? 0n,
  })

  if (decision.action === 'skip') {
    await tx.reminderSchedule.update({
      where: { id: scheduleId },
      data: { status: 'skipped', skipReason: decision.reason },
    })
    return { kind: 'skip', reason: decision.reason }
  }
  if (decision.action === 'defer') {
    // Left `scheduled` deliberately — the next tick re-asks, and the reason
    // may have passed on its own.
    return { kind: 'defer', reason: decision.reason }
  }

  const channel = resolveChannel({
    preferredChannel: guardian.preferredChannel,
    whatsappOptIn: guardian.whatsappOptIn,
  })
  const locale = guardian.preferredLocale
  const template = await tx.messageTemplate.findFirst({
    where: { tenantId, code: rule.templateCode, locale, isActive: true },
  })
  if (!template) {
    await tx.reminderSchedule.update({
      where: { id: scheduleId },
      data: { status: 'failed', skipReason: `template_missing:${rule.templateCode}` },
    })
    return { kind: 'skip', reason: 'template_missing' }
  }

  const owed = Money.of(instalment.amountMinor - instalment.allocatedMinor, currency)
  const variables: Record<string, string> = {
    tranche: instalment.label,
    eleve: student.firstName,
    montant: format(owed, { locale: locale === 'en' ? 'en' : 'fr' }),
    echeance: frenchDate(effectiveDueOn({ dueOn: toTenantDate(instalment.dueOn, 'UTC') }, moratoriumView)),
  }

  // Minted lazily: only a template that actually offers a delay needs a link,
  // and a link created for a message that never goes out is a live token
  // nobody asked for.
  if (placeholdersIn(template.body).includes('lien_moratoire')) {
    variables['lien_moratoire'] = await ensureChatLink(tx, tenantId, {
      instalmentId: instalment.id,
      studentId: student.id,
      guardianId: guardian.id,
      expiresAt: tenantLocalToInstant(
        addCalendarDays(toTenantDate(instalment.dueOn, 'UTC'), 1 + MORATOIRE_LINK_GRACE_DAYS),
        0,
        tenant.timezone,
      ),
      baseUrl: deps.publicPayUrl,
    })
  }

  const rendered = render(template.body, variables)
  if (rendered.missing.length > 0) {
    /*
     * "Bonjour , vous devez  FCFA" is worse than no message: it tells a
     * family the school does not know who they are. Fail the row loudly
     * rather than spend a credit on it.
     */
    await tx.reminderSchedule.update({
      where: { id: scheduleId },
      data: { status: 'failed', skipReason: `template_variables_missing:${rendered.missing.join(',')}` },
    })
    return { kind: 'skip', reason: 'template_variables_missing' }
  }

  const provider = deps.resolveProvider(channel)
  const outbound: OutboundMessage = {
    toPhoneE164: guardian.phoneE164,
    channel,
    body: rendered.body,
    // Deterministic and derived from the schedule row, so a retried job
    // replays the SAME key and the adapter de-duplicates.
    idempotencyKey: scheduleId,
    locale,
  }
  const cost = provider.estimateCost(outbound)

  const message = await tx.message.create({
    data: {
      tenantId,
      guardianId: guardian.id,
      studentId: student.id,
      channel,
      provider: provider.name,
      toPhoneE164: guardian.phoneE164,
      templateCode: template.code,
      locale,
      bodyRendered: rendered.body,
      status: 'queued',
      costMinor: cost.amount,
    },
  })

  // Debited from the ESTIMATE, before the call, in this same transaction.
  // Never send on credit (ARCHITECTURE.md §8.5).
  const balanceAfter = (lastCredit?.balanceAfterMinor ?? 0n) - cost.amount
  await tx.messageCreditLedgerEntry.create({
    data: {
      tenantId,
      entryType: 'debit',
      amountMinor: -cost.amount,
      balanceAfterMinor: balanceAfter,
      messageId: message.id,
    },
  })

  await tx.reminderSchedule.update({
    where: { id: scheduleId },
    data: { status: 'sent', messageId: message.id },
  })

  return { kind: 'prepared', prepared: { messageId: message.id, outbound, provider } }
}

/**
 * A send that failed after the wallet was debited gets the credit back.
 *
 * A refund row rather than a reversed debit: the ledger is append-only, and
 * a school should be able to see that it was charged and then made whole,
 * not that the charge never happened.
 */
async function markFailed(
  tx: TenantTransactionClient,
  tenantId: string,
  messageId: string,
  error: unknown,
): Promise<void> {
  const message = await tx.message.update({
    where: { id: messageId },
    data: {
      status: 'failed',
      // A provider code, never a phone number or a body (rule #11).
      errorCode: (error as { code?: string }).code ?? 'SEND_FAILED',
    },
  })

  const last = await tx.messageCreditLedgerEntry.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } })
  await tx.messageCreditLedgerEntry.create({
    data: {
      tenantId,
      entryType: 'refund',
      amountMinor: message.costMinor,
      balanceAfterMinor: (last?.balanceAfterMinor ?? 0n) + message.costMinor,
      messageId,
      note: 'Send failed; credit returned',
    },
  })
}

/** Days past the due date a moratoire link stays usable. */
const MORATOIRE_LINK_GRACE_DAYS = 21

async function ensureChatLink(
  tx: TenantTransactionClient,
  tenantId: string,
  params: {
    instalmentId: string
    studentId: string
    guardianId: string
    expiresAt: Date
    baseUrl: string
  },
): Promise<string> {
  const existing = await tx.moratoriumChatLink.findFirst({
    where: { tenantId, instalmentId: params.instalmentId, guardianId: params.guardianId },
  })
  // Reused rather than re-minted, so a second reminder carries the SAME link
  // as the first and a parent scrolling back finds one that still works.
  if (existing) return `${params.baseUrl}/moratoire/${existing.token}`

  const token = mintTenantToken(tenantId, 'moratorium_link_tenant_invalid')
  await tx.moratoriumChatLink.create({
    data: {
      tenantId,
      instalmentId: params.instalmentId,
      studentId: params.studentId,
      guardianId: params.guardianId,
      token,
      expiresAt: params.expiresAt,
    },
  })
  return `${params.baseUrl}/moratoire/${token}`
}

function frenchDate(calendarDate: string): string {
  const [year, month, day] = calendarDate.split('-')
  return `${day}/${month}/${year}`
}

export interface MessageSenderDeps {
  readonly connection: Redis
  readonly resolveProvider: (channel: 'whatsapp' | 'sms') => MessagingProvider
  readonly prisma?: PrismaClient
}

export function createMessageSender(deps: MessageSenderDeps): Worker<MessageSenderData> {
  const env = loadEnv()
  const prisma =
    deps.prisma ??
    createPrismaClient({ databaseUrl: resolveAppDatabaseUrl(env.DATABASE_URL, env.APP_DATABASE_URL) })

  const handlerDeps: SenderHandlerDeps = {
    prisma,
    resolveProvider: deps.resolveProvider,
    logger: consoleLogger('message-sender'),
    now: () => new Date(),
    publicPayUrl: env.PUBLIC_PAY_URL,
  }

  return new Worker<MessageSenderData>(
    'message-sender',
    (job: Job<MessageSenderData>) => runMessageSender(handlerDeps, job.data),
    { ...queueOptions(deps.connection), concurrency: QUEUE_SPECS['message-sender'].concurrency },
  )
}
