import { randomBytes } from 'node:crypto'
import { ValidationError } from '@fineduc/domain'

/**
 * `<tenantId>.<32 random bytes, base64url>` — the shape of every token this
 * system hands to a parent.
 *
 * The random half is the security; the tenant half is the only way a PUBLIC
 * endpoint can find the row at all. Every table one of these points at is
 * RLS-protected, and a public endpoint has no authenticated user and
 * therefore no tenant context — the same chicken-and-egg the payment
 * reference solves, for the same reason and in the same way.
 *
 * Guessability is unchanged: 32 random bytes is 256 bits, and knowing which
 * school a link belongs to does not help anyone guess the other half. The
 * tenant id is an opaque UUID and is not PII, which is what ARCHITECTURE.md
 * §10 actually requires of these tokens — it says they carry no PII, not
 * that they carry nothing.
 *
 * Generalised out of `payments/pay-link-token.ts` when the moratoire chat
 * link needed the identical scheme. Two copies of a security primitive is
 * one copy too many: the day someone shortens the random half or loosens the
 * parse, it has to happen in one place or not at all.
 */
const SEPARATOR = '.'
const RANDOM_BYTES = 32
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TenantToken {
  readonly tenantId: string
  readonly secret: string
}

export function mintTenantToken(tenantId: string, errorCode = 'tenant_token_tenant_invalid'): string {
  if (!UUID_RE.test(tenantId)) {
    throw new ValidationError(errorCode, `Not a tenant id: "${tenantId}"`)
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
export function parseTenantToken(token: string | undefined | null): TenantToken | null {
  if (!token) return null
  const index = token.indexOf(SEPARATOR)
  if (index <= 0) return null

  const tenantId = token.slice(0, index)
  const secret = token.slice(index + 1)
  if (!UUID_RE.test(tenantId) || secret.length === 0) return null

  return { tenantId, secret }
}
