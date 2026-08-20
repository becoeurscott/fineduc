/**
 * The payment lifecycle (ARCHITECTURE.md §6 "Payments").
 *
 * Written as an explicit transition table rather than scattered `if` checks
 * because the illegal moves are the interesting ones: a `succeeded` payment
 * must never slide back to `failed` on a late webhook, and a `failed` one
 * must never quietly become `succeeded` without going through the provider
 * again. An aggregator that retries a callback out of order — which they all
 * do — would otherwise flip settled money.
 */
import { InvalidStateError } from '../shared/errors.js'

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'partially_refunded'

export type PaymentMethod = 'mobile_money' | 'cash' | 'bank_transfer' | 'cheque' | 'card' | 'waiver'

/**
 * Allowed transitions.
 *
 * `succeeded` leads only to the refund states: money that has settled can be
 * given back, but it cannot un-happen. `failed`, `cancelled` and `expired`
 * are dead ends — a payer who tries again produces a NEW payment with a new
 * idempotency key, so both attempts stay on the record.
 */
const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
  processing: ['succeeded', 'failed', 'expired'],
  succeeded: ['refunded', 'partially_refunded'],
  partially_refunded: ['refunded', 'partially_refunded'],
  failed: [],
  cancelled: [],
  expired: [],
  refunded: [],
}

/** States from which nothing further can happen. */
export const TERMINAL: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'failed',
  'cancelled',
  'expired',
  'refunded',
])

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (from === to) {
    // Not an error: an aggregator redelivering "succeeded" for an already
    // succeeded payment is the normal case, and the caller treats it as a
    // no-op. Saying so here keeps that decision out of every call site.
    return
  }
  if (!canTransition(from, to)) {
    throw new InvalidStateError(
      'PAYMENT_TRANSITION_INVALID',
      `A payment cannot go from ${from} to ${to}.${TERMINAL.has(from) ? ` ${from} is terminal.` : ''}`,
    )
  }
}

/** Has this payment's money actually landed? */
export function isSettled(status: PaymentStatus): boolean {
  return status === 'succeeded' || status === 'partially_refunded'
}

/**
 * Cash and waivers settle the instant they are recorded — there is no
 * provider to wait for, the money is already in the drawer or the debt is
 * already forgiven. Everything else starts `pending` and waits for a
 * webhook, because the browser redirect is only a hint (AGENTS.md rule #6).
 */
export function initialStatus(method: PaymentMethod): PaymentStatus {
  return method === 'cash' || method === 'waiver' ? 'succeeded' : 'pending'
}

/**
 * Where a payment lands after a refund, given how much of it went back.
 * Refunding the last franc makes it fully `refunded`; anything less leaves
 * it `partially_refunded`, which can still be refunded again.
 */
export function statusAfterRefund(paidMinor: bigint, refundedTotalMinor: bigint): PaymentStatus {
  if (refundedTotalMinor <= 0n) {
    throw new InvalidStateError('REFUND_NOT_POSITIVE', 'A refund must be a positive amount.')
  }
  if (refundedTotalMinor > paidMinor) {
    throw new InvalidStateError(
      'REFUND_EXCEEDS_PAYMENT',
      `Refunds total ${refundedTotalMinor}, more than the ${paidMinor} that was paid.`,
    )
  }
  return refundedTotalMinor === paidMinor ? 'refunded' : 'partially_refunded'
}
