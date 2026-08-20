import { describe, it, expect } from 'vitest'
import {
  decideEligibility,
  isInstalmentSettled,
  withinSendingHours,
  resolveChannel,
  DEFAULT_QUIET_HOURS,
  type SendContext,
} from './eligibility.js'

/** A context in which a reminder WOULD go out, so each test changes one thing. */
function sendable(over: Partial<SendContext> = {}): SendContext {
  return {
    instalment: { status: 'overdue', amountMinor: 100_000n, allocatedMinor: 0n },
    guardian: { phoneE164: '+237600000001', optedOut: false, quarantined: false },
    localHour: 9,
    quietHours: DEFAULT_QUIET_HOURS,
    messagesToGuardianToday: 0,
    guardianDailyCap: 2,
    messagesForTenantToday: 10,
    tenantDailyCap: 500,
    creditBalanceMinor: 5_000n,
    ...over,
  }
}

describe('isInstalmentSettled', () => {
  it.each(['paid', 'waived', 'cancelled'] as const)('is true for %s', (status) => {
    expect(isInstalmentSettled({ status, amountMinor: 100n, allocatedMinor: 0n })).toBe(true)
  })

  it.each(['pending', 'partial', 'overdue'] as const)('is false for %s with money still owed', (status) => {
    expect(isInstalmentSettled({ status, amountMinor: 100n, allocatedMinor: 40n })).toBe(false)
  })

  /**
   * The belt to the braces: if a status ever drifts from the amounts, the
   * amounts win. A reminder for a debt that is actually cleared is the
   * failure this whole file exists to prevent.
   */
  it('is true when the amounts say paid even if the status has drifted', () => {
    expect(isInstalmentSettled({ status: 'overdue', amountMinor: 100n, allocatedMinor: 100n })).toBe(true)
    expect(isInstalmentSettled({ status: 'pending', amountMinor: 100n, allocatedMinor: 150n })).toBe(true)
  })
})

describe('withinSendingHours', () => {
  it('sends at the start hour and not at the end hour', () => {
    expect(withinSendingHours(7, DEFAULT_QUIET_HOURS)).toBe(true)
    expect(withinSendingHours(19, DEFAULT_QUIET_HOURS)).toBe(true)
    expect(withinSendingHours(20, DEFAULT_QUIET_HOURS)).toBe(false)
  })

  it('refuses the small hours', () => {
    expect(withinSendingHours(3, DEFAULT_QUIET_HOURS)).toBe(false)
    expect(withinSendingHours(6, DEFAULT_QUIET_HOURS)).toBe(false)
  })

  it('supports a window that wraps midnight', () => {
    const overnight = { startHour: 22, endHour: 6 }
    expect(withinSendingHours(23, overnight)).toBe(true)
    expect(withinSendingHours(2, overnight)).toBe(true)
    expect(withinSendingHours(12, overnight)).toBe(false)
  })

  it('treats an empty window as no restriction', () => {
    expect(withinSendingHours(3, { startHour: 0, endHour: 0 })).toBe(true)
  })

  it('rejects an hour that is not an hour', () => {
    expect(() => withinSendingHours(24, DEFAULT_QUIET_HOURS)).toThrow(/Not an hour/)
    expect(() => withinSendingHours(-1, DEFAULT_QUIET_HOURS)).toThrow(/Not an hour/)
    expect(() => withinSendingHours(9.5, DEFAULT_QUIET_HOURS)).toThrow(/Not an hour/)
  })
})

