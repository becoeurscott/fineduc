/**
 * RBAC authorization matrix (ARCHITECTURE.md §10, AGENTS.md).
 *
 * This is a security boundary, not a convenience: the dashboard hides
 * controls a role cannot use, but hiding a button is never the control —
 * this guard is. Every case below is a way somebody could reach an
 * endpoint they should not.
 *
 * The most important test in this file is the deny-by-default one: a new
 * endpoint that its author forgot to decorate must be CLOSED, not open.
 */
import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@nestjs/common'
import { RolesGuard } from './roles.js'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js'
import { ROLES_KEY } from '../decorators/roles.decorator.js'

type Metadata = { [IS_PUBLIC_KEY]?: boolean; [ROLES_KEY]?: string[] }

/**
 * A minimal ExecutionContext. Metadata is supplied separately via
 * `guardWith()`, which stubs the Reflector — this keeps the test about the
 * guard's decisions rather than about Nest's reflection plumbing.
 */
function contextFor(user?: { role?: string; tenantId?: string }): ExecutionContext {
  const request: Record<string, unknown> = user ? { user } : {}
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

function guardWith(metadata: Metadata): RolesGuard {
  const reflector = new Reflector()
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
    if (key === IS_PUBLIC_KEY) return metadata[IS_PUBLIC_KEY]
    if (key === ROLES_KEY) return metadata[ROLES_KEY]
    return undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
  return new RolesGuard(reflector)
}

const ALL_ROLES = ['director', 'bursar', 'cashier', 'secretary', 'auditor'] as const

describe('RolesGuard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('deny by default', () => {
    it('REJECTS an endpoint with no @Roles() and no @Public() — a forgotten decorator must fail closed', () => {
      const guard = guardWith({})
      expect(() => guard.canActivate(contextFor({ role: 'director' }))).toThrow(ForbiddenException)
    })

    it('rejects even a director when @Roles() is present but empty', () => {
      const guard = guardWith({ [ROLES_KEY]: [] })
      expect(() =>
        guard.canActivate(contextFor({ role: 'director' })),
      ).toThrow(ForbiddenException)
    })
  })

  describe('@Public()', () => {
    it('allows an unauthenticated request through', () => {
      const guard = guardWith({ [IS_PUBLIC_KEY]: true })
      expect(guard.canActivate(contextFor())).toBe(true)
    })

    it('wins over a @Roles() restriction on the same route', () => {
      const meta = { [IS_PUBLIC_KEY]: true, [ROLES_KEY]: ['director'] }
      const guard = guardWith(meta)
      expect(guard.canActivate(contextFor())).toBe(true)
    })
  })

  describe('authentication', () => {
    it('rejects when no user is attached, even if the role list would allow one', () => {
      const meta = { [ROLES_KEY]: ['director'] }
      const guard = guardWith(meta)
      expect(() => guard.canActivate(contextFor())).toThrow(/no authenticated user/i)
    })
  })

  describe('the authorization matrix', () => {
    // Each row: the roles an endpoint permits, and the role attempting it.
    const cases: { allowed: string[]; role: string; expected: boolean; why: string }[] = [
      { allowed: ['director'], role: 'director', expected: true, why: 'exact match' },
      { allowed: ['director'], role: 'bursar', expected: false, why: 'bursar cannot act as director' },
      { allowed: ['director', 'bursar'], role: 'bursar', expected: true, why: 'listed among several' },
      { allowed: ['director', 'bursar'], role: 'cashier', expected: false, why: 'cashier not listed' },
      { allowed: ['cashier'], role: 'director', expected: false, why: 'roles are NOT hierarchical — director is not a superset' },
      { allowed: ['bursar'], role: 'auditor', expected: false, why: 'auditor is read-only' },
      { allowed: ['auditor'], role: 'auditor', expected: true, why: 'auditor on a read endpoint' },
      { allowed: ['director'], role: 'secretary', expected: false, why: 'secretary cannot manage users' },
    ]

    it.each(cases)('$role on [$allowed] → $expected ($why)', ({ allowed, role, expected }) => {
      const meta = { [ROLES_KEY]: allowed }
      const guard = guardWith(meta)
      const act = () => guard.canActivate(contextFor({ role }))

      if (expected) {
        expect(act()).toBe(true)
      } else {
        expect(act).toThrow(ForbiddenException)
      }
    })

    it('admits exactly one role when an endpoint lists exactly one', () => {
      const meta = { [ROLES_KEY]: ['director'] }
      const guard = guardWith(meta)
      const admitted = ALL_ROLES.filter((role) => {
        try {
          return guard.canActivate(contextFor({ role }))
        } catch {
          return false
        }
      })
      expect(admitted).toEqual(['director'])
    })

    it('rejects an unknown role that is not in the 5-role model', () => {
      const meta = { [ROLES_KEY]: ['director'] }
      const guard = guardWith(meta)
      expect(() => guard.canActivate(contextFor({ role: 'superadmin' }))).toThrow(
        ForbiddenException,
      )
    })
  })
})
