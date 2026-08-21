import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { ConflictError, NotFoundError } from '@fineduc/domain'
import { CurrencyCodeSchema, moneyWire } from '@fineduc/contracts'
import type {
  CreateStudentRequest,
  CurrencyCode,
  UpdateStudentRequest,
  StudentListItem,
  StudentFile,
  StudentQuery,
} from '@fineduc/contracts'

@Injectable()
export class StudentService {
  /**
   * The tenant's own currency, never a hard-coded one.
   *
   * A tenant has exactly one currency, fixed at creation (ARCHITECTURE.md
   * §5) — but it is not always XAF: XOF, NGN and GHS schools are in scope,
   * and XAF/XOF are zero-decimal while NGN/GHS are not. Emitting "XAF" for
   * a Lagos school would mislabel every figure on the student file.
   *
   * Parsed through the contract schema so an unexpected value fails loudly
   * here rather than silently reaching a client as an unknown code.
   */
  private async tenantCurrency(
    tx: TenantTransactionClient,
    tenantId: string,
  ): Promise<CurrencyCode> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    })
    return CurrencyCodeSchema.parse(tenant.currency)
  }

  /**
   * Register a new student in this tenant with matricule uniqueness check.
   */
  async create(
    tx: TenantTransactionClient,
    tenantId: string,
    input: CreateStudentRequest,
  ): Promise<{ id: string; matricule: string }> {
    const existing = await tx.student.findUnique({
      where: { tenantId_matricule: { tenantId, matricule: input.matricule } },
    })

    if (existing) {
      throw new ConflictError(
        'MATRICULE_ALREADY_EXISTS',
        `Student with matricule "${input.matricule}" already exists in this school`,
      )
    }

    const student = await tx.student.create({
      data: {
        tenantId,
        matricule: input.matricule,
        firstName: input.firstName,
        lastName: input.lastName,
        sex: input.sex,
        bornOn: input.bornOn ? new Date(input.bornOn) : null,
        photoUrl: input.photoUrl ?? null,
        notes: input.notes ?? null,
        status: 'enrolled',
      },
    })

    return { id: student.id, matricule: student.matricule }
  }

  /**
   * Get lean student list with cursor pagination and search filter.
   */
  async list(
    tx: TenantTransactionClient,
    tenantId: string,
    query: StudentQuery,
    cursor?: string,
    limit = 25,
  ): Promise<{
    data: StudentListItem[]
    nextCursor: string | null
    hasMore: boolean
  }> {
    const students = await tx.student.findMany({
      where: {
        tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { matricule: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.classGroupId
          ? {
              enrollments: {
                some: {
                  classGroupId: query.classGroupId,
                  status: 'active',
                },
              },
            }
          : {}),
      },
      include: {
        enrollments: {
          where: { status: 'active' },
          include: {
            classGroup: { select: { name: true } },
            invoice: {
              select: {
                balanceMinor: true,
                instalments: {
                  where: { status: { in: ['pending', 'partial', 'overdue'] } },
                  orderBy: { dueOn: 'asc' },
                  take: 1,
                  select: { dueOn: true },
                },
              },
            },
          },
          take: 1,
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = students.length > limit
    const pageItems = students.slice(0, limit)
    const currency = await this.tenantCurrency(tx, tenantId)

    const data: StudentListItem[] = pageItems.map((s) => {
      const activeEnrollment = s.enrollments[0]
      const className = activeEnrollment?.classGroup.name ?? 'Non assigné'
      const invoice = activeEnrollment?.invoice
      const balanceMinor = invoice?.balanceMinor ? invoice.balanceMinor.toString() : '0'
      const nextInstalment = invoice?.instalments[0]
      const nextDueOn = nextInstalment?.dueOn
        ? (nextInstalment.dueOn.toISOString().split('T')[0] as string)
        : null

      return {
        id: s.id,
        matricule: s.matricule,
        firstName: s.firstName,
        lastName: s.lastName,
        className,
        status: s.status,
        balance: moneyWire(balanceMinor, currency),
        nextDueOn,
        daysOverdue: 0,
      }
    })

    return {
      data,
      nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
      hasMore,
    }
  }

  /**
   * Get complete student file ("un dossier par élève", PRD §2) including:
   * - Biographical details
   * - Active enrolment, class, academic year
   * - Financial summary (invoices, balance)
   * - Guardians & fee splits
   * - Siblings sharing any guardian
   */
  async getDossier(
    tx: TenantTransactionClient,
    tenantId: string,
    studentId: string,
  ): Promise<StudentFile> {
    const student = await tx.student.findUnique({
      where: { id: studentId },
      include: {
        enrollments: {
          where: { status: 'active' },
          include: {
            classGroup: { select: { name: true } },
            academicYear: { select: { name: true } },
            invoice: {
              include: {
                instalments: {
                  orderBy: { sequence: 'asc' },
                  // Only a GRANTED moratoire moves a date. A pending request
                  // has promised the family nothing yet, so the file must not
                  // show a delay nobody has approved.
                  include: { moratoriums: { where: { status: 'granted' }, take: 1 } },
                },
                ledgerEntries: { orderBy: { occurredOn: 'asc' } },
              },
            },
          },
          take: 1,
        },
        studentGuardians: {
          include: {
            guardian: true,
          },
        },
      },
    })

    if (!student || student.tenantId !== tenantId) {
      throw new NotFoundError('student', studentId)
    }

    const activeEnrollment = student.enrollments[0]
    const invoice = activeEnrollment?.invoice
    const currency = await this.tenantCurrency(tx, tenantId)

    // Find siblings who share any of this student's guardians
    const guardianIds = student.studentGuardians.map((sg) => sg.guardianId)
    const siblingLinks = await tx.studentGuardian.findMany({
      where: {
        tenantId,
        guardianId: { in: guardianIds },
        studentId: { not: studentId },
      },
      include: {
        student: {
          include: {
            enrollments: {
              where: { status: 'active' },
              include: { classGroup: { select: { name: true } } },
              take: 1,
            },
          },
        },
      },
    })

    // Deduplicate siblings by studentId
    const seenSiblingIds = new Set<string>()
    const siblings = []
    for (const link of siblingLinks) {
      if (!seenSiblingIds.has(link.studentId)) {
        seenSiblingIds.add(link.studentId)
        siblings.push({
          id: link.student.id,
          matricule: link.student.matricule,
          firstName: link.student.firstName,
          lastName: link.student.lastName,
          className: link.student.enrollments[0]?.classGroup.name ?? 'Non assigné',
        })
      }
    }

    const guardians = student.studentGuardians.map((sg) => ({
      id: sg.guardian.id,
      firstName: sg.guardian.firstName,
      lastName: sg.guardian.lastName,
      phoneE164: sg.guardian.phoneE164,
      relationship: sg.guardian.relationship,
      isPrimary: sg.isPrimary,
      paysFees: sg.paysFees,
      preferredChannel: sg.guardian.preferredChannel,
      optedOut: Boolean(sg.guardian.optOutAt),
      quarantined: Boolean(sg.guardian.quarantinedAt),
    }))

    const instalments =
      invoice?.instalments.map((inst) => {
        const remainingMinor = (inst.amountMinor - inst.allocatedMinor).toString()
        const dueOn = inst.dueOn.toISOString().split('T')[0] as string
        const moratorium = inst.moratoriums[0]
        const moratoriumUntil = moratorium
          ? (moratorium.deferredDueOn.toISOString().split('T')[0] as string)
          : null
        return {
          id: inst.id,
          sequence: inst.sequence,
          label: inst.label,
          dueOn,
          // Derived here, never in the browser: a client computing a deadline
          // would eventually show a family a different day from the one the
          // school recorded.
          effectiveDueOn: moratoriumUntil ?? dueOn,
          moratoriumUntil,
          amount: moneyWire(inst.amountMinor, currency),
          allocated: moneyWire(inst.allocatedMinor, currency),
          remaining: moneyWire(remainingMinor, currency),
          status: inst.status,
        }
      }) ?? []

    const ledger =
      invoice?.ledgerEntries.map((le) => ({
        id: le.id,
        occurredOn: le.occurredOn.toISOString().split('T')[0] as string,
        entryType: le.entryType,
        memo: le.memo,
        amount: moneyWire(le.amountMinor, currency),
        balanceAfter: moneyWire(le.balanceAfterMinor, currency),
      })) ?? []

    return {
      id: student.id,
      matricule: student.matricule,
      firstName: student.firstName,
      lastName: student.lastName,
      sex: student.sex as 'M' | 'F',
      bornOn: student.bornOn ? (student.bornOn.toISOString().split('T')[0] as string) : null,
      photoUrl: student.photoUrl,
      status: student.status,
      className: activeEnrollment?.classGroup.name ?? 'Non assigné',
      academicYearName: activeEnrollment?.academicYear.name ?? 'Non assigné',
      enrolledOn: activeEnrollment
        ? (activeEnrollment.enrolledOn.toISOString().split('T')[0] as string)
        : '1970-01-01',
      totalDue: moneyWire(invoice?.netMinor ?? 0n, currency),
      totalPaid: moneyWire(invoice?.paidMinor ?? 0n, currency),
      balance: moneyWire(invoice?.balanceMinor ?? 0n, currency),
      guardians,
      instalments,
      ledger,
      messages: [],
      siblings,
    }
  }

  /**
   * Update student details.
   */
  async update(
    tx: TenantTransactionClient,
    tenantId: string,
    studentId: string,
    input: UpdateStudentRequest,
  ): Promise<void> {
    const student = await tx.student.findUnique({ where: { id: studentId } })
    if (!student || student.tenantId !== tenantId) {
      throw new NotFoundError('student', studentId)
    }

    await tx.student.update({
      where: { id: studentId },
      data: {
        ...(input.firstName ? { firstName: input.firstName } : {}),
        ...(input.lastName ? { lastName: input.lastName } : {}),
        ...(input.sex ? { sex: input.sex } : {}),
        ...(input.bornOn !== undefined ? { bornOn: input.bornOn ? new Date(input.bornOn) : null } : {}),
        ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    })
  }
}
