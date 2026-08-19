/**
 * Deterministic fixtures for the mock API.
 *
 * Two rules these fixtures follow, because a UI validated against
 * impossible data is not validated at all:
 *
 *  1. **The numbers reconcile.** Instalments sum to the invoice total,
 *     ledger balances run consistently, allocations don't exceed amounts,
 *     and the ageing buckets sum to total outstanding. If the real API
 *     ever produces figures that don't, that's a bug the integrity sweep
 *     (ARCHITECTURE.md §8.6) should catch — the UI should never be built
 *     around tolerating it.
 *  2. **No randomness.** A fixed seed means a screenshot taken today and
 *     one taken next week differ only if the code changed.
 *
 * Everything is XAF, exponent 0 — amounts are whole francs, never centimes.
 */
import type {
  AcademicYear,
  AuditLogItem,
  CashSession,
  ClassGroup,
  CurrentUser,
  DashboardOverview,
  FeeSchedule,
  MessageCredits,
  MessageLogItem,
  MessageTemplate,
  PaymentListItem,
  ReminderRule,
  StaffUser,
  StudentFile,
  StudentListItem,
  TenantSettings,
} from '@fineduc/contracts'

const XAF = 'XAF' as const
export const money = (amount: number | string) => ({ amountMinor: String(amount), currency: XAF })

/** Stable pseudo-random so fixtures never shift between runs. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return state / 4_294_967_296
  }
}

const FIRST_NAMES = [
  'Aïcha', 'Boris', 'Chantal', 'Didier', 'Estelle', 'Franck', 'Gisèle', 'Hervé', 'Inès', 'Junior',
  'Kevin', 'Laurette', 'Marcel', 'Nadège', 'Olivier', 'Patricia', 'Rosine', 'Serge', 'Thérèse', 'Ulrich',
  'Véronique', 'Willy', 'Yvette', 'Armand', 'Brice', 'Carine', 'Désiré', 'Florent', 'Ginette', 'Hubert',
]
const LAST_NAMES = [
  'Mballa', 'Ngo Bikoy', 'Fouda', 'Essomba', 'Njoya', 'Tchoumi', 'Abena', 'Biya', 'Kamdem', 'Mvondo',
  'Ateba', 'Nkeng', 'Onana', 'Talla', 'Zang',
]

export const CLASS_GROUPS: ClassGroup[] = [
  { id: 'cg-6a', name: '6ème A', gradeLevelName: '6ème', studentCount: 34 },
  { id: 'cg-6b', name: '6ème B', gradeLevelName: '6ème', studentCount: 31 },
  { id: 'cg-5a', name: '5ème A', gradeLevelName: '5ème', studentCount: 29 },
  { id: 'cg-4a', name: '4ème A', gradeLevelName: '4ème', studentCount: 27 },
]

const FEE_TOTAL = 180_000

export interface MockStudent extends StudentListItem {
  classGroupId: string
  paid: number
}

/** 121 students across four classes — a plausible Essentiel-plan school. */
export const STUDENTS: MockStudent[] = (() => {
  const rand = seeded(20260818)
  const out: MockStudent[] = []
  let index = 0

  for (const group of CLASS_GROUPS) {
    for (let i = 0; i < group.studentCount; i += 1) {
      const first = FIRST_NAMES[index % FIRST_NAMES.length] as string
      const last = LAST_NAMES[(index * 7) % LAST_NAMES.length] as string
      const roll = rand()

      // ~62% fully paid, ~23% partially paid, ~15% nothing yet — roughly the
      // shape of a real term two-thirds through.
      let paid: number
      if (roll < 0.62) paid = FEE_TOTAL
      else if (roll < 0.85) paid = [60_000, 90_000, 120_000, 45_000][index % 4] as number
      else paid = 0

      const balance = FEE_TOTAL - paid
      const daysOverdue = balance === 0 ? 0 : ([12, 41, 67, 95, 5, 23, 130][index % 7] as number)

      out.push({
        id: `stu-${String(index + 1).padStart(4, '0')}`,
        matricule: `EXC-2627-${String(index + 1).padStart(4, '0')}`,
        firstName: first,
        lastName: last,
        className: group.name,
        classGroupId: group.id,
        status: 'enrolled',
        balance: money(balance),
        nextDueOn: balance === 0 ? null : '2027-01-15',
        daysOverdue,
        paid,
      })
      index += 1
    }
  }
  return out
})()

