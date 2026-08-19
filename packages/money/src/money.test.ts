import { describe, expect, it } from 'vitest'
import { CurrencyMismatchError, Money, NonIntegerAmountError } from './money.js'

describe('Money.of', () => {
  it('accepts a bigint, an integer number, or a numeric string', () => {
    expect(Money.of(45000n, 'XAF').amount).toBe(45000n)
    expect(Money.of(45000, 'XAF').amount).toBe(45000n)
    expect(Money.of('45000', 'XAF').amount).toBe(45000n)
  })

  it('rejects a non-integer number', () => {
    expect(() => Money.of(45000.5, 'XAF')).toThrow(NonIntegerAmountError)
  })

  it('rejects a non-numeric string', () => {
    expect(() => Money.of('45000.50', 'XAF')).toThrow(NonIntegerAmountError)
    expect(() => Money.of('abc', 'XAF')).toThrow(NonIntegerAmountError)
  })

  it('rejects a value of the wrong runtime type from an untyped caller', () => {
    // TypeScript blocks this at the call site; the runtime guard is the
    // backstop for a JS caller or a payload deserialised as `unknown`.
    // @ts-expect-error deliberately passing an invalid runtime type
    expect(() => Money.of(null, 'XAF')).toThrow(NonIntegerAmountError)
  })

  it('accepts negative integers (for signed ledger entries)', () => {
    expect(Money.of(-500, 'XAF').amount).toBe(-500n)
    expect(Money.of('-500', 'XAF').amount).toBe(-500n)
  })

  it('is immutable', () => {
    const m = Money.of(1000, 'XAF')
    expect(Object.isFrozen(m)).toBe(true)
  })
})

describe('Money.ofMajor', () => {
  it('is numerically identical to .of() for a zero-exponent currency', () => {
    expect(Money.ofMajor(45000, 'XAF').amount).toBe(Money.of(45000, 'XAF').amount)
    expect(Money.ofMajor('45000', 'XAF').amount).toBe(45000n)
  })

  it('converts a decimal major amount for a two-exponent currency', () => {
    expect(Money.ofMajor('12.50', 'USD').amount).toBe(1250n)
    expect(Money.ofMajor(12.5, 'USD').amount).toBe(1250n)
    expect(Money.ofMajor('12', 'USD').amount).toBe(1200n)
  })

  it('handles negative major amounts', () => {
    expect(Money.ofMajor('-12.50', 'USD').amount).toBe(-1250n)
  })

  it('handles a fractional-only amount with no whole part', () => {
    expect(Money.ofMajor('.50', 'USD').amount).toBe(50n)
    expect(Money.ofMajor('-.50', 'USD').amount).toBe(-50n)
  })

  it('rejects more fractional digits than the currency exponent allows', () => {
    expect(() => Money.ofMajor('12.505', 'USD')).toThrow(NonIntegerAmountError)
    expect(() => Money.ofMajor('12.50', 'XAF')).toThrow(NonIntegerAmountError)
  })
})

describe('arithmetic', () => {
  it('adds and subtracts same-currency amounts', () => {
    const a = Money.of(1000, 'XAF')
    const b = Money.of(300, 'XAF')
    expect(a.add(b).amount).toBe(1300n)
    expect(a.subtract(b).amount).toBe(700n)
  })

  it('throws CurrencyMismatchError across currencies', () => {
    const a = Money.of(1000, 'XAF')
    const b = Money.of(1000, 'USD')
    expect(() => a.add(b)).toThrow(CurrencyMismatchError)
    expect(() => a.subtract(b)).toThrow(CurrencyMismatchError)
    expect(() => a.compare(b)).toThrow(CurrencyMismatchError)
  })

  it('negates', () => {
    expect(Money.of(500, 'XAF').negate().amount).toBe(-500n)
  })

  it('multiplies by an integer scalar', () => {
    expect(Money.of(1500, 'XAF').multiply(3).amount).toBe(4500n)
    expect(Money.of(1500, 'XAF').multiply(3n).amount).toBe(4500n)
  })

  it('sums a list, defaulting empty to zero', () => {
    const monies = [Money.of(100, 'XAF'), Money.of(200, 'XAF'), Money.of(300, 'XAF')]
    expect(Money.sum(monies, 'XAF').amount).toBe(600n)
    expect(Money.sum([], 'XAF').amount).toBe(0n)
  })
})

describe('comparison', () => {
  const a = Money.of(1000, 'XAF')
  const b = Money.of(500, 'XAF')
  const c = Money.of(1000, 'XAF')

  it('equals', () => {
    expect(a.equals(c)).toBe(true)
    expect(a.equals(b)).toBe(false)
    expect(a.equals(Money.of(1000, 'USD'))).toBe(false)
  })

  it('greaterThan / lessThan / greaterThanOrEqual / lessThanOrEqual', () => {
    expect(a.greaterThan(b)).toBe(true)
    expect(b.lessThan(a)).toBe(true)
    expect(a.greaterThanOrEqual(c)).toBe(true)
    expect(a.lessThanOrEqual(c)).toBe(true)
    expect(b.greaterThan(a)).toBe(false)
  })

  it('isZero / isPositive / isNegative', () => {
    expect(Money.zero('XAF').isZero()).toBe(true)
    expect(a.isPositive()).toBe(true)
    expect(a.negate().isNegative()).toBe(true)
  })
})

describe('wire format', () => {
  it('serialises the minor-unit amount as a STRING, never a number', () => {
    const m = Money.of(45000, 'XAF')
    expect(m.toWireString()).toBe('45000')
    expect(m.toJSON()).toEqual({ amountMinor: '45000', currency: 'XAF' })
    expect(JSON.stringify(m)).toBe('{"amountMinor":"45000","currency":"XAF"}')
  })

  it('does not lose precision on very large amounts (unlike a float or Number)', () => {
    const huge = Money.of('9007199254740993', 'XAF') // 2^53 + 1
    expect(huge.toWireString()).toBe('9007199254740993')
  })
})
