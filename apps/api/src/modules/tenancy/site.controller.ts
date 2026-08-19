/**
 * Site (campus) endpoints.
 */
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { CreateSiteRequestSchema, UpdateSiteRequestSchema } from '@fineduc/contracts'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import type { TenantTransactionClient } from '@fineduc/db'
import { SiteService } from './site.service.js'

@Controller('sites')
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  /**
   * GET /sites — list all sites for this tenant.
   */
  @Roles('director', 'bursar')
  @SkipAudit()
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
  ) {
    return this.siteService.list(tx, user.tenantId)
  }

  /**
   * POST /sites — create a new site.
   */
  @Roles('director')
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = CreateSiteRequestSchema.parse(body)
    return this.siteService.create(tx, user.tenantId, input)
  }

  /**
   * PATCH /sites/:id — update a site.
   */
  @Roles('director')
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') siteId: string,
    @Body() body: unknown,
  ) {
    const input = UpdateSiteRequestSchema.parse(body)
    await this.siteService.update(tx, user.tenantId, siteId, input)
    return { status: 'ok' }
  }
}
