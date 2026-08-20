/**
 * The worker's first tests, against a REAL Postgres.
 *
 * These exist because of a specific failure. `processWebhookJob` once passed
 * an empty tenant id straight into `withTenant`, which rejects a non-uuid —
 * meaning no mobile-money webhook could ever have settled. Every service it
 * calls was well tested; the WIRING was not, because it was welded to a
 * BullMQ Worker and nothing could reach it.
 *
 * So the handler is tested here directly, with no Redis. What is proven:
 *
 *   1. A callback with an unresolvable reference FAILS LOUDLY rather than
 *      settling against a guessed tenant.
 *   2. `processed_at` is set only AFTER settlement commits — marking first
 *      would let a retry skip money that never moved.
 *   3. The handler is idempotent across retries, which BullMQ will do.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

process.env.DATABASE_URL ??= 'postgresql://fineduc:fineduc@localhost:5432/fineduc'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.JWT_SECRET ??= 'test_only_jwt_secret_32_characters_min'
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

let prisma: Any
let withTenant: Any
let services: Any
let processWebhookJob: Any
let handlerDeps: Any
let warnings: string[]

const NOW = new Date('2026-09-28T10:00:00Z')

interface Fixture {
  tenantId: string
  paymentId: string
  invoiceId: string
  providerRef: string
}

/** A tenant with an invoice and a pending mobile-money payment. */
async function seed(marker: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const userId = randomUUID()
  const { InvoicingService } = await import('../../api/dist/modules/billing/invoicing.service.js')

  const base = await withTenant(prisma, tenantId, async (tx: Any) => {
    await tx.tenant.create({
      data: { id: tenantId, name: `W ${marker}`, country: 'CM', currency: 'XAF', timezone: 'Africa/Douala' },
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
        matricule: `W-${marker}-${Date.now()}`,
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

  const invoicing = new InvoicingService()
  const invoice = await withTenant(prisma, tenantId, (tx: Any) =>
    invoicing.raiseForEnrollment(tx, tenantId, { enrollmentId: base.enrollmentId, grantedByUserId: userId, now: NOW }),
  )

  const providerRef = `fake_W-${marker}-${Date.now()}`
  const payment = await withTenant(prisma, tenantId, (tx: Any) =>
    tx.payment.create({
      data: {
        tenantId,
        studentId: base.studentId,
        invoiceId: invoice.invoiceId,
        method: 'mobile_money',
        amountMinor: 90_000n,
        currency: 'XAF',
        status: 'pending',
        provider: 'fake',
        providerRef,
        idempotencyKey: randomUUID(),
      },
    }),
  )

  return { tenantId, paymentId: payment.id, invoiceId: invoice.invoiceId, providerRef }
}

/** Store a raw callback exactly as the ingest endpoint would. */
async function storeEvent(f: Fixture, over: Record<string, unknown> = {}): Promise<string> {
  const stored = await prisma.providerEvent.create({
    data: {
      provider: 'fake',
      eventId: `evt_${randomUUID()}`,
      eventType: 'succeeded',
      signatureValid: true,
      payload: {
        event_id: `evt_${randomUUID()}`,
        provider_ref: f.providerRef,
        reference: services.encodePaymentReference({ tenantId: f.tenantId, paymentId: f.paymentId }),
        status: 'succeeded',
        amount_minor: '90000',
        currency: 'XAF',
        occurred_at: NOW.toISOString(),
        ...over,
      },
      receivedAt: NOW,
    },
  })
  return stored.id
}

const run = (providerEventId: string) =>
  processWebhookJob(handlerDeps, { providerEventId, provider: 'fake', requestId: 'test' })

describe('webhook-processor job (real Postgres)', () => {
  beforeAll(async () => {
    const db = await import('@fineduc/db')
    const providers = await import('@fineduc/providers')
    services = await import('@fineduc/services')
    const job = await import('../dist/jobs/webhook-processor.js')
    withTenant = db.withTenant
    processWebhookJob = job.processWebhookJob

    prisma = db.createPrismaClient({
      databaseUrl: db.resolveAppDatabaseUrl(process.env.DATABASE_URL as string, process.env.APP_DATABASE_URL),
    })

    warnings = []
    handlerDeps = {
      prisma,
      resolveProvider: () => new providers.FakePaymentProvider(),
      processor: new services.WebhookProcessorService(new services.SettlementService()),
      logger: {
        warn: (m: string) => warnings.push(m),
        error: (m: string) => warnings.push(m),
        log: () => {},
      },
      now: () => NOW,
    }
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('settles a stored callback end to end', async () => {
    const f = await seed('S1')
    const outcome = await run(await storeEvent(f))

    expect(outcome.result).toBe('settled')

    const invoice = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.invoice.findUnique({ where: { id: f.invoiceId } }),
    )
    expect(invoice.paidMinor).toBe(90_000n)
  })

  it('marks the event processed only after settlement', async () => {
    const f = await seed('S2')
    const eventId = await storeEvent(f)

    const before = await prisma.providerEvent.findUnique({ where: { id: eventId } })
    expect(before.processedAt).toBeNull()

    await run(eventId)

    const after = await prisma.providerEvent.findUnique({ where: { id: eventId } })
    expect(after.processedAt).not.toBeNull()
    expect(after.attempts).toBe(1)
  })

  /**
   * THE regression. The handler used to receive an empty tenant id and hand
   * it to withTenant, which rejects a non-uuid. Nothing settled, and no test
   * could see it because the handler was welded to a queue.
   */
  it('fails LOUDLY when the reference cannot be attributed to a tenant', async () => {
    const f = await seed('S3')
    const eventId = await storeEvent(f, { reference: 'SOMEONE_ELSES_REF' })

    await expect(run(eventId)).rejects.toThrow(/Cannot resolve a tenant/)

    // Nothing was settled and nothing was marked done: the job belongs in the
    // dead letter queue with an alert, not silently dropped.
    const [event, invoice] = await Promise.all([
      prisma.providerEvent.findUnique({ where: { id: eventId } }),
      withTenant(prisma, f.tenantId, (tx: Any) => tx.invoice.findUnique({ where: { id: f.invoiceId } })),
    ])
    expect(event.processedAt).toBeNull()
    expect(invoice.paidMinor).toBe(0n)
  })

  it('fails loudly when the reference is missing entirely', async () => {
    const f = await seed('S4')
    const eventId = await storeEvent(f, { reference: undefined })
    await expect(run(eventId)).rejects.toThrow(/Cannot resolve a tenant/)
  })

  /** BullMQ retries. A second run must not settle a second time. */
  it('is idempotent across a retry', async () => {
    const f = await seed('S5')
    const eventId = await storeEvent(f)

    await run(eventId)
    const second = await run(eventId)

    expect(second.result).toBe('already_processed')

    const invoice = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.invoice.findUnique({ where: { id: f.invoiceId } }),
    )
    expect(invoice.paidMinor).toBe(90_000n)
  })

  it('drops a job whose event row is gone, rather than retrying forever', async () => {
    const outcome = await run(randomUUID())
    expect(outcome.result).toBe('missing')
    expect(warnings.some((w) => w.includes('not found'))).toBe(true)
  })

  it('lets an unknown provider fail rather than guessing one', async () => {
    const f = await seed('S6')
    const eventId = await storeEvent(f)
    const deps = {
      ...handlerDeps,
      resolveProvider: vi.fn(() => {
        throw new Error('No payment provider registered as "mystery"')
      }),
    }
    await expect(
      processWebhookJob(deps, { providerEventId: eventId, provider: 'mystery', requestId: 'test' }),
    ).rejects.toThrow(/No payment provider registered/)
  })
})
