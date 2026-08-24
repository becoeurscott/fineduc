import { describe, expect, it } from 'vitest'
import { EnvValidationError } from './errors.js'
import { loadEnv } from './env.js'

const validBase: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/fineduc',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: 'a'.repeat(64),
}

describe('loadEnv — development defaults', () => {
  it('accepts the minimal required set and fills in defaults', () => {
    const env = loadEnv(validBase)
    expect(env.NODE_ENV).toBe('development')
    expect(env.PORT).toBe(3000)
    expect(env.LOG_LEVEL).toBe('info')
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([])
  })

  it('does not require provider secrets outside production', () => {
    const env = loadEnv({ ...validBase, NODE_ENV: 'test' })
    expect(env.CINETPAY_API_KEY).toBe('')
    expect(env.S3_BUCKET).toBe('')
    expect(env.APP_DATABASE_URL).toBe('')
  })

  it('coerces PORT to a number', () => {
    expect(loadEnv({ ...validBase, PORT: '4000' }).PORT).toBe(4000)
  })

  it('parses a comma-separated CORS origin list', () => {
    const env = loadEnv({
      ...validBase,
      CORS_ALLOWED_ORIGINS: ' https://a.example.com , https://b.example.com ',
    })
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com'])
  })
})

describe('loadEnv — required core variables', () => {
  it('throws EnvValidationError when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validBase
    expect(() => loadEnv(rest)).toThrow(EnvValidationError)
  })

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadEnv({ ...validBase, DATABASE_URL: 'mysql://localhost/db' })).toThrow(EnvValidationError)
  })

  it('rejects a non-redis REDIS_URL', () => {
    expect(() => loadEnv({ ...validBase, REDIS_URL: 'http://localhost:6379' })).toThrow(EnvValidationError)
  })

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => loadEnv({ ...validBase, JWT_SECRET: 'short' })).toThrow(EnvValidationError)
  })

  it('rejects an ENCRYPTION_KEY shorter than 32 characters', () => {
    expect(() => loadEnv({ ...validBase, ENCRYPTION_KEY: 'short' })).toThrow(EnvValidationError)
  })

  it('rejects a 64-character ENCRYPTION_KEY that is not valid hex', () => {
    // The real failure this guards against: 'y' is not a hex digit, so
    // Buffer.from(key, 'hex') silently yields an empty buffer and AES-256
    // throws "Invalid key length" — at first 2FA enrolment, not at boot.
    expect(() => loadEnv({ ...validBase, ENCRYPTION_KEY: 'y'.repeat(64) })).toThrow(
      EnvValidationError,
    )
  })

  it('rejects a hex ENCRYPTION_KEY of the wrong length (must be exactly 32 bytes)', () => {
    expect(() => loadEnv({ ...validBase, ENCRYPTION_KEY: 'ab'.repeat(16) })).toThrow(
      EnvValidationError,
    )
  })

  it('accepts a proper 64-character hex ENCRYPTION_KEY, upper or lower case', () => {
    expect(() => loadEnv({ ...validBase, ENCRYPTION_KEY: 'AB'.repeat(32) })).not.toThrow()
  })

  it('lists every invalid variable in one error, not just the first', () => {
    try {
      loadEnv({ JWT_SECRET: 'short', ENCRYPTION_KEY: 'also-short' })
      expect.fail('expected loadEnv to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const message = (error as Error).message
      expect(message).toContain('DATABASE_URL')
      expect(message).toContain('REDIS_URL')
      expect(message).toContain('JWT_SECRET')
      expect(message).toContain('ENCRYPTION_KEY')
    }
  })
})

describe('loadEnv — production requires the credentials the code actually uses', () => {
  const productionExtras = {
    APP_DATABASE_URL: 'postgresql://fineduc_app:secret@db.internal:5432/fineduc',
    PUBLIC_PAY_URL: 'https://pay.fineduc.com',
  }

  it('accepts production with only APP_DATABASE_URL and a real PUBLIC_PAY_URL', () => {
    expect(() => loadEnv({ ...validBase, NODE_ENV: 'production', ...productionExtras })).not.toThrow()
  })

  it('rejects production when APP_DATABASE_URL is missing, naming it', () => {
    try {
      loadEnv({ ...validBase, NODE_ENV: 'production', ...productionExtras, APP_DATABASE_URL: '' })
      expect.fail('expected loadEnv to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      expect((error as Error).message).toContain('APP_DATABASE_URL is required when NODE_ENV=production')
    }
  })

  /*
   * The counterpart to the rule above: a credential whose adapter is not
   * wired must NOT block the boot. If someone registers the CinetPay or
   * WhatsApp adapter without moving its key back into requiredInProduction,
   * this test keeps passing and is the wrong kind of green — the reminder
   * lives in the comment on requiredInProduction in env.ts.
   */
  it('does not require provider credentials whose adapters are not wired yet', () => {
    const env = loadEnv({ ...validBase, NODE_ENV: 'production', ...productionExtras })
    expect(env.CINETPAY_API_KEY).toBe('')
    expect(env.WHATSAPP_ACCESS_TOKEN).toBe('')
    expect(env.SMS_API_KEY).toBe('')
    expect(env.S3_BUCKET).toBe('')
    expect(env.SENTRY_DSN).toBe('')
  })
})

describe('PUBLIC_PAY_URL', () => {
  const productionBase = {
    APP_DATABASE_URL: 'postgresql://fineduc_app:secret@db.internal:5432/fineduc',
    PUBLIC_PAY_URL: 'https://pay.fineduc.com',
    CINETPAY_API_KEY: 'k',
    CINETPAY_SITE_ID: 's',
    CINETPAY_WEBHOOK_SECRET: 'w',
    WHATSAPP_PHONE_NUMBER_ID: 'p',
    WHATSAPP_ACCESS_TOKEN: 't',
    WHATSAPP_WEBHOOK_SECRET: 'w',
    SMS_API_KEY: 'k',
    S3_ENDPOINT: 'e',
    S3_BUCKET: 'b',
    S3_ACCESS_KEY_ID: 'a',
    S3_SECRET_ACCESS_KEY: 's',
    SENTRY_DSN: 'd',
  }

  it('defaults to the local pay app in development', () => {
    expect(loadEnv(validBase).PUBLIC_PAY_URL).toBe('http://localhost:3030')
  })

  it('rejects a relative or malformed URL — a link in a message must be absolute', () => {
    expect(() => loadEnv({ ...validBase, PUBLIC_PAY_URL: '/moratoire' })).toThrow()
    expect(() => loadEnv({ ...validBase, PUBLIC_PAY_URL: 'pay.fineduc.com' })).toThrow()
  })

  /**
   * The check that a plain `=== ''` test would have missed. This variable has
   * a localhost DEFAULT, so "is it set?" is always true — and shipping the
   * default to production means every reminder carries a link to a machine
   * nobody can reach, in a message already delivered and impossible to recall.
   */
  it('refuses to boot production while still pointing at localhost', () => {
    for (const url of ['http://localhost:3030', 'http://127.0.0.1:3030']) {
      try {
        loadEnv({ ...validBase, NODE_ENV: 'production', ...productionBase, PUBLIC_PAY_URL: url })
        throw new Error(`expected loadEnv to reject ${url}`)
      } catch (error) {
        expect((error as Error).message).toContain('PUBLIC_PAY_URL')
      }
    }
  })

  it('accepts a real public origin in production', () => {
    expect(() =>
      loadEnv({ ...validBase, NODE_ENV: 'production', ...productionBase, PUBLIC_PAY_URL: 'https://pay.fineduc.com' }),
    ).not.toThrow()
  })
})
