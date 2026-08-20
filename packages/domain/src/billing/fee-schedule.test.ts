import { describe, it, expect } from 'vitest'
import {
  computeScheduleTotal,
  assertEditable,
  assertPublishable,
  buildInvoiceLines,
  sumLines,
  type FeeItem,
  type FeeSchedule,
} from './fee-schedule.js'

const XAF = 'XAF' as const

function item(over: Partial<FeeItem> & Pick<FeeItem, 'code' | 'amountMinor'>): FeeItem {
  return {
    id: `fee-${over.code}`,
    label: over.code,
    category: 'tuition',
    isMandatory: true,
    isRecurring: true,
    sequence: 1,
    ...over,
  }
}

const tuition = item({ code: 'tuition', label: 'Scolarité', amountMinor: 200_000n, sequence: 1 })
const registration = item({
  code: 'registration',
  label: 'Inscription',
  category: 'registration',
  amountMinor: 50_000n,
  sequence: 2,
})
const canteen = item({
  code: 'canteen',
  label: 'Cantine',
  category: 'canteen',
  amountMinor: 90_000n,
  isMandatory: false,
  sequence: 3,
})

const published: FeeSchedule = {
  id: 'sched-1',
  status: 'published',
  version: 1,
  items: [tuition, registration, canteen],
}

describe('computeScheduleTotal', () => {
  it('totals the mandatory items', () => {
    expect(computeScheduleTotal(published.items, XAF).amount).toBe(250_000n)
  })

  /**
   * Optional items are chosen per student. Folding canteen and transport
   * into the headline total would overstate the price of the school to
   * every family that does not take them.
   */
  it('excludes optional items', () => {
    const withoutCanteen = computeScheduleTotal([tuition, registration], XAF)
    expect(computeScheduleTotal(published.items, XAF).amount).toBe(withoutCanteen.amount)
  })

  it('is zero for an empty schedule', () => {
    expect(computeScheduleTotal([], XAF).amount).toBe(0n)
  })
})

describe('assertEditable', () => {
  it('allows a draft', () => {
    expect(() => assertEditable({ id: 's', status: 'draft' })).not.toThrow()
  })

  it('refuses a published schedule — publishing is the point of no return', () => {
    expect(() => assertEditable({ id: 's', status: 'published' })).toThrow(/only a draft can be edited/)
  })

  it('refuses an archived schedule — archiving does not reopen it', () => {
    expect(() => assertEditable({ id: 's', status: 'archived' })).toThrow(/only a draft can be edited/)
  })
})

describe('assertPublishable', () => {
  it('accepts a normal schedule', () => {
    expect(() => assertPublishable(published.items, XAF)).not.toThrow()
  })

  it('rejects a schedule with no mandatory item', () => {
    expect(() => assertPublishable([canteen], XAF)).toThrow(/at least one mandatory fee item/)
  })

  it('rejects a negative fee item', () => {
    expect(() => assertPublishable([tuition, item({ code: 'credit', amountMinor: -1n })], XAF)).toThrow(
      /cannot be negative/,
    )
  })

  it('rejects an all-zero schedule — it would chase a balance of zero', () => {
    expect(() => assertPublishable([item({ code: 'free', amountMinor: 0n })], XAF)).toThrow(/must total more than zero/)
  })

  it('rejects a duplicate code', () => {
    expect(() => assertPublishable([tuition, item({ code: 'tuition', amountMinor: 1_000n })], XAF)).toThrow(
      /Duplicate fee item code/,
    )
  })

  it('rejects an empty schedule', () => {
    expect(() => assertPublishable([], XAF)).toThrow(/at least one mandatory fee item/)
  })
})

describe('buildInvoiceLines', () => {
  it('bills every mandatory item and no optional one by default', () => {
    const lines = buildInvoiceLines(published)
    expect(lines.map((l) => l.label)).toEqual(['Scolarité', 'Inscription'])
    expect(sumLines(lines, XAF).amount).toBe(250_000n)
  })

  it('adds an optional item when the student takes it', () => {
    const lines = buildInvoiceLines(published, { optionalCodes: ['canteen'] })
    expect(lines.map((l) => l.label)).toEqual(['Scolarité', 'Inscription', 'Cantine'])
    expect(sumLines(lines, XAF).amount).toBe(340_000n)
  })

  it('orders lines by sequence', () => {
    const shuffled: FeeSchedule = { ...published, items: [registration, canteen, tuition] }
    expect(buildInvoiceLines(shuffled).map((l) => l.label)).toEqual(['Scolarité', 'Inscription'])
  })

  it('links each line back to its fee item', () => {
    expect(buildInvoiceLines(published)[0]?.feeItemId).toBe('fee-tuition')
  })

  /**
   * A silent skip would under-bill the family and nobody would notice until
   * the year-end reconciliation.
   */
  it('rejects an unknown optional code rather than skipping it', () => {
    expect(() => buildInvoiceLines(published, { optionalCodes: ['bus'] })).toThrow(/is not in fee schedule/)
  })

  it('rejects selecting an item that is already mandatory', () => {
    expect(() => buildInvoiceLines(published, { optionalCodes: ['tuition'] })).toThrow(/billed automatically/)
  })

  it('refuses to invoice a draft schedule', () => {
    expect(() => buildInvoiceLines({ ...published, status: 'draft' })).toThrow(/only a published schedule/)
  })

  it('refuses to invoice an archived schedule', () => {
    expect(() => buildInvoiceLines({ ...published, status: 'archived' })).toThrow(/only a published schedule/)
  })
})

describe('sumLines', () => {
  it('multiplies by quantity', () => {
    expect(
      sumLines([{ feeItemId: 'f', label: 'Uniforme', amountMinor: 15_000n, quantity: 3 }], XAF).amount,
    ).toBe(45_000n)
  })

  it('is zero for no lines', () => {
    expect(sumLines([], XAF).amount).toBe(0n)
  })
})
