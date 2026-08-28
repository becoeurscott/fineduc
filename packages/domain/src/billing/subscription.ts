/**
 * What a school pays Fineduc, and when it needs telling (ARCHITECTURE.md §6).
 *
 * These are the figures published on the landing page. They live here, once,
 * because three places need them and none of them may disagree: the page a
 * director reads before signing up, the renewal checkout that charges them,
 * and the reminder that warns them before it lapses. A price that drifts
 * between the page and the invoice is the fastest way to lose a school's
 * trust, so the page and the charge read the same constant.
 *
 * Amounts are XAF minor units, which for a zero-exponent currency are whole
 * francs. `annualMonthlyMinor` is the DISCOUNTED per-month figure a school
 * pays when it commits to a year — the landing page quotes it per month, so
 * it is stored per month and multiplied by twelve when charged, rather than
 * stored as a year total that would have to be divided back to render.
 */

/** Fineduc's own plans. Mirrors the `Plan` enum in the schema. */
export type SubscriptionPlan = 'essentiel' | 'croissance' | 'institution'

export type SubscriptionBillingPeriod = 'monthly' | 'annual'

export interface PlanTerms {
  readonly plan: SubscriptionPlan
  /** Charged every month on a monthly subscription. */
  readonly monthlyMinor: bigint
  /** Charged twelve times over, once, on an annual subscription. */
  readonly annualMonthlyMinor: bigint
  /**
   * Students the plan admits. `null` on the top plan: it is sold "800+,
   * multi-campus" and priced from, so a cap would refuse the very schools
   * it is for.
   */
  readonly studentCap: number | null
}

export const PLAN_TERMS: Readonly<Record<SubscriptionPlan, PlanTerms>> = {
  essentiel: { plan: 'essentiel', monthlyMinor: 25_000n, annualMonthlyMinor: 20_000n, studentCap: 250 },
  croissance: { plan: 'croissance', monthlyMinor: 60_000n, annualMonthlyMinor: 48_000n, studentCap: 800 },
  institution: { plan: 'institution', monthlyMinor: 120_000n, annualMonthlyMinor: 96_000n, studentCap: null },
}

/**
 * The free trial, in days.
 *
 * The landing page promises seven ("puis 7 jours d'essai gratuit"). Anything
 * longer here would be a promise the product quietly overpays on; anything
 * shorter would cut a school off before the day it was told.
 */
export const TRIAL_DAYS = 7

/** One-off onboarding, waived on an annual Croissance or Institution contract. */
export const ONBOARDING_FEE_MINOR = 150_000n

export function isOnboardingFeeWaived(plan: SubscriptionPlan, period: SubscriptionBillingPeriod): boolean {
  return period === 'annual' && (plan === 'croissance' || plan === 'institution')
}

/** What one renewal costs: a month, or twelve at the annual rate. */
export function priceFor(plan: SubscriptionPlan, period: SubscriptionBillingPeriod): bigint {
  const terms = PLAN_TERMS[plan]
  return period === 'annual' ? terms.annualMonthlyMinor * 12n : terms.monthlyMinor
}

/**
 * The plan a school of this size needs.
 *
 * Used to suggest, never to enforce: a school that outgrows its plan mid-year
 * keeps working and is asked to upgrade. Locking a director out of their own
 * arrears the week enrolment spikes would be a product that punishes growth.
 */
export function planForStudentCount(students: number): SubscriptionPlan {
  if (students <= 250) return 'essentiel'
  if (students <= 800) return 'croissance'
  return 'institution'
}

/** True when the school has more students than its plan admits. */
export function exceedsPlanCap(plan: SubscriptionPlan, students: number): boolean {
  const cap = PLAN_TERMS[plan].studentCap
  return cap !== null && students > cap
}

// ---------------------------------------------------------------------------
// Expiry warnings
// ---------------------------------------------------------------------------

/**
 * Days before expiry a school is warned, furthest out first.
 *
 * Three notices, not one. A school in Douala pays by mobile money from a
 * bursar's phone, and the person who can authorise it is not always the
 * person who reads the message — a single warning on the last day reaches
 * the wrong week. Seven days gives time to raise it, three to act, one to
 * do it now.
 */
export const EXPIRY_WARNING_DAYS = [7, 3, 1] as const

export type ExpiryWarningDay = (typeof EXPIRY_WARNING_DAYS)[number]

export interface ExpiryNotice {
  /** Which of the three notices this is, named by days remaining. */
  readonly daysRemaining: ExpiryWarningDay
  /** True once the subscription has lapsed rather than merely approaching. */
  readonly expired: false
}

export interface ExpiredNotice {
  readonly daysRemaining: 0
  readonly expired: true
}

/**
 * Decide whether today is a day this subscription should be warned about,
 * given how many whole days remain before it ends.
 *
 * Returns `null` on every other day. Warning on a range rather than an exact
 * day would fire on all seven, and a school messaged daily for a week stops
 * reading the one that matters.
 *
 * `daysRemaining` is computed by the caller from tenant-local dates, because
 * "how many days until the 30th" is a question about the school's calendar,
 * not the server's.
 */
export function expiryNoticeFor(daysRemaining: number): ExpiryNotice | ExpiredNotice | null {
  if (daysRemaining <= 0) return { daysRemaining: 0, expired: true }
  const match = EXPIRY_WARNING_DAYS.find((day) => day === daysRemaining)
  return match === undefined ? null : { daysRemaining: match, expired: false }
}

/**
 * Whole days from `today` to `periodEnd`.
 *
 * `today` is the tenant-local calendar date as `YYYY-MM-DD` — what
 * `toTenantDate` returns — because "how many days until the 30th" is a
 * question about the school's calendar, not the server's. `periodEnd` comes
 * from a DATE column and arrives at UTC midnight.
 *
 * Both are reduced to a calendar day before subtracting, so the answer does
 * not depend on the clock time the job happened to run at: a run at 23:00
 * must count the same as one at 01:00, or a late run skips a warning day
 * entirely and a school is never told.
 */
export function daysUntil(today: string, periodEnd: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const [year, month, day] = today.split('-').map(Number)
  if (!year || !month || !day) throw new Error(`daysUntil: expected YYYY-MM-DD, got "${today}"`)
  const start = Date.UTC(year, month - 1, day)
  const end = Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate())
  return Math.round((end - start) / MS_PER_DAY)
}

/**
 * Where the next period ends, given where this one did.
 *
 * Anchored to the PREVIOUS period end rather than to the payment date, so a
 * school that renews three days late does not permanently shift its billing
 * day three days later — and, over a year of late renewals, quietly buy
 * eleven months for the price of twelve.
 *
 * A monthly period that starts on the 31st lands on the last day of a short
 * month rather than spilling into the next one, which is what `setUTCDate`
 * would do to 31 February.
 */
export function nextPeriodEnd(currentEnd: Date, period: SubscriptionBillingPeriod): Date {
  const months = period === 'annual' ? 12 : 1
  const year = currentEnd.getUTCFullYear()
  const month = currentEnd.getUTCMonth()
  const day = currentEnd.getUTCDate()

  const targetMonth = month + months
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate()

  return new Date(Date.UTC(year, targetMonth, Math.min(day, lastDayOfTarget)))
}
