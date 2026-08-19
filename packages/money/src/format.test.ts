import { describe, expect, it } from 'vitest'
import { format } from './format.js'
import { Money } from './money.js'

// Intl's fr-CM grouping separator is U+202F (narrow no-break space), not a
// plain space — assertions below normalise whitespace rather than hard-code
// an invisible character, so they don't break on an ICU data update.
const collapseWhitespace = (s: string) => s.replace(/\s+/g, ' ')

describe('format', () => {
  it('renders XAF with zero decimals and a grouped thousands separator', () => {
    expect(collapseWhitespace(format(Money.of(45_000, 'XAF')))).toBe('45 000 FCFA')
  })

  it('renders a two-decimal currency, converting minor units to major', () => {
    // 1 250 minor units of USD (cents) is $12.50, not $1,250.00.
    expect(format(Money.of(1_250, 'USD'), { locale: 'en-US' })).toBe('12.50 $')
  })

  it('renders a large two-decimal amount with thousands grouping', () => {
    expect(format(Money.of(125_000, 'USD'), { locale: 'en-US' })).toBe('1,250.00 $')
  })

  it('can omit the currency symbol', () => {
    expect(collapseWhitespace(format(Money.of(45_000, 'XAF'), { withCurrency: false }))).toBe('45 000')
  })

  it('never introduces a decimal point for a zero-exponent currency', () => {
    expect(format(Money.of(1, 'XAF'))).not.toContain('.')
  })
})
