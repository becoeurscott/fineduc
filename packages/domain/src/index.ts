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

export { toTenantDate, parseTenantDate, tenantLocalToInstant } from './shared/tenant-date.js'

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

// Payments (ARCHITECTURE.md §6, §8.2, §8.3)
export { allocatePayment, assertConserved, applyAllocations } from './payments/allocation.js'
export type { AllocatableInstalment, Allocation, AllocationResult } from './payments/allocation.js'

export {
  canTransition,
  assertTransition,
  isSettled,
  initialStatus,
  statusAfterRefund,
  TERMINAL,
} from './payments/state-machine.js'
export type { PaymentStatus, PaymentMethod } from './payments/state-machine.js'

// Cash desk (ARCHITECTURE.md §8.4)
export {
  expectedClose,
  closeSession,
  assertSessionOpen,
  assertValidFloat,
  paymentMovement,
  formatReceiptNumber,
} from './cashbox/session.js'
export type { CashSessionStatus, CashMovementType, CashMovement, CloseResult } from './cashbox/session.js'

// Messaging (ARCHITECTURE.md §8.5)
export {
  decideEligibility,
  isInstalmentSettled,
  withinSendingHours,
  resolveChannel,
  DEFAULT_QUIET_HOURS,
  DEFAULT_GUARDIAN_DAILY_CAP,
} from './messaging/eligibility.js'
export type { EligibilityDecision, SendContext, SkipReason, DeferReason } from './messaging/eligibility.js'

export { render, placeholdersIn, assertTemplateSatisfiable, smsSegments } from './messaging/render.js'
export type { RenderResult } from './messaging/render.js'

export {
  MAX_MORATORIUM_DAYS,
  computeDeferredDueOn,
  effectiveDueOn,
  isMoratoriumActive,
  blocksNewRequest,
  decideMoratoriumOffer,
  decideMoratoriumRequest,
  moratoriumTransition,
} from './messaging/moratorium.js'
export type {
  MoratoriumStatus,
  MoratoriumPolicy,
  MoratoriumContext,
  MoratoriumOffer,
  MoratoriumRequestDecision,
  OfferBlockedReason,
  RequestRejection,
} from './messaging/moratorium.js'
