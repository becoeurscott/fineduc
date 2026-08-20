import { describe, it, expect } from 'vitest'
import {
  canTransition,
  assertTransition,
  isSettled,
  initialStatus,
  statusAfterRefund,
  TERMINAL,
  type PaymentStatus,
} from './state-machine.js'

describe('canTransition', () => {
  it('walks the normal aggregator path', () => {
    expect(canTransition('pending', 'processing')).toBe(true)
    expect(canTransition('processing', 'succeeded')).toBe(true)
  })

  it('lets a payment settle without an intermediate processing step', () => {
    expect(canTransition('pending', 'succeeded')).toBe(true)
  })

  /**
   * The transition that matters most. Aggregators retry callbacks out of
   * order; a late "failed" arriving after settlement must not unsettle money
   * that is already in the school's account.
   */
  it('never lets settled money become failed', () => {
    expect(canTransition('succeeded', 'failed')).toBe(false)
  })

  it('never lets a failed payment quietly succeed', () => {
    expect(canTransition('failed', 'succeeded')).toBe(false)
  })

  it('allows only refunds out of succeeded', () => {
    expect(canTransition('succeeded', 'refunded')).toBe(true)
    expect(canTransition('succeeded', 'partially_refunded')).toBe(true)
    expect(canTransition('succeeded', 'pending')).toBe(false)
    expect(canTransition('succeeded', 'cancelled')).toBe(false)
  })

  it('lets a partial refund be topped up to a full one', () => {
    expect(canTransition('partially_refunded', 'refunded')).toBe(true)
    expect(canTransition('partially_refunded', 'partially_refunded')).toBe(true)
  })

  it.each([...TERMINAL].filter((s) => s !== 'refunded'))('leaves nothing reachable from %s', (status) => {
    const all: PaymentStatus[] = [
      'pending',
      'processing',
      'succeeded',
      'failed',
      'cancelled',
      'expired',
      'refunded',
      'partially_refunded',
    ]
    expect(all.filter((to) => canTransition(status, to))).toEqual([])
  })
})

describe('assertTransition', () => {
  it('accepts a legal move', () => {
    expect(() => assertTransition('pending', 'succeeded')).not.toThrow()
  })

  /**
   * A redelivered webhook for an already-succeeded payment is the normal
   * case, not an error — the caller treats it as a no-op.
   */
  it('treats a repeat of the same status as a no-op', () => {
    expect(() => assertTransition('succeeded', 'succeeded')).not.toThrow()
    expect(() => assertTransition('failed', 'failed')).not.toThrow()
  })

  it('rejects an illegal move and says why', () => {
    expect(() => assertTransition('succeeded', 'failed')).toThrow(/cannot go from succeeded to failed/)
  })

  it('names terminality in the message when the source is a dead end', () => {
    expect(() => assertTransition('cancelled', 'succeeded')).toThrow(/cancelled is terminal/)
  })
})

describe('isSettled', () => {
  it('is true for succeeded and partially refunded', () => {
    expect(isSettled('succeeded')).toBe(true)
    // Money did land; part of it went back. What remains is still settled.
    expect(isSettled('partially_refunded')).toBe(true)
  })

  it.each(['pending', 'processing', 'failed', 'cancelled', 'expired', 'refunded'] as const)(
    'is false for %s',
    (status) => {
      expect(isSettled(status)).toBe(false)
    },
  )
})

describe('initialStatus', () => {
  /** No provider to wait for — the money is already in the drawer. */
  it('settles cash immediately', () => {
    expect(initialStatus('cash')).toBe('succeeded')
  })

  it('settles a waiver immediately — the debt is already forgiven', () => {
    expect(initialStatus('waiver')).toBe('succeeded')
  })

  it.each(['mobile_money', 'bank_transfer', 'cheque', 'card'] as const)('starts %s pending', (method) => {
    expect(initialStatus(method)).toBe('pending')
  })
})

describe('statusAfterRefund', () => {
  it('is fully refunded when the last franc goes back', () => {
    expect(statusAfterRefund(100_000n, 100_000n)).toBe('refunded')
  })

  it('is partially refunded for anything less', () => {
    expect(statusAfterRefund(100_000n, 40_000n)).toBe('partially_refunded')
    expect(statusAfterRefund(100_000n, 99_999n)).toBe('partially_refunded')
  })

  it('refuses to refund more than was paid', () => {
    expect(() => statusAfterRefund(100_000n, 100_001n)).toThrow(/more than the 100000 that was paid/)
  })

  it('refuses a zero or negative refund', () => {
    expect(() => statusAfterRefund(100_000n, 0n)).toThrow(/must be a positive amount/)
    expect(() => statusAfterRefund(100_000n, -1n)).toThrow(/must be a positive amount/)
  })
})
