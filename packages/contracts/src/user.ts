/**
 * User and membership contract schemas.
 */
import { z } from 'zod'

export const MEMBERSHIP_ROLES = ['director', 'bursar', 'cashier', 'secretary', 'auditor'] as const
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  phone: z.string().nullable(),
  status: z.enum(['invited', 'active', 'suspended', 'locked']),
  totpEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
})
export type UserDto = z.infer<typeof UserSchema>

export const MembershipSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantName: z.string().optional(),
  userId: z.string().uuid(),
  siteId: z.string().uuid().nullable(),
  siteName: z.string().nullable().optional(),
  role: z.enum(MEMBERSHIP_ROLES),
  status: z.enum(['invited', 'active', 'suspended']),
  createdAt: z.string(),
})
export type MembershipDto = z.infer<typeof MembershipSchema>

export const MeResponseSchema = z.object({
  user: UserSchema,
  memberships: z.array(MembershipSchema),
})
export type MeResponse = z.infer<typeof MeResponseSchema>

export const InviteUserRequestSchema = z.object({
  email: z.string().email('Valid email is required'),
  name: z.string().min(1, 'Name is required'),
  role: z.enum(MEMBERSHIP_ROLES),
  siteId: z.string().uuid().optional(),
})
export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>

export const ChangeRoleRequestSchema = z.object({
  role: z.enum(MEMBERSHIP_ROLES),
})
export type ChangeRoleRequest = z.infer<typeof ChangeRoleRequestSchema>

export const ChangeStatusRequestSchema = z.object({
  status: z.enum(['active', 'suspended']),
})
export type ChangeStatusRequest = z.infer<typeof ChangeStatusRequestSchema>
