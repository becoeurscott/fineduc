import { describe, it, expect, vi } from 'vitest'
import { runDailySweep, type DailySweepDeps } from './daily-sweep.js'

/**
 * The producer that was missing. Before it, every recurring queue had a worker
 * and no writer — the process booted, logged that it was listening, and no
 * school was ever warned nor any parent ever reminded. Nothing looked broken,
 * which is why it survived.
 */

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

function deps(tenants: Array<{ id: string }>, over: { failOn?: string } = {}) {
  const add = vi.fn(
    async (_name: string, data: { tenantId: string; requestId: string }, _opts?: { jobId?: string }) => {
      if (over.failOn && data.tenantId === over.failOn) throw new Error('redis down')
      return { id: 'job' }
    },
  )
  const reminderAdd = vi.fn().mockResolvedValue({ id: 'job' })
  const senderAdd = vi.fn().mockResolvedValue({ id: 'job' })
  const findMany = vi.fn().mockResolvedValue(tenants)
  const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() }

  return {
    d: {
      prisma: { tenant: { findMany } },
      logger,
      queues: {
        subscriptionExpiry: { add },
        reminderScheduler: { add: reminderAdd },
        messageSender: { add: senderAdd },
      },
    } as unknown as DailySweepDeps,
    add,
    reminderAdd,
    senderAdd,
    findMany,
    logger,
  }
}

const data = { requestId: 'req-1' }

describe('the daily sweep', () => {
  it('enqueues an expiry check for every tenant', async () => {
    const { d, add } = deps([{ id: A }, { id: B }])
    const result = await runDailySweep(d, data)

    expect(result.tenants).toBe(2)
    expect(add).toHaveBeenCalledTimes(2)
    expect(add.mock.calls[0]![1].tenantId).toBe(A)
    expect(add.mock.calls[1]![1].tenantId).toBe(B)
  })

  /**
   * A cancelled school has decided. Chasing it is spam — but a lapsed one is
   * exactly who the message is for, so past_due must stay in the sweep.
   */
  it('sweeps trial, active and suspended schools, never cancelled ones', async () => {
    const { d, findMany } = deps([{ id: A }])
    await runDailySweep(d, data)

    const where = findMany.mock.calls[0]![0].where
    expect(where.status.in).toEqual(expect.arrayContaining(['trial', 'active', 'suspended']))
    expect(where.status.in).not.toContain('cancelled')
  })

  /**
   * The sweep is retried, and a second worker instance would tick too. A
   * deterministic job id means BullMQ drops the duplicate before the job's own
   * idempotency is even consulted.
   */
  it('uses a per-tenant, per-day job id so a second tick cannot double-enqueue', async () => {
    const { d, add } = deps([{ id: A }])
    await runDailySweep(d, data)

    const jobId = add.mock.calls[0]![2]?.jobId ?? ''
    expect(jobId).toContain(A)
    expect(jobId).toMatch(/\d{4}-\d{2}-\d{2}$/)
  })

  /**
   * Parent reminders are per-school opt-in: a school with no rules configured
   * produces nothing, and message-sender re-checks quiet hours, opt-out and
   * credits against live rows. So enqueuing for everyone is safe — the
   * school's own configuration decides whether a family hears anything.
   */
  it('also drives the parent reminder queues', async () => {
    const { d, reminderAdd, senderAdd } = deps([{ id: A }, { id: B }])
    await runDailySweep(d, data)

    expect(reminderAdd).toHaveBeenCalledTimes(2)
    expect(senderAdd).toHaveBeenCalledTimes(2)
  })

  /**
   * One tenant's failure must not cost every later tenant its sweep — that
   * would make a transient Redis blip silently skip half the schools.
   */
  it('keeps going when one tenant cannot be enqueued', async () => {
    const { d, add, logger } = deps([{ id: A }, { id: B }], { failOn: A })
    const result = await runDailySweep(d, data)

    expect(add).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalled()
    // B still got its jobs even though A blew up.
    expect(result.tenants).toBe(2)
  })

  it('does nothing gracefully when there are no tenants', async () => {
    const { d, add } = deps([])
    const result = await runDailySweep(d, data)
    expect(result).toEqual({ tenants: 0, enqueued: 0 })
    expect(add).not.toHaveBeenCalled()
  })

  it('passes the request id through so a sweep can be traced end to end', async () => {
    const { d, add } = deps([{ id: A }])
    await runDailySweep(d, data)
    expect(add.mock.calls[0]![1].requestId).toBe('req-1')
  })
})
