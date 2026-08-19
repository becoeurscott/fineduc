/**
 * Seeds ONE fake school for local development (ARCHITECTURE.md §14):
 * an academic year, three classes across two grade levels, ~30 students
 * with guardians, and a published fee schedule with a 3-instalment plan.
 *
 * Deliberately does NOT create payments, cash sessions, receipts, or
 * messages — those flows have real invariants (allocation, idempotency,
 * gapless receipt numbers, send-time reminder eligibility) that belong to
 * the billing/payments/messaging modules, not yet built. Faking that data
 * directly here would bypass the rules this whole codebase exists to
 * enforce. Once those modules exist, exercise them for realistic payment
 * history instead of extending this script.
 *
 * Idempotent: running it twice is a no-op the second time, keyed on a
 * fixed, well-known tenant id.
 *
 * Usage: `pnpm db:seed` from the repo root, or `pnpm seed` in this package.
 */
import { allocateEven, Money } from '@fineduc/money'
import { loadDotEnvIfPresent, loadEnv } from '@fineduc/config'
import { createPrismaClient } from './client.js'
import { resolveAppDatabaseUrl } from './connection.js'
import { withTenant } from './rls.js'

loadDotEnvIfPresent('.env')
loadDotEnvIfPresent('../../.env')
const env = loadEnv()

const SEED_TENANT_ID = '00000000-0000-4000-8000-000000000001'

const FIRST_NAMES = [
  'Aïcha', 'Boris', 'Chantal', 'Didier', 'Estelle', 'Franck', 'Gisèle', 'Hervé',
  'Inès', 'Junior', 'Kevin', 'Laurette', 'Marcel', 'Nadège', 'Olivier', 'Patricia',
  'Quentin', 'Rosine', 'Serge', 'Thérèse', 'Ulrich', 'Véronique', 'Willy', 'Yvette',
  'Armand', 'Brice', 'Carine', 'Désiré', 'Émilienne', 'Florent',
]
const LAST_NAMES = [
  'Mballa', 'Ngo Bikoy', 'Fouda', 'Essomba', 'Njoya', 'Tchoumi', 'Abena', 'Biya',
  'Kamdem', 'Mvondo', 'Ateba', 'Nkeng', 'Onana', 'Talla', 'Zang',
]

function nameFor(index: number): { firstName: string; lastName: string } {
  return {
    firstName: FIRST_NAMES[index % FIRST_NAMES.length] as string,
    lastName: LAST_NAMES[index % LAST_NAMES.length] as string,
  }
}

function phoneFor(index: number): string {
  // Deterministic, obviously-fake Cameroonian-shaped E.164 numbers.
  return `+2376${String(70_000_00 + index).padStart(8, '0')}`
}

