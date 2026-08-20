import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { Money, assertCurrencyCode, type CurrencyCode } from '@fineduc/money'
import {
  NotFoundError,
  ConflictError,
  assertInstalmentsCoverNet,
  buildInvoiceLines,
  expandInstalments,
  postAll,
  resolveDiscountStack,
  siblingDiscount,
  sumLines,
  toTenantDate,
  type DiscountRequest,
  type FeeSchedule,
  type InstalmentTemplate,
  type LedgerPosting,
} from '@fineduc/domain'

/**
 * Raising the money owed by one enrolment — ARCHITECTURE.md §8.1.
 *
 * Everything here runs inside the CALLER'S transaction. It is deliberately
 * not able to open one of its own: the enrolment row and the invoice it
 * implies must commit together or not at all, or a school ends up with a
 * student enrolled and owing nothing.
 *
 * The arithmetic all lives in `@fineduc/domain`; this class is orchestration
 * and persistence only. That split is what lets the hard cases (largest
 * remainder, half-up rounding, the sum invariant) be tested exhaustively
 * without a database.
 */

export interface RaiseInvoiceParams {
  readonly enrollmentId: string
  /** 0-based rank among the family's enrolled children, oldest first. */
  readonly siblingIndex?: number
  readonly siblingPolicy?: { readonly percentBp: number; readonly fromIndex?: number }
  /** Optional fee item codes this student takes (canteen, transport). */
  readonly optionalCodes?: readonly string[]
  /** Discounts a human granted, applied after any automatic one. */
  readonly manualDiscounts?: readonly DiscountRequest[]
  readonly grantedByUserId: string
  /** Injected so the caller controls "today" — the domain may not read a clock. */
  readonly now: Date
}

export interface RaiseInvoiceResult {
  readonly invoiceId: string
  readonly number: string
  readonly totalMinor: bigint
  readonly discountMinor: bigint
  readonly netMinor: bigint
  readonly instalmentCount: number
}

