import { Queue, Worker, type Job } from 'bullmq'
import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { PrismaClient } from '@fineduc/db'
import { consoleLogger, type Logger } from '@fineduc/services'
import { QUEUE_SPECS, queueOptions, type JobEnvelope } from '../queues/index.js'

/**
 * `daily-sweep` — the producer every recurring queue was missing.
 *
 * Until this existed, `subscription-expiry`, `reminder-scheduler` and
 * `message-sender` were consumers of queues nothing ever wrote to. The workers
 * booted, logged that they were listening, and sat idle forever: no school was
 * ever warned its subscription was lapsing, and no parent was ever reminded of
 * a fee. Nothing appeared broken, which is what made it survive so long.
 *
 * Recurring work is per-tenant, and a repeatable job carries one fixed
 * payload — so the schedule fans out here instead: one tick enumerates the
 * tenants and enqueues a job apiece.
 *
 * ## Cancelled tenants are skipped, past_due ones are not
 *
 * A school that cancelled has decided; chasing it is spam. A lapsed one is
 * exactly who the message is for.
 *
 * ## Safe to run twice
 *
 * Every job it enqueues is idempotent on its own terms — `subscription-expiry`
 * claims a unique `subscription_notice` row, and `message-sender` re-checks
 * every limit against live rows before sending. A duplicate tick therefore
 * costs a wasted pass, not a duplicate message. That matters because the
 * sweep is retried, and because a second worker instance would tick too.
 */

export interface DailySweepData {
  readonly requestId: string
}

export interface DailySweepDeps {
  readonly prisma: PrismaClient
  readonly logger: Logger
  /** The queues to fan out to, injected so a test can assert what was enqueued. */
  readonly queues: {
    readonly subscriptionExpiry: Pick<Queue, 'add'>
    readonly reminderScheduler?: Pick<Queue, 'add'>
    readonly messageSender?: Pick<Queue, 'add'>
  }
}

export interface DailySweepResult {
  readonly tenants: number
  readonly enqueued: number
}

export async function runDailySweep(
  deps: DailySweepDeps,
  data: DailySweepData,
): Promise<DailySweepResult> {
  /*
   * Read OUTSIDE a tenant context on purpose — this is the one query in the
   * system that is legitimately cross-tenant, because its whole job is to
   * find out which tenants exist. Everything it enqueues then runs inside
   * withTenant().
   */
  const tenants = await deps.prisma.tenant.findMany({
    where: { status: { in: ['trial', 'active', 'suspended'] } },
    select: { id: true },
  })

  let enqueued = 0

  for (const tenant of tenants) {
    const envelope: JobEnvelope = { tenantId: tenant.id, requestId: data.requestId }

    // Deterministic job ids: BullMQ drops a duplicate, so two ticks on the
    // same day cannot double-enqueue even before the jobs' own idempotency.
    const day = new Date().toISOString().slice(0, 10)

    try {
      await deps.queues.subscriptionExpiry.add('expiry', envelope, {
        jobId: `sub-expiry:${tenant.id}:${day}`,
      })
      enqueued += 1

      /*
       * Parent reminders are per-school opt-in: a school with no reminder
       * rules configured produces no messages, and `message-sender` re-checks
       * quiet hours, opt-out and credits against live rows regardless. So
       * enqueuing for every tenant is safe — the school's own configuration,
       * not this sweep, decides whether anything is sent.
       */
      if (deps.queues.reminderScheduler) {
        await deps.queues.reminderScheduler.add('schedule', envelope, {
          jobId: `reminder-schedule:${tenant.id}:${day}`,
        })
        enqueued += 1
      }
      if (deps.queues.messageSender) {
        await deps.queues.messageSender.add('send', envelope, {
          jobId: `message-send:${tenant.id}:${day}`,
        })
        enqueued += 1
      }
    } catch (error) {
      // One tenant failing to enqueue must not cost every later tenant its
      // sweep, so this is logged and the loop continues.
      deps.logger.error(`sweep: could not enqueue for tenant ${tenant.id}: ${String(error)}`)
    }
  }

  deps.logger.log(`daily sweep: ${tenants.length} tenant(s), ${enqueued} job(s) enqueued`)
  return { tenants: tenants.length, enqueued }
}

export function createDailySweepWorker(
  connection: Redis,
  deps: Omit<DailySweepDeps, 'logger'> & Partial<Pick<DailySweepDeps, 'logger'>>,
): Worker<DailySweepData> {
  const logger = deps.logger ?? consoleLogger('daily-sweep')
  return new Worker<DailySweepData>(
    'daily-sweep',
    async (job: Job<DailySweepData>) =>
      runDailySweep({ prisma: deps.prisma, logger, queues: deps.queues }, job.data),
    { ...queueOptions(connection), concurrency: QUEUE_SPECS['daily-sweep'].concurrency },
  )
}

/**
 * Install the repeating schedule.
 *
 * `upsertJobScheduler` is idempotent by key, so every boot re-asserts the same
 * schedule rather than stacking another one — which is what a plain repeatable
 * job would do, and would have the sweep running once per deploy per day.
 *
 * 06:00 UTC is 07:00 in Douala and Lagos, 06:00 in Dakar and Abidjan: inside
 * the working morning across the region Fineduc serves, and never the middle
 * of the night for anyone. A bursar reads a 07:00 message; a 02:00 one is
 * gone by the time they wake.
 */
export async function installDailySchedule(connection: Redis, logger: Logger): Promise<Queue> {
  const queue = new Queue('daily-sweep', queueOptions(connection))
  await queue.upsertJobScheduler(
    'daily-sweep',
    { pattern: '0 6 * * *', tz: 'UTC' },
    { name: 'sweep', data: { requestId: randomUUID() } },
  )
  logger.log('daily sweep scheduled for 06:00 UTC')
  return queue
}
