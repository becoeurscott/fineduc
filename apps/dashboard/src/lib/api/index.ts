/**
 * The single swap point between mocked and real data.
 *
 * When ARCHITECTURE.md §15 phases 2-8 land, add an `HttpApi implements
 * DashboardApi` that calls `/api/v1/...` and flip the branch below. That
 * is the entire migration — no component imports `MockApi` directly, and
 * every type already comes from `@fineduc/contracts`, which the server
 * validates against.
 */
import { MockApi } from './mock'
import type { DashboardApi } from './types'

let instance: DashboardApi | null = null

export function getApi(): DashboardApi {
  if (!instance) {
    // TODO(phase 2-8): return new HttpApi(env.NEXT_PUBLIC_API_URL) once the
    // endpoints exist. Until then the only live endpoint is /health.
    instance = new MockApi()
  }
  return instance
}

export type { DashboardApi, StudentQuery, ArrearsQuery, PaymentQuery, AuditQuery } from './types'

/** Query keys, centralised so cache invalidation can't drift from fetching. */
export const qk = {
  currentUser: ['current-user'] as const,
  classGroups: ['class-groups'] as const,
  overview: ['overview'] as const,
  students: (q: unknown) => ['students', q] as const,
  student: (id: string) => ['student', id] as const,
  arrears: (q: unknown) => ['arrears', q] as const,
  payments: (q: unknown) => ['payments', q] as const,
  cashSessions: ['cash-sessions'] as const,
  feeSchedules: ['fee-schedules'] as const,
  reminderRules: ['reminder-rules'] as const,
  messageTemplates: ['message-templates'] as const,
  messageLog: ['message-log'] as const,
  messageCredits: ['message-credits'] as const,
  moratoriums: (status?: string) => ['moratoriums', status ?? 'all'] as const,
  moratoriumPolicy: ['moratorium-policy'] as const,
  staff: ['staff'] as const,
  academicYears: ['academic-years'] as const,
  settings: ['settings'] as const,
  auditLog: (q: unknown) => ['audit-log', q] as const,
}
