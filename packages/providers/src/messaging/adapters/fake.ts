/**
 * A deterministic in-memory messaging provider, for tests.
 *
 * Deterministic is the whole point: the same idempotency key always produces
 * the same id, and failures are steered by explicit `failNext` calls rather
 * than by chance. A fake that randomises makes flaky tests, and a flaky test
 * on a path that charges a school gets muted.
 *
 * Unlike the console adapter it keeps an `outbox`, so a test can assert what
 * a family would actually have received — the rendered body included, which
 * is how "no unresolved {{placeholder}} went out" becomes assertable.
 */
import type { Money } from '@fineduc/money'
import { ProviderError } from '../../provider-error.js'
import { DEFAULT_UNIT_COSTS, priceMessage, type UnitCosts } from '../cost.js'
import {
  assertChannel,
  assertE164,
  type Channel,
  type MessageDeliveryStatus,
  type MessagingProvider,
  type NormalizedMessageStatusEvent,
  type OutboundMessage,
  type SendResult,
} from '../port.js'

export interface FakeMessagingOptions {
  readonly costs?: UnitCosts
  readonly channels?: readonly Channel[]
}

export interface FakeSentMessage {
  readonly providerMessageId: string
  readonly toPhoneE164: string
  readonly channel: Channel
  readonly body: string
  readonly idempotencyKey: string
  readonly cost: Money
}

export class FakeMessagingProvider implements MessagingProvider {
  readonly name = 'fake'
  readonly channels: readonly Channel[]

  /** Everything this provider "delivered", in order. Read it in tests. */
  readonly outbox: FakeSentMessage[] = []

  private readonly costs: UnitCosts
  private readonly byKey = new Map<string, SendResult>()
  private failNextSend: ProviderError | null = null
  private counter = 0

  constructor(options: FakeMessagingOptions = {}) {
    this.costs = options.costs ?? DEFAULT_UNIT_COSTS
    this.channels = options.channels ?? ['whatsapp', 'sms']
  }

  /** Make the next send() fail, to exercise the sender's error path. */
  failNext(error: ProviderError): void {
    this.failNextSend = error
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    assertChannel(this.name, this.channels, message.channel)
    assertE164(this.name, message.toPhoneE164)
    if (message.body.trim().length === 0) {
      throw new ProviderError(this.name, 'EMPTY_BODY', 'Refusing to send an empty message.')
    }

    // The replay check comes BEFORE the scripted failure on purpose: a key
    // that already succeeded must not be made to fail by a later script, or
    // a test could "prove" a double-send that the real rule prevents.
    const replayed = this.byKey.get(message.idempotencyKey)
    if (replayed) return replayed

    if (this.failNextSend) {
      const error = this.failNextSend
      this.failNextSend = null
      throw error
    }

    this.counter += 1
    const result: SendResult = {
      providerMessageId: `fake_msg_${this.counter}`,
      status: 'sent',
      cost: this.estimateCost(message),
    }
    this.byKey.set(message.idempotencyKey, result)
    this.outbox.push({
      providerMessageId: result.providerMessageId,
      toPhoneE164: message.toPhoneE164,
      channel: message.channel,
      body: message.body,
      idempotencyKey: message.idempotencyKey,
      cost: result.cost,
    })
    return result
  }

  parseStatusWebhook(payload: unknown): readonly NormalizedMessageStatusEvent[] {
    const body = payload as Record<string, unknown>
    const raw = body['statuses']
    const entries = Array.isArray(raw) ? raw : [body]

    return entries.map((entry: unknown) => {
      const record = entry as Record<string, unknown>
      const eventId = record['event_id']
      const providerMessageId = record['provider_message_id']
      const status = record['status']

      if (typeof eventId !== 'string' || typeof providerMessageId !== 'string' || typeof status !== 'string') {
        throw new ProviderError(
          this.name,
          'MALFORMED_EVENT',
          'event_id, provider_message_id and status are required.',
        )
      }

      return {
        eventId,
        providerMessageId,
        status: status as MessageDeliveryStatus,
        errorCode: typeof record['error_code'] === 'string' ? record['error_code'] : undefined,
        occurredAt: new Date(typeof record['occurred_at'] === 'string' ? record['occurred_at'] : 0),
      }
    })
  }

  estimateCost(message: OutboundMessage): Money {
    assertChannel(this.name, this.channels, message.channel)
    return priceMessage(message.body, message.channel, this.costs)
  }
}
