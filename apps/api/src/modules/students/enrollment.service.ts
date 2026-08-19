import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { ConflictError, NotFoundError, InvalidStateError } from '@fineduc/domain'
import type { EnrollStudentRequest } from '@fineduc/contracts'

@Injectable()
export class EnrollmentService {
  /**
   * Enrol a student into a class group for an academic year.
   * Ensures one enrolment per student per year (ARCHITECTURE.md §6 "People").
   */
  async enroll(
    tx: TenantTransactionClient,
    tenantId: string,
    input: EnrollStudentRequest,
  ): Promise<{ enrollmentId: string }> {
    const student = await tx.student.findUnique({ where: { id: input.studentId } })
    if (!student || student.tenantId !== tenantId) {
      throw new NotFoundError('student', input.studentId)
    }

    const academicYear = await tx.academicYear.findUnique({ where: { id: input.academicYearId } })
    if (!academicYear || academicYear.tenantId !== tenantId) {
      throw new NotFoundError('academic_year', input.academicYearId)
    }

    if (academicYear.status === 'closed') {
      throw new InvalidStateError('ACADEMIC_YEAR_CLOSED', 'Cannot enrol into a closed academic year')
    }

    const classGroup = await tx.classGroup.findUnique({ where: { id: input.classGroupId } })
    if (!classGroup || classGroup.tenantId !== tenantId) {
      throw new NotFoundError('class_group', input.classGroupId)
    }

    if (classGroup.academicYearId !== input.academicYearId) {
      throw new ConflictError(
        'CLASS_YEAR_MISMATCH',
        'Class group does not belong to the specified academic year',
      )
    }

    const feeSchedule = await tx.feeSchedule.findUnique({ where: { id: input.feeScheduleId } })
    if (!feeSchedule || feeSchedule.tenantId !== tenantId) {
      throw new NotFoundError('fee_schedule', input.feeScheduleId)
    }

    // Check if already enrolled in this academic year
    const existing = await tx.enrollment.findUnique({
      where: {
        studentId_academicYearId: {
          studentId: input.studentId,
          academicYearId: input.academicYearId,
        },
      },
    })

    if (existing) {
      throw new ConflictError(
        'ALREADY_ENROLLED',
        'Student is already enrolled in this academic year',
      )
    }

    const enrolledOn = input.enrolledOn ? new Date(input.enrolledOn) : new Date()
    const carriedForwardBalanceMinor = BigInt(input.carriedForwardBalanceMinor || '0')

    const enrollment = await tx.enrollment.create({
      data: {
        tenantId,
        studentId: input.studentId,
        classGroupId: input.classGroupId,
        academicYearId: input.academicYearId,
        feeScheduleId: input.feeScheduleId,
        enrolledOn,
        carriedForwardBalanceMinor,
        status: 'active',
      },
    })

    // Update student status to 'enrolled' if it wasn't
    if (student.status !== 'enrolled') {
      await tx.student.update({
        where: { id: student.id },
        data: { status: 'enrolled' },
      })
    }

    return { enrollmentId: enrollment.id }
  }

  /**
   * Withdraw an enrolment (e.g. student moves away).
   */
  async withdraw(
    tx: TenantTransactionClient,
    tenantId: string,
    enrollmentId: string,
    leftOn?: string,
  ): Promise<void> {
    const enrollment = await tx.enrollment.findUnique({ where: { id: enrollmentId } })
    if (!enrollment || enrollment.tenantId !== tenantId) {
      throw new NotFoundError('enrollment', enrollmentId)
    }

    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'withdrawn',
        leftOn: leftOn ? new Date(leftOn) : new Date(),
      },
    })

    // Check if student has other active enrolments
    const otherActive = await tx.enrollment.findFirst({
      where: {
        tenantId,
        studentId: enrollment.studentId,
        status: 'active',
        id: { not: enrollmentId },
      },
    })

    if (!otherActive) {
      await tx.student.update({
        where: { id: enrollment.studentId },
        data: { status: 'left' },
      })
    }
  }

  /**
   * Transfer student to another class within the same academic year.
   */
  async transferClass(
    tx: TenantTransactionClient,
    tenantId: string,
    enrollmentId: string,
    newClassGroupId: string,
  ): Promise<void> {
    const enrollment = await tx.enrollment.findUnique({ where: { id: enrollmentId } })
    if (!enrollment || enrollment.tenantId !== tenantId) {
      throw new NotFoundError('enrollment', enrollmentId)
    }

    const newClassGroup = await tx.classGroup.findUnique({ where: { id: newClassGroupId } })
    if (!newClassGroup || newClassGroup.tenantId !== tenantId) {
      throw new NotFoundError('class_group', newClassGroupId)
    }

    if (newClassGroup.academicYearId !== enrollment.academicYearId) {
      throw new ConflictError(
        'CLASS_YEAR_MISMATCH',
        'New class group does not belong to the same academic year',
      )
    }

    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: { classGroupId: newClassGroupId },
    })
  }
}
