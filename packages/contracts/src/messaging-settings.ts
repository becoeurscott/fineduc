/**
 * Per-tenant messaging settings, stored at `tenant.settings.messaging`.
 *
 * `decideEligibility` in packages/domain needs quiet hours, a guardian cap,
 * a tenant cap and a send hour, and no column exists for any of them. They
 * live in the settings JSON rather than on `tenant` because they are read
 * once per tenant per sender tick and never filtered on, joined or indexed —
 * a column earns its place when an index uses it. ARCHITECTURE.md already
 * settles this ("a boolean in `tenant.settings`", revisited at 100 schools).
 *
 * The prepaid CREDIT BALANCE is deliberately NOT here. It is money, its
 * truth is the append-only `message_credit_ledger`, and a copy in a JSON
 * blob would be a projection written outside the ledger transaction that
 * changes it (AGENTS.md rule #3).
 *
 * Same two-schema split as the moratoire policy: strict for the API write,
 * lenient for the 02:00 read.
 */
import { z } from 'zod'

export const QuietHoursSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
})
export type QuietHours = z.infer<typeof QuietHoursSchema>

export const TenantMessagingSettingsInputSchema = z.object({
  /** Tenant-local hour the nightly scheduler aims reminders at. */
  sendHour: z.number().int().min(0).max(23),
  /** Sending is allowed from `startHour` inclusive to `endHour` exclusive. */
  quietHours: QuietHoursSchema,
  /** Messages one guardian may receive in a tenant-local day. */
  guardianDailyCap: z.number().int().min(1).max(10),
  /** The whole school's daily ceiling — the anti-reminder-storm limit. */
  tenantDailyCap: z.number().int().min(1).max(100_000),
})
export type TenantMessagingSettings = z.infer<typeof TenantMessagingSettingsInputSchema>

/**
 * Mirrors `DEFAULT_QUIET_HOURS` and `DEFAULT_GUARDIAN_DAILY_CAP` in
 * packages/domain. Those stay the source: the domain decides, this only
 * says what a school gets before it has decided anything.
 */
export const DEFAULT_MESSAGING_SETTINGS: TenantMessagingSettings = {
  sendHour: 9,
  quietHours: { startHour: 7, endHour: 20 },
  guardianDailyCap: 2,
  tenantDailyCap: 2_000,
}

const LenientMessagingSchema = z.object({
  sendHour: z.number().int().min(0).max(23).catch(DEFAULT_MESSAGING_SETTINGS.sendHour),
  quietHours: QuietHoursSchema.catch({ ...DEFAULT_MESSAGING_SETTINGS.quietHours }),
  guardianDailyCap: z.number().int().min(1).max(10).catch(DEFAULT_MESSAGING_SETTINGS.guardianDailyCap),
  tenantDailyCap: z.number().int().min(1).max(100_000).catch(DEFAULT_MESSAGING_SETTINGS.tenantDailyCap),
})

/** Read the messaging settings out of a whole `tenant.settings` blob. */
export function readMessagingSettings(settings: unknown): TenantMessagingSettings {
  const container = typeof settings === 'object' && settings !== null ? (settings as Record<string, unknown>) : {}
  return LenientMessagingSchema.parse(container['messaging'] ?? {})
}
