/**
 * Users, roles, academic years, settings, and the audit trail.
 */
import { z } from 'zod'
import { IsoDateTimeSchema, LocaleSchema, RoleSchema, UuidSchema } from './common.js'

export const StaffUserSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  siteName: z.string().nullable(),
  status: z.enum(['invited', 'active', 'suspended', 'locked']),
  twoFactorEnabled: z.boolean(),
  lastLoginAt: IsoDateTimeSchema.nullable(),
})
export type StaffUser = z.infer<typeof StaffUserSchema>



/** Append-only, INSERT/SELECT only at the DB level (AGENTS.md rule #10). */
export const AuditLogItemSchema = z.object({
  id: UuidSchema,
  occurredAt: IsoDateTimeSchema,
  actorName: z.string().nullable(),
  actorRole: RoleSchema.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: UuidSchema,
  ip: z.string().nullable(),
})
export type AuditLogItem = z.infer<typeof AuditLogItemSchema>

export const AuditQuerySchema = z.object({
  search: z.string().optional(),
  entityType: z.string().optional(),
  actorUserId: UuidSchema.optional(),
})

export const TenantSettingsSchema = z.object({
  tenantName: z.string(),
  legalName: z.string().nullable(),
  country: z.string().length(2),
  currency: z.string().length(3),
  timezone: z.string(),
  locale: LocaleSchema,
  plan: z.enum(['essentiel', 'croissance', 'institution']),
  /** Quiet hours in tenant-local time — enforced at the send layer. */
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
  maxMessagesPerGuardianPerDay: z.number().int().positive(),
  aggregatorFeeBorneBy: z.enum(['payer', 'school']),
})
export type TenantSettings = z.infer<typeof TenantSettingsSchema>

/** The signed-in user, as the dashboard shell needs it. */
export const CurrentUserSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  locale: LocaleSchema,
  tenantName: z.string(),
  siteName: z.string().nullable(),
})
export type CurrentUser = z.infer<typeof CurrentUserSchema>

export type AuditQuery = z.infer<typeof AuditQuerySchema>
