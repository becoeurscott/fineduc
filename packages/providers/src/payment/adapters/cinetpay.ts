import { createHmac, timingSafeEqual } from 'node:crypto'
import { Money, exponentOf, type CurrencyCode } from '@fineduc/money'
import type { PaymentMethod, PaymentStatus } from '@fineduc/domain'
import { postJson, type FetchLike, type HttpPolicy } from '../../http.js'
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
 * CinetPay — the primary aggregator (ARCHITECTURE.md §9): MTN, Orange, Moov,
 * Wave and card across Cameroon, Côte d'Ivoire, Senegal, Burkina, Mali, Togo
 * and Benin.
 *
 * ⚠️ **UNVERIFIED AGAINST A LIVE ACCOUNT.** AGENTS.md forbids testing against
 * a real provider, so everything below is written from CinetPay's published
 * v2 API and is proven only by the port contract suite. Before this handles
 * real money, three things must be checked against their current docs and a
 * sandbox account, and they are isolated here to make that cheap:
 *
 *   1. `SIGNATURE_FIELDS` — the exact field order CinetPay concatenates
 *      before the HMAC. Get this wrong and every callback is rejected as
 *      forged, which fails SAFE but means nothing settles.
 *   2. `STATUS_MAP` — their result codes. An unmapped code is treated as
 *      pending, never as success.
 *   3. The endpoints and the `code === '201'` success convention.
 *
 * See docs/providers/cinetpay.md.
 */

const BASE_URL = 'https://api-checkout.cinetpay.com/v2'

/**
 * CinetPay signs the callback by concatenating these fields IN THIS ORDER
 * and HMAC-SHA256'ing the result with the site's secret key. The order is
 * load-bearing and is the single most likely thing to be wrong here.
 */
const SIGNATURE_FIELDS = [
  'cpm_site_id',
  'cpm_trans_id',
  'cpm_trans_date',
  'cpm_amount',
  'cpm_currency',
  'signature',
  'payment_method',
  'cel_phone_num',
  'cpm_phone_prefixe',
  'cpm_language',
  'cpm_version',
  'cpm_payment_config',
  'cpm_page_action',
  'cpm_custom',
  'cpm_designation',
  'cpm_error_message',
] as const

/**
 * Their result codes. Anything unmapped stays `pending` on purpose: an
 * unknown code must never be read as money that arrived.
 */
const STATUS_MAP: Record<string, PaymentStatus> = {
  '00': 'succeeded',
  ACCEPTED: 'succeeded',
  SUCCES: 'succeeded',
  '600': 'failed',
  '602': 'failed',
  '604': 'failed',
  REFUSED: 'failed',
  '623': 'expired',
  EXPIRED: 'expired',
  WAITING_FOR_CUSTOMER: 'processing',
  PENDING: 'processing',
}

/**
 * CinetPay rejects XOF/XAF amounts that are not a multiple of 5.
 *
 * This is a real constraint of the rail, not a CinetPay quirk — the smallest
 * circulating coin is 5 francs. Rejecting it here, with the nearest usable
 * figures named, beats a 400 from the aggregator that a parent reads as
 * "payment failed".
 */
const MULTIPLE_OF_5 = new Set<CurrencyCode>(['XAF', 'XOF'])

export interface CinetPayOptions {
  readonly apiKey: string
  readonly siteId: string
  readonly secretKey: string
  readonly fetch: FetchLike
  readonly baseUrl?: string
  readonly policy?: HttpPolicy
}

export class CinetPayProvider implements PaymentProvider {
  readonly name = 'cinetpay'
  readonly supportedMethods: readonly PaymentMethod[] = ['mobile_money', 'card']

  private readonly options: CinetPayOptions
  private readonly baseUrl: string

  constructor(options: CinetPayOptions) {
    if (!options.apiKey || !options.siteId) {
      // Fail at construction, not at the first payment. A misconfigured
      // provider discovered by a parent at a checkout is the worst place to
      // find out (ARCHITECTURE.md §9: credentials validated at boot).
      throw new ProviderError('cinetpay', 'MISCONFIGURED', 'CINETPAY_API_KEY and CINETPAY_SITE_ID are required.')
    }
    this.options = options
    this.baseUrl = options.baseUrl ?? BASE_URL
  }

  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    if (request.amount.amount <= 0n) {
      throw new ProviderError(this.name, 'INVALID_AMOUNT', 'Amount must be positive.')
    }
    this.assertRailAcceptsAmount(request.amount)

    const { status, body } = await postJson(
      `${this.baseUrl}/payment`,
      {
        apikey: this.options.apiKey,
        site_id: this.options.siteId,
        transaction_id: request.reference,
        // CinetPay takes MAJOR units. XAF has a zero exponent so this is the
        // same integer, but going through the exponent keeps a two-decimal
        // currency from being sent 100x wrong if one is ever added.
        amount: this.toMajorUnits(request.amount),
        currency: request.amount.currency,
        description: request.description,
        customer_phone_number: request.payerPhoneE164,
        customer_name: request.payerName ?? '',
        channels: request.operator === 'card' ? 'CREDIT_CARD' : 'MOBILE_MONEY',
        notify_url: request.notifyUrl,
        return_url: request.returnUrl,
        // Echoed back on the callback. This is how the worker attributes a
        // payment to a tenant — see packages/services payment-reference.
        metadata: request.reference,
      },
      { fetch: this.options.fetch, policy: this.options.policy },
    )

    const payload = asRecord(body)
    // CinetPay signals success with code "201", not the HTTP status.
    if (status >= 400 || payload['code'] !== '201') {
      throw new ProviderError(
        this.name,
        String(payload['code'] ?? status),
        String(payload['message'] ?? `CinetPay rejected the request (HTTP ${status})`),
        status >= 500,
      )
    }

