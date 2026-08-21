import { describe, it, expect } from 'vitest'
import { ProviderError } from '../../provider-error.js'
import { runMessagingProviderContract } from '../port.contract.js'
import { ConsoleMessagingProvider } from './console.js'
import { FakeMessagingProvider } from './fake.js'

/**
 * Every adapter runs the SAME suite. That is the rule (ARCHITECTURE.md §9):
 * a new provider is proven by making these pass, not by reading its docs.
 */

runMessagingProviderContract(() => new ConsoleMessagingProvider({ log: () => {} }), {
  statusWebhooks: false,
  sentCount: (provider) => (provider as ConsoleMessagingProvider).sentCount,
})

runMessagingProviderContract(() => new FakeMessagingProvider(), {
  statusWebhooks: true,
  sampleStatusWebhook: (providerMessageId) => ({
    event_id: 'evt_1',
    provider_message_id: providerMessageId,
    status: 'delivered',
    occurred_at: '2026-09-15T09:00:00.000Z',
  }),
  sentCount: (provider) => (provider as FakeMessagingProvider).outbox.length,
})

/**
 * A third configuration purely so the "refuses a channel it does not serve"
 * assertions actually run: both real adapters serve both rails, so without a
 * single-channel provider those two tests would silently return early — and a
 * contract test that never executes proves nothing.
 */
runMessagingProviderContract(() => new FakeMessagingProvider({ channels: ['sms'] }), {
  statusWebhooks: true,
  sampleStatusWebhook: (providerMessageId) => ({
    event_id: 'evt_1',
    provider_message_id: providerMessageId,
    status: 'delivered',
    occurred_at: '2026-09-15T09:00:00.000Z',
  }),
})

/* --------------------------------------------------- adapter-specific ---- */

const outbound = {
  toPhoneE164: '+237600000001',
  channel: 'sms' as const,
  body: 'Rappel : la tranche 1 est due le 15/09.',
  idempotencyKey: '11111111-1111-1111-1111-111111111111',
  locale: 'fr',
}

describe('ConsoleMessagingProvider', () => {
  it('logs a redacted number, never the real one', async () => {
    const lines: string[] = []
    const provider = new ConsoleMessagingProvider({ log: (line) => lines.push(line) })

    await provider.send(outbound)

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('+237600000001')
    expect(lines[0]).toContain('+237***01')
  })

  it('logs the rendered body, so a dev can see what a family would read', async () => {
    const lines: string[] = []
    const provider = new ConsoleMessagingProvider({ log: (line) => lines.push(line) })

    await provider.send(outbound)

    expect(lines[0]).toContain('la tranche 1 est due le 15/09')
  })

  it('logs once for a replayed key, so a retry does not look like two messages', async () => {
    const lines: string[] = []
    const provider = new ConsoleMessagingProvider({ log: (line) => lines.push(line) })

    await provider.send(outbound)
    await provider.send(outbound)

    expect(lines).toHaveLength(1)
  })
})

describe('FakeMessagingProvider', () => {
  it('records what a family would have received', async () => {
    const provider = new FakeMessagingProvider()
    await provider.send(outbound)

    expect(provider.outbox).toHaveLength(1)
    const [sent] = provider.outbox
    expect(sent?.body).toBe(outbound.body)
    expect(sent?.channel).toBe('sms')
  })

  it('can be told to fail a send, to exercise the sender error path', async () => {
    const provider = new FakeMessagingProvider()
    provider.failNext(new ProviderError('fake', 'RATE_LIMITED', 'Slow down.', true))

    await expect(provider.send(outbound)).rejects.toThrow(ProviderError)
    expect(provider.outbox).toHaveLength(0)
  })

  /**
   * The ordering inside send() that this pins: a key that already succeeded
   * is returned before the scripted failure is consulted. Otherwise a test
   * could script a failure onto an already-delivered message and "prove" a
   * double-send that the real rule prevents.
   */
  it('replays a successful key even when a failure has been scripted', async () => {
    const provider = new FakeMessagingProvider()
    const first = await provider.send(outbound)

    provider.failNext(new ProviderError('fake', 'BOOM', 'Should not surface.'))
    const second = await provider.send(outbound)

    expect(second.providerMessageId).toBe(first.providerMessageId)
    expect(provider.outbox).toHaveLength(1)
  })

  it('parses a batch of statuses, because WhatsApp sends them batched', async () => {
    const provider = new FakeMessagingProvider()
    const sent = await provider.send(outbound)

    const events = provider.parseStatusWebhook({
      statuses: [
        { event_id: 'e1', provider_message_id: sent.providerMessageId, status: 'sent', occurred_at: '2026-09-15T09:00:00.000Z' },
        { event_id: 'e2', provider_message_id: sent.providerMessageId, status: 'delivered', occurred_at: '2026-09-15T09:00:05.000Z' },
      ],
    })

    expect(events).toHaveLength(2)
    expect(events.map((e) => e.status)).toEqual(['sent', 'delivered'])
  })

  it('surfaces an error code without the recipient number', async () => {
    const provider = new FakeMessagingProvider()
    const sent = await provider.send(outbound)

    const [event] = provider.parseStatusWebhook({
      event_id: 'e1',
      provider_message_id: sent.providerMessageId,
      status: 'undeliverable',
      error_code: 'INVALID_RECIPIENT',
      occurred_at: '2026-09-15T09:00:00.000Z',
    })

    expect(event?.status).toBe('undeliverable')
    expect(event?.errorCode).toBe('INVALID_RECIPIENT')
  })
})

describe('pricing', () => {
  it('charges 10 XAF for WhatsApp and 30 XAF for a one-segment SMS (PRD.md)', () => {
    const provider = new FakeMessagingProvider()

    expect(provider.estimateCost({ ...outbound, channel: 'whatsapp' }).amount).toBe(10n)
    expect(provider.estimateCost({ ...outbound, channel: 'sms' }).amount).toBe(30n)
  })

  /**
   * "Reçu" is a word this product sends on every cash payment. The ç forces
   * UCS-2, which drops the segment size from 160 to 70 — so a body that fits
   * one segment in plain ASCII costs three segments with one accent in it.
   */
  it('prices a UCS-2 body by its real segment count', () => {
    const provider = new FakeMessagingProvider()

    const ascii = provider.estimateCost({ ...outbound, body: 'a'.repeat(160) })
    const accented = provider.estimateCost({ ...outbound, body: `reçu ${'a'.repeat(155)}` })

    expect(ascii.amount).toBe(30n)
    expect(accented.amount).toBe(90n)
  })
})
