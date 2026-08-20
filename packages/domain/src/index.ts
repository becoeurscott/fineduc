/**
 * Public surface of @fineduc/domain. This package imports NOTHING from
 * the monorepo — it is a pure leaf (ARCHITECTURE.md §3).
 */

// Shared utilities
export { SystemClock, FakeClock } from './shared/clock.js'
export type { Clock } from './shared/clock.js'

export {
  DomainError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
  InvalidStateError,
  AuthenticationError,
} from './shared/errors.js'

export { toTenantDate, parseTenantDate } from './shared/tenant-date.js'

// Billing (ARCHITECTURE.md §6, §8.1)
export {
  computeScheduleTotal,
  assertEditable,
  assertPublishable,
  buildInvoiceLines,
  sumLines,
} from './billing/fee-schedule.js'
export type {
  FeeCategory,
  FeeScheduleStatus,
  FeeItem,
  FeeSchedule,
  InvoiceLineDraft,
} from './billing/fee-schedule.js'

export { resolveDiscount, resolveDiscountStack, siblingDiscount } from './billing/discounts.js'
export type { DiscountType, DiscountMethod, DiscountRequest, DiscountDraft } from './billing/discounts.js'

export {
  addCalendarDays,
  expandInstalments,
  assertInstalmentsCoverNet,
  instalmentStatus,
  byOldestDue,
} from './billing/instalments.js'
export type { InstalmentStatus, InstalmentTemplate, InstalmentDraft } from './billing/instalments.js'

export { post, postAll, reverse, replayBalance, assertLedgerConsistent, projectInvoice } from './billing/ledger.js'
export type { LedgerEntryType, LedgerEntryDraft, LedgerPosting } from './billing/ledger.js'
