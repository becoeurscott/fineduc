import { Injectable } from '@nestjs/common'
import type { PrismaClient, TenantTransactionClient } from '@fineduc/db'
import { withTenant } from '@fineduc/db'
import { Money, assertCurrencyCode, type CurrencyCode } from '@fineduc/money'
import { ConflictError, NotFoundError, ValidationError, initialStatus } from '@fineduc/domain'
import { encodePaymentReference, parsePayLinkToken } from '@fineduc/services'
import { readPaymentSettings, type PayLinkView, type InitiatePayLinkResult, type PaymentOperator } from '@fineduc/contracts'
import { PaymentProviderRegistry } from './provider.registry.js'

/**
 * The public pay page (ARCHITECTURE.md §8.2).
 *
 * Everything here runs for an UNAUTHENTICATED stranger holding a link, so it
 * is written to give away as little as possible: one 404 for every way a
 * token can be wrong — malformed, unknown, expired, already used — because
 * telling those apart tells a prober which tokens exist.
 *
 * The tenant comes out of the token itself. `payment_link` is RLS-protected
 * and this request has no authenticated user, so the token is the only thing
 * that can open a tenant context at all.
 */

const OPERATORS: readonly PaymentOperator[] = ['mtn', 'orange', 'moov', 'wave', 'card']

export interface InitiateParams {
  readonly amountMinor: bigint
  readonly operator: PaymentOperator
  readonly payerPhoneE164: string
  readonly payerName?: string
  readonly idempotencyKey: string
  readonly providerName: string
  readonly notifyUrl?: string
  readonly returnUrl?: string
}

@Injectable()
export class PayLinkService {
  constructor(private readonly registry: PaymentProviderRegistry) {}

  async view(prisma: PrismaClient, token: string): Promise<PayLinkView> {
    const parsed = parsePayLinkToken(token)
    if (!parsed) throw new NotFoundError('payment_link', 'token')

    return withTenant(prisma, parsed.tenantId, async (tx) => {
      const link = await this.loadUsableLink(tx, token)
      const currency = await this.currencyOf(tx, parsed.tenantId)
      const settings = await this.paymentSettingsOf(tx, parsed.tenantId)

      // A school that has not turned online collection on has no aggregator
      // account to collect INTO. Rendering a payable page anyway would take a
      // parent's money into the platform's account instead of the school's,
      // so the link is simply not usable — the same 404 as every other way a
      // token can be wrong, which is also what keeps this page opaque.
      if (!settings.enabled) throw new NotFoundError('payment_link', 'token')

      const invoice = await tx.invoice.findUnique({ where: { id: link.invoiceId } })
      if (!invoice) throw new NotFoundError('payment_link', 'token')

      const student = await tx.student.findUnique({ where: { id: link.studentId } })
      const enrollment = await tx.enrollment.findUnique({
        where: { id: invoice.enrollmentId },
        include: { classGroup: true },
      })
      const tenant = await tx.tenant.findUnique({ where: { id: parsed.tenantId } })
      if (!student || !enrollment || !tenant) throw new NotFoundError('payment_link', 'token')

      const instalment = link.instalmentId
        ? await tx.instalment.findUnique({ where: { id: link.instalmentId } })
        : null

      // A link for a named tranche suggests what that tranche still owes; a
      // general link suggests the whole balance. Either way it is only a
      // SUGGESTION — a family paying what they can afford is the normal case
      // here, not an edge case.
      const suggested =
        link.suggestedAmountMinor ??
        (instalment ? instalment.amountMinor - instalment.allocatedMinor : invoice.balanceMinor)

      return {
        schoolName: tenant.name,
        studentName: `${student.firstName} ${student.lastName}`,
        className: enrollment.classGroup.name,
        balance: this.money(invoice.balanceMinor, currency),
        suggestedAmount: this.money(suggested > 0n ? suggested : 0n, currency),
        minAmount: this.money(link.minAmountMinor ?? 0n, currency),
        instalmentLabel: instalment?.label ?? null,
        expiresAt: link.expiresAt.toISOString(),
        operators: settings.operators.length > 0 ? [...settings.operators] : [...OPERATORS],
      }
    })
  }

