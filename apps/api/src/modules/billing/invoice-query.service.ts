import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { Money, assertCurrencyCode, type CurrencyCode } from '@fineduc/money'
import { NotFoundError, instalmentStatus, toTenantDate } from '@fineduc/domain'
import type { Invoice, StudentStatement } from '@fineduc/contracts'

/**
 * Reads over the money tables. No writes, ever — that is why it is a
 * separate service from InvoicingService rather than more methods on it.
 *
 * Two rules shape the output:
 *
 *  - Every amount leaves as `{ amountMinor: string, currency }`. A bigint
 *    cannot be JSON-serialised at all, and a JS number would silently lose
 *    precision — the exact bug the money design exists to prevent.
 *  - Derived figures (`remaining`, `lineTotal`, `balance`) are computed here
 *    and sent explicitly. Leaving four clients to subtract bigints
 *    themselves is four chances to get it wrong.
 */
@Injectable()
export class InvoiceQueryService {
  async getInvoice(tx: TenantTransactionClient, tenantId: string, invoiceId: string): Promise<Invoice> {
    const currency = await this.currencyOf(tx, tenantId)

    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lines: { include: { feeItem: true } },
        discounts: true,
        // Only a GRANTED moratoire moves a date; a pending request has
        // promised the family nothing yet.
        instalments: { include: { moratoriums: { where: { status: 'granted' }, take: 1 } } },
        enrollment: {
          include: {
            student: true,
            classGroup: true,
            academicYear: true,
          },
        },
      },
    })
    // RLS already hides another tenant's rows, so this is normally a genuine
    // 404. The explicit check is the belt to that braces: a bug that loses
    // the tenant context must not turn into a cross-tenant read.
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundError('invoice', invoiceId)
    }

    const today = await this.today(tx, tenantId)
    const student = invoice.enrollment.student

    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      issuedOn: this.date(invoice.issuedOn),

      studentId: student.id,
      studentName: `${student.firstName} ${student.lastName}`,
      matricule: student.matricule,
      className: invoice.enrollment.classGroup.name,
      academicYearName: invoice.enrollment.academicYear.name,

      total: this.money(invoice.totalMinor, currency),
      discount: this.money(invoice.discountMinor, currency),
      net: this.money(invoice.netMinor, currency),
      paid: this.money(invoice.paidMinor, currency),
      balance: this.money(invoice.balanceMinor, currency),

      lines: invoice.lines.map((line) => ({
        id: line.id,
        label: line.label,
        category: line.feeItem.category,
        amount: this.money(line.amountMinor, currency),
        quantity: line.quantity,
        lineTotal: this.money(line.amountMinor * BigInt(line.quantity), currency),
      })),

      discounts: invoice.discounts.map((discount) => ({
        id: discount.id,
        type: discount.type,
        method: discount.method,
        amount: this.money(discount.amountMinor, currency),
        // `value` holds basis points only when the method was percent; for a
        // fixed discount it is the minor amount and would be nonsense here.
        percentBp: discount.method === 'percent' ? Number(discount.value) : null,
        reason: discount.reason,
      })),

      instalments: [...invoice.instalments]
        .sort((a, b) => a.sequence - b.sequence)
        .map((instalment) => {
          const dueOn = this.date(instalment.dueOn)
          const moratorium = instalment.moratoriums[0]
          const moratoriumUntil = moratorium ? this.date(moratorium.deferredDueOn) : null
          return {
            id: instalment.id,
            sequence: instalment.sequence,
            label: instalment.label,
            dueOn,
            effectiveDueOn: moratoriumUntil ?? dueOn,
            moratoriumUntil,
            amount: this.money(instalment.amountMinor, currency),
            allocated: this.money(instalment.allocatedMinor, currency),
            remaining: this.money(instalment.amountMinor - instalment.allocatedMinor, currency),
            // Derived against the tenant's today, never read from the column:
            // an instalment becomes overdue by the passage of time, and a
            // stored flag needs a nightly job just to stay honest.
            status: instalmentStatus(
              {
                amountMinor: instalment.amountMinor,
                allocatedMinor: instalment.allocatedMinor,
                dueOn,
                status: instalment.status,
              },
              today,
            ),
          }
        }),
    }
  }

  /** The invoice for one enrolment, which is the way the dashboard reaches it. */
  async getInvoiceForEnrollment(
    tx: TenantTransactionClient,
    tenantId: string,
    enrollmentId: string,
  ): Promise<Invoice> {
    const invoice = await tx.invoice.findUnique({ where: { enrollmentId }, select: { id: true, tenantId: true } })
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundError('invoice', `for enrollment ${enrollmentId}`)
    }
    return this.getInvoice(tx, tenantId, invoice.id)
  }

  /**
   * The account statement, oldest entry first — the order a bursar or a
   * parent reads down the page.
   *
   * The balance comes from the LAST entry's `balanceAfterMinor` rather than
   * being re-summed here. That column is the ledger's own record of itself;
   * proving it still adds up is the nightly integrity sweep's job, and
   * quietly recomputing it here would hide exactly the drift the sweep
   * exists to catch.
   */
  async getStatement(
    tx: TenantTransactionClient,
    tenantId: string,
    studentId: string,
  ): Promise<StudentStatement> {
    const currency = await this.currencyOf(tx, tenantId)

    const student = await tx.student.findUnique({ where: { id: studentId } })
    if (!student || student.tenantId !== tenantId) {
      throw new NotFoundError('student', studentId)
    }

    const entries = await tx.studentLedgerEntry.findMany({
      where: { tenantId, studentId },
      orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }],
    })

    const last = entries[entries.length - 1]

    return {
      studentId: student.id,
      studentName: `${student.firstName} ${student.lastName}`,
      matricule: student.matricule,
      balance: this.money(last?.balanceAfterMinor ?? 0n, currency),
      entries: entries.map((entry) => ({
        id: entry.id,
        occurredOn: this.date(entry.occurredOn),
        entryType: entry.entryType,
        memo: entry.memo,
        amount: this.money(entry.amountMinor, currency),
        balanceAfter: this.money(entry.balanceAfterMinor, currency),
      })),
    }
  }

  private money(amountMinor: bigint, currency: CurrencyCode) {
    return { amountMinor: Money.of(amountMinor, currency).toWireString(), currency }
  }

  /** A DATE column comes back as a Date; take the calendar day, unlocalised. */
  private date(value: Date): string {
    return value.toISOString().slice(0, 10)
  }

  private async currencyOf(tx: TenantTransactionClient, tenantId: string): Promise<CurrencyCode> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)
    return assertCurrencyCode(tenant.currency)
  }

  /** "Today" in the tenant's timezone — the only today an due date may be compared to. */
  private async today(tx: TenantTransactionClient, tenantId: string): Promise<string> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)
    return toTenantDate(new Date(), tenant.timezone)
  }
}