const totalOutstanding = STUDENTS.reduce((sum, s) => sum + (FEE_TOTAL - s.paid), 0)
const totalCollected = STUDENTS.reduce((sum, s) => sum + s.paid, 0)
const totalExpected = STUDENTS.length * FEE_TOTAL
const inArrears = STUDENTS.filter((s) => s.paid < FEE_TOTAL)

/** Ageing buckets, summed from the same student rows so they reconcile. */
function bucketOf(days: number): '0-30' | '31-60' | '61-90' | '90+' {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

const ageing = (['0-30', '31-60', '61-90', '90+'] as const).map((bucket) => {
  const rows = inArrears.filter((s) => bucketOf(s.daysOverdue) === bucket)
  return {
    bucket,
    outstanding: money(rows.reduce((sum, s) => sum + (FEE_TOTAL - s.paid), 0)),
    studentCount: rows.length,
  }
})

const arrearsByClass = CLASS_GROUPS.map((group) => {
  const rows = STUDENTS.filter((s) => s.classGroupId === group.id)
  const late = rows.filter((s) => s.paid < FEE_TOTAL)
  return {
    classGroupId: group.id,
    className: group.name,
    studentsInArrears: late.length,
    totalStudents: rows.length,
    outstanding: money(late.reduce((sum, s) => sum + (FEE_TOTAL - s.paid), 0)),
  }
}).sort((a, b) => Number(b.outstanding.amountMinor) - Number(a.outstanding.amountMinor))

/**
 * Method mix. Only four series — the long tail (cheque/card/waiver) folds
 * into "other" because six chromatic hues could not clear the colour
 * validator's all-pairs CVD check. See packages/ui/src/tokens/charts.ts.
 * Shares are basis points and sum to exactly 10 000.
 */
const methodMix = [
  { method: 'mobile_money' as const, amount: money(Math.round(totalCollected * 0.52)), shareBp: 5_200 },
  { method: 'cash' as const, amount: money(Math.round(totalCollected * 0.31)), shareBp: 3_100 },
  { method: 'bank_transfer' as const, amount: money(Math.round(totalCollected * 0.14)), shareBp: 1_400 },
  { method: 'cheque' as const, amount: money(Math.round(totalCollected * 0.03)), shareBp: 300 },
]

const collectionTrend = (() => {
  const rand = seeded(4242)
  const out: { on: string; collected: { amountMinor: string; currency: 'XAF' } }[] = []
  const start = new Date('2026-07-20T00:00:00Z')
  for (let i = 0; i < 30; i += 1) {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + i)
    const iso = day.toISOString().slice(0, 10)
    const weekday = day.getUTCDay()
    // Weekends are quiet at a school cash desk; month-start spikes.
    const base = weekday === 0 || weekday === 6 ? 40_000 : 260_000
    const spike = day.getUTCDate() <= 5 ? 2.4 : 1
    out.push({ on: iso, collected: money(Math.round(base * spike * (0.6 + rand() * 0.8))) })
  }
  return out
})()

export const OVERVIEW: DashboardOverview = {
  asOf: '2026-08-18T15:30:00.000Z',
  tenantName: 'École Bilingue Excellence',
  academicYearName: '2026-2027',

  collectedToday: money(345_000),
  collectedThisWeek: money(1_890_000),
  collectedThisTerm: money(totalCollected),
  expectedThisTerm: money(totalExpected),

  recoveryRateBp: Math.round((totalCollected / totalExpected) * 10_000),

  totalOutstanding: money(totalOutstanding),
  studentsInArrears: inArrears.length,
  totalStudents: STUDENTS.length,

  arrearsByClass,
  arrearsAgeing: ageing,
  methodMix,
  collectionTrend,

  openCashSessions: [
    {
      sessionId: 'cs-001',
      deskName: 'Caisse principale',
      cashierName: 'Nadège Onana',
      openedAt: '2026-08-18T07:15:00.000Z',
      expectedInDrawer: money(287_000),
    },
  ],

  reminders: {
    sent: 412,
    delivered: 397,
    collectedWithin72h: money(2_140_000),
    messagingCost: money(4_120),
  },

  alerts: [
    {
      severity: 'warning',
      code: 'cash_session_open_long',
      message: 'La caisse principale est ouverte depuis plus de 8 heures.',
    },
    {
      severity: 'info',
      code: 'credits_low',
      message: 'Il reste 5 880 FCFA de crédits de messages (environ 588 WhatsApp).',
    },
  ],
}

