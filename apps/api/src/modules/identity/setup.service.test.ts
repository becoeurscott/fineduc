import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import argon2 from 'argon2'
import { SetupService } from './setup.service.js'

const CODE = 'ABCD-EFGH-JKMN'
const TEMP_EMAIL = 'fin-2026-001@fineduc.school'
const REAL_EMAIL = 'directeur@ecole-test.com'

describe('SetupService.approveSignup', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAuth: any
  let service: SetupService

  beforeEach(() => {
    mockPrisma = {
      client: {
        signupRequest: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'signup-1',
            status: 'pending',
            schoolName: 'Ecole Test',
            setupToken: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ nextval: 7n }]),
      },
    }
    mockAuth = { hashPassword: vi.fn().mockResolvedValue('hashed') }
    service = new SetupService(mockPrisma, mockAuth)
  })

  it('issues a setup token so the first-login link resolves', async () => {
    const result = await service.approveSignup('signup-1')

    // The regression: the link read the token off the row before it was
    // written, so every approval produced /first-login/null.
    expect(result.loginUrl).not.toContain('/null')
    expect(result.loginUrl).toMatch(/\/first-login\/[0-9a-f]{64}$/)
  })

  it('persists that token on the signup request', async () => {
    const result = await service.approveSignup('signup-1')
    const token = result.loginUrl.split('/').pop()

    expect(mockPrisma.client.signupRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ setupToken: token }),
      }),
    )
  })
})

describe('SetupService first-login provisioning', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  let service: SetupService
  let codeHash: string
  let setConfigCalls: string[]

  beforeAll(async () => {
    codeHash = await argon2.hash(CODE, { type: argon2.argon2id })
  })

  beforeEach(() => {
    setConfigCalls = []
    const tx = {
      // withTenant issues set_config before anything else runs; recording it
      // is how we prove the inserts happen inside a tenant context.
      $executeRaw: vi.fn((_strings: unknown, tenantId: string) => {
        setConfigCalls.push(tenantId)
        return Promise.resolve(1)
      }),
      tenant: { create: vi.fn((args: { data: { id: string } }) => Promise.resolve(args.data)) },
      site: { create: vi.fn().mockResolvedValue({}) },
      user: { create: vi.fn().mockResolvedValue({ id: 'user-1', email: TEMP_EMAIL }) },
      membership: { create: vi.fn().mockResolvedValue({}) },
      signupRequest: { update: vi.fn().mockResolvedValue({}) },
    }
    mockPrisma = {
      client: {
        signupRequest: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue({
            id: 'signup-1',
            status: 'approved',
            schoolName: 'Ecole Test',
            contactName: 'Directeur',
            country: 'CM',
            phone: '+237670000000',
            tempEmail: TEMP_EMAIL,
            tempCodeHash: codeHash,
          }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $transaction: vi.fn((fn: any) => fn(tx)),
      },
      __tx: tx,
    }
    service = new SetupService(mockPrisma, {
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      issueTokens: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  })

  it('creates the tenant inside a matching RLS context', async () => {
    await service.loginSchool(null, TEMP_EMAIL, CODE)

    const created = mockPrisma.__tx.tenant.create.mock.calls[0][0].data
    // The tenant policy checks the new row's own id against app.tenant_id, so
    // the context must name the very tenant being inserted.
    expect(setConfigCalls).toEqual([created.id])
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('opens the context before the first insert', async () => {
    await service.loginSchool(null, TEMP_EMAIL, CODE)

    const setConfigOrder = mockPrisma.__tx.$executeRaw.mock.invocationCallOrder[0]
    const tenantOrder = mockPrisma.__tx.tenant.create.mock.invocationCallOrder[0]
    expect(setConfigOrder).toBeLessThan(tenantOrder)
  })
})

describe('SetupService.loginSchool', () => {
  let setupService: SetupService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAuth: any
  let codeHash: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let membershipRows: any[]
  let userScopeCalls: string[]

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/fineduc'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.JWT_SECRET = 'x'.repeat(32)
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    codeHash = await argon2.hash(CODE, { type: argon2.argon2id })
  })

  beforeEach(() => {
    userScopeCalls = []
    membershipRows = []
    mockPrisma = {
      client: {
        signupRequest: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        // withUser() wraps the membership read in a transaction that sets
        // app.user_id first; the mock records it so the scoping can be asserted.
        $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
          fn({
            $executeRaw: vi.fn((_s: unknown, id: string) => {
              userScopeCalls.push(id)
              return Promise.resolve(1)
            }),
            membership: { findMany: vi.fn(() => Promise.resolve(membershipRows)) },
          }),
        ),
      },
    }
    mockAuth = {
      issueTokens: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    }
    setupService = new SetupService(mockPrisma, mockAuth)
  })

  /** The school has onboarded: its user row carries the real address now. */
  function provisionedUser(email: string) {
    membershipRows = [{ tenantId: '22222222-2222-2222-2222-222222222222', role: 'director' }]
    return {
      id: '11111111-1111-1111-1111-111111111111',
      email,
      passwordHash: codeHash,
      status: 'active',
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

  it('reads the memberships scoped to that user', async () => {
    mockPrisma.client.user.findFirst.mockResolvedValue(provisionedUser(REAL_EMAIL))

    await setupService.loginSchool(null, REAL_EMAIL, CODE)

    // membership is RLS-scoped and the tenant is not known yet, so the read has
    // to name the user. Without this it returns nothing and login fails.
    expect(userScopeCalls).toEqual(['11111111-1111-1111-1111-111111111111'])
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
