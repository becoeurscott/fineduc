/**
 * Tenant endpoints — current tenant CRUD and settings.
 */
import { Body, Controller, Get, Patch } from '@nestjs/common'
import { UpdateTenantRequestSchema } from '@fineduc/contracts'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import type { TenantTransactionClient } from '@fineduc/db'
import { TenantService } from './tenant.service.js'

@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  /**
   * GET /tenant — current tenant details.
   */
  @Roles('director', 'bursar')
  @SkipAudit()
  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
  ) {
    return this.tenantService.get(tx, user.tenantId)
  }

  /**
   * PATCH /tenant — update tenant (name, locale, logo, settings).
   */
  @Roles('director')
  @Patch()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = UpdateTenantRequestSchema.parse(body)
    await this.tenantService.update(tx, user.tenantId, input)
    return { status: 'ok' }
  }

  /**
   * GET /settings — tenant settings JSON.
   */
  @Roles('director', 'bursar')
  @SkipAudit()
  @Get('/settings')
  async getSettings(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
  ) {
    return this.tenantService.getSettings(tx, user.tenantId)
  }
}
