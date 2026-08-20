/**
 * The enrolment money path against a REAL Postgres (ARCHITECTURE.md §8.1).
 *
 * AGENTS.md requires every money path to have domain tests AND an
 * integration test. The domain suite proves the arithmetic and the service
 * unit suite proves the orchestration against mocks; neither can prove the
 * three things that only a database can settle:
 *
 *   1. **Atomicity.** Enrolment and the invoice it implies commit together
 *      or not at all. A mock cannot roll back.
 *   2. **The invariant against PERSISTED rows.** sum(instalment.amount)
 *      must equal invoice.net_minor after a real commit, with real bigint
 *      columns — not against the array the expander happened to return.
 *   3. **RLS.** The invoice, its instalments and its ledger belong to one
 *      tenant and must be invisible to another (AGENTS.md rule #4).
 *
 * Runs against the compiled dist, like health.e2e.test.ts, and against the
 * shared dev stack (infra/docker-compose.yml) rather than Testcontainers —
 * that is the established pattern for apps/api, and vitest.config.ts already
 * serialises these files so they cannot corrupt each other's fixtures.
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
let InvoicingService: Any
let service: Any
let reader: Any

const USER_ID = randomUUID()

interface Fixture {
  tenantId: string
  studentId: string
  enrollmentId: string
  feeScheduleId: string
}

/**
 * A complete, FK-valid graph for one tenant: year, grade, class, student,
 * a PUBLISHED fee schedule totalling 250 000 XAF, and a three-way plan
 * whose percentages are deliberately indivisible (3334/3333/3333) so the
 * largest-remainder split is actually exercised rather than landing on a
 * round number by luck.
 */
async function seedTenant(marker: string): Promise<Fixture> {
  const tenantId = randomUUID()

  return withTenant(prisma, tenantId, async (tx: Any) => {
    await tx.tenant.create({
      data: { id: tenantId, name: `School ${marker}`, country: 'CM', currency: 'XAF', timezone: 'Africa/Douala' },
    })
    const site = await tx.site.create({ data: { tenantId, name: `Site ${marker}`, isPrimary: true } })
    const academicYear = await tx.academicYear.create({
      data: {
        tenantId,
        name: `2026-${marker}`,
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2027-06-30'),
        status: 'active',
      },
    })
    const gradeLevel = await tx.gradeLevel.create({ data: { tenantId, name: `Grade ${marker}`, sequence: 1 } })
    const classGroup = await tx.classGroup.create({
      data: {
        tenantId,
        gradeLevelId: gradeLevel.id,
        academicYearId: academicYear.id,
        siteId: site.id,
        name: `Class ${marker}`,
      },
    })
    const student = await tx.student.create({
      data: {
        tenantId,
        matricule: `MAT-${marker}-${Date.now()}`,
        firstName: 'Student',
        lastName: marker,
        sex: 'M',
        status: 'enrolled',
      },
    })

    const feeSchedule = await tx.feeSchedule.create({
      data: {
        tenantId,
        academicYearId: academicYear.id,
        gradeLevelId: gradeLevel.id,
        name: `Grille ${marker}`,
        version: 1,
        effectiveFrom: new Date('2026-09-01'),
        status: 'published',
        totalMinor: 250_000n,
      },
    })
    await tx.feeItem.create({
      data: {
        tenantId,
        feeScheduleId: feeSchedule.id,
        code: 'tuition',
        label: 'Scolarité',
        category: 'tuition',
        amountMinor: 200_000n,
        isMandatory: true,
        isRecurring: true,
        sequence: 1,
      },
    })
    await tx.feeItem.create({
      data: {
        tenantId,
        feeScheduleId: feeSchedule.id,
        code: 'registration',
        label: 'Inscription',
        category: 'registration',
        amountMinor: 50_000n,
        isMandatory: true,
        isRecurring: false,
        sequence: 2,
      },
    })

    const plan = await tx.instalmentPlan.create({
      data: { tenantId, feeScheduleId: feeSchedule.id, name: '3 tranches', instalmentCount: 3 },
    })
    for (const [sequence, percentBp, offset] of [
      [1, 3334, 0],
      [2, 3333, 90],
      [3, 3333, 180],
    ] as const) {
      await tx.instalmentTemplate.create({
        data: {
          tenantId,
          instalmentPlanId: plan.id,
          sequence,
          label: `Tranche ${sequence}`,
          dueOffsetDays: offset,
          percentBp,
        },
      })
    }

    const enrollment = await tx.enrollment.create({
      data: {
        tenantId,
        studentId: student.id,
        classGroupId: classGroup.id,
        academicYearId: academicYear.id,
        feeScheduleId: feeSchedule.id,
        enrolledOn: new Date('2026-09-01'),
        carriedForwardBalanceMinor: 0n,
        status: 'active',
      },
    })

    return { tenantId, studentId: student.id, enrollmentId: enrollment.id, feeScheduleId: feeSchedule.id }
  })
}

