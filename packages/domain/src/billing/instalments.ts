/**
 * Expanding an instalment plan into the dated tranches a family actually
 * pays — and the unit every reminder and every payment hangs off.
 *
 * Two rules govern this file and neither bends:
 *
 *  1. **INVARIANT: `sum(instalment.amountMinor) === invoice.netMinor`.**
 *     Checked here, and again inside the enrolment transaction. If a split
 *     can lose one franc, then over a year of a 400-student school it loses
 *     hundreds, and the ledger stops reconciling.
 *  2. **`dueOn` is a calendar DATE in the tenant's timezone** (AGENTS.md
 *     rule #9). Offsets are added in whole days on the calendar, never by
 *     adding milliseconds to a timestamp, which drifts across a DST change
 *     and lands a "1st of the month" tranche on the 31st.
 */
import { Money, allocate } from '@fineduc/money'
import { ValidationError } from '../shared/errors.js'
import { parseTenantDate } from '../shared/tenant-date.js'

export type InstalmentStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'waived' | 'cancelled'

export interface InstalmentTemplate {
  readonly sequence: number
  readonly label: string
  /** Days after the anchor date. Mutually exclusive with `dueOn`. */
  readonly dueOffsetDays?: number | null
  /** A fixed calendar date, YYYY-MM-DD. Mutually exclusive with `dueOffsetDays`. */
  readonly dueOn?: string | null
  /** Share of the net, in basis points. Mutually exclusive with `amountMinor`. */
  readonly percentBp?: number | null
  /** A fixed minor amount. Mutually exclusive with `percentBp`. */
  readonly amountMinor?: bigint | null
}

export interface InstalmentDraft {
  readonly sequence: number
  readonly label: string
  readonly dueOn: string
  readonly amountMinor: bigint
  readonly status: InstalmentStatus
}

/** 100% in basis points. */
const FULL_BP = 10_000

/**
 * Add whole days to a YYYY-MM-DD calendar date, staying on the calendar.
 *
 * Uses UTC arithmetic on a date-only value deliberately: a UTC midnight has
 * no DST, so "+30 days" is exactly 30 calendar days. The result is formatted
 * back to YYYY-MM-DD and never becomes a timestamp anyone could localise.
 */
