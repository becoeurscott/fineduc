/**
 * Per-tenant payment settings, stored at `tenant.settings.payments`.
 *
 * Online fee collection is OPTIONAL. Plenty of schools run on cash and
 * bank transfer, already record those by hand in the cashbox, and have no
 * aggregator account to collect into — so a school opts in rather than
 * having a payment channel it never asked for. Everything else in the
 * product (invoices, instalments, arrears, reminders, the moratoire) works
 * exactly the same either way; only the pay link and the online rails are
 * gated by this.
 *
 * `enabled` defaults to FALSE. A default of true would put a live checkout
 * in front of a parent for a school that never configured one, and the
 * money would land in the platform's aggregator account rather than the
 * school's. Off-by-default is the only safe way round.
 *
 * Same two-schema split as the messaging settings and the moratoire policy:
 * strict for the API write, lenient for the read on the pay path — a
 * malformed blob must degrade to "online payments off", never to a checkout
 * that cannot settle.
 */
import { z } from 'zod'

export const TenantPaymentSettingsInputSchema = z.object({
  /** Whether parents may pay online at all. Off until a school turns it on. */
  enabled: z.boolean(),
  /**
   * Which rails the school offers. Empty means "every rail the provider
   * supports" rather than "none" — a school that enables payments without
   * naming operators wants the provider's own list, not a dead checkout.
   */
  operators: z.array(z.enum(['mtn', 'orange', 'moov', 'wave', 'card'])).default([]),
})
export type TenantPaymentSettings = z.infer<typeof TenantPaymentSettingsInputSchema>

/** What a school gets before it has decided anything. */
export const DEFAULT_PAYMENT_SETTINGS: TenantPaymentSettings = {
  enabled: false,
  operators: [],
}

const LenientPaymentSchema = z.object({
  enabled: z.boolean().catch(DEFAULT_PAYMENT_SETTINGS.enabled),
  operators: z
    .array(z.enum(['mtn', 'orange', 'moov', 'wave', 'card']))
    .catch([...DEFAULT_PAYMENT_SETTINGS.operators]),
})

/**
 * Read the payment settings out of a whole `tenant.settings` blob.
 *
 * Every branch has to survive nonsense: this runs on the public pay page,
 * and a throw there is a 500 in front of a parent. Field-level `.catch()`
 * only helps once the value is an object at all, so a `payments` key holding
 * a string or a number is replaced before parsing rather than parsed and
 * caught.
 */
export function readPaymentSettings(settings: unknown): TenantPaymentSettings {
  const container = typeof settings === 'object' && settings !== null ? (settings as Record<string, unknown>) : {}
  const raw = container['payments']
  const candidate = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}
  return LenientPaymentSchema.parse(candidate)
}
