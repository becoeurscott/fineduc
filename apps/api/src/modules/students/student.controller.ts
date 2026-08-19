import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import {
  CreateStudentRequestSchema,
  UpdateStudentRequestSchema,
  CreateGuardianRequestSchema,
  UpdateGuardianRequestSchema,
  LinkGuardianRequestSchema,
  EnrollStudentRequestSchema,
  StudentQuerySchema,
  CursorPaginationSchema,
} from '@fineduc/contracts'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { TenantTx } from '../../common/decorators/tenant-tx.decorator.js'
import type { TenantTransactionClient } from '@fineduc/db'
import { StudentService } from './student.service.js'
import { GuardianService } from './guardian.service.js'
import { EnrollmentService } from './enrollment.service.js'

@Controller('students')
export class StudentController {
  constructor(
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
    private readonly enrollmentService: EnrollmentService,
  ) {}

  /**
   * GET /students — list students with query filters and pagination.
   */
  @Roles('director', 'bursar', 'secretary', 'cashier')
  @SkipAudit()
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Query() query: Record<string, unknown>,
  ) {
    const filters = StudentQuerySchema.parse(query)
    const pagination = CursorPaginationSchema.parse(query)
    return this.studentService.list(tx, user.tenantId, filters, pagination.cursor, pagination.limit)
  }

  /**
   * POST /students — register a new student.
   */
  @Roles('director', 'bursar', 'secretary')
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Body() body: unknown,
  ) {
    const input = CreateStudentRequestSchema.parse(body)
    return this.studentService.create(tx, user.tenantId, input)
  }

  /**
   * GET /students/:id — get complete student file ("dossier par élève").
   */
  @Roles('director', 'bursar', 'secretary', 'cashier')
  @SkipAudit()
  @Get(':id')
  async getDossier(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
  ) {
    return this.studentService.getDossier(tx, user.tenantId, id)
  }

  /**
   * PATCH /students/:id — update student biographical details.
   */
  @Roles('director', 'bursar', 'secretary')
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = UpdateStudentRequestSchema.parse(body)
    await this.studentService.update(tx, user.tenantId, id, input)
    return { status: 'ok' }
  }

  /**
   * POST /students/:id/guardians — add guardian and link to student.
   */
  @Roles('director', 'bursar', 'secretary')
  @Post(':id/guardians')
  async addGuardian(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') studentId: string,
    @Body() body: unknown,
  ) {
    const input = CreateGuardianRequestSchema.parse(body)
    return this.guardianService.addGuardian(tx, user.tenantId, studentId, input)
  }

  /**
   * POST /students/:id/guardians/link — link an existing guardian.
   */
  @Roles('director', 'bursar', 'secretary')
  @Post(':id/guardians/link')
  async linkGuardian(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') studentId: string,
    @Body() body: unknown,
  ) {
    const input = LinkGuardianRequestSchema.parse(body)
    return this.guardianService.linkExistingGuardian(tx, user.tenantId, studentId, input)
  }

  /**
   * PATCH /students/guardians/:guardianId — update guardian contact info.
   */
  @Roles('director', 'bursar', 'secretary')
  @Patch('guardians/:guardianId')
  async updateGuardian(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('guardianId') guardianId: string,
    @Body() body: unknown,
  ) {
    const input = UpdateGuardianRequestSchema.parse(body)
    await this.guardianService.updateGuardian(tx, user.tenantId, guardianId, input)
    return { status: 'ok' }
  }

  /**
   * POST /students/:id/enroll — enrol student in a class group for an academic year.
   */
  @Roles('director', 'bursar', 'secretary')
  @Post(':id/enroll')
  async enroll(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('id') studentId: string,
    @Body() body: unknown,
  ) {
    const input = EnrollStudentRequestSchema.parse({
      ...(typeof body === 'object' && body !== null ? body : {}),
      studentId,
    })
    return this.enrollmentService.enroll(tx, user.tenantId, input)
  }

  /**
   * POST /students/enrollments/:enrollmentId/withdraw — withdraw an enrolment.
   */
  @Roles('director', 'bursar', 'secretary')
  @Post('enrollments/:enrollmentId/withdraw')
  async withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('enrollmentId') enrollmentId: string,
    @Body('leftOn') leftOn?: string,
  ) {
    await this.enrollmentService.withdraw(tx, user.tenantId, enrollmentId, leftOn)
    return { status: 'ok' }
  }

  /**
   * POST /students/enrollments/:enrollmentId/transfer — transfer class group.
   */
  @Roles('director', 'bursar', 'secretary')
  @Post('enrollments/:enrollmentId/transfer')
  async transferClass(
    @CurrentUser() user: AuthenticatedUser,
    @TenantTx() tx: TenantTransactionClient,
    @Param('enrollmentId') enrollmentId: string,
    @Body('newClassGroupId') newClassGroupId: string,
  ) {
    await this.enrollmentService.transferClass(tx, user.tenantId, enrollmentId, newClassGroupId)
    return { status: 'ok' }
  }
}
