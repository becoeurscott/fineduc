import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TenantTransactionClient } from '@fineduc/db'
import { FeeScheduleService } from './fee-schedule.service.js'

/**
 * The draft → published lifecycle.
 *
 * The behaviour worth pinning here is the one-way door: every write must
 * refuse a schedule that is no longer a draft, and publishing must refuse a
 * schedule that would look usable but cannot actually be invoiced.
 */

const tenantId = 't-1'
const scheduleId = 'fs-1'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

const ITEMS = [
  { code: 'tuition', label: 'Scolarité', category: 'tuition' as const, amountMinor: '200000', sequence: 1 },
  { code: 'registration', label: 'Inscription', category: 'registration' as const, amountMinor: '50000', sequence: 2 },
]

const TEMPLATES = [
  { sequence: 1, label: 'T1', percentBp: 3334, dueOffsetDays: 0 },
  { sequence: 2, label: 'T2', percentBp: 3333, dueOffsetDays: 90 },
  { sequence: 3, label: 'T3', percentBp: 3333, dueOffsetDays: 180 },
]

function makeTx(over: Record<string, unknown> = {}) {
  const created: Record<string, Any[]> = { feeItem: [], instalmentTemplate: [], instalmentPlan: [], feeSchedule: [] }
  const collect = (key: string) => ({
    create: vi.fn(async ({ data }: Any) => {
      created[key]?.push(data)
      return { id: `${key}-${created[key]?.length}`, ...data }
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  })

  return {
    created,
    tx: {
      tenant: { findUnique: vi.fn(async () => ({ id: tenantId, currency: 'XAF', timezone: 'Africa/Douala' })) },
      academicYear: { findUnique: vi.fn(async () => ({ id: 'ay-1', tenantId })) },
      gradeLevel: { findUnique: vi.fn(async () => ({ id: 'gl-1', tenantId })) },
      feeSchedule: {
        findUnique: vi.fn(async () => ({
          id: scheduleId,
          tenantId,
          status: 'draft',
          version: 1,
          totalMinor: 250_000n,
          academicYearId: 'ay-1',
          gradeLevelId: 'gl-1',
        })),
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: Any) => ({ id: 'fs-new', ...data })),
        update: vi.fn(async ({ data }: Any) => ({
          id: scheduleId,
          version: 1,
          totalMinor: 250_000n,
          ...data,
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      feeItem: { ...collect('feeItem'), findMany: vi.fn(async () => ITEMS.map((i, n) => ({ id: `fi-${n}`, ...i, amountMinor: BigInt(i.amountMinor), isMandatory: true, isRecurring: true }))) },
      instalmentPlan: { ...collect('instalmentPlan'), findFirst: vi.fn(async () => ({ id: 'plan-1' })) },
      instalmentTemplate: collect('instalmentTemplate'),
      ...over,
    } as unknown as TenantTransactionClient,
  }
}

describe('FeeScheduleService', () => {
  let service: FeeScheduleService

  beforeEach(() => {
    service = new FeeScheduleService()
  })

  describe('createDraft', () => {
    it('creates version 1 when nothing exists yet', async () => {
      const { tx } = makeTx()
      const out = await service.createDraft(tx, tenantId, {
        academicYearId: 'ay-1',
        gradeLevelId: 'gl-1',
        name: 'Grille 6e',
        effectiveFrom: '2026-09-01',
      })
      expect(out.version).toBe(1)
    })

    it('increments the version past the newest existing one', async () => {
      const { tx } = makeTx()
      ;(tx as Any).feeSchedule.findFirst = vi
        .fn()
        .mockResolvedValueOnce(null) // no existing draft
        .mockResolvedValueOnce({ version: 3 }) // latest published
      const out = await service.createDraft(tx, tenantId, {
        academicYearId: 'ay-1',
        gradeLevelId: 'gl-1',
        name: 'Grille 6e',
        effectiveFrom: '2026-09-01',
      })
      expect(out.version).toBe(4)
    })

    it('refuses a second draft for the same grade and year', async () => {
      const { tx } = makeTx()
      ;(tx as Any).feeSchedule.findFirst = vi.fn(async () => ({ id: 'fs-existing', status: 'draft' }))
      await expect(
        service.createDraft(tx, tenantId, {
          academicYearId: 'ay-1',
          gradeLevelId: 'gl-1',
          name: 'Grille 6e',
          effectiveFrom: '2026-09-01',
        }),
      ).rejects.toThrow(/draft fee schedule already exists/)
    })

    it('refuses an academic year from another tenant', async () => {
      const { tx } = makeTx()
      ;(tx as Any).academicYear.findUnique = vi.fn(async () => ({ id: 'ay-1', tenantId: 'other' }))
      await expect(
        service.createDraft(tx, tenantId, {
          academicYearId: 'ay-1',
          gradeLevelId: 'gl-1',
          name: 'x',
          effectiveFrom: '2026-09-01',
        }),
      ).rejects.toThrow(/academic_year/)
    })
  })

  describe('replaceItems', () => {
    it('writes the items and recomputes the total', async () => {
      const { tx, created } = makeTx()
      const out = await service.replaceItems(tx, tenantId, scheduleId, { items: ITEMS })
      expect(created['feeItem']).toHaveLength(2)
      expect(out.totalMinor).toBe(250_000n)
    })

    it('clears the previous items rather than merging them', async () => {
      const { tx } = makeTx()
      await service.replaceItems(tx, tenantId, scheduleId, { items: ITEMS })
      expect((tx as Any).feeItem.deleteMany).toHaveBeenCalled()
    })

    it('refuses once the schedule is published', async () => {
      const { tx } = makeTx()
      ;(tx as Any).feeSchedule.findUnique = vi.fn(async () => ({ id: scheduleId, tenantId, status: 'published' }))
      await expect(service.replaceItems(tx, tenantId, scheduleId, { items: ITEMS })).rejects.toThrow(
        /only a draft can be edited/,
      )
    })

    it('rejects a duplicate sequence', async () => {
      const { tx } = makeTx()
      await expect(
        service.replaceItems(tx, tenantId, scheduleId, {
          items: [ITEMS[0] as Any, { ...(ITEMS[1] as Any), sequence: 1 }],
        }),
      ).rejects.toThrow(/Duplicate fee item sequence/)
    })

    it('rejects a duplicate code', async () => {
      const { tx } = makeTx()
      await expect(
        service.replaceItems(tx, tenantId, scheduleId, {
          items: [ITEMS[0] as Any, { ...(ITEMS[0] as Any), sequence: 2 }],
        }),
      ).rejects.toThrow(/Duplicate fee item code/)
    })
  })

  describe('setInstalmentPlan', () => {
    it('stores the templates', async () => {
      const { tx, created } = makeTx()
      const out = await service.setInstalmentPlan(tx, tenantId, scheduleId, { name: '3 tranches', templates: TEMPLATES })
      expect(out.instalmentCount).toBe(3)
      expect(created['instalmentTemplate']).toHaveLength(3)
    })

    /**
     * The point of validating by expansion: catch it while the director is
     * still on the form, not at the first enrolment with a parent waiting.
     */
    it('rejects a plan whose percentages do not reach 100%', async () => {
      const { tx } = makeTx()
      await expect(
        service.setInstalmentPlan(tx, tenantId, scheduleId, {
          name: 'bad',
          templates: [
            { sequence: 1, label: 'T1', percentBp: 5000, dueOffsetDays: 0 },
            { sequence: 2, label: 'T2', percentBp: 4000, dueOffsetDays: 90 },
          ],
        }),
      ).rejects.toThrow(/must total exactly/)
    })

    it('refuses before any items exist, since there is nothing to validate against', async () => {
      const { tx } = makeTx()
      ;(tx as Any).feeSchedule.findUnique = vi.fn(async () => ({
        id: scheduleId,
        tenantId,
        status: 'draft',
        totalMinor: 0n,
      }))
      await expect(
        service.setInstalmentPlan(tx, tenantId, scheduleId, { name: 'x', templates: TEMPLATES }),
      ).rejects.toThrow(/Add fee items before/)
    })

    it('refuses once published', async () => {
      const { tx } = makeTx()
      ;(tx as Any).feeSchedule.findUnique = vi.fn(async () => ({ id: scheduleId, tenantId, status: 'published' }))
      await expect(
        service.setInstalmentPlan(tx, tenantId, scheduleId, { name: 'x', templates: TEMPLATES }),
      ).rejects.toThrow(/only a draft can be edited/)
    })
  })

  describe('publish', () => {
    it('flips the schedule to published', async () => {
      const { tx } = makeTx()
      const out = await service.publish(tx, tenantId, scheduleId)
      expect(out.id).toBe(scheduleId)
      expect((tx as Any).feeSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'published' } }),
      )
    })

    it('archives the version it supersedes, so only one is invoiceable', async () => {
      const { tx } = makeTx()
      await service.publish(tx, tenantId, scheduleId)
      expect((tx as Any).feeSchedule.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'archived' } }),
      )
    })

    it('refuses without an instalment plan — enrolment could not invoice it', async () => {
      const { tx } = makeTx()
      ;(tx as Any).instalmentPlan.findFirst = vi.fn(async () => null)
      await expect(service.publish(tx, tenantId, scheduleId)).rejects.toThrow(/Set an instalment plan before publishing/)
    })

    it('refuses with no mandatory items', async () => {
      const { tx } = makeTx()
      ;(tx as Any).feeItem.findMany = vi.fn(async () => [])
      await expect(service.publish(tx, tenantId, scheduleId)).rejects.toThrow(/at least one mandatory fee item/)
    })

    it('refuses to publish twice', async () => {
      const { tx } = makeTx()
      ;(tx as Any).feeSchedule.findUnique = vi.fn(async () => ({ id: scheduleId, tenantId, status: 'published' }))
      await expect(service.publish(tx, tenantId, scheduleId)).rejects.toThrow(/only a draft can be edited/)
    })
  })

  describe('createVersion', () => {
    const publishedSource = {
      id: scheduleId,
      tenantId,
      status: 'published',
      version: 2,
      name: 'Grille 6e',
      academicYearId: 'ay-1',
      gradeLevelId: 'gl-1',
      totalMinor: 250_000n,
      feeItems: ITEMS.map((i, n) => ({
        id: `fi-${n}`,
        ...i,
        amountMinor: BigInt(i.amountMinor),
        isMandatory: true,
        isRecurring: true,
      })),
      instalmentPlans: [
        {
          id: 'plan-1',
          name: '3 tranches',
          instalmentCount: 3,
          templates: TEMPLATES.map((t) => ({ ...t, dueOn: null, amountMinor: null })),
        },
      ],
    }

    it('copies items and templates into a fresh draft', async () => {
      const { tx, created } = makeTx()
      ;(tx as Any).feeSchedule.findUnique = vi.fn(async () => publishedSource)
      ;(tx as Any).feeSchedule.findFirst = vi.fn(async () => ({ version: 2 }))

      const out = await service.createVersion(tx, tenantId, scheduleId, '2027-09-01')
      expect(out.version).toBe(3)
      expect(created['feeItem']).toHaveLength(2)
      expect(created['instalmentTemplate']).toHaveLength(3)
    })

    it('leaves the published source untouched — old invoices still point at it', async () => {
      const { tx } = makeTx()
      ;(tx as Any).feeSchedule.findUnique = vi.fn(async () => publishedSource)
      ;(tx as Any).feeSchedule.findFirst = vi.fn(async () => ({ version: 2 }))

      await service.createVersion(tx, tenantId, scheduleId, '2027-09-01')
      expect((tx as Any).feeSchedule.update).not.toHaveBeenCalled()
    })

    it('refuses to version something that is still a draft', async () => {
      const { tx } = makeTx()
      ;(tx as Any).feeSchedule.findUnique = vi.fn(async () => ({ ...publishedSource, status: 'draft' }))
      await expect(service.createVersion(tx, tenantId, scheduleId, '2027-09-01')).rejects.toThrow(
        /still a draft/,
      )
    })
  })
})
