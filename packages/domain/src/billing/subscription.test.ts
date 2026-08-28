import { describe, expect, it } from 'vitest'
import {
  PLAN_TERMS,
  TRIAL_DAYS,
  ONBOARDING_FEE_MINOR,
  EXPIRY_WARNING_DAYS,
  isOnboardingFeeWaived,
  priceFor,
  planForStudentCount,
  exceedsPlanCap,
  expiryNoticeFor,
  daysUntil,
  nextPeriodEnd,
} from './subscription.js'

/**
 * These figures are published. A school reads them on the landing page before
 * it signs up and is charged them by the renewal months later, so the two must
 * be the same number — that is what this file pins.
 */
describe('the published prices', () => {
  it('matches the landing page, in XAF per month', () => {
    expect(PLAN_TERMS.essentiel.monthlyMinor).toBe(25_000n)
    expect(PLAN_TERMS.croissance.monthlyMinor).toBe(60_000n)
    expect(PLAN_TERMS.institution.monthlyMinor).toBe(120_000n)
  })

  it('matches the landing page annual rates, quoted per month', () => {
    expect(PLAN_TERMS.essentiel.annualMonthlyMinor).toBe(20_000n)
    expect(PLAN_TERMS.croissance.annualMonthlyMinor).toBe(48_000n)
    expect(PLAN_TERMS.institution.annualMonthlyMinor).toBe(96_000n)
  })

  it('gives the trial the seven days the page promises', () => {
    expect(TRIAL_DAYS).toBe(7)
  })

  it('prices a monthly renewal at one month', () => {
    expect(priceFor('essentiel', 'monthly')).toBe(25_000n)
  })

  it('prices an annual renewal at twelve months of the discounted rate', () => {
    // 20 000 × 12 = 240 000, not 25 000 × 12. The discount is the point.
    expect(priceFor('essentiel', 'annual')).toBe(240_000n)
    expect(priceFor('croissance', 'annual')).toBe(576_000n)
  })

  it('makes an annual commitment cheaper than paying monthly for a year', () => {
    for (const plan of ['essentiel', 'croissance', 'institution'] as const) {
      expect(priceFor(plan, 'annual')).toBeLessThan(PLAN_TERMS[plan].monthlyMinor * 12n)
    }
  })

  it('waives onboarding on an annual Croissance or Institution contract only', () => {
    expect(ONBOARDING_FEE_MINOR).toBe(150_000n)
    expect(isOnboardingFeeWaived('croissance', 'annual')).toBe(true)
    expect(isOnboardingFeeWaived('institution', 'annual')).toBe(true)
    // Essentiel annual is not waived, and no monthly contract is.
    expect(isOnboardingFeeWaived('essentiel', 'annual')).toBe(false)
    expect(isOnboardingFeeWaived('croissance', 'monthly')).toBe(false)
  })
})

describe('choosing a plan by school size', () => {
  it('follows the bands on the page', () => {
    expect(planForStudentCount(1)).toBe('essentiel')
    expect(planForStudentCount(250)).toBe('essentiel')
    expect(planForStudentCount(251)).toBe('croissance')
    expect(planForStudentCount(800)).toBe('croissance')
    expect(planForStudentCount(801)).toBe('institution')
  })

  it('leaves the top plan uncapped, since it is sold to "800+"', () => {
    expect(PLAN_TERMS.institution.studentCap).toBeNull()
    expect(exceedsPlanCap('institution', 50_000)).toBe(false)
  })

  it('reports when a school has outgrown its plan', () => {
    expect(exceedsPlanCap('essentiel', 250)).toBe(false)
    expect(exceedsPlanCap('essentiel', 251)).toBe(true)
  })
})

/**
 * The warning schedule. A school pays by mobile money from a bursar's phone
 * and the person who can authorise it is not always the one reading — so
 * three notices, and never one a day for a week.
 */
describe('warning a school before its subscription lapses', () => {
  it('warns at seven, three and one day', () => {
    expect(EXPIRY_WARNING_DAYS).toEqual([7, 3, 1])
    for (const day of [7, 3, 1]) {
      expect(expiryNoticeFor(day)).toEqual({ daysRemaining: day, expired: false })
    }
  })

  it('stays silent on every other day', () => {
    // Warning on a RANGE would fire all seven days running, and a school
    // messaged daily stops reading the one that matters.
    for (const day of [10, 6, 5, 4, 2]) {
      expect(expiryNoticeFor(day)).toBeNull()
    }
  })

  it('reports an expiry once the day has passed', () => {
    expect(expiryNoticeFor(0)).toEqual({ daysRemaining: 0, expired: true })
    expect(expiryNoticeFor(-5)).toEqual({ daysRemaining: 0, expired: true })
  })
})

describe('counting the days left', () => {
  it('takes the tenant-local calendar date, so the run time cannot change it', () => {
    // toTenantDate() has already collapsed the instant to the school's own
    // day; a job at 01:00 and one at 23:00 hand over the same string.
    expect(daysUntil('2026-09-23', new Date('2026-09-30T00:00:00Z'))).toBe(7)
  })

  it('is zero on the day itself and negative afterwards', () => {
    expect(daysUntil('2026-09-30', new Date('2026-09-30T00:00:00Z'))).toBe(0)
    expect(daysUntil('2026-10-02', new Date('2026-09-30T00:00:00Z'))).toBe(-2)
  })

  it('refuses a date it cannot read rather than silently counting from 1970', () => {
    expect(() => daysUntil('30/09/2026', new Date('2026-09-30T00:00:00Z'))).toThrow()
  })
})

describe('moving to the next period', () => {
  it('advances a monthly subscription by one month', () => {
    expect(nextPeriodEnd(new Date('2026-09-30T00:00:00Z'), 'monthly').toISOString()).toBe(
      '2026-10-30T00:00:00.000Z',
    )
  })

  it('advances an annual subscription by twelve months', () => {
    expect(nextPeriodEnd(new Date('2026-09-30T00:00:00Z'), 'annual').toISOString()).toBe(
      '2027-09-30T00:00:00.000Z',
    )
  })

  it('does not spill a 31st into the following month', () => {
    // 31 January + 1 month is 28 February, not 3 March.
    expect(nextPeriodEnd(new Date('2026-01-31T00:00:00Z'), 'monthly').toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    )
  })

  it('handles February in a leap year', () => {
    expect(nextPeriodEnd(new Date('2028-01-31T00:00:00Z'), 'monthly').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    )
  })

  it('anchors to the previous period end, not to when the school actually paid', () => {
    // A school that renews three days late keeps its billing day. Anchoring
    // to the payment date instead would walk the date forward every month
    // and, over a year of late renewals, sell eleven months for twelve.
    const periodEnd = new Date('2026-09-30T00:00:00Z')
    expect(nextPeriodEnd(periodEnd, 'monthly').toISOString()).toBe('2026-10-30T00:00:00.000Z')
  })
})
