import { describe, expect, it } from 'vitest'
import { ConflictError, ValidationError } from '../shared/errors.js'
import {
  MAX_MORATORIUM_DAYS,
  blocksNewRequest,
  computeDeferredDueOn,
  decideMoratoriumOffer,
  decideMoratoriumRequest,
  effectiveDueOn,
  isMoratoriumActive,
  moratoriumTransition,
  type MoratoriumContext,
  type MoratoriumPolicy,
  type MoratoriumStatus,
} from './moratorium.js'

const POLICY: MoratoriumPolicy = {
  enabled: true,
  approval: 'manual',
  allowedDurationsDays: [7, 14, 21],
  offerFromDaysBeforeDue: 14,
  lateGraceDays: 7,
  refusalFreesSlot: true,
}

/**
 * One instalment of 45 000 XAF due 2026-09-15, asked about on 2026-09-05 —
 * ten days early, inside the fourteen-day offer window. Each test flips one
 * field, so what it is actually about is the diff.
 */
function context(over: Partial<MoratoriumContext> = {}): MoratoriumContext {
  return {
    policy: POLICY,
    instalment: { status: 'pending', amountMinor: 45_000n, allocatedMinor: 0n, dueOn: '2026-09-15' },
    nextInstalmentDueOn: null,
    existingMoratorium: null,
    today: '2026-09-05',
    ...over,
  }
}

function policy(over: Partial<MoratoriumPolicy>): MoratoriumPolicy {
  return { ...POLICY, ...over }
}

describe('computeDeferredDueOn', () => {
  it('adds whole calendar days to the original due date', () => {
    expect(computeDeferredDueOn('2026-09-15', 7)).toBe('2026-09-22')
    expect(computeDeferredDueOn('2026-09-15', 21)).toBe('2026-10-06')
  })

  it.each([0, -1, 22, 100])('rejects %s days rather than clamping it', (days) => {
    expect(() => computeDeferredDueOn('2026-09-15', days)).toThrow(ValidationError)
  })

  it('rejects a fractional duration', () => {
    expect(() => computeDeferredDueOn('2026-09-15', 21.5)).toThrow(ValidationError)
  })

  it('accepts every day from 1 to the cap', () => {
    for (let days = 1; days <= MAX_MORATORIUM_DAYS; days += 1) {
      expect(() => computeDeferredDueOn('2026-09-15', days)).not.toThrow()
    }
  })

  it('crosses a month boundary', () => {
    expect(computeDeferredDueOn('2026-09-25', 14)).toBe('2026-10-09')
  })

  it('crosses a year boundary', () => {
    expect(computeDeferredDueOn('2026-12-20', 21)).toBe('2027-01-10')
  })

  it('handles a leap day, which a naive +N months would not', () => {
    expect(computeDeferredDueOn('2028-02-29', 21)).toBe('2028-03-21')
  })

  it('does not drift across a February in a non-leap year', () => {
    expect(computeDeferredDueOn('2027-02-20', 14)).toBe('2027-03-06')
  })
})

describe('the offer', () => {
  it('offers every duration to a parent asking in good time', () => {
    const offer = decideMoratoriumOffer(context())

    expect(offer.offer).toBe(true)
    if (!offer.offer) return
    expect(offer.durationsDays).toEqual([7, 14, 21])
    expect(offer.latestDeferredDueOn).toBe('2026-10-06')
  })

  it('offers nothing when the school has not switched the feature on', () => {
    expect(decideMoratoriumOffer(context({ policy: policy({ enabled: false }) }))).toEqual({
      offer: false,
      reason: 'disabled',
    })
  })

  it('offers nothing before the reminder window opens', () => {
    // 2026-08-31 is fifteen days before a 2026-09-15 due date.
    expect(decideMoratoriumOffer(context({ today: '2026-08-31' }))).toEqual({ offer: false, reason: 'too_early' })
  })

  it('opens exactly on the boundary day, not the day after', () => {
    const offer = decideMoratoriumOffer(context({ today: '2026-09-01' }))
    expect(offer.offer).toBe(true)
  })

  it.each(['paid', 'waived', 'cancelled'] as const)('offers nothing on a %s instalment', (status) => {
    const ctx = context({
      instalment: { status, amountMinor: 45_000n, allocatedMinor: 45_000n, dueOn: '2026-09-15' },
    })
    expect(decideMoratoriumOffer(ctx)).toEqual({ offer: false, reason: 'settled' })
  })

  it('offers nothing once the amount is fully allocated, whatever the status says', () => {
    const ctx = context({
      instalment: { status: 'pending', amountMinor: 45_000n, allocatedMinor: 45_000n, dueOn: '2026-09-15' },
    })
    expect(decideMoratoriumOffer(ctx)).toEqual({ offer: false, reason: 'settled' })
  })

  it('still offers on a PARTIALLY paid instalment — there is a balance to defer', () => {
    const ctx = context({
      instalment: { status: 'partial', amountMinor: 45_000n, allocatedMinor: 20_000n, dueOn: '2026-09-15' },
    })
    expect(decideMoratoriumOffer(ctx).offer).toBe(true)
  })

  /**
   * A full scholarship. `allocated >= amount` is trivially true for a zero
   * tranche, so `settled` would be technically accurate — but "déjà payée"
   * is the wrong thing to tell a family whose tranche is zero because the
   * school waived it. The reason has to be reportable separately.
   */
  it('reports a zero-amount tranche as such, not as already paid', () => {
    const ctx = context({
      instalment: { status: 'pending', amountMinor: 0n, allocatedMinor: 0n, dueOn: '2026-09-15' },
    })
    expect(decideMoratoriumOffer(ctx)).toEqual({ offer: false, reason: 'zero_amount' })
  })

  it('warns when the longest delay lands on top of the next tranche', () => {
    const offer = decideMoratoriumOffer(context({ nextInstalmentDueOn: '2026-10-01' }))

    expect(offer.offer).toBe(true)
    if (!offer.offer) return
    // Informed, never silently clamped: the parent still gets all three.
    expect(offer.collidesWithNextInstalment).toBe(true)
    expect(offer.durationsDays).toEqual([7, 14, 21])
  })

  it('does not warn when the next tranche is comfortably clear', () => {
    const offer = decideMoratoriumOffer(context({ nextInstalmentDueOn: '2026-11-15' }))
    expect(offer.offer).toBe(true)
    if (!offer.offer) return
    expect(offer.collidesWithNextInstalment).toBe(false)
  })

  it('ignores a duration the school somehow configured past the cap', () => {
    const offer = decideMoratoriumOffer(context({ policy: policy({ allowedDurationsDays: [7, 30] }) }))
    expect(offer.offer).toBe(true)
    if (!offer.offer) return
    expect(offer.durationsDays).toEqual([7])
  })

  it('lets a school offer a single short delay', () => {
    const offer = decideMoratoriumOffer(context({ policy: policy({ allowedDurationsDays: [7] }) }))
    expect(offer.offer).toBe(true)
    if (!offer.offer) return
    expect(offer.durationsDays).toEqual([7])
    expect(offer.latestDeferredDueOn).toBe('2026-09-22')
  })
})

