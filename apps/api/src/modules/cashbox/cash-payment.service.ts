import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { Money, assertCurrencyCode, type CurrencyCode } from '@fineduc/money'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  assertSessionOpen,
  formatReceiptNumber,
  initialStatus,
  toTenantDate,
} from '@fineduc/domain'
import { SettlementService } from '@fineduc/services'

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
  constructor(private readonly settlement: SettlementService) {}

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

    // ---- 3. the payment row ---------------------------------------------
    // Created BEFORE settling, because allocations reference it.
    const invoiceId = await this.settlement.lockCurrentInvoice(tx, tenantId, params.studentId)
    const today = toTenantDate(params.now, await this.timezoneOf(tx, tenantId))

    const payment = await tx.payment.create({
      data: {
        tenantId,
        studentId: params.studentId,
        invoiceId,
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

    // ---- 4-6. allocate, project, post — shared with the aggregator path ---
    const settled = await this.settlement.settle(tx, tenantId, currency, {
      paymentId: payment.id,
      studentId: params.studentId,
      amount,
      instalmentId: params.instalmentId,
      occurredOn: today,
      memo: params.payerName ? `Espèces — ${params.payerName}` : 'Espèces',
      reminderSkipReason: 'Paid in cash at the desk',
    })

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

    await tx.outboxEvent.create({
      data: {
        tenantId,
        aggregateType: 'payment',
        aggregateId: payment.id,
        eventType: 'payment.recorded',
        payload: {
          paymentId: payment.id,
          studentId: params.studentId,
          invoiceId: settled.invoiceId,
          method: 'cash',
          amountMinor: amount.amount.toString(),
          allocatedMinor: settled.allocatedMinor.toString(),
          unallocatedMinor: settled.unallocatedMinor.toString(),
          receiptNumber,
          currency,
        },
      },
    })

    return {
      paymentId: payment.id,
      receiptNumber,
      allocatedMinor: settled.allocatedMinor,
      unallocatedMinor: settled.unallocatedMinor,
      invoiceBalanceMinor: settled.balanceMinor,
      replayed: false,
    }
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
