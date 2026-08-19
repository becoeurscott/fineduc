/**
 * Typed domain errors (AGENTS.md: "typed domain errors in domain, mapped to
 * RFC 9457 problem+json at the HTTP edge. Never throw a bare Error with a
 * string for something a client must handle.")
 *
 * Each error carries a machine-readable `code` (e.g. 'STUDENT_NOT_FOUND')
 * and a human message. The HTTP layer maps `DomainError` subclasses to the
 * appropriate status code; the domain itself has no HTTP concepts.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string

  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

/**
 * The requested entity does not exist (or is not visible to the current tenant).
 * HTTP edge: 404.
 */
export class NotFoundError extends DomainError {
  readonly code: string

  constructor(entityType: string, identifier: string) {
    super(`${entityType} not found: ${identifier}`)
    this.code = `${entityType.toUpperCase().replace(/\s+/g, '_')}_NOT_FOUND`
  }
}

/**
 * A uniqueness or state constraint prevents the operation (e.g. duplicate
 * enrolment, already-published fee schedule).
 * HTTP edge: 409.
 */
export class ConflictError extends DomainError {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * The authenticated user does not have the permission for this action.
 * HTTP edge: 403.
 */
export class ForbiddenError extends DomainError {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * A business rule was violated (e.g. instalment amounts don't sum to net,
 * discount exceeds remaining balance).
 * HTTP edge: 422.
 */
export class ValidationError extends DomainError {
  readonly code: string
  readonly fields?: Record<string, string>

  constructor(code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.code = code
    this.fields = fields
  }
}

/**
 * An illegal state transition was attempted (e.g. closing an already-closed
 * cash session, paying a cancelled instalment).
 * HTTP edge: 409.
 */
export class InvalidStateError extends DomainError {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Authentication failed (bad credentials, expired token, locked account).
 * HTTP edge: 401.
 */
export class AuthenticationError extends DomainError {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
