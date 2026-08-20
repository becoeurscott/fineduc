import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { loadEnv } from '@fineduc/config'

/**
 * Enqueues `webhook-processor` jobs for `apps/worker` to run.
 *
 * The API owns none of the settlement work — it stores the event and hands
 * over. This is the only place the two processes meet, and it is deliberately
 * one-way: the API never waits for the result.
 *
 * The queue NAME and job id shape are duplicated from the worker rather than
 * imported, because `apps` may never import each other. That duplication is
 * two string literals and is covered by a test; importing across the app
 * boundary to save it would trade a lint rule for a build-order dependency
 * between two deployables.
 */
const QUEUE_NAME = 'webhook-processor'

export interface WebhookJobPayload {
  readonly tenantId: string
  readonly requestId: string
  readonly providerEventId: string
  readonly provider: string
}

@Injectable()
export class WebhookQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookQueueService.name)
  private readonly connection: Redis
  private readonly queue: Queue<WebhookJobPayload>

  constructor() {
    const env = loadEnv()
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
    this.queue = new Queue<WebhookJobPayload>(QUEUE_NAME, { connection: this.connection })
  }

  /**
   * `jobId` is derived from the stored event, so BullMQ collapses a repeat
   * enqueue into the job that already exists. Combined with the unique index
   * on `provider_event`, a redelivered webhook cannot reach the processor
   * twice — and even if it did, the processor's state machine would refuse
   * to settle it again.
   */
  async enqueue(payload: WebhookJobPayload): Promise<void> {
    try {
      await this.queue.add(QUEUE_NAME, payload, { jobId: `provider-event:${payload.providerEventId}` })
    } catch (error) {
      /*
       * Swallowed on purpose.
       *
       * The event is already stored and durable. If Redis is down, the right
       * answer is still to tell the aggregator 200 — otherwise it retries,
       * and every retry writes nothing new (the unique index holds) while
       * hammering an endpoint that cannot help it. The reconciler re-queries
       * non-final payments and will pick this up (ARCHITECTURE.md §8.6).
       */
      this.logger.error(
        `Could not enqueue webhook-processor for provider_event ${payload.providerEventId}: ${String(error)}. ` +
          'The event is stored; the reconciler will settle it.',
      )
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
    await this.connection.quit()
  }
}
