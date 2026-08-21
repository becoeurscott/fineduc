/**
 * The mock implementation of `DashboardApi`.
 *
 * TEMPORARY — this exists only because ARCHITECTURE.md §15 phases 2-8 have
 * not been built. It is isolated behind the interface precisely so that
 * deleting it later touches exactly one file (`index.ts`) and zero
 * components.
 *
 * It deliberately simulates latency, so loading states are exercised
 * during development rather than discovered in production on a 3G phone.
 */
import type {
  MoratoriumListItem,
  MoratoriumPolicy,
  MoratoriumStatus,
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
  SendReminderPreview,
  StaffUser,
  StudentFile,
  StudentListItem,
  TenantSettings,
} from '@fineduc/contracts'
import type { ArrearsQuery, AuditQuery, DashboardApi, PaymentQuery, StudentQuery } from './types'
import {
  ACADEMIC_YEARS,
  AUDIT_LOG,
  CASH_SESSION,
  CLASS_GROUPS,
  CURRENT_USER,
  FEE_SCHEDULES,
  MESSAGE_CREDITS,
  MESSAGE_LOG,
  MESSAGE_TEMPLATES,
  MORATORIUM_POLICY,
  MORATORIUMS,
  OVERVIEW,
  PAYMENTS,
  REMINDER_RULES,
  SETTINGS,
  STAFF,
  STUDENTS,
  buildStudentFile,
  money,
} from './mock-data'

const LATENCY_MS = 260

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS))
}

function matchesSearch(student: (typeof STUDENTS)[number], search?: string): boolean {
  if (!search) return true
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return (
    `${student.firstName} ${student.lastName}`.toLowerCase().includes(needle) ||
    student.matricule.toLowerCase().includes(needle)
  )
}

export class MockApi implements DashboardApi {
  private moratoriums: MoratoriumListItem[] = [...MORATORIUMS]
  private policy: MoratoriumPolicy = { ...MORATORIUM_POLICY }

  getCurrentUser(): Promise<CurrentUser> {
    return delay(CURRENT_USER)
  }

  getClassGroups(): Promise<ClassGroup[]> {
    return delay(CLASS_GROUPS)
  }

  getOverview(): Promise<DashboardOverview> {
    return delay(OVERVIEW)
  }

  listStudents(query: StudentQuery): Promise<StudentListItem[]> {
    const rows = STUDENTS.filter(
      (s) =>
        matchesSearch(s, query.search) &&
        (!query.classGroupId || s.classGroupId === query.classGroupId) &&
        (!query.status || s.status === query.status) &&
        (query.hasBalance === undefined || (Number(s.balance.amountMinor) > 0) === query.hasBalance),
    )
    return delay(rows.slice(0, 100))
  }

  getStudent(id: string): Promise<StudentFile> {
    const row = STUDENTS.find((s) => s.id === id)
    if (!row) return Promise.reject(new Error(`Élève introuvable : ${id}`))
    return delay(buildStudentFile(row))
  }

  listArrears(query: ArrearsQuery): Promise<StudentListItem[]> {
    const rows = STUDENTS.filter(
      (s) =>
        Number(s.balance.amountMinor) > 0 &&
        matchesSearch(s, query.search) &&
        (!query.classGroupId || s.classGroupId === query.classGroupId) &&
        (query.minDaysOverdue === undefined || s.daysOverdue >= query.minDaysOverdue),
    )

    const sorted = [...rows].sort((a, b) => {
      if (query.sort === 'age_desc') return b.daysOverdue - a.daysOverdue
      if (query.sort === 'name_asc') return `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`)
      return Number(b.balance.amountMinor) - Number(a.balance.amountMinor)
    })

