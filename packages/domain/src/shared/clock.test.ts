import { describe, it, expect } from 'vitest'
import { FakeClock, SystemClock } from './clock.js'

describe('SystemClock', () => {
  it('returns the current time', () => {
    const clock = new SystemClock()
    const now = clock.now()
    expect(now).toBeInstanceOf(Date)
    expect(now.getTime()).toBeGreaterThan(1_700_000_000_000)
  })

  it('returns today as YYYY-MM-DD in a timezone', () => {
    const clock = new SystemClock()
    const today = clock.today('Africa/Douala')
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('FakeClock', () => {
  it('returns the fixed time', () => {
    const fixed = new Date('2026-09-15T10:30:00Z')
    const clock = new FakeClock(fixed)
    expect(clock.now()).toBe(fixed)
  })

  it('resolves today in a timezone', () => {
    // 2026-09-15 23:30 UTC = 2026-09-16 00:30 in Africa/Douala (UTC+1)
    const clock = new FakeClock(new Date('2026-09-15T23:30:00Z'))
    expect(clock.today('Africa/Douala')).toBe('2026-09-16')
    expect(clock.today('UTC')).toBe('2026-09-15')
  })

  it('advances by milliseconds', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00Z'))
    clock.advance(3600_000) // 1 hour
    expect(clock.now().toISOString()).toBe('2026-01-01T01:00:00.000Z')
  })

  it('can be set to a specific time', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00Z'))
    const newTime = new Date('2027-06-15T12:00:00Z')
    clock.set(newTime)
    expect(clock.now()).toBe(newTime)
  })
})
