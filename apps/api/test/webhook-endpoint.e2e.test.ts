/**
 * `POST /webhooks/payments/:provider` over real HTTP.
 *
 * The webhook-settlement suite proves the ingest SERVICE. This proves the
 * thing only a real request can: that the endpoint hands the service the
 * exact bytes the aggregator signed.
 *
 * That is the failure this file exists for. If `express.json()` consumes the
 * body first, the raw bytes are gone; re-serialising the parsed object
 * changes key order and whitespace, every HMAC check fails, and the symptom
 * is "the aggregator's signatures are all wrong" — a full day of blaming the
 * wrong component. Mounting order in main.ts is the fix, and only an
 * end-to-end request can prove it held.
 */
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'

process.env.DATABASE_URL ??= 'postgresql://fineduc:fineduc@localhost:5432/fineduc'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.JWT_SECRET ??= 'test_only_jwt_secret_32_characters_min'
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)
process.env.FAKE_WEBHOOK_SECRET ??= 'fake_webhook_secret'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

let app: INestApplication
let provider: Any

/**
 * A body as a STRING, not a Buffer.
 *
 * supertest/superagent JSON-serialises a Buffer argument to `.send()` —
 * `{"type":"Buffer","data":[...]}` — so the server would receive different
 * bytes than the ones signed here and every signature would "mismatch" for
 * a reason that has nothing to do with the signing.
 */
function body(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    event_id: `evt_${randomUUID()}`,
    provider_ref: `fake_REF-${randomUUID()}`,
    status: 'succeeded',
    occurred_at: '2026-09-20T10:00:00.000Z',
    ...over,
  })
}

const sign = (raw: string) => provider.sign(Buffer.from(raw))

describe('POST /webhooks/payments/:provider', () => {
  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing')
    const { AppModule } = await import('../dist/app.module.js')
    const providers = await import('@fineduc/providers')
    provider = new providers.FakePaymentProvider({ secret: process.env['FAKE_WEBHOOK_SECRET'] })

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()

    // Mirror main.ts: the raw parser MUST be mounted before express.json,
    // or the bytes the aggregator signed are already gone.
    const express = (await import('express')).default
    app.use('/webhooks', express.raw({ type: '*/*', limit: '1mb' }))
    app.use(express.json({ limit: '1mb' }))

    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('needs no authentication — an aggregator has no JWT', async () => {
    const raw = body()
    const res = await request(app.getHttpServer())
      .post('/webhooks/payments/fake')
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', sign(raw))
      .send(raw)

    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
  })

  /** The whole point of the raw-body mounting. */
  it('verifies against the exact bytes sent, not a re-serialised copy', async () => {
    // Deliberately awkward spacing: a JSON round-trip would normalise it and
    // the signature would no longer match.
    const raw = `{"event_id":"evt_${randomUUID()}",  "provider_ref":"fake_X",   "status":"succeeded"}`
    const res = await request(app.getHttpServer())
      .post('/webhooks/payments/fake')
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', sign(raw))
      .send(raw)

    expect(res.status).toBe(200)
    expect(res.body.received).toBe(true)
  })

  it('rejects an unsigned delivery, still with a 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/payments/fake')
      .set('Content-Type', 'application/json')
      .send(body())

    // 200 on purpose: a 4xx tells the aggregator to retry forever, and tells
    // a prober which guess was closest.
    expect(res.status).toBe(200)
    expect(res.body.received).toBe(false)
    expect(res.body.reason).toBeTruthy()
  })

  it('rejects a forged signature', async () => {
    const raw = body()
    const res = await request(app.getHttpServer())
      .post('/webhooks/payments/fake')
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', 'deadbeef')
      .send(raw)

    expect(res.body.received).toBe(false)
  })

  it('answers a second delivery of the same event as a duplicate, not an error', async () => {
    const raw = body()
    const headers = { 'x-fake-signature': sign(raw) }

    const first = await request(app.getHttpServer())
      .post('/webhooks/payments/fake')
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(raw)
    const second = await request(app.getHttpServer())
      .post('/webhooks/payments/fake')
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(raw)

    expect(first.body).toEqual({ received: true, duplicate: false })
    expect(second.body).toEqual({ received: true, duplicate: true })
  })

  it('does not reveal which providers are registered', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/payments/cinetpay')
      .set('Content-Type', 'application/json')
      .send(body())

    expect(res.status).toBe(200)
    expect(res.body.received).toBe(false)
    expect(JSON.stringify(res.body)).not.toContain('manual')
    expect(JSON.stringify(res.body)).not.toContain('fake')
  })

  it('handles an empty body without throwing', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/payments/fake')
      .set('Content-Type', 'application/json')
      .send('')

    expect(res.status).toBe(200)
    expect(res.body.received).toBe(false)
  })
})
