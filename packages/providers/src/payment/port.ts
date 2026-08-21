/**
 * The payment port (ARCHITECTURE.md §9).
 *
 * No provider name appears in `packages/domain` or in any module service —
 * ever (AGENTS.md rule #8). Everything above this line talks to a
 * `PaymentProvider`; everything below it translates for one aggregator.
 *
 * Adapters **never write to the database**. They translate, call, and return
 * a normalised result. That is what makes the contract suite meaningful: a
 * new provider is proven by making the same tests pass, not by reading its
 * documentation and hoping.
 */
import type { Money } from '@fineduc/money'
import type { PaymentMethod, PaymentStatus } from '@fineduc/domain'

/** The mobile-money rails a payer picks between. `card` is the fallback. */
export type PaymentOperator = 'mtn' | 'orange' | 'moov' | 'wave' | 'card'

export interface InitiatePaymentRequest {
  /** OUR reference, not the provider's. Echoed back on the webhook. */
  readonly reference: string
  readonly amount: Money
  readonly operator: PaymentOperator
  readonly payerPhoneE164: string
  readonly payerName?: string
  readonly description: string
  /**
   * Replayed verbatim on a retry. An adapter MUST pass this to the provider
   * where the provider supports it, so a retried initiate does not charge a
   * parent twice (AGENTS.md rule #5).
   */
  readonly idempotencyKey: string
  readonly returnUrl?: string
  readonly notifyUrl?: string
}

export interface InitiatePaymentResult {
  /** The provider's own id for this attempt. Stored on the payment row. */
  readonly providerRef: string
  /** Where to send the payer, when the provider uses a hosted page. */
  readonly checkoutUrl?: string
  /** True when the provider pushed a USSD/PIN prompt instead. */
  readonly pushSent: boolean
  readonly status: PaymentStatus
}

export interface ProviderPaymentStatus {
  readonly providerRef: string
  readonly status: PaymentStatus
  readonly paidAmount?: Money
  readonly providerFee?: Money
  readonly failureReason?: string
}

export interface WebhookVerification {
  readonly valid: boolean
  /** Populated when invalid, for the alert. Never contains the secret. */
  readonly reason?: string
}

/**
 * A provider event, flattened to what the settlement path actually needs.
 *
 * `eventId` is the provider's own unique id for the delivery and is what
 * `provider_event` is unique on — it is the idempotency guard for a webhook
 * delivered twice (ARCHITECTURE.md §8.2).
 */
export interface NormalizedPaymentEvent {
  readonly eventId: string
  readonly providerRef: string
  /** Our reference, echoed back. Present when the provider preserves it. */
  readonly reference?: string
  readonly status: PaymentStatus
  readonly paidAmount?: Money
  readonly providerFee?: Money
  readonly failureReason?: string
  readonly occurredAt: Date
}

export interface RefundResult {
  readonly providerRef: string
  readonly status: 'pending' | 'succeeded' | 'failed'
  readonly failureReason?: string
}

export interface PaymentProvider {
  readonly name: string
  readonly supportedMethods: readonly PaymentMethod[]

  initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult>
  getStatus(providerRef: string): Promise<ProviderPaymentStatus>

  /**
   * Verify BEFORE parsing. The webhook endpoint is public and therefore
   * hostile territory: an attacker's payload must never reach a parser, let
   * alone the settlement path, on the strength of an unchecked signature.
   *
   * Takes the RAW body — re-serialising parsed JSON changes the bytes and
   * every HMAC check then fails for reasons that take a day to find.
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification
  parseWebhook(payload: unknown): NormalizedPaymentEvent

  refund(providerRef: string, amount: Money, reason: string): Promise<RefundResult>
}

/**
 * Raised when a provider rejects a request for a reason the caller can act on.
 * Defined one level up and re-exported here, because the messaging port raises
 * the same type — see `../provider-error.ts`.
 */
export { ProviderError } from '../provider-error.js'
