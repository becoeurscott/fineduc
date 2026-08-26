import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import argon2 from 'argon2'
import { SetupService } from './setup.service.js'

const CODE = 'ABCD-EFGH-JKMN'
const TEMP_EMAIL = 'fin-2026-001@fineduc.school'
const REAL_EMAIL = 'directeur@ecole-test.com'

describe('SetupService.loginSchool', () => {
  let setupService: SetupService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAuth: any
  let codeHash: string

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/fineduc'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.JWT_SECRET = 'x'.repeat(32)
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    codeHash = await argon2.hash(CODE, { type: argon2.argon2id })
  })

  beforeEach(() => {
    mockPrisma = {
      client: {
        signupRequest: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    }
    mockAuth = {
      issueTokens: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    }
    setupService = new SetupService(mockPrisma, mockAuth)
  })

  /** The school has onboarded: its user row carries the real address now. */
  function provisionedUser(email: string) {
    return {
      id: '11111111-1111-1111-1111-111111111111',
      email,
      passwordHash: codeHash,
      status: 'active',
      memberships: [{ tenantId: '22222222-2222-2222-2222-222222222222', role: 'director' }],
    }
  }

  it('signs a school in with the real e-mail it set during onboarding', async () => {
    mockPrisma.client.user.findFirst.mockResolvedValue(provisionedUser(REAL_EMAIL))

    const result = await setupService.loginSchool(null, REAL_EMAIL, CODE)

    expect(result.accessToken).toBe('access')
    expect(result.needsOnboarding).toBe(false)
  })

  it('sends a school that has not replaced its temporary e-mail back to onboarding', async () => {
    mockPrisma.client.user.findFirst.mockResolvedValue(provisionedUser(TEMP_EMAIL))

    const result = await setupService.loginSchool(null, TEMP_EMAIL, CODE)

    expect(result.needsOnboarding).toBe(true)
  })

  it('rejects the temporary e-mail once onboarding has replaced it', async () => {
    // No user answers to the temporary address any more, and the signup row is
    // no longer 'approved', so the old WhatsApp link stops working.
    mockPrisma.client.signupRequest.findFirst.mockResolvedValue({
      id: 'signup-1',
      status: 'setup_complete',
      tempEmail: TEMP_EMAIL,
      tempCodeHash: codeHash,
    })

    await expect(setupService.loginSchool(null, TEMP_EMAIL, CODE)).rejects.toThrow(
      /E-mail ou code incorrect/,
    )
  })

  it('rejects a wrong code against a provisioned school', async () => {
    mockPrisma.client.user.findFirst.mockResolvedValue(provisionedUser(REAL_EMAIL))

    await expect(setupService.loginSchool(null, REAL_EMAIL, 'WRON-GCOD-EXXX')).rejects.toThrow(
      /E-mail ou code incorrect/,
    )
  })

  it('gives an unknown e-mail the same message as a wrong code', async () => {
    await expect(setupService.loginSchool(null, 'nobody@example.com', CODE)).rejects.toThrow(
      /E-mail ou code incorrect/,
    )
  })

  it('matches the e-mail case-insensitively', async () => {
    mockPrisma.client.user.findFirst.mockResolvedValue(provisionedUser(REAL_EMAIL))

    await setupService.loginSchool(null, REAL_EMAIL.toUpperCase(), CODE)

    expect(mockPrisma.client.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: REAL_EMAIL, mode: 'insensitive' },
          status: 'active',
        }),
      }),
    )
  })
})
