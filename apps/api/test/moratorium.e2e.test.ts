/**
 * Le moratoire, against a REAL Postgres.
 *
 * Four of these are must-never-delete guarantees (AGENTS.md):
 *
 *   1. One moratoire per instalment, UNDER CONCURRENCY.
 *   2. `refusalFreesSlot` is honoured in BOTH configurations — it is the
 *      school's decision and getting it backwards either traps a family
 *      after one mistaken refusal or lets them ask until someone says yes.
 *   3. Never more than 21 days from the ORIGINAL due date, including via a
 *      bursar's hand-typed date.
 *   4. Every way of being wrong on `/moratoire/:token` is the same 404.
 *
 * The public endpoints are exercised over HTTP because they are public and
 * need no token minting. The staff paths call the service directly, the same
 * way `cash-payment` and `enrollment-invoice` do — there is still no helper
 * for authenticating over HTTP in this suite, so the authorisation MATRIX is
 * covered by the RolesGuard unit test rather than here. Said out loud rather
 * than left as a gap someone has to notice.
 */
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'

process.env.DATABASE_URL ??= 'postgresql://fineduc:fineduc@localhost:5432/fineduc'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.JWT_SECRET ??= 'test_only_jwt_secret_32_characters_min'
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)
process.env.PUBLIC_PAY_URL ??= 'https://pay.test'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

let app: INestApplication
let prisma: Any
let withTenant: Any
let service: Any
let mintTenantToken: Any

const NOW = new Date()

/**
 * Dates are RELATIVE to the real clock, not pinned to a fixed 2026.
 *
 * The controller calls `new Date()` — there is no injected clock at the HTTP
 * edge in this codebase — so a fixture with hard-coded dates silently drifts
 * out of the offer window and every assertion fails as `too_early`. Deriving
 * from today keeps the test honest about what the endpoint actually does.
 */
function plusDays(days: number): string {
  const base = new Date(`${todayInDouala()}T00:00:00Z`)
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}
function todayInDouala(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Douala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(NOW)
}

/** Fourteen days out: inside the default offer window, nothing overdue. */
const DUE_ON = plusDays(14)

interface Fixture {
  tenantId: string
  instalmentId: string
  guardianId: string
  studentId: string
  token: string
  userId: string
}

function policy(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    approval: 'manual',
    allowedDurationsDays: [7, 14, 21],
    offerFromDaysBeforeDue: 14,
    lateGraceDays: 7,
    refusalFreesSlot: true,
    ...over,
  }
}

async function seed(marker: string, moratoriumPolicy = policy()): Promise<Fixture> {
  const tenantId = randomUUID()
  const userId = randomUUID()

  return withTenant(prisma, tenantId, async (tx: Any) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        name: `École ${marker}`,
        country: 'CM',
        currency: 'XAF',
        timezone: 'Africa/Douala',
        settings: { moratorium: moratoriumPolicy },
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
        matricule: `M-${marker}-${Date.now()}`,
        firstName: 'Awa',
        lastName: `Nom${marker}`,
        sex: 'F',
        status: 'enrolled',
      },
    })
    const guardian = await tx.guardian.create({
      data: {
        tenantId,
        firstName: 'Marie',
        lastName: `Nom${marker}`,
        phoneE164: `+2376${String(Date.now()).slice(-8)}`,
        relationship: 'mother',
        preferredLocale: 'fr',
      },
    })
    await tx.studentGuardian.create({
      data: { tenantId, studentId: student.id, guardianId: guardian.id, isPrimary: true, paysFees: true },
    })
    const feeSchedule = await tx.feeSchedule.create({
      data: {
        tenantId,
        academicYearId: year.id,
        gradeLevelId: grade.id,
        name: `Grille ${marker}`,
        version: 1,
        effectiveFrom: new Date('2026-09-01'),
        status: 'published',
        totalMinor: 45_000n,
      },
    })
    const enrollment = await tx.enrollment.create({
      data: {
        tenantId,
        studentId: student.id,
        classGroupId: klass.id,
        academicYearId: year.id,
        feeScheduleId: feeSchedule.id,
        enrolledOn: new Date('2026-09-01'),
        carriedForwardBalanceMinor: 0n,
        status: 'active',
      },
    })
    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        enrollmentId: enrollment.id,
        number: `INV-${marker}-${Date.now()}`,
        issuedOn: new Date('2026-09-01'),
        totalMinor: 45_000n,
        discountMinor: 0n,
        netMinor: 45_000n,
        paidMinor: 0n,
        balanceMinor: 45_000n,
        status: 'open',
      },
    })
    const instalment = await tx.instalment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        sequence: 1,
        label: 'Tranche 1',
        dueOn: new Date(DUE_ON),
        amountMinor: 45_000n,
        allocatedMinor: 0n,
        status: 'pending',
      },
    })
    const token = mintTenantToken(tenantId)
    await tx.moratoriumChatLink.create({
      data: {
        tenantId,
        instalmentId: instalment.id,
        studentId: student.id,
        guardianId: guardian.id,
        token,
        expiresAt: new Date(`${plusDays(60)}T22:59:00Z`),
      },
    })

    return { tenantId, instalmentId: instalment.id, guardianId: guardian.id, studentId: student.id, token, userId }
  })
}

