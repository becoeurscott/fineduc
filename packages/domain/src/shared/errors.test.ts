import { describe, it, expect } from 'vitest'
import {
  DomainError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
  InvalidStateError,
  AuthenticationError,
} from './errors.js'

describe('DomainError hierarchy', () => {
  it('NotFoundError has a derived code', () => {
    const error = new NotFoundError('student', 'abc-123')
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error.code).toBe('STUDENT_NOT_FOUND')
    expect(error.message).toBe('student not found: abc-123')
    expect(error.name).toBe('NotFoundError')
  })

  it('NotFoundError handles multi-word entity types', () => {
    const error = new NotFoundError('fee schedule', 'xyz')
    expect(error.code).toBe('FEE_SCHEDULE_NOT_FOUND')
  })

  it('ConflictError carries a custom code', () => {
    const error = new ConflictError('DUPLICATE_ENROLLMENT', 'already enrolled')
    expect(error).toBeInstanceOf(DomainError)
    expect(error.code).toBe('DUPLICATE_ENROLLMENT')
    expect(error.message).toBe('already enrolled')
  })

  it('ForbiddenError carries a custom code', () => {
    const error = new ForbiddenError('INSUFFICIENT_ROLE', 'director only')
    expect(error).toBeInstanceOf(DomainError)
    expect(error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('ValidationError can carry field-level details', () => {
    const error = new ValidationError('AMOUNT_MISMATCH', 'sum != net', {
      instalments: 'sum 180001 != net 180000',
    })
    expect(error).toBeInstanceOf(DomainError)
    expect(error.code).toBe('AMOUNT_MISMATCH')
    expect(error.fields).toEqual({ instalments: 'sum 180001 != net 180000' })
  })

  it('ValidationError fields are optional', () => {
    const error = new ValidationError('BAD_INPUT', 'bad')
    expect(error.fields).toBeUndefined()
  })

  it('InvalidStateError carries a custom code', () => {
    const error = new InvalidStateError('SESSION_ALREADY_CLOSED', 'cannot close')
    expect(error).toBeInstanceOf(DomainError)
    expect(error.code).toBe('SESSION_ALREADY_CLOSED')
  })

  it('AuthenticationError carries a custom code', () => {
    const error = new AuthenticationError('INVALID_CREDENTIALS', 'bad password')
    expect(error).toBeInstanceOf(DomainError)
    expect(error.code).toBe('INVALID_CREDENTIALS')
  })
})
