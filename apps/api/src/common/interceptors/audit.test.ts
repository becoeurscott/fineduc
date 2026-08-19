/**
 * Audit interceptor (AGENTS.md rule #10, ARCHITECTURE.md §10).
 *
 * "Every mutating endpoint writes an audit row. If you add a mutation and
 * no audit row appears, the feature is incomplete." For a school that has
 * been burnt by a member of staff, this trail IS the product — PRD §5 says
 * so explicitly.
 *
 * Two properties matter most here and both are easy to regress:
 *   1. A mutation must never slip through unaudited.
 *   2. Auditing must never break the request. The write is
 *      fire-and-forget; if the audit table is unreachable, the cashier's
 *      receipt still prints.
 */
import { Reflector } from '@nestjs/core'
import { firstValueFrom, of, throwError } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallHandler, ExecutionContext } from '@nestjs/common'

const withTenantMock = vi.hoisted(() => vi.fn())
vi.mock('@fineduc/db', () => ({ withTenant: withTenantMock }))

const { AuditInterceptor } = await import('./audit.js')

const TENANT = '00000000-0000-4000-8000-00000000000a'
const USER = '11111111-1111-1111-1111-111111111111'

let auditCreate: ReturnType<typeof vi.fn>

interface RequestShape {
  method: string
  path?: string
  route?: { path: string }
  params?: Record<string, string>
  ip?: string
  headers?: Record<string, string>
  user?: { userId: string; tenantId: string; role: string }
}

function contextFor(req: RequestShape): ExecutionContext {
  const request = {
    headers: {},
    params: {},
    user: { userId: USER, tenantId: TENANT, role: 'bursar' },
    ...req,
  }
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

function interceptorWith(skipAudit: boolean) {
  const reflector = new Reflector()
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(skipAudit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = { client: {} } as any
  return new AuditInterceptor(reflector, prisma)
}

/** Audit writes are fire-and-forget; let the microtask queue drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function lastAuditRow(): Record<string, unknown> {
  return auditCreate.mock.calls.at(-1)?.[0].data as Record<string, unknown>
}

describe('AuditInterceptor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    auditCreate = vi.fn().mockResolvedValue({})
    withTenantMock.mockReset()
    withTenantMock.mockImplementation(
      async (_client: unknown, _tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ auditLog: { create: auditCreate } }),
    )
  })

  describe('what gets audited', () => {
    it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('writes a row for %s', async (method) => {
      const interceptor = interceptorWith(false)
      await firstValueFrom(
        interceptor.intercept(contextFor({ method, route: { path: '/students' } }), {
          handle: () => of({ id: 'stu-1' }),
        } as CallHandler),
      )
      await settle()

      expect(auditCreate).toHaveBeenCalledTimes(1)
    })

    it.each(['GET', 'HEAD', 'OPTIONS'])('does NOT write a row for %s — reads are not audited here', async (method) => {
      const interceptor = interceptorWith(false)
      await firstValueFrom(
        interceptor.intercept(contextFor({ method, route: { path: '/students' } }), {
          handle: () => of([]),
        } as CallHandler),
      )
      await settle()

      expect(auditCreate).not.toHaveBeenCalled()
    })

    it('honours @SkipAudit() — used by health checks, which would otherwise flood the log', async () => {
      const interceptor = interceptorWith(true)
      await firstValueFrom(
        interceptor.intercept(contextFor({ method: 'POST', route: { path: '/health' } }), {
          handle: () => of({}),
        } as CallHandler),
      )
      await settle()

      expect(auditCreate).not.toHaveBeenCalled()
    })

    it('writes nothing when there is no authenticated tenant', async () => {
      const interceptor = interceptorWith(false)
      const request = { method: 'POST', route: { path: '/auth/login' }, headers: {}, params: {} }
      const context = {
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext

      await firstValueFrom(interceptor.intercept(context, { handle: () => of({}) } as CallHandler))
      await settle()

      expect(auditCreate).not.toHaveBeenCalled()
    })
  })

  describe('what the row records', () => {
    it('records the actor, their role, and the tenant', async () => {
      const interceptor = interceptorWith(false)
      await firstValueFrom(
        interceptor.intercept(contextFor({ method: 'POST', route: { path: '/students' } }), {
          handle: () => of({ id: 'stu-1' }),
        } as CallHandler),
      )
      await settle()

      expect(lastAuditRow()).toMatchObject({
        tenantId: TENANT,
        actorUserId: USER,
        actorRole: 'bursar',
      })
    })

    it('records the request origin for forensics', async () => {
      const interceptor = interceptorWith(false)
      await firstValueFrom(
        interceptor.intercept(
          contextFor({
            method: 'POST',
            route: { path: '/students' },
            ip: '41.202.219.10',
            headers: { 'user-agent': 'Chrome/120', 'x-request-id': 'req-42' },
          }),
          { handle: () => of({ id: 'stu-1' }) } as CallHandler,
        ),
      )
      await settle()

      expect(lastAuditRow()).toMatchObject({
        ip: '41.202.219.10',
        userAgent: 'Chrome/120',
        requestId: 'req-42',
      })
    })

    it('takes the entity id from the created resource', async () => {
      const interceptor = interceptorWith(false)
      await firstValueFrom(
        interceptor.intercept(contextFor({ method: 'POST', route: { path: '/students' } }), {
          handle: () => of({ id: 'stu-created' }),
        } as CallHandler),
      )
      await settle()

      expect(lastAuditRow().entityId).toBe('stu-created')
      expect(lastAuditRow().entityType).toBe('student')
    })

    it('falls back to the route param when the response carries no id', async () => {
      const interceptor = interceptorWith(false)
      await firstValueFrom(
        interceptor.intercept(
          contextFor({ method: 'PATCH', route: { path: '/students/:id' }, params: { id: 'stu-77' } }),
          { handle: () => of(undefined) } as CallHandler,
        ),
      )
      await settle()

      expect(lastAuditRow().entityId).toBe('stu-77')
    })

    it('records the method and route as the action', async () => {
      const interceptor = interceptorWith(false)
      await firstValueFrom(
        interceptor.intercept(contextFor({ method: 'DELETE', route: { path: '/sites/:id' }, params: { id: 's1' } }), {
          handle: () => of(undefined),
        } as CallHandler),
      )
      await settle()

      expect(lastAuditRow().action).toBe('DELETE /sites/:id')
      expect(lastAuditRow().entityType).toBe('site')
    })
  })

  describe('auditing must never break the request', () => {
    it('still returns the response when the audit write fails', async () => {
      withTenantMock.mockRejectedValue(new Error('audit table unreachable'))
      const interceptor = interceptorWith(false)

      const result = await firstValueFrom(
        interceptor.intercept(contextFor({ method: 'POST', route: { path: '/payments' } }), {
          handle: () => of({ id: 'pay-1', receiptNumber: 'RCT-0001' }),
        } as CallHandler),
      )
      await settle()

      // The cashier's receipt still prints.
      expect(result).toEqual({ id: 'pay-1', receiptNumber: 'RCT-0001' })
    })

    it('does not audit a mutation that FAILED — no row for something that never happened', async () => {
      const interceptor = interceptorWith(false)

      await expect(
        firstValueFrom(
          interceptor.intercept(contextFor({ method: 'POST', route: { path: '/students' } }), {
            handle: () => throwError(() => new Error('validation failed')),
          } as CallHandler),
        ),
      ).rejects.toThrow('validation failed')
      await settle()

      expect(auditCreate).not.toHaveBeenCalled()
    })
  })
})
