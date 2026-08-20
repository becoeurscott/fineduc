import 'reflect-metadata'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { loadDotEnvIfPresent, loadEnv } from '@fineduc/config'
import { AppModule } from './app.module.js'

loadDotEnvIfPresent('.env')
const env = loadEnv()

async function bootstrap() {
  // bodyParser: false — we attach our own with an explicit size cap
  // (ARCHITECTURE.md §10: "a 1 MB body cap"). A raw-body parser for
  // signature-verified webhook routes is added when the payments module
  // lands (ARCHITECTURE.md §9) — those routes need the exact bytes Meta/
  // CinetPay signed, which express.json() would already have consumed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })

  app.use(helmet())

  /*
   * Webhook routes get the RAW bytes, and must be mounted BEFORE
   * express.json() — once the JSON parser has consumed the stream the exact
   * bytes the aggregator signed are gone, and re-serialising the parsed
   * object changes them (key order, whitespace), so every HMAC check fails.
   *
   * Rate-limited by IP separately from auth: the endpoint is public and
   * unauthenticated, so it is the cheapest thing on the box to hammer.
   * The limit is generous because a busy school plus an aggregator's retry
   * storm is legitimately bursty.
   */
  app.use(
    '/webhooks',
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { type: 'https://fineduc.com/errors/TOO_MANY_REQUESTS', title: 'Too Many Requests', status: 429 },
    }),
    express.raw({ type: '*/*', limit: '1mb' }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  // Rate limiting on sensitive auth endpoints (ARCHITECTURE.md §10)
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      type: 'https://fineduc.com/errors/TOO_MANY_REQUESTS',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too many attempts. Please try again in a minute.',
    },
  })
  app.use('/auth/login', authLimiter)
  app.use('/auth/select-tenant', authLimiter)
  app.use('/auth/2fa', authLimiter)

  app.enableCors({
    origin: env.CORS_ALLOWED_ORIGINS.length > 0 ? env.CORS_ALLOWED_ORIGINS : false,
    credentials: true,
  })

  await app.listen(env.PORT)
  console.log(`Fineduc API listening on :${env.PORT} (${env.NODE_ENV})`)
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error)
  process.exitCode = 1
})
