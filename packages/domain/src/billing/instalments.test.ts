import { describe, it, expect } from 'vitest'
import { Money } from '@fineduc/money'
import {
  addCalendarDays,
  expandInstalments,
  assertInstalmentsCoverNet,
  instalmentStatus,
  byOldestDue,
  type InstalmentTemplate,
} from './instalments.js'

const XAF = 'XAF' as const
const anchor = { anchorDate: '2026-09-01' }

function pct(sequence: number, percentBp: number, dueOffsetDays: number, label = `T${sequence}`): InstalmentTemplate {
  return { sequence, label, percentBp, dueOffsetDays }
}

describe('addCalendarDays', () => {
  it('adds whole calendar days', () => {
    expect(addCalendarDays('2026-09-01', 30)).toBe('2026-10-01')
    expect(addCalendarDays('2026-09-01', 0)).toBe('2026-09-01')
  })

  it('rolls over month and year boundaries', () => {
    expect(addCalendarDays('2026-12-20', 20)).toBe('2027-01-09')
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('handles a leap day', () => {
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addCalendarDays('2027-02-28', 1)).toBe('2027-03-01')
  })

  it('goes backwards', () => {
    expect(addCalendarDays('2026-09-01', -1)).toBe('2026-08-31')
  })

  /**
   * The DST guard. Africa/Douala has no DST, but a tenant elsewhere might,
   * and the whole reason this uses UTC date arithmetic is that adding
   * 30 * 86_400_000 ms across a DST boundary lands an hour off and can tip
   * the date. Same-day-of-month must survive regardless.
   */
  it('does not drift across a DST transition', () => {
    // Europe/Paris springs forward on 2026-03-29.
    expect(addCalendarDays('2026-03-01', 31)).toBe('2026-04-01')
    // ...and falls back on 2026-10-25.
    expect(addCalendarDays('2026-10-01', 31)).toBe('2026-11-01')
  })

  it('rejects a fractional offset', () => {
    expect(() => addCalendarDays('2026-09-01', 1.5)).toThrow(/whole number of days/)
  })
})

describe('expandInstalments', () => {
  it('splits a clean three-way percentage plan', () => {
    const out = expandInstalments(
      [pct(1, 3334, 0), pct(2, 3333, 90), pct(3, 3333, 180)],
      Money.of(300_000n, XAF),
      anchor,
    )
    expect(out.map((i) => i.amountMinor)).toEqual([100_020n, 99_990n, 99_990n])
    expect(out.map((i) => i.dueOn)).toEqual(['2026-09-01', '2026-11-30', '2027-02-28'])
  })

  /**
   * ARCHITECTURE.md §5's worked example, as an instalment plan: the parts
   * must re-sum to the whole, with the odd franc landing deterministically.
   */
  it('never loses a franc on an indivisible split', () => {
    const net = Money.of(100_000n, XAF)
    const out = expandInstalments([pct(1, 3334, 0), pct(2, 3333, 30), pct(3, 3333, 60)], net, anchor)
    expect(out.reduce((s, i) => s + i.amountMinor, 0n)).toBe(100_000n)
  })

  it('re-sums exactly for every awkward net across an even split', () => {
    for (let net = 1; net <= 400; net++) {
      const out = expandInstalments(
        [pct(1, 3333, 0), pct(2, 3333, 30), pct(3, 3334, 60)],
        Money.of(BigInt(net), XAF),
        anchor,
      )
      expect(out.reduce((s, i) => s + i.amountMinor, 0n)).toBe(BigInt(net))
    }
  })

  it('honours fixed amounts and gives the remainder to the percentage tranches', () => {
    const out = expandInstalments(
      [
        { sequence: 1, label: 'Inscription', amountMinor: 50_000n, dueOffsetDays: 0 },
        pct(2, 5000, 60),
        pct(3, 5000, 120),
      ],
      Money.of(250_000n, XAF),
      anchor,
    )
    expect(out.map((i) => i.amountMinor)).toEqual([50_000n, 100_000n, 100_000n])
    expect(out.reduce((s, i) => s + i.amountMinor, 0n)).toBe(250_000n)
  })

  it('accepts an explicit due date instead of an offset', () => {
    const out = expandInstalments(
      [{ sequence: 1, label: 'Unique', percentBp: 10_000, dueOn: '2026-12-24' }],
      Money.of(75_000n, XAF),
      anchor,
    )
    expect(out[0]?.dueOn).toBe('2026-12-24')
  })

  it('orders output by sequence even when templates arrive shuffled', () => {
    const out = expandInstalments([pct(3, 3333, 180), pct(1, 3334, 0), pct(2, 3333, 90)], Money.of(300_000n, XAF), anchor)
    expect(out.map((i) => i.sequence)).toEqual([1, 2, 3])
  })

  it('starts every instalment pending', () => {
    const out = expandInstalments([pct(1, 10_000, 0)], Money.of(1_000n, XAF), anchor)
    expect(out.every((i) => i.status === 'pending')).toBe(true)
  })

  describe('rejects plans that would silently mis-bill', () => {
    it('percentages that do not total 100%', () => {
      expect(() => expandInstalments([pct(1, 5000, 0), pct(2, 4000, 30)], Money.of(100_000n, XAF), anchor)).toThrow(
        /must total exactly 10000/,
      )
    })

    it('a template setting both an amount and a percentage', () => {
      expect(() =>
        expandInstalments(
          [{ sequence: 1, label: 'Both', amountMinor: 1_000n, percentBp: 10_000, dueOffsetDays: 0 }],
          Money.of(1_000n, XAF),
          anchor,
        ),
      ).toThrow(/exactly one of amountMinor or percentBp/)
    })

    it('a template setting neither an amount nor a percentage', () => {
      expect(() =>
        expandInstalments([{ sequence: 1, label: 'Neither', dueOffsetDays: 0 }], Money.of(1_000n, XAF), anchor),
      ).toThrow(/exactly one of amountMinor or percentBp/)
    })

    it('a template setting both a due offset and a due date', () => {
      expect(() =>
        expandInstalments(
          [{ sequence: 1, label: 'Both dates', percentBp: 10_000, dueOffsetDays: 0, dueOn: '2026-09-01' }],
          Money.of(1_000n, XAF),
          anchor,
        ),
      ).toThrow(/exactly one of dueOffsetDays or dueOn/)
    })

    it('fixed amounts exceeding the net', () => {
      expect(() =>
        expandInstalments(
          [{ sequence: 1, label: 'Too big', amountMinor: 200_000n, dueOffsetDays: 0 }],
          Money.of(100_000n, XAF),
          anchor,
        ),
      ).toThrow(/more than the net/)
    })

    it('fixed amounts falling short with nothing to absorb the rest', () => {
      expect(() =>
        expandInstalments(
          [{ sequence: 1, label: 'Too small', amountMinor: 40_000n, dueOffsetDays: 0 }],
          Money.of(100_000n, XAF),
          anchor,
        ),
      ).toThrow(/Add a percentage instalment/)
    })

    it('an empty plan', () => {
      expect(() => expandInstalments([], Money.of(1_000n, XAF), anchor)).toThrow(/at least one template/)
    })

    it('a zero or negative net', () => {
      expect(() => expandInstalments([pct(1, 10_000, 0)], Money.of(0n, XAF), anchor)).toThrow(/positive net/)
    })

    it('a duplicate sequence', () => {
      expect(() => expandInstalments([pct(1, 5000, 0), pct(1, 5000, 30)], Money.of(1_000n, XAF), anchor)).toThrow(
        /Duplicate instalment sequence/,
      )
    })

    it('a non-positive percentage', () => {
      expect(() => expandInstalments([pct(1, 0, 0), pct(2, 10_000, 30)], Money.of(1_000n, XAF), anchor)).toThrow(
        /positive percentage/,
      )
    })
  })
})

describe('assertInstalmentsCoverNet', () => {
  it('passes when the sum matches exactly', () => {
    expect(() =>
      assertInstalmentsCoverNet([{ amountMinor: 60_000n }, { amountMinor: 40_000n }], Money.of(100_000n, XAF)),
    ).not.toThrow()
  })

  it('fails one franc short — the whole point of the invariant', () => {
    expect(() =>
      assertInstalmentsCoverNet([{ amountMinor: 60_000n }, { amountMinor: 39_999n }], Money.of(100_000n, XAF)),
    ).toThrow(/must be equal/)
  })

  it('fails one franc over', () => {
    expect(() =>
      assertInstalmentsCoverNet([{ amountMinor: 60_001n }, { amountMinor: 40_000n }], Money.of(100_000n, XAF)),
    ).toThrow(/must be equal/)
  })
})

describe('instalmentStatus', () => {
  const base = { amountMinor: 100_000n, dueOn: '2026-10-01' }

  it('is pending before anything is paid and before the due date', () => {
    expect(instalmentStatus({ ...base, allocatedMinor: 0n }, '2026-09-15')).toBe('pending')
  })

  it('is partial once something is allocated', () => {
    expect(instalmentStatus({ ...base, allocatedMinor: 40_000n }, '2026-09-15')).toBe('partial')
  })

  it('is paid at exactly the full amount', () => {
    expect(instalmentStatus({ ...base, allocatedMinor: 100_000n }, '2026-09-15')).toBe('paid')
  })

  it('is paid on an overpayment', () => {
    expect(instalmentStatus({ ...base, allocatedMinor: 120_000n }, '2026-12-01')).toBe('paid')
  })

  it('is overdue the day after the due date', () => {
    expect(instalmentStatus({ ...base, allocatedMinor: 0n }, '2026-10-02')).toBe('overdue')
  })

  it('is NOT overdue on the due date itself — the family has all day to pay', () => {
    expect(instalmentStatus({ ...base, allocatedMinor: 0n }, '2026-10-01')).toBe('pending')
  })

  it('prefers paid over overdue', () => {
    expect(instalmentStatus({ ...base, allocatedMinor: 100_000n }, '2027-01-01')).toBe('paid')
  })

  it('keeps waived and cancelled — a human decided those', () => {
    expect(instalmentStatus({ ...base, allocatedMinor: 0n, status: 'waived' }, '2027-01-01')).toBe('waived')
    expect(instalmentStatus({ ...base, allocatedMinor: 0n, status: 'cancelled' }, '2027-01-01')).toBe('cancelled')
  })
})

describe('byOldestDue', () => {
  it('orders by due date', () => {
    const out = byOldestDue([
      { dueOn: '2026-12-01', sequence: 3 },
      { dueOn: '2026-09-01', sequence: 1 },
      { dueOn: '2026-10-01', sequence: 2 },
    ])
    expect(out.map((i) => i.sequence)).toEqual([1, 2, 3])
  })

  it('breaks a same-day tie by sequence, so replays allocate identically', () => {
    const out = byOldestDue([
      { dueOn: '2026-09-01', sequence: 2 },
      { dueOn: '2026-09-01', sequence: 1 },
    ])
    expect(out.map((i) => i.sequence)).toEqual([1, 2])
  })

  it('does not mutate its input', () => {
    const input = [
      { dueOn: '2026-12-01', sequence: 2 },
      { dueOn: '2026-09-01', sequence: 1 },
    ]
    byOldestDue(input)
    expect(input.map((i) => i.sequence)).toEqual([2, 1])
  })
})
