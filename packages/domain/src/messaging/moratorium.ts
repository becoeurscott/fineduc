/**
 * Le moratoire — a parent-requested delay on ONE instalment
 * (ARCHITECTURE.md §8.5).
 *
 * A parent who cannot pay a tranche on time asks for a delay from the
 * reminder message itself. The school decides whether that is granted on the
 * spot or queued for a bursar. Everything here is pure: no clock, no
 * database, no randomness — `today` arrives as a YYYY-MM-DD string the
 * caller got from `clock.today(tenant.timezone)`.
 *
 * Three properties this file exists to guarantee:
 *
 *  1. **The delay is measured from the ORIGINAL due date**, never from the
 *     day of the request. A parent who asks ten days late gets eleven days,
 *     not twenty-one. Otherwise "moratoire" becomes an indefinite snooze and
 *     the school that switched it on is worse off than before.
 *  2. **`instalment.dueOn` is never rewritten.** `effectiveDueOn` derives the
 *     date to act on from the instalment plus its moratoire, so "was this
 *     actually late?" stays answerable for the whole year.
 *  3. **A moratoire moves a DATE, never an amount.** Nothing here touches
 *     money, so none of it is subject to the append-only rule — and none of
 *     it may ever start being.
 */
import { ValidationError, ConflictError } from '../shared/errors.js'
import { addCalendarDays } from '../billing/instalments.js'
import type { InstalmentStatus } from '../billing/instalments.js'
import { isInstalmentSettled } from './eligibility.js'

/**
 * Three weeks, and it is NOT configurable — not by a setting, not by an
 * admin, not by hand-editing the tenant settings blob. A school may offer
 * less. `packages/contracts` declares the same constant for its Zod schemas
 * because the two packages deliberately cannot see each other; a test in
 * apps/api asserts they have not drifted.
 */
export const MAX_MORATORIUM_DAYS = 21

export type MoratoriumStatus = 'pending' | 'granted' | 'refused' | 'cancelled'

/**
 * Only the fields the decision needs, structurally — the same approach
 * `SendContext` takes. `packages/domain` imports nothing but `money`, so the
 * caller maps its parsed settings into this shape and structural typing does
 * the rest.
 */
export interface MoratoriumPolicy {
  readonly enabled: boolean
  readonly approval: 'auto' | 'manual'
  readonly allowedDurationsDays: readonly number[]
  readonly offerFromDaysBeforeDue: number
  readonly lateGraceDays: number
  readonly refusalFreesSlot: boolean
}

/** Why the chat cannot offer a moratoire. Every value is shown to a parent. */
export type OfferBlockedReason =
  | 'disabled'
  | 'settled'
  | 'already_used'
  | 'too_early'
  | 'too_late'
  | 'zero_amount'

export type MoratoriumOffer =
  | {
      readonly offer: true
      /** Only the durations that would still land in the future. */
      readonly durationsDays: readonly number[]
      readonly latestDeferredDueOn: string
      /**
       * True when the longest available delay lands on or after the NEXT
       * tranche. Informational: the parent is TOLD, never silently given
       * less than they chose.
       */
      readonly collidesWithNextInstalment: boolean
    }
  | { readonly offer: false; readonly reason: OfferBlockedReason }

export type RequestRejection = OfferBlockedReason | 'duration_not_allowed' | 'duration_exceeds_max'

export type MoratoriumRequestDecision =
  | {
      readonly outcome: 'granted' | 'pending'
      readonly originalDueOn: string
      readonly deferredDueOn: string
    }
  | { readonly outcome: 'rejected'; readonly reason: RequestRejection }

export interface MoratoriumContext {
  readonly policy: MoratoriumPolicy
  readonly instalment: {
    readonly status: InstalmentStatus
    readonly amountMinor: bigint
    readonly allocatedMinor: bigint
    readonly dueOn: string
  }
  /** The next tranche's due date, for the collision warning. Null if last. */
  readonly nextInstalmentDueOn: string | null
  readonly existingMoratorium: { readonly status: MoratoriumStatus } | null
  /** YYYY-MM-DD in the TENANT's timezone — never UTC (rule #9). */
  readonly today: string
}

/**
 * The deferred date: the ORIGINAL due date plus N days, N in 1..21.
 *
 * Throws rather than clamping. A caller asking for 28 days has a bug or is
 * probing; silently giving them 21 would hide both.
 */
export function computeDeferredDueOn(originalDueOn: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new ValidationError('moratorium_duration_not_integer', `A moratoire is a whole number of days, got ${days}.`)
  }
  if (days < 1 || days > MAX_MORATORIUM_DAYS) {
    throw new ValidationError(
      'moratorium_duration_out_of_range',
      `A moratoire is between 1 and ${MAX_MORATORIUM_DAYS} days, got ${days}.`,
    )
  }
  return addCalendarDays(originalDueOn, days)
}

/**
 * The date the rest of the system should act on.
 *
 * Only a GRANTED moratoire moves it. A `pending` request must not silently
 * pause anything — otherwise a parent chatting at 23:00 would move a date no
 * human had approved, and a bursar who refuses the next morning would find
 * the reminder they wanted already suppressed.
 */
export function effectiveDueOn(
  instalment: { readonly dueOn: string },
  moratorium: { readonly status: MoratoriumStatus; readonly deferredDueOn: string } | null,
): string {
  if (moratorium && moratorium.status === 'granted') return moratorium.deferredDueOn
  return instalment.dueOn
}

/**
 * Is a moratoire still running today?
 *
 * Expiry is a date comparison and NOT a stored status. A stored `expired`
 * would need a job to write it, a job can be late, and then two readers
 * disagree about the same row — which for a suppressed reminder ladder means
 * either chasing a family the school gave time to, or not chasing one whose
 * time ran out.
 */
