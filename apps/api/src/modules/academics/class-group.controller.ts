import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import {
  CreateGradeLevelRequestSchema,
  UpdateGradeLevelRequestSchema,
  CreateClassGroupRequestSchema,
  UpdateClassGroupRequestSchema,
} from '@fineduc/contracts'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import type { TenantTransactionClient } from '@fineduc/db'
import { ClassGroupService } from './class-group.service.js'

@Controller()
export class ClassGroupController {
  constructor(private readonly classGroupService: ClassGroupService) {}

  /**
   * GET /grade-levels — list grade levels.
   */
  @Roles('director', 'bursar', 'secretary')
  @SkipAudit()
  @Get('grade-levels')
  async listGradeLevels(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
  ) {
    return this.classGroupService.listGradeLevels(tx, user.tenantId)
  }

  /**
   * POST /grade-levels — create a new grade level.
   */
  @Roles('director')
  @Post('grade-levels')
  async createGradeLevel(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = CreateGradeLevelRequestSchema.parse(body)
    return this.classGroupService.createGradeLevel(tx, user.tenantId, input)
  }

  /**
   * PATCH /grade-levels/:id — update a grade level.
   */
  @Roles('director')
  @Patch('grade-levels/:id')
  async updateGradeLevel(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = UpdateGradeLevelRequestSchema.parse(body)
    return this.classGroupService.updateGradeLevel(tx, user.tenantId, id, input)
  }

  /**
   * GET /class-groups — list concrete class groups.
   */
  @Roles('director', 'bursar', 'secretary')
  @SkipAudit()
  @Get('class-groups')
  async listClassGroups(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Query('academicYearId') academicYearId?: string,
    @Query('siteId') siteId?: string,
  ) {
    return this.classGroupService.listClassGroups(tx, user.tenantId, academicYearId, siteId)
  }

  /**
   * POST /class-groups — create a concrete class group.
   */
  @Roles('director')
  @Post('class-groups')
  async createClassGroup(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = CreateClassGroupRequestSchema.parse(body)
    return this.classGroupService.createClassGroup(tx, user.tenantId, input)
  }

  /**
   * PATCH /class-groups/:id — update a class group.
   */
  @Roles('director')
  @Patch('class-groups/:id')
  async updateClassGroup(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = UpdateClassGroupRequestSchema.parse(body)
    return this.classGroupService.updateClassGroup(tx, user.tenantId, id, input)
  }
}