export const CURRENT_USER: CurrentUser = {
  id: 'usr-001',
  name: 'Directeur Fondateur',
  email: 'directeur@excellence.test',
  role: 'director',
  locale: 'fr',
  tenantName: 'École Bilingue Excellence',
  siteName: 'Campus principal',
}

export function buildStudentFile(row: MockStudent): StudentFile {
  const paid = row.paid
  const instalmentAmounts = [60_000, 60_000, 60_000]
  let remainingPaid = paid

  const instalments = instalmentAmounts.map((amount, i) => {
    const allocated = Math.min(remainingPaid, amount)
    remainingPaid -= allocated
    const dueOn = ['2026-09-16', '2026-12-15', '2027-03-15'][i] as string
    const status =
      allocated === amount ? 'paid' : allocated > 0 ? 'partial' : row.daysOverdue > 0 && i === 0 ? 'overdue' : 'pending'
    return {
      id: `${row.id}-inst-${i + 1}`,
      sequence: i + 1,
      label: ['1ère tranche', '2ème tranche', '3ème tranche'][i] as string,
      dueOn,
      amount: money(amount),
      allocated: money(allocated),
      remaining: money(amount - allocated),
      status: status as 'paid' | 'partial' | 'overdue' | 'pending',
    }
  })

  // Ledger: the opening charge, then each payment, with a running balance
  // that ends exactly at the student's outstanding figure.
  const ledger: StudentFile['ledger'] = [
    {
      id: `${row.id}-led-1`,
      occurredOn: '2026-09-01',
      entryType: 'charge',
      memo: 'Frais de scolarité 2026-2027',
      amount: money(FEE_TOTAL),
      balanceAfter: money(FEE_TOTAL),
    },
  ]
  if (paid > 0) {
    ledger.push({
      id: `${row.id}-led-2`,
      occurredOn: '2026-09-18',
      entryType: 'payment',
      memo: paid >= FEE_TOTAL ? 'Paiement intégral — Mobile Money' : 'Paiement partiel — Mobile Money',
      amount: money(-paid),
      balanceAfter: money(FEE_TOTAL - paid),
    })
  }

  // Approximated by shared surname. The real model links siblings through a
  // shared guardian (`student_guardian`), which the mock cannot express
  // because it generates one guardian per student.
  const siblings = STUDENTS.filter((s) => s.lastName === row.lastName && s.id !== row.id)
    .slice(0, 2)
    .map((s) => ({
      id: s.id,
      matricule: s.matricule,
      firstName: s.firstName,
      lastName: s.lastName,
      className: s.className,
    }))

  return {
    id: row.id,
    matricule: row.matricule,
    firstName: row.firstName,
    lastName: row.lastName,
    sex: row.id.endsWith('1') || row.id.endsWith('3') ? 'F' : 'M',
    bornOn: '2013-04-12',
    photoUrl: null,
    status: row.status,
    className: row.className,
    academicYearName: '2026-2027',
    enrolledOn: '2026-09-01',

    totalDue: money(FEE_TOTAL),
    totalPaid: money(paid),
    balance: money(FEE_TOTAL - paid),

    guardians: [
      {
        id: `${row.id}-gua-1`,
        firstName: 'Marie',
        lastName: row.lastName,
        phoneE164: '+237677000001',
        relationship: 'Mère',
        isPrimary: true,
        paysFees: true,
        preferredChannel: 'whatsapp',
        optedOut: false,
        quarantined: false,
      },
    ],
    instalments,
    ledger,
    messages:
      row.paid < FEE_TOTAL
        ? [
            {
              id: `${row.id}-msg-1`,
              sentAt: '2026-08-14T08:00:00.000Z',
              channel: 'whatsapp',
              toPhoneE164: '+237677000001',
              status: 'delivered',
              templateCode: 'reminder_due_soon',
              bodyRendered: `Bonjour, la 2ème tranche de ${row.firstName} (${row.className}) est attendue le 15/12. Solde : 60 000 FCFA.`,
            },
          ]
        : [],
    siblings,
  }
}

