/**
 * Chart palettes — VALIDATED, not eyeballed.
 *
 * Every palette below was run through the dataviz validator
 * (`validate_palette.js`) and passes all six checks against the light
 * surface, using `--pairs all` rather than `--pairs adjacent`: a donut
 * chart puts non-adjacent slices physically side by side, so adjacent-only
 * checking would miss the collisions that actually happen on screen.
 *
 * Two findings worth keeping, because they will otherwise be "fixed" back:
 *
 *  1. The brand slate `#4d585f` CANNOT be a categorical series colour —
 *     chroma 0.018 means it reads as gray. It stays a TEXT colour.
 *  2. Six chromatic hues could not clear all-pairs CVD separation. Rather
 *     than invent a 6th hue that fails for a deuteranopic reader, the
 *     method mix folds the long tail (cheque / card / waiver) into
 *     "Other" — four series, all passing. Cutting series is the correct
 *     fix here, not loosening the check.
 *
 * Residual: the categorical greens/ambers sit below 3:1 against the light
 * surface. The validator flags that as a WARN that is NOT dismissable — it
 * obligates visible labels or a table view. Both are provided: every chart
 * in this dashboard carries a value-bearing legend AND a "Voir les
 * données" table toggle. Do not remove them.
 *
 * Dark mode is deliberately NOT shipped. It requires its own steps
 * validated against the dark surface, not an automatic flip of these. The
 * candidate ramp is recorded in DARK_CANDIDATE below for whoever builds it.
 */

/**
 * Categorical identity. Fixed order — assign by position, NEVER cycle, and
 * never let a filter that changes the series count repaint the survivors
 * (colour follows the entity, not its rank).
 *
 * Validated: `#10b981,#ff8b06,#3b82f6,#e11d48` --mode light --pairs all
 *   Lightness band PASS · Chroma floor PASS · CVD separation PASS
 *   (worst all-pairs ΔE 9.8 protan) · Normal-vision floor PASS (ΔE 21.7)
 */
export const CHART_SERIES = ['#10b981', '#ff8b06', '#3b82f6', '#e11d48'] as const

/**
 * Payment-method mix. Semantic, not arbitrary: mobile money is the outcome
 * the product drives toward (positive green) and cash is the thing being
 * reduced (warning amber) — PRD §6 tracks exactly that shift.
 */
export const PAYMENT_METHOD_COLORS = {
  mobile_money: CHART_SERIES[0],
  cash: CHART_SERIES[1],
  bank_transfer: CHART_SERIES[2],
  other: CHART_SERIES[3],
} as const

export type MethodMixKey = keyof typeof PAYMENT_METHOD_COLORS

/** Methods folded into `other` — see the note above about cutting series. */
export const OTHER_METHODS = ['cheque', 'card', 'waiver'] as const

/**
 * Arrears ageing. This is ORDERED data, so it takes a sequential ramp —
 * one hue, monotone light→dark — not four categorical hues. Older debt
 * reads hotter and darker, which is the intuition a director already has.
 *
 * Validated: `#f87171,#dc2626,#b91c1c,#7f1d1d` --mode light --ordinal
 *   Lightness monotone PASS · Adjacent ΔL PASS (all gaps >= 0.06)
 *   Light-end contrast PASS (2.69:1) · Single hue PASS (spread 5°)
 */
export const AGE_BUCKET_COLORS = {
  '0-30': '#f87171',
  '31-60': '#dc2626',
  '61-90': '#b91c1c',
  '90+': '#7f1d1d',
} as const

/**
 * Reserved status colours. NEVER reused as "series 5" — a status colour
 * that also means a category destroys the signal. Always shipped with an
 * icon and a label, never colour alone.
 */
export const STATUS_COLORS = {
  good: '#10b981',
  warning: '#ff8b06',
  serious: '#e11d48',
  critical: '#991b1b',
} as const

/** Recessive chrome: grid lines and axes must never compete with the data. */
export const CHART_CHROME = {
  grid: '#dde5ed',
  axis: '#bababa',
  axisLabel: '#4d585f',
  surface: '#ffffff',
} as const

/**
 * Not in use — recorded so a future dark mode starts from validated steps
 * rather than a naive inversion.
 *   categorical: `#34d399,#f59e0b,#3b82f6,#f43f5e` (CVD + contrast PASS
 *                against #1d1d1d; lightness band marginal at 0.773)
 *   ageing:      `#b91c1c,#ef4444,#f87171,#fecaca` (ALL CHECKS PASS)
 */
export const DARK_CANDIDATE = {
  series: ['#34d399', '#f59e0b', '#3b82f6', '#f43f5e'],
  ageing: ['#b91c1c', '#ef4444', '#f87171', '#fecaca'],
} as const
