/**
 * Spreading one payment across instalments — oldest due first
 * (ARCHITECTURE.md §8.2, §8.3).
 *
 * The order is not a preference, it is the rule: a family paying 50 000
 * against a year of tranches is clearing the oldest debt, and any other
 * order would leave an older instalment "overdue" while a later one is
 * paid, which is what triggers a reminder to somebody who just paid.
 *
 * Two properties this file guarantees:
 *
 *  1. **Nothing is invented or lost.** `sum(allocations) + unallocated`
 *     always equals the payment exactly.
 *  2. **No instalment is ever over-allocated.** Each takes at most what it
 *     still owes, so a double-submitted payment cannot push an instalment
 *     past its own amount and silently create a credit nobody recorded.
 */
import { Money } from '@fineduc/money'
import { ValidationError } from '../shared/errors.js'
import { byOldestDue, type InstalmentStatus } from '../billing/instalments.js'

export interface AllocatableInstalment {
  readonly id: string
  readonly sequence: number
  readonly dueOn: string
  readonly amountMinor: bigint
  readonly allocatedMinor: bigint
  readonly status: InstalmentStatus
}

export interface Allocation {
  readonly instalmentId: string
  readonly amountMinor: bigint
}

export interface AllocationResult {
  readonly allocations: Allocation[]
  /** Money the instalments could not absorb — an overpayment. */
  readonly unallocatedMinor: bigint
}

/**
 * Statuses that must never receive money.
 *
 * A waived instalment was forgiven by a human decision, and a cancelled one
 * no longer exists; allocating to either would quietly reverse that decision
 * and leave the ledger disagreeing with what the school agreed.
 */
const NOT_ALLOCATABLE: ReadonlySet<InstalmentStatus> = new Set<InstalmentStatus>(['waived', 'cancelled'])

export function allocatePayment(
  payment: Money,
  instalments: readonly AllocatableInstalment[],
  options: { readonly onlyInstalmentId?: string } = {},
): AllocationResult {
  if (payment.amount <= 0n) {
    throw new ValidationError('payment_not_positive', 'A payment must be a positive amount.')
  }

  let candidates = instalments.filter((i) => !NOT_ALLOCATABLE.has(i.status))

  // A payer can target one tranche explicitly — a payment link for "2nd
  // instalment" must land there even if an older one is still open, or the
  // link is a lie.
  if (options.onlyInstalmentId) {
    const target = instalments.find((i) => i.id === options.onlyInstalmentId)
    if (!target) {
      throw new ValidationError('instalment_not_on_invoice', `Instalment ${options.onlyInstalmentId} is not on this invoice.`)
    }
    if (NOT_ALLOCATABLE.has(target.status)) {
      throw new ValidationError(
        'instalment_not_allocatable',
        `Instalment ${options.onlyInstalmentId} is ${target.status} and cannot receive a payment.`,
      )
    }
    candidates = [target]
  }

  let remaining = payment.amount
  const allocations: Allocation[] = []

  for (const instalment of byOldestDue(candidates)) {
    if (remaining <= 0n) break
    const owed = instalment.amountMinor - instalment.allocatedMinor
    if (owed <= 0n) continue

    const take = owed < remaining ? owed : remaining
    allocations.push({ instalmentId: instalment.id, amountMinor: take })
    remaining -= take
  }

  assertConserved(payment.amount, allocations, remaining)
  return { allocations, unallocatedMinor: remaining }
}

/**
 * Conservation check, run on every allocation rather than only in tests.
 *
 * This is cheap and it is the last line before money is written. If a future
 * change to the loop above ever drops or duplicates a franc, this turns it
 * into a loud failure instead of a slow drift that the nightly sweep finds
 * weeks later.
 */
export function assertConserved(
  paymentMinor: bigint,
  allocations: readonly Allocation[],
  unallocatedMinor: bigint,
): void {
  const allocated = allocations.reduce((sum, a) => sum + a.amountMinor, 0n)
  if (allocated + unallocatedMinor !== paymentMinor) {
    throw new ValidationError(
      'allocation_not_conserved',
      `Allocations (${allocated}) plus unallocated (${unallocatedMinor}) do not equal the payment (${paymentMinor}).`,
    )
  }
  if (allocations.some((a) => a.amountMinor <= 0n)) {
    throw new ValidationError('allocation_not_positive', 'An allocation of zero or less should not be recorded at all.')
  }
}

/**
 * What each instalment looks like after a set of allocations is applied.
 * Returned rather than mutated so the caller can write the projection in the
 * same transaction as the ledger entry (AGENTS.md rule #3).
 */
export function applyAllocations(
  instalments: readonly AllocatableInstalment[],
  allocations: readonly Allocation[],
): { readonly id: string; readonly allocatedMinor: bigint }[] {
  const byId = new Map(allocations.map((a) => [a.instalmentId, a.amountMinor]))
  return instalments
    .filter((i) => byId.has(i.id))
    .map((i) => ({
      id: i.id,
      allocatedMinor: i.allocatedMinor + (byId.get(i.id) as bigint),
    }))
}
