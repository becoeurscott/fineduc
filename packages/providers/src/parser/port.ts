/**
 * The date-request parser port.
 *
 * Parses free-text delay requests (French or English) into a number of days
 * from the school's allowlist, or null when the text is unparseable. The
 * domain still decides whether the duration is valid — this port only maps
 * human language to a number.
 */
export interface ParseDelayResult {
  /** A value from `allowedDays`, or null when the text cannot be mapped. */
  readonly days: number | null
}

export interface DateRequestParser {
  readonly name: string

  /**
   * @param text       Free-form text from a parent ("après la paie du mois")
   * @param allowedDays The school's configured durations, e.g. [7, 14, 21]
   * @param locale     'fr' | 'en'
   */
  parse(text: string, allowedDays: readonly number[], locale: string): Promise<ParseDelayResult>
}
