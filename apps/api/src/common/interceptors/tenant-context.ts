/**
 * Tenant context interceptor. For every authenticated request, resolves the
 * tenant from the JWT payload and opens a `withTenant()` transaction so
 * every query the handler makes is RLS-scoped.
 *
 * ARCHITECTURE.md §4 / AGENTS.md rule #4: "Every tenant-scoped query runs
 * inside a transaction that has issued `set local app.tenant_id`."
 *
 * The interceptor attaches the `TenantTransactionClient` to `request.tenantTx`
 * so controllers can extract it via the @TenantTx() decorator and pass it to
 * services.
 *
 * @Public() routes (login, webhooks, pay page) skip this entirely.
 */
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { type Observable, from } from 'rxjs'
import { withTenant, type TenantTransactionClient } from '@fineduc/db'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js'
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js'
import { PrismaService } from '../../modules/platform/prisma.service.js'

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return next.handle()

    const request = context.switchToHttp().getRequest<Request>()
    const user = (request as Request & { user?: AuthenticatedUser }).user
    if (!user?.tenantId) return next.handle()

    // Wrap the handler in a withTenant transaction. The transaction client
    // is attached to the request so @TenantTx() can extract it.
    return from(
      withTenant(this.prisma.client, user.tenantId, async (tx) => {
        ;(request as Request & { tenantTx: TenantTransactionClient }).tenantTx = tx
        // Convert the observable to a promise to run inside the transaction.
        return new Promise((resolve, reject) => {
          next.handle().subscribe({
            next: resolve,
            error: reject,
          })
        })
      }),
    )
  }
}