describe('a parent who has left it late', () => {
  it('offers nothing past the school grace window', () => {
    // Grace is 7 days; 2026-09-23 is eight days past a 2026-09-15 due date.
    expect(decideMoratoriumOffer(context({ today: '2026-09-23' }))).toEqual({ offer: false, reason: 'too_late' })
  })

  it('still offers on the last day of the grace window', () => {
    expect(decideMoratoriumOffer(context({ today: '2026-09-22' })).offer).toBe(true)
  })

  /**
   * The whole point of measuring from the ORIGINAL due date. A parent ten
   * days overdue does not get twenty-one more days — they get eleven. The
   * seven-day option would have ended three days ago, so it is not offered:
   * better no button than a button that grants a delay in the past.
   */
  it('measures the delay from the original due date, so asking late buys less time', () => {
    const ctx = context({ today: '2026-09-25', policy: policy({ lateGraceDays: MAX_MORATORIUM_DAYS }) })
    const offer = decideMoratoriumOffer(ctx)

    expect(offer.offer).toBe(true)
    if (!offer.offer) return
    expect(offer.durationsDays).toEqual([14, 21])
    // 2026-10-06 is still original + 21, which is only 11 days from today.
    expect(offer.latestDeferredDueOn).toBe('2026-10-06')
  })

  it('offers nothing once every duration would end in the past', () => {
    const ctx = context({ today: '2026-10-07', policy: policy({ lateGraceDays: MAX_MORATORIUM_DAYS }) })
    expect(decideMoratoriumOffer(ctx)).toEqual({ offer: false, reason: 'too_late' })
  })
})

describe('one moratoire per instalment', () => {
  it.each(['pending', 'granted'] as const)('blocks a second request while one is %s', (status) => {
    const ctx = context({ existingMoratorium: { status } })
    expect(decideMoratoriumOffer(ctx)).toEqual({ offer: false, reason: 'already_used' })
  })

  /**
   * The school's call, and the two halves must both be pinned — this is the
   * setting a director will actually change, and getting it backwards either
   * traps a family after one mistaken refusal or lets them ask until someone
   * says yes.
   */
  describe('when a refusal frees the slot', () => {
    it.each(['refused', 'cancelled'] as const)('allows a new request after a %s one', (status) => {
      const ctx = context({ existingMoratorium: { status } })
      expect(decideMoratoriumOffer(ctx).offer).toBe(true)
    })
  })

  describe('when a refusal burns the attempt', () => {
    it.each(['refused', 'cancelled'] as const)('blocks a new request after a %s one', (status) => {
      const ctx = context({
        existingMoratorium: { status },
        policy: policy({ refusalFreesSlot: false }),
      })
      expect(decideMoratoriumOffer(ctx)).toEqual({ offer: false, reason: 'already_used' })
    })
  })

  it('never blocks when there is no moratoire at all', () => {
    expect(blocksNewRequest(null, { refusalFreesSlot: false })).toBe(false)
  })
})

