/**
 * Deciding, AT SEND TIME, whether a reminder may actually go out
 * (ARCHITECTURE.md §8.5, AGENTS.md rule #7).
 *
 * Every limit lives here and is evaluated by the SENDER, never by the
 * scheduler. That separation is the whole design: the scheduler materialises
 * intent hours or days ahead, and a lot can change in between. A scheduler
 * bug must not be able to bypass a limit, and it cannot, because the
 * scheduler does not know about them.
 *
 * The check that matters most is `settled`. ARCHITECTURE calls it "the #1
 * trust bug" — messaging a parent who has already paid is the fastest way to
 * lose a school, and it is the one mistake a family will not forgive.
 */
import { ValidationError } from '../shared/errors.js'
import type { InstalmentStatus } from '../billing/instalments.js'

export type SkipReason =
  | 'settled'
  | 'opted_out'
  | 'quarantined'
  | 'no_credits'
  | 'no_phone'
export type DeferReason = 'quiet_hours' | 'guardian_frequency_cap' | 'tenant_daily_cap'

export type EligibilityDecision =
  | { readonly action: 'send' }
  /** Permanent for this schedule row: cancel it, do not retry. */
  | { readonly action: 'skip'; readonly reason: SkipReason; readonly alert?: boolean }
  /** Try again later: the reason may pass on its own. */
  | { readonly action: 'defer'; readonly reason: DeferReason; readonly warn?: boolean }

export interface SendContext {
  readonly instalment: {
    readonly status: InstalmentStatus
    readonly amountMinor: bigint
    readonly allocatedMinor: bigint
  }
  readonly guardian: {
    readonly phoneE164: string | null
    readonly optedOut: boolean
    readonly quarantined: boolean
  }
  /** Hour 0-23 in the TENANT's timezone — never UTC (rule #9). */
  readonly localHour: number
  readonly quietHours: { readonly startHour: number; readonly endHour: number }
  readonly messagesToGuardianToday: number
  readonly guardianDailyCap: number
  readonly messagesForTenantToday: number
  readonly tenantDailyCap: number
  /** Remaining prepaid message credits. Never send on credit. */
  readonly creditBalanceMinor: bigint
}

export const DEFAULT_QUIET_HOURS = { startHour: 7, endHour: 20 } as const
export const DEFAULT_GUARDIAN_DAILY_CAP = 2

/**
 * Is this instalment still worth chasing?
 *
 * Named for instalments explicitly: `isSettled` already means "has this
 * PAYMENT's money landed" in the payment state machine. Two different
 * questions sharing one name is how a caller eventually asks the wrong one.
 *
 * Exported because the scheduler wants it too — but as a shortcut, not as
 * the authority. The sender re-asks at send time, against the live row.
 */
export function isInstalmentSettled(instalment: SendContext['instalment']): boolean {
  if (instalment.status === 'paid' || instalment.status === 'waived' || instalment.status === 'cancelled') {
    return true
  }
  // Belt to those braces: a status that has drifted from the amounts must not
  // let a reminder through for a debt that is actually cleared.
  return instalment.allocatedMinor >= instalment.amountMinor
}

/**
 * Quiet hours are INCLUSIVE of the start hour and EXCLUSIVE of the end, so a
 * 07:00–20:00 window sends at 07:00 and not at 20:00. Windows that wrap
 * midnight are supported, because a school in one timezone may configure
 * hours that cross it.
 */
export function withinSendingHours(localHour: number, quiet: SendContext['quietHours']): boolean {
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
    throw new ValidationError('quiet_hours_invalid_hour', `Not an hour of the day: ${localHour}`)
  }
  const { startHour, endHour } = quiet
  if (startHour === endHour) return true // no quiet period configured
  return startHour < endHour
    ? localHour >= startHour && localHour < endHour
    : localHour >= startHour || localHour < endHour
}

/**
 * The order is deliberate.
 *
 * SKIPS come before DEFERS: a settled instalment must be cancelled outright,
 * not deferred to a quieter hour and re-asked tomorrow. Deferring something
 * that will never become sendable leaves a row that retries forever.
 *
 * Within the skips, `settled` is first — it is the one whose consequence is
 * a lost school rather than a wasted credit.
 */
export function decideEligibility(context: SendContext): EligibilityDecision {
  if (isInstalmentSettled(context.instalment)) {
    return { action: 'skip', reason: 'settled' }
  }
  if (context.guardian.optedOut) {
    return { action: 'skip', reason: 'opted_out' }
  }
  if (context.guardian.quarantined) {
    return { action: 'skip', reason: 'quarantined' }
  }
  if (!context.guardian.phoneE164) {
    return { action: 'skip', reason: 'no_phone' }
  }
  if (context.creditBalanceMinor <= 0n) {
    // Alerted, not merely skipped: a school out of credits is not sending
    // reminders at all, and nobody will notice from the outside until
    // collections quietly fall.
    return { action: 'skip', reason: 'no_credits', alert: true }
  }

  if (!withinSendingHours(context.localHour, context.quietHours)) {
    return { action: 'defer', reason: 'quiet_hours' }
  }
  if (context.messagesToGuardianToday >= context.guardianDailyCap) {
    return { action: 'defer', reason: 'guardian_frequency_cap' }
  }
  if (context.messagesForTenantToday >= context.tenantDailyCap) {
    // Warned: hitting a tenant-wide cap usually means a misconfigured rule
    // fanning out, and the bursar is the one who can stop it.
    return { action: 'defer', reason: 'tenant_daily_cap', warn: true }
  }

  return { action: 'send' }
}

/**
 * Which channel to actually use.
 *
 * WhatsApp first because it is an order of magnitude cheaper (PRD pricing:
 * 10 XAF against 30). SMS is the fallback for a guardian who never opted in
 * to WhatsApp, or whose WhatsApp delivery already failed.
 */
export function resolveChannel(guardian: {
  readonly preferredChannel: 'whatsapp' | 'sms'
  readonly whatsappOptIn: boolean
  readonly whatsappUndeliverable?: boolean
}): 'whatsapp' | 'sms' {
  if (guardian.preferredChannel === 'sms') return 'sms'
  if (!guardian.whatsappOptIn) return 'sms'
  if (guardian.whatsappUndeliverable) return 'sms'
  return 'whatsapp'
}
