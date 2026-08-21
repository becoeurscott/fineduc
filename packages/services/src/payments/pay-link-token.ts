import { mintTenantToken, parseTenantToken, type TenantToken } from '../shared/tenant-token.js'

/**
 * The token in a payment link: `<tenantId>.<32 random bytes, base64url>`.
 *
 * The scheme itself now lives in `shared/tenant-token.ts`, because the
 * moratoire chat link needs the identical thing and two copies of a security
 * primitive is one copy too many. These stay as named aliases so the call
 * sites read in the language of the thing they are doing — a pay link, not
 * "a tenant token that happens to be for paying" — and so the error code a
 * malformed tenant id raises still names the payment path.
 *
 * Minted by the API when a bursar shares a link, and by the worker's
 * reminder-scheduler when it attaches one to a reminder (§8.5).
 */
export type PayLinkToken = TenantToken

export function mintPayLinkToken(tenantId: string): string {
  return mintTenantToken(tenantId, 'pay_link_tenant_invalid')
}

export function parsePayLinkToken(token: string | undefined | null): PayLinkToken | null {
  return parseTenantToken(token)
}
