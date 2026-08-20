import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import {
  RecordCashPaymentSchema,
  OpenCashSessionInputSchema,
  CloseCashSessionInputSchema,
} from '@fineduc/contracts'
import type { TenantTransactionClient } from '@fineduc/db'
import { ConflictError } from '@fineduc/domain'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import { CashSessionService } from './cash-session.service.js'
import { CashPaymentService } from './cash-payment.service.js'

/**
 * The desk. Validate, delegate, map — no business logic here.
 *
 * Cashier and bursar can take money; only a director may open or close a
 * desk, because the close is the control that catches a leaking one and a
 * cashier signing off their own count defeats it.
 */
@Controller('cash-sessions')
export class CashController {
  constructor(
    private readonly sessions: CashSessionService,
    private readonly payments: CashPaymentService,
  ) {}

  /** POST /cash-sessions — open a desk with a counted float. */
  @Roles('director', 'bursar')
  @Post()
  async open(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = OpenCashSessionInputSchema.parse(body)
    return this.sessions.open(tx, user.tenantId, {
      cashDeskId: input.cashDeskId,
      openingFloatMinor: BigInt(input.openingFloat.amountMinor),
      cashierUserId: user.userId,
    })
  }

  /**
   * GET /cash-sessions/:id/expected — what the drawer should hold now.
   * Shown before the cashier commits to a count, so the close is not a guess.
   */
  @Roles('director', 'bursar', 'cashier')
  @SkipAudit()
  @Get(':id/expected')
  async expected(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
  ) {
    const { expectedMinor, currency } = await this.sessions.currentExpected(tx, user.tenantId, id)
    return { expected: { amountMinor: expectedMinor.toString(), currency } }
  }

  /** POST /cash-sessions/:id/close — the anti-leak control. */
  @Roles('director', 'bursar')
  @Post(':id/close')
  async close(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = CloseCashSessionInputSchema.parse(body)
    const result = await this.sessions.close(tx, user.tenantId, id, {
      declaredMinor: BigInt(input.declaredClose.amountMinor),
      varianceReason: input.varianceReason,
      closedByUserId: user.userId,
    })
    return {
      status: result.status,
      expected: { amountMinor: result.expectedMinor.toString(), currency: input.declaredClose.currency },
      variance: { amountMinor: result.varianceMinor.toString(), currency: input.declaredClose.currency },
    }
  }

  /**
   * POST /cash-sessions/payments — take cash at the desk.
   *
   * The session is resolved from the CALLER'S open session rather than
   * accepted in the body: a cashier must not be able to post money into
   * somebody else's drawer, which is the count somebody else has to sign.
   */
  @Roles('director', 'bursar', 'cashier')
  @Post('payments')
  async recordPayment(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = RecordCashPaymentSchema.parse(body)

    const session = await this.sessions.findOpenForUser(tx, user.tenantId, user.userId)
    if (!session) {
      throw new ConflictError(
        'NO_OPEN_CASH_SESSION',
        'You have no open cash session. Open the desk before taking a payment.',
      )
    }

    const result = await this.payments.record(tx, user.tenantId, {
      studentId: input.studentId,
      amountMinor: BigInt(input.amount.amountMinor),
      instalmentId: input.instalmentId,
      payerName: input.payerName,
      idempotencyKey: input.idempotencyKey,
      cashierUserId: user.userId,
      cashSessionId: session.id,
      now: new Date(),
    })

    return {
      paymentId: result.paymentId,
      receiptNumber: result.receiptNumber,
      allocated: { amountMinor: result.allocatedMinor.toString(), currency: input.amount.currency },
      unallocated: { amountMinor: result.unallocatedMinor.toString(), currency: input.amount.currency },
      invoiceBalance: { amountMinor: result.invoiceBalanceMinor.toString(), currency: input.amount.currency },
      replayed: result.replayed,
    }
  }
}