    return delay(sorted.slice(0, 100))
  }

  listPayments(query: PaymentQuery): Promise<PaymentListItem[]> {
    const rows = PAYMENTS.filter((p) => {
      if (query.method && p.method !== query.method) return false
      if (query.status && p.status !== query.status) return false
      if (query.unreconciledOnly && p.reconciledAt !== null) return false
      if (query.search) {
        const needle = query.search.trim().toLowerCase()
        if (!p.studentName.toLowerCase().includes(needle) && !p.matricule.toLowerCase().includes(needle)) return false
      }
      return true
    })
    return delay(rows)
  }

  getOpenCashSessions(): Promise<CashSession[]> {
    return delay([CASH_SESSION])
  }

  getCashSession(id: string): Promise<CashSession> {
    if (id !== CASH_SESSION.id) return Promise.reject(new Error(`Caisse introuvable : ${id}`))
    return delay(CASH_SESSION)
  }

  listFeeSchedules(): Promise<FeeSchedule[]> {
    return delay(FEE_SCHEDULES)
  }

  listReminderRules(): Promise<ReminderRule[]> {
    return delay(REMINDER_RULES)
  }

  listMessageTemplates(): Promise<MessageTemplate[]> {
    return delay(MESSAGE_TEMPLATES)
  }

  listMessageLog(): Promise<MessageLogItem[]> {
    return delay(MESSAGE_LOG)
  }

  getMessageCredits(): Promise<MessageCredits> {
    return delay(MESSAGE_CREDITS)
  }

  previewReminder(input: { studentIds: string[]; channel: 'whatsapp' | 'sms' }): Promise<SendReminderPreview> {
    const targets = STUDENTS.filter((s) => input.studentIds.includes(s.id))
    // Mirrors the send-time eligibility checks (ARCHITECTURE.md §8.5): a
    // student who has since paid is skipped, never messaged.
    const alreadyPaid = targets.filter((s) => Number(s.balance.amountMinor) === 0).length
    const eligible = targets.length - alreadyPaid
    const unitCost = input.channel === 'sms' ? 30 : 10
    const estimated = eligible * unitCost

    return delay({
      recipientCount: eligible,
      estimatedCost: money(estimated),
      skipped: { alreadyPaid, optedOut: 0, quarantined: 0 },
      exceedsBalance: estimated > Number(MESSAGE_CREDITS.balance.amountMinor),
    })
  }

  /* -------------------------------------------------------- moratoire -- */

  listMoratoriums(status?: MoratoriumStatus): Promise<MoratoriumListItem[]> {
    const rows = status ? this.moratoriums.filter((row) => row.status === status) : this.moratoriums
    return delay(rows)
  }

  /*
   * Mutating a module-level array is exactly what a mock is for: the queue
   * has to empty as a bursar works it, or the screen cannot be judged. The
   * real implementation is an HTTP call and lands with HttpApi (phase 9).
   */
  approveMoratorium(id: string, note?: string): Promise<void> {
    this.decide(id, 'granted', note ?? null)
    return delay(undefined)
  }

  refuseMoratorium(id: string, note: string): Promise<void> {
    this.decide(id, 'refused', note)
    return delay(undefined)
  }

  private decide(id: string, status: MoratoriumStatus, note: string | null): void {
    this.moratoriums = this.moratoriums.map((row) =>
      row.id === id ? { ...row, status, decisionNote: note, decidedAt: new Date().toISOString() } : row,
    )
  }

  getMoratoriumPolicy(): Promise<MoratoriumPolicy> {
    return delay(this.policy)
  }

  updateMoratoriumPolicy(policy: MoratoriumPolicy): Promise<void> {
    this.policy = policy
    return delay(undefined)
  }

  listStaff(): Promise<StaffUser[]> {
    return delay(STAFF)
  }

  listAcademicYears(): Promise<AcademicYear[]> {
    return delay(ACADEMIC_YEARS)
  }

  getSettings(): Promise<TenantSettings> {
    return delay(SETTINGS)
  }

  listAuditLog(query: AuditQuery): Promise<AuditLogItem[]> {
    const rows = AUDIT_LOG.filter((entry) => {
      if (query.entityType && entry.entityType !== query.entityType) return false
      if (query.search) {
        const needle = query.search.trim().toLowerCase()
        return entry.action.toLowerCase().includes(needle) || (entry.actorName ?? '').toLowerCase().includes(needle)
      }
      return true
    })
    return delay(rows)
  }
}
