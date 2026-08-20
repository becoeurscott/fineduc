/**
 * Cash at the desk against a REAL Postgres (ARCHITECTURE.md §8.3-8.4).
 *
 * Four things here cannot be proven with mocks, and three of them are
 * listed in AGENTS.md as tests that must exist and never be deleted:
 *
 *   1. **Receipt numbers are GAPLESS**, including across a ROLLED-BACK
 *      payment. This is the whole reason the counter is a locked row and
 *      not a Postgres sequence — a sequence does not roll back, so an
 *      aborted payment would burn a number and leave the gap an auditor
 *      reads as a deleted receipt.
 *   2. **A double-tapped payment settles once.** The cashier's connection
 *      drops, they press again; the money must be taken exactly once.
 *   3. **Concurrent allocation does not over-allocate** — two payments
 *      racing for the same invoice must serialise on the row lock.
 *   4. The drawer arithmetic and the variance control, end to end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

process.env.DATABASE_URL ??= 'postgresql://fineduc:fineduc@localhost:5432/fineduc'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.JWT_SECRET ??= 'test_only_jwt_secret_32_characters_min'
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

let prisma: Any
let withTenant: Any
let invoicing: Any
let cashPayments: Any
let cashSessions: Any

const NOW = new Date('2026-09-15T09:00:00Z')

interface Fixture {
  tenantId: string
  studentId: string
  enrollmentId: string
  cashDeskId: string
  cashierId: string
  sessionId: string
  invoiceId: string
}

/** A tenant with an invoiced student and an open desk. */
async function seed(marker: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const cashierId = randomUUID()

  const base = await withTenant(prisma, tenantId, async (tx: Any) => {
    await tx.tenant.create({
      data: { id: tenantId, name: `School ${marker}`, country: 'CM', currency: 'XAF', timezone: 'Africa/Douala' },
    })
    const site = await tx.site.create({ data: { tenantId, name: `Site ${marker}`, isPrimary: true } })
    const year = await tx.academicYear.create({
      data: {
        tenantId,
        name: `2026-${marker}`,
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2027-06-30'),
        status: 'active',
      },
    })
    const grade = await tx.gradeLevel.create({ data: { tenantId, name: `Grade ${marker}`, sequence: 1 } })
    const klass = await tx.classGroup.create({
      data: { tenantId, gradeLevelId: grade.id, academicYearId: year.id, siteId: site.id, name: `Class ${marker}` },
    })
    const student = await tx.student.create({
      data: {
        tenantId,
        matricule: `MAT-${marker}-${Date.now()}`,
        firstName: 'Student',
        lastName: marker,
        sex: 'F',
        status: 'enrolled',
      },
    })
    const schedule = await tx.feeSchedule.create({
      data: {
        tenantId,
        academicYearId: year.id,
        gradeLevelId: grade.id,
        name: `Grille ${marker}`,
        version: 1,
        effectiveFrom: new Date('2026-09-01'),
        status: 'published',
        totalMinor: 300_000n,
      },
    })
    await tx.feeItem.create({
      data: {
        tenantId,
        feeScheduleId: schedule.id,
        code: 'tuition',
        label: 'Scolarité',
        category: 'tuition',
        amountMinor: 300_000n,
        isMandatory: true,
        isRecurring: true,
        sequence: 1,
      },
    })
    const plan = await tx.instalmentPlan.create({
      data: { tenantId, feeScheduleId: schedule.id, name: '3 tranches', instalmentCount: 3 },
    })
    for (const [sequence, offset] of [
      [1, 0],
      [2, 90],
      [3, 180],
    ] as const) {
      await tx.instalmentTemplate.create({
        data: {
          tenantId,
          instalmentPlanId: plan.id,
          sequence,
          label: `Tranche ${sequence}`,
          dueOffsetDays: offset,
          // 100 000 each, so the arithmetic in assertions stays readable.
          percentBp: sequence === 1 ? 3334 : 3333,
        },
      })
    }
    const enrollment = await tx.enrollment.create({
      data: {
        tenantId,
        studentId: student.id,
        classGroupId: klass.id,
        academicYearId: year.id,
        feeScheduleId: schedule.id,
        enrolledOn: new Date('2026-09-01'),
        carriedForwardBalanceMinor: 0n,
        status: 'active',
      },
    })
    const desk = await tx.cashDesk.create({ data: { tenantId, siteId: site.id, name: `Guichet ${marker}` } })

    return { studentId: student.id, enrollmentId: enrollment.id, cashDeskId: desk.id }
  })

  const invoice = await withTenant(prisma, tenantId, (tx: Any) =>
    invoicing.raiseForEnrollment(tx, tenantId, {
      enrollmentId: base.enrollmentId,
      grantedByUserId: cashierId,
      now: NOW,
    }),
  )

  const session = await withTenant(prisma, tenantId, (tx: Any) =>
    cashSessions.open(tx, tenantId, {
      cashDeskId: base.cashDeskId,
      openingFloatMinor: 10_000n,
      cashierUserId: cashierId,
    }),
  )

  return { tenantId, ...base, cashierId, sessionId: session.id, invoiceId: invoice.invoiceId }
}

