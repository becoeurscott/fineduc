import { describe, it, expect } from 'vitest'
import { Money } from '@fineduc/money'
import { allocatePayment, applyAllocations, assertConserved, type AllocatableInstalment } from './allocation.js'

const XAF = 'XAF' as const
const pay = (minor: bigint) => Money.of(minor, XAF)

function ins(over: Partial<AllocatableInstalment> & Pick<AllocatableInstalment, 'id' | 'sequence' | 'dueOn'>): AllocatableInstalment {
  return { amountMinor: 100_000n, allocatedMinor: 0n, status: 'pending', ...over }
}

const PLAN: AllocatableInstalment[] = [
  ins({ id: 'i1', sequence: 1, dueOn: '2026-09-01' }),
  ins({ id: 'i2', sequence: 2, dueOn: '2026-12-01' }),
  ins({ id: 'i3', sequence: 3, dueOn: '2027-03-01' }),
]

describe('allocatePayment', () => {
  it('fills the oldest instalment first', () => {
    const out = allocatePayment(pay(60_000n), PLAN)
    expect(out.allocations).toEqual([{ instalmentId: 'i1', amountMinor: 60_000n }])
    expect(out.unallocatedMinor).toBe(0n)
  })

  it('spills across instalments in due order', () => {
    const out = allocatePayment(pay(250_000n), PLAN)
    expect(out.allocations).toEqual([
      { instalmentId: 'i1', amountMinor: 100_000n },
      { instalmentId: 'i2', amountMinor: 100_000n },
      { instalmentId: 'i3', amountMinor: 50_000n },
    ])
  })

  it('ignores the order the instalments were handed to it', () => {
    const shuffled = [PLAN[2] as AllocatableInstalment, PLAN[0] as AllocatableInstalment, PLAN[1] as AllocatableInstalment]
    const out = allocatePayment(pay(150_000n), shuffled)
    expect(out.allocations.map((a) => a.instalmentId)).toEqual(['i1', 'i2'])
  })

  it('breaks a same-day tie by sequence, so a replay allocates identically', () => {
    const sameDay = [
      ins({ id: 'b', sequence: 2, dueOn: '2026-09-01' }),
      ins({ id: 'a', sequence: 1, dueOn: '2026-09-01' }),
    ]
    expect(allocatePayment(pay(120_000n), sameDay).allocations.map((a) => a.instalmentId)).toEqual(['a', 'b'])
  })

  it('only takes what an instalment still owes', () => {
    const partly = [ins({ id: 'i1', sequence: 1, dueOn: '2026-09-01', allocatedMinor: 70_000n })]
    const out = allocatePayment(pay(100_000n), partly)
    expect(out.allocations).toEqual([{ instalmentId: 'i1', amountMinor: 30_000n }])
    expect(out.unallocatedMinor).toBe(70_000n)
  })

  it('skips an instalment that is already settled', () => {
    const plan = [
      ins({ id: 'i1', sequence: 1, dueOn: '2026-09-01', allocatedMinor: 100_000n, status: 'paid' }),
      ins({ id: 'i2', sequence: 2, dueOn: '2026-12-01' }),
    ]
    expect(allocatePayment(pay(50_000n), plan).allocations).toEqual([{ instalmentId: 'i2', amountMinor: 50_000n }])
  })

  it('reports an overpayment as unallocated rather than forcing it somewhere', () => {
    const out = allocatePayment(pay(400_000n), PLAN)
    expect(out.allocations).toHaveLength(3)
    expect(out.unallocatedMinor).toBe(100_000n)
  })

  /**
   * A waived instalment was forgiven by a human; a cancelled one no longer
   * exists. Allocating to either quietly reverses that decision.
   */
  it('never allocates to a waived or cancelled instalment', () => {
    const plan = [
      ins({ id: 'w', sequence: 1, dueOn: '2026-09-01', status: 'waived' }),
      ins({ id: 'c', sequence: 2, dueOn: '2026-10-01', status: 'cancelled' }),
      ins({ id: 'ok', sequence: 3, dueOn: '2026-12-01' }),
    ]
    expect(allocatePayment(pay(50_000n), plan).allocations).toEqual([{ instalmentId: 'ok', amountMinor: 50_000n }])
  })

  it('allocates to nothing when every instalment is settled', () => {
    const plan = [ins({ id: 'i1', sequence: 1, dueOn: '2026-09-01', allocatedMinor: 100_000n, status: 'paid' })]
    const out = allocatePayment(pay(50_000n), plan)
    expect(out.allocations).toEqual([])
    expect(out.unallocatedMinor).toBe(50_000n)
  })

  it('conserves the payment for every amount across the plan', () => {
    for (let amount = 1n; amount <= 400n; amount++) {
      const out = allocatePayment(pay(amount * 1_000n), PLAN)
      const allocated = out.allocations.reduce((s, a) => s + a.amountMinor, 0n)
      expect(allocated + out.unallocatedMinor).toBe(amount * 1_000n)
    }
  })

  it('never records a zero-amount allocation', () => {
    const out = allocatePayment(pay(100_000n), PLAN)
    expect(out.allocations.every((a) => a.amountMinor > 0n)).toBe(true)
  })

  describe('targeting one instalment', () => {
    it('pays the named tranche even when an older one is open', () => {
      const out = allocatePayment(pay(40_000n), PLAN, { onlyInstalmentId: 'i3' })
      expect(out.allocations).toEqual([{ instalmentId: 'i3', amountMinor: 40_000n }])
    })

    it('still caps at what that tranche owes', () => {
      const out = allocatePayment(pay(150_000n), PLAN, { onlyInstalmentId: 'i2' })
      expect(out.allocations).toEqual([{ instalmentId: 'i2', amountMinor: 100_000n }])
      expect(out.unallocatedMinor).toBe(50_000n)
    })

    it('rejects an instalment that is not on this invoice', () => {
      expect(() => allocatePayment(pay(1_000n), PLAN, { onlyInstalmentId: 'nope' })).toThrow(/not on this invoice/)
    })

    it('rejects a waived target', () => {
      const plan = [ins({ id: 'w', sequence: 1, dueOn: '2026-09-01', status: 'waived' })]
      expect(() => allocatePayment(pay(1_000n), plan, { onlyInstalmentId: 'w' })).toThrow(/cannot receive a payment/)
    })
  })

  it('rejects a zero or negative payment', () => {
    expect(() => allocatePayment(pay(0n), PLAN)).toThrow(/must be a positive amount/)
    expect(() => allocatePayment(pay(-1n), PLAN)).toThrow(/must be a positive amount/)
  })
})