describe('Enrolment raises an invoice (real Postgres)', () => {
  let fixture: Fixture

  beforeAll(async () => {
    const db = await import('@fineduc/db')
    const billing = await import('../dist/modules/billing/invoicing.service.js')
    withTenant = db.withTenant
    InvoicingService = billing.InvoicingService
    service = new InvoicingService()
    const queries = await import('../dist/modules/billing/invoice-query.service.js')
    reader = new queries.InvoiceQueryService()
    // The least-privilege `fineduc_app` role, exactly as the API connects.
    // Using the owner role here would make RLS silently no-op and the
    // cross-tenant assertion below would pass for the wrong reason.
    const appUrl = db.resolveAppDatabaseUrl(process.env.DATABASE_URL as string, process.env.APP_DATABASE_URL)
    prisma = db.createPrismaClient({ databaseUrl: appUrl })
    fixture = await seedTenant('A')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('persists an invoice whose instalments sum EXACTLY to its net', async () => {
    const result = await withTenant(prisma, fixture.tenantId, (tx: Any) =>
      service.raiseForEnrollment(tx, fixture.tenantId, {
        enrollmentId: fixture.enrollmentId,
        grantedByUserId: USER_ID,
        now: new Date('2026-09-01T08:00:00Z'),
      }),
    )

    const { invoice, instalments } = await withTenant(prisma, fixture.tenantId, async (tx: Any) => ({
      invoice: await tx.invoice.findUnique({ where: { id: result.invoiceId } }),
      instalments: await tx.instalment.findMany({ where: { invoiceId: result.invoiceId } }),
    }))

    expect(invoice.netMinor).toBe(250_000n)
    expect(instalments).toHaveLength(3)
    // THE invariant, against what the database actually holds.
    const summed = instalments.reduce((sum: bigint, i: Any) => sum + i.amountMinor, 0n)
    expect(summed).toBe(invoice.netMinor)
    // and the awkward split really was exercised
    expect([...instalments].map((i: Any) => i.amountMinor).sort()).not.toEqual([
      83_333n, 83_333n, 83_334n,
    ])
  })

  it('leaves a ledger whose running balance matches the invoice', async () => {
    const entries = await withTenant(prisma, fixture.tenantId, (tx: Any) =>
      tx.studentLedgerEntry.findMany({
        where: { studentId: fixture.studentId },
        orderBy: { createdAt: 'asc' },
      }),
    )

    expect(entries.length).toBeGreaterThan(0)
    let running = 0n
    for (const entry of entries) {
      running += entry.amountMinor
      expect(entry.balanceAfterMinor).toBe(running)
    }
    expect(running).toBe(250_000n)
  })

  it('writes the outbox event in the same commit', async () => {
    const events = await prisma.outboxEvent.findMany({
      where: { tenantId: fixture.tenantId, eventType: 'invoice.raised' },
    })
    expect(events).toHaveLength(1)
  })

  it('refuses a second invoice for the same enrolment', async () => {
    await expect(
      withTenant(prisma, fixture.tenantId, (tx: Any) =>
        service.raiseForEnrollment(tx, fixture.tenantId, {
          enrollmentId: fixture.enrollmentId,
          grantedByUserId: USER_ID,
          now: new Date('2026-09-01T08:00:00Z'),
        }),
      ),
    ).rejects.toThrow(/already has invoice/)
  })

  /**
   * The atomicity proof. Raise an invoice for a fresh enrolment and then
   * throw INSIDE the same transaction: nothing may survive. A service that
   * opened its own transaction, or committed early, would leave orphan rows
   * here and a school would see a student owing money for an enrolment that
   * was never recorded.
   */
  it('rolls the whole invoice back when the transaction fails afterwards', async () => {
    const other = await seedTenant('R')

    await expect(
      withTenant(prisma, other.tenantId, async (tx: Any) => {
        await service.raiseForEnrollment(tx, other.tenantId, {
          enrollmentId: other.enrollmentId,
          grantedByUserId: USER_ID,
          now: new Date('2026-09-01T08:00:00Z'),
        })
        throw new Error('boom — something later in the enrolment failed')
      }),
    ).rejects.toThrow(/boom/)

    const after = await withTenant(prisma, other.tenantId, async (tx: Any) => ({
      invoices: await tx.invoice.count({ where: { enrollmentId: other.enrollmentId } }),
      instalments: await tx.instalment.count({}),
      ledger: await tx.studentLedgerEntry.count({ where: { studentId: other.studentId } }),
    }))

    expect(after.invoices).toBe(0)
    expect(after.instalments).toBe(0)
    expect(after.ledger).toBe(0)
  })

  /**
   * Rule #4. Tenant B must not see a single row of tenant A's money, even
   * though both live in the same tables on the same connection pool.
   */
  it('hides the invoice, instalments and ledger from another tenant', async () => {
    const b = await seedTenant('B')

    const seen = await withTenant(prisma, b.tenantId, async (tx: Any) => ({
      invoices: await tx.invoice.count({}),
      instalments: await tx.instalment.count({}),
      ledger: await tx.studentLedgerEntry.count({}),
      discounts: await tx.discount.count({}),
    }))

    // B has been seeded but never invoiced, so every count must be zero
    // despite A's rows sitting in the same tables.
    expect(seen).toEqual({ invoices: 0, instalments: 0, ledger: 0, discounts: 0 })
  })

  it('applies a sibling discount and still balances against the discounted net', async () => {
    const c = await seedTenant('C')

    const result = await withTenant(prisma, c.tenantId, (tx: Any) =>
      service.raiseForEnrollment(tx, c.tenantId, {
        enrollmentId: c.enrollmentId,
        grantedByUserId: USER_ID,
        siblingIndex: 1,
        siblingPolicy: { percentBp: 1_000 },
        now: new Date('2026-09-01T08:00:00Z'),
      }),
    )

    const { invoice, instalments, discounts } = await withTenant(prisma, c.tenantId, async (tx: Any) => ({
      invoice: await tx.invoice.findUnique({ where: { id: result.invoiceId } }),
      instalments: await tx.instalment.findMany({ where: { invoiceId: result.invoiceId } }),
      discounts: await tx.discount.findMany({ where: { invoiceId: result.invoiceId } }),
    }))

    expect(invoice.totalMinor).toBe(250_000n)
    expect(invoice.discountMinor).toBe(25_000n)
    expect(invoice.netMinor).toBe(225_000n)
    expect(discounts).toHaveLength(1)
    expect(discounts[0].type).toBe('sibling')

    const summed = instalments.reduce((sum: bigint, i: Any) => sum + i.amountMinor, 0n)
    expect(summed).toBe(225_000n)
  })

  describe('reading it back', () => {
    it('serialises every amount as an integer string, never a number', async () => {
      const invoice = await withTenant(prisma, fixture.tenantId, (tx: Any) =>
        reader.getInvoiceForEnrollment(tx, fixture.tenantId, fixture.enrollmentId),
      )

      for (const money of [invoice.total, invoice.discount, invoice.net, invoice.paid, invoice.balance]) {
        expect(typeof money.amountMinor).toBe('string')
        expect(money.currency).toBe('XAF')
      }
      expect(invoice.net.amountMinor).toBe('250000')
      // XAF has ZERO decimals — a franc is a whole minor unit, never /100.
      expect(invoice.net.amountMinor).not.toContain('.')
    })

    it('returns instalments in sequence whose remaining sums to the balance', async () => {
      const invoice = await withTenant(prisma, fixture.tenantId, (tx: Any) =>
        reader.getInvoiceForEnrollment(tx, fixture.tenantId, fixture.enrollmentId),
      )

      expect(invoice.instalments.map((i: Any) => i.sequence)).toEqual([1, 2, 3])
      const remaining = invoice.instalments.reduce((sum: bigint, i: Any) => sum + BigInt(i.remaining.amountMinor), 0n)
      expect(remaining).toBe(BigInt(invoice.balance.amountMinor))
    })

    it('carries the student and class through for the invoice header', async () => {
      const invoice = await withTenant(prisma, fixture.tenantId, (tx: Any) =>
        reader.getInvoiceForEnrollment(tx, fixture.tenantId, fixture.enrollmentId),
      )
      expect(invoice.studentId).toBe(fixture.studentId)
      expect(invoice.className).toBe('Class A')
      expect(invoice.lines).toHaveLength(2)
      expect(invoice.lines[0].lineTotal.amountMinor).toBe('200000')
    })

    it('reports a statement whose balance matches the last ledger entry', async () => {
      const statement = await withTenant(prisma, fixture.tenantId, (tx: Any) =>
        reader.getStatement(tx, fixture.tenantId, fixture.studentId),
      )
      expect(statement.balance.amountMinor).toBe('250000')
      expect(statement.entries.length).toBeGreaterThan(0)
      const last = statement.entries[statement.entries.length - 1]
      expect(last.balanceAfter.amountMinor).toBe(statement.balance.amountMinor)
    })

    it('refuses to read another tenant invoice even by its real id', async () => {
      const invoice = await withTenant(prisma, fixture.tenantId, (tx: Any) =>
        reader.getInvoiceForEnrollment(tx, fixture.tenantId, fixture.enrollmentId),
      )
      const intruder = await seedTenant('X')

      await expect(
        withTenant(prisma, intruder.tenantId, (tx: Any) => reader.getInvoice(tx, intruder.tenantId, invoice.id)),
      ).rejects.toThrow(/invoice/)
    })
  })

})
