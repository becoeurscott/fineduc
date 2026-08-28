import { createHmac, timingSafeEqual } from 'node:crypto'
import { Money, type CurrencyCode } from '@fineduc/money'
import type { PaymentMethod, PaymentStatus } from '@fineduc/domain'
import { getJson, postJson, type FetchLike, type HttpPolicy } from '../../http.js'
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
 * Moneroo — a hosted aggregator fronting MTN, Orange, Moov, Wave and card
 * across Africa. It is the provider Fineduc can actually use in Cameroon:
 * of the aggregators considered it is the only one whose mobile money covers
 * CEMAC/XAF at all, the others being UEMOA/XOF only.
 *
 * ⚠️ **UNVERIFIED AGAINST A LIVE ACCOUNT.** AGENTS.md forbids testing against
 * a real provider, so everything below is written from Moneroo's published v1
 * API and is proven only by the port contract suite. Three things must be
 * checked against a sandbox account before this handles real money, and they
 * are isolated here to make that cheap:
 *
 *   1. `STATUS_MAP` — their event names and free-text statuses. An unmapped
 *      value stays pending, never succeeded.
 *   2. That `X-Moneroo-Signature` is a hex HMAC-SHA256 over the RAW bytes.
 *      Wrong, and every callback is rejected as forged — which fails SAFE,
 *      but nothing settles.
 *   3. `MULTIPLE_OF_5` — whether Moneroo enforces the coin constraint the
 *      rails have, or passes a non-multiple through to a provider that then
 *      rejects it.
 */

const BASE_URL = 'https://api.moneroo.io'

/** Moneroo truncates nothing; over 200 characters is a 422. */
const MAX_DESCRIPTION = 200

/**
 * Their event names, and the free-text `data.status` that rides along with
 * them. Anything unmapped stays `pending` on purpose: an unknown value must
 * never be read as money that arrived.
 *
 * `payment.initiated` is informational — the row is already pending from
 * checkout — so it maps to pending rather than being treated as progress.
 */
const STATUS_MAP: Record<string, PaymentStatus> = {
  'PAYMENT.SUCCESS': 'succeeded',
  SUCCESS: 'succeeded',
  SUCCEEDED: 'succeeded',
  'PAYMENT.FAILED': 'failed',
  FAILED: 'failed',
  'PAYMENT.CANCELLED': 'failed',
  CANCELLED: 'failed',
  'PAYMENT.INITIATED': 'pending',
  PENDING: 'pending',
}

/**
 * The rails reject XAF/XOF amounts that are not a multiple of 5 — the
 * smallest circulating coin is 5 francs. Rejecting it here, naming the two
 * usable figures, beats a 422 from the aggregator that a parent reads as
 * "payment failed".
 */
const MULTIPLE_OF_5 = new Set<CurrencyCode>(['XAF', 'XOF'])

export interface MonerooOptions {
  readonly secretKey: string
  /** From Dashboard → Developers → Webhooks. Without it nothing can settle. */
  readonly webhookSecret: string
  readonly fetch: FetchLike
  readonly baseUrl?: string
  readonly policy?: HttpPolicy
}

export class MonerooProvider implements PaymentProvider {
  readonly name = 'moneroo'
  readonly supportedMethods: readonly PaymentMethod[] = ['mobile_money', 'card']

  private readonly options: MonerooOptions
  private readonly baseUrl: string

  constructor(options: MonerooOptions) {
    if (!options.secretKey) {
      // Fail at construction, not at the first payment. A misconfigured
      // provider discovered by a parent at a checkout is the worst place to
      // find out (ARCHITECTURE.md §9: credentials validated at boot).
      throw new ProviderError('moneroo', 'MISCONFIGURED', 'MONEROO_SECRET_KEY is required.')
    }
    this.options = options
    this.baseUrl = options.baseUrl ?? BASE_URL
  }

  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    if (request.amount.amount <= 0n) {
      throw new ProviderError(this.name, 'INVALID_AMOUNT', 'Amount must be positive.')
    }
    this.assertRailAcceptsAmount(request.amount)

