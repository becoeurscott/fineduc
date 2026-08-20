import { Body, Controller, Param, Post, Put } from '@nestjs/common'
import {
  CreateFeeScheduleRequestSchema,
  ReplaceFeeItemsRequestSchema,
  SetInstalmentPlanRequestSchema,
  CalendarDateSchema,
} from '@fineduc/contracts'
import type { TenantTransactionClient } from '@fineduc/db'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import { FeeScheduleService } from './fee-schedule.service.js'

/**
 * Fee schedules. Thin by design — validate, delegate, map (AGENTS.md step 5).
 *
 * Director only. Setting what a school charges is not a day-to-day clerical
 * act: a bursar who can quietly raise tuition mid-year is a fraud path, and
 * publishing is irreversible.
 *
 * Money crosses the wire as an integer STRING of minor units and is
 * converted at the service boundary — never parsed into a JS number here.
 */
@Controller('fee-schedules')
export class FeeScheduleController {
  constructor(private readonly feeSchedules: FeeScheduleService) {}

  /** POST /fee-schedules — start a draft. */
  @Roles('director')
  @Post()
  async createDraft(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = CreateFeeScheduleRequestSchema.parse(body)
    return this.feeSchedules.createDraft(tx, user.tenantId, input)
  }

  /** PUT /fee-schedules/:id/items — replace the draft's items wholesale. */
  @Roles('director')
  @Put(':id/items')
  async replaceItems(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = ReplaceFeeItemsRequestSchema.parse(body)
    const { totalMinor } = await this.feeSchedules.replaceItems(tx, user.tenantId, id, input)
    return { totalMinor: totalMinor.toString() }
  }

  /** PUT /fee-schedules/:id/instalment-plan — set the échéancier. */
  @Roles('director')
  @Put(':id/instalment-plan')
  async setInstalmentPlan(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = SetInstalmentPlanRequestSchema.parse(body)
    return this.feeSchedules.setInstalmentPlan(tx, user.tenantId, id, input)
  }

  /** POST /fee-schedules/:id/publish — the one-way door. */
  @Roles('director')
  @Post(':id/publish')
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
  ) {
    const result = await this.feeSchedules.publish(tx, user.tenantId, id)
    return { id: result.id, version: result.version, totalMinor: result.totalMinor.toString() }
  }

  /** POST /fee-schedules/:id/versions — copy a published schedule into a new draft. */
  @Roles('director')
  @Post(':id/versions')
  async createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body('effectiveFrom') effectiveFrom: unknown,
  ) {
    const date = CalendarDateSchema.parse(effectiveFrom)
    return this.feeSchedules.createVersion(tx, user.tenantId, id, date)
  }
}
