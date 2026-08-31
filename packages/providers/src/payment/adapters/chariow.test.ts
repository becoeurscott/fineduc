import { createHmac } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { Money } from '@fineduc/money'
import { runPaymentProviderContract } from '../port.contract.js'
import { ChariowProvider } from './chariow.js'
import { ProviderError } from '../port.js'
import type { FetchLike } from '../../http.js'

const XAF = 'XAF' as const
const API_KEY = 'test_chariow_key'
/** Chariow generates this; the `whsec_` prefix is theirs, not ours. */
const WEBHOOK_SECRET = 'whsec_test_chariow_pulse_secret'

/** Exactly what Chariow puts in `x-chariow-signature`. */
function sign(rawBody: Buffer): Record<string, string> {
  return {
    'x-chariow-signature': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`,
  }
}
const PRODUCT_ID = 'prod_essentiel_monthly'

function stubFetch(responses: Array<{ status?: number; body: unknown }>): FetchLike {
  const queue = [...responses]
  return vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0]
    return new Response(JSON.stringify(next?.body ?? {}), { status: next?.status ?? 200 })
  })
}

const ACCEPTED = {
  body: {
    data: {
      purchase: { id: 'sale_abc', amount: { value: 25000, currency: 'XAF' } },
      payment: { checkout_url: 'https://checkout.chariow.com/p/abc' },
    },
  },
}

function provider(fetch: FetchLike = stubFetch([ACCEPTED])) {
  return new ChariowProvider({
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
    fetch,
    policy: { timeoutMs: 50, attempts: 1, baseDelayMs: 1 },
  })
}

runPaymentProviderContract(() => provider(), {
  webhooks: true,
  signValidBody: sign,
  sampleWebhookBody: (reference, providerRef) => webhook(reference, providerRef),
  refunds: false,
  // Chariow charges a pre-priced product; every generic request the suite
  // builds needs one, or `initiate` rejects it before the suite's own
  // assertions run.
  requestOverrides: { productId: PRODUCT_ID, amount: Money.of(25_000n, XAF) },
})

/** The shape Chariow actually posts: `{ event, sale, product, customer, store }`. */
function webhook(reference: string, providerRef: string, over: Record<string, unknown> = {}) {
  return {
    event: 'successful.sale',
    sale: {
      id: providerRef,
      amount: { value: 25000, currency: 'XAF' },
      status: 'completed',
      custom_metadata: { reference },
      completed_at: '2026-09-25T10:30:00Z',
      created_at: '2026-09-25T10:28:00Z',
      ...over,
    },
    product: { id: PRODUCT_ID, name: 'Essentiel — mensuel' },
    store: { id: 'store_b2yo5g72t24v', name: 'fineduc' },
  }
}

function baseRequest(over: Record<string, unknown> = {}) {
  return {
    reference: 'REF-0001',
    amount: Money.of(25_000n, XAF),
    operator: 'mtn' as const,
    payerPhoneE164: '+237670000001',
    payerName: 'Amina Directrice',
    description: 'Abonnement Essentiel — mensuel',
    idempotencyKey: '11111111-1111-1111-1111-111111111111',
    productId: PRODUCT_ID,
    ...over,
  } as Parameters<ChariowProvider['initiate']>[0]
}

describe('ChariowProvider', () => {
  describe('initiate', () => {
    it('requires a productId, since Chariow has no arbitrary-amount field', async () => {
      const req = baseRequest()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (req as any).productId
      await expect(provider().initiate(req)).rejects.toThrow(/productId/)
    })

    it('sends the local phone number and ISO2 country code, not E.164', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest({ payerPhoneE164: '+237670000001' }))

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1].body as string) ?? '{}')
      expect(body.phone).toEqual({ number: '670000001', country_code: 'CM' })
    })

    it('rejects a phone whose country it cannot determine', async () => {
      await expect(provider().initiate(baseRequest({ payerPhoneE164: '+9999999999' }))).rejects.toThrow(
        ProviderError,
      )
    })

    it('splits a single-word payer name rather than failing the checkout', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest({ payerName: 'Amina' }))

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1].body as string) ?? '{}')
      expect(body.first_name).toBe('Amina')
      expect(body.last_name).toBe('-')
    })

    it('authenticates with a bearer token', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(baseRequest())
      const headers = vi.mocked(fetch).mock.calls[0]![1].headers as Record<string, string>
      expect(headers['authorization']).toBe(`Bearer ${API_KEY}`)
    })

    it('rejects when the product price does not match what Fineduc expected', async () => {
      const fetch = stubFetch([
        {
          body: {
            data: {
              purchase: { id: 'sale_abc', amount: { value: 60000, currency: 'XAF' } },
              payment: { checkout_url: 'https://c/x' },
            },
          },
        },
      ])
      // 25 000 expected, 60 000 configured in the Chariow shop.
      await expect(provider(fetch).initiate(baseRequest())).rejects.toThrow(/mismatch|60000/i)
    })

    it('accepts a product price within rounding of the expected amount', async () => {
      const fetch = stubFetch([ACCEPTED])
      const result = await provider(fetch).initiate(baseRequest())
      expect(result.providerRef).toBe('sale_abc')
      expect(result.checkoutUrl).toBe('https://checkout.chariow.com/p/abc')
    })

    it('never reports a settled status from initiate, whatever Chariow says', async () => {
      const fetch = stubFetch([
        {
          body: {
            data: {
              purchase: { id: 'sale_abc', amount: { value: 25000, currency: 'XAF' } },
              payment: { checkout_url: 'https://c/x' },
            },
          },
        },
      ])
      expect((await provider(fetch).initiate(baseRequest())).status).toBe('pending')
    })

    /**
     * The failure mode that matters for a SUBSCRIPTION: Chariow blocks a
     * repeat purchase of a downloadable/course/bundle product, so a school's
     * second month comes back `already_purchased` with a null purchase — a
     * 200, not an error. It must name the cause rather than read as a
     * malformed response.
     */
    it('names the repeat-purchase block instead of reporting a malformed response', async () => {
      const fetch = stubFetch([
        { body: { data: { step: 'already_purchased', message: null, purchase: null, payment: {} } } },
      ])
      await expect(provider(fetch).initiate(baseRequest())).rejects.toThrow(/license|repeat purchase/i)
    })

    it('surfaces the field Chariow rejected', async () => {
      const fetch = stubFetch([{ status: 422, body: { message: 'Invalid discount_code' } }])
      await expect(provider(fetch).initiate(baseRequest())).rejects.toThrow(/discount_code/)
    })
  })

  describe('verifyWebhook', () => {
    it('accepts an HMAC-SHA256 of the raw body under x-chariow-signature', () => {
      const raw = Buffer.from(JSON.stringify(webhook('REF-1', 'sal_abc')))
      expect(provider().verifyWebhook(raw, sign(raw)).valid).toBe(true)
    })

    it('rejects a signature computed over different bytes', () => {
      const raw = Buffer.from(JSON.stringify(webhook('REF-1', 'sal_abc')))
      const other = Buffer.from(JSON.stringify(webhook('REF-2', 'sal_xyz')))
      expect(provider().verifyWebhook(raw, sign(other)).valid).toBe(false)
    })

    /**
     * Chariow escapes forward slashes (`https:\/\/…`) and non-ASCII, so bytes
     * that went through `JSON.parse` → `JSON.stringify` no longer hash to the
     * signature. This is the mistake their own docs call out, and the reason
     * the controller must pass the raw Buffer through untouched.
     */
    it('fails when the body was re-serialised rather than hashed raw', () => {
      const raw = Buffer.from('{"url":"https:\\/\\/pay.fineeduc.com\\/x","sale":{"id":"sal_abc"}}')
      const headers = sign(raw)
      const reSerialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))))
      expect(provider().verifyWebhook(reSerialised, headers).valid).toBe(false)
    })

    it('refuses an unknown signature scheme rather than treating it as a digest', () => {
      const raw = Buffer.from('{}')
      expect(provider().verifyWebhook(raw, { 'x-chariow-signature': 'md5=deadbeef' }).valid).toBe(false)
    })

    it('rejects a delivery carrying no signature at all', () => {
      expect(provider().verifyWebhook(Buffer.from('{}'), {}).valid).toBe(false)
    })
  })

  describe('parseWebhook', () => {
    /**
     * The integration reference's central warning: `unpaid` contains `paid`,
     * and an implementation that tests `paid` first would credit a sale that
     * was never paid.
     */
    it('does not read "unpaid" as paid', () => {
      const event = provider().parseWebhook({
        event: 'unpaid.sale',
        sale: { id: 'sal_abc', status: 'unpaid' },
      })
      expect(event.status).toBe('pending')
    })

    it('reads a successful.sale from the nested sale object', () => {
      const event = provider().parseWebhook(webhook('REF-1', 'sal_abc'))
      expect(event.status).toBe('succeeded')
      expect(event.providerRef).toBe('sal_abc')
      expect(event.reference).toBe('REF-1')
    })

    /**
     * `awaiting_payment` is the status a sale carries between checkout and
     * payment. It must not settle — and note it does NOT contain "paid".
     */
    it('leaves an awaiting_payment sale pending', () => {
      const event = provider().parseWebhook({ event: '', sale: { id: 'sal_abc', status: 'awaiting_payment' } })
      expect(event.status).toBe('pending')
    })

    it('reads Chariow\'s real failure and abandonment events', () => {
      expect(provider().parseWebhook({ event: 'failed.sale', sale: { id: 'sal_a' } }).status).toBe('failed')
      expect(provider().parseWebhook({ event: 'abandoned.sale', sale: { id: 'sal_a' } }).status).toBe('cancelled')
    })

    it('dates the event from completed_at, not from when the webhook happened to arrive', () => {
      const event = provider().parseWebhook(webhook('REF-1', 'sal_abc', { completed_at: '2026-01-15T08:00:00Z' }))
      expect(event.occurredAt.toISOString()).toBe('2026-01-15T08:00:00.000Z')
    })

    it('throws on a malformed payload rather than a half event', () => {
      expect(() => provider().parseWebhook({ nothing: true })).toThrow(ProviderError)
    })
  })

  describe('getStatus', () => {
    it('re-pulls rather than trusting a cached status', async () => {
      const fetch = stubFetch([{ body: { data: { id: 'sale_abc', status: 'settled', amount: { value: 25000, currency: 'XAF' } } } }])
      const result = await provider(fetch).getStatus('sale_abc')
      expect(result.status).toBe('succeeded')
      expect(vi.mocked(fetch).mock.calls[0]![1].method).toBe('GET')
      expect(vi.mocked(fetch).mock.calls[0]![0]).toContain('/sales/sale_abc')
    })
  })

  it('refuses to construct without an API key', () => {
    expect(
      () =>
        new ChariowProvider({ apiKey: '', webhookSecret: WEBHOOK_SECRET, fetch: stubFetch([ACCEPTED]) }),
    ).toThrow(ProviderError)
  })
})
