/**
 * Design tokens, lifted from the FintechX Framer template mirrored in
 * `D:\mes site\fineduc` (PRD §8). Calm and financial, not edtech —
 * the buyer is a suspicious school director who needs to see a bank.
 *
 * The dashboard and the landing page share these so the marketing site
 * and the product don't drift apart.
 *
 * These are the JS-side values, used where a colour must be passed
 * programmatically (Recharts series, inline SVG). Everything else should
 * use the Tailwind classes generated from `theme.css`, which defines the
 * same palette as CSS custom properties.
 */
export const COLORS = {
  ink: '#1d1d1d',
  inkMuted: '#323232',
  surface: '#ffffff',
  canvas: '#edf1f4',
  border: '#dde5ed',
  slate: '#4d585f',
  slateMuted: '#bababa',

  accent: '#3b82f6',
  accentDeep: '#406ae4',
  accentSoft: '#e2f5ff',

  positive: '#10b981',
  positiveSoft: '#d1fae5',
  warning: '#ff8b06',
  warningSoft: '#fdbb6e',
  danger: '#f51c23',
  dangerSoft: '#f28778',
} as const

/**
 * Categorical series colours for charts. Ordered for maximum adjacent
 * contrast, and distinguishable in the most common forms of colour vision
 * deficiency — a director reading arrears on a phone in daylight should
 * never have to guess which band is which.
 */
export const CHART_SERIES = [
  COLORS.accent,
  COLORS.positive,
  COLORS.warning,
  COLORS.slate,
  COLORS.accentDeep,
  COLORS.dangerSoft,
] as const

/** Arrears ageing ramp: fresher debt cool, older debt hot. */
export const AGE_BUCKET_COLORS = {
  '0-30': COLORS.accent,
  '31-60': COLORS.warningSoft,
  '61-90': COLORS.warning,
  '90+': COLORS.danger,
} as const

export const PAYMENT_METHOD_COLORS = {
  mobile_money: COLORS.positive,
  cash: COLORS.warning,
  bank_transfer: COLORS.accent,
  cheque: COLORS.slate,
  card: COLORS.accentDeep,
  waiver: COLORS.slateMuted,
} as const
