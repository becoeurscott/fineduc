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
