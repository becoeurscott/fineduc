/**
 * Public surface of @fineduc/money. Nothing outside this package may
 * reimplement money arithmetic — see AGENTS.md rule #1.
 */
export { CURRENCIES, exponentOf, minorUnitsPerMajor, isCurrencyCode, assertCurrencyCode } from './currency.js'
export type { CurrencyCode } from './currency.js'

export { Money, CurrencyMismatchError, NonIntegerAmountError } from './money.js'

export { allocate, allocateEven, percentOfBp } from './allocate.js'

export { format } from './format.js'
export type { FormatOptions } from './format.js'