export const PAYMENTS: PaymentListItem[] = STUDENTS.filter((s) => s.paid > 0)
  .slice(0, 40)
  .map((s, i) => ({
    id: `pay-${String(i + 1).padStart(4, '0')}`,
    studentId: s.id,
    studentName: `${s.firstName} ${s.lastName}`,
    matricule: s.matricule,
    method: (['mobile_money', 'cash', 'bank_transfer', 'mobile_money'][i % 4] ?? 'cash') as PaymentListItem['method'],
    amount: money(s.paid),
    // Two deliberately stuck in pending — the reconciliation queue must be
    // visible and actionable, not hidden (ARCHITECTURE.md §13).
    status: i === 3 || i === 11 ? 'pending' : 'succeeded',
    provider: i % 4 === 1 ? null : 'cinetpay',
    receivedAt: `2026-08-${String((i % 17) + 1).padStart(2, '0')}T09:${String((i * 7) % 60).padStart(2, '0')}:00.000Z`,
    reconciledAt: i === 3 || i === 11 ? null : `2026-08-${String((i % 17) + 1).padStart(2, '0')}T09:32:00.000Z`,
    receiptNumber: i === 3 || i === 11 ? null : `RCT-2627-${String(i + 1).padStart(4, '0')}`,
  }))

export const CASH_SESSION: CashSession = {
  id: 'cs-001',
  deskName: 'Caisse principale',
  cashierName: 'Nadège Onana',
  status: 'open',
  openedAt: '2026-08-18T07:15:00.000Z',
  closedAt: null,
  openingFloat: money(20_000),
  expectedClose: money(287_000),
  declaredClose: null,
  variance: null,
  varianceReason: null,
  movements: [
    { id: 'cm-1', type: 'float_in', amount: money(20_000), reference: null, note: 'Fonds de caisse', createdAt: '2026-08-18T07:15:00.000Z' },
    { id: 'cm-2', type: 'payment', amount: money(60_000), reference: 'RCT-2627-0031', note: null, createdAt: '2026-08-18T08:02:00.000Z' },
    { id: 'cm-3', type: 'payment', amount: money(90_000), reference: 'RCT-2627-0032', note: null, createdAt: '2026-08-18T09:41:00.000Z' },
    { id: 'cm-4', type: 'payment', amount: money(45_000), reference: 'RCT-2627-0033', note: null, createdAt: '2026-08-18T11:10:00.000Z' },
    { id: 'cm-5', type: 'payment', amount: money(120_000), reference: 'RCT-2627-0034', note: null, createdAt: '2026-08-18T13:27:00.000Z' },
    { id: 'cm-6', type: 'deposit_to_bank', amount: money(-48_000), reference: 'BQ-88213', note: 'Dépôt Afriland', createdAt: '2026-08-18T14:05:00.000Z' },
  ],
}

export const FEE_SCHEDULES: FeeSchedule[] = CLASS_GROUPS.slice(0, 2).map((group, i) => ({
  id: `fs-${i + 1}`,
  name: `Grille ${group.gradeLevelName} 2026-2027`,
  gradeLevelName: group.gradeLevelName,
  academicYearName: '2026-2027',
  version: 1,
  status: 'published',
  effectiveFrom: '2026-09-01',
  total: money(FEE_TOTAL),
  items: [
    { id: `fi-${i}-1`, code: 'TUITION', label: 'Scolarité', category: 'tuition', amount: money(150_000), isMandatory: true, isRecurring: true, sequence: 1 },
    { id: `fi-${i}-2`, code: 'REGISTRATION', label: "Frais d'inscription", category: 'registration', amount: money(20_000), isMandatory: true, isRecurring: false, sequence: 2 },
    { id: `fi-${i}-3`, code: 'EXAM', label: "Frais d'examen", category: 'exam', amount: money(10_000), isMandatory: true, isRecurring: true, sequence: 3 },
  ],
  instalmentPlan: {
    id: `ip-${i + 1}`,
    name: 'Standard — 3 tranches',
    instalmentCount: 3,
    templates: [
      { id: `it-${i}-1`, sequence: 1, label: '1ère tranche', dueOn: '2026-09-16', amount: money(60_000) },
      { id: `it-${i}-2`, sequence: 2, label: '2ème tranche', dueOn: '2026-12-15', amount: money(60_000) },
      { id: `it-${i}-3`, sequence: 3, label: '3ème tranche', dueOn: '2027-03-15', amount: money(60_000) },
    ],
  },
  enrolmentCount: group.studentCount,
}))

