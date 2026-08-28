import { Queue, type JobsOptions, type QueueOptions } from 'bullmq'
import { Redis } from 'ioredis'
import { loadEnv } from '@fineduc/config'

/**
 * Queue definitions (ARCHITECTURE.md §11).
 *
 * Concurrency, retries and backoff come from that table and are declared in
 * ONE place, because the values are load-bearing: `webhook-processor` retries
 * five times because an aggregator that gets a 500 will redeliver anyway, and
 * `outbox-publisher` retries forever because an unpublished outbox row is a
 * message a school is waiting for.
 */

export const QUEUE_NAMES = [
  'webhook-processor',
  'reminder-scheduler',
  'message-sender',
  'message-status',
  'reconciler',
  'integrity-sweep',
  'receipt-renderer',
  'exporter',
  'director-digest',
  'subscription-expiry',
  'outbox-publisher',
] as const

export type QueueName = (typeof QUEUE_NAMES)[number]

export interface QueueSpec {
  readonly concurrency: number
  readonly attempts: number
  readonly backoff?: JobsOptions['backoff']
}

const EXPONENTIAL: JobsOptions['backoff'] = { type: 'exponential', delay: 2_000 }

export const QUEUE_SPECS: Record<QueueName, QueueSpec> = {
  'webhook-processor': { concurrency: 10, attempts: 5, backoff: EXPONENTIAL },
  'reminder-scheduler': { concurrency: 1, attempts: 3, backoff: EXPONENTIAL },
  'message-sender': { concurrency: 5, attempts: 3, backoff: EXPONENTIAL },
  'message-status': { concurrency: 10, attempts: 3, backoff: EXPONENTIAL },
  'reconciler': { concurrency: 1, attempts: 3, backoff: EXPONENTIAL },
  // One attempt on purpose: the sweep is a CHECK. Retrying a failed
  // consistency check just delays the page that someone needs to see.
  'integrity-sweep': { concurrency: 1, attempts: 1 },
  'receipt-renderer': { concurrency: 5, attempts: 5, backoff: EXPONENTIAL },
  'exporter': { concurrency: 2, attempts: 2, backoff: EXPONENTIAL },
  'director-digest': { concurrency: 1, attempts: 2, backoff: EXPONENTIAL },
  // Retried, because a warning that never arrives is a school cut off with
  // no notice — but only three times: the next daily run warns anyway.
  'subscription-expiry': { concurrency: 1, attempts: 3, backoff: EXPONENTIAL },
  // Effectively forever: an unpublished outbox row is a message a school is
  // waiting for, and giving up on it loses work that was already committed.
  'outbox-publisher': { concurrency: 1, attempts: Number.MAX_SAFE_INTEGER },
}

/**
 * Every payload carries these (ARCHITECTURE.md §11). A job that cannot
 * resolve a tenant fails loudly rather than guessing — running a money job
 * against the wrong tenant is worse than not running it.
 */
export interface JobEnvelope {
  readonly tenantId: string
  readonly requestId: string
}

export function createRedis(): Redis {
  const env = loadEnv()
  return new Redis(env.REDIS_URL, {
    // BullMQ requires this; without it a blocking command can be retried
    // against a reconnected socket and the job is silently lost.
    maxRetriesPerRequest: null,
  })
}

export function queueOptions(connection: Redis): QueueOptions {
  return {
    connection,
    defaultJobOptions: {
      // Keep the recent history for debugging without letting Redis grow
      // without bound; a failed money job is worth keeping far longer than a
      // successful one.
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 10_000 },
    },
  }
}

export function createQueue(name: QueueName, connection: Redis): Queue {
  const spec = QUEUE_SPECS[name]
  const options = queueOptions(connection)
  return new Queue(name, {
    ...options,
    defaultJobOptions: {
      ...options.defaultJobOptions,
      attempts: spec.attempts,
      ...(spec.backoff ? { backoff: spec.backoff } : {}),
    },
  })
}
