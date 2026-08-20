/**
 * The cash desk — the anti-leak control (ARCHITECTURE.md §8.4).
 *
 * A cashier opens a session with a counted float, takes payments against it,
 * then closes it by counting the drawer again. The system computes what
 * SHOULD be there; the difference is the variance, and a non-zero variance
 * cannot be closed silently.
 *
 * That is the entire control. Cash disappears from schools not through
 * dramatic theft but through a hundred small unexplained differences that
 * nobody was ever forced to write a reason against.
 */
import { Money, type CurrencyCode } from '@fineduc/money'
import { ConflictError, ValidationError } from '../shared/errors.js'

export type CashSessionStatus = 'open' | 'closed' | 'reconciled' | 'flagged'
export type CashMovementType = 'payment' | 'float_in' | 'float_out' | 'deposit_to_bank' | 'correction'

export interface CashMovement {
  readonly type: CashMovementType
  /** Signed: positive is money into the drawer, negative is money out. */
  readonly amountMinor: bigint
}

export interface CloseResult {
  readonly expectedMinor: bigint
  readonly declaredMinor: bigint
  /** declared − expected. Positive is a surplus, negative is a shortfall. */
  readonly varianceMinor: bigint
  readonly status: Extract<CashSessionStatus, 'closed' | 'flagged'>
}

/**
 * What the drawer should hold: the opening float plus every movement since.
 *
 * Movements are signed, so this is a plain sum — a `float_out` or a
 * `deposit_to_bank` arrives already negative. Storing the sign on the
 * movement rather than inferring it from the type means a correction can go
 * either way without a special case here.
 */
export function expectedClose(openingFloat: Money, movements: readonly CashMovement[]): Money {
  return Money.of(
    movements.reduce((total, movement) => total + movement.amountMinor, openingFloat.amount),
    openingFloat.currency,
  )
}

/**
 * Close the desk.
 *
 * A variance of zero closes cleanly. Anything else REQUIRES a written reason
 * and lands the session `flagged` for the director — never `closed`. The
 * cashier cannot choose which: passing a reason for a balanced drawer is
 * rejected too, because a reason attached to a zero variance is noise in the
 * one report a director actually reads.
 */
export function closeSession(params: {
  readonly openingFloat: Money
  readonly movements: readonly CashMovement[]
  readonly declared: Money
  readonly varianceReason?: string
}): CloseResult {
  const { openingFloat, movements, declared, varianceReason } = params

  if (declared.currency !== openingFloat.currency) {
    throw new ValidationError(
      'cash_currency_mismatch',
      `Declared ${declared.currency} against a ${openingFloat.currency} float. A tenant has exactly one currency.`,
    )
  }
  if (declared.amount < 0n) {
    throw new ValidationError('cash_declared_negative', 'A counted drawer cannot hold a negative amount.')
  }

  const expected = expectedClose(openingFloat, movements)
  const variance = declared.amount - expected.amount

  if (variance !== 0n) {
    const reason = varianceReason?.trim()
    if (!reason) {
      throw new ValidationError(
        'cash_variance_reason_required',
        `The drawer is off by ${variance}. A written reason is required before this session can be closed.`,
      )
    }
    return {
      expectedMinor: expected.amount,
      declaredMinor: declared.amount,
      varianceMinor: variance,
      status: 'flagged',
    }
  }

  if (varianceReason?.trim()) {
    throw new ValidationError(
      'cash_variance_reason_not_needed',
      'The drawer balances, so there is no variance to explain. Remove the reason.',
    )
  }

  return {
    expectedMinor: expected.amount,
    declaredMinor: declared.amount,
    varianceMinor: 0n,
    status: 'closed',
  }
}

/**
 * A session must be OPEN to take a payment.
 *
 * Once closed it is immutable — a later correction is a new movement in a
 * NEW session, reason-coded and audited. Backdating money into a session
 * whose drawer has already been counted would falsify the count that was
 * signed off.
 */
export function assertSessionOpen(session: { readonly id: string; readonly status: CashSessionStatus }): void {
  if (session.status !== 'open') {
    throw new ConflictError(
      'CASH_SESSION_NOT_OPEN',
      `Cash session ${session.id} is ${session.status}. Open a new session — a closed one is immutable.`,
    )
  }
}

/** Opening float must be a real, non-negative counted amount. */
export function assertValidFloat(openingFloat: Money): void {
  if (openingFloat.amount < 0n) {
    throw new ValidationError('cash_float_negative', 'The opening float cannot be negative.')
  }
}

/**
 * The movement a cash payment makes: money into the drawer, always positive.
 * Kept here rather than at the call site so the sign convention lives in one
 * place with the sum that depends on it.
 */
export function paymentMovement(amount: Money, reference: string): CashMovement & { readonly reference: string } {
  if (amount.amount <= 0n) {
    throw new ValidationError('cash_movement_not_positive', 'A cash payment movement must be positive.')
  }
  return { type: 'payment', amountMinor: amount.amount, reference }
}

/**
 * Receipt numbering is `YYYY-NNNNNN`, per tenant per year, and must be
 * GAPLESS — an auditor reads a missing number as a deleted receipt.
 *
 * This function only formats. The counter itself has to come from a row
 * locked FOR UPDATE in the same transaction; a Postgres sequence is wrong
 * here because sequences do not roll back, so an aborted transaction would
 * burn a number and leave exactly the gap this is avoiding.
 */
export function formatReceiptNumber(year: number, sequence: number, currency?: CurrencyCode): string {
  void currency
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new ValidationError('receipt_sequence_invalid', 'A receipt sequence must be a positive integer.')
  }
  return `${year}-${String(sequence).padStart(6, '0')}`
}
