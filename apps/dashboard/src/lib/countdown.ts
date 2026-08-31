/**
 * Time left before a deadline, split for display.
 *
 * Pure and dependency-free, so it can be tested without a DOM or a React
 * tree — the arithmetic is the part worth pinning, not the markup.
 */

export interface Remaining {
  readonly days: number
  readonly hours: number
  readonly minutes: number
  readonly seconds: number
  /** Milliseconds left, clamped at zero. */
  readonly total: number
}

/**
 * Clamped at zero rather than going negative: past the deadline a countdown
 * reading "-3 days" is nonsense, and the caller shows lapsed copy by then.
 *
 * Truncates rather than rounds, so 23:59:59 remaining is zero days and not
 * one — a school told it has "1 day" on the final evening would plan for a
 * tomorrow it does not have.
 */
export function remainingUntil(target: number, now: number): Remaining {
  const total = Math.max(0, target - now)
  const seconds = Math.floor(total / 1000)
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
    seconds: seconds % 60,
    total,
  }
}

/** Two digits, so the clock does not jitter in width as it ticks. */
export const pad = (n: number): string => String(n).padStart(2, '0')
