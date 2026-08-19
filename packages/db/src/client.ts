/**
 * Prisma client factory. Each app/worker process owns one instance — this
 * package hands out a factory, not a global singleton, so lifecycle
 * (connect/disconnect, test teardown) stays with the caller.
 */
import { PrismaClient } from '@prisma/client'

export interface CreatePrismaClientOptions {
  /** Overrides DATABASE_URL — mainly for tests pointed at a Testcontainers instance. */
  databaseUrl?: string
  /** Prisma query/error logging. Defaults to errors only. */
  log?: ('query' | 'info' | 'warn' | 'error')[]
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const { databaseUrl, log = ['error'] } = options
  return new PrismaClient({
    log,
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  })
}

export { PrismaClient } from '@prisma/client'
export type { Prisma } from '@prisma/client'
