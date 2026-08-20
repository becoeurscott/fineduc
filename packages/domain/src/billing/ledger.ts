/**
 * The student ledger: the audit-grade truth of an account.
 *
 * APPEND-ONLY (AGENTS.md rule #2). Nothing in this file updates or deletes
 * an entry, and nothing downstream may either. A mistake is corrected by
 * posting a `reversal` that cancels it out, leaving both rows visible — an
 * auditor must be able to see that something was corrected, not just that
 * the number is now right.
 *
 * ## Sign convention
 *
 * The schema deliberately leaves this to the domain. The convention is:
 *
 *     amountMinor > 0  increases what the student OWES
 *     amountMinor < 0  reduces it
 *
 * so `balanceAfterMinor` is always "what is still owed", the same quantity
 * as `invoice.balanceMinor`, and a positive balance always means money is
 * outstanding. Reading a statement, every charge pushes the balance up and
 * every payment pulls it down, which is what a bursar expects.
 */
import { Money, type CurrencyCode } from '@fineduc/money'
import { ValidationError } from '../shared/errors.js'

export type LedgerEntryType =
  | 'charge'
  | 'payment'
  | 'discount'
  | 'adjustment'
  | 'refund'
  | 'reversal'
  | 'carry_forward'

export interface LedgerEntryDraft {
  readonly entryType: LedgerEntryType
  /** Signed, per the convention above. */
  readonly amountMinor: bigint
  readonly balanceAfterMinor: bigint
  readonly sourceType: string
  readonly sourceId: string
  readonly occurredOn: string
  readonly invoiceId?: string
  readonly instalmentId?: string
  readonly memo?: string
}

export interface LedgerPosting {
  readonly entryType: LedgerEntryType
  /** Always a MAGNITUDE. The sign is this module's job, not the caller's. */
  readonly amount: Money
  readonly sourceType: string
  readonly sourceId: string
  readonly occurredOn: string
  readonly invoiceId?: string
  readonly instalmentId?: string
  readonly memo?: string
}

/**
 * Which way each entry type moves the balance.
 *
 * `refund` is +1 and that surprises people: giving money back to a family
 * restores the debt that the original payment cleared, so from the school's
 * side the student owes it again.
 *
 * `adjustment` and `reversal` are omitted — they can go either way, so the
 * caller must state the direction explicitly and cannot get it by default.
 */
const DIRECTION: Partial<Record<LedgerEntryType, 1n | -1n>> = {
  charge: 1n,
  carry_forward: 1n,
  refund: 1n,
  payment: -1n,
  discount: -1n,
}

/**
 * Sign one posting and compute the balance it leaves behind.
 *
 * `direction` is required for `adjustment` and `reversal`, and rejected for
 * every other type — a caller that could override the sign of a `payment`
 * would eventually do it by accident.
 */
export function post(
  opening: Money,
  posting: LedgerPosting,
  direction?: 1 | -1,
): { readonly entry: LedgerEntryDraft; readonly balance: Money } {
  if (posting.amount.amount < 0n) {
    throw new ValidationError(
      'ledger_amount_negative',
      'Post a ledger entry with a positive magnitude; the entry type decides the sign.',
    )
  }
  if (posting.amount.currency !== opening.currency) {
    throw new ValidationError(
      'ledger_currency_mismatch',
      `Cannot post ${posting.amount.currency} to a ${opening.currency} ledger. A tenant has exactly one currency.`,
    )
  }

  const needsDirection = posting.entryType === 'adjustment' || posting.entryType === 'reversal'
  if (needsDirection && direction === undefined) {
    throw new ValidationError(
      'ledger_direction_required',
      `A ${posting.entryType} can move the balance either way, so its direction must be stated explicitly.`,
    )
  }
  if (!needsDirection && direction !== undefined) {
    throw new ValidationError(
      'ledger_direction_not_allowed',
      `The direction of a ${posting.entryType} is fixed by its type and cannot be overridden.`,
    )
  }

  const sign = needsDirection ? BigInt(direction as number) : (DIRECTION[posting.entryType] as 1n | -1n)
  const signed = posting.amount.amount * sign
  const balance = Money.of(opening.amount + signed, opening.currency)

  return {
    entry: {
      entryType: posting.entryType,
      amountMinor: signed,
      balanceAfterMinor: balance.amount,
      sourceType: posting.sourceType,
      sourceId: posting.sourceId,
      occurredOn: posting.occurredOn,
      invoiceId: posting.invoiceId,
      instalmentId: posting.instalmentId,
      memo: posting.memo,
    },
    balance,
  }
}

