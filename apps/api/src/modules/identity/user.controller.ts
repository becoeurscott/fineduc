/**
 * User management endpoints. Director-only for most operations.
 */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import {
  InviteUserRequestSchema,
  ChangeRoleRequestSchema,
  ChangeStatusRequestSchema,
  CursorPaginationSchema,
} from '@fineduc/contracts'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import type { TenantTransactionClient } from '@fineduc/db'
import { UserService } from './user.service.js'

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * GET /users — list users (memberships) in this tenant.
   */
  @Roles('director')
  @SkipAudit()
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Query() query: unknown,
  ) {
    const { cursor, limit } = CursorPaginationSchema.parse(query)
    return this.userService.list(tx, user.tenantId, cursor, limit)
  }

  /**
   * POST /users — invite a user into this tenant.
   */
  @Roles('director')
  @Post()
  async invite(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = InviteUserRequestSchema.parse(body)
    return this.userService.invite(tx, user.tenantId, input)
  }

  /**
   * PATCH /users/:id/role — change a user's role.
   */
  @Roles('director')
  @Patch(':id/role')
  async changeRole(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') userId: string,
    @Body() body: unknown,
  ) {
    const input = ChangeRoleRequestSchema.parse(body)
    await this.userService.changeRole(tx, user.tenantId, userId, input.role)
    return { status: 'ok' }
  }

  /**
   * PATCH /users/:id/status — activate or suspend a user.
   */
  @Roles('director')
  @Patch(':id/status')
  async changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') userId: string,
    @Body() body: unknown,
  ) {
    const input = ChangeStatusRequestSchema.parse(body)
    await this.userService.changeStatus(tx, user.tenantId, userId, input.status)
    return { status: 'ok' }
  }
}
