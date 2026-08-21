/**
 * The reminder path end to end, against a REAL Postgres.
 *
 * Two of these are guarantees AGENTS.md lists as must-never-delete, and one
 * of them — "a reminder is not sent for an instalment paid between scheduling
 * and sending" — has been owed since phase 7. It is the reason the whole
 * scheduler/sender split exists, so it is tested against the real database
 * rather than against the pure function that decides it.
 *
 * Both jobs are exercised through their PLAIN HANDLER functions, with no
 * Redis. That is the `webhook-processor` lesson applied: a job body welded
 * inside a BullMQ Worker is untested by construction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

process.env.DATABASE_URL ??= 'postgresql://fineduc:fineduc@localhost:5432/fineduc'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.JWT_SECRET ??= 'test_only_jwt_secret_32_characters_min'
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)
process.env.PUBLIC_PAY_URL ??= 'https://pay.test'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

let prisma: Any
let withTenant: Any
let runReminderScheduler: Any
let runMessageSender: Any
let ReminderSchedulingService: Any
let FakeMessagingProvider: Any

/** 2026-09-01 in Africa/Douala (UTC+1) — fourteen days before the tranche. */
const NOW = new Date('2026-09-01T10:00:00Z')
const DUE_ON = '2026-09-15'

interface Fixture {
  tenantId: string
  instalmentId: string
  guardianId: string
  studentId: string
  ruleIds: { j14: string; endJ7: string; endEve: string }
}

const MORATORIUM_POLICY = {
  enabled: true,
  approval: 'manual',
  allowedDurationsDays: [7, 14, 21],
  offerFromDaysBeforeDue: 14,
  lateGraceDays: 7,
  refusalFreesSlot: true,
}

async function seed(marker: string, over: { credits?: bigint } = {}): Promise<Fixture> {
  const tenantId = randomUUID()

  return withTenant(prisma, tenantId, async (tx: Any) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        name: `R ${marker}`,
        country: 'CM',
        currency: 'XAF',
        timezone: 'Africa/Douala',
        settings: {
          messaging: { sendHour: 9, quietHours: { startHour: 7, endHour: 20 }, guardianDailyCap: 5, tenantDailyCap: 500 },
          moratorium: MORATORIUM_POLICY,
        },
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
      data: { tenantId, gradeLevelId: grade.id, academicYearId: year.id, siteId: site.id, name: `C${marker}` },
    })
    const student = await tx.student.create({
      data: {
        tenantId,
        matricule: `R-${marker}-${Date.now()}`,
        firstName: 'Awa',
        lastName: marker,
        sex: 'F',
        status: 'enrolled',
      },
    })
    const guardian = await tx.guardian.create({
      data: {
        tenantId,
        firstName: 'Marie',
        lastName: marker,
        phoneE164: `+2376${String(Date.now()).slice(-8)}`,
        relationship: 'mother',
        preferredChannel: 'whatsapp',
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

    for (const [code, body] of [
      ['reminder_j14_moratoire', 'La {{tranche}} de {{eleve}} ({{montant}}) est due le {{echeance}}. Delai : {{lien_moratoire}}'],
      ['moratorium_end_j7', 'Le delai pour la {{tranche}} de {{eleve}} se termine le {{echeance}}.'],
      ['moratorium_end_eve', 'Le delai pour la {{tranche}} de {{eleve}} se termine demain {{echeance}}.'],
    ] as const) {
      await tx.messageTemplate.create({
        data: { tenantId, code, channel: 'whatsapp', locale: 'fr', body, variables: [] },
      })
    }

    const j14 = await tx.reminderRule.create({
      data: { tenantId, name: 'J-14', offsetDays: -14, basis: 'due_date', channel: 'whatsapp', templateCode: 'reminder_j14_moratoire' },
    })
    const endJ7 = await tx.reminderRule.create({
      data: { tenantId, name: 'Fin J-7', offsetDays: -7, basis: 'moratorium_end', channel: 'whatsapp', templateCode: 'moratorium_end_j7' },
    })
    const endEve = await tx.reminderRule.create({
      data: { tenantId, name: 'Fin veille', offsetDays: -1, basis: 'moratorium_end', channel: 'whatsapp', templateCode: 'moratorium_end_eve' },
    })

    await tx.messageCreditLedgerEntry.create({
      data: {
        tenantId,
        entryType: 'topup',
        amountMinor: over.credits ?? 20_000n,
        balanceAfterMinor: over.credits ?? 20_000n,
      },
    })

    return {
      tenantId,
      instalmentId: instalment.id,
      guardianId: guardian.id,
      studentId: student.id,
      ruleIds: { j14: j14.id, endJ7: endJ7.id, endEve: endEve.id },
    }
  })
}

