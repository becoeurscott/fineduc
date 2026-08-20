import { Worker, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { createPrismaClient, resolveAppDatabaseUrl, withTenant, type PrismaClient } from '@fineduc/db'
import { loadEnv } from '@fineduc/config'
import {
  SettlementService,
  WebhookProcessorService,
  consoleLogger,
  decodePaymentReference,
  type Logger,
} from '@fineduc/services'
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

/**
 * NOTE: no `tenantId` on the envelope.
 *
 * At ingest the tenant is genuinely unknown — that is why `provider_event`
 * carries no RLS — so the API cannot put one here honestly. It is resolved
 * below, from the reference the aggregator echoed back.
 */
export interface WebhookJobData extends Omit<JobEnvelope, 'tenantId'> {
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

/** What the handler needs, minus anything about queues. */
export interface HandlerDeps {
  readonly prisma: PrismaClient
  readonly resolveProvider: (name: string) => PaymentProvider
  readonly processor: WebhookProcessorService
  readonly logger: Logger
  readonly now?: () => Date
}

export type HandlerResult =
  | { readonly result: 'missing' }
  | { readonly result: 'already_processed' }
  | Awaited<ReturnType<WebhookProcessorService['process']>>

/**
 * The job body, extracted from the BullMQ wrapper so it can be tested
 * without Redis.
 *
 * That extraction is not cosmetic. This handler once enqueued and passed an
 * empty tenant id straight into `withTenant`, which rejects a non-uuid — no
 * webhook could ever have settled. Every service it calls was well tested;
 * the WIRING was not, because it was welded to a queue.
 */
export async function processWebhookJob(deps: HandlerDeps, data: WebhookJobData): Promise<HandlerResult> {
  const { providerEventId, provider: providerName } = data
  const now = deps.now ?? (() => new Date())

  // `provider_event` carries no RLS by design — the tenant is unknown until
  // the payload is parsed — so it is read outside a tenant context and
  // everything after it inside one.
  const stored = await deps.prisma.providerEvent.findUnique({ where: { id: providerEventId } })
  if (!stored) {
    // Nothing to do and nothing to retry: the row is the source of truth and
    // it is gone.
    deps.logger.warn(`provider_event ${providerEventId} not found; dropping job`)
    return { result: 'missing' }
  }
  if (stored.processedAt) {
    // Already settled by an earlier delivery or an earlier attempt.
    return { result: 'already_processed' }
  }

  const provider = deps.resolveProvider(providerName)
  const event = provider.parseWebhook(stored.payload)

  // The tenant comes from OUR reference, echoed back by the aggregator.
  // Nothing else can supply it: `payment` is tenant-scoped, so looking it up
  // by provider_ref would already need the context we are trying to establish.
  const reference = decodePaymentReference(event.reference)
  if (!reference) {
    // Fails LOUDLY (ARCHITECTURE.md §11). A callback we cannot attribute is
    // either not ours or is a reference bug; settling it against a guessed
    // tenant would be far worse than a job in the dead letter queue with an
    // alert on it.
    throw new Error(
      `Cannot resolve a tenant for provider_event ${providerEventId}: reference "${event.reference ?? ''}" is not one of ours`,
    )
  }
  const { tenantId } = reference

  const outcome = await withTenant(deps.prisma, tenantId, (tx) =>
    deps.processor.process(tx, tenantId, event, { now: now() }),
  )

  // Marked only AFTER the settlement transaction commits. Marking first would
  // lose the event if settlement then failed — the job would retry, see
  // `processedAt`, and skip money that never moved.
  await deps.prisma.providerEvent.update({
    where: { id: providerEventId },
    data: { processedAt: now(), attempts: { increment: 1 } },
  })

  return outcome
}

export function createWebhookProcessor(deps: WebhookProcessorDeps): Worker<WebhookJobData> {
  const env = loadEnv()
  const prisma =
    deps.prisma ??
    createPrismaClient({ databaseUrl: resolveAppDatabaseUrl(env.DATABASE_URL, env.APP_DATABASE_URL) })

  const logger = consoleLogger('webhook-processor')
  const handlerDeps: HandlerDeps = {
    prisma,
    resolveProvider: deps.resolveProvider,
    processor: new WebhookProcessorService(new SettlementService(), logger),
    logger,
  }

  // The wrapper is deliberately this thin: everything worth testing lives in
  // processWebhookJob, which needs no Redis.
  return new Worker<WebhookJobData>('webhook-processor', (job: Job<WebhookJobData>) => processWebhookJob(handlerDeps, job.data), {
    ...queueOptions(deps.connection),
    concurrency: QUEUE_SPECS['webhook-processor'].concurrency,
  })
}

/** Re-exported so the API can build a job payload without importing bullmq. */
export function webhookJobId(providerEventId: string): string {
  // Deterministic: BullMQ de-duplicates on job id, so two enqueues of the
  // same stored event collapse into one before the processor is even reached.
  return `provider-event:${providerEventId}`
}
