import { describe, it, expect, vi } from 'vitest'
import { runSubscriptionExpiry, type SubscriptionExpiryDeps } from './subscription-expiry.js'

/**
 * The job body, tested without Redis or Postgres — the same lesson
 * `webhook-processor` paid for. A handler welded inside a `Worker` is
 * untested by construction.
 *
 * `withTenant` is stubbed to hand the callback a fake tx: what is under test
 * is the DECISION (which day warrants a notice, and whether a lapse is
 * recorded), not the RLS plumbing, which has its own tests.
 */
vi.mock('@fineduc/db', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withTenant: (prisma: any, _tenantId: string, fn: (tx: any) => unknown) => fn(prisma.__tx),
}))

const TENANT = '11111111-1111-1111-1111-111111111111'

interface Options {
  periodEnd: string
  status?: string
  priceMinor?: bigint
  plan?: string
  billingPeriod?: string
  timezone?: string
  subscription?: null
}

function deps(options: Options) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 })
  const tx = {
    tenant: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: TENANT,
        name: 'Collège Test',
        timezone: options.timezone ?? 'Africa/Douala',
      }),
    },
    subscription: {
      findUnique: vi.fn().mockResolvedValue(
        options.subscription === null
          ? null
          : {
              tenantId: TENANT,
              plan: options.plan ?? 'essentiel',
              billingPeriod: options.billingPeriod ?? 'monthly',
              priceMinor: options.priceMinor ?? 25_000n,
              currentPeriodEnd: new Date(`${options.periodEnd}T00:00:00Z`),
              status: options.status ?? 'active',
            },
      ),
      updateMany,
    },
  }
  const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d: { prisma: { __tx: tx } as any, logger, now: () => new Date('2026-09-23T08:00:00Z') } as SubscriptionExpiryDeps,
    tx,
    updateMany,
    logger,
  }
}

const job = { tenantId: TENANT, requestId: 'req-1' }

describe('warning a school its subscription is about to lapse', () => {
  it('warns seven days out', async () => {
    const { d } = deps({ periodEnd: '2026-09-30' })
    const result = await runSubscriptionExpiry(d, job)
    expect(result.notified).toBe(7)
    expect(result.expired).toBe(false)
  })

  it('warns three days out and one day out', async () => {
    for (const [end, expected] of [
      ['2026-09-26', 3],
      ['2026-09-24', 1],
    ] as const) {
      const { d } = deps({ periodEnd: end })
      expect((await runSubscriptionExpiry(d, job)).notified).toBe(expected)
    }
  })

  it('says nothing on a day that is not a warning day', async () => {
    // Otherwise a school is messaged every day for a week and stops reading.
    for (const end of ['2026-09-29', '2026-09-27', '2026-09-25', '2026-10-15']) {
      const { d } = deps({ periodEnd: end })
      expect((await runSubscriptionExpiry(d, job)).notified).toBeNull()
    }
  })

  it('carries the price the school has to pay, so the notice can name it', async () => {
    const { d } = deps({ periodEnd: '2026-09-30', priceMinor: 60_000n })
    expect((await runSubscriptionExpiry(d, job)).priceMinor).toBe(60_000n)
  })

  it('falls back to the published price when the row carries none', async () => {
    // A trial row written before the plan price was recorded would otherwise
    // tell a school its renewal costs nothing.
    const { d } = deps({ periodEnd: '2026-09-30', priceMinor: 0n, plan: 'croissance' })
    expect((await runSubscriptionExpiry(d, job)).priceMinor).toBe(60_000n)
  })
})

describe('once it has lapsed', () => {
  it('reports the expiry', async () => {
    const { d } = deps({ periodEnd: '2026-09-20' })
    const result = await runSubscriptionExpiry(d, job)
    expect(result.expired).toBe(true)
    expect(result.notified).toBe(0)
  })

  it('marks the subscription past_due', async () => {
    const { d, updateMany } = deps({ periodEnd: '2026-09-20' })
    await runSubscriptionExpiry(d, job)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'past_due' } }),
    )
  })

  it('only moves a subscription that is still trialing or active', async () => {
    // A stale job must not drag a school that renewed in the meantime back
    // to past_due, so the status is part of the WHERE, not just the read.
    const { d, updateMany } = deps({ periodEnd: '2026-09-20' })
    await runSubscriptionExpiry(d, job)
    expect(updateMany.mock.calls[0]![0].where.status).toEqual({ in: ['trialing', 'active'] })
  })

  it('does not write again for one already past_due', async () => {
    const { d, updateMany } = deps({ periodEnd: '2026-09-20', status: 'past_due' })
    const result = await runSubscriptionExpiry(d, job)
    expect(updateMany).not.toHaveBeenCalled()
    // Still reported, because the notice is how it learns to come back.
    expect(result.expired).toBe(true)
  })
})

describe('schools it leaves alone', () => {
  it('does not chase a cancelled school', async () => {
    const { d, updateMany } = deps({ periodEnd: '2026-09-20', status: 'cancelled' })
    const result = await runSubscriptionExpiry(d, job)
    expect(result.notified).toBeNull()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('warns rather than throwing when a tenant has no subscription row', async () => {
    // A half-provisioned tenant is for the integrity sweep to surface, not
    // for this job to retry three times over.
    const { d, logger } = deps({ periodEnd: '2026-09-30', subscription: null })
    const result = await runSubscriptionExpiry(d, job)
    expect(result.notified).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('the school calendar, not the server clock', () => {
  it('counts days in the tenant timezone', async () => {
    // 23:30 UTC is already the 24th in Douala (UTC+1), so a period ending on
    // the 30th is six days out there and seven in UTC. The school's day wins.
    const { d } = deps({ periodEnd: '2026-09-30', timezone: 'Africa/Douala' })
    const late = { ...d, now: () => new Date('2026-09-23T23:30:00Z') }
    expect((await runSubscriptionExpiry(late, job)).notified).toBeNull()

    const { d: d2 } = deps({ periodEnd: '2026-10-01', timezone: 'Africa/Douala' })
    const late2 = { ...d2, now: () => new Date('2026-09-23T23:30:00Z') }
    expect((await runSubscriptionExpiry(late2, job)).notified).toBe(7)
  })
})
