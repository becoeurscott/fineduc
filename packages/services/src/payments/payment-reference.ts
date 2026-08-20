import { ValidationError } from '@fineduc/domain'

/**
 * OUR reference for a payment attempt — the string we hand the aggregator
 * and that it echoes back on the webhook.
 *
 * It carries the tenant id, and that is not incidental: it is the ONLY way
 * the worker can know which tenant a callback belongs to.
 *
 * The chicken-and-egg it solves: `provider_event` deliberately carries no
 * RLS, because the tenant is unknown until the payload is parsed. But
 * `payment` IS tenant-scoped, so the worker cannot look up the tenant from
 * `provider_ref` without already having a tenant context. Something has to
 * break the cycle, and the reference is the only value that travels out to
 * the aggregator and back under our control.
 *
 * A tenant UUID is opaque and is not PII, so putting it in front of a
 * provider costs nothing. The alternatives all cost more: a second
 * RLS-exempt lookup table, or a `SECURITY DEFINER` function that reads
 * across tenants — a permanent hole in the isolation guarantee, opened to
 * save one string.
 */
const SEPARATOR = ':'
const PREFIX = 'fd'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PaymentReference {
  readonly tenantId: string
  readonly paymentId: string
}

/** `fd:<tenantId>:<paymentId>` */
export function encodePaymentReference(reference: PaymentReference): string {
  if (!UUID_RE.test(reference.tenantId)) {
    throw new ValidationError('payment_reference_tenant_invalid', `Not a tenant id: "${reference.tenantId}"`)
  }
  if (!UUID_RE.test(reference.paymentId)) {
    throw new ValidationError('payment_reference_payment_invalid', `Not a payment id: "${reference.paymentId}"`)
  }
  return [PREFIX, reference.tenantId, reference.paymentId].join(SEPARATOR)
}

/**
 * Returns null rather than throwing for anything that is not one of ours.
 *
 * A webhook can legitimately carry a reference we did not mint — a test
 * callback from an aggregator's dashboard, or another system sharing the
 * account. The caller decides what to do about it; this only reports that it
 * cannot resolve a tenant, and the worker then fails the job loudly rather
 * than guessing (ARCHITECTURE.md §11).
 */
export function decodePaymentReference(reference: string | undefined | null): PaymentReference | null {
  if (!reference) return null
  const parts = reference.split(SEPARATOR)
  if (parts.length !== 3) return null
  const [prefix, tenantId, paymentId] = parts as [string, string, string]
  if (prefix !== PREFIX) return null
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(paymentId)) return null
  return { tenantId, paymentId }
}
