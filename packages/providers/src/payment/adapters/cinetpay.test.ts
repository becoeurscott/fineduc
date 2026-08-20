import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { Money } from '@fineduc/money'
import { runPaymentProviderContract } from '../port.contract.js'
import { CinetPayProvider } from './cinetpay.js'
import { ProviderError } from '../port.js'
import type { FetchLike } from '../../http.js'

const XAF = 'XAF' as const
const SECRET = 'test_secret_key'
const SITE_ID = '5872'

/** A fetch that answers with whatever the test hands it. No network, ever. */
function stubFetch(responses: Array<{ status?: number; body: unknown }>): FetchLike {
  const queue = [...responses]
  return vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0]
    return new Response(JSON.stringify(next?.body ?? {}), { status: next?.status ?? 200 })
  })
}

const ACCEPTED = {
  body: { code: '201', message: 'CREATED', data: { payment_token: 'tok_abc', payment_url: 'https://pay.test/abc' } },
}

function provider(fetch: FetchLike = stubFetch([ACCEPTED])) {
  return new CinetPayProvider({ apiKey: 'key', siteId: SITE_ID, secretKey: SECRET, fetch, policy: { timeoutMs: 50, attempts: 1, baseDelayMs: 1 } })
}

/** The callback fields CinetPay signs, in the order the adapter expects. */
const SIGNED_ORDER = [
  'cpm_site_id',
  'cpm_trans_id',
  'cpm_trans_date',
  'cpm_amount',
  'cpm_currency',
  'signature',
  'payment_method',
  'cel_phone_num',
  'cpm_phone_prefixe',
  'cpm_language',
  'cpm_version',
  'cpm_payment_config',
  'cpm_page_action',
  'cpm_custom',
  'cpm_designation',
  'cpm_error_message',
]

function callback(over: Record<string, unknown> = {}) {
  return {
    cpm_site_id: SITE_ID,
    cpm_trans_id: 'tok_abc',
    cpm_trans_date: '2026-09-25 10:30:00',
    cpm_amount: '120000',
    cpm_currency: 'XAF',
    signature: 'sig',
    payment_method: 'OM',
    cel_phone_num: '600000001',
    cpm_phone_prefixe: '237',
    cpm_language: 'fr',
    cpm_version: 'V4',
    cpm_payment_config: 'SINGLE',
    cpm_page_action: 'PAYMENT',
    cpm_custom: 'fd:11111111-2222-3333-4444-555555555555:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    cpm_designation: 'Scolarite',
    cpm_error_message: '',
    cpm_result: '00',
    ...over,
  }
}

function sign(fields: Record<string, unknown>): string {
  return createHmac('sha256', SECRET)
    .update(SIGNED_ORDER.map((f) => String(fields[f] ?? '')).join(''))
    .digest('hex')
}

/* ---------------------------------------------------- the shared contract */

runPaymentProviderContract(() => provider(stubFetch([ACCEPTED])), {
  webhooks: true,
  signValidBody: (rawBody) => {
    // The suite signs an arbitrary body; mirror the adapter's own scheme so
    // a correctly-signed body is genuinely accepted.
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(rawBody.toString()) as Record<string, unknown>
    } catch {
      parsed = {}
    }
    return { 'x-token': sign(parsed) }
  },
  sampleWebhookBody: (reference) => callback({ cpm_custom: reference }),
  // CinetPay signs an ordered concatenation of field VALUES, not the byte
  // stream, so a re-serialised body verifies the same — correct here, and a
  // hole for a byte-signing provider.
  signsRawBytes: false,
  // Refunds go through their back office; there is no API for it.
  refunds: false,
})

/* ------------------------------------------------------ adapter specifics */

