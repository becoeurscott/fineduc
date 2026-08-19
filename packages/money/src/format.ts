/**
 * Presentation only. Nothing here performs arithmetic — format() must never
 * become a place where a rounding decision quietly happens.
 *
 * Renders the number with Intl (for locale-correct grouping/spacing) and
 * appends our own symbol table from currency.ts, rather than trusting a
 * runtime's ICU currency-display data — which is exactly the kind of
 * externally-controlled behaviour that could silently start showing two
 * decimals on an XAF amount after a Node/ICU upgrade.
 */
import { CURRENCIES, exponentOf, minorUnitsPerMajor } from './currency.js'
import type { Money } from './money.js'

export interface FormatOptions {
  /** BCP 47 locale, e.g. "fr-CM", "en-NG". Defaults to "fr-CM". */
  locale?: string
  /** Show the currency symbol. Defaults to true. */
  withCurrency?: boolean
}

/**
 * Render a Money as a human string, e.g. `format(Money.of(45000, "XAF"))`
 * → "45 000 FCFA" under the fr-CM default.
 *
 * NOTE: converts to a JS `number` for Intl.NumberFormat, which is exact for
 * any amount up to 2^53 minor units. School fees never approach that; a
 * bigint-precision formatter would be over-engineering for this product.
 */
export function format(money: Money, options: FormatOptions = {}): string {
  const { locale = 'fr-CM', withCurrency = true } = options
  const exponent = exponentOf(money.currency)
  const majorValue = Number(money.amount) / Number(minorUnitsPerMajor(money.currency))

  const number = new Intl.NumberFormat(locale, {
    style: 'decimal',
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(majorValue)

  return withCurrency ? `${number} ${CURRENCIES[money.currency].symbol}` : number
}
