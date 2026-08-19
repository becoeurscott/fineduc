import { describe, expect, it } from 'vitest'
import { allocate, allocateEven, percentOfBp } from './allocate.js'
import { Money } from './money.js'

describe('allocateEven — the canonical invariant', () => {
  it('splits 100 000 XAF three ways as 33 334 / 33 333 / 33 333', () => {
    const parts = allocateEven(Money.of(100_000, 'XAF'), 3)
    expect(parts.map((p) => p.amount)).toEqual([33_334n, 33_333n, 33_333n])
  })

  it('always re-sums to exactly the original total, for many splits', () => {
    const cases: Array<[number, number]> = [
      [100_000, 3],
      [1, 3],
      [2, 3],
      [999_999, 7],
      [10, 4],
      [45_000, 12],
      [1_000_000_001, 13],
    ]
    for (const [total, n] of cases) {
      const parts = allocateEven(Money.of(total, 'XAF'), n)
      const resummed = Money.sum(parts, 'XAF')
      expect(resummed.amount, `${total} split ${n} ways`).toBe(BigInt(total))
      expect(parts).toHaveLength(n)
    }
  })

  it('every part differs from every other part by at most one minor unit', () => {
    const parts = allocateEven(Money.of(1_000_000_001, 'XAF'), 13)
    const amounts = parts.map((p) => p.amount)
    const max = amounts.reduce((a, b) => (b > a ? b : a))
    const min = amounts.reduce((a, b) => (b < a ? b : a))
    expect(max - min).toBeLessThanOrEqual(1n)
  })

  it('gives the earliest indices the extra units, deterministically', () => {
    // 10 / 3 -> base 3 each, remainder 1 each (tie) -> first index wins the leftover unit.
    const parts = allocateEven(Money.of(10, 'XAF'), 3)
    expect(parts.map((p) => p.amount)).toEqual([4n, 3n, 3n])
  })

  it('handles an amount smaller than the part count (some parts are zero)', () => {
    const parts = allocateEven(Money.of(2, 'XAF'), 5)
    expect(parts.map((p) => p.amount)).toEqual([1n, 1n, 0n, 0n, 0n])
    expect(Money.sum(parts, 'XAF').amount).toBe(2n)
  })

  it('handles a negative total, preserving sign on every part', () => {
    const parts = allocateEven(Money.of(-10, 'XAF'), 3)
    expect(parts.map((p) => p.amount)).toEqual([-4n, -3n, -3n])
    expect(Money.sum(parts, 'XAF').amount).toBe(-10n)
  })

  it('handles a single part (identity)', () => {
    const parts = allocateEven(Money.of(45_000, 'XAF'), 1)
    expect(parts.map((p) => p.amount)).toEqual([45_000n])
  })

  it('rejects zero or non-integer part counts', () => {
    expect(() => allocateEven(Money.of(100, 'XAF'), 0)).toThrow(RangeError)
    expect(() => allocateEven(Money.of(100, 'XAF'), 2.5)).toThrow(RangeError)
    expect(() => allocateEven(Money.of(100, 'XAF'), -1)).toThrow(RangeError)
  })
})

describe('allocate — weighted split', () => {
  it('splits proportionally to weights and re-sums exactly', () => {
    // 3 tuition tranches weighted 50/25/25 of 45 000 XAF.
    const parts = allocate(Money.of(45_000, 'XAF'), [50, 25, 25])
    expect(parts.map((p) => p.amount)).toEqual([22_500n, 11_250n, 11_250n])
    expect(Money.sum(parts, 'XAF').amount).toBe(45_000n)
  })

  it('gives the largest remainder the leftover unit under a tie', () => {
    // total 100, weights [1,1,1]: base 33 each, remainder 1 each -> first gets it.
    const parts = allocate(Money.of(100, 'XAF'), [1, 1, 1])
    expect(parts.map((p) => p.amount)).toEqual([34n, 33n, 33n])
  })

  it('accepts bigint weights', () => {
    const parts = allocate(Money.of(90, 'XAF'), [1n, 2n, 3n])
    expect(parts.map((p) => p.amount)).toEqual([15n, 30n, 45n])
  })

  it('rejects an empty weights array', () => {
    expect(() => allocate(Money.of(100, 'XAF'), [])).toThrow(RangeError)
  })

  it('rejects negative weights', () => {
    expect(() => allocate(Money.of(100, 'XAF'), [1, -1])).toThrow(RangeError)
  })

  it('rejects weights summing to zero', () => {
    expect(() => allocate(Money.of(100, 'XAF'), [0, 0])).toThrow(RangeError)
  })

  it('rejects non-integer weights', () => {
    expect(() => allocate(Money.of(100, 'XAF'), [1.5, 2])).toThrow(RangeError)
  })

  it('a zero-weight share receives nothing', () => {
    const parts = allocate(Money.of(100, 'XAF'), [1, 0])
    expect(parts.map((p) => p.amount)).toEqual([100n, 0n])
  })

  it('ranks distinct remainders correctly when they already descend by index', () => {
    // total 10, weights [1,2,3] -> shares [1,3,5] remainders [4,2,0]: all distinct,
    // so the leftover unit must go to index 0 (remainder 4), not by position.
    const parts = allocate(Money.of(10, 'XAF'), [1, 2, 3])
    expect(parts.map((p) => p.amount)).toEqual([2n, 3n, 5n])
    expect(Money.sum(parts, 'XAF').amount).toBe(10n)
  })

  it('ranks distinct remainders correctly when they ascend by index (forces reordering)', () => {
    // total 10, weights [3,2,1] -> shares [5,3,1] remainders [0,2,4]: the sort
    // must move the low-remainder share past the higher ones to rank last.
    const parts = allocate(Money.of(10, 'XAF'), [3, 2, 1])
    expect(parts.map((p) => p.amount)).toEqual([5n, 3n, 2n])
    expect(Money.sum(parts, 'XAF').amount).toBe(10n)
  })
})

describe('percentOfBp — half-up rounding to the minor unit', () => {
  it('computes a whole-number percentage exactly', () => {
    // 10% of 45 000 = 4 500
    expect(percentOfBp(Money.of(45_000, 'XAF'), 1_000).amount).toBe(4_500n)
  })

  it('rounds half up at the minor-unit boundary', () => {
    // 1% of 50 = 0.5 -> rounds up to 1 (half-up, not banker's rounding)
    expect(percentOfBp(Money.of(50, 'XAF'), 100).amount).toBe(1n)
    // 1% of 49 = 0.49 -> rounds down to 0
    expect(percentOfBp(Money.of(49, 'XAF'), 100).amount).toBe(0n)
  })

  it('handles 100% and 0%', () => {
    expect(percentOfBp(Money.of(45_000, 'XAF'), 10_000).amount).toBe(45_000n)
    expect(percentOfBp(Money.of(45_000, 'XAF'), 0).amount).toBe(0n)
  })

  it('accepts bigint basis points', () => {
    expect(percentOfBp(Money.of(45_000, 'XAF'), 1_000n).amount).toBe(4_500n)
  })

  it('rejects a negative base amount', () => {
    expect(() => percentOfBp(Money.of(-100, 'XAF'), 1_000)).toThrow(RangeError)
  })

  it('rejects negative basis points', () => {
    expect(() => percentOfBp(Money.of(100, 'XAF'), -1)).toThrow(RangeError)
  })

  it('preserves the currency on the result', () => {
    expect(percentOfBp(Money.of(100, 'USD'), 5_000).currency).toBe('USD')
  })
})
