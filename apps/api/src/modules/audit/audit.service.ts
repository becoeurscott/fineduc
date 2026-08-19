/**
 * Audit log query service. The write path is handled by the AuditInterceptor;
 * this service provides the read path for directors/bursars/auditors.
 */
import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'

export interface AuditLogFilters {
  entityType?: string
  entityId?: string
  action?: string
  actorUserId?: string
  cursor?: string
  limit?: number
}

@Injectable()
export class AuditService {
  /**
   * Query audit log entries with filters and cursor pagination.
   */
  async query(
    tx: TenantTransactionClient,
    tenantId: string,
    filters: AuditLogFilters,
  ): Promise<{
    data: Array<{
      id: string; action: string; entityType: string; entityId: string
      actorUserId: string | null; actorRole: string | null
      ip: string | null; occurredAt: string
    }>
    nextCursor: string | null
    hasMore: boolean
  }> {
    const limit = Math.min(filters.limit ?? 20, 100)

    const entries = await tx.auditLog.findMany({
      where: {
        tenantId,
        ...(filters.entityType ? { entityType: filters.entityType } : {}),
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
        ...(filters.action ? { action: { contains: filters.action } } : {}),
        ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    })

    const hasMore = entries.length > limit
    const data = entries.slice(0, limit).map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      actorUserId: e.actorUserId,
      actorRole: e.actorRole,
      ip: e.ip,
      occurredAt: e.occurredAt.toISOString(),
    }))

    return {
      data,
      nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
      hasMore,
    }
  }
}
