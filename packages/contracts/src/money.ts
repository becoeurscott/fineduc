/**
 * The money wire format (ARCHITECTURE.md §12).
 *
 * `amountMinor` is a STRING, deliberately. JSON numbers are IEEE-754
 * doubles: `JSON.parse` on a large integer silently loses precision above
 * 2^53, and `JSON.stringify(1n)` throws outright. A string round-trips
 * exactly through every client in every language, and forces the consumer
 * to go through `Money` rather than doing arithmetic on a raw number.
 *
 * AGENTS.md rule #1: XAF/XOF have ZERO decimals — `amountMinor` for XAF is
 * a count of francs, not centimes. Never divide it by 100.
 */
import { z } from 'zod'
import { Money, assertCurrencyCode, type CurrencyCode } from '@fineduc/money'

/**
 * Re-exported, not redeclared: packages/money owns the currency table, and
 * a second definition here could drift from it. Consumers of the API
 * contract shouldn't need to depend on the money package just for the type.
 */
export type { CurrencyCode }

export const CurrencyCodeSchema = z.enum(['XAF', 'XOF', 'NGN', 'GHS', 'USD', 'EUR'])

export const MoneySchema = z.object({
  amountMinor: z.string().regex(/^-?\d+$/, 'amountMinor must be an integer string'),
  currency: CurrencyCodeSchema,
})

export type MoneyWire = z.infer<typeof MoneySchema>

/** Wire → domain. The only sanctioned way to bring money in from an API response. */
export function toMoney(wire: MoneyWire): Money {
  return Money.of(wire.amountMinor, assertCurrencyCode(wire.currency))
}

/** Domain → wire. */
export function fromMoney(money: Money): MoneyWire {
  return { amountMinor: money.toWireString(), currency: money.currency as CurrencyCode }
}

/** Convenience for fixtures and tests. */
export function moneyWire(amountMinor: number | bigint | string, currency: CurrencyCode): MoneyWire {
  return { amountMinor: String(amountMinor), currency }
}
