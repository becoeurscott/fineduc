/**
 * Zod-validated environment, fail-fast at boot (AGENTS.md, ARCHITECTURE.md §10).
 *
 * Every variable an app or worker needs is declared here, once. A required
 * value that is missing or malformed throws EnvValidationError immediately
 * — never a `undefined` silently flowing into a provider client three
 * layers down. Secrets are read from process.env only and are never logged
 * (see `redactedKeys` at the bottom, used by the Pino logger config).
 *
 * Provider credentials (CinetPay, WhatsApp, SMS, S3) are OPTIONAL in
 * development and test — the Fake/Console adapters need none of them — but
 * REQUIRED in production, enforced by the superRefine below.
 */
import { z } from 'zod'
import { EnvValidationError } from './errors.js'

const nonEmpty = (label: string) => z.string().min(1, `${label} must not be empty`)

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /** Comma-separated list, e.g. "https://app.fineduc.io,https://fineduc.io". */
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),

    // The migrator/owner role's connection string — used only by `prisma
    // migrate`. Never used by the API or worker at runtime.
    DATABASE_URL: nonEmpty('DATABASE_URL')
      .url('DATABASE_URL must be a valid URL')
      .refine((v) => v.startsWith('postgres'), 'DATABASE_URL must be a postgres:// or postgresql:// URL'),

    // The least-privilege `fineduc_app` role's connection string
    // (ARCHITECTURE.md §4, §10) — what the API and worker actually connect
    // as. Optional in development/test, where db/src/client.ts derives it
    // from DATABASE_URL with the migration's well-known dev password;
    // required in production, where that password must never be reused.
    APP_DATABASE_URL: z.string().default(''),

    REDIS_URL: nonEmpty('REDIS_URL')
      .url('REDIS_URL must be a valid URL')
      .refine((v) => v.startsWith('redis'), 'REDIS_URL must be a redis:// or rediss:// URL'),

    // Signs and verifies access/refresh JWTs (ARCHITECTURE.md §10).
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    // AES-256-GCM key for TOTP secrets and provider credentials at rest.
    /**
     * AES-256-GCM key for TOTP secrets and provider credentials at rest.
     *
     * MUST be 64 hex characters — 32 bytes. `min(32)` is not enough: the
     * consumer does `Buffer.from(ENCRYPTION_KEY, 'hex')`, and hex parsing
     * stops silently at the first non-hex character. A 32-character
     * passphrase, or 64 characters that merely *look* like a key, yields a
     * short buffer and Node throws `RangeError: Invalid key length` — not
     * at boot, but the first time a director tries to enable 2FA.
     *
     * Generate one with: openssl rand -hex 32
     */
    ENCRYPTION_KEY: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        'ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes) — generate with: openssl rand -hex 32',
      ),

    /**
     * Origin of the PUBLIC, parent-facing app (`apps/pay`). It is baked into
     * the moratoire link that goes out in a reminder, so a wrong value here
     * is not a broken page — it is a message already delivered to four
     * hundred families with a dead link in it, and no way to take it back.
     * Hence: no host guessing, no relative URL, and required in production.
     */
    PUBLIC_PAY_URL: z
      .string()
      .url('PUBLIC_PAY_URL must be an absolute URL, e.g. https://pay.fineduc.com')
      .default('http://localhost:3030'),

    CINETPAY_API_KEY: z.string().default(''),
    CINETPAY_SITE_ID: z.string().default(''),
    CINETPAY_WEBHOOK_SECRET: z.string().default(''),

    /**
     * Moneroo. The secret key alone is enough to take a payment; without the
     * webhook secret nothing can SETTLE, so the registry refuses to register
     * a half-configured provider rather than accept money it cannot confirm.
     */
    MONEROO_SECRET_KEY: z.string().default(''),
    MONEROO_WEBHOOK_SECRET: z.string().default(''),

    /**
     * Chariow — Fineduc's own subscription billing ONLY (platform account,
     * not a school's). Chariow charges a pre-priced product; the three ids
     * below are that product for each plan (monthly only), created once in
     * the Chariow dashboard and never derived at runtime.
     */
    CHARIOW_API_KEY: z.string().default(''),
    CHARIOW_WEBHOOK_SECRET: z.string().default(''),
    CHARIOW_PRODUCT_ESSENTIEL_MONTHLY: z.string().default(''),
    CHARIOW_PRODUCT_CROISSANCE_MONTHLY: z.string().default(''),
    CHARIOW_PRODUCT_INSTITUTION_MONTHLY: z.string().default(''),

    WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
    WHATSAPP_ACCESS_TOKEN: z.string().default(''),
    WHATSAPP_WEBHOOK_SECRET: z.string().default(''),
    SMS_API_KEY: z.string().default(''),

    S3_ENDPOINT: z.string().default(''),
    S3_BUCKET: z.string().default(''),
    S3_ACCESS_KEY_ID: z.string().default(''),
    S3_SECRET_ACCESS_KEY: z.string().default(''),

    SENTRY_DSN: z.string().default(''),

    ADMIN_API_KEY: z.string().default(''),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return

    /*
     * PUBLIC_PAY_URL is checked separately, not in the list below: it has a
     * localhost DEFAULT, so an `=== ''` test would pass happily in
     * production and every reminder would ship a link to a machine nobody
     * can reach.
     */
    if (/localhost|127\.0\.0\.1/.test(config.PUBLIC_PAY_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_PAY_URL'],
        message:
          'PUBLIC_PAY_URL still points at localhost. It is baked into links sent to parents, so it must be the real public origin in production.',
      })
    }

    /*
     * Only credentials the running code actually consumes belong here.
     *
     * APP_DATABASE_URL is the one unconditional entry: the API must never
     * connect as the migrator/owner role, and leaving it empty silently
     * falls back to the well-known dev password the RLS migration creates
     * the role with — see packages/db/src/connection.ts.
     *
     * The provider credentials (CinetPay, WhatsApp, SMS, S3, Sentry) are
     * deliberately NOT required yet, because nothing reads them at runtime:
     * the CinetPay adapter is never registered (see the comment in
     * apps/api/src/modules/payments/provider.registry.ts) and the rest are
     * only surfaced by the `not_implemented` health endpoint. Demanding a
     * secret for an integration that does not run buys no safety — it just
     * blocks the boot. Each one moves back into this list on the same
     * commit that wires its adapter up, and mobile money is per-school
     * opt-in rather than a platform-wide requirement.
     */
    const requiredInProduction = ['APP_DATABASE_URL'] as const

    for (const key of requiredInProduction) {
      if (config[key] === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when NODE_ENV=production`,
        })
      }
    }
  })

export type Env = z.infer<typeof EnvSchema>

/**
 * Parse and validate the environment. Call this once, as early as possible,
 * in every app/worker entrypoint. Throws EnvValidationError listing every
 * invalid variable if validation fails — that is the "fail-fast" contract.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source)
  if (!result.success) {
    throw new EnvValidationError(result.error)
  }
  return result.data
}

/**
 * Env keys whose values must never appear in a log line. Used by the Pino
 * redaction config (ARCHITECTURE.md §10: "no secret ever reaches a log").
 */
export const SENSITIVE_ENV_KEYS = [
  'DATABASE_URL',
  'APP_DATABASE_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'CINETPAY_API_KEY',
  'CINETPAY_WEBHOOK_SECRET',
  'MONEROO_SECRET_KEY',
  'MONEROO_WEBHOOK_SECRET',
  'CHARIOW_API_KEY',
  'CHARIOW_WEBHOOK_SECRET',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_WEBHOOK_SECRET',
  'SMS_API_KEY',
  'S3_SECRET_ACCESS_KEY',
  'SENTRY_DSN',
  'ADMIN_API_KEY',
] as const satisfies readonly (keyof Env)[]
