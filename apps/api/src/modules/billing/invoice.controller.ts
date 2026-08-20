import { Controller, Get, Param } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import { InvoiceQueryService } from './invoice-query.service.js'

/**
 * Reading invoices and statements. Thin: validate, delegate, map.
 *
 * `@SkipAudit` throughout — the audit log records what CHANGED (rule #10),
 * and a row per screen a bursar opens would bury the writes that matter
 * under noise on the one table an auditor actually reads.
 *
 * Auditor is included in the roles: read-only by definition, and an auditor
 * who cannot open an invoice cannot audit anything. Cashier is included
 * because they have to see what a family owes to take a payment at the desk.
 */
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceQueryService) {}

  /** GET /invoices/:id */
  @Roles('director', 'bursar', 'cashier', 'secretary', 'auditor')
  @SkipAudit()
  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
  ) {
    return this.invoices.getInvoice(tx, user.tenantId, id)
  }

  /** GET /invoices/by-enrollment/:enrollmentId — how the student file reaches it. */
  @Roles('director', 'bursar', 'cashier', 'secretary', 'auditor')
  @SkipAudit()
  @Get('by-enrollment/:enrollmentId')
  async getForEnrollment(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.invoices.getInvoiceForEnrollment(tx, user.tenantId, enrollmentId)
  }
}

/**
 * The account statement lives under the student, because that is the thing
 * a bursar is looking at when they want it — not under an invoice, since a
 * statement spans every invoice the student has ever had.
 */
@Controller('students')
export class StatementController {
  constructor(private readonly invoices: InvoiceQueryService) {}

  /** GET /students/:studentId/statement */
  @Roles('director', 'bursar', 'cashier', 'secretary', 'auditor')
  @SkipAudit()
  @Get(':studentId/statement')
  async getStatement(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('studentId') studentId: string,
  ) {
    return this.invoices.getStatement(tx, user.tenantId, studentId)
  }
}
