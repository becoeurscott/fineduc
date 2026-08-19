/**
 * Currency table with an EXPLICIT exponent (ISO 4217 minor-unit digits).
 *
 * XAF and XOF are exponent 0: there are no centimes. One minor unit IS one
 * franc. Every other package in this repo must read the exponent from here
 * rather than assuming 2 — that assumption is the single most common way to
 * corrupt a West/Central African money value.
 *
 * ARCHITECTURE.md §5.
 */

export const CURRENCIES = {
  XAF: { exponent: 0, symbol: 'FCFA', name: 'Franc CFA (BEAC)' },
  XOF: { exponent: 0, symbol: 'FCFA', name: 'Franc CFA (BCEAO)' },
  NGN: { exponent: 2, symbol: '₦', name: 'Nigerian Naira' },
  GHS: { exponent: 2, symbol: 'GH₵', name: 'Ghanaian Cedi' },
  USD: { exponent: 2, symbol: '$', name: 'US Dollar' },
  EUR: { exponent: 2, symbol: '€', name: 'Euro' },
} as const satisfies Record<string, { exponent: number; symbol: string; name: string }>

export type CurrencyCode = keyof typeof CURRENCIES

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCIES, value)
}

export function exponentOf(currency: CurrencyCode): number {
  return CURRENCIES[currency].exponent
}

/** 10^exponent, as a bigint — the number of minor units in one major unit. */
export function minorUnitsPerMajor(currency: CurrencyCode): bigint {
  return 10n ** BigInt(exponentOf(currency))
}

export function assertCurrencyCode(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new RangeError(`Unknown currency code: "${value}"`)
  }
  return value
}
