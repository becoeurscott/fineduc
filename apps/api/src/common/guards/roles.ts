/**
 * RBAC guard. Deny-by-default (ARCHITECTURE.md §10): if a handler has no
 * @Roles() decorator and is not @Public(), the request is rejected. The
 * 5-role model is director > bursar > cashier > secretary > auditor — but
 * roles are NOT hierarchical; each endpoint explicitly lists the roles
 * allowed.
 */
import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import type { MembershipRole } from '@fineduc/contracts'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js'
import { ROLES_KEY } from '../decorators/roles.decorator.js'
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Public routes skip both auth and RBAC.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const requiredRoles = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    )

    // Deny-by-default: if no @Roles() is set, reject.
    if (!requiredRoles || requiredRoles.length === 0) {
      throw new ForbiddenException('Access denied: no roles configured for this endpoint')
    }

    const request = context.switchToHttp().getRequest<Request>()
    const user = (request as Request & { user: AuthenticatedUser }).user
    if (!user) {
      throw new ForbiddenException('Access denied: no authenticated user')
    }

    if (!requiredRoles.includes(user.role as MembershipRole)) {
      throw new ForbiddenException('Access denied: insufficient role')
    }

    return true
  }
}