describe('the request', () => {
  it('queues the request when the school approves by hand', () => {
    expect(decideMoratoriumRequest({ ...context(), requestedDays: 14 })).toEqual({
      outcome: 'pending',
      originalDueOn: '2026-09-15',
      deferredDueOn: '2026-09-29',
    })
  })

  it('grants on the spot when the school has chosen auto', () => {
    const ctx = context({ policy: policy({ approval: 'auto' }) })
    expect(decideMoratoriumRequest({ ...ctx, requestedDays: 21 })).toEqual({
      outcome: 'granted',
      originalDueOn: '2026-09-15',
      deferredDueOn: '2026-10-06',
    })
  })

  it('rejects a duration past the cap by naming the cap, not the menu', () => {
    expect(decideMoratoriumRequest({ ...context(), requestedDays: 28 })).toEqual({
      outcome: 'rejected',
      reason: 'duration_exceeds_max',
    })
  })

  it('rejects a duration this school does not offer', () => {
    expect(decideMoratoriumRequest({ ...context(), requestedDays: 10 })).toEqual({
      outcome: 'rejected',
      reason: 'duration_not_allowed',
    })
  })

  it('rejects a duration that has expired for a late parent', () => {
    const ctx = context({ today: '2026-09-25', policy: policy({ lateGraceDays: MAX_MORATORIUM_DAYS }) })
    expect(decideMoratoriumRequest({ ...ctx, requestedDays: 7 })).toEqual({
      outcome: 'rejected',
      reason: 'duration_not_allowed',
    })
  })

  /**
   * Why the offer is consulted before the duration: a settled instalment is
   * the more important answer, and telling a parent their number was wrong
   * when the real news is "you have already paid" wastes their trip.
   */
  it('reports the blocking reason ahead of anything about the duration', () => {
    const ctx = context({
      instalment: { status: 'paid', amountMinor: 45_000n, allocatedMinor: 45_000n, dueOn: '2026-09-15' },
    })
    expect(decideMoratoriumRequest({ ...ctx, requestedDays: 28 })).toEqual({
      outcome: 'rejected',
      reason: 'settled',
    })
  })
})

describe('effectiveDueOn', () => {
  const deferred = { deferredDueOn: '2026-10-06' }

  it('moves the date for a granted moratoire', () => {
    expect(effectiveDueOn({ dueOn: '2026-09-15' }, { status: 'granted', ...deferred })).toBe('2026-10-06')
  })

  /**
   * A pending request must not silently pause anything, or a parent chatting
   * at 23:00 moves a date no human approved — and a bursar refusing the next
   * morning finds the reminder they wanted already suppressed.
   */
  it.each(['pending', 'refused', 'cancelled'] as const)('leaves the date alone for a %s moratoire', (status) => {
    expect(effectiveDueOn({ dueOn: '2026-09-15' }, { status, ...deferred })).toBe('2026-09-15')
  })

  it('leaves the date alone when there is no moratoire', () => {
    expect(effectiveDueOn({ dueOn: '2026-09-15' }, null)).toBe('2026-09-15')
  })
})

describe('isMoratoriumActive', () => {
  const granted = { status: 'granted' as MoratoriumStatus, deferredDueOn: '2026-10-06' }

  it('is active up to and including the final day', () => {
    expect(isMoratoriumActive(granted, '2026-09-20')).toBe(true)
    expect(isMoratoriumActive(granted, '2026-10-06')).toBe(true)
  })

  it('has expired the day after', () => {
    expect(isMoratoriumActive(granted, '2026-10-07')).toBe(false)
  })

  it.each(['pending', 'refused', 'cancelled'] as const)('is never active for a %s moratoire', (status) => {
    expect(isMoratoriumActive({ status, deferredDueOn: '2026-10-06' }, '2026-09-20')).toBe(false)
  })

  it('is not active when there is no moratoire', () => {
    expect(isMoratoriumActive(null, '2026-09-20')).toBe(false)
  })
})

describe('the state machine', () => {
  it('approves and refuses a pending moratoire', () => {
    expect(moratoriumTransition('pending', 'approve')).toBe('granted')
    expect(moratoriumTransition('pending', 'refuse')).toBe('refused')
  })

  it('cancels a granted one', () => {
    expect(moratoriumTransition('granted', 'cancel')).toBe('cancelled')
  })

  it('refuses to approve something already decided', () => {
    expect(() => moratoriumTransition('granted', 'approve')).toThrow(ConflictError)
    expect(() => moratoriumTransition('refused', 'approve')).toThrow(ConflictError)
    expect(() => moratoriumTransition('cancelled', 'approve')).toThrow(ConflictError)
  })

  /**
   * A refusal is re-decided by a NEW request, never by mutating the old row
   * into a grant — otherwise the audit trail says a refusal became an
   * approval with nobody having approved anything.
   */
  it('refuses to turn a refusal into a grant', () => {
    expect(() => moratoriumTransition('refused', 'approve')).toThrow(ConflictError)
  })

  it.each(['pending', 'refused', 'cancelled'] as const)('refuses to cancel a %s moratoire', (from) => {
    expect(() => moratoriumTransition(from, 'cancel')).toThrow(ConflictError)
  })
})
