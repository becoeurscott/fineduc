import { describe, it, expect } from 'vitest'
import { Money } from '@fineduc/money'
import { post, postAll, reverse, replayBalance, assertLedgerConsistent, projectInvoice } from './ledger.js'

const XAF = 'XAF' as const
const zero = Money.zero(XAF)
const money = (minor: bigint) => Money.of(minor, XAF)

const source = { sourceType: 'invoice', sourceId: 'inv-1', occurredOn: '2026-09-01' }

describe('post — sign convention', () => {
  it('a charge increases what is owed', () => {
    const { entry, balance } = post(zero, { entryType: 'charge', amount: money(250_000n), ...source })
    expect(entry.amountMinor).toBe(250_000n)
    expect(balance.amount).toBe(250_000n)
  })

  it('a payment reduces it', () => {
    const { entry, balance } = post(money(250_000n), { entryType: 'payment', amount: money(100_000n), ...source })
    expect(entry.amountMinor).toBe(-100_000n)
    expect(balance.amount).toBe(150_000n)
  })

  it('a discount reduces it', () => {
    const { balance } = post(money(250_000n), { entryType: 'discount', amount: money(25_000n), ...source })
    expect(balance.amount).toBe(225_000n)
  })

  it('a carry-forward increases it', () => {
    const { balance } = post(zero, { entryType: 'carry_forward', amount: money(40_000n), ...source })
    expect(balance.amount).toBe(40_000n)
  })

  /**
   * The one that surprises people: refunding a family restores the debt the
   * original payment had cleared, so from the school's books they owe it
   * again.
   */
  it('a refund increases what is owed again', () => {
    const { entry, balance } = post(zero, { entryType: 'refund', amount: money(30_000n), ...source })
    expect(entry.amountMinor).toBe(30_000n)
    expect(balance.amount).toBe(30_000n)
  })

  it('records the balance it leaves behind on the entry itself', () => {
    const { entry } = post(money(100_000n), { entryType: 'payment', amount: money(40_000n), ...source })
    expect(entry.balanceAfterMinor).toBe(60_000n)
  })

  it('carries scope and memo through', () => {
    const { entry } = post(zero, {
      entryType: 'charge',
      amount: money(1_000n),
      ...source,
      invoiceId: 'inv-1',
      instalmentId: 'ins-1',
      memo: 'Tranche 1',
    })
    expect(entry.invoiceId).toBe('inv-1')
    expect(entry.instalmentId).toBe('ins-1')
    expect(entry.memo).toBe('Tranche 1')
  })
})

describe('post — guards', () => {
  it('refuses a negative magnitude; the type decides the sign', () => {
    expect(() => post(zero, { entryType: 'charge', amount: money(-1n), ...source })).toThrow(/positive magnitude/)
  })

  it('refuses a currency the ledger is not in', () => {
    expect(() => post(zero, { entryType: 'charge', amount: Money.of(1n, 'NGN'), ...source })).toThrow(
      /exactly one currency/,
    )
  })

  it('requires an explicit direction for an adjustment', () => {
    expect(() => post(zero, { entryType: 'adjustment', amount: money(1_000n), ...source })).toThrow(
      /direction must be stated/,
    )
  })

  it('requires an explicit direction for a reversal', () => {
    expect(() => post(zero, { entryType: 'reversal', amount: money(1_000n), ...source })).toThrow(
      /direction must be stated/,
    )
  })

  it('accepts a directed adjustment both ways', () => {
    expect(post(zero, { entryType: 'adjustment', amount: money(1_000n), ...source }, 1).balance.amount).toBe(1_000n)
    expect(post(money(5_000n), { entryType: 'adjustment', amount: money(1_000n), ...source }, -1).balance.amount).toBe(
      4_000n,
    )
  })

  it('refuses to let a caller override the sign of a payment', () => {
    expect(() => post(zero, { entryType: 'payment', amount: money(1_000n), ...source }, 1)).toThrow(
      /cannot be overridden/,
    )
  })
})

describe('postAll', () => {
  it('carries the balance through a run of entries', () => {
    const { entries, balance } = postAll(zero, [
      { entryType: 'charge', amount: money(250_000n), ...source },
      { entryType: 'discount', amount: money(25_000n), ...source },
      { entryType: 'payment', amount: money(100_000n), ...source },
    ])
    expect(entries.map((e) => e.balanceAfterMinor)).toEqual([250_000n, 225_000n, 125_000n])
    expect(balance.amount).toBe(125_000n)
  })

  it('posts in the order given — a ledger is a sequence, not a set', () => {
    const a = postAll(zero, [
      { entryType: 'charge', amount: money(100n), ...source },
      { entryType: 'payment', amount: money(40n), ...source },
    ])
    const b = postAll(zero, [
      { entryType: 'payment', amount: money(40n), ...source },
      { entryType: 'charge', amount: money(100n), ...source },
    ])
    expect(a.entries.map((e) => e.balanceAfterMinor)).toEqual([100n, 60n])
    expect(b.entries.map((e) => e.balanceAfterMinor)).toEqual([-40n, 60n])
    expect(a.balance.amount).toBe(b.balance.amount)
  })

  it('is a no-op on an empty run', () => {
    const { entries, balance } = postAll(money(500n), [])
    expect(entries).toEqual([])
    expect(balance.amount).toBe(500n)
  })
})

