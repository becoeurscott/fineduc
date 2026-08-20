import { describe, it, expect } from 'vitest'
import { Money } from '@fineduc/money'
import { runPaymentProviderContract } from '../port.contract.js'
import { FakePaymentProvider } from './fake.js'
import { ManualPaymentProvider } from './manual.js'
import { ProviderError } from '../port.js'

const XAF = 'XAF' as const

/**
 * Every adapter runs the SAME suite. That is the rule (ARCHITECTURE.md §9):
 * a new provider is proven by making these pass, not by reading its docs.
 */

runPaymentProviderContract(() => new FakePaymentProvider(), {
  webhooks: true,
  signValidBody: (rawBody) => ({ 'x-fake-signature': new FakePaymentProvider().sign(rawBody) }),
  sampleWebhookBody: (reference, providerRef) => ({
    event_id: 'evt_1',
    provider_ref: providerRef,
    reference,
    status: 'succeeded',
    amount_minor: '50000',
    currency: 'XAF',
    occurred_at: '2026-09-15T09:00:00.000Z',
  }),
})

runPaymentProviderContract(() => new ManualPaymentProvider(), { webhooks: false })

/* --------------------------------------------------- adapter-specific ---- */

describe('FakePaymentProvider', () => {
  it('pushes for a mobile operator and hosts a page for card', async () => {
    const provider = new FakePaymentProvider()
    const mobile = await provider.initiate(req())
    const card = await provider.initiate(req({ operator: 'card' as const, reference: 'REF-2' }))

    expect(mobile.pushSent).toBe(true)
    expect(mobile.checkoutUrl).toBeUndefined()
    expect(card.pushSent).toBe(false)
    expect(card.checkoutUrl).toContain('REF-2')
  })

  it('lets a test script the outcome, so nothing depends on chance', async () => {
    const provider = new FakePaymentProvider()
    const initiated = await provider.initiate(req())
    provider.script('REF-0001', 'failed')

    const event = provider.parseWebhook({
      event_id: 'evt_1',
      provider_ref: initiated.providerRef,
      reference: 'REF-0001',
      occurred_at: '2026-09-15T09:00:00.000Z',
    })
    expect(event.status).toBe('failed')
  })

  it('can be told to fail an initiate, to exercise the caller error path', async () => {
    const provider = new FakePaymentProvider()
    provider.failNext(new ProviderError('fake', 'UPSTREAM_DOWN', 'aggregator unavailable', true))
    await expect(provider.initiate(req())).rejects.toThrow(/aggregator unavailable/)
    // ...and recovers, so one scripted failure does not poison the rest.
    await expect(provider.initiate(req())).resolves.toBeTruthy()
  })

  it('rejects a signature of the wrong length without throwing', () => {
    const provider = new FakePaymentProvider()
    const result = provider.verifyWebhook(Buffer.from('{}'), { 'x-fake-signature': 'ab' })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/length/)
  })

  it('does not know a reference it never issued', async () => {
    await expect(new FakePaymentProvider().getStatus('nope')).rejects.toThrow(/No such payment/)
  })
})

describe('ManualPaymentProvider', () => {
  it('settles immediately — a human already saw the money', async () => {
    const result = await new ManualPaymentProvider().initiate(req())
    expect(result.status).toBe('succeeded')
    expect(result.providerRef).toBe('REF-0001')
  })

  /**
   * A silent no-op would let a routing bug send a real provider's event down
   * this path and discard it — money settling nowhere, nobody told.
   */
  it('refuses webhooks loudly rather than no-opping', () => {
    const provider = new ManualPaymentProvider()
    expect(provider.verifyWebhook(Buffer.from('{}'), {}).valid).toBe(false)
    expect(() => provider.parseWebhook({})).toThrow(/mis-resolved/)
  })

  it('covers the methods that move without a network', () => {
    expect(new ManualPaymentProvider().supportedMethods).toContain('cash')
    expect(new ManualPaymentProvider().supportedMethods).toContain('bank_transfer')
  })
})

function req(over: Record<string, unknown> = {}) {
  return {
    reference: 'REF-0001',
    amount: Money.of(50_000n, XAF),
    operator: 'mtn' as const,
    payerPhoneE164: '+237600000001',
    description: 'Scolarité',
    idempotencyKey: '11111111-1111-1111-1111-111111111111',
    ...over,
  }
}