    const data = asRecord(payload['data'])
    const token = data['payment_token']
    if (typeof token !== 'string') {
      throw new ProviderError(this.name, 'MALFORMED_RESPONSE', 'CinetPay returned no payment_token.')
    }

    return {
      providerRef: token,
      checkoutUrl: typeof data['payment_url'] === 'string' ? data['payment_url'] : undefined,
      // CinetPay always hosts the page, even for mobile money; the PIN prompt
      // is pushed from there, not by us.
      pushSent: false,
      // Never settled here. Only a webhook settles money (rule #6).
      status: 'pending',
    }
  }

  async getStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    const { status, body } = await postJson(
      `${this.baseUrl}/payment/check`,
      { apikey: this.options.apiKey, site_id: this.options.siteId, transaction_id: providerRef },
      { fetch: this.options.fetch, policy: this.options.policy },
    )

    const payload = asRecord(body)
    if (status >= 500) {
      throw new ProviderError(this.name, String(status), 'CinetPay is unavailable.', true)
    }

    const data = asRecord(payload['data'])
    return {
      providerRef,
      status: this.mapStatus(payload['code'], data['status']),
      failureReason: typeof payload['message'] === 'string' ? payload['message'] : undefined,
    }
  }

  /**
   * Verify BEFORE parsing. Constant-time comparison, and the length is
   * checked first because `timingSafeEqual` throws on a mismatch — the
   * length itself is not a secret.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification {
    const provided = headers['x-token'] ?? headers['X-Token']
    if (!provided) return { valid: false, reason: 'missing x-token header' }
    if (!this.options.secretKey) return { valid: false, reason: 'CINETPAY_WEBHOOK_SECRET is not configured' }

    let fields: Record<string, unknown>
    try {
      fields = asRecord(JSON.parse(rawBody.toString('utf8')))
    } catch {
      // Form-encoded is CinetPay's other callback shape.
      fields = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')))
    }

    const expected = createHmac('sha256', this.options.secretKey)
      .update(SIGNATURE_FIELDS.map((field) => String(fields[field] ?? '')).join(''))
      .digest('hex')

    const a = Buffer.from(expected)
    const b = Buffer.from(provided)
    if (a.length !== b.length) return { valid: false, reason: 'signature length mismatch' }
    return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'signature mismatch' }
  }

  parseWebhook(payload: unknown): NormalizedPaymentEvent {
    const body = asRecord(payload)
    const transId = body['cpm_trans_id']
    if (typeof transId !== 'string' || transId.length === 0) {
      throw new ProviderError(this.name, 'MALFORMED_EVENT', 'cpm_trans_id is required.')
    }

    const currency = typeof body['cpm_currency'] === 'string' ? body['cpm_currency'] : 'XAF'
    const amount = body['cpm_amount']

    return {
      // CinetPay has no separate delivery id, so the transaction id is the
      // idempotency key. Two callbacks for one transaction ARE the same event.
      eventId: transId,
      providerRef: transId,
      // Our reference, echoed back in cpm_custom. Without it the worker
      // cannot attribute the payment to a tenant.
      reference: typeof body['cpm_custom'] === 'string' ? body['cpm_custom'] : undefined,
      status: this.mapStatus(body['cpm_result'], body['cpm_error_message']),
      paidAmount:
        amount != null && String(amount).length > 0
          ? Money.ofMajor(String(amount), currency as CurrencyCode)
          : undefined,
      failureReason: typeof body['cpm_error_message'] === 'string' ? body['cpm_error_message'] : undefined,
      occurredAt: parseTransDate(body['cpm_trans_date']),
    }
  }

  async refund(providerRef: string, amount: Money, reason: string): Promise<RefundResult> {
    void providerRef
    void amount
    void reason
    /*
     * CinetPay has no self-service refund API on the v2 checkout product;
     * refunds go through their back office.
     *
     * Throwing rather than returning `failed` is deliberate. A `failed`
     * refund reads as "we tried and the provider said no", which would send
     * a bursar looking for a provider-side problem that does not exist. This
     * says plainly that the action has to happen somewhere else.
     */
    throw new ProviderError(
      this.name,
      'REFUND_NOT_SUPPORTED',
      'CinetPay refunds are processed in their back office, not through the API. Record the refund here once it is done.',
    )
  }

  private mapStatus(...candidates: unknown[]): PaymentStatus {
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const mapped = STATUS_MAP[candidate.toUpperCase()] ?? STATUS_MAP[candidate]
      if (mapped) return mapped
    }
    // Unknown code: pending, never success.
    return 'pending'
  }

  private assertRailAcceptsAmount(amount: Money): void {
    if (!MULTIPLE_OF_5.has(amount.currency)) return
    if (amount.amount % 5n === 0n) return
    const down = amount.amount - (amount.amount % 5n)
    throw new ProviderError(
      this.name,
      'AMOUNT_NOT_MULTIPLE_OF_5',
      `${amount.currency} amounts must be a multiple of 5. Try ${down} or ${down + 5n}.`,
    )
  }

  private toMajorUnits(amount: Money): string {
    const exponent = exponentOf(amount.currency)
    if (exponent === 0) return amount.amount.toString()
    const divisor = 10n ** BigInt(exponent)
    return `${amount.amount / divisor}.${(amount.amount % divisor).toString().padStart(exponent, '0')}`
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** `YYYY-MM-DD HH:mm:ss` in their timezone; falls back to now on anything else. */
function parseTransDate(value: unknown): Date {
  if (typeof value !== 'string') return new Date()
  const parsed = new Date(value.replace(' ', 'T') + 'Z')
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}
