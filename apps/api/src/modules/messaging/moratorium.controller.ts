import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import {
  ApproveMoratoriumInputSchema,
  MoratoriumStatusSchema,
  RefuseMoratoriumInputSchema,
  StaffGrantMoratoriumInputSchema,
} from '@fineduc/contracts'
import type { TenantTransactionClient } from '@fineduc/db'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import { MoratoriumService } from './moratorium.service.js'

/**
 * Staff-facing moratoire endpoints (ARCHITECTURE.md §8.5b, §10).
 *
 * A secretary can SEE the queue and record one on behalf of a parent at the
 * counter, but cannot decide it — the same shape the capability matrix
 * already uses for reminders. Cancelling a delay the school already granted
 * is director-only: it takes something back from a family who has planned
 * around it.
 *
 * Nothing here is `@SkipAudit` except the list. Illegal transitions come out
 * of `moratoriumTransition` as a ConflictError → 409 problem+json.
 */
@Controller('moratoriums')
export class MoratoriumController {
  constructor(private readonly moratoriums: MoratoriumService) {}

  @Roles('director', 'bursar', 'secretary')
  @SkipAudit()
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Query('status') status?: string,
  ) {
    const parsed = status ? MoratoriumStatusSchema.parse(status) : undefined
    return this.moratoriums.list(tx, user.tenantId, { status: parsed })
  }

  @Roles('director', 'bursar')
  @Post(':id/approve')
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = ApproveMoratoriumInputSchema.parse(body)
    return this.moratoriums.approve(tx, user.tenantId, id, input, user.userId, new Date())
  }

  @Roles('director', 'bursar')
  @Post(':id/refuse')
  async refuse(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = RefuseMoratoriumInputSchema.parse(body)
    return this.moratoriums.decline(tx, user.tenantId, id, 'refuse', input.note, user.userId, new Date())
  }

  /** Director only: this takes back a delay a family is already relying on. */
  @Roles('director')
  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = RefuseMoratoriumInputSchema.parse(body)
    return this.moratoriums.decline(tx, user.tenantId, id, 'cancel', input.note, user.userId, new Date())
  }

  @Roles('director', 'bursar', 'secretary')
  @Post('/instalments/:instalmentId')
  async grantAtDesk(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('instalmentId') instalmentId: string,
    @Body() body: unknown,
  ) {
    const input = StaffGrantMoratoriumInputSchema.parse(body)
    return this.moratoriums.grantAtDesk(tx, user.tenantId, instalmentId, input, user.userId, new Date())
  }
}