export const REMINDER_RULES: ReminderRule[] = [
  { id: 'rr-1', name: 'Rappel doux', offsetDays: -7, channel: 'whatsapp', templateCode: 'reminder_due_soon', escalationLevel: 0, isActive: true },
  { id: 'rr-2', name: 'Veille d’échéance', offsetDays: -2, channel: 'whatsapp', templateCode: 'reminder_due_soon', escalationLevel: 0, isActive: true },
  { id: 'rr-3', name: 'Jour J', offsetDays: 0, channel: 'whatsapp', templateCode: 'reminder_due_today', escalationLevel: 1, isActive: true },
  { id: 'rr-4', name: 'Relance ferme', offsetDays: 3, channel: 'whatsapp', templateCode: 'reminder_overdue', escalationLevel: 1, isActive: true },
  { id: 'rr-5', name: 'Relance SMS', offsetDays: 10, channel: 'sms', templateCode: 'reminder_overdue', escalationLevel: 2, isActive: true },
  { id: 'rr-6', name: 'Mise en demeure', offsetDays: 30, channel: 'sms', templateCode: 'reminder_formal', escalationLevel: 2, isActive: false },
]

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'mt-1',
    code: 'reminder_due_soon',
    channel: 'whatsapp',
    locale: 'fr',
    body: 'Bonjour {parent}, la {echeance} de {eleve} ({classe}) arrive à échéance. Montant : {montant}. Payer : {lien}',
    variables: ['parent', 'eleve', 'classe', 'montant', 'echeance', 'lien'],
    whatsappTemplateStatus: 'approved',
    isActive: true,
  },
  {
    id: 'mt-2',
    code: 'reminder_overdue',
    channel: 'whatsapp',
    locale: 'fr',
    body: 'Bonjour {parent}, la {echeance} de {eleve} ({classe}) est en retard. Montant dû : {montant}. Payer : {lien}',
    variables: ['parent', 'eleve', 'classe', 'montant', 'echeance', 'lien'],
    whatsappTemplateStatus: 'approved',
    isActive: true,
  },
  {
    id: 'mt-3',
    code: 'reminder_formal',
    channel: 'sms',
    locale: 'fr',
    body: 'Mise en demeure : le solde de {eleve} ({montant}) reste impayé. Merci de contacter l’économat.',
    variables: ['eleve', 'montant'],
    whatsappTemplateStatus: null,
    isActive: false,
  },
  {
    id: 'mt-4',
    code: 'reminder_due_soon',
    channel: 'whatsapp',
    locale: 'en',
    body: 'Hello {parent}, {eleve}’s {echeance} ({classe}) is due soon. Amount: {montant}. Pay: {lien}',
    variables: ['parent', 'eleve', 'classe', 'montant', 'echeance', 'lien'],
    whatsappTemplateStatus: 'pending',
    isActive: true,
  },
]

export const MESSAGE_LOG: MessageLogItem[] = STUDENTS.filter((s) => s.paid < FEE_TOTAL)
  .slice(0, 25)
  .map((s, i) => ({
    id: `msg-${i + 1}`,
    studentName: `${s.firstName} ${s.lastName}`,
    guardianName: `Marie ${s.lastName}`,
    toPhoneE164: `+2376770000${String(i).padStart(2, '0')}`,
    channel: (i % 5 === 4 ? 'sms' : 'whatsapp') as 'sms' | 'whatsapp',
    templateCode: i % 3 === 0 ? 'reminder_overdue' : 'reminder_due_soon',
    status: (i === 6 ? 'failed' : i % 4 === 0 ? 'read' : 'delivered') as MessageLogItem['status'],
    errorCode: i === 6 ? 'invalid_number' : null,
    cost: money(i % 5 === 4 ? 30 : 10),
    sentAt: `2026-08-1${(i % 8) + 1}T08:00:00.000Z`,
    deliveredAt: i === 6 ? null : `2026-08-1${(i % 8) + 1}T08:00:12.000Z`,
  }))

