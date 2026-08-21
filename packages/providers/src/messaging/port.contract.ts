import { describe, it, expect } from 'vitest'
import { ProviderError } from '../provider-error.js'
import type { Channel, MessagingProvider, OutboundMessage } from './port.js'

/**
 * THE messaging contract suite (AGENTS.md, ARCHITECTURE.md §9).
 *
 * "Every adapter is fully exercised by contract tests written against the
 * PORT, so a new provider is proven by making the same suite pass."
 *
 * Exported as a function rather than written as a test file, so each adapter's
 * spec calls it in one line. The payment suite (`payment/port.contract.ts`)
 * taught the lesson this one is built on: a contract encodes assumptions, and
 * an assumption that is not universal must become an explicit capability
 * rather than silently constraining every future adapter.
 *
 * `capabilities` lets an adapter opt out of what it genuinely cannot do
 * WITHOUT weakening the suite: an opted-out capability is asserted to fail
 * LOUDLY rather than skipped.
 */
export interface MessagingCapabilities {
  /** False for adapters with no delivery callbacks at all — Console has none. */
  readonly statusWebhooks: boolean
  /** A callback body this adapter should parse successfully. */
  readonly sampleStatusWebhook?: (providerMessageId: string) => unknown
  /**
   * How many messages this provider has actually delivered. Supplied by
   * adapters that can observe it, so idempotency is proven by counting
   * deliveries rather than by trusting a returned id.
   */
  readonly sentCount?: (provider: MessagingProvider) => number
}

function message(over: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    toPhoneE164: '+237600000001',
    channel: 'sms',
    body: 'Rappel : la tranche 1 est due le 15/09.',
    idempotencyKey: '11111111-1111-1111-1111-111111111111',
    locale: 'fr',
    ...over,
  }
}

