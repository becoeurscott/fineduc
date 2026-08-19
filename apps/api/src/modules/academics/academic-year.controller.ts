import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import {
  CreateAcademicYearRequestSchema,
  UpdateAcademicYearRequestSchema,
  CreateTermRequestSchema,
} from '@fineduc/contracts'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import type { TenantTransactionClient } from '@fineduc/db'
import { AcademicYearService } from './academic-year.service.js'

@Controller('academic-years')
export class AcademicYearController {
  constructor(private readonly academicYearService: AcademicYearService) {}

  /**
   * GET /academic-years — list academic years for current tenant.
   */
  @Roles('director', 'bursar', 'secretary')
  @SkipAudit()
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
  ) {
    return this.academicYearService.list(tx, user.tenantId)
  }

  /**
   * POST /academic-years — create a new academic year in draft status.
   */
  @Roles('director')
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = CreateAcademicYearRequestSchema.parse(body)
    return this.academicYearService.create(tx, user.tenantId, input)
  }

  /**
   * GET /academic-years/:id — get an academic year by ID.
   */
  @Roles('director', 'bursar', 'secretary')
  @SkipAudit()
  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
  ) {
    return this.academicYearService.get(tx, user.tenantId, id)
  }

  /**
   * PATCH /academic-years/:id — update an academic year.
   */
  @Roles('director')
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = UpdateAcademicYearRequestSchema.parse(body)
    return this.academicYearService.update(tx, user.tenantId, id, input)
  }

  /**
   * POST /academic-years/:id/activate — activate this academic year.
   */
  @Roles('director')
  @Post(':id/activate')
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
  ) {
    return this.academicYearService.activate(tx, user.tenantId, id)
  }

  /**
   * POST /academic-years/:id/close — close this academic year.
   */
  @Roles('director')
  @Post(':id/close')
  async close(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
  ) {
    return this.academicYearService.close(tx, user.tenantId, id)
  }

  /**
   * GET /academic-years/:id/terms — list terms of an academic year.
   */
  @Roles('director', 'bursar', 'secretary')
  @SkipAudit()
  @Get(':id/terms')
  async listTerms(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
  ) {
    return this.academicYearService.listTerms(tx, user.tenantId, id)
  }

  /**
   * POST /academic-years/:id/terms — add a term to an academic year.
   */
  @Roles('director')
  @Post(':id/terms')
  async createTerm(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = CreateTermRequestSchema.parse(body)
    return this.academicYearService.createTerm(tx, user.tenantId, id, input)
  }
}
