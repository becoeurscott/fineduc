import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { createPrismaClient, resolveAppDatabaseUrl, type PrismaClient } from '@fineduc/db'
import { loadEnv } from '@fineduc/config'

/**
 * Connects as the least-privilege `fineduc_app` role, never the migrator/
 * owner role (ARCHITECTURE.md §4, §10) — every RLS-protected query the API
 * makes goes through this client, wrapped in `withTenant()`.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)
  readonly client: PrismaClient

  constructor() {
    const env = loadEnv()
    this.client = createPrismaClient({
      databaseUrl: resolveAppDatabaseUrl(env.DATABASE_URL, env.APP_DATABASE_URL),
    })
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect()
    this.logger.log('Connected to Postgres as fineduc_app')
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect()
  }

  /** Cheap liveness check — no tenant context needed for `SELECT 1`. */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`
  }
}
