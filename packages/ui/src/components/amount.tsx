import { Money, format, type CurrencyCode } from '@fineduc/money'
import clsx from 'clsx'

/**
 * The ONLY way money is rendered in this product.
 *
 * Takes the wire shape (`{ amountMinor: string, currency }`) and formats it
 * through `packages/money` — never through local string manipulation.
 * AGENTS.md rule #1: XAF/XOF have zero decimals, and a component that
 * "helpfully" divided by 100 would corrupt every figure on the screen.
 */
export interface AmountProps {
  value: { amountMinor: string; currency: string }
  locale?: string
  /** Colour by sign: credits green, debits red. Off by default — most figures are neutral. */
  signed?: boolean
  /** Emphasise as a headline figure. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const SIZE_CLASS = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl font-semibold',
  // Steps up with the viewport: at 360px a headline figure shares the row
  // with a second stat tile, and 30px would break "345 000 FCFA" across
  // two lines. Prominence matters, but not at the cost of a split number.
  xl: 'text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight',
} as const

export function Amount({ value, locale = 'fr-CM', signed = false, size = 'md', className }: AmountProps) {
  const money = Money.of(value.amountMinor, value.currency as CurrencyCode)
  const rendered = format(money, { locale })

  return (
    <span
      className={clsx(
        SIZE_CLASS[size],
        signed && money.isPositive() && 'text-positive',
        signed && money.isNegative() && 'text-danger',
        className,
      )}
      // The grouped digits read as separate words to a screen reader
      // otherwise ("45", "000"); this keeps it a single spoken figure.
      aria-label={rendered.replace(/\s/g, ' ')}
    >
      {signed && money.isPositive() ? '+' : ''}
      {rendered}
    </span>
  )
}
