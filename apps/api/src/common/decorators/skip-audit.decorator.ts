import { SetMetadata } from '@nestjs/common'

/**
 * Opt out of the AuditInterceptor. Used for read-only endpoints and
 * health checks where an audit row is noise rather than signal.
 */
export const SKIP_AUDIT_KEY = 'skipAudit'
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true)