export function isMoratoriumActive(
  moratorium: { readonly status: MoratoriumStatus; readonly deferredDueOn: string } | null,
  today: string,
): boolean {
  if (!moratorium || moratorium.status !== 'granted') return false
  return today <= moratorium.deferredDueOn
}

/**
 * Does an existing row use up this instalment's one moratoire?
 *
 * The school's call. With `refusalFreesSlot` a refused request can be
 * replaced, so a refusal is not final; without it, one attempt per
 * instalment and a refusal burns it.
 */
export function blocksNewRequest(
  existing: { readonly status: MoratoriumStatus } | null,
  policy: Pick<MoratoriumPolicy, 'refusalFreesSlot'>,
): boolean {
  if (!existing) return false
  if (!policy.refusalFreesSlot) return true
  return existing.status === 'pending' || existing.status === 'granted'
}

/**
 * Can this instalment be offered a moratoire, and for how long?
 *
 * The order of the checks is what a parent reads, so it runs from "the
 * school does not do this" to "you have left it too late" — most general
 * first, so the message is never more specific than the truth.
 */
export function decideMoratoriumOffer(context: MoratoriumContext): MoratoriumOffer {
  const { policy, instalment, today } = context

  if (!policy.enabled) {
    return { offer: false, reason: 'disabled' }
  }

  // Before `settled`, deliberately. A full scholarship makes `allocated >=
  // amount` trivially true, so `isInstalmentSettled` would report it as paid
  // — accurate, but "déjà payée" is the wrong thing to tell a family whose
  // tranche is zero because the school waived it.
  if (instalment.amountMinor <= 0n) {
    return { offer: false, reason: 'zero_amount' }
  }
  if (isInstalmentSettled(instalment)) {
    return { offer: false, reason: 'settled' }
  }
  if (blocksNewRequest(context.existingMoratorium, policy)) {
    return { offer: false, reason: 'already_used' }
  }

  if (today < addCalendarDays(instalment.dueOn, -policy.offerFromDaysBeforeDue)) {
    return { offer: false, reason: 'too_early' }
  }
  if (today > addCalendarDays(instalment.dueOn, policy.lateGraceDays)) {
    return { offer: false, reason: 'too_late' }
  }

  /*
   * The consequence of measuring from the ORIGINAL due date: for a parent
   * who is already late, some of the school's durations have expired. A
   * seven-day option offered to someone eleven days overdue would end
   * yesterday, so it is not offered at all — better no button than a button
   * that grants a delay in the past.
   */
  const usable = policy.allowedDurationsDays
    .filter((days) => days >= 1 && days <= MAX_MORATORIUM_DAYS)
    .filter((days) => addCalendarDays(instalment.dueOn, days) > today)
    .sort((a, b) => a - b)

  if (usable.length === 0) {
    return { offer: false, reason: 'too_late' }
  }

  const latestDeferredDueOn = addCalendarDays(instalment.dueOn, usable[usable.length - 1] as number)

  return {
    offer: true,
    durationsDays: usable,
    latestDeferredDueOn,
    collidesWithNextInstalment:
      context.nextInstalmentDueOn !== null && latestDeferredDueOn >= context.nextInstalmentDueOn,
  }
}

/**
 * Turn a parent's chosen duration into an outcome.
 *
 * `granted` or `pending` is the school's `approval` setting and nothing else
 * — the caps have already been applied by the time we get here.
 */
export function decideMoratoriumRequest(
  context: MoratoriumContext & { readonly requestedDays: number },
): MoratoriumRequestDecision {
  const offer = decideMoratoriumOffer(context)
  if (!offer.offer) {
    return { outcome: 'rejected', reason: offer.reason }
  }

  // Checked ahead of `duration_not_allowed` because it is the harder rule
  // and the more useful thing to say: a caller asking for a month is told
  // about the cap, not merely that its number was not on the menu.
  if (!Number.isInteger(context.requestedDays) || context.requestedDays > MAX_MORATORIUM_DAYS) {
    return { outcome: 'rejected', reason: 'duration_exceeds_max' }
  }
  if (!offer.durationsDays.includes(context.requestedDays)) {
    return { outcome: 'rejected', reason: 'duration_not_allowed' }
  }

  return {
    outcome: context.policy.approval === 'auto' ? 'granted' : 'pending',
    originalDueOn: context.instalment.dueOn,
    deferredDueOn: computeDeferredDueOn(context.instalment.dueOn, context.requestedDays),
  }
}

/**
 * The state machine. Four states, and every edge that is not here is a bug
 * in the caller rather than a state to tolerate.
 *
 * `refused` and `cancelled` are terminal: a refusal is re-decided by a NEW
 * request (when the school allows one), never by mutating the old row into
 * a grant, or the audit trail would say a refusal became an approval with
 * nobody having approved anything.
 */
export function moratoriumTransition(from: MoratoriumStatus, action: 'approve' | 'refuse' | 'cancel'): MoratoriumStatus {
  if (action === 'cancel') {
    if (from !== 'granted') {
      throw new ConflictError('MORATORIUM_NOT_GRANTED', `Only a granted moratoire can be cancelled, this one is ${from}.`)
    }
    return 'cancelled'
  }

  if (from !== 'pending') {
    throw new ConflictError(
      'MORATORIUM_ALREADY_DECIDED',
      `This moratoire is already ${from}; it cannot be ${action === 'approve' ? 'approved' : 'refused'} again.`,
    )
  }
  return action === 'approve' ? 'granted' : 'refused'
}
