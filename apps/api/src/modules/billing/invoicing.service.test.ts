import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TenantTransactionClient } from '@fineduc/db'
import { InvoicingService } from './invoicing.service.js'

/**
 * The enrolment money path (ARCHITECTURE.md §8.1) against a mocked client.
 *
 * The arithmetic itself is proven exhaustively in `@fineduc/domain`; what
 * these cover is the part only the service can get wrong — that the rows it
 * writes agree with each other, that the invariant is enforced against what
 * is actually persisted, and that nothing is written when a guard trips.
 */

const tenantId = 't-1'
const enrollmentId = 'e1e2e3e4-aaaa-bbbb-cccc-000000000001'
const studentId = 's-1'
const feeScheduleId = 'fs-1'
const userId = 'u-1'
const now = new Date('2026-09-15T08:00:00Z')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mock = any

function makeTx(over: Record<string, unknown> = {}): { tx: Mock; created: Record<string, Mock[]> } {
  const created: Record<string, Mock[]> = {
    invoiceLine: [],
    discount: [],
    instalment: [],
    studentLedgerEntry: [],
    outboxEvent: [],
  }
  const record = (key: string) => ({
    create: vi.fn(async ({ data }: Mock) => {
      created[key]?.push(data)
      return { id: `${key}-${created[key]?.length}`, ...data }
    }),
  })

  const tx = {
    tenant: { findUnique: vi.fn(async () => ({ id: tenantId, currency: 'XAF', timezone: 'Africa/Douala' })) },
    enrollment: {
      findUnique: vi.fn(async () => ({
        id: enrollmentId,
        tenantId,
        studentId,
        feeScheduleId,
        enrolledOn: new Date('2026-09-01T00:00:00Z'),
        carriedForwardBalanceMinor: 0n,
        invoice: null,
      })),
    },
    feeSchedule: {
      findUnique: vi.fn(async () => ({
        id: feeScheduleId,
        tenantId,
        status: 'published',
        version: 1,
        feeItems: [
          {
            id: 'fi-1',
            code: 'tuition',
            label: 'Scolarité',
            category: 'tuition',
            amountMinor: 200_000n,
            isMandatory: true,
            isRecurring: true,
            sequence: 1,
          },
          {
            id: 'fi-2',
            code: 'registration',
            label: 'Inscription',
            category: 'registration',
            amountMinor: 50_000n,
            isMandatory: true,
            isRecurring: false,
            sequence: 2,
          },
        ],
      })),
    },
    instalmentPlan: {
      findFirst: vi.fn(async () => ({
        id: 'plan-1',
        templates: [
          { sequence: 1, label: 'Tranche 1', dueOffsetDays: 0, dueOn: null, percentBp: 3334, amountMinor: null },
          { sequence: 2, label: 'Tranche 2', dueOffsetDays: 90, dueOn: null, percentBp: 3333, amountMinor: null },
          { sequence: 3, label: 'Tranche 3', dueOffsetDays: 180, dueOn: null, percentBp: 3333, amountMinor: null },
        ],
      })),
    },
    invoice: {
      create: vi.fn(async ({ data }: Mock) => {
        created['invoice'] = [data]
        return { id: 'inv-1', ...data }
      }),
    },
    studentLedgerEntry: { ...record('studentLedgerEntry'), findFirst: vi.fn(async () => null) },
    invoiceLine: record('invoiceLine'),
    discount: record('discount'),
    instalment: record('instalment'),
    outboxEvent: record('outboxEvent'),
    ...over,
  }
  return { tx, created }
}

function run(service: InvoicingService, tx: Mock, over: Record<string, unknown> = {}) {
  return service.raiseForEnrollment(tx as unknown as TenantTransactionClient, tenantId, {
    enrollmentId,
    grantedByUserId: userId,
    now,
    ...over,
  })
}

