/**
 * Row-Level Security tenant context. ARCHITECTURE.md §4 / AGENTS.md rule #4:
 * every tenant-scoped query runs inside a transaction that has issued
 *   SELECT set_config('app.tenant_id', $1, true)
 * — never `SET` (session-scoped; leaks across a pooled connection to the
 * next request), always `set_config(..., true)` (the third argument makes
 * it LOCAL, scoped to the current transaction only) issued from INSIDE a
 * transaction, before any other query runs.
 *
 * set_config is used instead of a raw `SET LOCAL app.tenant_id = '...'`
 * string because Postgres's SET command does not accept bind parameters —
 * set_config is a regular function call and IS parameterised by Prisma's
 * tagged-template $executeRaw, so a tenant id never touches string
 * interpolation. The UUID-shape check below is defence in depth, not the
 * primary safety mechanism.
 *
 * The RLS policies themselves (packages/db/prisma/migrations/*_row_level_
 * security_and_invariants/migration.sql) read this value back with
 * `NULLIF(current_setting('app.tenant_id', true), '')::uuid` and compare it
 * against each row's tenant_id — that comparison is the actual isolation
 * guarantee. This file only sets the value correctly; it enforces nothing
 * by itself.
 *
 * The NULLIF matters: verified against a live Postgres instance while
 * building this, `current_setting(x, true)` returns NULL only the FIRST
 * time a session ever touches a given custom GUC. On a pooled connection
 * that has previously run a `withTenant` transaction — i.e. almost every
 * connection, almost immediately — the value reverts to an EMPTY STRING
 * once that transaction commits, not to NULL. Casting '' straight to
 * ::uuid throws instead of failing closed, which is why the policies wrap
 * it in NULLIF(..., '').
 */
import type { Prisma, PrismaClient } from '@prisma/client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class InvalidTenantIdError extends Error {
  constructor(value: string) {
    super(`Invalid tenant id: "${value}" is not a UUID`)
    this.name = 'InvalidTenantIdError'
  }
}

export type TenantTransactionClient = Prisma.TransactionClient

/**
 * Run `fn` inside a transaction scoped to `tenantId`. Every read and write
 * `fn` performs is subject to that tenant's RLS policies. This is the ONLY
 * sanctioned way to touch a tenant-scoped table — a query issued outside a
 * `withTenant` transaction sees zero rows (the policies fail closed: no
 * `app.tenant_id` set means the comparison is NULL, which is not true) and
 * a write outside one is rejected by the `WITH CHECK` clause.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new InvalidTenantIdError(tenantId)
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx)
  })
}

/**
 * Explicit, grep-able escape hatch for the small set of platform tables
 * that carry NO RLS policy by design — `provider_event` and
 * `outbox_event` (see the comments on those models in schema.prisma).
 * Both are processed by trusted background workers before a tenant can be
 * attributed, or across every tenant at once. Nothing else should be
 * queried through this path; a tenant-scoped table queried here would
 * still be blocked by its policy (fail-closed), just without the clarity
 * of going through `withTenant`.
 */
export async function withPlatformAccess<T>(
  prisma: PrismaClient,
  fn: (tx: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => fn(tx))
}
