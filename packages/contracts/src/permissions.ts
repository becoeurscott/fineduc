/**
 * The RBAC capability matrix from ARCHITECTURE.md §10, as data.
 *
 * Shared between the API guard and the dashboard so the two can never
 * disagree about who may do what. The dashboard uses it to hide what a
 * role cannot do; the API uses it to REFUSE what a role cannot do. The UI
 * check is a courtesy — the server check is the security boundary, and
 * hiding a button is never a substitute for it.
 */
import type { Role } from './common.js'

export const CAPABILITIES = [
  'dashboard.view',
  'students.view',
  'students.edit',
  'fees.publish',
  'discounts.grant',
  'payments.record_cash',
  'cash_session.close_own',
  'cash_session.reconcile',
  'payments.refund',
  'reminders.send',
  'reminders.configure',
  'users.manage',
  'data.export',
  'audit.view',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/** `true` = allowed; `'requires_approval'` = allowed but needs a second, different user (four-eyes). */
type Grant = true | 'requires_approval'

const MATRIX: Record<Role, Partial<Record<Capability, Grant>>> = {
  director: {
    'dashboard.view': true,
    'students.view': true,
    'students.edit': true,
    'fees.publish': true,
    'discounts.grant': true,
    'payments.record_cash': true,
    'cash_session.close_own': true,
    'cash_session.reconcile': true,
    'payments.refund': 'requires_approval',
    'reminders.send': true,
    'reminders.configure': true,
    'users.manage': true,
    'data.export': true,
    'audit.view': true,
  },
  bursar: {
    'dashboard.view': true,
    'students.view': true,
    'students.edit': true,
    'fees.publish': true,
    'discounts.grant': 'requires_approval',
    'payments.record_cash': true,
    'cash_session.close_own': true,
    'payments.refund': 'requires_approval',
    'reminders.send': true,
    'reminders.configure': true,
    'data.export': true,
    'audit.view': true,
  },
  cashier: {
    'payments.record_cash': true,
    'cash_session.close_own': true,
    'students.view': true,
  },
  secretary: {
    'students.view': true,
    'students.edit': true,
    'reminders.send': true,
  },
  auditor: {
    'dashboard.view': true,
    'students.view': true,
    'data.export': true,
    'audit.view': true,
  },
}

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role][capability] !== undefined
}

export function requiresApproval(role: Role, capability: Capability): boolean {
  return MATRIX[role][capability] === 'requires_approval'
}

export function capabilitiesFor(role: Role): Capability[] {
  return CAPABILITIES.filter((capability) => can(role, capability))
}