export function runMessagingProviderContract(
  makeProvider: () => MessagingProvider,
  capabilities: MessagingCapabilities,
): void {
  describe(`messaging provider contract: ${makeProvider().name}`, () => {
    /** Every assertion runs on a rail the adapter actually serves. */
    const anyChannel = (): Channel => makeProvider().channels[0] as Channel

    it('declares a name and at least one channel', () => {
      const provider = makeProvider()
      expect(provider.name).toBeTruthy()
      expect(provider.channels.length).toBeGreaterThan(0)
    })

    describe('send', () => {
      it('returns a provider message id', async () => {
        const result = await makeProvider().send(message({ channel: anyChannel() }))
        expect(result.providerMessageId).toBeTruthy()
      })

      it('reports a status the sender can store, never a settled-looking one', async () => {
        const result = await makeProvider().send(message({ channel: anyChannel() }))
        // `delivered` and `read` only ever arrive on a callback. An adapter
        // that claimed them here would let the sender record a delivery the
        // network has not confirmed.
        expect(['queued', 'sent']).toContain(result.status)
      })

      it('rejects an empty body rather than spending a credit on nothing', async () => {
        await expect(makeProvider().send(message({ channel: anyChannel(), body: '' }))).rejects.toThrow(ProviderError)
      })

      it('rejects a number that is not E.164, before calling out', async () => {
        await expect(
          makeProvider().send(message({ channel: anyChannel(), toPhoneE164: '0600000001' })),
        ).rejects.toThrow(ProviderError)
      })

      /**
       * Rule #11 enforced at the port, not left to each adapter's judgement.
       * An adapter that echoes the number into its error message puts it in
       * every log line that catches the error — which is exactly how phone
       * numbers end up in log aggregation.
       */
      it('does not put the recipient number in the error message', async () => {
        const number = '+237699887766'
        let caught: unknown
        try {
          // Valid-looking but too long, so it fails validation while still
          // containing a real number an adapter might be tempted to echo.
          await makeProvider().send(message({ channel: anyChannel(), toPhoneE164: `${number}9999` }))
        } catch (error) {
          caught = error
        }

        expect(caught).toBeInstanceOf(ProviderError)
        expect((caught as Error).message).not.toContain(number)
      })

      it('rejects a channel it does not serve, rather than picking one', async () => {
        const provider = makeProvider()
        const unsupported = (['whatsapp', 'sms'] as const).find((c) => !provider.channels.includes(c))
        if (!unsupported) return
        await expect(provider.send(message({ channel: unsupported }))).rejects.toThrow(ProviderError)
      })

      /**
       * The single most expensive bug this port can have. The sender debits a
       * prepaid wallet and then calls out; if the job is retried after a
       * timeout that actually succeeded, an un-idempotent adapter messages a
       * family twice and charges the school twice.
       */
      it('sends once for a replayed idempotency key', async () => {
        const provider = makeProvider()
        const outbound = message({ channel: anyChannel() })

        const first = await provider.send(outbound)
        const second = await provider.send(outbound)

        expect(second.providerMessageId).toBe(first.providerMessageId)
        if (capabilities.sentCount) {
          expect(capabilities.sentCount(provider)).toBe(1)
        }
      })

      it('treats a different idempotency key as a different message', async () => {
        const provider = makeProvider()
        const first = await provider.send(message({ channel: anyChannel() }))
        const second = await provider.send(
          message({ channel: anyChannel(), idempotencyKey: '22222222-2222-2222-2222-222222222222' }),
        )
        expect(second.providerMessageId).not.toBe(first.providerMessageId)
      })
    })

    describe('estimateCost', () => {
      it('returns a positive amount in whole minor units', () => {
        const cost = makeProvider().estimateCost(message({ channel: anyChannel() }))
        expect(cost.amount).toBeGreaterThan(0n)
        expect(typeof cost.amount).toBe('bigint')
      })

      /**
       * `reçu`, `français`, `coût` force UCS-2 and more than halve the segment
       * size. A school is billed for that, so an estimate that ignores it
       * under-debits the wallet on the messages this product sends most.
       */
      it('charges more for an SMS body that forces UCS-2', () => {
        const provider = makeProvider()
        if (!provider.channels.includes('sms')) return

        const gsm7 = 'a'.repeat(160)
        const ucs2 = `ç${'a'.repeat(159)}`

        const cheap = provider.estimateCost(message({ channel: 'sms', body: gsm7 }))
        const dear = provider.estimateCost(message({ channel: 'sms', body: ucs2 }))
        expect(dear.amount).toBeGreaterThan(cheap.amount)
      })

      it('refuses to price a channel it does not serve', () => {
        const provider = makeProvider()
        const unsupported = (['whatsapp', 'sms'] as const).find((c) => !provider.channels.includes(c))
        if (!unsupported) return
        expect(() => provider.estimateCost(message({ channel: unsupported }))).toThrow(ProviderError)
      })
    })

    describe('parseStatusWebhook', () => {
      it('normalises a callback to eventId, providerMessageId and status', async () => {
        if (!capabilities.statusWebhooks || !capabilities.sampleStatusWebhook) return
        const provider = makeProvider()
        const sent = await provider.send(message({ channel: anyChannel() }))

        const events = provider.parseStatusWebhook(capabilities.sampleStatusWebhook(sent.providerMessageId))

        expect(events.length).toBeGreaterThan(0)
        const [event] = events
        expect(event?.eventId).toBeTruthy()
        expect(event?.providerMessageId).toBe(sent.providerMessageId)
        expect(event?.status).toBeTruthy()
        expect(event?.occurredAt).toBeInstanceOf(Date)
      })

      it('throws on a malformed payload rather than returning a half-event', () => {
        if (!capabilities.statusWebhooks) return
        expect(() => makeProvider().parseStatusWebhook({ nothing: true })).toThrow(ProviderError)
      })

      /**
       * Opting out is not a free pass. An adapter with no callbacks that
       * returned `[]` would look like a delivery report that said nothing
       * happened, and the sender would never learn a message failed.
       */
      it('throws for an adapter that has no callbacks, rather than returning nothing', () => {
        if (capabilities.statusWebhooks) return
        expect(() => makeProvider().parseStatusWebhook({})).toThrow(ProviderError)
      })
    })
  })
}
