import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StudentService } from './student.service.js'
import { ConflictError, NotFoundError } from '@fineduc/domain'

describe('StudentService', () => {
  let service: StudentService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTx: any
  const tenantId = '11111111-1111-1111-1111-111111111111'

  beforeEach(() => {
    mockTx = {
      student: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      studentGuardian: {
        findMany: vi.fn(),
      },
      tenant: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ currency: 'XAF' }),
      },
    }
    service = new StudentService()
  })

  describe('create', () => {
    it('creates a student when matricule is unique in tenant', async () => {
      mockTx.student.findUnique.mockResolvedValue(null)
      mockTx.student.create.mockResolvedValue({
        id: '22222222-2222-2222-2222-222222222222',
        matricule: 'MAT-2026-001',
      })

      const res = await service.create(mockTx, tenantId, {
        matricule: 'MAT-2026-001',
        firstName: 'Amina',
        lastName: 'Diallo',
        sex: 'F',
      })

      expect(res.matricule).toBe('MAT-2026-001')
      expect(mockTx.student.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          matricule: 'MAT-2026-001',
          firstName: 'Amina',
          lastName: 'Diallo',
          sex: 'F',
          status: 'enrolled',
        }),
      })
    })

    it('throws ConflictError if matricule already exists in tenant', async () => {
      mockTx.student.findUnique.mockResolvedValue({
        id: 'existing-id',
        matricule: 'MAT-2026-001',
      })

      await expect(
        service.create(mockTx, tenantId, {
          matricule: 'MAT-2026-001',
          firstName: 'Amina',
          lastName: 'Diallo',
          sex: 'F',
        }),
      ).rejects.toThrow(ConflictError)
    })
  })

  describe('getDossier', () => {
    it('retrieves full student dossier and resolves same-guardian siblings', async () => {
      const studentId = '22222222-2222-2222-2222-222222222222'
      const siblingId = '33333333-3333-3333-3333-333333333333'
      const guardianId = '44444444-4444-4444-4444-444444444444'

      mockTx.student.findUnique.mockResolvedValue({
        id: studentId,
        tenantId,
        matricule: 'MAT-001',
        firstName: 'Amina',
        lastName: 'Diallo',
        sex: 'F',
        bornOn: new Date('2015-05-12'),
        photoUrl: null,
        status: 'enrolled',
        enrollments: [
          {
            id: 'enr-1',
            enrolledOn: new Date('2026-09-01'),
            classGroup: { name: '6ème A' },
            academicYear: { name: '2026/2027' },
            invoice: {
              netMinor: BigInt(250000),
              paidMinor: BigInt(100000),
              balanceMinor: BigInt(150000),
              instalments: [],
              ledgerEntries: [],
            },
          },
        ],
        studentGuardians: [
          {
            guardianId,
            relationship: 'Mère',
            isPrimary: true,
            paysFees: true,
            guardian: {
              id: guardianId,
              firstName: 'Fatou',
              lastName: 'Diallo',
              phoneE164: '+237670000001',
              preferredChannel: 'whatsapp',
              optOutAt: null,
              quarantinedAt: null,
            },
          },
        ],
      })

      mockTx.studentGuardian.findMany.mockResolvedValue([
        {
          studentId: siblingId,
          guardianId,
          student: {
            id: siblingId,
            matricule: 'MAT-002',
            firstName: 'Ibrahim',
            lastName: 'Diallo',
            enrollments: [{ classGroup: { name: 'CM2' } }],
          },
        },
      ])

      const dossier = await service.getDossier(mockTx, tenantId, studentId)

      expect(dossier.matricule).toBe('MAT-001')
      expect(dossier.className).toBe('6ème A')
      expect(dossier.guardians).toHaveLength(1)
      expect(dossier.guardians[0]?.firstName).toBe('Fatou')
      expect(dossier.siblings).toHaveLength(1)
      expect(dossier.siblings[0]?.firstName).toBe('Ibrahim')
      expect(dossier.siblings[0]?.className).toBe('CM2')
    })

    it('throws NotFoundError for missing student', async () => {
      mockTx.student.findUnique.mockResolvedValue(null)

      await expect(service.getDossier(mockTx, tenantId, 'missing-id')).rejects.toThrow(NotFoundError)
    })
  })
})