describe('reverse', () => {
  it('cancels a charge exactly', () => {
    const charge = post(zero, { entryType: 'charge', amount: money(250_000n), ...source })
    const undone = reverse(charge.balance, charge.entry, { ...source, sourceId: 'rev-1' })
    expect(undone.entry.amountMinor).toBe(-250_000n)
    expect(undone.balance.amount).toBe(0n)
  })

  it('cancels a payment exactly', () => {
    const opening = money(250_000n)
    const payment = post(opening, { entryType: 'payment', amount: money(100_000n), ...source })
    const undone = reverse(payment.balance, payment.entry, { ...source, sourceId: 'rev-1' })
    expect(undone.entry.amountMinor).toBe(100_000n)
    expect(undone.balance.amount).toBe(opening.amount)
  })

  it('is typed as a reversal and keeps the original scope', () => {
    const charge = post(zero, { entryType: 'charge', amount: money(1_000n), ...source, invoiceId: 'inv-1', instalmentId: 'ins-1' })
    const undone = reverse(charge.balance, charge.entry, { ...source, sourceId: 'rev-1', memo: 'Erreur de saisie' })
    expect(undone.entry.entryType).toBe('reversal')
    expect(undone.entry.invoiceId).toBe('inv-1')
    expect(undone.entry.instalmentId).toBe('ins-1')
    expect(undone.entry.memo).toBe('Erreur de saisie')
  })

  it('leaves BOTH rows in the ledger — an auditor must see the correction', () => {
    const charge = post(zero, { entryType: 'charge', amount: money(1_000n), ...source })
    const undone = reverse(charge.balance, charge.entry, { ...source, sourceId: 'rev-1' })
    const ledger = [charge.entry, undone.entry]
    expect(ledger).toHaveLength(2)
    expect(replayBalance(ledger, XAF).amount).toBe(0n)
  })

  it('refuses to reverse nothing', () => {
    expect(() =>
      reverse(zero, { amountMinor: 0n }, { ...source, sourceId: 'rev-1' }),
    ).toThrow(/nothing to reverse/)
  })
})

describe('replayBalance', () => {
  it('re-derives the balance from entries alone', () => {
    const { entries } = postAll(zero, [
      { entryType: 'charge', amount: money(250_000n), ...source },
      { entryType: 'payment', amount: money(100_000n), ...source },
    ])
    expect(replayBalance(entries, XAF).amount).toBe(150_000n)
  })

  it('starts from an opening balance when given one', () => {
    expect(replayBalance([{ amountMinor: 100n }], XAF, 400n).amount).toBe(500n)
  })

  it('is zero for an empty ledger', () => {
    expect(replayBalance([], XAF).amount).toBe(0n)
  })
})

describe('assertLedgerConsistent', () => {
  it('passes on a ledger built through post()', () => {
    const { entries } = postAll(zero, [
      { entryType: 'charge', amount: money(250_000n), ...source },
      { entryType: 'discount', amount: money(25_000n), ...source },
      { entryType: 'payment', amount: money(225_000n), ...source },
    ])
    expect(() => assertLedgerConsistent(entries)).not.toThrow()
  })

  /**
   * The drift the nightly integrity sweep exists to catch: an entry written
   * outside the balance-carrying path (ARCHITECTURE.md "five things most
   * likely to break", #1).
   */
  it('catches an entry whose recorded balance does not match the running total', () => {
    const tampered = [
      { amountMinor: 250_000n, balanceAfterMinor: 250_000n },
      { amountMinor: -100_000n, balanceAfterMinor: 149_000n },
    ]
    expect(() => assertLedgerConsistent(tampered)).toThrow(/records a balance of 149000/)
  })

  it('respects an opening balance', () => {
    expect(() => assertLedgerConsistent([{ amountMinor: 100n, balanceAfterMinor: 500n }], 400n)).not.toThrow()
    expect(() => assertLedgerConsistent([{ amountMinor: 100n, balanceAfterMinor: 100n }], 400n)).toThrow(/drift|balance/)
  })
})

describe('projectInvoice', () => {
  it('is open before anything is paid', () => {
    expect(projectInvoice(250_000n, 0n)).toEqual({ paidMinor: 0n, balanceMinor: 250_000n, status: 'open' })
  })

  it('is partial once something lands', () => {
    expect(projectInvoice(250_000n, 100_000n)).toEqual({ paidMinor: 100_000n, balanceMinor: 150_000n, status: 'partial' })
  })

  it('is paid at exactly the net', () => {
    expect(projectInvoice(250_000n, 250_000n)).toEqual({ paidMinor: 250_000n, balanceMinor: 0n, status: 'paid' })
  })

  it('is paid, with a negative balance, on an overpayment', () => {
    const out = projectInvoice(250_000n, 260_000n)
    expect(out.status).toBe('paid')
    expect(out.balanceMinor).toBe(-10_000n)
  })

  it('rejects a negative allocation', () => {
    expect(() => projectInvoice(250_000n, -1n)).toThrow(/cannot be negative/)
  })
})
