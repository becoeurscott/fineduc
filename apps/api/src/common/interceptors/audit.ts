/**
 * Audit interceptor. Writes an `audit_log` row for every mutating request
 * (POST, PATCH, PUT, DELETE). Applied globally; opt out with @SkipAudit().
 *
 * AGENTS.md rule #10: "Every mutating endpoint writes an audit row. If you
 * add a mutation and no audit row appears, the feature is incomplete."
 *
 * The interceptor runs AFTER the handler completes (tap on the response
 * observable). It writes the audit row in a separate transaction — NOT in
 * the tenant-scoped transaction — because audit_log is append-only and
 * must persist even if the business transaction rolls back (for forensics).
 *
 * AGENTS.md rule #11: "Never log a phone number, a full name, a matricule,
 * a token, or a secret." The `before`/`after` snapshots are NOT implemented
 * yet (they need the service layer to provide them). For now the interceptor
 * records the action, entity type, entity id, actor, IP, and user-agent.
 */
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { type Observable, tap } from 'rxjs'
import { withTenant } from '@fineduc/db'
import { SKIP_AUDIT_KEY } from '../decorators/skip-audit.decorator.js'
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js'
import { PrismaService } from '../../modules/platform/prisma.service.js'

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>()

    // Only audit mutations.
    if (!MUTATING_METHODS.has(request.method)) return next.handle()

    // Skip if decorated with @SkipAudit().
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (skip) return next.handle()

    const user = (request as Request & { user?: AuthenticatedUser }).user

    return next.handle().pipe(
      tap({
        next: (responseBody: unknown) => {
          // Fire-and-forget — the audit write must not slow down or fail the response.
          this.writeAuditLog(request, user, responseBody).catch((error: unknown) => {
            this.logger.error('Failed to write audit log', error instanceof Error ? error.stack : String(error))
          })
        },
      }),
    )
  }

  private async writeAuditLog(
    request: Request,
    user: AuthenticatedUser | undefined,
    responseBody: unknown,
  ): Promise<void> {
    if (!user?.tenantId) return

    // Derive entity info from the response body or route params.
    const entityId = this.extractEntityId(request, responseBody)
    const entityType = this.extractEntityType(request)
    const action = `${request.method} ${request.route?.path ?? request.path}`

    await withTenant(this.prisma.client, user.tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: user.tenantId,
          actorUserId: user.userId,
          actorRole: user.role,
          action,
          entityType,
          entityId,
          ip: request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
          requestId: (request.headers['x-request-id'] as string | undefined) ?? null,
        },
      })
    })
  }

  private extractEntityId(request: Request, responseBody: unknown): string {
    // Try the response body first (for create operations that return the new entity).
    if (responseBody && typeof responseBody === 'object' && 'id' in responseBody) {
      return String((responseBody as { id: unknown }).id)
    }
    // Fall back to route params.
    const paramId = request.params?.id
    const firstParam = Array.isArray(paramId) ? paramId[0] : paramId
    if (firstParam) {
      return firstParam
    }
    // Placeholder for operations that don't have an obvious entity id.
    return '00000000-0000-0000-0000-000000000000'
  }

  private extractEntityType(request: Request): string {
    // Derive from the route path: /users/:id → "user", /sites → "site".
    const routePath = request.route?.path ?? request.path
    const segments = routePath
      .split('/')
      .filter((s: string) => s && !s.startsWith(':'))
    const last = segments[segments.length - 1]
    if (!last) return 'unknown'
    // Singularise naive plurals (users → user, sites → site).
    return last.endsWith('s') ? last.slice(0, -1) : last
  }
}
