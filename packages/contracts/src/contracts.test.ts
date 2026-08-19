import { describe, expect, it } from 'vitest'
import { Money } from '@fineduc/money'
import { MoneySchema, fromMoney, toMoney } from './money.js'
import { CloseCashSessionInputSchema, RecordCashPaymentSchema } from './payments.js'
import { CalendarDateSchema } from './common.js'
import { can, capabilitiesFor, requiresApproval } from './permissions.js'

describe('money wire format', () => {
  it('round-trips a Money exactly', () => {
    const original = Money.of(45_000, 'XAF')
    expect(toMoney(fromMoney(original)).equals(original)).toBe(true)
  })

  it('round-trips an amount larger than Number.MAX_SAFE_INTEGER without loss', () => {
    const huge = Money.of('9007199254740993', 'XAF') // 2^53 + 1
    const wire = fromMoney(huge)
    expect(wire.amountMinor).toBe('9007199254740993')
    expect(toMoney(wire).amount).toBe(9007199254740993n)
  })

  it('survives a real JSON round-trip, which a number field would not', () => {
    const wire = fromMoney(Money.of('9007199254740993', 'XAF'))
    const parsed = MoneySchema.parse(JSON.parse(JSON.stringify(wire)))
    expect(parsed.amountMinor).toBe('9007199254740993')
    // The failure mode this format exists to prevent:
    expect(String(Number('9007199254740993'))).not.toBe('9007199254740993')
  })

  it('rejects a float, a number, or a non-numeric string', () => {
    expect(MoneySchema.safeParse({ amountMinor: '45000.50', currency: 'XAF' }).success).toBe(false)
    expect(MoneySchema.safeParse({ amountMinor: 45000, currency: 'XAF' }).success).toBe(false)
    expect(MoneySchema.safeParse({ amountMinor: 'abc', currency: 'XAF' }).success).toBe(false)
  })

  it('accepts a negative amount, for signed ledger entries', () => {
    expect(MoneySchema.safeParse({ amountMinor: '-500', currency: 'XAF' }).success).toBe(true)
  })
})

describe('calendar dates', () => {
  it('accepts YYYY-MM-DD and rejects a timestamp', () => {
    expect(CalendarDateSchema.safeParse('2026-10-01').success).toBe(true)
    expect(CalendarDateSchema.safeParse('2026-10-01T00:00:00Z').success).toBe(false)
  })
})

describe('cash payment contract', () => {
  it('requires an idempotency key — the cashier will double-tap', () => {
    const withoutKey = {
      studentId: '00000000-0000-4000-8000-000000000001',
      amount: { amountMinor: '12000', currency: 'XAF' },
    }
    expect(RecordCashPaymentSchema.safeParse(withoutKey).success).toBe(false)

    const withKey = { ...withoutKey, idempotencyKey: '00000000-0000-4000-8000-0000000000ff' }
    expect(RecordCashPaymentSchema.safeParse(withKey).success).toBe(true)
  })
})

describe('cash session close contract', () => {
  const base = {
    expectedClose: { amountMinor: '50000', currency: 'XAF' as const },
    idempotencyKey: '00000000-0000-4000-8000-0000000000ff',
  }

  it('allows closing with no reason when the count balances', () => {
    const result = CloseCashSessionInputSchema.safeParse({
      ...base,
      declaredClose: { amountMinor: '50000', currency: 'XAF' },
    })
    expect(result.success).toBe(true)
  })

  it('REQUIRES a reason when the declared count differs from expected', () => {
    const result = CloseCashSessionInputSchema.safeParse({
      ...base,
      declaredClose: { amountMinor: '49500', currency: 'XAF' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts a variance once a reason is given', () => {
    const result = CloseCashSessionInputSchema.safeParse({
      ...base,
      declaredClose: { amountMinor: '49500', currency: 'XAF' },
      varianceReason: 'Erreur de rendu de monnaie, constatée avec le parent',
    })
    expect(result.success).toBe(true)
  })
})

describe('capability matrix', () => {
  it('gives the director everything, including user management', () => {
    expect(can('director', 'users.manage')).toBe(true)
    expect(can('director', 'cash_session.reconcile')).toBe(true)
  })

  it('does not let a bursar manage users or reconcile their own variance', () => {
    expect(can('bursar', 'users.manage')).toBe(false)
    expect(can('bursar', 'cash_session.reconcile')).toBe(false)
  })

  it('keeps the cashier to taking cash and closing their own desk', () => {
    expect(capabilitiesFor('cashier').sort()).toEqual(
      ['cash_session.close_own', 'payments.record_cash', 'students.view'].sort(),
    )
  })

  it('makes the auditor strictly read-only', () => {
    expect(can('auditor', 'audit.view')).toBe(true)
    expect(can('auditor', 'students.edit')).toBe(false)
    expect(can('auditor', 'payments.record_cash')).toBe(false)
  })

  it('flags four-eyes capabilities rather than granting them outright', () => {
    expect(requiresApproval('director', 'payments.refund')).toBe(true)
    expect(requiresApproval('bursar', 'discounts.grant')).toBe(true)
    // A plain grant is not an approval-gated one.
    expect(requiresApproval('director', 'discounts.grant')).toBe(false)
  })
})
