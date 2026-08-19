/**
 * Audit log query endpoint. Read-only, available to director/bursar/auditor.
 */
import { Controller, Get, Query } from '@nestjs/common'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import type { TenantTransactionClient } from '@fineduc/db'
import { AuditService, type AuditLogFilters } from './audit.service.js'

@Controller('audit-log')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /audit-log — query audit log entries.
   */
  @Roles('director', 'bursar', 'auditor')
  @SkipAudit()
  @Get()
  async query(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Query() query: Record<string, string>,
  ) {
    const filters: AuditLogFilters = {
      entityType: query.entityType,
      entityId: query.entityId,
      action: query.action,
      actorUserId: query.actorUserId,
      cursor: query.cursor,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    }
    return this.auditService.query(tx, user.tenantId, filters)
  }
}