describe('InvoicingService.raiseForEnrollment', () => {
  let service: InvoicingService

  beforeEach(() => {
    service = new InvoicingService()
  })

  it('raises an invoice for the mandatory fee items', async () => {
    const { tx, created } = makeTx()
    const result = await run(service, tx)

    expect(result.totalMinor).toBe(250_000n)
    expect(result.discountMinor).toBe(0n)
    expect(result.netMinor).toBe(250_000n)
    expect(created['invoiceLine']).toHaveLength(2)
  })

  it('writes instalments that sum EXACTLY to the net', async () => {
    const { tx, created } = makeTx()
    const result = await run(service, tx)

    const total = (created['instalment'] ?? []).reduce((sum: bigint, i: Mock) => sum + i.amountMinor, 0n)
    expect(total).toBe(result.netMinor)
    expect(created['instalment']).toHaveLength(3)
  })

  it('dates instalments from the enrolment date in the tenant timezone', async () => {
    const { tx, created } = makeTx()
    await run(service, tx)

    const dates = (created['instalment'] ?? []).map((i: Mock) => i.dueOn.toISOString().slice(0, 10))
    expect(dates).toEqual(['2026-09-01', '2026-11-30', '2027-02-28'])
  })

  it('opens the invoice with balance equal to net and nothing paid', async () => {
    const { tx, created } = makeTx()
    await run(service, tx)

    const invoice = created['invoice']?.[0]
    expect(invoice.paidMinor).toBe(0n)
    expect(invoice.balanceMinor).toBe(invoice.netMinor)
    expect(invoice.status).toBe('open')
  })

  it('applies a sibling discount and recomputes the net', async () => {
    const { tx, created } = makeTx()
    const result = await run(service, tx, { siblingIndex: 1, siblingPolicy: { percentBp: 1_000 } })

    expect(result.discountMinor).toBe(25_000n)
    expect(result.netMinor).toBe(225_000n)
    expect(created['discount']).toHaveLength(1)
    expect(created['discount']?.[0].type).toBe('sibling')
    expect(created['discount']?.[0].grantedBy).toBe(userId)
  })

  it('does not discount the first child', async () => {
    const { tx, created } = makeTx()
    const result = await run(service, tx, { siblingIndex: 0, siblingPolicy: { percentBp: 1_000 } })

    expect(result.discountMinor).toBe(0n)
    expect(created['discount']).toHaveLength(0)
  })

  it('still balances instalments against the DISCOUNTED net', async () => {
    const { tx, created } = makeTx()
    const result = await run(service, tx, { siblingIndex: 1, siblingPolicy: { percentBp: 1_000 } })

    const total = (created['instalment'] ?? []).reduce((sum: bigint, i: Mock) => sum + i.amountMinor, 0n)
    expect(total).toBe(225_000n)
    expect(total).toBe(result.netMinor)
  })

  describe('ledger', () => {
    it('posts the charge, then each discount', async () => {
      const { tx, created } = makeTx()
      await run(service, tx, { siblingIndex: 1, siblingPolicy: { percentBp: 1_000 } })

      const entries = created['studentLedgerEntry'] ?? []
      expect(entries.map((e: Mock) => e.entryType)).toEqual(['charge', 'discount'])
      expect(entries[0].amountMinor).toBe(250_000n)
      expect(entries[1].amountMinor).toBe(-25_000n)
    })

    it('leaves a running balance equal to the invoice net', async () => {
      const { tx, created } = makeTx()
      const result = await run(service, tx, { siblingIndex: 1, siblingPolicy: { percentBp: 1_000 } })

      const entries = created['studentLedgerEntry'] ?? []
      expect(entries[entries.length - 1].balanceAfterMinor).toBe(result.netMinor)
    })

    it('continues from the student previous balance rather than restarting at zero', async () => {
      const { tx, created } = makeTx()
      tx.studentLedgerEntry.findFirst = vi.fn(async () => ({ balanceAfterMinor: 40_000n }))
      await run(service, tx)

      const entries = created['studentLedgerEntry'] ?? []
      expect(entries[0].balanceAfterMinor).toBe(290_000n)
    })

    it('posts a carry_forward entry when the enrolment brings a debt', async () => {
      const { tx, created } = makeTx()
      tx.enrollment.findUnique = vi.fn(async () => ({
        id: enrollmentId,
        tenantId,
        studentId,
        feeScheduleId,
        enrolledOn: new Date('2026-09-01T00:00:00Z'),
        carriedForwardBalanceMinor: 40_000n,
        invoice: null,
      }))
      await run(service, tx)

      const entries = created['studentLedgerEntry'] ?? []
      expect(entries.map((e: Mock) => e.entryType)).toContain('carry_forward')
      expect(entries[entries.length - 1].balanceAfterMinor).toBe(290_000n)
    })
  })

  it('writes an outbox event in the same transaction rather than queueing a job', async () => {
    const { tx, created } = makeTx()
    await run(service, tx)

    expect(created['outboxEvent']).toHaveLength(1)
    expect(created['outboxEvent']?.[0].eventType).toBe('invoice.raised')
    expect(created['outboxEvent']?.[0].aggregateType).toBe('invoice')
  })

  it('numbers the invoice by year and enrolment, so concurrent enrolments cannot collide', async () => {
    const { tx } = makeTx()
    const result = await run(service, tx)
    expect(result.number).toBe('INV-2026-E1E2E3E4')
  })

  describe('guards', () => {
    it('refuses to raise a second invoice for the same enrolment', async () => {
      const { tx } = makeTx()
      tx.enrollment.findUnique = vi.fn(async () => ({
        id: enrollmentId,
        tenantId,
        studentId,
        feeScheduleId,
        enrolledOn: new Date('2026-09-01T00:00:00Z'),
        carriedForwardBalanceMinor: 0n,
        invoice: { id: 'inv-0', number: 'INV-2026-OLD' },
      }))
      await expect(run(service, tx)).rejects.toThrow(/already has invoice/)
    })

    it('refuses an enrolment belonging to another tenant', async () => {
      const { tx } = makeTx()
      tx.enrollment.findUnique = vi.fn(async () => ({ id: enrollmentId, tenantId: 'other', invoice: null }))
      await expect(run(service, tx)).rejects.toThrow(/enrollment/)
    })

    it('refuses to invoice against an unpublished fee schedule', async () => {
      const { tx, created } = makeTx()
      tx.feeSchedule.findUnique = vi.fn(async () => ({
        id: feeScheduleId,
        tenantId,
        status: 'draft',
        version: 1,
        feeItems: [
          {
            id: 'fi-1',
            code: 'tuition',
            label: 'Scolarité',
            category: 'tuition',
            amountMinor: 200_000n,
            isMandatory: true,
            isRecurring: true,
            sequence: 1,
          },
        ],
      }))
      await expect(run(service, tx)).rejects.toThrow(/only a published schedule/)
      // and nothing was written on the way to failing
      expect(created['invoice']).toBeUndefined()
      expect(created['instalment']).toHaveLength(0)
    })

    it('refuses when discounts would wipe the invoice out entirely', async () => {
      const { tx, created } = makeTx()
      await expect(
        run(service, tx, { manualDiscounts: [{ type: 'hardship', method: 'percent', value: 10_000n }] }),
      ).rejects.toThrow(/zero or less/)
      expect(created['invoice']).toBeUndefined()
    })

    it('refuses when the fee schedule has no instalment plan', async () => {
      const { tx } = makeTx()
      tx.instalmentPlan.findFirst = vi.fn(async () => null)
      await expect(run(service, tx)).rejects.toThrow(/instalment_plan/)
    })

    it('refuses an unknown tenant', async () => {
      const { tx } = makeTx()
      tx.tenant.findUnique = vi.fn(async () => null)
      await expect(run(service, tx)).rejects.toThrow(/tenant/)
    })
  })
})