describe('decideEligibility', () => {
  it('sends when nothing is in the way', () => {
    expect(decideEligibility(sendable())).toEqual({ action: 'send' })
  })

  /**
   * ARCHITECTURE calls this "the #1 trust bug". A family that has just paid
   * and is then chased for it is the one mistake they will not forgive.
   */
  describe('the settled check', () => {
    it.each(['paid', 'waived', 'cancelled'] as const)('skips a %s instalment', (status) => {
      const decision = decideEligibility(sendable({ instalment: { status, amountMinor: 100n, allocatedMinor: 100n } }))
      expect(decision).toEqual({ action: 'skip', reason: 'settled' })
    })

    it('skips when the money landed but the status has not caught up', () => {
      const decision = decideEligibility(
        sendable({ instalment: { status: 'overdue', amountMinor: 100_000n, allocatedMinor: 100_000n } }),
      )
      expect(decision).toEqual({ action: 'skip', reason: 'settled' })
    })

    /**
     * Settled must beat EVERY other reason. A paid instalment deferred for
     * quiet hours comes back tomorrow and chases a family that has paid.
     */
    it('wins over every deferrable reason', () => {
      const decision = decideEligibility(
        sendable({
          instalment: { status: 'paid', amountMinor: 100n, allocatedMinor: 100n },
          localHour: 3,
          messagesToGuardianToday: 99,
          messagesForTenantToday: 9_999,
        }),
      )
      expect(decision).toEqual({ action: 'skip', reason: 'settled' })
    })

    it('still sends for a partially paid instalment — money is still owed', () => {
      const decision = decideEligibility(
        sendable({ instalment: { status: 'partial', amountMinor: 100_000n, allocatedMinor: 40_000n } }),
      )
      expect(decision.action).toBe('send')
    })
  })

  describe('skips (permanent — cancel the row)', () => {
    it('skips an opted-out guardian', () => {
      const decision = decideEligibility(
        sendable({ guardian: { phoneE164: '+237600000001', optedOut: true, quarantined: false } }),
      )
      expect(decision).toEqual({ action: 'skip', reason: 'opted_out' })
    })

    it('skips a quarantined guardian', () => {
      const decision = decideEligibility(
        sendable({ guardian: { phoneE164: '+237600000001', optedOut: false, quarantined: true } }),
      )
      expect(decision).toEqual({ action: 'skip', reason: 'quarantined' })
    })

    it('skips a guardian with no phone at all', () => {
      const decision = decideEligibility(
        sendable({ guardian: { phoneE164: null, optedOut: false, quarantined: false } }),
      )
      expect(decision).toEqual({ action: 'skip', reason: 'no_phone' })
    })

    /**
     * Never send on credit, and ALERT — a school out of credits stops
     * reminding anyone, and nobody notices from outside until collections
     * quietly fall.
     */
    it('skips and alerts when credits are exhausted', () => {
      const decision = decideEligibility(sendable({ creditBalanceMinor: 0n }))
      expect(decision).toEqual({ action: 'skip', reason: 'no_credits', alert: true })
    })

    it('skips on a negative credit balance too', () => {
      expect(decideEligibility(sendable({ creditBalanceMinor: -1n })).action).toBe('skip')
    })
  })

  describe('defers (temporary — try again later)', () => {
    it('defers outside quiet hours', () => {
      expect(decideEligibility(sendable({ localHour: 5 }))).toEqual({ action: 'defer', reason: 'quiet_hours' })
      expect(decideEligibility(sendable({ localHour: 22 }))).toEqual({ action: 'defer', reason: 'quiet_hours' })
    })

    it('defers once the guardian has had their daily allowance', () => {
      const decision = decideEligibility(sendable({ messagesToGuardianToday: 2, guardianDailyCap: 2 }))
      expect(decision).toEqual({ action: 'defer', reason: 'guardian_frequency_cap' })
    })

    it('still sends on the message before the cap', () => {
      expect(decideEligibility(sendable({ messagesToGuardianToday: 1, guardianDailyCap: 2 })).action).toBe('send')
    })

    it('defers and WARNS at the tenant daily cap', () => {
      const decision = decideEligibility(sendable({ messagesForTenantToday: 500, tenantDailyCap: 500 }))
      expect(decision).toEqual({ action: 'defer', reason: 'tenant_daily_cap', warn: true })
    })
  })

  /**
   * Skips before defers. Deferring something that can never become sendable
   * leaves a row retrying forever.
   */
  it('prefers a permanent skip over a temporary defer', () => {
    const decision = decideEligibility(
      sendable({ guardian: { phoneE164: null, optedOut: false, quarantined: false }, localHour: 3 }),
    )
    expect(decision.action).toBe('skip')
  })

  it('reports no credits ahead of quiet hours, so the alert is not delayed a night', () => {
    const decision = decideEligibility(sendable({ creditBalanceMinor: 0n, localHour: 3 }))
    expect(decision).toEqual({ action: 'skip', reason: 'no_credits', alert: true })
  })
})

describe('resolveChannel', () => {
  it('prefers WhatsApp — an order of magnitude cheaper than SMS', () => {
    expect(resolveChannel({ preferredChannel: 'whatsapp', whatsappOptIn: true })).toBe('whatsapp')
  })

  it('honours a guardian who asked for SMS', () => {
    expect(resolveChannel({ preferredChannel: 'sms', whatsappOptIn: true })).toBe('sms')
  })

  it('falls back to SMS when they never opted in to WhatsApp', () => {
    expect(resolveChannel({ preferredChannel: 'whatsapp', whatsappOptIn: false })).toBe('sms')
  })

  it('falls back to SMS after a WhatsApp delivery failure', () => {
    expect(
      resolveChannel({ preferredChannel: 'whatsapp', whatsappOptIn: true, whatsappUndeliverable: true }),
    ).toBe('sms')
  })
})
