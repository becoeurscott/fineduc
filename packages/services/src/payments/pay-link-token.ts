import { randomBytes } from 'node:crypto'
import { ValidationError } from '@fineduc/domain'

/**
 * The token in a payment link: `<tenantId>.<32 random bytes, base64url>`.
 *
 * The random half is the security; the tenant half is the only way a PUBLIC
 * endpoint can find the link at all. `payment_link` is RLS-protected like
 * every other tenant table, and `GET /pay/:token` has no authenticated user
 * and therefore no tenant context — the same chicken-and-egg the payment
 * reference solves, for the same reason and in the same way.
 *
 * Guessability is unchanged: 32 random bytes is 256 bits, and knowing which
 * school a link belongs to does not help anyone guess the other half. The
 * tenant id is an opaque UUID and is not PII, which is what ARCHITECTURE.md
 * §10 actually requires of these tokens — it says they carry no PII, not
 * that they carry nothing.
 *
 * Minted by the API when a bursar shares a link, and by the worker's
 * reminder-scheduler when it attaches one to a reminder (§8.5).
 */
const SEPARATOR = '.'
const RANDOM_BYTES = 32
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PayLinkToken {
  readonly tenantId: string
  readonly secret: string
}

export function mintPayLinkToken(tenantId: string): string {
  if (!UUID_RE.test(tenantId)) {
    throw new ValidationError('pay_link_tenant_invalid', `Not a tenant id: "${tenantId}"`)
  }
  return `${tenantId}${SEPARATOR}${randomBytes(RANDOM_BYTES).toString('base64url')}`
}

/**
 * Returns null for anything malformed rather than throwing.
 *
 * This runs on unauthenticated input from a link a parent may have retyped,
 * truncated by a messaging app, or had mangled by a link preview. A 404 is
 * the right answer to all of those, and it is also the right answer to a
 * probe — telling the difference between "malformed" and "not found" would
 * confirm which tenants exist.
 */
export function parsePayLinkToken(token: string | undefined | null): PayLinkToken | null {
  if (!token) return null
  const index = token.indexOf(SEPARATOR)
  if (index <= 0) return null

  const tenantId = token.slice(0, index)
  const secret = token.slice(index + 1)
  if (!UUID_RE.test(tenantId) || secret.length === 0) return null

  return { tenantId, secret }
}