    const { first, last } = splitName(request.payerName)

    const { status, body } = await postJson(
      `${this.baseUrl}/v1/payments/initialize`,
      {
        // Moneroo takes the SMALLEST unit. XAF and XOF have a zero exponent,
        // so minor units are whole francs and this is the figure as stored.
        amount: Number(request.amount.amount),
        currency: request.amount.currency,
        description: request.description.slice(0, MAX_DESCRIPTION),
        return_url: request.returnUrl,
        customer: {
          // Moneroo rejects a customer with no e-mail, and most parents
          // paying by mobile money have none. A placeholder on a domain we
          // control keeps the field honest — it is visibly not a mailbox —
          // without blocking a payment over an address nobody will read.
          email: request.payerEmail ?? placeholderEmail(request.payerPhoneE164),
          first_name: first,
          last_name: last,
          phone: request.payerPhoneE164,
        },
        // Every value must be a string or Moneroo 422s the whole request.
        metadata: {
          reference: request.reference,
          idempotencyKey: request.idempotencyKey,
          operator: request.operator,
        },
      },
      {
        fetch: this.options.fetch,
        policy: this.options.policy,
        headers: this.authHeaders(),
      },
    )

    const payload = asRecord(body)
    if (status >= 400) {
      throw new ProviderError(
        this.name,
        String(status),
        describeError(payload) ?? `Moneroo rejected the request (HTTP ${status})`,
        status >= 500,
      )
    }

    const data = asRecord(payload['data'])
    const id = data['id']
    const checkoutUrl = data['checkout_url']
    // A 200 with either field missing is a failure, not a success. Treating
    // it as one would leave a payment with no reference to settle against.
    if (typeof id !== 'string' || typeof checkoutUrl !== 'string') {
      throw new ProviderError(this.name, 'MALFORMED_RESPONSE', 'Moneroo returned no id or checkout_url.')
    }

