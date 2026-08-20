import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EnrollmentService } from './enrollment.service.js'
import type { InvoicingService } from '../billing/invoicing.service.js'
import { ConflictError, InvalidStateError, NotFoundError } from '@fineduc/domain'

describe('EnrollmentService', () => {
  let service: EnrollmentService
  let invoicing: InvoicingService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTx: any
  const tenantId = '11111111-1111-1111-1111-111111111111'
  const studentId = '22222222-2222-2222-2222-222222222222'
  const academicYearId = '33333333-3333-3333-3333-333333333333'
  const classGroupId = '44444444-4444-4444-4444-444444444444'
  const feeScheduleId = '55555555-5555-5555-5555-555555555555'

  beforeEach(() => {
    mockTx = {
      student: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      academicYear: {
        findUnique: vi.fn(),
      },
      classGroup: {
        findUnique: vi.fn(),
      },
      feeSchedule: {
        findUnique: vi.fn(),
      },
      enrollment: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    }
    // Invoicing is a separate module's service; these tests cover enrolment
    // validation only, and pass no context, so it is never reached.
    invoicing = { raiseForEnrollment: vi.fn() } as unknown as InvoicingService
    service = new EnrollmentService(invoicing)
  })

  describe('enroll', () => {
    it('successfully enrols a student when all prerequisites are satisfied', async () => {
      mockTx.student.findUnique.mockResolvedValue({ id: studentId, tenantId, status: 'enrolled' })
      mockTx.academicYear.findUnique.mockResolvedValue({ id: academicYearId, tenantId, status: 'active' })
      mockTx.classGroup.findUnique.mockResolvedValue({ id: classGroupId, tenantId, academicYearId })
      mockTx.feeSchedule.findUnique.mockResolvedValue({ id: feeScheduleId, tenantId })
      mockTx.enrollment.findUnique.mockResolvedValue(null) // not already enrolled
      mockTx.enrollment.create.mockResolvedValue({ id: 'enr-123' })

      const res = await service.enroll(mockTx, tenantId, {
        studentId,
        academicYearId,
        classGroupId,
        feeScheduleId,
        enrolledOn: '2026-09-01',
      })

      expect(res.enrollmentId).toBe('enr-123')
      expect(mockTx.enrollment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          studentId,
          academicYearId,
          classGroupId,
          feeScheduleId,
          status: 'active',
        }),
      })
    })

    it('rejects enrolment if student is already enrolled in this academic year', async () => {
      mockTx.student.findUnique.mockResolvedValue({ id: studentId, tenantId, status: 'enrolled' })
      mockTx.academicYear.findUnique.mockResolvedValue({ id: academicYearId, tenantId, status: 'active' })
      mockTx.classGroup.findUnique.mockResolvedValue({ id: classGroupId, tenantId, academicYearId })
      mockTx.feeSchedule.findUnique.mockResolvedValue({ id: feeScheduleId, tenantId })
      mockTx.enrollment.findUnique.mockResolvedValue({ id: 'existing-enr' }) // already enrolled!

      await expect(
        service.enroll(mockTx, tenantId, {
          studentId,
          academicYearId,
          classGroupId,
          feeScheduleId,
        }),
      ).rejects.toThrow(ConflictError)
    })

    it('rejects enrolment into a closed academic year', async () => {
      mockTx.student.findUnique.mockResolvedValue({ id: studentId, tenantId, status: 'enrolled' })
      mockTx.academicYear.findUnique.mockResolvedValue({ id: academicYearId, tenantId, status: 'closed' })

      await expect(
        service.enroll(mockTx, tenantId, {
          studentId,
          academicYearId,
          classGroupId,
          feeScheduleId,
        }),
      ).rejects.toThrow(InvalidStateError)
    })

    it('rejects enrolment when class group does not belong to the academic year', async () => {
      mockTx.student.findUnique.mockResolvedValue({ id: studentId, tenantId, status: 'enrolled' })
      mockTx.academicYear.findUnique.mockResolvedValue({ id: academicYearId, tenantId, status: 'active' })
      mockTx.classGroup.findUnique.mockResolvedValue({
        id: classGroupId,
        tenantId,
        academicYearId: 'other-year-id',
      })

      await expect(
        service.enroll(mockTx, tenantId, {
          studentId,
          academicYearId,
          classGroupId,
          feeScheduleId,
        }),
      ).rejects.toThrow(ConflictError)
    })

    it('throws NotFoundError when student is missing', async () => {
      mockTx.student.findUnique.mockResolvedValue(null)

      await expect(
        service.enroll(mockTx, tenantId, {
          studentId: 'missing-student',
          academicYearId,
          classGroupId,
          feeScheduleId,
        }),
      ).rejects.toThrow(NotFoundError)
    })
  })
})