@Injectable()
export class InvoicingService {
  async raiseForEnrollment(
    tx: TenantTransactionClient,
    tenantId: string,
    params: RaiseInvoiceParams,
  ): Promise<RaiseInvoiceResult> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)
    const currency = assertCurrencyCode(tenant.currency)

    const enrollment = await tx.enrollment.findUnique({
      where: { id: params.enrollmentId },
      include: { invoice: true },
    })
    if (!enrollment || enrollment.tenantId !== tenantId) {
      throw new NotFoundError('enrollment', params.enrollmentId)
    }
    // One invoice per enrolment. The DB enforces it too (`enrollment_id` is
    // unique on invoice); this turns a constraint violation into an error a
    // caller can actually read, and makes a double-submit idempotent-ish at
    // the service boundary rather than a 500.
    if (enrollment.invoice) {
      throw new ConflictError(
        'INVOICE_ALREADY_RAISED',
        `Enrolment ${params.enrollmentId} already has invoice ${enrollment.invoice.number}.`,
      )
    }

    const schedule = await this.loadSchedule(tx, tenantId, enrollment.feeScheduleId)
    const plan = await this.loadPlan(tx, tenantId, enrollment.feeScheduleId)

    // ---- 4. lines -------------------------------------------------------
    const lines = buildInvoiceLines(schedule, { optionalCodes: params.optionalCodes })
    const gross = sumLines(lines, currency)

    // ---- 5. discounts ---------------------------------------------------
    const auto = params.siblingPolicy
      ? siblingDiscount(params.siblingIndex ?? 0, params.siblingPolicy)
      : null
    const requested: DiscountRequest[] = [...(auto ? [auto] : []), ...(params.manualDiscounts ?? [])]
    const { discounts, totalMinor: discountMinor, netMinor } = resolveDiscountStack(requested, gross)
    const net = Money.of(netMinor, currency)

    if (net.amount <= 0n) {
      throw new ConflictError(
        'INVOICE_NET_NOT_POSITIVE',
        'Discounts reduce this invoice to zero or less. Record a full waiver instead of an invoice nobody can pay.',
      )
    }

    // ---- 6. instalments -------------------------------------------------
    const issuedOn = toTenantDate(params.now, tenant.timezone)
    const anchorDate = toTenantDate(enrollment.enrolledOn, tenant.timezone)
    const instalments = expandInstalments(plan.templates, net, { anchorDate })
    // Re-assert inside the transaction rather than trusting the value that
    // came back from expansion (ARCHITECTURE.md §8.1).
    assertInstalmentsCoverNet(instalments, net)

    // ---- persist --------------------------------------------------------
    const number = this.invoiceNumber(issuedOn, enrollment.id)

    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        enrollmentId: enrollment.id,
        number,
        issuedOn: new Date(issuedOn),
        totalMinor: gross.amount,
        discountMinor,
        netMinor: net.amount,
        paidMinor: 0n,
        balanceMinor: net.amount,
        status: 'open',
      },
    })

    for (const line of lines) {
      await tx.invoiceLine.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          feeItemId: line.feeItemId,
          label: line.label,
          amountMinor: line.amountMinor,
          quantity: line.quantity,
        },
      })
    }

    for (const discount of discounts) {
      await tx.discount.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          type: discount.type,
          method: discount.method,
          value: discount.value,
          amountMinor: discount.amountMinor,
          reason: discount.reason,
          grantedBy: params.grantedByUserId,
        },
      })
    }

    for (const instalment of instalments) {
      await tx.instalment.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          sequence: instalment.sequence,
          label: instalment.label,
          dueOn: new Date(instalment.dueOn),
          amountMinor: instalment.amountMinor,
          allocatedMinor: 0n,
          status: 'pending',
        },
      })
    }

    // ---- 7 + 8. ledger --------------------------------------------------
    // Order matters and is the statement a bursar will read: the charge, then
    // what was taken off it, then anything carried over from last year.
    const postings: (LedgerPosting & { readonly direction?: 1 | -1 })[] = [
      {
        entryType: 'charge',
        amount: gross,
        sourceType: 'invoice',
        sourceId: invoice.id,
        occurredOn: issuedOn,
        invoiceId: invoice.id,
        memo: `Facture ${number}`,
      },
      ...discounts.map((discount) => ({
        entryType: 'discount' as const,
        amount: Money.of(discount.amountMinor, currency),
        sourceType: 'discount',
        sourceId: invoice.id,
        occurredOn: issuedOn,
        invoiceId: invoice.id,
        memo: discount.reason,
      })),
    ]

    const carriedForward = enrollment.carriedForwardBalanceMinor
    if (carriedForward > 0n) {
      postings.push({
        entryType: 'carry_forward',
        amount: Money.of(carriedForward, currency),
        sourceType: 'enrollment',
        sourceId: enrollment.id,
        occurredOn: issuedOn,
        memo: 'Solde reporté',
      })
    }

    const opening = await this.openingBalance(tx, tenantId, enrollment.studentId, currency)
    const { entries } = postAll(opening, postings)

    for (const entry of entries) {
      await tx.studentLedgerEntry.create({
        data: {
          tenantId,
          studentId: enrollment.studentId,
          invoiceId: entry.invoiceId ?? null,
          instalmentId: entry.instalmentId ?? null,
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

    // ---- 9. outbox ------------------------------------------------------
    // Written in the same transaction, not queued directly: a job enqueued
    // before commit can run against a row that never lands (AGENTS.md step 6).
    await tx.outboxEvent.create({
      data: {
        tenantId,
        aggregateType: 'invoice',
        aggregateId: invoice.id,
        eventType: 'invoice.raised',
        payload: {
          invoiceId: invoice.id,
          enrollmentId: enrollment.id,
          studentId: enrollment.studentId,
          number,
          netMinor: net.amount.toString(),
          currency,
          instalments: instalments.map((i) => ({
            sequence: i.sequence,
            dueOn: i.dueOn,
            amountMinor: i.amountMinor.toString(),
          })),
        },
      },
    })

    return {
      invoiceId: invoice.id,
      number,
      totalMinor: gross.amount,
      discountMinor,
      netMinor: net.amount,
      instalmentCount: instalments.length,
    }
  }

  private async loadSchedule(
    tx: TenantTransactionClient,
    tenantId: string,
    feeScheduleId: string,
  ): Promise<FeeSchedule> {
    const row = await tx.feeSchedule.findUnique({
      where: { id: feeScheduleId },
      include: { feeItems: true },
    })
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundError('fee_schedule', feeScheduleId)
    }
    return {
      id: row.id,
      status: row.status,
      version: row.version,
      items: row.feeItems.map((item) => ({
        id: item.id,
        code: item.code,
        label: item.label,
        category: item.category,
        amountMinor: item.amountMinor,
        isMandatory: item.isMandatory,
        isRecurring: item.isRecurring,
        sequence: item.sequence,
      })),
    }
  }

  private async loadPlan(
    tx: TenantTransactionClient,
    tenantId: string,
    feeScheduleId: string,
  ): Promise<{ readonly templates: InstalmentTemplate[] }> {
    const plan = await tx.instalmentPlan.findFirst({
      where: { tenantId, feeScheduleId },
      include: { templates: true },
    })
    if (!plan) {
      throw new NotFoundError('instalment_plan', `for fee schedule ${feeScheduleId}`)
    }
    return {
      templates: plan.templates.map((template) => ({
        sequence: template.sequence,
        label: template.label,
        dueOffsetDays: template.dueOffsetDays,
        // Prisma hands back a Date for a DATE column; the domain wants the
        // calendar string, and going through toISOString keeps it from ever
        // being localised on the way.
        dueOn: template.dueOn ? template.dueOn.toISOString().slice(0, 10) : null,
        percentBp: template.percentBp,
        amountMinor: template.amountMinor,
      })),
    }
  }

  /**
   * The student's balance before this invoice, read from the last ledger row
   * rather than recomputed — the running balance is the ledger's own record
   * of itself, and the nightly sweep is what proves it still adds up.
   */
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

  /**
   * `INV-2026-1A2B3C4D`.
   *
   * Derived from the enrolment id, which is already unique per student per
   * year, so two concurrent enrolments cannot collide and no counter has to
   * be locked. Invoice numbers are NOT required to be gapless — only receipt
   * numbers are (ARCHITECTURE.md §8.3), because a gap in a receipt book is
   * what an auditor reads as a deleted receipt. If schools ask for strictly
   * sequential invoice numbers, that needs a locked counter row like
   * ReceiptCounter and a migration.
   */
  private invoiceNumber(issuedOn: string, enrollmentId: string): string {
    const year = issuedOn.slice(0, 4)
    const suffix = enrollmentId.replace(/-/g, '').slice(0, 8).toUpperCase()
    return `INV-${year}-${suffix}`
  }
}