    return {
      providerRef: id,
      checkoutUrl,
      // Moneroo always hosts the page; the PIN prompt is pushed from there.
      pushSent: false,
      // Never settled here. Only a webhook settles money (rule #6).
      status: 'pending',
    }
  }

  async getStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    const { status, body } = await getJson(`${this.baseUrl}/v1/payments/${encodeURIComponent(providerRef)}/verify`, {
      fetch: this.options.fetch,
      policy: this.options.policy,
      headers: this.authHeaders(),
    })

    if (status >= 500) {
      throw new ProviderError(this.name, String(status), 'Moneroo is unavailable.', true)
    }

    const data = asRecord(asRecord(body)['data'])
    return {
      providerRef,
      status: this.mapStatus(data['status']),
      paidAmount: readAmount(data['amount'], data['currency']),
      failureReason: describeError(asRecord(body)),
    }
  }

  /**
   * Verify BEFORE parsing. Constant-time comparison, and the length is
   * checked first because `timingSafeEqual` throws on a mismatch — the
   * length itself is not a secret.
   *
   * The HMAC covers the RAW bytes. Re-serialising parsed JSON changes key
   * order and whitespace, and every check then fails for a reason that takes
   * a day to find.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification {
    const provided = headers['x-moneroo-signature'] ?? headers['X-Moneroo-Signature']
    if (!provided) return { valid: false, reason: 'missing x-moneroo-signature header' }
    if (!this.options.webhookSecret) return { valid: false, reason: 'MONEROO_WEBHOOK_SECRET is not configured' }

    const expected = createHmac('sha256', this.options.webhookSecret).update(rawBody).digest('hex')

    const a = Buffer.from(expected)
    const b = Buffer.from(provided.trim())
    if (a.length !== b.length) return { valid: false, reason: 'signature length mismatch' }
    return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'signature mismatch' }
  }

  parseWebhook(payload: unknown): NormalizedPaymentEvent {
    const body = asRecord(payload)
    const data = asRecord(body['data'])
    const id = data['id']
    if (typeof id !== 'string' || id.length === 0) {
      throw new ProviderError(this.name, 'MALFORMED_EVENT', 'data.id is required.')
    }

    const event = typeof body['event'] === 'string' ? body['event'] : ''

    return {
      /*
       * Moneroo sends no delivery id, so one is derived.
       *
       * The published guidance is to hash the raw bytes, but this port hands
       * `parseWebhook` the PARSED payload, and a byte hash is the weaker key
       * regardless: a redelivery whose JSON is re-ordered hashes differently
       * and would be processed twice. Event name plus payment id dedups on
       * what the event actually IS — two `payment.success` for one payment
       * are the same event however they were serialised.
       */
      eventId: `${event || 'payment.unknown'}:${id}`,
      providerRef: id,
      // Our reference, echoed back in metadata. Without it the worker cannot
      // attribute the payment to a tenant.
      reference: readReference(data['metadata']),
      status: this.mapStatus(event, data['status']),
      paidAmount: readAmount(data['amount'], data['currency']),
      failureReason: describeError(body) ?? describeError(data),
      occurredAt: parseTimestamp(data['created_at'] ?? body['created_at']),
    }
  }

  async refund(providerRef: string, amount: Money, reason: string): Promise<RefundResult> {
    void providerRef
    void amount
    void reason
    /*
     * Moneroo's v1 checkout product exposes no refund endpoint — refunds are
     * raised from their dashboard.
     *
     * Throwing rather than returning `failed` is deliberate. A `failed`
     * refund reads as "we tried and the provider said no", which would send
     * a bursar looking for a provider-side problem that does not exist. This
     * says plainly that the action has to happen somewhere else.
     */
    throw new ProviderError(
      this.name,
      'REFUND_NOT_SUPPORTED',
      'Moneroo refunds are raised from their dashboard, not through the API. Record the refund here once it is done.',
    )
  }

  private authHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.secretKey}`,
      accept: 'application/json',
    }
  }

  private mapStatus(...candidates: unknown[]): PaymentStatus {
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || candidate.length === 0) continue
      const mapped = STATUS_MAP[candidate.toUpperCase()]
      if (mapped) return mapped
    }
    // Unknown value: pending, never success.
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
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * Moneroo requires both names and 422s on a missing one, so a single-word
 * name gets `-` for the surname rather than failing the payment.
 */
function splitName(payerName: string | undefined): { first: string; last: string } {
  const parts = (payerName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: 'Parent', last: '-' }
  if (parts.length === 1) return { first: parts[0]!, last: '-' }
  return { first: parts[0]!, last: parts.slice(1).join(' ') }
}

/** Visibly not a mailbox, on a domain we control, stable for one payer. */
function placeholderEmail(phoneE164: string): string {
  return `${phoneE164.replace(/[^\d]/g, '')}@no-email.fineduc.school`
}

/** Our reference, echoed back. Metadata values are strings by construction. */
function readReference(metadata: unknown): string | undefined {
  const value = asRecord(metadata)['reference']
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `currency` arrives as `"XAF"` on some endpoints and `{ code: "XAF" }` on others. */
function readAmount(amount: unknown, currency: unknown): Money | undefined {
  if (amount == null || String(amount).length === 0) return undefined
  const code = typeof currency === 'string' ? currency : asRecord(currency)['code']
  if (typeof code !== 'string') return undefined
  try {
    // Moneroo reports the smallest unit, which is what Money stores.
    return Money.of(BigInt(Math.trunc(Number(amount))), code as CurrencyCode)
  } catch {
    return undefined
  }
}

function describeError(payload: Record<string, unknown>): string | undefined {
  const errors = asRecord(payload['errors'])
  const firstField = Object.keys(errors)[0]
  if (firstField) {
    const messages = errors[firstField]
    const first = Array.isArray(messages) ? messages[0] : messages
    if (typeof first === 'string') return `${firstField}: ${first}`
  }
  const message = payload['message']
  return typeof message === 'string' && message.length > 0 ? message : undefined
}

/** ISO-8601 from Moneroo; falls back to now on anything else. */
function parseTimestamp(value: unknown): Date {
  if (typeof value !== 'string') return new Date()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}
