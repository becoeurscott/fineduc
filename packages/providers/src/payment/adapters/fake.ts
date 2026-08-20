import { createHmac, timingSafeEqual } from 'node:crypto'
import { Money } from '@fineduc/money'
import type { PaymentMethod, PaymentStatus } from '@fineduc/domain'
import {
  ProviderError,
  type InitiatePaymentRequest,
  type InitiatePaymentResult,
  type NormalizedPaymentEvent,
  type PaymentProvider,
  type ProviderPaymentStatus,
  type RefundResult,
  type WebhookVerification,
} from '../port.js'

/**
 * A deterministic in-memory provider, for tests.
 *
 * Deterministic is the whole point: the same reference always produces the
 * same providerRef, so a test can assert on it, and behaviour is steered by
 * explicit `scripted` outcomes rather than by chance. A fake that randomises
 * makes flaky tests, and a flaky money test gets muted.
 *
 * It implements the signature scheme for real — HMAC-SHA256 over the raw
 * body, compared in constant time — because the contract suite has to be
 * able to prove that an adapter rejects a bad signature, and a fake that
 * waves everything through cannot prove that of anything.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake'
  readonly supportedMethods: readonly PaymentMethod[] = ['mobile_money', 'card']

  private readonly secret: string
  private readonly initiated = new Map<string, { amount: Money; status: PaymentStatus }>()
  /** Outcomes queued by a test, keyed by our reference. */
  private readonly scripted = new Map<string, PaymentStatus>()
  private failNextInitiate: ProviderError | null = null

  constructor(options: { readonly secret?: string } = {}) {
    this.secret = options.secret ?? 'fake_webhook_secret'
  }

  /** Steer what the next webhook for `reference` will report. */
  script(reference: string, status: PaymentStatus): void {
    this.scripted.set(reference, status)
  }

  /** Make the next initiate() fail, to exercise the caller's error path. */
  failNext(error: ProviderError): void {
    this.failNextInitiate = error
  }

  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    if (this.failNextInitiate) {
      const error = this.failNextInitiate
      this.failNextInitiate = null
      throw error
    }
    if (request.amount.amount <= 0n) {
      throw new ProviderError(this.name, 'INVALID_AMOUNT', 'Amount must be positive.')
    }

    const providerRef = `fake_${request.reference}`
    this.initiated.set(providerRef, { amount: request.amount, status: 'pending' })

    return {
      providerRef,
      // Card goes to a hosted page; the mobile rails push a PIN prompt.
      checkoutUrl: request.operator === 'card' ? `https://fake.test/checkout/${providerRef}` : undefined,
      pushSent: request.operator !== 'card',
      status: 'pending',
    }
  }

  async getStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    const record = this.initiated.get(providerRef)
    if (!record) {
      throw new ProviderError(this.name, 'UNKNOWN_REF', `No such payment: ${providerRef}`)
    }
    return { providerRef, status: record.status, paidAmount: record.amount }
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification {
    const provided = headers['x-fake-signature'] ?? headers['X-Fake-Signature']
    if (!provided) return { valid: false, reason: 'missing signature header' }

    const expected = this.sign(rawBody)
    const a = Buffer.from(expected)
    const b = Buffer.from(provided)
    // Length must match before timingSafeEqual, which throws on a mismatch —
    // and the length itself is not a secret.
    if (a.length !== b.length) return { valid: false, reason: 'signature length mismatch' }
    return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'signature mismatch' }
  }

  parseWebhook(payload: unknown): NormalizedPaymentEvent {
    const body = payload as Record<string, unknown>
    const eventId = body['event_id']
    const providerRef = body['provider_ref']
    if (typeof eventId !== 'string' || typeof providerRef !== 'string') {
      throw new ProviderError(this.name, 'MALFORMED_EVENT', 'event_id and provider_ref are required.')
    }

    const reference = typeof body['reference'] === 'string' ? body['reference'] : undefined
    const scripted = reference ? this.scripted.get(reference) : undefined
    const status = (scripted ?? (body['status'] as PaymentStatus | undefined) ?? 'succeeded') as PaymentStatus

    const record = this.initiated.get(providerRef)
    if (record) record.status = status

    const amountMinor = body['amount_minor']
    const currency = (body['currency'] as string | undefined) ?? 'XAF'

    return {
      eventId,
      providerRef,
      reference,
      status,
      paidAmount:
        typeof amountMinor === 'string'
          ? Money.of(amountMinor, currency as 'XAF')
          : record?.amount,
      occurredAt: new Date(typeof body['occurred_at'] === 'string' ? body['occurred_at'] : 0),
    }
  }

  async refund(providerRef: string, amount: Money, reason: string): Promise<RefundResult> {
    void reason
    const record = this.initiated.get(providerRef)
    if (!record) {
      throw new ProviderError(this.name, 'UNKNOWN_REF', `No such payment: ${providerRef}`)
    }
    if (amount.amount > record.amount.amount) {
      throw new ProviderError(this.name, 'REFUND_TOO_LARGE', 'Refund exceeds the original payment.')
    }
    return { providerRef, status: 'succeeded' }
  }

  /** Exposed so a test can build a correctly-signed webhook. */
  sign(rawBody: Buffer): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex')
  }
}
