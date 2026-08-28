import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { Money } from '@fineduc/money'
import { runPaymentProviderContract } from '../port.contract.js'
import { MonerooProvider } from './moneroo.js'
import { ProviderError } from '../port.js'
import type { FetchLike } from '../../http.js'

const XAF = 'XAF' as const
const SECRET = 'test_moneroo_secret'
const WEBHOOK_SECRET = 'test_webhook_secret'

/** A fetch that answers with whatever the test hands it. No network, ever. */
function stubFetch(responses: Array<{ status?: number; body: unknown }>): FetchLike {
  const queue = [...responses]
  return vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0]
    return new Response(JSON.stringify(next?.body ?? {}), { status: next?.status ?? 200 })
  })
}

const ACCEPTED = {
  body: {
    data: { id: 'py_01H', checkout_url: 'https://checkout.moneroo.io/p/abc', status: 'pending' },
    message: 'Payment initialized',
  },
}

function provider(fetch: FetchLike = stubFetch([ACCEPTED])) {
  return new MonerooProvider({
    secretKey: SECRET,
    webhookSecret: WEBHOOK_SECRET,
    fetch,
    policy: { timeoutMs: 50, attempts: 1, baseDelayMs: 1 },
  })
}

function sign(rawBody: Buffer): Record<string, string> {
  return {
    'x-moneroo-signature': createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex'),
  }
}

function webhook(reference: string, providerRef: string, over: Record<string, unknown> = {}) {
  return {
    event: 'payment.success',
    data: {
      id: providerRef,
      amount: 50_000,
      currency: 'XAF',
      status: 'success',
      metadata: { reference },
      created_at: '2026-09-25T10:30:00Z',
      ...over,
    },
  }
}

runPaymentProviderContract(() => provider(), {
  webhooks: true,
  signValidBody: sign,
  sampleWebhookBody: (reference, providerRef) => webhook(reference, providerRef),
  // Moneroo has no refund endpoint on the v1 checkout product.
  refunds: false,
})

