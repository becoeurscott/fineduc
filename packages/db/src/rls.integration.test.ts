/**
 * THE test that must exist and must never be deleted (AGENTS.md).
 *
 * Seeds a full, FK-valid graph of data — one row in every RLS-protected
 * table — for two separate tenants against a REAL Postgres (Testcontainers,
 * not a mock), then proves three things:
 *
 *   1. Authenticated as tenant A, not a single row belonging to tenant B is
 *      ever visible, across every one of the 38 RLS-protected tables.
 *   2. Tenant A can still see its OWN data (a policy that denies everyone
 *      would pass check #1 vacuously — this is the complementary guard).
 *   3. A query issued with NO tenant context set (a bug that forgets to
 *      call withTenant) sees zero rows — fail-closed, not fail-open — and
 *      a write issued against the wrong tenant context affects zero rows.
 *
 * Migrations are applied exactly as they ship (`prisma migrate deploy`),
 * as the container's bootstrap/owner role — the same role that owns the
 * schema in any real deployment. All reads/writes under test go through
 * the `fineduc_app` role the RLS migration creates, exactly as the API and
 * worker do in production. If this role were replaced with the owner role
 * here, RLS would silently no-op and this test would give a false pass.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient, type PrismaClient } from './client.js'
import { resolveAppDatabaseUrl } from './connection.js'
import { withTenant, type TenantTransactionClient } from './rls.js'

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

let container: StartedPostgreSqlContainer
let ownerClient: PrismaClient
let appClient: PrismaClient

interface TenantFixture {
  tenantId: string
  userId: string
  instalmentId: string
}

async function seedTenantGraph(marker: 'A' | 'B'): Promise<TenantFixture> {
  const tenantId = crypto.randomUUID()

  // `user` carries no RLS (global identity) — created directly, no tenant context.
  const user = await ownerClient.user.create({
    data: {
      email: `director-${marker.toLowerCase()}@fineduc.test`,
      passwordHash: 'not-a-real-hash',
      name: `Director ${marker}`,
      status: 'active',
    },
  })

  const ids = await withTenant(appClient, tenantId, async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        name: `School ${marker}`,
        country: 'CM',
        currency: 'XAF',
        timezone: 'Africa/Douala',
      },
    })
    const site = await tx.site.create({
      data: { tenantId, name: `Site ${marker}`, isPrimary: true },
    })
    await tx.membership.create({
      data: { tenantId, userId: user.id, siteId: site.id, role: 'director', status: 'active' },
    })
    const academicYear = await tx.academicYear.create({
      data: {
        tenantId,
        name: `2026-${marker}`,
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2027-06-30'),
        status: 'active',
      },
    })
    await tx.term.create({
      data: {
        tenantId,
        academicYearId: academicYear.id,
        name: `Term 1 ${marker}`,
        startsOn: new Date('2026-09-01'),
        endsOn: new Date('2026-12-15'),
        sequence: 1,
      },
    })
    const gradeLevel = await tx.gradeLevel.create({
      data: { tenantId, name: `Grade ${marker}`, sequence: 1 },
    })
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
        matricule: `MAT-${marker}-0001`,
        firstName: `Student`,
        lastName: marker,
        sex: 'M',
        status: 'enrolled',
      },
    })
    const guardian = await tx.guardian.create({
      data: {
        tenantId,
        firstName: 'Guardian',
        lastName: marker,
        phoneE164: marker === 'A' ? '+237600000001' : '+237600000002',
        relationship: 'parent',
      },
    })
    await tx.studentGuardian.create({
      data: { tenantId, studentId: student.id, guardianId: guardian.id, isPrimary: true, paysFees: true },
    })
    const feeSchedule = await tx.feeSchedule.create({
      data: {
        tenantId,
        academicYearId: academicYear.id,
        gradeLevelId: gradeLevel.id,
        name: `Fees ${marker}`,
        status: 'published',
        effectiveFrom: new Date('2026-09-01'),
        totalMinor: 45_000n,
      },
    })
    const feeItem = await tx.feeItem.create({
      data: {
        tenantId,
        feeScheduleId: feeSchedule.id,
        code: 'TUITION',
        label: 'Scolarité',
        category: 'tuition',
        amountMinor: 45_000n,
        sequence: 1,
      },
    })
    const instalmentPlan = await tx.instalmentPlan.create({
      data: { tenantId, feeScheduleId: feeSchedule.id, name: 'Standard', instalmentCount: 1 },
    })
    await tx.instalmentTemplate.create({
      data: {
        tenantId,
        instalmentPlanId: instalmentPlan.id,
        sequence: 1,
        label: 'Tranche unique',
        dueOffsetDays: 30,
        amountMinor: 45_000n,
      },
    })
    const enrollment = await tx.enrollment.create({
      data: {
        tenantId,
        studentId: student.id,
        classGroupId: classGroup.id,
        academicYearId: academicYear.id,
        enrolledOn: new Date('2026-09-01'),
        status: 'active',
        feeScheduleId: feeSchedule.id,
      },
    })
    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        enrollmentId: enrollment.id,
        number: `INV-${marker}-0001`,
        issuedOn: new Date('2026-09-01'),
        totalMinor: 45_000n,
        netMinor: 45_000n,
        balanceMinor: 45_000n,
        status: 'open',
      },
    })
    await tx.invoiceLine.create({
      data: { tenantId, invoiceId: invoice.id, feeItemId: feeItem.id, label: 'Scolarité', amountMinor: 45_000n },
    })
    const instalment = await tx.instalment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        sequence: 1,
        label: 'Tranche unique',
        dueOn: new Date('2026-10-01'),
        amountMinor: 45_000n,
        status: 'pending',
      },
    })
    await tx.discount.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        type: 'sibling',
        method: 'percent',
        value: 1_000n,
        amountMinor: 0n,
        grantedBy: user.id,
      },
    })
    await tx.adjustment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        type: 'credit',
        amountMinor: 0n,
        reasonCode: 'test',
        createdBy: user.id,
      },
    })
    await tx.studentLedgerEntry.create({
      data: {
        tenantId,
        studentId: student.id,
        invoiceId: invoice.id,
        instalmentId: instalment.id,
        entryType: 'charge',
        amountMinor: 45_000n,
        balanceAfterMinor: 45_000n,
        sourceType: 'enrollment',
        sourceId: enrollment.id,
        occurredOn: new Date('2026-09-01'),
      },
    })
    const cashDesk = await tx.cashDesk.create({
      data: { tenantId, siteId: site.id, name: `Desk ${marker}` },
    })
    const cashSession = await tx.cashSession.create({
      data: {
        tenantId,
        cashDeskId: cashDesk.id,
        cashierUserId: user.id,
        openingFloatMinor: 0n,
        status: 'open',
      },
    })
    await tx.cashMovement.create({
      data: {
        tenantId,
        cashSessionId: cashSession.id,
        type: 'float_in',
        amountMinor: 0n,
        createdBy: user.id,
      },
    })
    const payment = await tx.payment.create({
      data: {
        tenantId,
        studentId: student.id,
        invoiceId: invoice.id,
        method: 'cash',
        amountMinor: 45_000n,
        currency: 'XAF',
        status: 'succeeded',
        idempotencyKey: `idem-${marker}-0001`,
        cashSessionId: cashSession.id,
        receivedAt: new Date(),
      },
    })
    await tx.paymentAllocation.create({
      data: { tenantId, paymentId: payment.id, instalmentId: instalment.id, amountMinor: 45_000n },
    })
    await tx.paymentLink.create({
      data: {
        tenantId,
        studentId: student.id,
        invoiceId: invoice.id,
        instalmentId: instalment.id,
        token: `tok-${marker}-0001`,
        expiresAt: new Date('2027-01-01'),
      },
    })
    await tx.receipt.create({
      data: { tenantId, paymentId: payment.id, number: `RCT-${marker}-0001` },
    })
    await tx.refund.create({
      data: {
        tenantId,
        paymentId: payment.id,
        amountMinor: 1_000n,
        reasonCode: 'test',
        status: 'requested',
        requestedBy: user.id,
      },
    })
    await tx.receiptCounter.create({
      data: { tenantId, year: 2026, lastNumber: 1 },
    })
    await tx.messageTemplate.create({
      data: {
        tenantId,
        code: 'reminder_due',
        channel: 'whatsapp',
        locale: 'fr',
        body: 'Rappel: {{montant}} dû le {{echeance}}',
        variables: ['montant', 'echeance'],
      },
    })
    const reminderRule = await tx.reminderRule.create({
      data: { tenantId, name: 'D-7', offsetDays: -7, channel: 'whatsapp', templateCode: 'reminder_due' },
    })
    await tx.reminderSchedule.create({
      data: {
        tenantId,
        instalmentId: instalment.id,
        reminderRuleId: reminderRule.id,
        guardianId: guardian.id,
        scheduledFor: new Date('2026-09-24'),
        status: 'scheduled',
      },
    })
    const message = await tx.message.create({
      data: {
        tenantId,
        guardianId: guardian.id,
        studentId: student.id,
        channel: 'whatsapp',
        provider: 'fake',
        toPhoneE164: guardian.phoneE164,
        templateCode: 'reminder_due',
        locale: 'fr',
        bodyRendered: 'Rappel: 45 000 FCFA dû le 2026-10-01',
        costMinor: 10n,
      },
    })
    await tx.messageCreditLedgerEntry.create({
      data: { tenantId, entryType: 'debit', amountMinor: -10n, balanceAfterMinor: 990n, messageId: message.id },
    })
    await tx.moratorium.create({
      data: {
        tenantId,
        instalmentId: instalment.id,
        studentId: student.id,
        guardianId: guardian.id,
        source: 'chatbot',
        status: 'granted',
        requestedDays: 14,
        originalDueOn: new Date('2026-10-01'),
        deferredDueOn: new Date('2026-10-15'),
      },
    })
    await tx.moratoriumChatLink.create({
      data: {
        tenantId,
        instalmentId: instalment.id,
        studentId: student.id,
        guardianId: guardian.id,
        token: `${tenantId}.mora-${marker}-0001`,
        expiresAt: new Date('2027-01-01'),
      },
    })
    await tx.subscription.create({
      data: {
        tenantId,
        plan: 'essentiel',
        billingPeriod: 'monthly',
        priceMinor: 25_000n,
        currentPeriodStart: new Date('2026-09-01'),
        currentPeriodEnd: new Date('2026-10-01'),
        status: 'active',
      },
    })
    await tx.apiKey.create({
      data: { tenantId, name: `Key ${marker}`, keyHash: `hash-${marker}-0001` },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: user.id,
        action: 'test.seed',
        entityType: 'tenant',
        entityId: tenantId,
      },
    })

    return { instalmentId: instalment.id }
  })

  return { tenantId, userId: user.id, instalmentId: ids.instalmentId }
}

/**
 * Every RLS-protected table, paired with a type-safe reader. Deliberately
 * explicit rather than iterating `Object.keys(prisma)` — this list is the
 * assertion that every table in schema.prisma got a policy, not just the
 * ones we remembered.
 */
