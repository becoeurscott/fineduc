import { describe, it, expect } from 'vitest'
import { Money } from '@fineduc/money'
import {
  expectedClose,
  closeSession,
  assertSessionOpen,
  assertValidFloat,
  paymentMovement,
  formatReceiptNumber,
  type CashMovement,
} from './session.js'

const XAF = 'XAF' as const
const m = (minor: bigint) => Money.of(minor, XAF)

const movements: CashMovement[] = [
  { type: 'payment', amountMinor: 50_000n },
  { type: 'payment', amountMinor: 25_000n },
  { type: 'deposit_to_bank', amountMinor: -60_000n },
]

describe('expectedClose', () => {
  it('is the float plus every movement', () => {
    expect(expectedClose(m(10_000n), movements).amount).toBe(25_000n)
  })

  it('is just the float when nothing moved', () => {
    expect(expectedClose(m(10_000n), []).amount).toBe(10_000n)
  })

  it('treats outward movements as already negative rather than inferring from type', () => {
    expect(expectedClose(m(0n), [{ type: 'float_out', amountMinor: -5_000n }]).amount).toBe(-5_000n)
  })
})

describe('closeSession', () => {
  it('closes cleanly when the count matches', () => {
    const out = closeSession({ openingFloat: m(10_000n), movements, declared: m(25_000n) })
    expect(out).toEqual({
      expectedMinor: 25_000n,
      declaredMinor: 25_000n,
      varianceMinor: 0n,
      status: 'closed',
    })
  })

  /**
   * The control. Cash leaves schools through small unexplained differences
   * that nobody was ever made to write a reason against.
   */
  it('refuses to close a short drawer without a reason', () => {
    expect(() => closeSession({ openingFloat: m(10_000n), movements, declared: m(23_000n) })).toThrow(
      /written reason is required/,
    )
  })

  it('refuses to close a surplus drawer without a reason either', () => {
    expect(() => closeSession({ openingFloat: m(10_000n), movements, declared: m(27_000n) })).toThrow(
      /written reason is required/,
    )
  })

  it('flags rather than closes when a reason is given', () => {
    const out = closeSession({
      openingFloat: m(10_000n),
      movements,
      declared: m(23_000n),
      varianceReason: 'Deux billets manquants, constat fait devant le directeur',
    })
    expect(out.status).toBe('flagged')
    expect(out.varianceMinor).toBe(-2_000n)
  })

  it('reports a surplus as a positive variance', () => {
    const out = closeSession({
      openingFloat: m(10_000n),
      movements,
      declared: m(27_000n),
      varianceReason: 'Fond de caisse recompté',
    })
    expect(out.varianceMinor).toBe(2_000n)
    expect(out.status).toBe('flagged')
  })

  it('treats a whitespace-only reason as no reason', () => {
    expect(() =>
      closeSession({ openingFloat: m(10_000n), movements, declared: m(23_000n), varianceReason: '   ' }),
    ).toThrow(/written reason is required/)
  })

  /**
   * A reason attached to a zero variance is noise in the one report a
   * director actually reads.
   */
  it('rejects a reason when the drawer balances', () => {
    expect(() =>
      closeSession({ openingFloat: m(10_000n), movements, declared: m(25_000n), varianceReason: 'rien à signaler' }),
    ).toThrow(/no variance to explain/)
  })

  it('rejects a negative counted drawer', () => {
    expect(() => closeSession({ openingFloat: m(10_000n), movements: [], declared: m(-1n) })).toThrow(
      /cannot hold a negative/,
    )
  })

  it('rejects a declared amount in another currency', () => {
    expect(() =>
      closeSession({ openingFloat: m(10_000n), movements: [], declared: Money.of(10_000n, 'NGN') }),
    ).toThrow(/exactly one currency/)
  })

  it('closes an empty session that started and ended at zero', () => {
    expect(closeSession({ openingFloat: m(0n), movements: [], declared: m(0n) }).status).toBe('closed')
  })
})

describe('assertSessionOpen', () => {
  it('allows an open session', () => {
    expect(() => assertSessionOpen({ id: 's', status: 'open' })).not.toThrow()
  })

  it.each(['closed', 'reconciled', 'flagged'] as const)('refuses a %s session', (status) => {
    expect(() => assertSessionOpen({ id: 's', status })).toThrow(/Open a new session/)
  })
})

describe('assertValidFloat', () => {
  it('allows zero', () => {
    expect(() => assertValidFloat(m(0n))).not.toThrow()
  })

  it('rejects a negative float', () => {
    expect(() => assertValidFloat(m(-1n))).toThrow(/cannot be negative/)
  })
})

describe('paymentMovement', () => {
  it('is always money INTO the drawer', () => {
    expect(paymentMovement(m(5_000n), 'REC-1')).toEqual({ type: 'payment', amountMinor: 5_000n, reference: 'REC-1' })
  })

  it('rejects a non-positive payment', () => {
    expect(() => paymentMovement(m(0n), 'x')).toThrow(/must be positive/)
  })
})

describe('formatReceiptNumber', () => {
  it('is zero-padded and year-scoped', () => {
    expect(formatReceiptNumber(2026, 1)).toBe('2026-000001')
    expect(formatReceiptNumber(2026, 1234)).toBe('2026-001234')
  })

  it('sorts lexicographically in issue order, which is what an auditor scans', () => {
    const numbers = [formatReceiptNumber(2026, 9), formatReceiptNumber(2026, 10), formatReceiptNumber(2026, 100)]
    expect([...numbers].sort()).toEqual(numbers)
  })

  it('rejects a sequence that is not a positive integer', () => {
    expect(() => formatReceiptNumber(2026, 0)).toThrow(/positive integer/)
    expect(() => formatReceiptNumber(2026, -1)).toThrow(/positive integer/)
    expect(() => formatReceiptNumber(2026, 1.5)).toThrow(/positive integer/)
  })
})
