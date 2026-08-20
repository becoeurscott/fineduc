import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { Money, type CurrencyCode } from '@fineduc/money'
import {
  ConflictError,
  NotFoundError,
  allocatePayment,
  applyAllocations,
  instalmentStatus,
  post,
  projectInvoice,
  type AllocatableInstalment,
} from '@fineduc/domain'

/**
 * Settling money against an invoice — the part that is IDENTICAL whether the
 * francs arrived in a drawer or over an aggregator.
 *
 * Extracted deliberately. Cash (§8.3) and mobile money (§8.2) allocate the
 * same way, post the same ledger entry, recompute the same projections and
 * cancel the same reminders; two copies of that would drift, and the first
 * symptom of drift on a money path is a balance nobody can explain.
 *
 * What stays OUT of here is what genuinely differs: the receipt and the cash
 * movement belong to the desk; the provider reference and fee belong to the
 * aggregator.
 *
 * Everything runs in the caller's transaction. This service never opens one.
 */

export interface SettleParams {
  readonly paymentId: string
  readonly studentId: string
  readonly amount: Money
  /** Pin the money to one tranche — a payment link that names one must land there. */
  readonly instalmentId?: string
  /** Calendar date in the tenant's timezone. */
  readonly occurredOn: string
  readonly memo?: string
  /** Appears on the cancelled reminders, so the skip reason is readable. */
  readonly reminderSkipReason: string
}

export interface SettleResult {
  readonly invoiceId: string
  readonly allocatedMinor: bigint
  readonly unallocatedMinor: bigint
  readonly balanceMinor: bigint
  readonly status: 'open' | 'partial' | 'paid'
  readonly settledInstalmentIds: string[]
}

@Injectable()
export class SettlementService {
  async settle(
    tx: TenantTransactionClient,
    tenantId: string,
    currency: CurrencyCode,
    params: SettleParams,
  ): Promise<SettleResult> {
    const invoiceId = await this.lockCurrentInvoice(tx, tenantId, params.studentId)

    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { instalments: true } })
    if (!invoice) throw new NotFoundError('invoice', invoiceId)
    if (invoice.status === 'cancelled') {
      throw new ConflictError('INVOICE_CANCELLED', 'This invoice is cancelled and cannot take a payment.')
    }

    const allocatable: AllocatableInstalment[] = invoice.instalments.map((i) => ({
      id: i.id,
      sequence: i.sequence,
      dueOn: i.dueOn.toISOString().slice(0, 10),
      amountMinor: i.amountMinor,
      allocatedMinor: i.allocatedMinor,
      status: i.status,
    }))

    const { allocations, unallocatedMinor } = allocatePayment(params.amount, allocatable, {
      onlyInstalmentId: params.instalmentId,
    })
    const allocatedMinor = allocations.reduce((sum, a) => sum + a.amountMinor, 0n)

    for (const allocation of allocations) {
      await tx.paymentAllocation.create({
        data: {
          tenantId,
          paymentId: params.paymentId,
          instalmentId: allocation.instalmentId,
          amountMinor: allocation.amountMinor,
        },
      })
    }

    // Projections, written in the same transaction as the ledger entry below
    // (AGENTS.md rule #3).
    const settledInstalmentIds: string[] = []
    for (const updated of applyAllocations(allocatable, allocations)) {
      const source = allocatable.find((i) => i.id === updated.id) as AllocatableInstalment
      const status = instalmentStatus(
        { amountMinor: source.amountMinor, allocatedMinor: updated.allocatedMinor, dueOn: source.dueOn },
        params.occurredOn,
      )
      if (status === 'paid') settledInstalmentIds.push(updated.id)
      await tx.instalment.update({
        where: { id: updated.id },
        data: { allocatedMinor: updated.allocatedMinor, status },
      })
    }

    const projected = projectInvoice(invoice.netMinor, invoice.paidMinor + allocatedMinor)
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidMinor: projected.paidMinor,
        balanceMinor: projected.balanceMinor,
        status: projected.status,
      },
    })

    // Only what was ALLOCATED reduces the debt. An overpayment is money the
    // school holds, not a debt reduction; posting it as one would show a
    // negative balance the ledger cannot explain.
    if (allocatedMinor > 0n) {
      const opening = await this.openingBalance(tx, tenantId, params.studentId, currency)
      const { entry } = post(opening, {
        entryType: 'payment',
        amount: Money.of(allocatedMinor, currency),
        sourceType: 'payment',
        sourceId: params.paymentId,
        occurredOn: params.occurredOn,
        invoiceId: invoice.id,
        memo: params.memo,
      })
      await tx.studentLedgerEntry.create({
        data: {
          tenantId,
          studentId: params.studentId,
          invoiceId: entry.invoiceId ?? null,
          instalmentId: null,
          entryType: entry.entryType,
          amountMinor: entry.amountMinor,
          balanceAfterMinor: entry.balanceAfterMinor,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          occurredOn: new Date(entry.occurredOn),
          memo: entry.memo ?? null,
        },
      })
    }

    // Rule #7 puts the final decision in the sender, but cancelling here
    // stops a queued reminder going out in the seconds before the sender next
    // re-checks. Only fully settled tranches: a partly-paid one still owes.
    if (settledInstalmentIds.length > 0) {
      await tx.reminderSchedule.updateMany({
        where: { tenantId, instalmentId: { in: settledInstalmentIds }, status: 'scheduled' },
        data: { status: 'cancelled', skipReason: params.reminderSkipReason },
      })
    }

    return {
      invoiceId: invoice.id,
      allocatedMinor,
      unallocatedMinor,
      balanceMinor: projected.balanceMinor,
      status: projected.status,
      settledInstalmentIds,
    }
  }

  /**
   * Lock the student's current invoice before reading its instalments.
   *
   * `SELECT ... FOR UPDATE` in raw SQL because Prisma cannot express it.
   * Without it, two payments arriving at once — a cashier and a webhook, say
   * — both read the same `allocatedMinor` and both allocate against it, and
   * the invoice ends up over-allocated with no error anywhere.
   */
  async lockCurrentInvoice(
    tx: TenantTransactionClient,
    tenantId: string,
    studentId: string,
  ): Promise<string> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT i.id
      FROM invoice i
      JOIN enrollment e ON e.id = i.enrollment_id
      WHERE i.tenant_id = ${tenantId}::uuid
        AND e.student_id = ${studentId}::uuid
        AND i.status <> 'cancelled'
      ORDER BY i.issued_on DESC
      LIMIT 1
      FOR UPDATE OF i
    `
    const id = rows[0]?.id
    if (!id) throw new NotFoundError('invoice', `for student ${studentId}`)
    return id
  }

  private async openingBalance(
    tx: TenantTransactionClient,
    tenantId: string,
    studentId: string,
    currency: CurrencyCode,
  ): Promise<Money> {
    const last = await tx.studentLedgerEntry.findFirst({
      where: { tenantId, studentId },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
    })
    return Money.of(last?.balanceAfterMinor ?? 0n, currency)
  }
}