async function main() {
  const ownerClient = createPrismaClient({ databaseUrl: env.DATABASE_URL })
  const appClient = createPrismaClient({
    databaseUrl: resolveAppDatabaseUrl(env.DATABASE_URL, env.APP_DATABASE_URL),
  })

  try {
    const existing = await ownerClient.tenant.findUnique({ where: { id: SEED_TENANT_ID } })
    if (existing) {
      console.log(`Already seeded: "${existing.name}" (${existing.id}). Nothing to do.`)
      return
    }

    const summary = await withTenant(appClient, SEED_TENANT_ID, async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id: SEED_TENANT_ID,
          name: 'École Bilingue Excellence',
          legalName: 'Établissement Excellence SARL',
          country: 'CM',
          currency: 'XAF',
          timezone: 'Africa/Douala',
          locale: 'fr',
          plan: 'essentiel',
          status: 'active',
        },
      })

      const site = await tx.site.create({
        data: { tenantId: tenant.id, name: 'Campus principal', address: 'Douala, Cameroun', isPrimary: true },
      })

      const director = await ownerClient.user.upsert({
        where: { email: 'directeur@excellence.test' },
        create: {
          email: 'directeur@excellence.test',
          passwordHash: 'seed-only-not-a-real-hash',
          name: 'Directeur Fondateur',
          status: 'active',
        },
        update: {},
      })
      const bursar = await ownerClient.user.upsert({
        where: { email: 'econome@excellence.test' },
        create: {
          email: 'econome@excellence.test',
          passwordHash: 'seed-only-not-a-real-hash',
          name: 'Économe Principal',
          status: 'active',
        },
        update: {},
      })
      await tx.membership.createMany({
        data: [
          { tenantId: tenant.id, userId: director.id, siteId: site.id, role: 'director', status: 'active' },
          { tenantId: tenant.id, userId: bursar.id, siteId: site.id, role: 'bursar', status: 'active' },
        ],
      })

      const academicYear = await tx.academicYear.create({
        data: {
          tenantId: tenant.id,
          name: '2026-2027',
          startsOn: new Date('2026-09-01'),
          endsOn: new Date('2027-06-30'),
          status: 'active',
        },
      })
      await tx.term.createMany({
        data: [
          { tenantId: tenant.id, academicYearId: academicYear.id, name: 'Trimestre 1', startsOn: new Date('2026-09-01'), endsOn: new Date('2026-12-15'), sequence: 1 },
          { tenantId: tenant.id, academicYearId: academicYear.id, name: 'Trimestre 2', startsOn: new Date('2027-01-05'), endsOn: new Date('2027-03-30'), sequence: 2 },
          { tenantId: tenant.id, academicYearId: academicYear.id, name: 'Trimestre 3', startsOn: new Date('2027-04-10'), endsOn: new Date('2027-06-30'), sequence: 3 },
        ],
      })

      // Two grade levels, three classes total (ARCHITECTURE.md §14: "2-3 classes").
      const gradeSixieme = await tx.gradeLevel.create({
        data: { tenantId: tenant.id, name: '6ème', sequence: 1, cycle: 'secondaire' },
      })
      const gradeCinquieme = await tx.gradeLevel.create({
        data: { tenantId: tenant.id, name: '5ème', sequence: 2, cycle: 'secondaire' },
      })
      const classSixiemeA = await tx.classGroup.create({
        data: { tenantId: tenant.id, gradeLevelId: gradeSixieme.id, academicYearId: academicYear.id, siteId: site.id, name: '6ème A', capacity: 40 },
      })
      const classSixiemeB = await tx.classGroup.create({
        data: { tenantId: tenant.id, gradeLevelId: gradeSixieme.id, academicYearId: academicYear.id, siteId: site.id, name: '6ème B', capacity: 40 },
      })
      const classCinquiemeA = await tx.classGroup.create({
        data: { tenantId: tenant.id, gradeLevelId: gradeCinquieme.id, academicYearId: academicYear.id, siteId: site.id, name: '5ème A', capacity: 40 },
      })

      // One published fee schedule per grade level, each with a 3-instalment plan.
      async function createFeeSchedule(gradeLevelId: string, gradeName: string) {
        const totalMinor = Money.of(180_000, 'XAF')
        const feeSchedule = await tx.feeSchedule.create({
          data: {
            tenantId: tenant.id,
            academicYearId: academicYear.id,
            gradeLevelId,
            name: `Grille ${gradeName} 2026-2027`,
            status: 'published',
            effectiveFrom: new Date('2026-09-01'),
            totalMinor: totalMinor.amount,
          },
        })
        const tuition = Money.of(150_000, 'XAF')
        const registration = Money.of(20_000, 'XAF')
        const exam = Money.of(10_000, 'XAF')
        await tx.feeItem.createMany({
          data: [
            { tenantId: tenant.id, feeScheduleId: feeSchedule.id, code: 'TUITION', label: 'Scolarité', category: 'tuition', amountMinor: tuition.amount, isMandatory: true, isRecurring: true, sequence: 1 },
            { tenantId: tenant.id, feeScheduleId: feeSchedule.id, code: 'REGISTRATION', label: "Frais d'inscription", category: 'registration', amountMinor: registration.amount, isMandatory: true, isRecurring: false, sequence: 2 },
            { tenantId: tenant.id, feeScheduleId: feeSchedule.id, code: 'EXAM', label: "Frais d'examen", category: 'exam', amountMinor: exam.amount, isMandatory: true, isRecurring: true, sequence: 3 },
          ],
        })
        const instalmentPlan = await tx.instalmentPlan.create({
          data: { tenantId: tenant.id, feeScheduleId: feeSchedule.id, name: 'Standard — 3 tranches', instalmentCount: 3 },
        })
        const shares = allocateEven(totalMinor, 3)
        const labels = ['1ère tranche', '2ème tranche', '3ème tranche']
        const offsets = [15, 105, 195] // roughly aligned with the three terms above
        await tx.instalmentTemplate.createMany({
          data: shares.map((share, i) => ({
            tenantId: tenant.id,
            instalmentPlanId: instalmentPlan.id,
            sequence: i + 1,
            label: labels[i] as string,
            dueOffsetDays: offsets[i] as number,
            amountMinor: share.amount,
          })),
        })
        return feeSchedule
      }

      const feeScheduleSixieme = await createFeeSchedule(gradeSixieme.id, '6ème')
      const feeScheduleCinquieme = await createFeeSchedule(gradeCinquieme.id, '5ème')

      // ~30 students across the three classes, each with one guardian.
      // Every third student shares a guardian with the previous one, to
      // exercise the sibling case (ARCHITECTURE.md §4 "sibling linkage").
      const classPlan = [
        { classGroup: classSixiemeA, feeSchedule: feeScheduleSixieme, count: 10 },
        { classGroup: classSixiemeB, feeSchedule: feeScheduleSixieme, count: 10 },
        { classGroup: classCinquiemeA, feeSchedule: feeScheduleCinquieme, count: 10 },
      ]

      let studentIndex = 0
      let lastGuardianId: string | null = null
      let studentsCreated = 0
      let enrollmentsCreated = 0

      for (const { classGroup, feeSchedule, count } of classPlan) {
        for (let i = 0; i < count; i++) {
          const { firstName, lastName } = nameFor(studentIndex)
          const student = await tx.student.create({
            data: {
              tenantId: tenant.id,
              matricule: `EXC-2627-${String(studentIndex + 1).padStart(4, '0')}`,
              firstName,
              lastName,
              sex: studentIndex % 2 === 0 ? 'M' : 'F',
              bornOn: new Date(2013 - Math.floor(studentIndex / 10), studentIndex % 12, 10),
              status: 'enrolled',
            },
          })
          studentsCreated++

          const isSibling: boolean = studentIndex % 3 === 2 && lastGuardianId !== null
          const guardianId: string = isSibling
            ? (lastGuardianId as string)
            : (
                await tx.guardian.create({
                  data: {
                    tenantId: tenant.id,
                    firstName: nameFor(studentIndex + 17).firstName,
                    lastName,
                    phoneE164: phoneFor(studentIndex),
                    relationship: 'parent',
                    preferredChannel: 'whatsapp',
                    preferredLocale: 'fr',
                  },
                })
              ).id
          lastGuardianId = guardianId
          await tx.studentGuardian.create({
            data: { tenantId: tenant.id, studentId: student.id, guardianId, isPrimary: true, paysFees: true },
          })

          const enrollment = await tx.enrollment.create({
            data: {
              tenantId: tenant.id,
              studentId: student.id,
              classGroupId: classGroup.id,
              academicYearId: academicYear.id,
              enrolledOn: new Date('2026-09-01'),
              status: 'active',
              feeScheduleId: feeSchedule.id,
            },
          })
          enrollmentsCreated++

          const feeItems = await tx.feeItem.findMany({ where: { feeScheduleId: feeSchedule.id }, orderBy: { sequence: 'asc' } })
          const net = Money.of(feeSchedule.totalMinor, 'XAF')
          const invoice = await tx.invoice.create({
            data: {
              tenantId: tenant.id,
              enrollmentId: enrollment.id,
              number: `INV-2627-${String(studentIndex + 1).padStart(4, '0')}`,
              issuedOn: new Date('2026-09-01'),
              totalMinor: net.amount,
              netMinor: net.amount,
              balanceMinor: net.amount,
              status: 'open',
            },
          })
          await tx.invoiceLine.createMany({
            data: feeItems.map((item) => ({
              tenantId: tenant.id,
              invoiceId: invoice.id,
              feeItemId: item.id,
              label: item.label,
              amountMinor: item.amountMinor,
            })),
          })

          const templates = await tx.instalmentTemplate.findMany({
            where: { instalmentPlan: { feeScheduleId: feeSchedule.id } },
            orderBy: { sequence: 'asc' },
          })
          const dueDates = templates.map((t) => {
            const d = new Date('2026-09-01')
            d.setDate(d.getDate() + (t.dueOffsetDays ?? 0))
            return d
          })
          await tx.instalment.createMany({
            data: templates.map((t, i) => ({
              tenantId: tenant.id,
              invoiceId: invoice.id,
              sequence: t.sequence,
              label: t.label,
              dueOn: dueDates[i] as Date,
              amountMinor: t.amountMinor ?? 0n,
              status: 'pending' as const,
            })),
          })
          await tx.studentLedgerEntry.create({
            data: {
              tenantId: tenant.id,
              studentId: student.id,
              invoiceId: invoice.id,
              entryType: 'charge',
              amountMinor: net.amount,
              balanceAfterMinor: net.amount,
              sourceType: 'enrollment',
              sourceId: enrollment.id,
              occurredOn: new Date('2026-09-01'),
            },
          })

          studentIndex++
        }
      }

      const subscription = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          plan: 'essentiel',
          billingPeriod: 'annual',
          studentCap: 250,
          priceMinor: Money.ofMajor(240_000, 'XAF').amount,
          currentPeriodStart: new Date('2026-09-01'),
          currentPeriodEnd: new Date('2027-08-31'),
          status: 'active',
        },
      })

      return { tenant, studentsCreated, enrollmentsCreated, subscriptionId: subscription.id }
    })

    console.log('Seeded one fake school:')
    console.log(`  Tenant:      ${summary.tenant.name} (${summary.tenant.id})`)
    console.log(`  Students:    ${summary.studentsCreated}`)
    console.log(`  Enrolments:  ${summary.enrollmentsCreated}`)
    console.log('  Users:       directeur@excellence.test / econome@excellence.test')
  } finally {
    await ownerClient.$disconnect()
    await appClient.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
