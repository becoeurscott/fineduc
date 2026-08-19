/**
 * Authentication service. Handles login (argon2id), JWT access/refresh token
 * lifecycle, and multi-tenant selection.
 *
 * ARCHITECTURE.md §7: login → pick tenant (if multiple) → scoped token.
 * ARCHITECTURE.md §10: argon2id, 15-min access token, 30-day refresh token,
 * rotating with reuse detection via familyId.
 */
import { Injectable, Logger } from '@nestjs/common'
import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { loadEnv } from '@fineduc/config'
import { PrismaService } from '../platform/prisma.service.js'
import { AuthenticationError } from '@fineduc/domain'
import type { LoginMembership } from '@fineduc/contracts'

const MAX_FAILED_LOGINS = 5
const LOCKOUT_MINUTES = 15
const ACCESS_TOKEN_EXPIRY = '15m'
const ACCESS_TOKEN_EXPIRY_SECONDS = 900
const REFRESH_TOKEN_DAYS = 30
const SELECTION_TOKEN_EXPIRY = '5m'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  private readonly jwtSecret: string

  constructor(private readonly prisma: PrismaService) {
    const env = loadEnv()
    this.jwtSecret = env.JWT_SECRET
  }

  /**
   * Step 1: Validate credentials. Returns user + memberships.
   * Does NOT issue a tenant-scoped access token yet (if multi-tenant).
   */
  async login(email: string, password: string): Promise<{
    user: { id: string; email: string; name: string }
    totpEnabled: boolean
    memberships: LoginMembership[]
    selectionToken?: string
    accessToken?: string
    refreshToken?: string
    expiresIn?: number
  }> {
    // User table has no RLS — queried directly.
    const user = await this.prisma.client.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { tenant: { select: { name: true } } },
        },
      },
    })

    if (!user) {
      throw new AuthenticationError('INVALID_CREDENTIALS', 'Invalid email or password')
    }

    // Check lockout.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AuthenticationError(
        'ACCOUNT_LOCKED',
        `Account is locked until ${user.lockedUntil.toISOString()}`,
      )
    }

    // Verify password.
    const valid = await argon2.verify(user.passwordHash, password)
    if (!valid) {
      await this.recordFailedLogin(user.id, user.failedLoginCount)
      throw new AuthenticationError('INVALID_CREDENTIALS', 'Invalid email or password')
    }

    // Reset failed attempts on success.
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    })

    const memberships: LoginMembership[] = user.memberships.map((m) => ({
      id: m.id,
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      siteId: m.siteId,
      role: m.role,
      status: m.status,
    }))

    const result: {
      user: { id: string; email: string; name: string }
      totpEnabled: boolean
      memberships: LoginMembership[]
      selectionToken?: string
      accessToken?: string
      refreshToken?: string
      expiresIn?: number
    } = {
      user: { id: user.id, email: user.email, name: user.name },
      totpEnabled: user.totpEnabled,
      memberships,
    }

    // If 2FA is enabled, return a selection token but no access token.
    // The client must call POST /auth/2fa/challenge.
    if (user.totpEnabled) {
      result.selectionToken = this.signSelectionToken(user.id)
      return result
    }

    // Auto-select if exactly one active membership.
    const [membership] = memberships
    if (memberships.length === 1 && membership) {
      const tokens = await this.issueTokens(user.id, user.email, membership.tenantId, membership.role)
      result.accessToken = tokens.accessToken
      result.refreshToken = tokens.refreshToken
      result.expiresIn = ACCESS_TOKEN_EXPIRY_SECONDS
    } else if (memberships.length > 1) {
      // Multi-tenant: issue a short-lived selection token.
      result.selectionToken = this.signSelectionToken(user.id)
    } else {
      throw new AuthenticationError('NO_ACTIVE_MEMBERSHIP', 'No active membership found')
    }

    return result
  }

  /**
   * Step 2 (multi-tenant): Select a tenant and get a scoped access token.
   */
  async selectTenant(selectionToken: string, tenantId: string): Promise<{
    accessToken: string
    refreshToken: string
    expiresIn: number
  }> {
    const payload = this.verifySelectionToken(selectionToken)
    const userId = payload.sub as string

    // Verify the user has an active membership in this tenant.
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    })
    if (!membership || membership.status !== 'active') {
      throw new AuthenticationError('INVALID_TENANT', 'No active membership in this tenant')
    }

    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
    })

    const tokens = await this.issueTokens(user.id, user.email, tenantId, membership.role)
    return { ...tokens, expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS }
  }

  /**
   * Refresh: rotate the refresh token. If the old token has been revoked
   * (replay attack), revoke the entire family (ARCHITECTURE.md §10).
   */
  async refresh(refreshToken: string): Promise<{
    accessToken: string
    refreshToken: string
    expiresIn: number
  }> {
    const tokenHash = await this.hashToken(refreshToken)

    const existing = await this.prisma.client.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { memberships: { where: { status: 'active' } } } } },
    })

    if (!existing) {
      throw new AuthenticationError('INVALID_REFRESH_TOKEN', 'Invalid refresh token')
    }

    // Reuse detection: if the token is already revoked, someone replayed it.
    if (existing.revokedAt) {
      this.logger.warn(`Refresh token reuse detected for family ${existing.familyId}`)
      // Revoke the entire family.
      await this.prisma.client.refreshToken.updateMany({
        where: { familyId: existing.familyId },
        data: { revokedAt: new Date() },
      })
      throw new AuthenticationError('TOKEN_REUSE_DETECTED', 'Refresh token has been revoked (possible replay)')
    }

    // Check expiry.
    if (existing.expiresAt < new Date()) {
      throw new AuthenticationError('REFRESH_TOKEN_EXPIRED', 'Refresh token has expired')
    }

    // Revoke the current token.
    await this.prisma.client.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    })

    // Find the membership used in the original token's context.
    // We need to look at the access token's tenantId, but since we don't store it
    // on the refresh token, we re-derive from the user's active memberships.
    // For a simpler approach, the access token's tenantId is embedded in a JWT.
    const membership = existing.user.memberships[0]
    if (!membership) {
      throw new AuthenticationError('NO_ACTIVE_MEMBERSHIP', 'No active membership found')
    }

    // Issue a new token pair in the same family.
    const tokens = await this.issueTokens(
      existing.userId,
      existing.user.email,
      membership.tenantId,
      membership.role,
      existing.familyId,
    )

    return { ...tokens, expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS }
  }

  /**
   * Logout: revoke the entire refresh token family.
   */
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = await this.hashToken(refreshToken)
    const existing = await this.prisma.client.refreshToken.findUnique({
      where: { tokenHash },
    })
    if (!existing) return // Already logged out or invalid — idempotent.

    await this.prisma.client.refreshToken.updateMany({
      where: { familyId: existing.familyId },
      data: { revokedAt: new Date() },
    })
  }

  /**
   * Hash a password with argon2id.
   */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id })
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async issueTokens(
    userId: string,
    email: string,
    tenantId: string,
    role: string,
    familyId?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = jwt.sign(
      { sub: userId, tenantId, role, email },
      this.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY },
    )

    const refreshTokenRaw = crypto.randomUUID()
    const refreshTokenHash = await this.hashToken(refreshTokenRaw)
    const newFamilyId = familyId ?? crypto.randomUUID()

    await this.prisma.client.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshTokenHash,
        familyId: newFamilyId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
      },
    })

    return { accessToken, refreshToken: refreshTokenRaw }
  }

  private signSelectionToken(userId: string): string {
    return jwt.sign({ sub: userId, purpose: 'tenant-selection' }, this.jwtSecret, {
      expiresIn: SELECTION_TOKEN_EXPIRY,
    })
  }

  private verifySelectionToken(token: string): jwt.JwtPayload {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload
      if (payload.purpose !== 'tenant-selection') {
        throw new AuthenticationError('INVALID_SELECTION_TOKEN', 'Invalid selection token')
      }
      return payload
    } catch {
      throw new AuthenticationError('INVALID_SELECTION_TOKEN', 'Invalid or expired selection token')
    }
  }

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async recordFailedLogin(userId: string, currentCount: number): Promise<void> {
    const newCount = currentCount + 1
    const lockedUntil =
      newCount >= MAX_FAILED_LOGINS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { failedLoginCount: newCount, lockedUntil },
    })
  }
}
