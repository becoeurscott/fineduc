/**
 * Convert a UTC instant to a calendar date (YYYY-MM-DD) in the tenant's
 * timezone. This is the correct way to produce `due_on`, `occurred_on`,
 * `enrolled_on` and every other DATE column — never UTC arithmetic
 * (AGENTS.md rule #9: "`due_on` is a DATE in the tenant's timezone.
 * Never a timestamp, never UTC arithmetic on a due date.").
 *
 * Uses Intl.DateTimeFormat which handles DST correctly and is available in
 * all supported Node versions. The en-CA locale formats as YYYY-MM-DD
 * natively, avoiding manual string assembly.
 */
export function toTenantDate(instant: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(instant)
}

/**
 * Parse a YYYY-MM-DD date string into its components. Does NOT convert to a
 * Date object — that would silently apply a timezone, which is exactly the
 * bug this function exists to prevent. When a calendar date needs to become
 * a Date (e.g. for Prisma's @db.Date), use `new Date('YYYY-MM-DD')` which
 * gives midnight UTC and is correct for a DATE column.
 */
export function parseTenantDate(dateStr: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) {
    throw new RangeError(`Invalid date format: "${dateStr}" — expected YYYY-MM-DD`)
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

/**
 * The offset of a timezone AT a given instant, in milliseconds east of UTC.
 *
 * Derived by formatting the instant in that zone and reading the wall-clock
 * fields back, because there is no API that just tells you. `hour` can come
 * back as 24 for midnight in some ICU builds, hence the `% 24`.
 */
function offsetAt(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const field = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour') % 24,
    field('minute'),
    field('second'),
  )
  return asUtc - instant.getTime()
}

/**
 * The INSTANT at which a given wall-clock hour occurs on a given calendar
 * date in the tenant's timezone. The inverse of `toTenantDate`.
 *
 * This is the one place in the reminder path where DST can bite. A reminder
 * is scheduled as "09:00 on the 15th, local", and storing that as a
 * timestamptz means resolving the offset — which is not a constant for a
 * zone, only for a zone AT AN INSTANT. Africa/Douala never changes, but
 * Africa/Casablanca does, and building this by adding hours to a UTC
 * midnight would silently send an hour early or late for part of the year.
 *
 * Two passes: guess the offset at the naive instant, then re-read it at the
 * corrected one, because the guess can land on the wrong side of a
 * transition. On a spring-forward day the requested wall time may not exist
 * at all; the result is then the nearest instant that does, which is the
 * right answer for "send at 09:00" and the only available one.
 */
export function tenantLocalToInstant(date: string, hour: number, timezone: string): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Not an hour of the day: ${hour}`)
  }
  const { year, month, day } = parseTenantDate(date)

  const naive = Date.UTC(year, month - 1, day, hour, 0, 0)
  const firstGuess = new Date(naive - offsetAt(new Date(naive), timezone))
  const corrected = new Date(naive - offsetAt(firstGuess, timezone))
  return corrected
}