function pay(f: Fixture, amountMinor: bigint, over: Record<string, unknown> = {}) {
  return withTenant(prisma, f.tenantId, (tx: Any) =>
    cashPayments.record(tx, f.tenantId, {
      studentId: f.studentId,
      amountMinor,
      idempotencyKey: randomUUID(),
      cashierUserId: f.cashierId,
      cashSessionId: f.sessionId,
      now: NOW,
      ...over,
    }),
  )
}

describe('Cash at the desk (real Postgres)', () => {
  beforeAll(async () => {
    const db = await import('@fineduc/db')
    withTenant = db.withTenant
    const inv = await import('../dist/modules/billing/invoicing.service.js')
    const cp = await import('../dist/modules/cashbox/cash-payment.service.js')
    const cs = await import('../dist/modules/cashbox/cash-session.service.js')
    const services = await import('@fineduc/services')
    invoicing = new inv.InvoicingService()
    // Allocation, projections and the ledger entry are shared with the
    // aggregator path — the cash service composes that service rather than
    // keeping a second copy of the same money logic.
    cashPayments = new cp.CashPaymentService(new services.SettlementService())
    cashSessions = new cs.CashSessionService()
    prisma = db.createPrismaClient({
      databaseUrl: db.resolveAppDatabaseUrl(process.env.DATABASE_URL as string, process.env.APP_DATABASE_URL),
    })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('allocates oldest due first and updates the invoice projection', async () => {
    const f = await seed('P1')
    const out = await pay(f, 150_000n)

    expect(out.allocatedMinor).toBe(150_000n)
    expect(out.unallocatedMinor).toBe(0n)

    const { invoice, instalments } = await withTenant(prisma, f.tenantId, async (tx: Any) => ({
      invoice: await tx.invoice.findUnique({ where: { id: f.invoiceId } }),
      instalments: await tx.instalment.findMany({ where: { invoiceId: f.invoiceId }, orderBy: { sequence: 'asc' } }),
    }))

    expect(invoice.paidMinor).toBe(150_000n)
    expect(invoice.balanceMinor).toBe(150_000n)
    expect(invoice.status).toBe('partial')
    expect(instalments[0].status).toBe('paid')
    expect(instalments[1].allocatedMinor).toBeGreaterThan(0n)
    expect(instalments[2].allocatedMinor).toBe(0n)
  })

  it('records the cash in the drawer and leaves a consistent ledger', async () => {
    const f = await seed('P2')
    const out = await pay(f, 100_000n)

    const { movements, entries } = await withTenant(prisma, f.tenantId, async (tx: Any) => ({
      movements: await tx.cashMovement.findMany({ where: { cashSessionId: f.sessionId } }),
      entries: await tx.studentLedgerEntry.findMany({
        where: { studentId: f.studentId },
        orderBy: { createdAt: 'asc' },
      }),
    }))

    const paymentMovements = movements.filter((m: Any) => m.type === 'payment')
    expect(paymentMovements).toHaveLength(1)
    expect(paymentMovements[0].amountMinor).toBe(100_000n)
    expect(paymentMovements[0].reference).toBe(out.receiptNumber)

    let running = 0n
    for (const entry of entries) {
      running += entry.amountMinor
      expect(entry.balanceAfterMinor).toBe(running)
    }
    expect(running).toBe(200_000n)
  })

  /**
   * AGENTS.md: "a webhook delivered twice settles once" — the same guarantee,
   * reached by a cashier double-tapping on a slow connection.
   */
  it('settles once when the same payment is submitted twice', async () => {
    const f = await seed('P3')
    const key = randomUUID()

    const first = await pay(f, 50_000n, { idempotencyKey: key })
    const second = await pay(f, 50_000n, { idempotencyKey: key })

    expect(second.replayed).toBe(true)
    expect(second.paymentId).toBe(first.paymentId)
    expect(second.receiptNumber).toBe(first.receiptNumber)

    const { payments, invoice } = await withTenant(prisma, f.tenantId, async (tx: Any) => ({
      payments: await tx.payment.count({ where: { studentId: f.studentId } }),
      invoice: await tx.invoice.findUnique({ where: { id: f.invoiceId } }),
    }))
    expect(payments).toBe(1)
    expect(invoice.paidMinor).toBe(50_000n)
  })

  it('refuses to reuse an idempotency key for a different amount', async () => {
    const f = await seed('P4')
    const key = randomUUID()
    await pay(f, 50_000n, { idempotencyKey: key })
    await expect(pay(f, 60_000n, { idempotencyKey: key })).rejects.toThrow(/already used for a different payment/)
  })

  describe('receipt numbers', () => {
    it('are sequential and gapless within a tenant', async () => {
      const f = await seed('R1')
      const a = await pay(f, 10_000n)
      const b = await pay(f, 10_000n)
      const c = await pay(f, 10_000n)

      const sequences = [a, b, c].map((r) => Number(r.receiptNumber.split('-')[1]))
      expect(sequences[1]).toBe((sequences[0] as number) + 1)
      expect(sequences[2]).toBe((sequences[1] as number) + 1)
      expect(a.receiptNumber).toMatch(/^2026-\d{6}$/)
    })

    /**
     * THE reason the counter is a locked row rather than a Postgres
     * sequence. A sequence would have advanced during the aborted attempt
     * and the next real receipt would skip a number — which an auditor
     * reads as a receipt someone deleted.
     */
    it('do not burn a number when a payment rolls back', async () => {
      const f = await seed('R2')
      const before = await pay(f, 10_000n)

      await expect(
        withTenant(prisma, f.tenantId, async (tx: Any) => {
          await cashPayments.record(tx, f.tenantId, {
            studentId: f.studentId,
            amountMinor: 10_000n,
            idempotencyKey: randomUUID(),
            cashierUserId: f.cashierId,
            cashSessionId: f.sessionId,
            now: NOW,
          })
          throw new Error('boom — the transaction failed after the receipt was numbered')
        }),
      ).rejects.toThrow(/boom/)

      const after = await pay(f, 10_000n)

      const beforeSeq = Number(before.receiptNumber.split('-')[1])
      const afterSeq = Number(after.receiptNumber.split('-')[1])
      expect(afterSeq).toBe(beforeSeq + 1)
    })

    it('are unique per tenant, so two schools both start at 1', async () => {
      const a = await seed('R3')
      const b = await seed('R4')
      const ra = await pay(a, 10_000n)
      const rb = await pay(b, 10_000n)
      expect(ra.receiptNumber).toBe(rb.receiptNumber)
    })
  })

  /**
   * AGENTS.md: "concurrent allocation does not over-allocate". Both payments
   * race for the same invoice; the row lock must serialise them so the
   * instalments never absorb more than they owe.
   */
  it('does not over-allocate when two payments race for one invoice', async () => {
    const f = await seed('C1')

    const results = await Promise.allSettled([pay(f, 200_000n), pay(f, 200_000n)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)

    const { invoice, instalments } = await withTenant(prisma, f.tenantId, async (tx: Any) => ({
      invoice: await tx.invoice.findUnique({ where: { id: f.invoiceId } }),
      instalments: await tx.instalment.findMany({ where: { invoiceId: f.invoiceId } }),
    }))

    // 400 000 offered against a 300 000 invoice: exactly 300 000 may land.
    for (const instalment of instalments) {
      expect(instalment.allocatedMinor).toBeLessThanOrEqual(instalment.amountMinor)
    }
    const allocated = instalments.reduce((sum: bigint, i: Any) => sum + i.allocatedMinor, 0n)
    expect(allocated).toBe(300_000n)
    expect(invoice.paidMinor).toBe(300_000n)
    expect(invoice.balanceMinor).toBe(0n)
    expect(invoice.status).toBe('paid')
  })

  it('keeps an overpayment as unallocated rather than forcing it onto an instalment', async () => {
    const f = await seed('O1')
    const out = await pay(f, 400_000n)
    expect(out.allocatedMinor).toBe(300_000n)
    expect(out.unallocatedMinor).toBe(100_000n)
  })

  describe('closing the desk', () => {
    it('closes cleanly when the count matches float plus takings', async () => {
      const f = await seed('D1')
      await pay(f, 40_000n)

      const out = await withTenant(prisma, f.tenantId, (tx: Any) =>
        cashSessions.close(tx, f.tenantId, f.sessionId, { declaredMinor: 50_000n, closedByUserId: f.cashierId }),
      )
      expect(out.expectedMinor).toBe(50_000n)
      expect(out.varianceMinor).toBe(0n)
      expect(out.status).toBe('closed')
    })

    it('refuses to close a short drawer without a written reason', async () => {
      const f = await seed('D2')
      await pay(f, 40_000n)
      await expect(
        withTenant(prisma, f.tenantId, (tx: Any) =>
          cashSessions.close(tx, f.tenantId, f.sessionId, { declaredMinor: 48_000n, closedByUserId: f.cashierId }),
        ),
      ).rejects.toThrow(/written reason is required/)
    })

    it('flags a short drawer and raises an event for the director', async () => {
      const f = await seed('D3')
      await pay(f, 40_000n)

      const out = await withTenant(prisma, f.tenantId, (tx: Any) =>
        cashSessions.close(tx, f.tenantId, f.sessionId, {
          declaredMinor: 48_000n,
          varianceReason: 'Deux billets manquants, constat devant le directeur',
          closedByUserId: f.cashierId,
        }),
      )
      expect(out.status).toBe('flagged')
      expect(out.varianceMinor).toBe(-2_000n)

      const events = await prisma.outboxEvent.findMany({
        where: { tenantId: f.tenantId, eventType: 'cash_session.flagged' },
      })
      expect(events).toHaveLength(1)
    })

    it('will not take a payment into a closed session', async () => {
      const f = await seed('D4')
      await withTenant(prisma, f.tenantId, (tx: Any) =>
        cashSessions.close(tx, f.tenantId, f.sessionId, { declaredMinor: 10_000n, closedByUserId: f.cashierId }),
      )
      await expect(pay(f, 10_000n)).rejects.toThrow(/Open a new session/)
    })

    it('will not close the same session twice', async () => {
      const f = await seed('D5')
      await withTenant(prisma, f.tenantId, (tx: Any) =>
        cashSessions.close(tx, f.tenantId, f.sessionId, { declaredMinor: 10_000n, closedByUserId: f.cashierId }),
      )
      await expect(
        withTenant(prisma, f.tenantId, (tx: Any) =>
          cashSessions.close(tx, f.tenantId, f.sessionId, { declaredMinor: 10_000n, closedByUserId: f.cashierId }),
        ),
      ).rejects.toThrow(/Open a new session/)
    })

    it('refuses a second open session on the same desk', async () => {
      const f = await seed('D6')
      await expect(
        withTenant(prisma, f.tenantId, (tx: Any) =>
          cashSessions.open(tx, f.tenantId, {
            cashDeskId: f.cashDeskId,
            openingFloatMinor: 5_000n,
            cashierUserId: f.cashierId,
          }),
        ),
      ).rejects.toThrow(/already has an open session/)
    })
  })

  it('hides another tenant payments and receipts', async () => {
    const a = await seed('X1')
    await pay(a, 10_000n)
    const b = await seed('X2')

    const seen = await withTenant(prisma, b.tenantId, async (tx: Any) => ({
      payments: await tx.payment.count({}),
      receipts: await tx.receipt.count({}),
      movements: await tx.cashMovement.count({ where: { type: 'payment' } }),
    }))
    expect(seen).toEqual({ payments: 0, receipts: 0, movements: 0 })
  })
})
