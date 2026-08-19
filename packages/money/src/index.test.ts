import { describe, expect, it } from 'vitest'
import * as Pkg from './index.js'

describe('public surface', () => {
  it('exports everything a consumer needs, from one entrypoint', () => {
    expect(Pkg.Money).toBeDefined()
    expect(Pkg.allocate).toBeDefined()
    expect(Pkg.allocateEven).toBeDefined()
    expect(Pkg.percentOfBp).toBeDefined()
    expect(Pkg.format).toBeDefined()
    expect(Pkg.CURRENCIES).toBeDefined()
    expect(Pkg.exponentOf('XAF')).toBe(0)
    expect(Pkg.isCurrencyCode('XAF')).toBe(true)
    expect(() => Pkg.assertCurrencyCode('BTC')).toThrow()
    expect(Pkg.minorUnitsPerMajor('XAF')).toBe(1n)
    expect(Pkg.CurrencyMismatchError).toBeDefined()
    expect(Pkg.NonIntegerAmountError).toBeDefined()
  })

  it('a Money built through the public entrypoint behaves identically', () => {
    const m = Pkg.Money.of(45_000, 'XAF')
    expect(Pkg.format(m)).toContain('FCFA')
  })
})