/**
 * Post a run of entries in order, carrying the balance forward.
 *
 * The order given is the order posted — a ledger is a sequence, and sorting
 * it here would rewrite history to look tidier than it was.
 */
export function postAll(
  opening: Money,
  postings: readonly (LedgerPosting & { readonly direction?: 1 | -1 })[],
): { readonly entries: LedgerEntryDraft[]; readonly balance: Money } {
  let balance = opening
  const entries: LedgerEntryDraft[] = []

  for (const posting of postings) {
    const result = post(balance, posting, posting.direction)
    entries.push(result.entry)
    balance = result.balance
  }

  return { entries, balance }
}

/**
 * Reverse an existing entry: same magnitude, opposite sign, both rows kept.
 *
 * This is the ONLY correction mechanism. It is not a delete with extra
 * steps — the original stays on the statement, and the reversal names it.
 */
export function reverse(
  opening: Money,
  original: Pick<LedgerEntryDraft, 'amountMinor' | 'invoiceId' | 'instalmentId'>,
  context: { readonly sourceType: string; readonly sourceId: string; readonly occurredOn: string; readonly memo?: string },
): { readonly entry: LedgerEntryDraft; readonly balance: Money } {
  if (original.amountMinor === 0n) {
    throw new ValidationError('ledger_reverse_zero', 'There is nothing to reverse in a zero-amount entry.')
  }
  const magnitude = original.amountMinor < 0n ? -original.amountMinor : original.amountMinor
  const direction: 1 | -1 = original.amountMinor > 0n ? -1 : 1

  return post(
    opening,
    {
      entryType: 'reversal',
      amount: Money.of(magnitude, opening.currency),
      sourceType: context.sourceType,
      sourceId: context.sourceId,
      occurredOn: context.occurredOn,
      invoiceId: original.invoiceId,
      instalmentId: original.instalmentId,
      memo: context.memo,
    },
    direction,
  )
}

/**
 * Recompute a balance from entries. This is what the nightly integrity
 * sweep compares against the stored projection (AGENTS.md rule #3, and the
 * first of ARCHITECTURE's "five things most likely to break").
 */
export function replayBalance(
  entries: readonly Pick<LedgerEntryDraft, 'amountMinor'>[],
  currency: CurrencyCode,
  opening: bigint = 0n,
): Money {
  return Money.of(
    entries.reduce((balance, entry) => balance + entry.amountMinor, opening),
    currency,
  )
}

/**
 * Check a ledger's own internal consistency: every `balanceAfterMinor` must
 * equal the running total up to and including that entry. A mismatch means
 * an entry was written outside the balance-carrying path, which is exactly
 * the drift the sweep exists to catch.
 */
export function assertLedgerConsistent(
  entries: readonly Pick<LedgerEntryDraft, 'amountMinor' | 'balanceAfterMinor'>[],
  opening: bigint = 0n,
): void {
  let running = opening
  entries.forEach((entry, index) => {
    running += entry.amountMinor
    if (entry.balanceAfterMinor !== running) {
      throw new ValidationError(
        'ledger_balance_drift',
        `Ledger entry ${index} records a balance of ${entry.balanceAfterMinor} but the entries before it sum to ${running}.`,
      )
    }
  })
}

/**
 * The invoice projections (`paidMinor`, `balanceMinor`) derived from what
 * has actually been allocated. Written only in the same transaction as the
 * ledger entry that changed them (AGENTS.md rule #3).
 */
export function projectInvoice(
  netMinor: bigint,
  allocatedMinor: bigint,
): { readonly paidMinor: bigint; readonly balanceMinor: bigint; readonly status: 'open' | 'partial' | 'paid' } {
  if (allocatedMinor < 0n) {
    throw new ValidationError('invoice_allocated_negative', 'Allocated amount cannot be negative.')
  }
  const balance = netMinor - allocatedMinor
  const status = allocatedMinor === 0n ? 'open' : balance <= 0n ? 'paid' : 'partial'
  return { paidMinor: allocatedMinor, balanceMinor: balance, status }
}
