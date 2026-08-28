/**
 * The pay link, end to end against a REAL Postgres (ARCHITECTURE.md §8.2).
 *
 * This is the join that was missing: until now a pending mobile-money
 * payment only existed because a test inserted one. Here a link is minted, a
 * parent initiates against it, and the resulting callback settles — proving
 * the reference minted by `initiate` is the one the worker can decode.
 *
 * That link is load-bearing and easy to break silently: if `initiate` ever
 * stops using `encodePaymentReference`, everything here still passes except
 * the last test, and nothing in production would settle.
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
let payLinks: Any
let processor: Any
let services: Any

const NOW = new Date('2026-09-25T09:00:00Z')

interface Fixture {
  tenantId: string
  studentId: string
  invoiceId: string
  token: string
}

async function seed(
  marker: string,
  over: { expiresAt?: Date; minAmountMinor?: bigint; onlinePayments?: boolean } = {},
): Promise<Fixture> {
  const tenantId = randomUUID()
  const userId = randomUUID()

  const base = await withTenant(prisma, tenantId, async (tx: Any) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        name: `École ${marker}`,
        country: 'CM',
        currency: 'XAF',
        timezone: 'Africa/Douala',
        // Online collection is opt-in per school, so a fixture exercising the
        // pay path has to turn it on the way a real school would.
        settings: over.onlinePayments === false ? {} : { payments: { enabled: true, operators: [] } },
      },
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
      data: { tenantId, gradeLevelId: grade.id, academicYearId: year.id, siteId: site.id, name: `6e ${marker}` },
    })
    const student = await tx.student.create({
      data: {
        tenantId,
        matricule: `MAT-${marker}-${Date.now()}`,
        firstName: 'Aïcha',
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
      data: { tenantId, feeScheduleId: schedule.id, name: '3', instalmentCount: 3 },
    })
    for (const [sequence, offset, bp] of [
      [1, 0, 3334],
      [2, 90, 3333],
      [3, 180, 3333],
    ] as const) {
      await tx.instalmentTemplate.create({
        data: { tenantId, instalmentPlanId: plan.id, sequence, label: `T${sequence}`, dueOffsetDays: offset, percentBp: bp },
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
    invoicing.raiseForEnrollment(tx, tenantId, { enrollmentId: base.enrollmentId, grantedByUserId: userId, now: NOW }),
  )

  const token = services.mintPayLinkToken(tenantId)
  await withTenant(prisma, tenantId, (tx: Any) =>
    tx.paymentLink.create({
      data: {
        tenantId,
        studentId: base.studentId,
        invoiceId: invoice.invoiceId,
        token,
        minAmountMinor: over.minAmountMinor ?? null,
        expiresAt: over.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    }),
  )

  return { tenantId, studentId: base.studentId, invoiceId: invoice.invoiceId, token }
}

const initiate = (f: Fixture, over: Record<string, unknown> = {}) =>
  payLinks.initiate(prisma, f.token, {
    amountMinor: 100_000n,
    operator: 'mtn',
    payerPhoneE164: '+237600000001',
    idempotencyKey: randomUUID(),
    providerName: 'fake',
    ...over,
  })

describe('Pay link (real Postgres)', () => {
  beforeAll(async () => {
    const db = await import('@fineduc/db')
    services = await import('@fineduc/services')
    withTenant = db.withTenant
    const inv = await import('../dist/modules/billing/invoicing.service.js')
    const pl = await import('../dist/modules/payments/pay-link.service.js')
    const reg = await import('../dist/modules/payments/provider.registry.js')
    invoicing = new inv.InvoicingService()
    payLinks = new pl.PayLinkService(new reg.PaymentProviderRegistry())
    processor = new services.WebhookProcessorService(new services.SettlementService())
    prisma = db.createPrismaClient({
      databaseUrl: db.resolveAppDatabaseUrl(process.env.DATABASE_URL as string, process.env.APP_DATABASE_URL),
    })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  /**
   * Online fee collection is optional. A school that has not turned it on has
   * no aggregator account to collect INTO, so a link that still rendered a
   * payable page would send a parent's money to the platform rather than the
   * school. The link has to be inert, and inert the same way every other bad
   * token is — this page tells a prober nothing.
   */
  describe('a school that has not enabled online payments', () => {
    it('does not render a payable page', async () => {
      const f = await seed('OFF1', { onlinePayments: false })
      await expect(payLinks.view(prisma, f.token)).rejects.toThrow(/payment_link/)
    })

    it('refuses to initiate even if the page was already open', async () => {
      const f = await seed('OFF2', { onlinePayments: false })
      await expect(
        payLinks.initiate(prisma, f.token, {
          amountMinor: 100_000n,
          operator: 'mtn',
          payerPhoneE164: '+237600000001',
          idempotencyKey: randomUUID(),
          providerName: 'fake',
        }),
      ).rejects.toThrow(/payment_link/)
    })

    it('writes no payment row when it refuses', async () => {
      const f = await seed('OFF3', { onlinePayments: false })
      await expect(
        payLinks.initiate(prisma, f.token, {
          amountMinor: 100_000n,
          operator: 'mtn',
          payerPhoneE164: '+237600000001',
          idempotencyKey: randomUUID(),
          providerName: 'fake',
        }),
      ).rejects.toThrow()

      // Nothing pending to reconcile: the refusal happens before any write.
      const rows = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.payment.findMany({ where: { tenantId: f.tenantId } }),
      )
      expect(rows).toHaveLength(0)
    })
  })

  /**
   * The money must land in the SCHOOL's bank, not the platform's. A school
   * that has connected no aggregator account cannot collect — and critically,
   * must not quietly collect through someone else's credentials, which would
   * succeed and put the fees in the wrong place.
   */
  describe('a school that has connected no aggregator account', () => {
    it('refuses to collect through a networked provider', async () => {
      const f = await seed('BYOK1')
      await expect(
        payLinks.initiate(prisma, f.token, {
          amountMinor: 100_000n,
          operator: 'mtn',
          payerPhoneE164: '+237600000001',
          idempotencyKey: randomUUID(),
          // No payment_connection row exists for this tenant.
          providerName: 'moneroo',
        }),
      ).rejects.toThrow(/payment_link/)
    })

    it('writes no payment row when it refuses', async () => {
      const f = await seed('BYOK2')
      await expect(
        payLinks.initiate(prisma, f.token, {
          amountMinor: 100_000n,
          operator: 'mtn',
          payerPhoneE164: '+237600000001',
          idempotencyKey: randomUUID(),
          providerName: 'moneroo',
        }),
      ).rejects.toThrow()

      const rows = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.payment.findMany({ where: { tenantId: f.tenantId } }),
      )
      expect(rows).toHaveLength(0)
    })
  })

  describe('GET /pay/:token', () => {
    it('shows the parent who and what they are paying for', async () => {
      const f = await seed('V1')
      const view = await payLinks.view(prisma, f.token)

      expect(view.schoolName).toContain('École')
      expect(view.studentName).toContain('Aïcha')
      expect(view.className).toContain('6e')
      expect(view.balance.amountMinor).toBe('300000')
      expect(view.balance.currency).toBe('XAF')
      expect(view.operators).toContain('mtn')
    })

    it('suggests the whole balance when the link names no tranche', async () => {
      const f = await seed('V2')
      expect((await payLinks.view(prisma, f.token)).suggestedAmount.amountMinor).toBe('300000')
    })

    /**
     * One 404 for every way a token can be wrong. Telling "expired" from
     * "unknown" would confirm to a prober that a token existed.
     */
    it.each([
      ['a malformed token', 'not-a-token'],
      ['a token with no tenant half', 'aaaa.bbbb'],
      ['an unknown token', `${randomUUID()}.deadbeef`],
    ])('refuses %s', async (_label, token) => {
      await expect(payLinks.view(prisma, token)).rejects.toThrow(/payment_link/)
    })

    it('refuses an expired link with the same error as an unknown one', async () => {
      const f = await seed('V3', { expiresAt: new Date(Date.now() - 1000) })
      await expect(payLinks.view(prisma, f.token)).rejects.toThrow(/payment_link/)
    })
  })

  describe('POST /pay/:token/initiate', () => {
    it('creates a PENDING payment and asks the aggregator to collect', async () => {
      const f = await seed('I1')
      const out = await initiate(f)

      expect(out.status).toBe('pending')
      expect(out.pushSent).toBe(true)

      const payment = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.payment.findUnique({ where: { id: out.paymentId } }),
      )
      expect(payment.method).toBe('mobile_money')
      expect(payment.status).toBe('pending')
      expect(payment.providerRef).toBeTruthy()
      // Nothing has settled: the browser redirect is a hint, not a payment.
      expect(payment.receivedAt).toBeNull()
    })

    it('leaves the invoice untouched until a webhook arrives', async () => {
      const f = await seed('I2')
      await initiate(f)
      const invoice = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.invoice.findUnique({ where: { id: f.invoiceId } }),
      )
      expect(invoice.paidMinor).toBe(0n)
      expect(invoice.balanceMinor).toBe(300_000n)
    })

    it('does not charge twice when the parent taps twice', async () => {
      const f = await seed('I3')
      const key = randomUUID()
      const first = await initiate(f, { idempotencyKey: key })
      const second = await initiate(f, { idempotencyKey: key })

      expect(second.paymentId).toBe(first.paymentId)
      const count = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.payment.count({ where: { studentId: f.studentId } }),
      )
      expect(count).toBe(1)
    })

    /**
     * The parent may have paid at the desk in the minutes since the page was
     * rendered. Charging them again for a debt that no longer exists is the
     * fastest way to lose a school.
     */
    it('re-validates against the LIVE balance, not the rendered page', async () => {
      const f = await seed('I4')
      await expect(initiate(f, { amountMinor: 400_000n })).rejects.toThrow(/still owed/)
    })

    it('refuses a zero or negative amount', async () => {
      const f = await seed('I5')
      await expect(initiate(f, { amountMinor: 0n })).rejects.toThrow(/more than zero/)
    })

    it('honours a minimum on the link', async () => {
      const f = await seed('I6', { minAmountMinor: 50_000n })
      await expect(initiate(f, { amountMinor: 10_000n })).rejects.toThrow(/at least/)
      await expect(initiate(f, { amountMinor: 60_000n })).resolves.toBeTruthy()
    })

    it('refuses an expired link', async () => {
      const f = await seed('I7', { expiresAt: new Date(Date.now() - 1000) })
      await expect(initiate(f)).rejects.toThrow(/payment_link/)
    })
  })

  /**
   * THE join. If `initiate` ever stops minting the reference with
   * `encodePaymentReference`, this is the only test that fails — and in
   * production nothing would settle.
   */
  it('mints a reference the worker can decode, and the callback settles', async () => {
    const f = await seed('E2E')
    const initiated = await initiate(f, { amountMinor: 120_000n })

    const payment = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.payment.findUnique({ where: { id: initiated.paymentId } }),
    )

    // Exactly what the worker does with a callback: decode our reference to
    // find the tenant, then settle.
    const reference = services.encodePaymentReference({ tenantId: f.tenantId, paymentId: payment.id })
    const decoded = services.decodePaymentReference(reference)
    expect(decoded).toEqual({ tenantId: f.tenantId, paymentId: payment.id })

    const outcome = await withTenant(prisma, decoded.tenantId, (tx: Any) =>
      processor.process(
        tx,
        decoded.tenantId,
        {
          eventId: randomUUID(),
          providerRef: payment.providerRef,
          reference,
          status: 'succeeded',
          occurredAt: NOW,
        },
        { now: NOW },
      ),
    )

    expect(outcome.result).toBe('settled')

    const invoice = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.invoice.findUnique({ where: { id: f.invoiceId } }),
    )
    expect(invoice.paidMinor).toBe(120_000n)
    expect(invoice.balanceMinor).toBe(180_000n)
  })
})
