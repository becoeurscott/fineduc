/**
 * Money value object. AGENTS.md rule #1: all money arithmetic in this repo
 * goes through this file. A float, a `toFixed(2)`, or a hard-coded `* 100`
 * anywhere else is a defect, not a style issue.
 *
 * Representation: a bigint count of MINOR units plus the currency code.
 * For XAF/XOF (exponent 0) the minor unit IS the franc. There is no
 * hidden ×100 anywhere in this file.
 */
import { type CurrencyCode, exponentOf, minorUnitsPerMajor } from './currency.js'

export class CurrencyMismatchError extends Error {
  constructor(
    public readonly left: CurrencyCode,
    public readonly right: CurrencyCode,
  ) {
    super(`Currency mismatch: ${left} vs ${right}`)
    this.name = 'CurrencyMismatchError'
  }
}

export class NonIntegerAmountError extends Error {
  constructor(value: unknown) {
    super(`Money amount must be an integer number of minor units, got: ${String(value)}`)
    this.name = 'NonIntegerAmountError'
  }
}

export class Money {
  readonly amount: bigint
  readonly currency: CurrencyCode

  private constructor(amount: bigint, currency: CurrencyCode) {
    this.amount = amount
    this.currency = currency
    Object.freeze(this)
  }

  /** Build from an integer count of MINOR units (bigint, integer number, or numeric string). */
  static of(amountMinor: bigint | number | string, currency: CurrencyCode): Money {
    return new Money(toBigIntStrict(amountMinor), currency)
  }

  /**
   * Build from a MAJOR-unit amount (e.g. "45000" francs, or "12.50" dollars).
   * For a zero-exponent currency this is numerically identical to `.of()` —
   * the distinction still matters because it documents intent at the call site.
   */
  static ofMajor(amountMajor: number | string, currency: CurrencyCode): Money {
    const exponent = exponentOf(currency)
    const [wholePart = '', fractionPart = ''] = String(amountMajor).split('.')
    if (fractionPart.length > exponent) {
      throw new NonIntegerAmountError(amountMajor)
    }
    const paddedFraction = fractionPart.padEnd(exponent, '0')
    const sign = wholePart.startsWith('-') ? -1n : 1n
    const whole = BigInt(wholePart.replace('-', '') || '0')
    const fraction = paddedFraction === '' ? 0n : BigInt(paddedFraction)
    const minorPerMajor = minorUnitsPerMajor(currency)
    return new Money(sign * (whole * minorPerMajor + fraction), currency)
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency)
  }

  static sum(monies: readonly Money[], currency: CurrencyCode): Money {
    return monies.reduce((total, m) => total.add(m), Money.zero(currency))
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency)
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.amount + other.amount, this.currency)
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.amount - other.amount, this.currency)
  }

  negate(): Money {
    return new Money(-this.amount, this.currency)
  }

  /** Scale by an integer or bigint scalar (e.g. a quantity). Never a fraction — use allocate() for splits. */
  multiply(scalar: number | bigint): Money {
    const factor = typeof scalar === 'bigint' ? scalar : toBigIntStrict(scalar)
    return new Money(this.amount * factor, this.currency)
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other)
    if (this.amount < other.amount) return -1
    if (this.amount > other.amount) return 1
    return 0
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) === 1
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0
  }

  lessThan(other: Money): boolean {
    return this.compare(other) === -1
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0
  }

  isZero(): boolean {
    return this.amount === 0n
  }

  isPositive(): boolean {
    return this.amount > 0n
  }

  isNegative(): boolean {
    return this.amount < 0n
  }

  /** The minor-unit amount as a decimal string — the wire format (ARCHITECTURE.md §12). */
  toWireString(): string {
    return this.amount.toString()
  }

  toJSON(): { amountMinor: string; currency: CurrencyCode } {
    return { amountMinor: this.toWireString(), currency: this.currency }
  }
}

function toBigIntStrict(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new NonIntegerAmountError(value)
    return BigInt(value)
  }
  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value)) throw new NonIntegerAmountError(value)
    return BigInt(value)
  }
  throw new NonIntegerAmountError(value)
}
