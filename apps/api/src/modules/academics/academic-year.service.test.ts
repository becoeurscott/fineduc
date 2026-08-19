import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AcademicYearService } from './academic-year.service.js'
import { ConflictError, InvalidStateError, NotFoundError } from '@fineduc/domain'

describe('AcademicYearService', () => {
  let service: AcademicYearService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTx: any
  const tenantId = '11111111-1111-1111-1111-111111111111'

  beforeEach(() => {
    mockTx = {
      academicYear: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      term: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
    }
    service = new AcademicYearService()
  })

  describe('create', () => {
    it('creates an academic year in draft status', async () => {
      mockTx.academicYear.create.mockResolvedValue({
        id: '22222222-2222-2222-2222-222222222222',
        tenantId,
        name: '2026/2027',
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2027-06-30'),
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const res = await service.create(mockTx, tenantId, {
        name: '2026/2027',
        startsOn: '2026-09-01',
        endsOn: '2027-06-30',
      })

      expect(res.status).toBe('draft')
      expect(res.name).toBe('2026/2027')
      expect(mockTx.academicYear.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          name: '2026/2027',
          startsOn: new Date('2026-09-01'),
          endsOn: new Date('2027-06-30'),
          status: 'draft',
        },
      })
    })

    it('rejects invalid date ranges where endsOn <= startsOn', async () => {
      await expect(
        service.create(mockTx, tenantId, {
          name: 'Invalid Year',
          startsOn: '2027-06-30',
          endsOn: '2026-09-01',
        }),
      ).rejects.toThrow(ConflictError)
    })
  })

  describe('activate', () => {
    it('deactivates other active years and activates the target year', async () => {
      const yearId = '22222222-2222-2222-2222-222222222222'
      mockTx.academicYear.findUnique.mockResolvedValue({
        id: yearId,
        tenantId,
        name: '2026/2027',
        status: 'draft',
      })
      mockTx.academicYear.update.mockResolvedValue({
        id: yearId,
        tenantId,
        name: '2026/2027',
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2027-06-30'),
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const res = await service.activate(mockTx, tenantId, yearId)

      expect(res.status).toBe('active')
      expect(mockTx.academicYear.updateMany).toHaveBeenCalledWith({
        where: { tenantId, status: 'active', id: { not: yearId } },
        data: { status: 'closed' },
      })
    })

    it('throws InvalidStateError when trying to activate a closed year', async () => {
      const yearId = '22222222-2222-2222-2222-222222222222'
      mockTx.academicYear.findUnique.mockResolvedValue({
        id: yearId,
        tenantId,
        name: '2026/2027',
        status: 'closed',
      })

      await expect(service.activate(mockTx, tenantId, yearId)).rejects.toThrow(InvalidStateError)
    })

    it('throws NotFoundError for non-existent year', async () => {
      mockTx.academicYear.findUnique.mockResolvedValue(null)

      await expect(service.activate(mockTx, tenantId, 'missing-id')).rejects.toThrow(NotFoundError)
    })
  })
})