export const MESSAGE_CREDITS: MessageCredits = {
  balance: money(5_880),
  sentThisMonth: 412,
  spentThisMonth: money(4_120),
  monthlyCap: money(20_000),
  whatsappUnitCost: money(10),
  smsUnitCost: money(30),
  lowBalanceWarning: true,
}

export const STAFF: StaffUser[] = [
  { id: 'usr-001', name: 'Directeur Fondateur', email: 'directeur@excellence.test', role: 'director', siteName: 'Campus principal', status: 'active', twoFactorEnabled: true, lastLoginAt: '2026-08-18T06:40:00.000Z' },
  { id: 'usr-002', name: 'Économe Principal', email: 'econome@excellence.test', role: 'bursar', siteName: 'Campus principal', status: 'active', twoFactorEnabled: true, lastLoginAt: '2026-08-18T07:02:00.000Z' },
  { id: 'usr-003', name: 'Nadège Onana', email: 'caisse@excellence.test', role: 'cashier', siteName: 'Campus principal', status: 'active', twoFactorEnabled: false, lastLoginAt: '2026-08-18T07:15:00.000Z' },
  { id: 'usr-004', name: 'Serge Fouda', email: 'secretariat@excellence.test', role: 'secretary', siteName: 'Campus principal', status: 'active', twoFactorEnabled: false, lastLoginAt: '2026-08-17T10:22:00.000Z' },
  { id: 'usr-005', name: 'Cabinet Mvondo', email: 'audit@mvondo.test', role: 'auditor', siteName: null, status: 'invited', twoFactorEnabled: false, lastLoginAt: null },
]

export const ACADEMIC_YEARS: AcademicYear[] = [
  { id: 'ay-2627', name: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-06-30', status: 'active', studentCount: STUDENTS.length },
  { id: 'ay-2526', name: '2025-2026', startsOn: '2025-09-01', endsOn: '2026-06-30', status: 'closed', studentCount: 114 },
]

export const SETTINGS: TenantSettings = {
  tenantName: 'École Bilingue Excellence',
  legalName: 'Établissement Excellence SARL',
  country: 'CM',
  currency: 'XAF',
  timezone: 'Africa/Douala',
  locale: 'fr',
  plan: 'essentiel',
  quietHoursStart: '07:00',
  quietHoursEnd: '20:00',
  maxMessagesPerGuardianPerDay: 2,
  aggregatorFeeBorneBy: 'payer',
}

export const AUDIT_LOG: AuditLogItem[] = [
  { id: 'al-1', occurredAt: '2026-08-18T14:05:00.000Z', actorName: 'Nadège Onana', actorRole: 'cashier', action: 'cash.deposit_to_bank', entityType: 'cash_session', entityId: 'cs-001', ip: '41.202.219.10' },
  { id: 'al-2', occurredAt: '2026-08-18T13:27:00.000Z', actorName: 'Nadège Onana', actorRole: 'cashier', action: 'payment.record_cash', entityType: 'payment', entityId: 'pay-0034', ip: '41.202.219.10' },
  { id: 'al-3', occurredAt: '2026-08-18T09:12:00.000Z', actorName: 'Économe Principal', actorRole: 'bursar', action: 'reminder.send_bulk', entityType: 'reminder_batch', entityId: 'rb-0007', ip: '41.202.219.11' },
  { id: 'al-4', occurredAt: '2026-08-17T16:48:00.000Z', actorName: 'Directeur Fondateur', actorRole: 'director', action: 'discount.approve', entityType: 'discount', entityId: 'dsc-0012', ip: '41.202.219.9' },
  { id: 'al-5', occurredAt: '2026-08-17T10:22:00.000Z', actorName: 'Serge Fouda', actorRole: 'secretary', action: 'student.update', entityType: 'student', entityId: 'stu-0044', ip: '41.202.219.14' },
]
