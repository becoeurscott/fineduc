/**
 * The messaging port (ARCHITECTURE.md §9).
 *
 * No provider name appears in `packages/domain` or in any module service —
 * ever (AGENTS.md rule #8). The sender talks to a `MessagingProvider`; which
 * adapter is behind it is configuration.
 *
 * Adapters **never write to the database**. In particular an adapter never
 * debits the message credit wallet: the sender debits inside the transaction
 * that writes the `message` row, using `estimateCost`, and only then calls
 * out. An adapter that charged would be charging outside that transaction.
 *
 * `channels` is a LIST, unlike the singular `channel` first sketched in
 * ARCHITECTURE.md §9. Console and Fake genuinely serve both rails, and the
 * sender picks an adapter per channel, so the plural is the honest shape.
 */
import type { Money } from '@fineduc/money'
import { ProviderError } from '../provider-error.js'

export type Channel = 'whatsapp' | 'sms'

/**
 * Mirrors the `message_status` enum in the schema. `queued` and `sent` come
 * back from a send; the rest arrive later on a status callback.
 */
export type MessageDeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'undeliverable'

export interface OutboundMessage {
  readonly toPhoneE164: string
  readonly channel: Channel
  /** Already rendered by `packages/domain`'s `render`. Adapters never substitute. */
  readonly body: string
  /**
   * Replayed verbatim on a retry. An adapter MUST pass this to the provider
   * where the provider supports it, so a retried send does not message a
   * parent twice (AGENTS.md rule #5).
   */
  readonly idempotencyKey: string
  /**
   * WhatsApp requires a Meta-pre-approved template to open a conversation
   * outside the 24-hour service window. SMS ignores it.
   */
  readonly templateName?: string
  readonly templateVariables?: readonly string[]
  readonly locale?: string
}

export interface SendResult {
  /** The provider's own id. Stored on `message.provider_message_id`. */
  readonly providerMessageId: string
  readonly status: Extract<MessageDeliveryStatus, 'queued' | 'sent'>
  /**
   * What the provider says it cost. Reconciliation only — the wallet was
   * already debited with `estimateCost` before this call was made.
   */
  readonly cost: Money
}

export interface NormalizedMessageStatusEvent {
  /** The provider's unique id for the delivery, for de-duplicating a replay. */
  readonly eventId: string
  readonly providerMessageId: string
  readonly status: MessageDeliveryStatus
  /** Never contains the recipient's number (AGENTS.md rule #11). */
  readonly errorCode?: string
  readonly occurredAt: Date
}

export interface MessagingProvider {
  readonly name: string
  readonly channels: readonly Channel[]

  send(message: OutboundMessage): Promise<SendResult>

  /**
   * One callback can carry several statuses — WhatsApp batches them — so this
   * returns a list even when the list has one entry.
   */
  parseStatusWebhook(payload: unknown): readonly NormalizedMessageStatusEvent[]

  /**
   * What this message will cost, BEFORE sending it.
   *
   * This is not a nicety: the sender debits the prepaid wallet in the same
   * transaction as the `message` row, and it cannot debit an amount it does
   * not yet know. Must be exact for SMS, where one `ç` doubles the segment
   * count and therefore the bill.
   */
  estimateCost(message: OutboundMessage): Money
}

const E164 = /^\+[1-9]\d{6,14}$/

/**
 * Show enough of a number to debug with, never enough to identify a family.
 * Every adapter logs and errors through this — a phone number in a log line
 * is a defect, not a style question (AGENTS.md rule #11).
 */
export function redactPhone(phoneE164: string): string {
  if (phoneE164.length <= 6) return '***'
  return `${phoneE164.slice(0, 4)}***${phoneE164.slice(-2)}`
}

/**
 * Reject a malformed number before it reaches the wire, and reject it without
 * putting the number in the error message.
 */
export function assertE164(provider: string, phoneE164: string): void {
  if (!E164.test(phoneE164)) {
    throw new ProviderError(
      provider,
      'INVALID_PHONE',
      `Recipient is not a valid E.164 number: ${redactPhone(phoneE164)}`,
    )
  }
}

/** Reject a channel this adapter does not serve, rather than guessing one. */
export function assertChannel(provider: string, channels: readonly Channel[], channel: Channel): void {
  if (!channels.includes(channel)) {
    throw new ProviderError(provider, 'UNSUPPORTED_CHANNEL', `${provider} does not send on ${channel}.`)
  }
}
