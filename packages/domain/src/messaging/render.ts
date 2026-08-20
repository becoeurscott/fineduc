/**
 * Rendering a message template (ARCHITECTURE.md §8.5).
 *
 * Deliberately not a template engine. The bodies are short, they are written
 * by a bursar rather than a developer, and they are sent to real families —
 * so the substitution is `{{name}}` and nothing else. No expressions, no
 * loops, no conditionals: a template language in a message body is a way for
 * a typo to become an exception at 07:00, or for user input to become code.
 */
import { ValidationError } from '../shared/errors.js'

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

export interface RenderResult {
  readonly body: string
  /** Placeholders the template asked for that the caller did not supply. */
  readonly missing: string[]
}

/**
 * Substitute `{{variable}}`.
 *
 * An unknown placeholder is REPORTED, not silently blanked. A message that
 * reads "Bonjour , vous devez  FCFA" is worse than no message: it tells a
 * family the school does not know who they are, and it is the kind of thing
 * nobody notices until a parent forwards a screenshot.
 */
export function render(template: string, variables: Readonly<Record<string, string>>): RenderResult {
  const missing: string[] = []
  const body = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name]
    if (value === undefined || value === null) {
      missing.push(name)
      // Leave the placeholder visible rather than blanking it: a caller that
      // ignores `missing` at least ships something obviously broken instead
      // of something subtly wrong.
      return `{{${name}}}`
    }
    return value
  })
  return { body, missing: [...new Set(missing)] }
}

/** The placeholders a template uses, for validating one at save time. */
export function placeholdersIn(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string))]
}

/**
 * Reject a template that asks for something the sender cannot supply, at the
 * moment it is SAVED rather than at 02:00 when a job fans it out to four
 * hundred families.
 */
export function assertTemplateSatisfiable(template: string, available: readonly string[]): void {
  const supported = new Set(available)
  const unknown = placeholdersIn(template).filter((name) => !supported.has(name))
  if (unknown.length > 0) {
    throw new ValidationError(
      'template_unknown_variable',
      `This template uses ${unknown.map((n) => `{{${n}}}`).join(', ')}, which the sender cannot fill. Available: ${available.join(', ')}.`,
    )
  }
}

/**
 * A single SMS is 160 GSM-7 characters, or 70 if any character forces UCS-2.
 *
 * Which French accents force it is genuinely surprising, and guessing gets it
 * wrong: `é è à ù ì ò ä ö ñ ü É Ç` are all in the GSM-7 set, so "échéance",
 * "élève" and "scolarité" cost nothing extra. But lowercase `ç ê â î ô û ë ï`
 * are NOT — so "reçu", "français" and "coût" more than halve every segment
 * and roughly double the bill. "Reçu" is a word this product sends on every
 * cash payment.
 *
 * Counting it here lets the sender price a message before sending, and lets a
 * bursar see the cost of one letter while they are still writing.
 */
export function smsSegments(body: string): { readonly segments: number; readonly encoding: 'GSM-7' | 'UCS-2' } {
  // The GSM-7 basic set plus its common extensions, near enough for costing.
  const gsm7 = /^[A-Za-z0-9@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\r\n^{}[\]~|€]*$/
  const isGsm7 = gsm7.test(body)
  const single = isGsm7 ? 160 : 70
  const concatenated = isGsm7 ? 153 : 67

  const length = [...body].length
  if (length === 0) return { segments: 0, encoding: isGsm7 ? 'GSM-7' : 'UCS-2' }
  const segments = length <= single ? 1 : Math.ceil(length / concatenated)
  return { segments, encoding: isGsm7 ? 'GSM-7' : 'UCS-2' }
}