describe('assertConserved', () => {
  it('passes when the parts add up', () => {
    expect(() => assertConserved(100n, [{ instalmentId: 'a', amountMinor: 60n }], 40n)).not.toThrow()
  })

  it('catches a lost franc', () => {
    expect(() => assertConserved(100n, [{ instalmentId: 'a', amountMinor: 59n }], 40n)).toThrow(/do not equal/)
  })

  it('catches an invented franc', () => {
    expect(() => assertConserved(100n, [{ instalmentId: 'a', amountMinor: 61n }], 40n)).toThrow(/do not equal/)
  })

  it('rejects a zero-amount allocation row', () => {
    expect(() => assertConserved(100n, [{ instalmentId: 'a', amountMinor: 0n }], 100n)).toThrow(/should not be recorded/)
  })
})

describe('applyAllocations', () => {
  it('returns the new allocated total per touched instalment', () => {
    const out = applyAllocations(PLAN, [
      { instalmentId: 'i1', amountMinor: 100_000n },
      { instalmentId: 'i2', amountMinor: 40_000n },
    ])
    expect(out).toEqual([
      { id: 'i1', allocatedMinor: 100_000n },
      { id: 'i2', allocatedMinor: 40_000n },
    ])
  })

  it('adds to what was already allocated rather than replacing it', () => {
    const partly = [ins({ id: 'i1', sequence: 1, dueOn: '2026-09-01', allocatedMinor: 30_000n })]
    expect(applyAllocations(partly, [{ instalmentId: 'i1', amountMinor: 20_000n }])).toEqual([
      { id: 'i1', allocatedMinor: 50_000n },
    ])
  })

  it('leaves untouched instalments out entirely', () => {
    expect(applyAllocations(PLAN, [{ instalmentId: 'i2', amountMinor: 1n }]).map((i) => i.id)).toEqual(['i2'])
  })
})
