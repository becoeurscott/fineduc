/**
 * The dashboard's view of the backend.
 *
 * This interface is the ONLY thing the UI knows about data. Today it is
 * satisfied by `MockApi` because ARCHITECTURE.md §15 phases 2-8 (identity,
 * students, billing, payments, messaging, analytics) do not exist yet —
 * the API currently serves `/health` and nothing else.
 *
 * When those phases land, `HttpApi` implements this same interface against
 * the real endpoints and `getApi()` switches over. No component changes,
 * because no component imports the mock directly.
 *
 * Every type below comes from `@fineduc/contracts` — the same Zod schemas
 * the API will validate against — so "the mock and the server agree" is a
 * compile-time fact rather than a hope.
 */
import type {
  AcademicYear,
  ArrearsQuery,
  AuditLogItem,
  AuditQuery,
  CashSession,
  ClassGroup,
  CurrentUser,
  DashboardOverview,
  FeeSchedule,
  MessageCredits,
  MessageLogItem,
  MessageTemplate,
  MoratoriumListItem,
  MoratoriumPolicy,
  MoratoriumStatus,
  PaymentListItem,
  PaymentQuery,
  ReminderRule,
  SendReminderPreview,
  StaffUser,
  StudentFile,
  StudentListItem,
  StudentQuery,
  TenantSettings,
} from '@fineduc/contracts'

export type { StudentQuery, ArrearsQuery, PaymentQuery, AuditQuery }

export interface DashboardApi {
  getCurrentUser(): Promise<CurrentUser>
  getClassGroups(): Promise<ClassGroup[]>

  getOverview(): Promise<DashboardOverview>

  listStudents(query: StudentQuery): Promise<StudentListItem[]>
  getStudent(id: string): Promise<StudentFile>

  listArrears(query: ArrearsQuery): Promise<StudentListItem[]>

  listPayments(query: PaymentQuery): Promise<PaymentListItem[]>

  getOpenCashSessions(): Promise<CashSession[]>
  getCashSession(id: string): Promise<CashSession>

  listFeeSchedules(): Promise<FeeSchedule[]>

  listReminderRules(): Promise<ReminderRule[]>
  listMessageTemplates(): Promise<MessageTemplate[]>
  listMessageLog(): Promise<MessageLogItem[]>
  getMessageCredits(): Promise<MessageCredits>
  /**
   * Dry-run before any actual send. A reminder storm is a financial
   * incident (ARCHITECTURE.md §16), so the human always sees the blast
   * radius — recipient count and cost — before confirming.
   */
  previewReminder(input: { studentIds: string[]; channel: 'whatsapp' | 'sms' }): Promise<SendReminderPreview>

  /* -------------------------------------------------------- moratoire -- */

  listMoratoriums(status?: MoratoriumStatus): Promise<MoratoriumListItem[]>
  approveMoratorium(id: string, note?: string): Promise<void>
  refuseMoratorium(id: string, note: string): Promise<void>
  getMoratoriumPolicy(): Promise<MoratoriumPolicy>
  updateMoratoriumPolicy(policy: MoratoriumPolicy): Promise<void>

  listStaff(): Promise<StaffUser[]>
  listAcademicYears(): Promise<AcademicYear[]>
  getSettings(): Promise<TenantSettings>
  listAuditLog(query: AuditQuery): Promise<AuditLogItem[]>
}