async function grantMoratorium(f: Fixture, days: number, decidedAt: Date): Promise<void> {
  const deferred = new Date(new Date(DUE_ON).getTime() + days * 86_400_000)
  await withTenant(prisma, f.tenantId, (tx: Any) =>
    tx.moratorium.create({
      data: {
        tenantId: f.tenantId,
        instalmentId: f.instalmentId,
        studentId: f.studentId,
        guardianId: f.guardianId,
        status: 'granted',
        source: 'chatbot',
        requestedDays: days,
        originalDueOn: new Date(DUE_ON),
        deferredDueOn: deferred,
        decidedAt,
      },
    }),
  )
}

async function schedules(f: Fixture): Promise<Any[]> {
  return withTenant(prisma, f.tenantId, (tx: Any) =>
    tx.reminderSchedule.findMany({ where: { tenantId: f.tenantId }, orderBy: { scheduledFor: 'asc' } }),
  )
}

function schedulerDeps(now: Date, logger?: Any): Any {
  return {
    prisma,
    scheduling: new ReminderSchedulingService(),
    logger: logger ?? { log: () => {}, warn: () => {}, error: () => {} },
    now: () => now,
  }
}

function senderDeps(now: Date, provider: Any, logger?: Any): Any {
  return {
    prisma,
    resolveProvider: () => provider,
    logger: logger ?? { log: () => {}, warn: () => {}, error: () => {} },
    now: () => now,
    publicPayUrl: 'https://pay.test',
  }
}

