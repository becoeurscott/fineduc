/**
 * Tenant context interceptor (ARCHITECTURE.md §4, AGENTS.md rule #4).
 *
 * This is the piece that turns the RLS policies from phase 1 into
 * something the API uses automatically. If it stops opening a
 * `withTenant()` transaction, handlers silently fall back to a connection
 * with no `app.tenant_id` set — and the policies fail CLOSED, so the
 * symptom is "every endpoint returns nothing", not a security hole. The
 * dangerous direction is the opposite: attaching the WRONG tenant.
 *
 * `withTenant` is mocked here because its real behaviour — that Postgres
 * actually enforces the isolation — is already proven against a live
 * database by packages/db's cross-tenant isolation test. What this file
 * proves is that the interceptor CALLS it, with the right tenant, on the
 * right requests.
 */
import { Reflector } from '@nestjs/core'
import { firstValueFrom, of, throwError } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallHandler, ExecutionContext } from '@nestjs/common'

const withTenantMock = vi.hoisted(() => vi.fn())
vi.mock('@fineduc/db', () => ({
  withTenant: withTenantMock,
}))

const { TenantContextInterceptor } = await import('./tenant-context.js')

const TENANT_A = '00000000-0000-4000-8000-00000000000a'

function contextFor(user?: { userId?: string; tenantId?: string; role?: string }) {
  const request: Record<string, unknown> = user ? { user } : {}
  return {
    context: {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
    request,
  }
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) }
}

function interceptorWith(isPublic: boolean) {
  const reflector = new Reflector()
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = { client: { $connect: vi.fn() } } as any
  return new TenantContextInterceptor(reflector, prisma)
}

describe('TenantContextInterceptor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    withTenantMock.mockReset()
    // Default: run the callback the interceptor passes in, as withTenant would.
    withTenantMock.mockImplementation(
      async (_client: unknown, _tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ __tenantTx: true }),
    )
  })

  it('opens a withTenant transaction using the tenant from the JWT', async () => {
    const { context } = contextFor({ userId: 'u1', tenantId: TENANT_A, role: 'director' })
    const interceptor = interceptorWith(false)

    await firstValueFrom(interceptor.intercept(context, handlerReturning('ok')))

    expect(withTenantMock).toHaveBeenCalledTimes(1)
    expect(withTenantMock.mock.calls[0]?.[1]).toBe(TENANT_A)
  })

  it('attaches the transaction client to the request so @TenantTx() can find it', async () => {
    const { context, request } = contextFor({ tenantId: TENANT_A })
    const interceptor = interceptorWith(false)

    await firstValueFrom(interceptor.intercept(context, handlerReturning('ok')))

    expect(request.tenantTx).toEqual({ __tenantTx: true })
  })

  it('passes the handler result through unchanged', async () => {
    const { context } = contextFor({ tenantId: TENANT_A })
    const interceptor = interceptorWith(false)

    const result = await firstValueFrom(
      interceptor.intercept(context, handlerReturning({ id: 'stu-1' })),
    )

    expect(result).toEqual({ id: 'stu-1' })
  })

  it('propagates a handler error so the transaction can roll back', async () => {
    const { context } = contextFor({ tenantId: TENANT_A })
    const interceptor = interceptorWith(false)
    const boom = new Error('handler exploded')

    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => throwError(() => boom) })),
    ).rejects.toThrow('handler exploded')
  })

  describe('routes that must NOT open a tenant transaction', () => {
    it('skips @Public() routes — login and webhooks have no tenant yet', async () => {
      const { context } = contextFor({ tenantId: TENANT_A })
      const interceptor = interceptorWith(true)

      await firstValueFrom(interceptor.intercept(context, handlerReturning('ok')))

      expect(withTenantMock).not.toHaveBeenCalled()
    })

    it('skips when there is no authenticated user at all', async () => {
      const { context } = contextFor()
      const interceptor = interceptorWith(false)

      await firstValueFrom(interceptor.intercept(context, handlerReturning('ok')))

      expect(withTenantMock).not.toHaveBeenCalled()
    })

    it('skips when the user has no tenant selected yet (post-login, pre-tenant-choice)', async () => {
      const { context } = contextFor({ userId: 'u1', role: 'director' })
      const interceptor = interceptorWith(false)

      await firstValueFrom(interceptor.intercept(context, handlerReturning('ok')))

      expect(withTenantMock).not.toHaveBeenCalled()
    })
  })

  it('never mixes tenants across consecutive requests', async () => {
    const tenantB = '00000000-0000-4000-8000-00000000000b'
    const interceptor = interceptorWith(false)

    const first = contextFor({ tenantId: TENANT_A })
    await firstValueFrom(interceptor.intercept(first.context, handlerReturning('a')))
    const second = contextFor({ tenantId: tenantB })
    await firstValueFrom(interceptor.intercept(second.context, handlerReturning('b')))

    expect(withTenantMock.mock.calls.map((c) => c[1])).toEqual([TENANT_A, tenantB])
  })
})
