/**
 * Boots the app through @nestjs/testing against the COMPILED dist output
 * (never src — see build-before-tests.ts) and hits it with supertest.
 *
 * The /health/ready assertion is deliberately the regression test for a
 * bug this project actually hit while building it: running the app via
 * `tsx` (esbuild) silently injects `undefined` for every constructor-DI
 * parameter, because esbuild doesn't implement `emitDecoratorMetadata`.
 * The app boots looking fine and only 500s the moment a handler touches
 * the "injected" service. Testing against the real `tsc` output, and
 * asserting a real 200 with real ping results, is what catches that class
 * of bug — a test that imported `../src/...` through vitest's own esbuild
 * transform would have the identical blind spot and pass regardless.
 *
 * Requires a reachable Postgres + Redis (see infra/docker-compose.yml) —
 * env vars default to the local dev stack if not already set.
 */
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

process.env.DATABASE_URL ??= 'postgresql://fineduc:fineduc@localhost:5432/fineduc'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.JWT_SECRET ??= 'test_only_jwt_secret_32_characters_min'
// 64 HEX characters (32 bytes) — packages/config enforces this, because
// Buffer.from(key, 'hex') stops at the first non-hex character and AES-256
// then throws "Invalid key length" at the first 2FA enrolment.
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)

describe('Health endpoints', () => {
  let app: INestApplication

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing')
    const { AppModule } = await import('../dist/app.module.js')
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('GET /health returns liveness without touching any dependency', async () => {
    const res = await request(app.getHttpServer()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.service).toBe('fineduc-api')
  })

  it('GET /health/ready resolves PrismaService and RedisService via real DI and pings both', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } })
  })

  it('GET /health/providers reports configuration presence, not connectivity', async () => {
    const res = await request(app.getHttpServer()).get('/health/providers')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      status: 'not_implemented',
      configured: { cinetpay: false, whatsapp: false, sms: false, s3: false, sentry: false },
    })
  })
})
