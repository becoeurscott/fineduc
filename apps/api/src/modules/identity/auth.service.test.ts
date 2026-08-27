import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { AuthService } from './auth.service.js'
import { AuthenticationError } from '@fineduc/domain'
import argon2 from 'argon2'

describe('AuthService', () => {
  let authService: AuthService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let membershipRows: any[]

  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/fineduc'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.JWT_SECRET = 'x'.repeat(32)
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
  })

  beforeEach(() => {
    membershipRows = []
    mockPrisma = {
      client: {
        user: {
          findUnique: vi.fn(),
          findUniqueOrThrow: vi.fn(),
          update: vi.fn(),
          create: vi.fn(),
        },
        membership: {
          findUnique: vi.fn(),
        },
        // membership and tenant are both RLS-scoped, so login reads them
        // through withUser()/withTenant(), each of which opens a transaction.
        $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
          fn({
            $executeRaw: vi.fn().mockResolvedValue(1),
            membership: { findMany: vi.fn(() => Promise.resolve(membershipRows)) },
            tenant: { findUnique: vi.fn(() => Promise.resolve({ name: 'Ecole Test' })) },
          }),
        ),
        refreshToken: {
          create: vi.fn(),
          findUnique: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
        },
      },
    }
    authService = new AuthService(mockPrisma)
  })

  describe('login', () => {
    it('throws AuthenticationError when user is not found', async () => {
      mockPrisma.client.user.findUnique.mockResolvedValue(null)

      await expect(authService.login('unknown@fineduc.test', 'secret')).rejects.toThrow(
        AuthenticationError,
      )
    })

    it('throws AuthenticationError when account is locked', async () => {
      mockPrisma.client.user.findUnique.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'locked@fineduc.test',
        lockedUntil: new Date(Date.now() + 60_000),
        memberships: [],
      })

      await expect(authService.login('locked@fineduc.test', 'secret')).rejects.toThrow(
        /Account is locked/,
      )
    })

    it('records failed login attempt on wrong password', async () => {
      const passwordHash = await argon2.hash('correct-password')
      mockPrisma.client.user.findUnique.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'user@fineduc.test',
        passwordHash,
        failedLoginCount: 2,
        lockedUntil: null,
        memberships: [],
      })

      await expect(authService.login('user@fineduc.test', 'wrong-password')).rejects.toThrow(
        AuthenticationError,
      )

      expect(mockPrisma.client.user.update).toHaveBeenCalledWith({
        where: { id: '11111111-1111-1111-1111-111111111111' },
        data: { failedLoginCount: 3, lockedUntil: null },
      })
    })

    it('locks account on 5th failed attempt', async () => {
      const passwordHash = await argon2.hash('correct-password')
      mockPrisma.client.user.findUnique.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'user@fineduc.test',
        passwordHash,
        failedLoginCount: 4,
        lockedUntil: null,
        memberships: [],
      })

      await expect(authService.login('user@fineduc.test', 'wrong-password')).rejects.toThrow(
        AuthenticationError,
      )

      expect(mockPrisma.client.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '11111111-1111-1111-1111-111111111111' },
          data: expect.objectContaining({ failedLoginCount: 5 }),
        }),
      )
    })

    it('auto-selects tenant and issues tokens when user has exactly one membership', async () => {
      const passwordHash = await argon2.hash('secret123')
      const tenantId = '22222222-2222-2222-2222-222222222222'
      mockPrisma.client.user.findUnique.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'director@fineduc.test',
        name: 'Director',
        passwordHash,
        totpEnabled: false,
        failedLoginCount: 0,
        lockedUntil: null,
      })

      membershipRows = [
        {
          id: '33333333-3333-3333-3333-333333333333',
          tenantId,
          siteId: null,
          role: 'director',
          status: 'active',
        },
      ]

      const res = await authService.login('director@fineduc.test', 'secret123')

      expect(res.accessToken).toBeDefined()
      expect(res.refreshToken).toBeDefined()
      expect(res.expiresIn).toBe(900)
      expect(res.memberships).toHaveLength(1)
      expect(mockPrisma.client.refreshToken.create).toHaveBeenCalled()
    })
  })

  describe('refresh', () => {
    it('detects refresh token reuse and revokes the family', async () => {
      const familyId = '44444444-4444-4444-4444-444444444444'
      mockPrisma.client.refreshToken.findUnique.mockResolvedValue({
        id: '55555555-5555-5555-5555-555555555555',
        familyId,
        revokedAt: new Date(Date.now() - 1000), // already revoked!
        expiresAt: new Date(Date.now() + 100_000),
        user: { memberships: [{ tenantId: '22222222-2222-2222-2222-222222222222', role: 'director' }] },
      })

      await expect(authService.refresh('replayed-token')).rejects.toThrow(
        /Refresh token has been revoked/,
      )

      expect(mockPrisma.client.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId },
        data: { revokedAt: expect.any(Date) },
      })
    })
  })
})
