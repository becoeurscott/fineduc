import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { Money, assertCurrencyCode, type CurrencyCode } from '@fineduc/money'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  allocatePayment,
  applyAllocations,
  assertSessionOpen,
  formatReceiptNumber,
  initialStatus,
  instalmentStatus,
  post,
  projectInvoice,
  toTenantDate,
  type AllocatableInstalment,
} from '@fineduc/domain'

/**
 * Cash at the desk (ARCHITECTURE.md §8.3) — the flow that makes the product
 * usable with zero payment providers connected.
 *
 * One transaction does all of it: payment, allocations, ledger, cash
 * movement, receipt, projections, reminder cancellation. Anything less and a
 * parent can leave holding a receipt for money the ledger never recorded.
 *
 * Three controls live here and nowhere else:
 *
 *  1. **Idempotency** (rule #5) on `payment.idempotency_key`, unique per
 *     tenant. A cashier on a bad connection WILL double-tap; the second
 *     request returns the first receipt rather than taking the money twice.
 *  2. **The invoice row is locked FOR UPDATE** before allocating. Two
 *     cashiers taking payments for the same student at the same moment must
 *     not both read the same balance and both allocate against it.
 *  3. **The receipt number is gapless**, taken from a counter row, not a
 *     sequence — a sequence does not roll back, so an aborted transaction
 *     burns a number and leaves the gap an auditor reads as a deleted
 *     receipt.
 */

export interface RecordCashPaymentParams {
  readonly studentId: string
  readonly amountMinor: bigint
  readonly instalmentId?: string
  readonly payerName?: string
  readonly idempotencyKey: string
  readonly cashierUserId: string
  readonly cashSessionId: string
  readonly now: Date
}

export interface CashPaymentResult {
  readonly paymentId: string
  readonly receiptNumber: string
  readonly allocatedMinor: bigint
  /** Money the instalments could not absorb — an overpayment sitting as credit. */
  readonly unallocatedMinor: bigint
  readonly invoiceBalanceMinor: bigint
  /** True when this was a replay of an already-recorded payment. */
  readonly replayed: boolean
}