describe('the reminder path (real Postgres)', () => {
  beforeAll(async () => {
    const db = await import('@fineduc/db')
    const services = await import('@fineduc/services')
    const providers = await import('@fineduc/providers')
    const scheduler = await import('../dist/jobs/reminder-scheduler.js')
    const sender = await import('../dist/jobs/message-sender.js')

    prisma = db.createPrismaClient({ databaseUrl: db.resolveAppDatabaseUrl(process.env.DATABASE_URL as string) })
    withTenant = db.withTenant
    ReminderSchedulingService = services.ReminderSchedulingService
    FakeMessagingProvider = providers.FakeMessagingProvider
    runReminderScheduler = scheduler.runReminderScheduler
    runMessageSender = sender.runMessageSender
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('materialises the fourteen-day reminder for every fee-paying guardian', async () => {
    const f = await seed('A')

    const result = await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    expect(result.created).toBe(1)
    const rows = await schedules(f)
    expect(rows).toHaveLength(1)
    expect(rows[0].reminderRuleId).toBe(f.ruleIds.j14)
    // 09:00 local in Douala (UTC+1) on the day the rule lands.
    expect(rows[0].scheduledFor.toISOString()).toBe('2026-09-01T08:00:00.000Z')
  })

  it('is re-runnable: a second sweep creates nothing', async () => {
    const f = await seed('B')
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })
    const second = await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    expect(second.created).toBe(0)
    expect(await schedules(f)).toHaveLength(1)
  })

  it('sends the reminder, embeds a working moratoire link, and debits the wallet', async () => {
    const f = await seed('C')
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    const provider = new FakeMessagingProvider()
    const result = await runMessageSender(senderDeps(NOW, provider), { tenantId: f.tenantId, requestId: 'r' })

    expect(result.sent).toBe(1)
    expect(provider.outbox).toHaveLength(1)

    const body = provider.outbox[0].body
    expect(body).toContain('Tranche 1')
    expect(body).toContain('Awa')
    // No unresolved placeholder ever reaches a family.
    expect(body).not.toContain('{{')

    const link = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.moratoriumChatLink.findFirst({ where: { tenantId: f.tenantId } }),
    )
    expect(link).not.toBeNull()
    expect(body).toContain(`https://pay.test/moratoire/${link.token}`)
    // The token carries the tenant, which is what lets a public page open an
    // RLS context with no JWT.
    expect(link.token.startsWith(`${f.tenantId}.`)).toBe(true)

    const credits = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.messageCreditLedgerEntry.findFirst({ where: { tenantId: f.tenantId }, orderBy: { createdAt: 'desc' } }),
    )
    expect(credits.entryType).toBe('debit')
    expect(credits.balanceAfterMinor).toBe(19_990n) // 20 000 − 10 XAF for WhatsApp
  })

  /**
   * MUST NEVER BE DELETED (AGENTS.md).
   *
   * The single reason the scheduler and the sender are separate processes.
   * The schedule row was materialised when money was owed; by the time the
   * sender reaches it the family has paid. Chasing them anyway is, in
   * ARCHITECTURE's words, the fastest way to lose a school.
   */
  it('does NOT send for an instalment paid between scheduling and sending', async () => {
    const f = await seed('D')
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    // The family pays.
    await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.instalment.update({
        where: { id: f.instalmentId },
        data: { allocatedMinor: 45_000n, status: 'paid' },
      }),
    )

    const provider = new FakeMessagingProvider()
    const result = await runMessageSender(senderDeps(NOW, provider), { tenantId: f.tenantId, requestId: 'r' })

    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect(provider.outbox).toHaveLength(0)

    const rows = await schedules(f)
    expect(rows[0].status).toBe('skipped')
    expect(rows[0].skipReason).toBe('settled')

    // And not one franc of credit spent on it.
    const messages = await withTenant(prisma, f.tenantId, (tx: Any) => tx.message.findMany({ where: { tenantId: f.tenantId } }))
    expect(messages).toHaveLength(0)
  })

  /**
   * MUST NEVER BE DELETED.
   *
   * Chasing a family for a date the school itself moved is only marginally
   * better than chasing one who has already paid.
   */
  it('a granted moratoire silences the ordinary ladder and schedules the end reminders', async () => {
    const f = await seed('E')
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })
    await grantMoratorium(f, 21, NOW)

    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    const rows = await schedules(f)
    const byRule = new Map(rows.map((row: Any) => [row.reminderRuleId, row]))

    expect(byRule.get(f.ruleIds.j14).status).toBe('cancelled')
    expect(byRule.get(f.ruleIds.j14).skipReason).toBe('moratorium_granted')
    // Deferred to 2026-10-06, so J-7 is 09-29 and the eve is 10-05.
    expect(byRule.get(f.ruleIds.endJ7).status).toBe('scheduled')
    expect(byRule.get(f.ruleIds.endJ7).scheduledFor.toISOString()).toBe('2026-09-29T08:00:00.000Z')
    expect(byRule.get(f.ruleIds.endEve).scheduledFor.toISOString()).toBe('2026-10-05T08:00:00.000Z')

    // And the sender agrees, independently of what the scheduler decided.
    const provider = new FakeMessagingProvider()
    const result = await runMessageSender(senderDeps(NOW, provider), { tenantId: f.tenantId, requestId: 'r' })
    expect(result.sent).toBe(0)
    expect(provider.outbox).toHaveLength(0)
  })

  /**
   * The seven-day trap. `deferred − 7` is `original + 7 − 7`, i.e. the
   * original due date — so a one-week moratoire granted ON that date would
   * otherwise produce a "your delay ends in a week" reminder dated the very
   * day it was agreed.
   */
  it('a one-week moratoire granted on the due date gets ONLY the eve reminder', async () => {
    const f = await seed('F')
    const onDueDate = new Date('2026-09-15T10:00:00Z')
    await grantMoratorium(f, 7, onDueDate)

    await runReminderScheduler(schedulerDeps(onDueDate), { tenantId: f.tenantId, requestId: 'r' })

    const rows = (await schedules(f)).filter((row: Any) => row.status === 'scheduled')
    expect(rows).toHaveLength(1)
    expect(rows[0].reminderRuleId).toBe(f.ruleIds.endEve)
    expect(rows[0].scheduledFor.toISOString()).toBe('2026-09-21T08:00:00.000Z')
  })

  it('a longer moratoire granted in good time gets both end reminders', async () => {
    const f = await seed('G')
    await grantMoratorium(f, 14, NOW)

    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    const scheduled = (await schedules(f)).filter((row: Any) => row.status === 'scheduled')
    expect(scheduled).toHaveLength(2)
  })

  /**
   * A refusal the day before a due date must put the ladder BACK, or the
   * family gets no reminder at all.
   */
  it('refusing a moratoire restores the reminder it had suppressed', async () => {
    const f = await seed('H')
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })
    await grantMoratorium(f, 21, NOW)
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    expect((await schedules(f)).find((r: Any) => r.reminderRuleId === f.ruleIds.j14).status).toBe('cancelled')

    await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.moratorium.updateMany({ where: { tenantId: f.tenantId }, data: { status: 'refused' } }),
    )
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    const rows = await schedules(f)
    expect(rows.find((r: Any) => r.reminderRuleId === f.ruleIds.j14).status).toBe('scheduled')
    // The end-of-moratoire rows go with it.
    expect(rows.filter((r: Any) => r.status === 'scheduled')).toHaveLength(1)
  })

  /**
   * A row cancelled because the family PAID must never be revived by a later
   * sweep. Only rows this service suppressed itself come back, and the skip
   * reason is the only thing that distinguishes them.
   */
  it('never revives a reminder that was cancelled by a payment', async () => {
    const f = await seed('I')
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    // Exactly what settlement.service.ts does when money lands.
    await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.reminderSchedule.updateMany({
        where: { tenantId: f.tenantId, status: 'scheduled' },
        data: { status: 'cancelled', skipReason: 'Paid in cash at the desk' },
      }),
    )

    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    const rows = await schedules(f)
    expect(rows[0].status).toBe('cancelled')
    expect(rows[0].skipReason).toBe('Paid in cash at the desk')
  })

  it('skips and alerts rather than sending on credit', async () => {
    const f = await seed('J', { credits: 0n })
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    const provider = new FakeMessagingProvider()
    const result = await runMessageSender(senderDeps(NOW, provider), { tenantId: f.tenantId, requestId: 'r' })

    expect(result.sent).toBe(0)
    expect(provider.outbox).toHaveLength(0)
    expect((await schedules(f))[0].skipReason).toBe('no_credits')
  })

  it('defers outside sending hours instead of cancelling, so the row survives the night', async () => {
    const f = await seed('K')
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    // 03:00Z is 04:00 in Douala — before the 07:00 window opens.
    const nightly = new Date('2026-09-02T03:00:00Z')
    const provider = new FakeMessagingProvider()
    const result = await runMessageSender(senderDeps(nightly, provider), { tenantId: f.tenantId, requestId: 'r' })

    expect(result.deferred).toBe(1)
    expect(provider.outbox).toHaveLength(0)
    // Still scheduled: the reason may pass on its own.
    expect((await schedules(f))[0].status).toBe('scheduled')
  })

  /**
   * MUST NEVER BE DELETED (AGENTS.md): a log fixture contains no phone number.
   *
   * This is the first path that handles both a phone number and a public
   * token, so it is where that guarantee lands.
   */
  it('never writes a phone number or a link token into a log line', async () => {
    const f = await seed('L')
    const lines: string[] = []
    const capture = {
      log: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    }

    await runReminderScheduler(schedulerDeps(NOW, capture), { tenantId: f.tenantId, requestId: 'r' })

    const provider = new FakeMessagingProvider()
    // Force the failure path too — that is where an error message is most
    // tempted to echo the recipient back.
    const { ProviderError } = await import('@fineduc/providers')
    provider.failNext(new ProviderError('fake', 'RATE_LIMITED', 'Slow down.', true))
    await runMessageSender(senderDeps(NOW, provider, capture), { tenantId: f.tenantId, requestId: 'r' })

    const guardian = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.guardian.findUniqueOrThrow({ where: { id: f.guardianId } }),
    )
    const link = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.moratoriumChatLink.findFirst({ where: { tenantId: f.tenantId } }),
    )

    const transcript = lines.join('\n')
    expect(transcript).not.toContain(guardian.phoneE164)
    expect(transcript).not.toContain(guardian.phoneE164.slice(-6))
    if (link) expect(transcript).not.toContain(link.token)
  })

  /**
   * A failed send returns the credit. A refund row rather than a reversed
   * debit: the ledger is append-only, and a school should be able to see it
   * was charged and then made whole.
   */
  it('returns the credit when the provider rejects the send', async () => {
    const f = await seed('M')
    await runReminderScheduler(schedulerDeps(NOW), { tenantId: f.tenantId, requestId: 'r' })

    const provider = new FakeMessagingProvider()
    const { ProviderError } = await import('@fineduc/providers')
    provider.failNext(new ProviderError('fake', 'RATE_LIMITED', 'Slow down.', true))

    const result = await runMessageSender(senderDeps(NOW, provider), { tenantId: f.tenantId, requestId: 'r' })
    expect(result.failed).toBe(1)

    const entries = await withTenant(prisma, f.tenantId, (tx: Any) =>
      tx.messageCreditLedgerEntry.findMany({ where: { tenantId: f.tenantId }, orderBy: { createdAt: 'asc' } }),
    )
    expect(entries.map((e: Any) => e.entryType)).toEqual(['topup', 'debit', 'refund'])
    expect(entries[2].balanceAfterMinor).toBe(20_000n)

    const messages = await withTenant(prisma, f.tenantId, (tx: Any) => tx.message.findMany({ where: { tenantId: f.tenantId } }))
    expect(messages[0].status).toBe('failed')
    expect(messages[0].errorCode).toBe('RATE_LIMITED')
  })
})
