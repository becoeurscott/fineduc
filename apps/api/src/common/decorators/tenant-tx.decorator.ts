import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { TenantTransactionClient } from '@fineduc/db'

/**
 * Extract the tenant-scoped transaction client from the request.
 * The TenantContextInterceptor attaches this after calling withTenant().
 * Only available on authenticated, tenant-scoped routes.
 */
export const TenantTx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantTransactionClient => {
    const request = ctx.switchToHttp().getRequest<Request>()
    return (request as Request & { tenantTx: TenantTransactionClient }).tenantTx
  },
)
