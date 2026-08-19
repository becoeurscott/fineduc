import { describe, expect, it } from 'vitest'
import { assertCurrencyCode, exponentOf, isCurrencyCode, minorUnitsPerMajor } from './currency.js'

describe('currency table', () => {
  it('XAF and XOF have exponent 0 — no decimals, ever', () => {
    expect(exponentOf('XAF')).toBe(0)
    expect(exponentOf('XOF')).toBe(0)
    expect(minorUnitsPerMajor('XAF')).toBe(1n)
    expect(minorUnitsPerMajor('XOF')).toBe(1n)
  })

  it('USD/EUR/NGN/GHS have exponent 2', () => {
    for (const code of ['USD', 'EUR', 'NGN', 'GHS'] as const) {
      expect(exponentOf(code)).toBe(2)
      expect(minorUnitsPerMajor(code)).toBe(100n)
    }
  })

  it('isCurrencyCode narrows unknown strings', () => {
    expect(isCurrencyCode('XAF')).toBe(true)
    expect(isCurrencyCode('BTC')).toBe(false)
  })

  it('assertCurrencyCode throws on an unknown code', () => {
    expect(() => assertCurrencyCode('XAF')).not.toThrow()
    expect(() => assertCurrencyCode('BTC')).toThrow(RangeError)
  })
})
