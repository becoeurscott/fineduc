import { Injectable, Logger } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { Money, assertCurrencyCode } from '@fineduc/money'
import { NotFoundError, assertTransition, canTransition, isSettled, toTenantDate } from '@fineduc/domain'
import type { NormalizedPaymentEvent } from '@fineduc/providers'
import { SettlementService } from './settlement.service.js'

/**
 * The webhook PROCESSOR (ARCHITECTURE.md §8.2, step 3).
 *
 * Runs behind the ingest endpoint, in the caller's transaction, so the whole
 * settlement commits together or not at all.
 *
 * The state machine is the point. Aggregators redeliver out of order, and a
 * late `failed` arriving after a payment settled must be **logged and
 * dropped, never applied** — un-settling money already in a school's account
 * is the worst thing this system could do.
 */

export type ProcessOutcome =
  | { readonly result: 'settled'; readonly paymentId: string; readonly allocatedMinor: bigint }
  | { readonly result: 'already_settled'; readonly paymentId: string }
  | { readonly result: 'recorded'; readonly paymentId: string; readonly status: string }
  | { readonly result: 'ignored'; readonly paymentId: string; readonly reason: string }

@Injectable()
export class WebhookProcessorService {
  private readonly logger = new Logger(WebhookProcessorService.name)

  constructor(private readonly settlement: SettlementService) {}

  async process(
    tx: TenantTransactionClient,
    tenantId: string,
    event: NormalizedPaymentEvent,
    options: { readonly now: Date },
  ): Promise<ProcessOutcome> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)
    const currency = assertCurrencyCode(tenant.currency)

    // Lock the payment before reading its status, or two deliveries of the
    // same event both see `pending` and both settle it.
    const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM payment
      WHERE tenant_id = ${tenantId}::uuid AND provider_ref = ${event.providerRef}
      LIMIT 1
      FOR UPDATE
    `
    const row = locked[0]
    if (!row) {
      throw new NotFoundError('payment', `for provider ref ${event.providerRef}`)
    }

    const current = row.status as Parameters<typeof canTransition>[0]

    // Re-delivery of the status we already hold: a no-op, and the normal
    // case rather than an error.
    if (current === event.status) {
      return isSettled(current)
        ? { result: 'already_settled', paymentId: row.id }
        : { result: 'recorded', paymentId: row.id, status: current }
    }

    if (!canTransition(current, event.status)) {
      // Logged and DROPPED. This is the late-`failed`-after-`succeeded` case.
      this.logger.warn(
        `Dropping out-of-order webhook for payment ${row.id}: cannot go from ${current} to ${event.status}`,
      )
      return {
        result: 'ignored',
        paymentId: row.id,
        reason: `illegal transition ${current} -> ${event.status}`,
      }
    }
    // Belt to the braces above: if the table and the guard ever disagree,
    // fail loudly rather than writing the transition anyway.
    assertTransition(current, event.status)

    const payment = await tx.payment.findUnique({ where: { id: row.id } })
    if (!payment) throw new NotFoundError('payment', row.id)

    if (!isSettled(event.status)) {
      // failed / expired / cancelled: record the outcome, touch no money.
      await tx.payment.update({
        where: { id: row.id },
        data: { status: event.status, rawProviderPayload: { failureReason: event.failureReason ?? null } },
      })
      return { result: 'recorded', paymentId: row.id, status: event.status }
    }

    // ---- settle ----------------------------------------------------------
    // The amount the PROVIDER says landed, not the amount we asked for. A
    // parent may authorise less than the suggested amount, and settling what
    // we hoped for rather than what arrived is how a ledger stops matching a
    // bank account.
    const settledAmount = event.paidAmount ?? Money.of(payment.amountMinor, currency)
    const occurredOn = toTenantDate(options.now, tenant.timezone)

    await tx.payment.update({
      where: { id: row.id },
      data: {
        status: 'succeeded',
        receivedAt: event.occurredAt,
        amountMinor: settledAmount.amount,
        providerFeeMinor: event.providerFee?.amount ?? null,
      },
    })

    const settled = await this.settlement.settle(tx, tenantId, currency, {
      paymentId: row.id,
      studentId: payment.studentId,
      amount: settledAmount,
      occurredOn,
      memo: `Mobile money — ${payment.payerPhoneE164 ?? 'paiement en ligne'}`,
      reminderSkipReason: 'Paid by mobile money',
    })

    await tx.outboxEvent.create({
      data: {
        tenantId,
        aggregateType: 'payment',
        aggregateId: row.id,
        eventType: 'payment.succeeded',
        payload: {
          paymentId: row.id,
          studentId: payment.studentId,
          invoiceId: settled.invoiceId,
          amountMinor: settledAmount.amount.toString(),
          allocatedMinor: settled.allocatedMinor.toString(),
          unallocatedMinor: settled.unallocatedMinor.toString(),
          currency,
        },
      },
    })

    return { result: 'settled', paymentId: row.id, allocatedMinor: settled.allocatedMinor }
  }
}