const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  durationDays: 14,
  idempotencyKey: randomUUID(),
  ...over,
})

describe('Le moratoire (real Postgres)', () => {
  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing')
    const { AppModule } = await import('../dist/app.module.js')
    const db = await import('@fineduc/db')
    const services = await import('@fineduc/services')
    const { MoratoriumService } = await import('../dist/modules/messaging/moratorium.service.js')

    prisma = db.createPrismaClient({ databaseUrl: db.resolveAppDatabaseUrl(process.env.DATABASE_URL as string) })
    withTenant = db.withTenant
    mintTenantToken = services.mintTenantToken
    service = new MoratoriumService(new services.ReminderSchedulingService())

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    await app.init()
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await prisma?.$disconnect()
  })

  describe('GET /moratoire/:token', () => {
    it('shows the parent what they owe and what they can ask for', async () => {
      const f = await seed('A')
      const response = await request(app.getHttpServer()).get(`/moratoire/${f.token}`).expect(200)

      expect(response.body.schoolName).toBe('École A')
      expect(response.body.instalmentLabel).toBe('Tranche 1')
      expect(response.body.amountDue).toEqual({ amountMinor: '45000', currency: 'XAF' })
      expect(response.body.approvalMode).toBe('manual')
      expect(response.body.offer.available).toBe(true)
      expect(response.body.offer.options.map((o: Any) => o.days)).toEqual([7, 14, 21])
      // Every button carries the date it leads to, computed server-side.
      expect(response.body.offer.options.map((o: Any) => o.deferredDueOn)).toEqual([
        plusDays(14 + 7),
        plusDays(14 + 14),
        plusDays(14 + 21),
      ])
    })

    /**
     * The link reaches whoever holds the SIM, and numbers get reassigned.
     * A first name is enough for a parent to recognise their child and not
     * enough for a stranger to learn anything (AGENTS.md rule #11).
     */
    it('names the student by FIRST NAME only, and never the matricule or a phone', async () => {
      const f = await seed('B')
      const response = await request(app.getHttpServer()).get(`/moratoire/${f.token}`).expect(200)

      const serialised = JSON.stringify(response.body)
      expect(response.body.studentFirstName).toBe('Awa')
      expect(serialised).not.toContain('NomB')
      expect(serialised).not.toContain('M-B-')
      expect(serialised).not.toContain('+2376')
    })

    /**
     * MUST NEVER BE DELETED. Distinguishing these would confirm which schools
     * and which links exist to anyone willing to probe.
     */
    it('returns the SAME 404 for every way of being wrong', async () => {
      const f = await seed('C')
      const other = await seed('D')

      const cases: Array<[string, string]> = [
        ['malformed', 'not-a-token'],
        ['no secret half', `${f.tenantId}.`],
        ['unknown but well-formed', mintTenantToken(f.tenantId)],
        ['a real token for another tenant, against this one', other.token.replace(other.tenantId, f.tenantId)],
        ['a tenant id that is not a uuid', 'abc.def'],
      ]

      const bodies: string[] = []
      for (const [, token] of cases) {
        const response = await request(app.getHttpServer()).get(`/moratoire/${token}`).expect(404)
        bodies.push(JSON.stringify({ ...response.body, traceId: undefined }))
      }
      // Byte-identical: not merely "all 404", but indistinguishable.
      expect(new Set(bodies).size).toBe(1)
    })

    it('404s once the link has expired', async () => {
      const f = await seed('E')
      await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.moratoriumChatLink.updateMany({
          where: { tenantId: f.tenantId },
          data: { expiresAt: new Date('2020-01-01T00:00:00Z') },
        }),
      )
      await request(app.getHttpServer()).get(`/moratoire/${f.token}`).expect(404)
    })

    /**
     * The deliberate exception to the 404 rule. Once the 256-bit secret has
     * checked out, the page may say why there is nothing on offer — sending a
     * parent to the secretary over a tranche they already paid is worse than
     * the nothing it protects.
     */
    it('answers 200 with a reason when the tranche is already settled', async () => {
      const f = await seed('F')
      await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.instalment.update({ where: { id: f.instalmentId }, data: { allocatedMinor: 45_000n, status: 'paid' } }),
      )

      const response = await request(app.getHttpServer()).get(`/moratoire/${f.token}`).expect(200)
      expect(response.body.offer.available).toBe(false)
      expect(response.body.offer.reason).toBe('settled')
    })

    it('offers nothing when the school has not switched the feature on', async () => {
      const f = await seed('G', policy({ enabled: false }))
      const response = await request(app.getHttpServer()).get(`/moratoire/${f.token}`).expect(200)
      expect(response.body.offer).toMatchObject({ available: false, reason: 'disabled' })
    })
  })

  describe('POST /moratoire/:token/request', () => {
    it('queues the request when the school approves by hand', async () => {
      const f = await seed('H')
      const response = await request(app.getHttpServer())
        .post(`/moratoire/${f.token}/request`)
        .send(body({ durationDays: 14 }))
        .expect(201)

      expect(response.body.status).toBe('pending')
      expect(response.body.deferredDueOn).toBe(plusDays(14 + 14))
    })

    it('grants on the spot when the school has chosen auto', async () => {
      const f = await seed('I', policy({ approval: 'auto' }))
      const response = await request(app.getHttpServer())
        .post(`/moratoire/${f.token}/request`)
        .send(body({ durationDays: 21 }))
        .expect(201)

      expect(response.body.status).toBe('granted')
      expect(response.body.deferredDueOn).toBe(plusDays(14 + 21))
    })

    /**
     * MUST NEVER BE DELETED. Two taps on a 2G connection is the NORMAL case,
     * not an edge one, and the answer to the second must be the answer to the
     * first — not a 409, and not a second row.
     */
    it('creates ONE moratoire when two requests race', async () => {
      const f = await seed('J')

      // Two DIFFERENT keys: two genuine requests arriving together, e.g. both
      // parents of the same child tapping the link at once. (A double tap by
      // one parent replays a single key — covered by the next test.)
      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body({ durationDays: 7 })),
        request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body({ durationDays: 21 })),
      ])

      // Neither errors. The partial unique index decides, not a 500.
      expect(a.status).toBe(201)
      expect(b.status).toBe(201)

      const rows = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.moratorium.findMany({ where: { tenantId: f.tenantId } }),
      )
      expect(rows).toHaveLength(1)

      /*
       * The loser gets one of exactly two coherent answers, depending on
       * whether it lost to the constraint or merely read after the winner
       * committed: the winner's outcome, or a clean `already_used`. What it
       * must never get is a 500 or a second row — both asserted above.
       */
      const outcomes = [a.body, b.body]
      const accepted = outcomes.filter((o: Any) => o.status !== 'rejected')
      expect(accepted.length).toBeGreaterThanOrEqual(1)
      for (const rejected of outcomes.filter((o: Any) => o.status === 'rejected')) {
        expect(rejected.reason).toBe('already_used')
      }
      const stored = rows[0]
      for (const ok of accepted) {
        expect(ok.deferredDueOn).toBe(stored.deferredDueOn.toISOString().slice(0, 10))
      }
    })

    it('a replayed request returns the first answer, not an error', async () => {
      const f = await seed('K')
      const payload = body({ durationDays: 7 })

      const first = await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(payload).expect(201)
      const replay = await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(payload).expect(201)

      expect(replay.body.deferredDueOn).toBe(first.body.deferredDueOn)
    })

    /** MUST NEVER BE DELETED: the cap is not negotiable from the outside. */
    it('rejects a duration past three weeks at the boundary', async () => {
      const f = await seed('L')
      await request(app.getHttpServer())
        .post(`/moratoire/${f.token}/request`)
        .send(body({ durationDays: 28 }))
        // 422, not 400: a Zod failure at the boundary is a validation problem
        // in RFC 9457 terms, and ProblemJsonFilter maps it that way.
        .expect(422)
    })

    it('rejects a duration this school does not offer', async () => {
      const f = await seed('M', policy({ allowedDurationsDays: [7] }))
      const response = await request(app.getHttpServer())
        .post(`/moratoire/${f.token}/request`)
        .send(body({ durationDays: 21 }))
        .expect(201)

      expect(response.body.status).toBe('rejected')
    })

    it('refuses to act on a token that is not ours', async () => {
      await request(app.getHttpServer()).post('/moratoire/nonsense/request').send(body()).expect(404)
    })
  })

  describe('the school decides', () => {
    /**
     * MUST NEVER BE DELETED — and BOTH halves. This is the setting a director
     * will actually change, and getting it backwards either traps a family
     * after one mistaken refusal or lets them ask until someone says yes.
     */
    it('a refusal FREES the slot when the school allows a second attempt', async () => {
      const f = await seed('N', policy({ refusalFreesSlot: true }))
      const first = await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body()).expect(201)
      void first

      const row = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.moratorium.findFirstOrThrow({ where: { tenantId: f.tenantId } }),
      )
      await withTenant(prisma, f.tenantId, (tx: Any) =>
        service.decline(tx, f.tenantId, row.id, 'refuse', 'Deux reports déjà cette année.', f.userId, NOW),
      )

      const again = await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body()).expect(201)
      expect(again.body.status).toBe('pending')
    })

    it('a refusal BURNS the attempt when the school does not', async () => {
      const f = await seed('O', policy({ refusalFreesSlot: false }))
      await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body()).expect(201)

      const row = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.moratorium.findFirstOrThrow({ where: { tenantId: f.tenantId } }),
      )
      await withTenant(prisma, f.tenantId, (tx: Any) =>
        service.decline(tx, f.tenantId, row.id, 'refuse', 'Non.', f.userId, NOW),
      )

      const again = await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body()).expect(201)
      expect(again.body).toMatchObject({ status: 'rejected', reason: 'already_used', mayAskAgain: false })
    })

    it('approving a pending request grants it and records who decided', async () => {
      const f = await seed('P')
      await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body({ durationDays: 14 })).expect(201)

      const row = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.moratorium.findFirstOrThrow({ where: { tenantId: f.tenantId } }),
      )
      const result = await withTenant(prisma, f.tenantId, (tx: Any) =>
        service.approve(tx, f.tenantId, row.id, { note: 'Accordé' }, f.userId, NOW),
      )

      expect(result.status).toBe('granted')
      const after = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.moratorium.findUniqueOrThrow({ where: { id: row.id } }),
      )
      expect(after.decidedBy).toBe(f.userId)
      expect(after.decidedAt).not.toBeNull()
    })

    /**
     * MUST NEVER BE DELETED. A staff field is exactly where a 21-day rule
     * gets worked around one keystroke at a time.
     */
    it('a bursar cannot hand-type a date past the cap', async () => {
      const f = await seed('Q')
      await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body()).expect(201)
      const row = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.moratorium.findFirstOrThrow({ where: { tenantId: f.tenantId } }),
      )

      await expect(
        withTenant(prisma, f.tenantId, (tx: Any) =>
          // One day past the cap.
          service.approve(tx, f.tenantId, row.id, { deferredDueOn: plusDays(14 + 22) }, f.userId, NOW),
        ),
      ).rejects.toThrow(/moratoire cannot run past/)
    })

    it('a bursar CAN shorten a delay', async () => {
      const f = await seed('R')
      await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body({ durationDays: 21 })).expect(201)
      const row = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.moratorium.findFirstOrThrow({ where: { tenantId: f.tenantId } }),
      )

      const result = await withTenant(prisma, f.tenantId, (tx: Any) =>
        service.approve(tx, f.tenantId, row.id, { deferredDueOn: plusDays(14 + 7) }, f.userId, NOW),
      )
      expect(result.deferredDueOn).toBe(plusDays(14 + 7))
    })

    it('refuses to approve something already decided', async () => {
      const f = await seed('S', policy({ approval: 'auto' }))
      await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body()).expect(201)
      const row = await withTenant(prisma, f.tenantId, (tx: Any) =>
        tx.moratorium.findFirstOrThrow({ where: { tenantId: f.tenantId } }),
      )

      await expect(
        withTenant(prisma, f.tenantId, (tx: Any) => service.approve(tx, f.tenantId, row.id, {}, f.userId, NOW)),
      ).rejects.toThrow(/already granted/)
    })

    it('writes an outbox row for every decision, in the business transaction', async () => {
      const f = await seed('T', policy({ approval: 'auto' }))
      await request(app.getHttpServer()).post(`/moratoire/${f.token}/request`).send(body()).expect(201)

      const events = await prisma.outboxEvent.findMany({
        where: { tenantId: f.tenantId, aggregateType: 'moratorium' },
      })
      expect(events).toHaveLength(1)
      expect(events[0].eventType).toBe('moratorium.granted')
    })
  })

  describe('tenant isolation', () => {
    it('one school never sees another school\'s moratoires', async () => {
      const a = await seed('U', policy({ approval: 'auto' }))
      const b = await seed('V', policy({ approval: 'auto' }))
      await request(app.getHttpServer()).post(`/moratoire/${a.token}/request`).send(body()).expect(201)
      await request(app.getHttpServer()).post(`/moratoire/${b.token}/request`).send(body()).expect(201)

      const seenByA = await withTenant(prisma, a.tenantId, (tx: Any) => service.list(tx, a.tenantId, {}))
      expect(seenByA).toHaveLength(1)
      expect(seenByA[0].studentId).toBe(a.studentId)
    })

    it('a moratoire id from another school is a 404, not a 403', async () => {
      const a = await seed('W', policy({ approval: 'auto' }))
      const b = await seed('X', policy({ approval: 'auto' }))
      await request(app.getHttpServer()).post(`/moratoire/${b.token}/request`).send(body()).expect(201)
      const bRow = await withTenant(prisma, b.tenantId, (tx: Any) =>
        tx.moratorium.findFirstOrThrow({ where: { tenantId: b.tenantId } }),
      )

      await expect(
        withTenant(prisma, a.tenantId, (tx: Any) => service.approve(tx, a.tenantId, bRow.id, {}, a.userId, NOW)),
      ).rejects.toThrow(/not found/i)
    })
  })
})