describe('MonerooProvider', () => {
  describe('initiate', () => {
    it('sends the amount in the smallest unit, unscaled for XAF', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest())

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1].body as string) ?? '{}')
      // 50 000 XAF is 50000, not 5000000. Scaling it would overcharge 100x.
      expect(body.amount).toBe(50_000)
      expect(body.currency).toBe('XAF')
    })

    it('authenticates with a bearer token', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest())

      const headers = vi.mocked(fetch).mock.calls[0]![1].headers as Record<string, string>
      expect(headers['authorization']).toBe(`Bearer ${SECRET}`)
    })

    it('sends every metadata value as a string, since Moneroo 422s otherwise', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest())

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1].body as string) ?? '{}')
      for (const value of Object.values(body.metadata)) {
        expect(typeof value).toBe('string')
      }
    })

    it('splits a single-word payer name rather than failing the payment', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest({ payerName: 'Amina' }))

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1].body as string) ?? '{}')
      expect(body.customer.first_name).toBe('Amina')
      // Moneroo rejects a missing surname outright.
      expect(body.customer.last_name).toBe('-')
    })

    it('substitutes a placeholder e-mail when the payer has none', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest())

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1].body as string) ?? '{}')
      expect(body.customer.email).toBe('237600000001@no-email.fineduc.school')
    })

    it('prefers a real e-mail when one is known', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest({ payerEmail: 'parent@example.cm' }))

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1].body as string) ?? '{}')
      expect(body.customer.email).toBe('parent@example.cm')
    })

    it('truncates a description over 200 characters', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest({ description: 'x'.repeat(300) }))

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1].body as string) ?? '{}')
      expect(body.description).toHaveLength(200)
    })

    it('rejects an XAF amount that is not a multiple of 5, naming both usable figures', async () => {
      await expect(provider().initiate(baseRequest({ amount: Money.of(50_003n, XAF) }))).rejects.toThrow(/50000 or 50005/)
    })

    it('treats a 200 with no checkout_url as a failure', async () => {
      const fetch = stubFetch([{ body: { data: { id: 'py_01H' } } }])
      await expect(provider(fetch).initiate(baseRequest())).rejects.toThrow(ProviderError)
    })

    it('surfaces a field validation error rather than a bare status', async () => {
      const fetch = stubFetch([
        { status: 422, body: { message: 'The given data was invalid.', errors: { 'customer.email': ['required'] } } },
      ])
      await expect(provider(fetch).initiate(baseRequest())).rejects.toThrow(/customer\.email/)
    })

    it('never reports a settled status, whatever the provider says', async () => {
      const fetch = stubFetch([
        { body: { data: { id: 'py_01H', checkout_url: 'https://c/x', status: 'success' } } },
      ])
      // Only a webhook settles money.
      expect((await provider(fetch).initiate(baseRequest())).status).toBe('pending')
    })
  })

  describe('verifyWebhook', () => {
    it('accepts a signature over the raw bytes', () => {
      const raw = Buffer.from(JSON.stringify(webhook('REF-1', 'py_01H')))
      expect(provider().verifyWebhook(raw, sign(raw)).valid).toBe(true)
    })

    it('rejects the same payload re-serialised', () => {
      const raw = Buffer.from('{"a":1,  "b":2}')
      const headers = sign(raw)
      const reSerialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString())))
      expect(provider().verifyWebhook(reSerialised, headers).valid).toBe(false)
    })

    it('rejects a signature of the right shape signed with the wrong secret', () => {
      const raw = Buffer.from('{}')
      const forged = createHmac('sha256', 'not-the-secret').update(raw).digest('hex')
      expect(provider().verifyWebhook(raw, { 'x-moneroo-signature': forged }).valid).toBe(false)
    })
  })

  describe('parseWebhook', () => {
    it('carries our reference back out of metadata', () => {
      const event = provider().parseWebhook(webhook('REF-42', 'py_01H'))
      expect(event.reference).toBe('REF-42')
      expect(event.status).toBe('succeeded')
      expect(event.paidAmount?.amount).toBe(50_000n)
    })

    it('dedups on the event, not the bytes', () => {
      const a = provider().parseWebhook(webhook('REF-1', 'py_01H'))
      // Same event, different serialisation and a field reordered: a byte
      // hash would call these two different events and settle twice.
      const b = provider().parseWebhook({
        data: { metadata: { reference: 'REF-1' }, status: 'success', id: 'py_01H', amount: 50_000, currency: 'XAF' },
        event: 'payment.success',
      })
      expect(a.eventId).toBe(b.eventId)
    })

    it('maps a cancellation to failed', () => {
      const event = provider().parseWebhook({
        event: 'payment.cancelled',
        data: { id: 'py_01H', status: 'cancelled' },
      })
      expect(event.status).toBe('failed')
    })

    it('leaves an initiated event pending rather than reading it as progress', () => {
      const event = provider().parseWebhook({
        event: 'payment.initiated',
        data: { id: 'py_01H', status: 'pending' },
      })
      expect(event.status).toBe('pending')
    })

    it('treats an unknown event as pending, never as succeeded', () => {
      const event = provider().parseWebhook({
        event: 'payment.something_new',
        data: { id: 'py_01H', status: 'who_knows' },
      })
      expect(event.status).toBe('pending')
    })
  })

  describe('getStatus', () => {
    it('reads a currency sent as an object as well as a string', async () => {
      const fetch = stubFetch([
        { body: { data: { id: 'py_01H', amount: 50_000, currency: { code: 'XAF' }, status: 'success' } } },
      ])
      const result = await provider(fetch).getStatus('py_01H')
      expect(result.status).toBe('succeeded')
      expect(result.paidAmount?.amount).toBe(50_000n)
    })

    it('verifies over GET', async () => {
      const fetch = stubFetch([{ body: { data: { id: 'py_01H', status: 'success' } } }])
      await provider(fetch).getStatus('py_01H')
      expect(vi.mocked(fetch).mock.calls[0]![1].method).toBe('GET')
      expect(vi.mocked(fetch).mock.calls[0]![0]).toContain('/v1/payments/py_01H/verify')
    })
  })

  it('refuses to construct without a secret key', () => {
    expect(
      () =>
        new MonerooProvider({
          secretKey: '',
          webhookSecret: WEBHOOK_SECRET,
          fetch: stubFetch([ACCEPTED]),
        }),
    ).toThrow(ProviderError)
  })
})

function baseRequest(over: Record<string, unknown> = {}) {
  return {
    reference: 'REF-0001',
    amount: Money.of(50_000n, XAF),
    operator: 'mtn' as const,
    payerPhoneE164: '+237600000001',
    description: 'Scolarité — tranche 1',
    idempotencyKey: '11111111-1111-1111-1111-111111111111',
    ...over,
  } as Parameters<MonerooProvider['initiate']>[0]
}
