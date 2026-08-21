import { describe, it, expect } from 'vitest'
import { toTenantDate, parseTenantDate, tenantLocalToInstant } from './tenant-date.js'

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

describe('tenantLocalToInstant', () => {
  it('resolves a wall-clock hour to the right instant in a fixed-offset zone', () => {
    // Africa/Douala is UTC+1 all year — 09:00 local is 08:00Z.
    const instant = tenantLocalToInstant('2026-09-15', 9, 'Africa/Douala')
    expect(instant.toISOString()).toBe('2026-09-15T08:00:00.000Z')
  })

  it('round-trips through toTenantDate', () => {
    const instant = tenantLocalToInstant('2026-09-15', 9, 'Africa/Douala')
    expect(toTenantDate(instant, 'Africa/Douala')).toBe('2026-09-15')
  })

  /**
   * The reason this function exists rather than "add one hour to a UTC
   * midnight". Morocco sits at UTC+1 all year EXCEPT during Ramadan, when it
   * drops to UTC+0 — a real, moving, non-obvious offset change. A reminder
   * built with a constant offset goes out an hour wrong for a month, every
   * year, on a date that shifts.
   *
   * 2026-03-01 falls inside Ramadan; 2026-06-15 does not (verified against
   * this Node's ICU data, not assumed).
   */
  it('follows a zone whose offset changes during the year', () => {
    const duringRamadan = tenantLocalToInstant('2026-03-01', 9, 'Africa/Casablanca')
    const after = tenantLocalToInstant('2026-06-15', 9, 'Africa/Casablanca')

    expect(duringRamadan.toISOString()).toBe('2026-03-01T09:00:00.000Z') // UTC+0
    expect(after.toISOString()).toBe('2026-06-15T08:00:00.000Z') // UTC+1

    // Both still read back as 09:00 on the right calendar day, which is the
    // property that actually matters to a parent.
    expect(toTenantDate(duringRamadan, 'Africa/Casablanca')).toBe('2026-03-01')
    expect(toTenantDate(after, 'Africa/Casablanca')).toBe('2026-06-15')
  })

  it('handles midnight, where some ICU builds report hour 24', () => {
    const instant = tenantLocalToInstant('2026-09-15', 0, 'Africa/Douala')
    expect(toTenantDate(instant, 'Africa/Douala')).toBe('2026-09-15')
    expect(instant.toISOString()).toBe('2026-09-14T23:00:00.000Z')
  })

  it('rejects something that is not an hour', () => {
    expect(() => tenantLocalToInstant('2026-09-15', 24, 'Africa/Douala')).toThrow(RangeError)
    expect(() => tenantLocalToInstant('2026-09-15', -1, 'Africa/Douala')).toThrow(RangeError)
  })
})
