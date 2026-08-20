/**
 * The grille tarifaire: what a grade level costs for an academic year.
 *
 * A schedule is VERSIONED and immutable once published (ARCHITECTURE.md §6).
 * That is not bureaucracy — an invoice raised in September must still be
 * explainable in June, and it cannot be if the prices behind it were edited
 * in between. Changing a published price means a new version; correcting an
 * invoice already raised against the old one means an `adjustment` row.
 */
import { Money, type CurrencyCode } from '@fineduc/money'
import { ConflictError, ValidationError } from '../shared/errors.js'

export type FeeCategory =
  | 'tuition'
  | 'registration'
  | 'exam'
  | 'canteen'
  | 'transport'
  | 'uniform'
  | 'boarding'
  | 'other'

export type FeeScheduleStatus = 'draft' | 'published' | 'archived'

export interface FeeItem {
  readonly id: string
  readonly code: string
  readonly label: string
  readonly category: FeeCategory
  readonly amountMinor: bigint
  /** Mandatory items are billed to every student; optional ones only when chosen. */
  readonly isMandatory: boolean
  readonly isRecurring: boolean
  readonly sequence: number
}

export interface FeeSchedule {
  readonly id: string
  readonly status: FeeScheduleStatus
  readonly version: number
  readonly items: readonly FeeItem[]
}

/** A line as it will be persisted, before any discount is applied. */
export interface InvoiceLineDraft {
  readonly feeItemId: string
  readonly label: string
  readonly amountMinor: bigint
  readonly quantity: number
}

/**
 * The schedule's headline total: every MANDATORY item, once each.
 *
 * Optional items are deliberately excluded — canteen and transport are
 * chosen per student, and folding them into the advertised total would
 * overstate the price of the school to every family that does not take them.
 */
export function computeScheduleTotal(items: readonly FeeItem[], currency: CurrencyCode): Money {
  return items
    .filter((item) => item.isMandatory)
    .reduce((total, item) => total.add(Money.of(item.amountMinor, currency)), Money.zero(currency))
}

/**
 * Only a draft may be edited. Publishing is the point of no return, and
 * archiving does not reopen it.
 */
export function assertEditable(schedule: Pick<FeeSchedule, 'status' | 'id'>): void {
  if (schedule.status !== 'draft') {
    throw new ConflictError(
      'fee_schedule_not_editable',
      `Fee schedule ${schedule.id} is ${schedule.status}; only a draft can be edited. Publish a new version instead.`,
    )
  }
}

/**
 * A schedule must be worth invoicing before it can be published. An empty
 * or all-zero schedule would raise invoices for nothing and start a
 * reminder cycle chasing a balance of zero.
 */
export function assertPublishable(items: readonly FeeItem[], currency: CurrencyCode): void {
  const mandatory = items.filter((item) => item.isMandatory)
  if (mandatory.length === 0) {
    throw new ValidationError('fee_schedule_empty', 'A fee schedule needs at least one mandatory fee item before it can be published.')
  }
  if (items.some((item) => item.amountMinor < 0n)) {
    throw new ValidationError('fee_item_negative', 'A fee item cannot be negative. Use a discount or an adjustment instead.')
  }
  if (computeScheduleTotal(items, currency).amount <= 0n) {
    throw new ValidationError('fee_schedule_zero_total', 'A published fee schedule must total more than zero.')
  }

  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.code)) {
      throw new ValidationError('fee_item_duplicate_code', `Duplicate fee item code "${item.code}" in this schedule.`)
    }
    seen.add(item.code)
  }
}

/**
 * Turn a schedule into the lines of one student's invoice.
 *
 * `optionalCodes` names the optional items this particular student takes
 * (canteen, bus). An unknown code is an error rather than a silent skip:
 * quietly dropping it would under-bill the family and nobody would notice
 * until the year-end reconciliation.
 */
export function buildInvoiceLines(
  schedule: FeeSchedule,
  options: { readonly optionalCodes?: readonly string[] } = {},
): InvoiceLineDraft[] {
  if (schedule.status !== 'published') {
    throw new ConflictError(
      'fee_schedule_not_published',
      `Fee schedule ${schedule.id} is ${schedule.status}; only a published schedule can be invoiced.`,
    )
  }

  const chosen = new Set(options.optionalCodes ?? [])
  const byCode = new Map(schedule.items.map((item) => [item.code, item]))
  for (const code of chosen) {
    const item = byCode.get(code)
    if (!item) {
      throw new ValidationError('fee_item_unknown', `Fee item "${code}" is not in fee schedule ${schedule.id}.`)
    }
    if (item.isMandatory) {
      throw new ValidationError(
        'fee_item_already_mandatory',
        `Fee item "${code}" is mandatory and is billed automatically; it cannot be selected as an option.`,
      )
    }
  }

  return [...schedule.items]
    .filter((item) => item.isMandatory || chosen.has(item.code))
    .sort((a, b) => a.sequence - b.sequence)
    .map((item) => ({
      feeItemId: item.id,
      label: item.label,
      amountMinor: item.amountMinor,
      quantity: 1,
    }))
}

/** Gross total of a set of drafted lines — quantity included. */
export function sumLines(lines: readonly InvoiceLineDraft[], currency: CurrencyCode): Money {
  return lines.reduce(
    (total, line) => total.add(Money.of(line.amountMinor, currency).multiply(line.quantity)),
    Money.zero(currency),
  )
}