const RLS_TABLES: Array<{
  name: string
  tenantKey: 'id' | 'tenantId'
  findMany: (tx: TenantTransactionClient) => Promise<Array<Record<string, unknown>>>
}> = [
  { name: 'tenant', tenantKey: 'id', findMany: (tx) => tx.tenant.findMany() },
  { name: 'site', tenantKey: 'tenantId', findMany: (tx) => tx.site.findMany() },
  { name: 'membership', tenantKey: 'tenantId', findMany: (tx) => tx.membership.findMany() },
  { name: 'apiKey', tenantKey: 'tenantId', findMany: (tx) => tx.apiKey.findMany() },
  { name: 'academicYear', tenantKey: 'tenantId', findMany: (tx) => tx.academicYear.findMany() },
  { name: 'term', tenantKey: 'tenantId', findMany: (tx) => tx.term.findMany() },
  { name: 'gradeLevel', tenantKey: 'tenantId', findMany: (tx) => tx.gradeLevel.findMany() },
  { name: 'classGroup', tenantKey: 'tenantId', findMany: (tx) => tx.classGroup.findMany() },
  { name: 'student', tenantKey: 'tenantId', findMany: (tx) => tx.student.findMany() },
  { name: 'guardian', tenantKey: 'tenantId', findMany: (tx) => tx.guardian.findMany() },
  { name: 'studentGuardian', tenantKey: 'tenantId', findMany: (tx) => tx.studentGuardian.findMany() },
  { name: 'enrollment', tenantKey: 'tenantId', findMany: (tx) => tx.enrollment.findMany() },
  { name: 'feeSchedule', tenantKey: 'tenantId', findMany: (tx) => tx.feeSchedule.findMany() },
  { name: 'feeItem', tenantKey: 'tenantId', findMany: (tx) => tx.feeItem.findMany() },
  { name: 'instalmentPlan', tenantKey: 'tenantId', findMany: (tx) => tx.instalmentPlan.findMany() },
  { name: 'instalmentTemplate', tenantKey: 'tenantId', findMany: (tx) => tx.instalmentTemplate.findMany() },
  { name: 'invoice', tenantKey: 'tenantId', findMany: (tx) => tx.invoice.findMany() },
  { name: 'invoiceLine', tenantKey: 'tenantId', findMany: (tx) => tx.invoiceLine.findMany() },
  { name: 'instalment', tenantKey: 'tenantId', findMany: (tx) => tx.instalment.findMany() },
  { name: 'discount', tenantKey: 'tenantId', findMany: (tx) => tx.discount.findMany() },
  { name: 'adjustment', tenantKey: 'tenantId', findMany: (tx) => tx.adjustment.findMany() },
  { name: 'studentLedgerEntry', tenantKey: 'tenantId', findMany: (tx) => tx.studentLedgerEntry.findMany() },
  { name: 'payment', tenantKey: 'tenantId', findMany: (tx) => tx.payment.findMany() },
  { name: 'paymentAllocation', tenantKey: 'tenantId', findMany: (tx) => tx.paymentAllocation.findMany() },
  { name: 'paymentLink', tenantKey: 'tenantId', findMany: (tx) => tx.paymentLink.findMany() },
  { name: 'receipt', tenantKey: 'tenantId', findMany: (tx) => tx.receipt.findMany() },
  { name: 'refund', tenantKey: 'tenantId', findMany: (tx) => tx.refund.findMany() },
  { name: 'receiptCounter', tenantKey: 'tenantId', findMany: (tx) => tx.receiptCounter.findMany() },
  { name: 'cashDesk', tenantKey: 'tenantId', findMany: (tx) => tx.cashDesk.findMany() },
  { name: 'cashSession', tenantKey: 'tenantId', findMany: (tx) => tx.cashSession.findMany() },
  { name: 'cashMovement', tenantKey: 'tenantId', findMany: (tx) => tx.cashMovement.findMany() },
  { name: 'messageTemplate', tenantKey: 'tenantId', findMany: (tx) => tx.messageTemplate.findMany() },
  { name: 'reminderRule', tenantKey: 'tenantId', findMany: (tx) => tx.reminderRule.findMany() },
  { name: 'reminderSchedule', tenantKey: 'tenantId', findMany: (tx) => tx.reminderSchedule.findMany() },
  { name: 'message', tenantKey: 'tenantId', findMany: (tx) => tx.message.findMany() },
  {
    name: 'messageCreditLedgerEntry',
    tenantKey: 'tenantId',
    findMany: (tx) => tx.messageCreditLedgerEntry.findMany(),
  },
  { name: 'moratorium', tenantKey: 'tenantId', findMany: (tx) => tx.moratorium.findMany() },
  { name: 'moratoriumChatLink', tenantKey: 'tenantId', findMany: (tx) => tx.moratoriumChatLink.findMany() },
  { name: 'subscription', tenantKey: 'tenantId', findMany: (tx) => tx.subscription.findMany() },
  { name: 'auditLog', tenantKey: 'tenantId', findMany: (tx) => tx.auditLog.findMany() },
]