describe('CinetPayProvider', () => {
  it('refuses to construct without credentials, rather than failing at a checkout', () => {
    expect(
      () => new CinetPayProvider({ apiKey: '', siteId: SITE_ID, secretKey: SECRET, fetch: stubFetch([ACCEPTED]) }),
    ).toThrow(/required/)
  })

  describe('initiate', () => {
    it('returns the hosted checkout and stays PENDING', async () => {
      const result = await provider().initiate(request())
      expect(result.providerRef).toBe('tok_abc')
      expect(result.checkoutUrl).toBe('https://pay.test/abc')
      // Only a webhook settles money (rule #6).
      expect(result.status).toBe('pending')
    })

    it('passes our reference through as metadata, so the callback can be attributed', async () => {
      const fetch = stubFetch([ACCEPTED])
      await provider(fetch).initiate(request({ reference: 'fd:tenant:payment' }))
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]?.[1].body as string) ?? '{}')
      expect(body.metadata).toBe('fd:tenant:payment')
      expect(body.transaction_id).toBe('fd:tenant:payment')
    })

    /**
     * A real constraint of the rail — the smallest circulating coin is 5
     * francs. Catching it here, naming the nearest usable figures, beats a
     * 400 that a parent reads as "payment failed".
     */
    it('rejects an XAF amount that is not a multiple of 5, and says what to use', async () => {
      await expect(provider().initiate(request({ amount: Money.of(1_003n, XAF) }))).rejects.toThrow(
        /multiple of 5.*1000.*1005/s,
      )
    })

    it('accepts a multiple of 5', async () => {
      await expect(provider().initiate(request({ amount: Money.of(1_005n, XAF) }))).resolves.toBeTruthy()
    })

    it('treats a non-201 code as a rejection even on HTTP 200', async () => {
      const fetch = stubFetch([{ body: { code: '609', message: 'AUTH_NOT_FOUND' } }])
      await expect(provider(fetch).initiate(request())).rejects.toThrow(/AUTH_NOT_FOUND/)
    })

    it('marks a 5xx as retryable so the caller can decide', async () => {
      const fetch = stubFetch([{ status: 503, body: { code: '503' } }])
      await provider(fetch)
        .initiate(request())
        .catch((error: ProviderError) => {
          expect(error.retryable).toBe(true)
        })
    })

    it('rejects a response with no payment token rather than inventing one', async () => {
      const fetch = stubFetch([{ body: { code: '201', data: {} } }])
      await expect(provider(fetch).initiate(request())).rejects.toThrow(/no payment_token/)
    })
  })

  describe('verifyWebhook', () => {
    it('accepts a correctly signed callback', () => {
      const fields = callback()
      const raw = Buffer.from(JSON.stringify(fields))
      expect(provider().verifyWebhook(raw, { 'x-token': sign(fields) }).valid).toBe(true)
    })

    it('accepts a form-encoded callback, which is their other shape', () => {
      const fields = callback()
      const raw = Buffer.from(new URLSearchParams(fields as Record<string, string>).toString())
      expect(provider().verifyWebhook(raw, { 'x-token': sign(fields) }).valid).toBe(true)
    })

    it('rejects a callback whose fields were tampered with after signing', () => {
      const fields = callback()
      const token = sign(fields)
      const tampered = Buffer.from(JSON.stringify({ ...fields, cpm_amount: '999999' }))
      expect(provider().verifyWebhook(tampered, { 'x-token': token }).valid).toBe(false)
    })

    it('refuses to verify at all when the secret is not configured', () => {
      const p = new CinetPayProvider({ apiKey: 'k', siteId: SITE_ID, secretKey: '', fetch: stubFetch([ACCEPTED]) })
      const fields = callback()
      expect(p.verifyWebhook(Buffer.from(JSON.stringify(fields)), { 'x-token': sign(fields) }).valid).toBe(false)
    })
  })

  describe('parseWebhook', () => {
    it('normalises a success', () => {
      const event = provider().parseWebhook(callback())
      expect(event.eventId).toBe('tok_abc')
      expect(event.providerRef).toBe('tok_abc')
      expect(event.status).toBe('succeeded')
      expect(event.paidAmount?.amount).toBe(120_000n)
      expect(event.occurredAt.toISOString()).toBe('2026-09-25T10:30:00.000Z')
    })

    it('carries our reference out of cpm_custom', () => {
      const event = provider().parseWebhook(callback())
      expect(event.reference).toMatch(/^fd:/)
    })

    it('maps a refusal to failed and keeps the reason', () => {
      const event = provider().parseWebhook(callback({ cpm_result: '600', cpm_error_message: 'INSUFFICIENT_BALANCE' }))
      expect(event.status).toBe('failed')
      expect(event.failureReason).toBe('INSUFFICIENT_BALANCE')
    })

    /** An unknown code must never be read as money that arrived. */
    it('treats an unrecognised result code as pending, never succeeded', () => {
      expect(provider().parseWebhook(callback({ cpm_result: 'WHAT_IS_THIS', cpm_error_message: '' })).status).toBe(
        'pending',
      )
    })

    it('uses the transaction id as the event id, so two callbacks are one event', () => {
      const a = provider().parseWebhook(callback())
      const b = provider().parseWebhook(callback({ cpm_trans_date: '2026-09-25 11:00:00' }))
      expect(a.eventId).toBe(b.eventId)
    })

    it('throws on a payload with no transaction id', () => {
      expect(() => provider().parseWebhook({ cpm_amount: '1' })).toThrow(ProviderError)
    })
  })

  describe('refund', () => {
    /**
     * Returning `failed` would read as "the provider said no" and send a
     * bursar hunting a problem that does not exist. This says plainly that
     * the action happens elsewhere.
     */
    it('says refunds happen in their back office rather than pretending to fail', async () => {
      await expect(provider().refund('tok_abc', Money.of(1_000n, XAF), 'test')).rejects.toThrow(/back office/)
    })
  })
})

function request(over: Record<string, unknown> = {}) {
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
