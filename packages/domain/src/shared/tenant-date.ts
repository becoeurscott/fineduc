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
