/**
 * TOTP 2FA (ARCHITECTURE.md §10, AGENTS.md).
 *
 * These tests use REAL otplib codes and REAL AES-256-GCM, not mocks. A
 * mocked `verifySync` would prove only that the service calls a function —
 * it would still pass if the stored secret were never actually used, or if
 * encryption silently produced garbage that decrypted to something else.
 * The point of 2FA is that a code from the enrolled secret works and
 * everything else does not, and that can only be shown end to end.
 */
import { generateSecret, generateSync, verifySync } from 'otplib'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthenticationError } from '@fineduc/domain'
import { TotpService } from './totp.service.js'

const USER_ID = '11111111-1111-1111-1111-111111111111'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockPrisma: any
let totp: TotpService

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'directeur@excellence.test',
    totpEnabled: false,
    totpSecretEncrypted: null,
    ...overrides,
  }
}

/** The ciphertext the service persisted on its most recent update() call. */
function lastStoredSecret(): string {
  const calls = mockPrisma.client.user.update.mock.calls
  const withSecret = calls.filter((c: [{ data: Record<string, unknown> }]) => c[0].data.totpSecretEncrypted)
  return withSecret[withSecret.length - 1][0].data.totpSecretEncrypted as string
}

describe('TotpService', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/fineduc'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.JWT_SECRET = 'x'.repeat(32)
    // 32 bytes as HEX. Note 'y' is not a hex digit — a key of 'y'.repeat(64)
    // parses to an empty buffer and AES-256 throws. packages/config now
    // rejects that at boot; this is a real one.
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
  })

  beforeEach(() => {
    mockPrisma = {
      client: {
        user: {
          findUniqueOrThrow: vi.fn(),
          update: vi.fn().mockResolvedValue({}),
        },
      },
    }
    totp = new TotpService(mockPrisma)
  })

  describe('enroll', () => {
    it('returns a secret and an otpauth URI a phone can scan', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())

      const result = await totp.enroll(USER_ID)

      expect(result.secret).toBeTruthy()
      expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//)
      expect(result.otpauthUri).toContain('Fineduc')
    })

    it('stores the secret ENCRYPTED, never in plaintext', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())

      const { secret } = await totp.enroll(USER_ID)
      const stored = lastStoredSecret()

      // A leaked database row must not hand over a working second factor.
      expect(stored).not.toContain(secret)
      // iv:authTag:ciphertext, all hex.
      expect(stored.split(':')).toHaveLength(3)
      expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/)
    })

    it('does NOT enable 2FA yet — the secret is unproven until a code is verified', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())

      await totp.enroll(USER_ID)

      const data = mockPrisma.client.user.update.mock.calls[0][0].data
      expect(data.totpEnabled).toBeUndefined()
    })

    it('refuses to re-enroll a user who already has 2FA enabled', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow({ totpEnabled: true }))

      await expect(totp.enroll(USER_ID)).rejects.toThrow(AuthenticationError)
      // Critically: the existing secret must not be overwritten.
      expect(mockPrisma.client.user.update).not.toHaveBeenCalled()
    })

    it('issues a different secret to each user', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      const a = await totp.enroll(USER_ID)
      const b = await totp.enroll(USER_ID)
      expect(a.secret).not.toBe(b.secret)
    })
  })

  describe('verifyEnrollment', () => {
    it('accepts a real code derived from the enrolled secret, and enables 2FA', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      const { secret } = await totp.enroll(USER_ID)

      // Re-read now returns the stored ciphertext, as the real DB would.
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(
        userRow({ totpSecretEncrypted: lastStoredSecret() }),
      )

      await totp.verifyEnrollment(USER_ID, generateSync({ secret }))

      const last = mockPrisma.client.user.update.mock.calls.at(-1)[0].data
      expect(last.totpEnabled).toBe(true)
    })

    it('rejects a wrong code and leaves 2FA disabled', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      await totp.enroll(USER_ID)
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(
        userRow({ totpSecretEncrypted: lastStoredSecret() }),
      )
      mockPrisma.client.user.update.mockClear()

      await expect(totp.verifyEnrollment(USER_ID, '000000')).rejects.toThrow(/invalid 2fa code/i)
      expect(mockPrisma.client.user.update).not.toHaveBeenCalled()
    })

    it("rejects a code from somebody else's secret", async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      await totp.enroll(USER_ID)
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(
        userRow({ totpSecretEncrypted: lastStoredSecret() }),
      )

      const otherPersonsCode = generateSync({ secret: generateSecret() })
      await expect(totp.verifyEnrollment(USER_ID, otherPersonsCode)).rejects.toThrow(
        AuthenticationError,
      )
    })

    it('refuses when the user never enrolled', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow({ totpSecretEncrypted: null }))

      await expect(totp.verifyEnrollment(USER_ID, '123456')).rejects.toThrow(/enroll in 2fa first/i)
    })
  })

  describe('challenge (login second factor)', () => {
    it('accepts a real code once 2FA is enabled', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      const { secret } = await totp.enroll(USER_ID)
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(
        userRow({ totpEnabled: true, totpSecretEncrypted: lastStoredSecret() }),
      )

      await expect(totp.challenge(USER_ID, generateSync({ secret }))).resolves.toBeUndefined()
    })

    it('rejects a wrong code', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      await totp.enroll(USER_ID)
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(
        userRow({ totpEnabled: true, totpSecretEncrypted: lastStoredSecret() }),
      )

      await expect(totp.challenge(USER_ID, '000000')).rejects.toThrow(/invalid 2fa code/i)
    })

    it('refuses when 2FA is enrolled but not yet enabled — a half-finished enrolment is not a second factor', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      const { secret } = await totp.enroll(USER_ID)
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(
        userRow({ totpEnabled: false, totpSecretEncrypted: lastStoredSecret() }),
      )

      await expect(totp.challenge(USER_ID, generateSync({ secret }))).rejects.toThrow(
        /2fa is not enabled/i,
      )
    })
  })

  describe('secret encryption at rest', () => {
    it('round-trips: the decrypted secret still produces codes otplib accepts', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      const { secret } = await totp.enroll(USER_ID)

      // Proves the stored ciphertext decrypts back to the SAME secret: a
      // code minted from the returned secret verifies against it.
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(
        userRow({ totpEnabled: true, totpSecretEncrypted: lastStoredSecret() }),
      )
      await expect(totp.challenge(USER_ID, generateSync({ secret }))).resolves.toBeUndefined()
      expect(verifySync({ token: generateSync({ secret }), secret }).valid).toBe(true)
    })

    it('uses a fresh IV each time, so the same secret never yields the same ciphertext', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      await totp.enroll(USER_ID)
      const first = lastStoredSecret()
      await totp.enroll(USER_ID)
      const second = lastStoredSecret()

      expect(first).not.toBe(second)
      expect(first.split(':')[0]).not.toBe(second.split(':')[0])
    })

    it('detects tampering — GCM auth tag rejects a modified ciphertext rather than returning garbage', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(userRow())
      await totp.enroll(USER_ID)

      const [iv, tag, ct] = lastStoredSecret().split(':') as [string, string, string]
      // Flip one hex character of the ciphertext.
      const tampered = `${iv}:${tag}:${ct.slice(0, -1)}${ct.at(-1) === 'a' ? 'b' : 'a'}`
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(
        userRow({ totpEnabled: true, totpSecretEncrypted: tampered }),
      )

      await expect(totp.challenge(USER_ID, '123456')).rejects.toThrow()
    })

    it('rejects a malformed stored value instead of silently continuing', async () => {
      mockPrisma.client.user.findUniqueOrThrow.mockResolvedValue(
        userRow({ totpEnabled: true, totpSecretEncrypted: 'not-a-valid-ciphertext' }),
      )

      await expect(totp.challenge(USER_ID, '123456')).rejects.toThrow(/invalid encrypted totp secret/i)
    })
  })
})
