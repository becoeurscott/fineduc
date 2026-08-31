import { describe, it, expect } from 'vitest'
import { remainingUntil, pad } from './countdown'

/**
 * The countdown a school watches before it is locked out. Wrong in either
 * direction is bad: a banner reading "2 h left" while the guard is already
 * refusing requests looks like the product is broken, and one that hits zero
 * early tells a school it has lost access it still has.
 */

const SEC = 1_000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('remainingUntil', () => {
  it('splits a duration into days, hours, minutes and seconds', () => {
    const now = 1_000_000
    expect(remainingUntil(now + 2 * DAY + 3 * HOUR + 4 * MIN + 5 * SEC, now)).toMatchObject({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
    })
  })

  /**
   * Truncation, not rounding. A school told it has "1 day" on the final
   * evening would plan for a tomorrow it does not have.
   */
  it('treats 23:59:59 as zero days, never one', () => {
    expect(remainingUntil(23 * HOUR + 59 * MIN + 59 * SEC, 0)).toMatchObject({
      days: 0,
      hours: 23,
      minutes: 59,
      seconds: 59,
    })
  })

  it('reaches exactly zero at the deadline', () => {
    const now = 5_000_000
    expect(remainingUntil(now, now)).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 })
  })

  it('clamps at zero once the deadline has passed', () => {
    const now = 5_000_000
    const left = remainingUntil(now - 3 * DAY, now)
    expect(left.total).toBe(0)
    expect(left).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })

  it('counts whole days across a full period', () => {
    expect(remainingUntil(30 * DAY, 0).days).toBe(30)
  })

  it('does not gain a second from sub-second remainder', () => {
    expect(remainingUntil(999, 0).seconds).toBe(0)
    expect(remainingUntil(1_000, 0).seconds).toBe(1)
  })
})

describe('pad', () => {
  it('keeps the clock a fixed width so it does not jitter', () => {
    expect(pad(0)).toBe('00')
    expect(pad(7)).toBe('07')
    expect(pad(59)).toBe('59')
  })
})
