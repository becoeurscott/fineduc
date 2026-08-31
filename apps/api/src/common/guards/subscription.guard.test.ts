import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { toTenantDate } from '@fineduc/domain'
import { SubscriptionGuard } from './subscription.guard.js'

/** The school's timezone throughout — Douala is UTC+1, so it crosses midnight first. */
const TZ = 'Africa/Douala'

/**
 * This guard decides whether a school can work today. Both directions are
 * expensive: blocking a school that has paid strands a bursar with parents at
 * the desk, and letting a lapsed one through is the product being given away.
 */

const TENANT = '11111111-1111-1111-1111-111111111111'

function ctx(over: { user?: unknown } = {}) {
  const request = { user: { tenantId: TENANT, role: 'director' }, ...over }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as never
}

/** Reflector stub: `flags` names which decorators are present. */
function reflector(flags: { isPublic?: boolean; allowsLapsed?: boolean } = {}) {
  return {
    getAllAndOverride: (key: string) =>
      key === 'isPublic' ? flags.isPublic : key === 'allowsLapsed' ? flags.allowsLapsed : undefined,
  } as never
}

/**
 * Stands in for withTenant(): the guard runs before the tenant-context
 * interceptor, so it opens its own transaction and we hand it the rows.
 */
function prisma(rows: { timezone?: string; periodEnd?: Date; status?: string } | null) {
  const tx = {
    // withTenant issues `set local app.tenant_id` on the transaction client
    // before running the callback, so the stub has to accept it.
    $executeRaw: vi.fn(async () => 0),
    $executeRawUnsafe: vi.fn(async () => 0),
    tenant: {
      findUnique: vi.fn(async () => (rows ? { timezone: rows.timezone ?? TZ } : null)),
    },
    subscription: {
      findUnique: vi.fn(async () =>
        rows?.periodEnd
          ? { currentPeriodEnd: rows.periodEnd, status: rows.status ?? 'active' }
          : null,
      ),
    },
  }
  return {
    client: {
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
  } as never
}

/**
 * A period end `days` from the SCHOOL's today, not the server's.
 *
 * Anchored with the same `toTenantDate` the guard uses. Counting from UTC
 * instead makes these tests fail for the hour either side of midnight, when
 * Douala (UTC+1) is already on tomorrow's date and UTC is not — which is
 * exactly the boundary the one-day grace is about.
 */
function daysFromNow(days: number): Date {
  const [year, month, day] = toTenantDate(new Date(), TZ).split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + days))
}

function guard(rows: Parameters<typeof prisma>[0], flags = {}) {
  return new SubscriptionGuard(reflector(flags), prisma(rows))
}

describe('SubscriptionGuard', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('lets a paying school work', () => {
    it('allows a subscription with days left', async () => {
      await expect(guard({ periodEnd: daysFromNow(10) }).canActivate(ctx())).resolves.toBe(true)
    })

    /**
     * The one-day grace. A school that paid through the 30th gets the 30th —
     * the domain's expiryNoticeFor(0) calls that expired, which is right for a
     * warning and wrong for a lock.
     */
    it('allows the school ON its final day, not just before it', async () => {
      await expect(guard({ periodEnd: daysFromNow(0) }).canActivate(ctx())).resolves.toBe(true)
    })

    it('allows a school still in its trial', async () => {
      await expect(
        guard({ periodEnd: daysFromNow(3), status: 'trialing' }).canActivate(ctx()),
      ).resolves.toBe(true)
    })
  })

  describe('blocks a school that has not paid', () => {
    it('blocks the day after the period ends, with 402 and a stable code', async () => {
      const promise = guard({ periodEnd: daysFromNow(-1) }).canActivate(ctx())
      await expect(promise).rejects.toThrow(HttpException)
      await promise.catch((error: HttpException) => {
        expect(error.getStatus()).toBe(402)
        expect((error.getResponse() as { code: string }).code).toBe('SUBSCRIPTION_LAPSED')
      })
    })

    it('blocks a cancelled subscription even while its period still runs', async () => {
      // Cancelling is a decision, not a deadline — it does not wait for the date.
      await expect(
        guard({ periodEnd: daysFromNow(20), status: 'cancelled' }).canActivate(ctx()),
      ).rejects.toThrow(HttpException)
    })

    /**
     * The status field is a background job's opinion; the date is the fact. If
     * the expiry worker is down, `status` never leaves `active` — and a guard
     * that trusted it would hand every school in the system free access, with
     * nothing visibly broken to say so.
     */
    it('blocks on the date even when the worker never marked it past_due', async () => {
      await expect(
        guard({ periodEnd: daysFromNow(-5), status: 'active' }).canActivate(ctx()),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('leaves the way back in open', () => {
    /**
     * Without this the renewal endpoint sits behind the lock that renewing
     * removes, and a lapsed school could never buy its way back in.
     */
    it('allows an @AllowsLapsed route for a school that has lapsed', async () => {
      await expect(
        guard({ periodEnd: daysFromNow(-30) }, { allowsLapsed: true }).canActivate(ctx()),
      ).resolves.toBe(true)
    })

    /**
     * @Public covers the webhooks. Blocking the Chariow callback would mean a
     * school pays, the settlement is refused, the period is never extended, and
     * it stays locked out having already been charged.
     */
    it('never touches a @Public route, so a renewal can still settle', async () => {
      await expect(
        guard({ periodEnd: daysFromNow(-30) }, { isPublic: true }).canActivate(ctx()),
      ).resolves.toBe(true)
    })
  })

  describe('fails open where the fault is ours', () => {
    it('allows a tenant with no subscription row rather than locking out a provisioning bug', async () => {
      await expect(guard(null).canActivate(ctx())).resolves.toBe(true)
    })

    it('defers to AuthGuard when there is no authenticated tenant', async () => {
      await expect(guard({ periodEnd: daysFromNow(-9) }).canActivate(ctx({ user: undefined }))).resolves.toBe(
        true,
      )
    })
  })

  describe('caching', () => {
    it('does not re-read the row for a school it just allowed', async () => {
      const p = prisma({ periodEnd: daysFromNow(10) })
      const g = new SubscriptionGuard(reflector(), p)
      await g.canActivate(ctx())
      await g.canActivate(ctx())
      expect((p as unknown as { client: { $transaction: { mock: { calls: unknown[] } } } }).client.$transaction.mock.calls).toHaveLength(1)
    })

    /**
     * Only the ALLOW is cached. A block must re-check every time, so a school
     * that renews is let back in on its next request rather than waiting a TTL.
     */
    it('re-reads on every request while a school is blocked', async () => {
      const p = prisma({ periodEnd: daysFromNow(-2) })
      const g = new SubscriptionGuard(reflector(), p)
      await g.canActivate(ctx()).catch(() => undefined)
      await g.canActivate(ctx()).catch(() => undefined)
      expect((p as unknown as { client: { $transaction: { mock: { calls: unknown[] } } } }).client.$transaction.mock.calls).toHaveLength(2)
    })
  })
})