describe('Row-Level Security — cross-tenant isolation', () => {
  let tenantA: TenantFixture
  let tenantB: TenantFixture

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start()
    const ownerUrl = container.getConnectionUri()

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: packageRoot,
      env: { ...process.env, DATABASE_URL: ownerUrl },
      stdio: 'inherit',
      shell: true,
    })

    ownerClient = createPrismaClient({ databaseUrl: ownerUrl })
    appClient = createPrismaClient({ databaseUrl: resolveAppDatabaseUrl(ownerUrl) })

    tenantA = await seedTenantGraph('A')
    tenantB = await seedTenantGraph('B')
  }, 120_000)

  afterAll(async () => {
    await ownerClient?.$disconnect()
    await appClient?.$disconnect()
    await container?.stop()
  })

  it.each(RLS_TABLES)(
    'tenant A reading $name sees only its own rows, and sees at least one',
    async ({ tenantKey, findMany }) => {
      const rows = await withTenant(appClient, tenantA.tenantId, (tx) => findMany(tx))

      const leaked = rows.filter((row) => row[tenantKey] !== tenantA.tenantId)
      expect(leaked, `leaked ${leaked.length} row(s) belonging to another tenant`).toHaveLength(0)
      expect(rows.length, 'RLS policy hid tenant A from its own data').toBeGreaterThan(0)
    },
  )

  it.each(RLS_TABLES)(
    'tenant B reading $name sees only its own rows, and sees at least one',
    async ({ tenantKey, findMany }) => {
      const rows = await withTenant(appClient, tenantB.tenantId, (tx) => findMany(tx))

      const leaked = rows.filter((row) => row[tenantKey] !== tenantB.tenantId)
      expect(leaked, `leaked ${leaked.length} row(s) belonging to another tenant`).toHaveLength(0)
      expect(rows.length, 'RLS policy hid tenant B from its own data').toBeGreaterThan(0)
    },
  )

  it('fails CLOSED: a query with no tenant context set sees zero rows, not everyone\'s', async () => {
    // No withTenant() — simulates a bug that forgot to set the context.
    const rows = await appClient.student.findMany()
    expect(rows).toHaveLength(0)
  })

  it('a write issued under the wrong tenant context affects zero rows, never someone else\'s data', async () => {
    const result = await withTenant(appClient, tenantA.tenantId, (tx) =>
      tx.instalment.updateMany({
        where: { id: tenantB.instalmentId },
        data: { status: 'waived' },
      }),
    )
    expect(result.count).toBe(0)

    const stillPending = await withTenant(appClient, tenantB.tenantId, (tx) =>
      tx.instalment.findUniqueOrThrow({ where: { id: tenantB.instalmentId } }),
    )
    expect(stillPending.status).toBe('pending')
  })

  it('the append-only role cannot DELETE from student_ledger_entry, even within its own tenant', async () => {
    await expect(
      withTenant(appClient, tenantA.tenantId, (tx) => tx.studentLedgerEntry.deleteMany({ where: {} })),
    ).rejects.toThrow()
  })

  it('the append-only role cannot UPDATE audit_log', async () => {
    await expect(
      withTenant(appClient, tenantA.tenantId, (tx) =>
        tx.auditLog.updateMany({ where: {}, data: { action: 'tampered' } }),
      ),
    ).rejects.toThrow()
  })

  /**
   * A trap worth a test rather than a comment. The 20260818193836 migration
   * did `REVOKE DELETE ON ALL TABLES`, which covered the tables existing at
   * that moment — but its `ALTER DEFAULT PRIVILEGES ... GRANT ... DELETE`
   * hands DELETE to fineduc_app on every table created AFTERWARDS. So a new
   * table is born delete-able and has to be revoked by name, and nothing
   * fails if you forget.
   *
   * This assertion is what makes the next new table's author notice.
   */
  it.each([
    { name: 'moratorium', deleteAll: (tx: TenantTransactionClient) => tx.moratorium.deleteMany({ where: {} }) },
    {
      name: 'moratoriumChatLink',
      deleteAll: (tx: TenantTransactionClient) => tx.moratoriumChatLink.deleteMany({ where: {} }),
    },
  ])('the app role cannot DELETE from $name — a new table is born DELETE-able', async ({ deleteAll }) => {
    await expect(withTenant(appClient, tenantA.tenantId, (tx) => deleteAll(tx))).rejects.toThrow()
  })

  /**
   * A moratoire is a scheduling fact, not a money row, so UPDATE stays
   * granted — approve and refuse both need it. Asserted so that a future
   * "tighten the grants" sweep has to make a deliberate decision rather
   * than a consistent-looking one that breaks the bursar's queue.
   */
  it('the app role CAN update a moratorium — it is a schedule, not a ledger', async () => {
    const updated = await withTenant(appClient, tenantA.tenantId, (tx) =>
      tx.moratorium.updateMany({ where: {}, data: { decisionNote: 'reviewed' } }),
    )
    expect(updated.count).toBeGreaterThan(0)
  })
})