  /**
   * Create the pending payment and ask the aggregator to collect it.
   *
   * The amount is re-validated against the LIVE balance, not against whatever
   * the page was rendered with: a parent may have paid at the desk in the
   * minutes since, and charging them again for a debt that no longer exists
   * is the fastest way to lose a school.
   */
  async initiate(prisma: PrismaClient, token: string, params: InitiateParams): Promise<InitiatePayLinkResult> {
    const parsed = parsePayLinkToken(token)
    if (!parsed) throw new NotFoundError('payment_link', 'token')

    const provider = this.registry.get(params.providerName)

    // The payment row is created in its own transaction and committed BEFORE
    // the provider is called. If the provider call is what fails, we still
    // hold a pending payment we can reconcile; if we held the transaction
    // open across the network call instead, a slow aggregator would pin a
    // database connection and an invoice row lock for its whole timeout.
    const prepared = await withTenant(prisma, parsed.tenantId, async (tx) => {
      const link = await this.loadUsableLink(tx, token)
      const currency = await this.currencyOf(tx, parsed.tenantId)
      const settings = await this.paymentSettingsOf(tx, parsed.tenantId)
      // Checked again here, not just in `view`: the page could have been open
      // since before the school turned collection off.
      if (!settings.enabled) throw new NotFoundError('payment_link', 'token')
      if (settings.operators.length > 0 && !settings.operators.includes(params.operator)) {
        throw new NotFoundError('payment_link', 'token')
      }
      const amount = Money.of(params.amountMinor, currency)

      const replay = await tx.payment.findFirst({
        where: { tenantId: parsed.tenantId, idempotencyKey: params.idempotencyKey },
      })
      if (replay) {
        return { kind: 'replay' as const, replay, link, currency, amount }
      }

      const invoice = await tx.invoice.findUnique({ where: { id: link.invoiceId } })
      if (!invoice) throw new NotFoundError('payment_link', 'token')

      this.assertPayable(amount, invoice.balanceMinor, link.minAmountMinor)

      const payment = await tx.payment.create({
        data: {
          tenantId: parsed.tenantId,
          studentId: link.studentId,
          invoiceId: link.invoiceId,
          method: 'mobile_money',
          amountMinor: amount.amount,
          currency,
          status: initialStatus('mobile_money'),
          provider: provider.name,
          payerPhoneE164: params.payerPhoneE164,
          payerName: params.payerName ?? null,
          idempotencyKey: params.idempotencyKey,
        },
      })
      return { kind: 'created' as const, payment, link, currency, amount }
    })

    if (prepared.kind === 'replay') {
      // Already initiated with this key. Hand back what we have rather than
      // asking the aggregator to collect a second time.
      return {
        paymentId: prepared.replay.id,
        checkoutUrl: null,
        pushSent: false,
        status: prepared.replay.status,
      }
    }

    const { payment, link, amount } = prepared

    const result = await provider.initiate({
      // THE reference. Without it the worker cannot attribute the callback to
      // a tenant and the payment will never settle.
      reference: encodePaymentReference({ tenantId: parsed.tenantId, paymentId: payment.id }),
      amount,
      operator: params.operator,
      payerPhoneE164: params.payerPhoneE164,
      payerName: params.payerName,
      description: `Frais de scolarité — ${link.id}`,
      idempotencyKey: params.idempotencyKey,
      notifyUrl: params.notifyUrl,
      returnUrl: params.returnUrl,
    })

    await withTenant(prisma, parsed.tenantId, async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { providerRef: result.providerRef, status: result.status },
      })
      // Marked used only once the aggregator has accepted it. A link burnt on
      // a failed attempt would leave a parent holding a dead URL and no way
      // to pay.
      await tx.paymentLink.update({ where: { id: link.id }, data: { usedAt: new Date() } })
    })

    return {
      paymentId: payment.id,
      checkoutUrl: result.checkoutUrl ?? null,
      pushSent: result.pushSent,
      status: result.status,
    }
  }

  /**
   * One error for every way a token can be unusable.
   *
   * Distinguishing "expired" from "unknown" would confirm to a prober that a
   * token existed, and the parent needs the same next step either way: ask
   * the school for a new link.
   */
  private async loadUsableLink(tx: TenantTransactionClient, token: string) {
    const link = await tx.paymentLink.findUnique({ where: { token } })
    if (!link) throw new NotFoundError('payment_link', 'token')
    if (link.expiresAt.getTime() <= Date.now()) throw new NotFoundError('payment_link', 'token')
    return link
  }

  private assertPayable(amount: Money, balanceMinor: bigint, minAmountMinor: bigint | null): void {
    if (amount.amount <= 0n) {
      throw new ValidationError('pay_amount_not_positive', 'The amount must be more than zero.')
    }
    if (minAmountMinor && amount.amount < minAmountMinor) {
      throw new ValidationError(
        'pay_amount_below_minimum',
        `This link accepts at least ${minAmountMinor}.`,
      )
    }
    if (balanceMinor <= 0n) {
      throw new ConflictError(
        'INVOICE_ALREADY_SETTLED',
        'Nothing is owed on this invoice any more. If you have just paid, no further payment is needed.',
      )
    }
    if (amount.amount > balanceMinor) {
      throw new ValidationError(
        'pay_amount_above_balance',
        `Only ${balanceMinor} is still owed. Paying more would leave an unallocated credit.`,
      )
    }
  }

  private money(amountMinor: bigint, currency: CurrencyCode) {
    return { amountMinor: Money.of(amountMinor, currency).toWireString(), currency }
  }

  /**
   * Online collection is opt-in per school. A malformed settings blob reads
   * as OFF rather than on — the lenient schema's job — because the failure
   * that matters is taking money a school cannot receive.
   */
  private async paymentSettingsOf(tx: TenantTransactionClient, tenantId: string) {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)
    return readPaymentSettings(tenant.settings)
  }

  private async currencyOf(tx: TenantTransactionClient, tenantId: string): Promise<CurrencyCode> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)
    return assertCurrencyCode(tenant.currency)
  }
}
