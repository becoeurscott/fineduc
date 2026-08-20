import { describe, it, expect } from 'vitest'
import { Money } from '@fineduc/money'
import { resolveDiscount, resolveDiscountStack, siblingDiscount } from './discounts.js'

const XAF = 'XAF' as const
const base = (minor: bigint) => Money.of(minor, XAF)

describe('resolveDiscount', () => {
  it('resolves a percentage to an integer minor amount', () => {
    const out = resolveDiscount({ type: 'merit', method: 'percent', value: 1_000n }, base(250_000n))
    expect(out.amountMinor).toBe(25_000n)
  })

  it('keeps the original percentage on the row for the audit trail', () => {
    const out = resolveDiscount({ type: 'merit', method: 'percent', value: 1_000n }, base(250_000n))
    expect(out.value).toBe(1_000n)
    expect(out.method).toBe('percent')
  })

  /**
   * ARCHITECTURE.md §5: percentages round HALF-UP to the minor unit. On a
   * zero-decimal currency this is where a franc is won or lost, so it is
   * pinned rather than assumed.
   */
  it('rounds half-up, not down', () => {
    // 5% of 4 999 = 249.95 → 250
    expect(resolveDiscount({ type: 'merit', method: 'percent', value: 500n }, base(4_999n)).amountMinor).toBe(250n)
    // 5% of 4 990 = 249.5 → 250 (the exact half goes UP)
    expect(resolveDiscount({ type: 'merit', method: 'percent', value: 500n }, base(4_990n)).amountMinor).toBe(250n)
    // 5% of 4 989 = 249.45 → 249
    expect(resolveDiscount({ type: 'merit', method: 'percent', value: 500n }, base(4_989n)).amountMinor).toBe(249n)
  })

  it('takes a fixed amount as given', () => {
    const out = resolveDiscount({ type: 'commercial', method: 'fixed', value: 15_000n }, base(250_000n))
    expect(out.amountMinor).toBe(15_000n)
  })

  it('allows exactly 100% and exactly the full base', () => {
    expect(resolveDiscount({ type: 'hardship', method: 'percent', value: 10_000n }, base(80_000n)).amountMinor).toBe(80_000n)
    expect(resolveDiscount({ type: 'hardship', method: 'fixed', value: 80_000n }, base(80_000n)).amountMinor).toBe(80_000n)
  })

  it('allows a zero discount without complaint', () => {
    expect(resolveDiscount({ type: 'merit', method: 'fixed', value: 0n }, base(80_000n)).amountMinor).toBe(0n)
  })

  it('carries the scope and reason through', () => {
    const out = resolveDiscount(
      { type: 'staff', method: 'percent', value: 5_000n, reason: 'Enfant du personnel', invoiceLineId: 'line-1' },
      base(100_000n),
    )
    expect(out.reason).toBe('Enfant du personnel')
    expect(out.invoiceLineId).toBe('line-1')
  })

  describe('refuses to push a charge below zero', () => {
    it('a fixed discount larger than the base', () => {
      expect(() => resolveDiscount({ type: 'commercial', method: 'fixed', value: 90_000n }, base(80_000n))).toThrow(
        /cannot be discounted below zero/,
      )
    })

    it('more than 100%', () => {
      expect(() => resolveDiscount({ type: 'commercial', method: 'percent', value: 10_001n }, base(80_000n))).toThrow(
        /cannot exceed 100%/,
      )
    })

    it('a negative value', () => {
      expect(() => resolveDiscount({ type: 'merit', method: 'fixed', value: -1n }, base(80_000n))).toThrow(/cannot be negative/)
    })

    it('a negative base', () => {
      expect(() => resolveDiscount({ type: 'merit', method: 'fixed', value: 1n }, base(-1n))).toThrow(
        /negative base amount/,
      )
    })
  })
})

describe('resolveDiscountStack', () => {
  it('applies discounts sequentially, each on what is left', () => {
    const out = resolveDiscountStack(
      [
        { type: 'sibling', method: 'percent', value: 5_000n },
        { type: 'staff', method: 'percent', value: 5_000n },
      ],
      base(100_000n),
    )
    // 50% off 100 000 = 50 000; then 50% off the remaining 50 000 = 25 000.
    expect(out.discounts.map((d) => d.amountMinor)).toEqual([50_000n, 25_000n])
    expect(out.totalMinor).toBe(75_000n)
    expect(out.netMinor).toBe(25_000n)
  })

  it('never lets the stack take the net below zero', () => {
    expect(() =>
      resolveDiscountStack(
        [
          { type: 'hardship', method: 'fixed', value: 60_000n },
          { type: 'commercial', method: 'fixed', value: 60_000n },
        ],
        base(100_000n),
      ),
    ).toThrow(/cannot be discounted below zero/)
  })

  it('total and net always reconcile to the base', () => {
    const out = resolveDiscountStack(
      [
        { type: 'sibling', method: 'percent', value: 1_000n },
        { type: 'merit', method: 'fixed', value: 5_000n },
      ],
      base(250_000n),
    )
    expect(out.totalMinor + out.netMinor).toBe(250_000n)
  })

  it('is a no-op on an empty stack', () => {
    const out = resolveDiscountStack([], base(250_000n))
    expect(out.discounts).toEqual([])
    expect(out.totalMinor).toBe(0n)
    expect(out.netMinor).toBe(250_000n)
  })

  it('preserves caller order, because order changes the result', () => {
    const percentFirst = resolveDiscountStack(
      [
        { type: 'sibling', method: 'percent', value: 5_000n },
        { type: 'merit', method: 'fixed', value: 10_000n },
      ],
      base(100_000n),
    )
    const fixedFirst = resolveDiscountStack(
      [
        { type: 'merit', method: 'fixed', value: 10_000n },
        { type: 'sibling', method: 'percent', value: 5_000n },
      ],
      base(100_000n),
    )
    expect(percentFirst.netMinor).toBe(40_000n)
    expect(fixedFirst.netMinor).toBe(45_000n)
  })
})

describe('siblingDiscount', () => {
  const policy = { percentBp: 1_000 }

  it('does not apply to the first child', () => {
    expect(siblingDiscount(0, policy)).toBeNull()
  })

  it('applies from the second child on', () => {
    expect(siblingDiscount(1, policy)?.value).toBe(1_000n)
    expect(siblingDiscount(4, policy)?.value).toBe(1_000n)
  })

  it('is a percent discount of type sibling', () => {
    const out = siblingDiscount(1, policy)
    expect(out?.type).toBe('sibling')
    expect(out?.method).toBe('percent')
  })

  it('names the child rank in the reason, in French, for the bursar', () => {
    expect(siblingDiscount(2, policy)?.reason).toContain('3e enfant')
  })

  it('honours a policy that starts later', () => {
    expect(siblingDiscount(1, { percentBp: 1_000, fromIndex: 2 })).toBeNull()
    expect(siblingDiscount(2, { percentBp: 1_000, fromIndex: 2 })).not.toBeNull()
  })

  it('returns null rather than a zero-amount row when the policy is off', () => {
    expect(siblingDiscount(3, { percentBp: 0 })).toBeNull()
  })

  it('rejects a nonsense index', () => {
    expect(() => siblingDiscount(-1, policy)).toThrow(/non-negative integer/)
    expect(() => siblingDiscount(1.5, policy)).toThrow(/non-negative integer/)
  })
})
