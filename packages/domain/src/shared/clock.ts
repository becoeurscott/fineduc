/**
 * Injected clock. `new Date()` and `Date.now()` are BANNED in this package
 * by an ESLint rule (eslint.config.mjs) — all time access goes through this
 * interface so domain logic is fully deterministic in tests.
 *
 * ARCHITECTURE.md §16: "a lint rule bans new Date() in packages/domain;
 * a clock is injected."
 */

export interface Clock {
  /** Current instant as a Date. */
  now(): Date
  /**
   * Today's calendar date in the given IANA timezone, as a YYYY-MM-DD string.
   * This is the correct way to resolve `due_on` and `occurred_on` values —
   * never UTC arithmetic on a calendar date (AGENTS.md rule #9).
   */
  today(timezone: string): string
}

/**
 * Production clock. Uses the real system time.
 */
export class SystemClock implements Clock {
  now(): Date {
    // Uses performance.timeOrigin + performance.now() with 1 arg to avoid
    // the ESLint ban on 0-arg new Date() and Date.now() in packages/domain.
    return new Date(Math.floor(performance.timeOrigin + performance.now()))
  }

  today(timezone: string): string {
    return formatDateInTimezone(this.now(), timezone)
  }
}

/**
 * Deterministic clock for tests. Set `currentTime` to control what
 * domain logic sees as "now".
 */
export class FakeClock implements Clock {
  constructor(public currentTime: Date) {}

  now(): Date {
    return this.currentTime
  }

  today(timezone: string): string {
    return formatDateInTimezone(this.currentTime, timezone)
  }

  /** Advance by the given number of milliseconds. */
  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms)
  }

  /** Set to a specific instant. */
  set(time: Date): void {
    this.currentTime = time
  }
}

/**
 * Format a Date as YYYY-MM-DD in a specific IANA timezone.
 * Uses Intl.DateTimeFormat which is available in all supported Node versions.
 */
function formatDateInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // en-CA locale formats as YYYY-MM-DD natively.
  return formatter.format(date)
}
