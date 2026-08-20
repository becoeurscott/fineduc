/**
 * The aggregator path against a REAL Postgres (ARCHITECTURE.md §8.2).
 *
 * The guarantee AGENTS.md names and this file finally proves:
 * **a webhook delivered twice settles once.** Aggregators retry, and they
 * retry out of order. Two things stand between that and a double-credited
 * family:
 *
 *   1. `provider_event` is unique on (provider, event_id) — the second
 *      delivery conflicts and stops at the door.
 *   2. The payment row is locked FOR UPDATE and the state machine refuses
 *      the transition anyway, so even a redelivery that gets past the door
 *      cannot allocate twice.
 *
 * Also proves the case that would be worst to get wrong: a LATE `failed`
 * arriving after settlement is logged and dropped, never applied. Money in
 * the school's account must not un-settle because a callback was slow.
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
let processor: Any
let ingest: Any
let FakeProvider: Any
let Money: Any

const NOW = new Date('2026-09-20T10:00:00Z')

interface Fixture {
  tenantId: string
  studentId: string
  invoiceId: string
  paymentId: string
  providerRef: string
}

async function seed(marker: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const userId = randomUUID()

  const base = await withTenant(prisma, tenantId, async (tx: Any) => {
    await tx.tenant.create({
      data: { id: tenantId, name: `School ${marker}`, country: 'CM', currency: 'XAF', timezone: 'Africa/Douala' },
    })
    const site = await tx.site.create({ data: { tenantId, name: `S${marker}`, isPrimary: true } })
    const year = await tx.academicYear.create({
      data: {
        tenantId,
        name: `2026-${marker}`,
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2027-06-30'),
        status: 'active',
      },
    })
    const grade = await tx.gradeLevel.create({ data: { tenantId, name: `G${marker}`, sequence: 1 } })
    const klass = await tx.classGroup.create({
      data: { tenantId, gradeLevelId: grade.id, academicYearId: year.id, siteId: site.id, name: `C${marker}` },
    })
    const student = await tx.student.create({
      data: {
        tenantId,
        matricule: `MAT-${marker}-${Date.now()}`,
        firstName: 'Eleve',
        lastName: marker,
        sex: 'M',
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
      data: { tenantId, feeScheduleId: schedule.id, name: '3', instalmentCount: 3 },
    })
    for (const [sequence, offset, bp] of [
      [1, 0, 3334],
      [2, 90, 3333],
      [3, 180, 3333],
    ] as const) {
      await tx.instalmentTemplate.create({
        data: {
          tenantId,
          instalmentPlanId: plan.id,
          sequence,
          label: `T${sequence}`,
          dueOffsetDays: offset,
          percentBp: bp,
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
    return { studentId: student.id, enrollmentId: enrollment.id }
  })

  const invoice = await withTenant(prisma, tenantId, (tx: Any) =>
    invoicing.raiseForEnrollment(tx, tenantId, {
      enrollmentId: base.enrollmentId,
      grantedByUserId: userId,
      now: NOW,
    }),
  )

  // A pending mobile-money payment, as POST /pay/:token/initiate would leave it.
  const providerRef = `fake_REF-${marker}-${Date.now()}`
  const payment = await withTenant(prisma, tenantId, (tx: Any) =>
    tx.payment.create({
      data: {
        tenantId,
        studentId: base.studentId,
        invoiceId: invoice.invoiceId,
        method: 'mobile_money',
        amountMinor: 120_000n,
        currency: 'XAF',
        status: 'pending',
        provider: 'fake',
        providerRef,
        payerPhoneE164: '+237600000001',
        idempotencyKey: randomUUID(),
      },
    }),
  )

  return { tenantId, studentId: base.studentId, invoiceId: invoice.invoiceId, paymentId: payment.id, providerRef }
}

function event(f: Fixture, over: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    providerRef: f.providerRef,
    status: 'succeeded',
    paidAmount: Money.of(120_000n, 'XAF'),
    occurredAt: NOW,
    ...over,
  }
}

const run = (f: Fixture, e: Record<string, unknown>) =>
  withTenant(prisma, f.tenantId, (tx: Any) => processor.process(tx, f.tenantId, e, { now: NOW }))

describe('Mobile money settlement (real Postgres)', () => {
  beforeAll(async () => {
    const db = await import('@fineduc/db')
    const money = await import('@fineduc/money')
    const providers = await import('@fineduc/providers')
    withTenant = db.withTenant
    Money = money.Money
    FakeProvider = providers.FakePaymentProvider
    const inv = await import('../dist/modules/billing/invoicing.service.js')
    const st = await import('../dist/modules/payments/settlement.service.js')
    const wp = await import('../dist/modules/payments/webhook-processor.service.js')
    const wi = await import('../dist/modules/payments/webhook.service.js')
    invoicing = new inv.InvoicingService()
    processor = new wp.WebhookProcessorService(new st.SettlementService())
    ingest = new wi.WebhookIngestService()
    prisma = db.createPrismaClient({
      databaseUrl: db.resolveAppDatabaseUrl(process.env.DATABASE_URL as string, process.env.APP_DATABASE_URL),
    })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('settles a successful payment and allocates oldest due first', async () => {
    const f = await seed('W1')
    const out = await run(f, event(f))

    expect(out.result).toBe('settled')
    expect(out.allocatedMinor).toBe(120_000n)

    const { payment, invoice } = await withTenant(prisma, f.tenantId, async (tx: Any) => ({
      payment: await tx.payment.findUnique({ where: { id: f.paymentId } }),
      invoice: await tx.invoice.findUnique({ where: { id: f.invoiceId } }),
    }))
    expect(payment.status).toBe('succeeded')
    expect(invoice.paidMinor).toBe(120_000n)
    expect(invoice.balanceMinor).toBe(180_000n)
  })

  /** THE guarantee. */
  it('settles ONCE when the same webhook is delivered twice', async () => {
    const f = await seed('W2')
    const e = event(f)

    const first = await run(f, e)
    const second = await run(f, e)

    expect(first.result).toBe('settled')
    expect(second.result).toBe('already_settled')

    const { invoice, allocations, entries } = await withTenant(prisma, f.tenantId, async (tx: Any) => ({
      invoice: await tx.invoice.findUnique({ where: { id: f.invoiceId } }),
      allocations: await tx.paymentAllocation.findMany({ where: { paymentId: f.paymentId } }),
      entries: await tx.studentLedgerEntry.findMany({ where: { studentId: f.studentId, entryType: 'payment' } }),
    }))

    expect(invoice.paidMinor).toBe(120_000n)
    expect(allocations).toHaveLength(2)
    expect(entries).toHaveLength(1)
  })

  it('settles once even when the two deliveries carry different event ids', async () => {
    const f = await seed('W3')
    await run(f, event(f))
    const second = await run(f, event(f))

    expect(second.result).toBe('already_settled')
    const invoice = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.invoice.findUnique({ where: { id: f.invoiceId } }),
    )
    expect(invoice.paidMinor).toBe(120_000n)
  })

  /**
   * The worst thing this system could do is un-settle money already in a
   * school's account because a callback arrived late.
   */
  it('drops a late failure that arrives after settlement', async () => {
    const f = await seed('W4')
    await run(f, event(f))
    const late = await run(f, event(f, { status: 'failed', failureReason: 'timeout' }))

    expect(late.result).toBe('ignored')
    expect(late.reason).toMatch(/illegal transition succeeded -> failed/)

    const { payment, invoice } = await withTenant(prisma, f.tenantId, async (tx: Any) => ({
      payment: await tx.payment.findUnique({ where: { id: f.paymentId } }),
      invoice: await tx.invoice.findUnique({ where: { id: f.invoiceId } }),
    }))
    expect(payment.status).toBe('succeeded')
    expect(invoice.paidMinor).toBe(120_000n)
  })

  it('records a failure without touching money', async () => {
    const f = await seed('W5')
    const out = await run(f, event(f, { status: 'failed', failureReason: 'insufficient funds' }))

    expect(out.result).toBe('recorded')
    const { payment, invoice, allocations } = await withTenant(prisma, f.tenantId, async (tx: Any) => ({
      payment: await tx.payment.findUnique({ where: { id: f.paymentId } }),
      invoice: await tx.invoice.findUnique({ where: { id: f.invoiceId } }),
      allocations: await tx.paymentAllocation.count({ where: { paymentId: f.paymentId } }),
    }))
    expect(payment.status).toBe('failed')
    expect(invoice.paidMinor).toBe(0n)
    expect(allocations).toBe(0)
  })

  /**
   * A parent may authorise less than the amount we suggested. Settling what
   * we hoped for rather than what arrived is how a ledger stops matching a
   * bank account.
   */
  it('settles the amount the PROVIDER reports, not the amount we asked for', async () => {
    const f = await seed('W6')
    await run(f, event(f, { paidAmount: Money.of(50_000n, 'XAF') }))

    const { payment, invoice } = await withTenant(prisma, f.tenantId, async (tx: Any) => ({
      payment: await tx.payment.findUnique({ where: { id: f.paymentId } }),
      invoice: await tx.invoice.findUnique({ where: { id: f.invoiceId } }),
    }))
    expect(payment.amountMinor).toBe(50_000n)
    expect(invoice.paidMinor).toBe(50_000n)
  })

  it('raises payment.succeeded on the outbox for the receipt job', async () => {
    const f = await seed('W7')
    await run(f, event(f))
    const events = await prisma.outboxEvent.findMany({
      where: { tenantId: f.tenantId, eventType: 'payment.succeeded' },
    })
    expect(events).toHaveLength(1)
  })

  describe('ingest', () => {
    const provider = () => new FakeProvider()

    it('rejects an unsigned body without storing it', async () => {
      const before = await prisma.providerEvent.count()
      const out = await ingest.ingest(prisma, provider(), Buffer.from('{}'), {})
      expect(out.result).toBe('rejected')
      expect(await prisma.providerEvent.count()).toBe(before)
    })

    it('rejects a forged signature', async () => {
      const out = await ingest.ingest(prisma, provider(), Buffer.from('{}'), { 'x-fake-signature': 'deadbeef' })
      expect(out.result).toBe('rejected')
    })

    it('stores a verified event once and calls the second delivery a duplicate', async () => {
      const p = provider()
      const body = Buffer.from(
        JSON.stringify({
          event_id: `evt_${randomUUID()}`,
          provider_ref: 'fake_REF-INGEST',
          status: 'succeeded',
          occurred_at: NOW.toISOString(),
        }),
      )
      const headers = { 'x-fake-signature': p.sign(body) }

      const first = await ingest.ingest(prisma, p, body, headers)
      const second = await ingest.ingest(prisma, p, body, headers)

      expect(first.result).toBe('accepted')
      expect(second.result).toBe('duplicate')
      expect(second.providerEventId).toBe(first.providerEventId)
    })

    it('rejects a verified body that is not valid JSON', async () => {
      const p = provider()
      const body = Buffer.from('not json at all')
      const out = await ingest.ingest(prisma, p, body, { 'x-fake-signature': p.sign(body) })
      expect(out.result).toBe('rejected')
      expect(out.reason).toMatch(/JSON/)
    })
  })
})
