/**
 * The dev adapter: logs instead of sending.
 *
 * It exists so a developer can run the whole reminder path — scheduler,
 * sender, credit debit, status flip — without a WhatsApp number, an
 * aggregator account, or the ability to message a real family by accident.
 * AGENTS.md forbids sending a real message from a dev or test environment;
 * this is what that rule leaves you with.
 *
 * It logs a REDACTED number. A dev adapter that printed the real one would
 * put phone numbers in terminal scrollback, in CI output, and eventually in
 * a pasted bug report (AGENTS.md rule #11).
 */
import type { Money } from '@fineduc/money'
import { ProviderError } from '../../provider-error.js'
import { DEFAULT_UNIT_COSTS, priceMessage, type UnitCosts } from '../cost.js'
import {
  assertChannel,
  assertE164,
  redactPhone,
  type Channel,
  type MessagingProvider,
  type NormalizedMessageStatusEvent,
  type OutboundMessage,
  type SendResult,
} from '../port.js'

export interface ConsoleMessagingOptions {
  readonly costs?: UnitCosts
  /** Swappable so a test can assert on the line without capturing stdout. */
  readonly log?: (line: string) => void
}

export class ConsoleMessagingProvider implements MessagingProvider {
  readonly name = 'console'
  readonly channels: readonly Channel[] = ['whatsapp', 'sms']

  private readonly costs: UnitCosts
  private readonly log: (line: string) => void
  /** Keyed by idempotency key, so a replay logs once and returns the same id. */
  private readonly sentByKey = new Map<string, SendResult>()
  private counter = 0

  constructor(options: ConsoleMessagingOptions = {}) {
    this.costs = options.costs ?? DEFAULT_UNIT_COSTS
    this.log = options.log ?? ((line) => console.info(line))
  }

  /** How many messages were actually logged, for the contract suite. */
  get sentCount(): number {
    return this.sentByKey.size
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    assertChannel(this.name, this.channels, message.channel)
    assertE164(this.name, message.toPhoneE164)
    if (message.body.trim().length === 0) {
      throw new ProviderError(this.name, 'EMPTY_BODY', 'Refusing to send an empty message.')
    }

    const replayed = this.sentByKey.get(message.idempotencyKey)
    if (replayed) return replayed

    this.counter += 1
    const result: SendResult = {
      providerMessageId: `console_${this.counter}`,
      status: 'sent',
      cost: this.estimateCost(message),
    }
    this.sentByKey.set(message.idempotencyKey, result)

    this.log(
      `[console:${message.channel}] → ${redactPhone(message.toPhoneE164)} (${result.cost.toWireString()} ${result.cost.currency}): ${message.body}`,
    )
    return result
  }

  /**
   * There is no console to call us back. Throwing is the point: returning an
   * empty list would read as "the provider reported nothing wrong", and the
   * sender would treat a message it can never confirm as fine.
   */
  parseStatusWebhook(payload: unknown): readonly NormalizedMessageStatusEvent[] {
    void payload
    throw new ProviderError(this.name, 'NO_STATUS_WEBHOOKS', 'The console adapter has no delivery callbacks.')
  }

  estimateCost(message: OutboundMessage): Money {
    assertChannel(this.name, this.channels, message.channel)
    return priceMessage(message.body, message.channel, this.costs)
  }
}
