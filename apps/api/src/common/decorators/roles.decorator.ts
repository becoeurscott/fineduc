import { SetMetadata } from '@nestjs/common'
import type { MembershipRole } from '@fineduc/contracts'

/**
 * Set the allowed roles for a route. If no @Roles() is present and the
 * route is not @Public(), the RolesGuard denies the request (deny-by-default,
 * ARCHITECTURE.md §10).
 */
export const ROLES_KEY = 'roles'
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles)
