import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { createPrismaClient, resolveAppDatabaseUrl, withTenant, type PrismaClient } from '@fineduc/db'
import { loadEnv } from '@fineduc/config'
import { readMessagingSettings } from '@fineduc/contracts'
import { MAX_MORATORIUM_DAYS, toTenantDate } from '@fineduc/domain'
import { ReminderSchedulingService, consoleLogger, type Logger } from '@fineduc/services'
import { QUEUE_SPECS, queueOptions, type JobEnvelope } from '../queues/index.js'

/**
 * `reminder-scheduler` — 02:00 in the tenant's timezone (ARCHITECTURE.md §11).
 *
 * Materialises INTENT and nothing more. Every limit — paid, opted out,
 * quarantined, quiet hours, frequency caps, credits — is evaluated by the
 * SENDER against the live row (AGENTS.md rule #7). This job deliberately
 * knows about none of them, so a bug here cannot bypass one.
 *
 * Re-runnable by construction: `materialiseFor` reconciles rather than
 * inserts, and `reminder_schedule` is unique on
 * (instalment, rule, guardian).
 */

export type ReminderSchedulerData = JobEnvelope

export interface SchedulerHandlerDeps {
  readonly prisma: PrismaClient
  readonly scheduling: ReminderSchedulingService
  readonly logger: Logger
  readonly now: () => Date
  /** How far ahead to materialise. */
  readonly horizonDays?: number
  /** How far back to keep chasing an overdue tranche. */
  readonly lookbackDays?: number
}

export interface SchedulerResult {
  readonly instalments: number
  readonly created: number
  readonly updated: number
  readonly revived: number
  readonly suppressed: number
}

const DEFAULT_HORIZON_DAYS = 90
const DEFAULT_LOOKBACK_DAYS = 60

/**
 * The job body, extracted from the BullMQ wrapper so it can be tested without
 * Redis — the lesson `webhook-processor` paid for. A handler welded inside a
 * `Worker` is untested by construction.
 */
export async function runReminderScheduler(
  deps: SchedulerHandlerDeps,
  data: ReminderSchedulerData,
): Promise<SchedulerResult> {
  const horizon = deps.horizonDays ?? DEFAULT_HORIZON_DAYS
  const lookback = deps.lookbackDays ?? DEFAULT_LOOKBACK_DAYS

  return withTenant(deps.prisma, data.tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: data.tenantId } })
    const settings = readMessagingSettings(tenant.settings)
    const today = toTenantDate(deps.now(), tenant.timezone)

    /*
     * The scan. Two things make it worth raw SQL.
     *
     * The horizon is applied TWICE, and that is not redundancy. `COALESCE`
     * is not sargable, so filtering on the effective date alone would give
     * up the `instalment (tenant_id, due_on, status)` index and sequential-
     * scan the table. Instead the index-driven predicate runs on `i.due_on`
     * WIDENED by the maximum moratoire, then the effective date trims what
     * that over-reads. A deferral is at most MAX_MORATORIUM_DAYS, so the
     * widened window provably cannot miss a row, and it over-reads at most
     * three weeks of instalments.
     *
     * DO NOT "simplify" this into a single COALESCE predicate. It will look
     * tidier and it will sequential-scan every instalment the school has.
     *
     * `amount_minor > allocated_minor` keeps a full-scholarship zero tranche
     * out entirely: there is nothing to chase and nothing to defer.
     */
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT i.id
      FROM instalment i
      JOIN invoice inv ON inv.id = i.invoice_id
      JOIN enrollment e ON e.id = inv.enrollment_id
      LEFT JOIN moratorium m
        ON m.tenant_id = i.tenant_id
       AND m.instalment_id = i.id
       AND m.status IN ('pending', 'granted')
      WHERE i.tenant_id = ${data.tenantId}::uuid
        AND i.status NOT IN ('paid', 'waived', 'cancelled')
        AND i.amount_minor > i.allocated_minor
        AND i.due_on BETWEEN (${today}::date - ${lookback}::int)
                         AND (${today}::date + ${horizon + MAX_MORATORIUM_DAYS}::int)
        AND COALESCE(m.deferred_due_on, i.due_on) BETWEEN (${today}::date - ${lookback}::int)
                                                      AND (${today}::date + ${horizon}::int)
      ORDER BY i.due_on
    `

    let created = 0
    let updated = 0
    let revived = 0
    let suppressed = 0

    for (const candidate of candidates) {
      const result = await deps.scheduling.materialiseFor(tx, data.tenantId, {
        instalmentId: candidate.id,
        today,
        timezone: tenant.timezone,
        sendHour: settings.sendHour,
      })
      created += result.created
      updated += result.updated
      revived += result.revived
      suppressed += result.suppressed
    }

    deps.logger.log(
      `reminder-scheduler: ${candidates.length} instalment(s), +${created} scheduled, ` +
        `${updated} moved, ${revived} restored, ${suppressed} suppressed`,
    )

    return { instalments: candidates.length, created, updated, revived, suppressed }
  })
}

export interface ReminderSchedulerDeps {
  readonly connection: Redis
  readonly prisma?: PrismaClient
}

export function createReminderScheduler(deps: ReminderSchedulerDeps): Worker<ReminderSchedulerData> {
  const env = loadEnv()
  const prisma =
    deps.prisma ??
    createPrismaClient({ databaseUrl: resolveAppDatabaseUrl(env.DATABASE_URL, env.APP_DATABASE_URL) })

  const handlerDeps: SchedulerHandlerDeps = {
    prisma,
    scheduling: new ReminderSchedulingService(),
    logger: consoleLogger('reminder-scheduler'),
    now: () => new Date(),
  }

  return new Worker<ReminderSchedulerData>(
    'reminder-scheduler',
    (job: Job<ReminderSchedulerData>) => runReminderScheduler(handlerDeps, job.data),
    { ...queueOptions(deps.connection), concurrency: QUEUE_SPECS['reminder-scheduler'].concurrency },
  )
}
