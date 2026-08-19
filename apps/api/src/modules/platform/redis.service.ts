import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { loadEnv } from '@fineduc/config'
import { Redis } from 'ioredis'

/**
 * Redis backs the job queue, rate limits, and idempotency keys
 * (ARCHITECTURE.md §2). Phase 1 only needs it alive for the readiness
 * check — BullMQ wiring lands with the worker in a later phase.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  readonly client: Redis

  constructor() {
    const env = loadEnv()
    this.client = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect()
    this.logger.log('Connected to Redis')
  }

  onModuleDestroy(): void {
    this.client.disconnect()
  }

  async ping(): Promise<void> {
    await this.client.ping()
  }
}
