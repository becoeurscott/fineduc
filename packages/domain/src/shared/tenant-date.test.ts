import { describe, it, expect } from 'vitest'
import { toTenantDate, parseTenantDate } from './tenant-date.js'

describe('toTenantDate', () => {
  it('converts UTC instant to Africa/Douala date (UTC+1)', () => {
    // 23:30 UTC = 00:30 next day in Douala
    const result = toTenantDate(new Date('2026-09-15T23:30:00Z'), 'Africa/Douala')
    expect(result).toBe('2026-09-16')
  })

  it('same instant is still the same day when timezone matches', () => {
    const result = toTenantDate(new Date('2026-09-15T23:30:00Z'), 'UTC')
    expect(result).toBe('2026-09-15')
  })

  it('handles Africa/Lagos (UTC+1, same as Douala)', () => {
    const result = toTenantDate(new Date('2026-12-31T23:30:00Z'), 'Africa/Lagos')
    expect(result).toBe('2027-01-01')
  })

  it('handles a date mid-day unambiguously', () => {
    const result = toTenantDate(new Date('2026-06-15T12:00:00Z'), 'Africa/Douala')
    expect(result).toBe('2026-06-15')
  })
})

describe('parseTenantDate', () => {
  it('parses a valid YYYY-MM-DD', () => {
    expect(parseTenantDate('2026-09-15')).toEqual({ year: 2026, month: 9, day: 15 })
  })

  it('parses a date with leading zeros', () => {
    expect(parseTenantDate('2026-01-05')).toEqual({ year: 2026, month: 1, day: 5 })
  })

  it('rejects invalid formats', () => {
    expect(() => parseTenantDate('15-09-2026')).toThrow('Invalid date format')
    expect(() => parseTenantDate('2026/09/15')).toThrow('Invalid date format')
    expect(() => parseTenantDate('not-a-date')).toThrow('Invalid date format')
    expect(() => parseTenantDate('')).toThrow('Invalid date format')
  })
})
