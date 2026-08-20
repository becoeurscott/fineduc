import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { createPrismaClient, resolveAppDatabaseUrl, withTenant, type PrismaClient } from '@fineduc/db'
import { loadEnv } from '@fineduc/config'
import { SettlementService, WebhookProcessorService, consoleLogger } from '@fineduc/services'
import type { PaymentProvider } from '@fineduc/providers'
import { QUEUE_SPECS, queueOptions, type JobEnvelope } from '../queues/index.js'

/**
 * `webhook-processor` (ARCHITECTURE.md §11).
 *
 * The API endpoint stores the raw event and returns 200 immediately; this is
 * where the money actually moves. Splitting it that way is deliberate — an
 * aggregator that does not get a fast 200 retries, and a slow settlement
 * inside the request turns one payment into a retry storm.
 *
 * **Idempotent by `provider_event.event_id`.** BullMQ retries, aggregators
 * redeliver, and both land here; the processor's state machine refuses to
 * settle a payment twice, so a retry is safe by construction rather than by
 * the job runner being careful.
 */

export interface WebhookJobData extends JobEnvelope {
  /** The stored `provider_event.id` — the payload is read from the row, not the job. */
  readonly providerEventId: string
  readonly provider: string
}

export interface WebhookProcessorDeps {
  readonly connection: Redis
  /** Resolves an adapter by name. Injected so tests can pass a fake. */
  readonly resolveProvider: (name: string) => PaymentProvider
  readonly prisma?: PrismaClient
}

export function createWebhookProcessor(deps: WebhookProcessorDeps): Worker<WebhookJobData> {
  const env = loadEnv()
  const prisma =
    deps.prisma ??
    createPrismaClient({ databaseUrl: resolveAppDatabaseUrl(env.DATABASE_URL, env.APP_DATABASE_URL) })

  const logger = consoleLogger('webhook-processor')
  const processor = new WebhookProcessorService(new SettlementService(), logger)

  return new Worker<WebhookJobData>(
    'webhook-processor',
    async (job: Job<WebhookJobData>) => {
      const { providerEventId, provider: providerName, tenantId } = job.data

      // `provider_event` carries no RLS by design — the tenant is unknown
      // until the payload is parsed — so it is read outside a tenant context
      // and everything after it inside one.
      const stored = await prisma.providerEvent.findUnique({ where: { id: providerEventId } })
      if (!stored) {
        // Nothing to do and nothing to retry: the row is the source of truth
        // and it is gone.
        logger.warn(`provider_event ${providerEventId} not found; dropping job`)
        return { result: 'missing' as const }
      }
      if (stored.processedAt) {
        // Already settled by an earlier delivery or an earlier attempt.
        return { result: 'already_processed' as const }
      }

      const provider = deps.resolveProvider(providerName)
      const event = provider.parseWebhook(stored.payload)

      const outcome = await withTenant(prisma, tenantId, (tx) =>
        processor.process(tx, tenantId, event, { now: new Date() }),
      )

      // Marked only AFTER the settlement transaction commits. Marking first
      // would lose the event if settlement then failed — the job would retry,
      // see `processedAt`, and skip money that never moved.
      await prisma.providerEvent.update({
        where: { id: providerEventId },
        data: { processedAt: new Date(), attempts: { increment: 1 } },
      })

      return outcome
    },
    {
      ...queueOptions(deps.connection),
      concurrency: QUEUE_SPECS['webhook-processor'].concurrency,
    },
  )
}

/** Re-exported so the API can build a job payload without importing bullmq. */
export function webhookJobId(providerEventId: string): string {
  // Deterministic: BullMQ de-duplicates on job id, so two enqueues of the
  // same stored event collapse into one before the processor is even reached.
  return `provider-event:${providerEventId}`
}