@Injectable()
export class CashPaymentService {
  async record(
    tx: TenantTransactionClient,
    tenantId: string,
    params: RecordCashPaymentParams,
  ): Promise<CashPaymentResult> {
    const currency = await this.currencyOf(tx, tenantId)
    const amount = Money.of(params.amountMinor, currency)

    if (amount.amount <= 0n) {
      throw new ValidationError('payment_not_positive', 'A cash payment must be a positive amount.')
    }

    // ---- 1. idempotency ---------------------------------------------------
    const replay = await tx.payment.findFirst({
      where: { tenantId, idempotencyKey: params.idempotencyKey },
      include: { receipt: true, allocations: true, invoice: true },
    })
    if (replay) {
      if (replay.amountMinor !== amount.amount || replay.studentId !== params.studentId) {
        // Same key, different money. That is a client bug, and returning the
        // original silently would hide it while the second payment vanishes.
        throw new ConflictError(
          'IDEMPOTENCY_KEY_REUSED',
          `Idempotency key ${params.idempotencyKey} was already used for a different payment.`,
        )
      }
      return {
        paymentId: replay.id,
        receiptNumber: replay.receipt?.number ?? '',
        allocatedMinor: replay.allocations.reduce((sum, a) => sum + a.amountMinor, 0n),
        unallocatedMinor: replay.amountMinor - replay.allocations.reduce((sum, a) => sum + a.amountMinor, 0n),
        invoiceBalanceMinor: replay.invoice.balanceMinor,
        replayed: true,
      }
    }

    // ---- 2. the desk must be open ----------------------------------------
    const session = await tx.cashSession.findUnique({ where: { id: params.cashSessionId } })
    if (!session || session.tenantId !== tenantId) {
      throw new NotFoundError('cash_session', params.cashSessionId)
    }
    assertSessionOpen(session)

    // ---- 3. the invoice, locked ------------------------------------------
    const invoiceId = await this.lockCurrentInvoice(tx, tenantId, params.studentId)

    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { instalments: true },
    })
    if (!invoice) throw new NotFoundError('invoice', invoiceId)
    if (invoice.status === 'cancelled') {
      throw new ConflictError('INVOICE_CANCELLED', 'This invoice is cancelled and cannot take a payment.')
    }

    const today = toTenantDate(params.now, await this.timezoneOf(tx, tenantId))

    const allocatable: AllocatableInstalment[] = invoice.instalments.map((i) => ({
      id: i.id,
      sequence: i.sequence,
      dueOn: this.date(i.dueOn),
      amountMinor: i.amountMinor,
      allocatedMinor: i.allocatedMinor,
      status: i.status,
    }))

    const { allocations, unallocatedMinor } = allocatePayment(amount, allocatable, {
      onlyInstalmentId: params.instalmentId,
    })
    const allocatedMinor = allocations.reduce((sum, a) => sum + a.amountMinor, 0n)

    // ---- 4. the payment ---------------------------------------------------
    const payment = await tx.payment.create({
      data: {
        tenantId,
        studentId: params.studentId,
        invoiceId: invoice.id,
        method: 'cash',
        amountMinor: amount.amount,
        currency,
        // Cash settles on the spot — there is no provider to wait for.
        status: initialStatus('cash'),
        payerName: params.payerName ?? null,
        idempotencyKey: params.idempotencyKey,
        cashSessionId: params.cashSessionId,
        initiatedBy: params.cashierUserId,
        receivedAt: params.now,
      },
    })

    for (const allocation of allocations) {
      await tx.paymentAllocation.create({
        data: {
          tenantId,
          paymentId: payment.id,
          instalmentId: allocation.instalmentId,
          amountMinor: allocation.amountMinor,
        },
      })
    }

    // ---- 5. projections, in the same transaction as the ledger below ------
    for (const updated of applyAllocations(allocatable, allocations)) {
      const source = allocatable.find((i) => i.id === updated.id) as AllocatableInstalment
      await tx.instalment.update({
        where: { id: updated.id },
        data: {
          allocatedMinor: updated.allocatedMinor,
          status: instalmentStatus(
            { amountMinor: source.amountMinor, allocatedMinor: updated.allocatedMinor, dueOn: source.dueOn },
            today,
          ),
        },
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

    // ---- 6. ledger --------------------------------------------------------
    // Only what was ALLOCATED reduces the debt. An overpayment is money the
    // school holds, not a debt reduction, and posting it as one would show a
    // negative balance the ledger cannot explain.
    if (allocatedMinor > 0n) {
      const opening = await this.openingBalance(tx, tenantId, params.studentId, currency)
      const { entry } = post(opening, {
        entryType: 'payment',
        amount: Money.of(allocatedMinor, currency),
        sourceType: 'payment',
        sourceId: payment.id,
        occurredOn: today,
        invoiceId: invoice.id,
        memo: params.payerName ? `Espèces — ${params.payerName}` : 'Espèces',
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

    // ---- 7. receipt, gapless ---------------------------------------------
    const receiptNumber = formatReceiptNumber(
      Number(today.slice(0, 4)),
      await this.nextReceiptSequence(tx, tenantId, Number(today.slice(0, 4))),
    )
    await tx.receipt.create({
      data: { tenantId, paymentId: payment.id, number: receiptNumber, issuedAt: params.now },
    })

    // ---- 8. the drawer ----------------------------------------------------
    await tx.cashMovement.create({
      data: {
        tenantId,
        cashSessionId: params.cashSessionId,
        type: 'payment',
        amountMinor: amount.amount,
        reference: receiptNumber,
        createdBy: params.cashierUserId,
      },
    })

    // ---- 9. stop reminding a family that has just paid --------------------
    // Rule #7 puts the final decision in the sender, but cancelling here
    // keeps a queued reminder from being sent in the seconds before the
    // sender next re-checks.
    const settled = allocations.map((a) => a.instalmentId)
    if (settled.length > 0) {
      await tx.reminderSchedule.updateMany({
        where: { tenantId, instalmentId: { in: settled }, status: 'scheduled' },
        data: { status: 'cancelled', skipReason: `Paid — receipt ${receiptNumber}` },
      })
    }

    await tx.outboxEvent.create({
      data: {
        tenantId,
        aggregateType: 'payment',
        aggregateId: payment.id,
        eventType: 'payment.recorded',
        payload: {
          paymentId: payment.id,
          studentId: params.studentId,
          invoiceId: invoice.id,
          method: 'cash',
          amountMinor: amount.amount.toString(),
          allocatedMinor: allocatedMinor.toString(),
          unallocatedMinor: unallocatedMinor.toString(),
          receiptNumber,
          currency,
        },
      },
    })

    return {
      paymentId: payment.id,
      receiptNumber,
      allocatedMinor,
      unallocatedMinor,
      invoiceBalanceMinor: projected.balanceMinor,
      replayed: false,
    }
  }

  /**
   * Lock the student's current invoice row before reading its instalments.
   *
   * `SELECT ... FOR UPDATE` in raw SQL because Prisma has no way to express
   * it. Without this, two cashiers serving the same family at once both read
   * the same `allocatedMinor` and both allocate against it, and the invoice
   * ends up over-allocated with no error anywhere.
   */
  private async lockCurrentInvoice(
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
    if (!id) {
      throw new NotFoundError('invoice', `for student ${studentId}`)
    }
    return id
  }

  /**
   * The next receipt number for this tenant and year, GAPLESS.
   *
   * An upsert that increments in place: it takes a row lock for the rest of
   * the transaction, so concurrent cashiers serialise here rather than
   * colliding on the unique index. Critically the increment rolls back with
   * the transaction — which is the whole reason this is a counter row and
   * not a Postgres sequence, since sequences do not roll back and every
   * aborted payment would burn a number.
   */
  private async nextReceiptSequence(
    tx: TenantTransactionClient,
    tenantId: string,
    year: number,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO receipt_counter (id, tenant_id, year, last_number, updated_at)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${year}, 1, now())
      ON CONFLICT (tenant_id, year)
      DO UPDATE SET last_number = receipt_counter.last_number + 1, updated_at = now()
      RETURNING last_number
    `
    const next = rows[0]?.last_number
    if (next == null) {
      throw new ConflictError('RECEIPT_COUNTER_FAILED', 'Could not obtain a receipt number.')
    }
    return Number(next)
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

  private date(value: Date): string {
    return value.toISOString().slice(0, 10)
  }

  private async currencyOf(tx: TenantTransactionClient, tenantId: string): Promise<CurrencyCode> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)
    return assertCurrencyCode(tenant.currency)
  }

  private async timezoneOf(tx: TenantTransactionClient, tenantId: string): Promise<string> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)
    return tenant.timezone
  }
}
