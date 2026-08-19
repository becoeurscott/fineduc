/**
 * User management service. Invite users, change roles, activate/suspend.
 * All operations run within a tenant context (via the @TenantTx decorator
 * in the controller).
 */
import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { ConflictError, NotFoundError } from '@fineduc/domain'
import type { MembershipRole, InviteUserRequest } from '@fineduc/contracts'
import { PrismaService } from '../platform/prisma.service.js'
import { AuthService } from './auth.service.js'

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Invite a user into this tenant. If the user already exists (by email),
   * add a membership. If not, create the user (status=invited) with a
   * temporary password.
   */
  async invite(
    tx: TenantTransactionClient,
    tenantId: string,
    input: InviteUserRequest,
  ): Promise<{ userId: string; membershipId: string; isNewUser: boolean }> {
    const email = input.email.toLowerCase().trim()

    // Check if user exists globally (User table has no RLS).
    let user = await this.prisma.client.user.findUnique({
      where: { email },
    })

    let isNewUser = false

    if (!user) {
      // Generate a temporary password the director communicates out-of-band.
      const tempPassword = crypto.randomUUID().slice(0, 12)
      const passwordHash = await this.authService.hashPassword(tempPassword)

      user = await this.prisma.client.user.create({
        data: {
          email,
          name: input.name,
          passwordHash,
          status: 'invited',
        },
      })
      isNewUser = true
    }

    // Check if membership already exists in this tenant.
    const existingMembership = await tx.membership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId } },
    })
    if (existingMembership) {
      throw new ConflictError(
        'MEMBERSHIP_EXISTS',
        `User ${email} already has a membership in this tenant`,
      )
    }

    // Create the membership.
    const membership = await tx.membership.create({
      data: {
        tenantId,
        userId: user.id,
        siteId: input.siteId ?? null,
        role: input.role,
        status: 'invited',
      },
    })

    return { userId: user.id, membershipId: membership.id, isNewUser }
  }

  /**
   * Change a user's role within this tenant.
   */
  async changeRole(
    tx: TenantTransactionClient,
    tenantId: string,
    userId: string,
    newRole: MembershipRole,
  ): Promise<void> {
    const membership = await tx.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    })
    if (!membership) {
      throw new NotFoundError('membership', `userId=${userId} tenantId=${tenantId}`)
    }

    await tx.membership.update({
      where: { id: membership.id },
      data: { role: newRole },
    })
  }

  /**
   * Activate or suspend a user's membership.
   */
  async changeStatus(
    tx: TenantTransactionClient,
    tenantId: string,
    userId: string,
    status: 'active' | 'suspended',
  ): Promise<void> {
    const membership = await tx.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    })
    if (!membership) {
      throw new NotFoundError('membership', `userId=${userId} tenantId=${tenantId}`)
    }

    await tx.membership.update({
      where: { id: membership.id },
      data: { status },
    })
  }

  /**
   * Get current user's profile and all their memberships.
   */
  async getMe(userId: string): Promise<{
    user: {
      id: string; email: string; name: string; phone: string | null
      status: string; totpEnabled: boolean; lastLoginAt: string | null; createdAt: string
    }
    memberships: Array<{
      id: string; tenantId: string; tenantName: string
      siteId: string | null; role: string; status: string; createdAt: string
    }>
  }> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          include: { tenant: { select: { name: true } } },
        },
      },
    })

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        status: user.status,
        totpEnabled: user.totpEnabled,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      },
      memberships: user.memberships.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        siteId: m.siteId,
        role: m.role,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
    }
  }

  /**
   * List users (memberships) in this tenant.
   */
  async list(
    tx: TenantTransactionClient,
    tenantId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{
    data: Array<{
      id: string; userId: string; email: string; name: string
      role: string; status: string; createdAt: string
    }>
    nextCursor: string | null
    hasMore: boolean
  }> {
    const memberships = await tx.membership.findMany({
      where: { tenantId },
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = memberships.length > limit
    const data = memberships.slice(0, limit).map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
    }))

    return {
      data,
      nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
      hasMore,
    }
  }
}
