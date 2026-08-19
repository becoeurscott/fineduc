/**
 * Tenant and site contract schemas.
 */
import { z } from 'zod'

export const TenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  legalName: z.string().nullable(),
  country: z.string().length(2),
  currency: z.string().length(3),
  timezone: z.string(),
  locale: z.string(),
  plan: z.enum(['essentiel', 'croissance', 'institution']),
  status: z.enum(['trial', 'active', 'suspended', 'cancelled']),
  logoUrl: z.string().nullable(),
  createdAt: z.string(),
})
export type TenantDto = z.infer<typeof TenantSchema>

export const CreateTenantRequestSchema = z.object({
  name: z.string().min(1, 'School name is required'),
  legalName: z.string().optional(),
  country: z.string().length(2, 'Country must be a 2-letter ISO code'),
  currency: z.string().length(3, 'Currency must be a 3-letter ISO 4217 code'),
  timezone: z.string().min(1, 'Timezone is required'),
  locale: z.string().default('fr'),
})
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>

export const UpdateTenantRequestSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().nullable().optional(),
  locale: z.string().optional(),
  logoUrl: z.string().url().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
})
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequestSchema>

export const SiteSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.string(),
})
export type SiteDto = z.infer<typeof SiteSchema>

export const CreateSiteRequestSchema = z.object({
  name: z.string().min(1, 'Site name is required'),
  address: z.string().optional(),
})
export type CreateSiteRequest = z.infer<typeof CreateSiteRequestSchema>

export const UpdateSiteRequestSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
})
export type UpdateSiteRequest = z.infer<typeof UpdateSiteRequestSchema>

export const SettingsSchema = z.record(z.unknown())
export type Settings = z.infer<typeof SettingsSchema>
