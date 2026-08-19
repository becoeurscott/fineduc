import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

/**
 * The JWT payload attached to the request by AuthGuard.
 */
export interface AuthenticatedUser {
  userId: string
  tenantId: string
  role: string
  email: string
}

/**
 * Extract the authenticated user from the request. Throws at compile time
 * if used on a @Public() route (the type won't be there).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>()
    // The AuthGuard attaches this. If it's missing, the guard didn't run,
    // which means the endpoint is @Public() and this decorator shouldn't
    // be used there.
    return (request as Request & { user: AuthenticatedUser }).user
  },
)
