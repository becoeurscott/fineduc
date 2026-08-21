import type { DateRequestParser, ParseDelayResult } from '../port.js'

/**
 * Deterministic fake for tests. Recognises patterns like "7 jours",
 * "2 semaines", "3 weeks", "14 days" and maps them to the closest allowed
 * duration. Everything else returns null.
 */
export class FakeDateRequestParser implements DateRequestParser {
  readonly name = 'fake'

  async parse(text: string, allowedDays: readonly number[]): Promise<ParseDelayResult> {
    const cleaned = text.trim().toLowerCase()

    let requestedDays: number | null = null

    const weekMatch = cleaned.match(/(\d+)\s*semaine|(\d+)\s*week/)
    if (weekMatch) {
      requestedDays = (Number(weekMatch[1] ?? weekMatch[2])) * 7
    }

    const dayMatch = cleaned.match(/(\d+)\s*jour|(\d+)\s*day/)
    if (dayMatch) {
      requestedDays = Number(dayMatch[1] ?? dayMatch[2])
    }

    if (requestedDays === null) return { days: null }

    const exact = allowedDays.includes(requestedDays) ? requestedDays : null
    if (exact !== null) return { days: exact }

    // Pick the closest allowed duration
    let closest: number | null = null
    let minDist = Infinity
    for (const d of allowedDays) {
      const dist = Math.abs(d - requestedDays)
      if (dist < minDist) {
        minDist = dist
        closest = d
      }
    }
    return { days: closest }
  }
}
