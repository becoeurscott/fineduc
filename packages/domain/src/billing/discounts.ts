/**
 * Discounts: sibling, staff, merit, hardship, commercial.
 *
 * The rule that matters (ARCHITECTURE.md §5): a percentage is resolved to an
 * INTEGER minor amount once, at the moment it is granted, and that integer
 * is what is stored and what every later calculation uses. The percentage is
 * never re-applied. Re-deriving it later against a changed base is how a
 * family ends up owing a different number in June than the one they were
 * quoted in September.
 */
import { Money, percentOfBp } from '@fineduc/money'
import { ValidationError } from '../shared/errors.js'

export type DiscountType = 'sibling' | 'staff' | 'merit' | 'hardship' | 'commercial'
export type DiscountMethod = 'percent' | 'fixed'

export interface DiscountRequest {
  readonly type: DiscountType
  readonly method: DiscountMethod
  /** Basis points when method=percent (1 000 bp = 10%), else minor units. */
  readonly value: bigint
  readonly reason?: string
  /** Scope: omit to discount the whole invoice. */
  readonly invoiceLineId?: string
}

export interface DiscountDraft {
  readonly type: DiscountType
  readonly method: DiscountMethod
  readonly value: bigint
  /** The resolved integer. This is the number that counts, forever. */
  readonly amountMinor: bigint
  readonly reason?: string
  readonly invoiceLineId?: string
}

/** 100% in basis points. */
const FULL_BP = 10_000n

/**
 * Resolve one discount against a base amount.
 *
 * A percent discount rounds HALF-UP to the minor unit via `percentOfBp`; a
 * fixed discount is taken as given. Either way the result is capped at the
 * base — a discount may take a charge to zero but never below it, because a
 * negative charge is a refund and must be recorded as one.
 */
export function resolveDiscount(request: DiscountRequest, base: Money): DiscountDraft {
  if (request.value < 0n) {
    throw new ValidationError('discount_negative', 'A discount value cannot be negative.')
  }
  if (base.amount < 0n) {
    throw new ValidationError('discount_base_negative', 'A discount cannot be applied to a negative base amount.')
  }

  let amount: Money
  if (request.method === 'percent') {
    if (request.value > FULL_BP) {
      throw new ValidationError('discount_over_100_percent', 'A percentage discount cannot exceed 100% (10 000 basis points).')
    }
    amount = percentOfBp(base, request.value)
  } else {
    amount = Money.of(request.value, base.currency)
  }

  if (amount.greaterThan(base)) {
    throw new ValidationError(
      'discount_exceeds_base',
      `Discount of ${amount.amount} exceeds the ${base.amount} it applies to. A charge cannot be discounted below zero.`,
    )
  }

  return {
    type: request.type,
    method: request.method,
    value: request.value,
    amountMinor: amount.amount,
    reason: request.reason,
    invoiceLineId: request.invoiceLineId,
  }
}

/**
 * Resolve a stack of discounts against one base.
 *
 * They are applied SEQUENTIALLY, each against the balance remaining after
 * the previous — not all against the original. Two 50% discounts therefore
 * total 75%, not 100%, which is what a bursar means by "half off, and then
 * half off that". Order is the caller's, and it is significant, so it is
 * preserved rather than sorted.
 */
export function resolveDiscountStack(
  requests: readonly DiscountRequest[],
  base: Money,
): { readonly discounts: DiscountDraft[]; readonly totalMinor: bigint; readonly netMinor: bigint } {
  let remaining = base
  const discounts: DiscountDraft[] = []

  for (const request of requests) {
    const draft = resolveDiscount(request, remaining)
    discounts.push(draft)
    remaining = remaining.subtract(Money.of(draft.amountMinor, base.currency))
  }

  return {
    discounts,
    totalMinor: base.amount - remaining.amount,
    netMinor: remaining.amount,
  }
}

/**
 * The one discount the system grants by itself (ARCHITECTURE.md §8.1).
 *
 * `siblingIndex` is the child's rank among enrolled siblings, oldest first
 * and 0-based, so the first child gets nothing and the rule only ever
 * reduces a bill for the second and later. Returns null when it does not
 * apply, so the caller writes no discount row at all rather than a zero one
 * — a zero-amount discount in the ledger looks like a mistake to an auditor.
 */
export function siblingDiscount(
  siblingIndex: number,
  policy: { readonly percentBp: number; readonly fromIndex?: number },
): DiscountRequest | null {
  const fromIndex = policy.fromIndex ?? 1
  if (!Number.isInteger(siblingIndex) || siblingIndex < 0) {
    throw new ValidationError('sibling_index_invalid', 'Sibling index must be a non-negative integer.')
  }
  if (siblingIndex < fromIndex || policy.percentBp <= 0) {
    return null
  }
  return {
    type: 'sibling',
    method: 'percent',
    value: BigInt(policy.percentBp),
    reason: `Réduction fratrie (${siblingIndex + 1}e enfant inscrit)`,
  }
}
