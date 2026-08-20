import { Money } from '@fineduc/money'
import type { PaymentMethod } from '@fineduc/domain'
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
 * Cash, bank transfer and cheque — money that moves without a network.
 *
 * This adapter exists so the rest of the system never has to ask "is there a
 * provider for this?". A manual payment is recorded by a human who has
 * already seen the money, so `initiate` settles on the spot and there is no
 * aggregator to call.
 *
 * Every callback method throws rather than returning something harmless.
 * There is no such thing as a manual webhook, and a silent no-op here would
 * let a routing bug send a real provider's event down this path and quietly
 * discard it — the failure mode being that money settles nowhere and nobody
 * is told.
 */
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual'
  readonly supportedMethods: readonly PaymentMethod[] = ['cash', 'bank_transfer', 'cheque', 'waiver']

  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    if (request.amount.amount <= 0n) {
      throw new ProviderError(this.name, 'INVALID_AMOUNT', 'Amount must be positive.')
    }
    return {
      // The reference IS the record — a human wrote it on a receipt.
      providerRef: request.reference,
      pushSent: false,
      status: 'succeeded',
    }
  }

  async getStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    // Nothing to ask: if it was recorded, it happened.
    return { providerRef, status: 'succeeded' }
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification {
    void rawBody
    void headers
    return { valid: false, reason: 'the manual provider has no webhooks' }
  }

  parseWebhook(payload: unknown): NormalizedPaymentEvent {
    void payload
    throw new ProviderError(
      this.name,
      'NO_WEBHOOKS',
      'The manual provider has no webhooks. An event routed here means a provider was mis-resolved.',
    )
  }

  async refund(providerRef: string, amount: Money, reason: string): Promise<RefundResult> {
    void amount
    void reason
    // A manual refund is money handed back across a desk. Recording it is the
    // cashbox's job; there is nothing to call.
    return { providerRef, status: 'succeeded' }
  }
}