export function addCalendarDays(date: string, days: number): string {
  const { year, month, day } = parseTenantDate(date)
  if (!Number.isInteger(days)) {
    throw new ValidationError('due_offset_not_integer', `Due offset must be a whole number of days, got ${days}.`)
  }
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

/**
 * Expand templates into instalments summing EXACTLY to `net`.
 *
 * Amounts resolve in two passes. Templates with a fixed `amountMinor` are
 * honoured as written; whatever is left over is split across the percentage
 * templates by largest remainder, so the rounding crumbs land somewhere
 * deterministic instead of vanishing. A plan of pure percentages that does
 * not total 100% is rejected rather than quietly normalised — a plan adding
 * to 90% is a typo, and inferring intent from it would bill the family 10%
 * short all year.
 */
export function expandInstalments(
  templates: readonly InstalmentTemplate[],
  net: Money,
  options: { readonly anchorDate: string },
): InstalmentDraft[] {
  if (templates.length === 0) {
    throw new ValidationError('instalment_plan_empty', 'An instalment plan must contain at least one template.')
  }
  if (net.amount <= 0n) {
    throw new ValidationError('instalment_net_not_positive', 'Instalments can only be expanded from a positive net amount.')
  }

  const ordered = [...templates].sort((a, b) => a.sequence - b.sequence)
  assertTemplatesWellFormed(ordered)

  const fixedTotal = ordered.reduce((sum, t) => sum + (t.amountMinor ?? 0n), 0n)
  if (fixedTotal > net.amount) {
    throw new ValidationError(
      'instalment_fixed_exceeds_net',
      `Fixed instalments total ${fixedTotal}, which is more than the net ${net.amount} they must fit inside.`,
    )
  }

  const percentTemplates = ordered.filter((t) => t.percentBp != null)
  const remainder = net.amount - fixedTotal

  if (percentTemplates.length === 0 && remainder !== 0n) {
    throw new ValidationError(
      'instalment_fixed_short_of_net',
      `Fixed instalments total ${fixedTotal} but the net is ${net.amount}. Add a percentage instalment to absorb the difference.`,
    )
  }

  const amountBySequence = new Map<number, bigint>()
  if (percentTemplates.length > 0) {
    const totalBp = percentTemplates.reduce((sum, t) => sum + (t.percentBp as number), 0)
    // Only meaningful when percentages carry the whole invoice; mixed plans
    // treat them as weights over whatever the fixed tranches left behind.
    if (fixedTotal === 0n && totalBp !== FULL_BP) {
      throw new ValidationError(
        'instalment_percentages_not_100',
        `Instalment percentages total ${totalBp} basis points; they must total exactly ${FULL_BP} (100%).`,
      )
    }
    const shares = allocate(
      Money.of(remainder, net.currency),
      percentTemplates.map((t) => t.percentBp as number),
    )
    percentTemplates.forEach((template, i) => {
      amountBySequence.set(template.sequence, (shares[i] as Money).amount)
    })
  }

  const drafts = ordered.map((template) => ({
    sequence: template.sequence,
    label: template.label,
    dueOn: template.dueOn ?? addCalendarDays(options.anchorDate, template.dueOffsetDays as number),
    amountMinor: template.amountMinor ?? (amountBySequence.get(template.sequence) as bigint),
    status: 'pending' as const,
  }))

  assertInstalmentsCoverNet(drafts, net)
  return drafts
}

function assertTemplatesWellFormed(templates: readonly InstalmentTemplate[]): void {
  const seen = new Set<number>()
  for (const template of templates) {
    if (seen.has(template.sequence)) {
      throw new ValidationError('instalment_sequence_duplicate', `Duplicate instalment sequence ${template.sequence}.`)
    }
    seen.add(template.sequence)

    const hasAmount = template.amountMinor != null
    const hasPercent = template.percentBp != null
    if (hasAmount === hasPercent) {
      throw new ValidationError(
        'instalment_template_amount_ambiguous',
        `Instalment template "${template.label}" must set exactly one of amountMinor or percentBp.`,
      )
    }
    if (hasAmount && (template.amountMinor as bigint) <= 0n) {
      throw new ValidationError(
        'instalment_template_amount_not_positive',
        `Instalment "${template.label}" must be a positive amount.`,
      )
    }
    if (hasPercent && (template.percentBp as number) <= 0) {
      throw new ValidationError(
        'instalment_template_percent_not_positive',
        `Instalment "${template.label}" must be a positive percentage.`,
      )
    }
    if ((template.dueOffsetDays == null) === (template.dueOn == null)) {
      throw new ValidationError(
        'instalment_template_due_ambiguous',
        `Instalment template "${template.label}" must set exactly one of dueOffsetDays or dueOn.`,
      )
    }
  }
}

/**
 * The invariant, exported on its own so the service layer can re-assert it
 * inside the enrolment transaction rather than trusting that nothing was
 * mutated between expansion and commit.
 */
export function assertInstalmentsCoverNet(
  instalments: readonly { readonly amountMinor: bigint }[],
  net: Money,
): void {
  const total = instalments.reduce((sum, i) => sum + i.amountMinor, 0n)
  if (total !== net.amount) {
    throw new ValidationError(
      'instalment_sum_mismatch',
      `Instalments total ${total} but the invoice net is ${net.amount}. They must be equal (ARCHITECTURE.md §8.1).`,
    )
  }
}

/**
 * Status of an instalment given what has been allocated to it and what day
 * it is. `overdue` is DERIVED, never stored as a fact — an instalment
 * becomes overdue by the passage of time, and a stored flag would need a
 * nightly job just to stay honest.
 *
 * `waived` and `cancelled` are decisions a human made; they are terminal and
 * never recomputed away.
 */
export function instalmentStatus(
  instalment: {
    readonly amountMinor: bigint
    readonly allocatedMinor: bigint
    readonly dueOn: string
    readonly status?: InstalmentStatus
  },
  today: string,
): InstalmentStatus {
  if (instalment.status === 'waived' || instalment.status === 'cancelled') {
    return instalment.status
  }
  if (instalment.allocatedMinor >= instalment.amountMinor) return 'paid'
  if (instalment.dueOn < today) return 'overdue'
  if (instalment.allocatedMinor > 0n) return 'partial'
  return 'pending'
}

/**
 * Oldest-due-first ordering, the allocation order for every payment
 * (ARCHITECTURE.md §8.2). Sequence breaks a date tie so the result is
 * stable: two tranches falling on the same day must always fill in the same
 * order, or two replays of one payment could allocate differently.
 */
export function byOldestDue<T extends { readonly dueOn: string; readonly sequence: number }>(
  instalments: readonly T[],
): T[] {
  return [...instalments].sort((a, b) =>
    a.dueOn === b.dueOn ? a.sequence - b.sequence : a.dueOn < b.dueOn ? -1 : 1,
  )
}
