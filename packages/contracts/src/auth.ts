/**
 * Auth contract schemas. Types are derived from Zod — never hand-written
 * alongside (AGENTS.md: "a Zod schema in packages/contracts. Types are
 * derived from it, never hand-written alongside it.").
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const LoginRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

/** Membership summary returned at login for tenant selection. */
export const LoginMembershipSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  siteId: z.string().uuid().nullable(),
  role: z.string(),
  status: z.string(),
})
export type LoginMembership = z.infer<typeof LoginMembershipSchema>

/**
 * Login step 1: credentials accepted. If the user has exactly one active
 * membership, `accessToken` is returned immediately. If the user has
 * multiple memberships, `memberships` lists the options and a
 * `selectionToken` is returned for the select-tenant step.
 */
export const LoginResponseSchema = z.object({
  /** Present when user has exactly one active membership (auto-selected). */
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().optional(),
  /** Present when user has 2FA enabled — client must call POST /auth/2fa/challenge. */
  totpRequired: z.boolean().optional(),
  /** Present when user has multiple memberships — client must call POST /auth/select-tenant. */
  selectionToken: z.string().optional(),
  memberships: z.array(LoginMembershipSchema).optional(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  }),
})
export type LoginResponse = z.infer<typeof LoginResponseSchema>

// ---------------------------------------------------------------------------
// School login (temp email + access code)
// ---------------------------------------------------------------------------

export const SchoolLoginRequestSchema = z.object({
  token: z.string().min(1),
  code: z.string().min(1, 'Access code is required'),
})
export type SchoolLoginRequest = z.infer<typeof SchoolLoginRequestSchema>

// ---------------------------------------------------------------------------
// Tenant selection (multi-tenant users)
// ---------------------------------------------------------------------------

export const SelectTenantRequestSchema = z.object({
  selectionToken: z.string().min(1),
  tenantId: z.string().uuid(),
})
export type SelectTenantRequest = z.infer<typeof SelectTenantRequestSchema>

export const TokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
})
export type TokenResponse = z.infer<typeof TokenResponseSchema>

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
})
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>

// ---------------------------------------------------------------------------
// TOTP 2FA
// ---------------------------------------------------------------------------

export const TotpEnrollResponseSchema = z.object({
  /** The raw secret (base32). Only shown once. */
  secret: z.string(),
  /** otpauth:// URI for QR code scanning. */
  otpauthUri: z.string(),
})
export type TotpEnrollResponse = z.infer<typeof TotpEnrollResponseSchema>

export const TotpVerifyRequestSchema = z.object({
  code: z
    .string()
    .length(6, 'TOTP code must be 6 digits')
    .regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
})
export type TotpVerifyRequest = z.infer<typeof TotpVerifyRequestSchema>

export const TotpChallengeRequestSchema = z.object({
  selectionToken: z.string().min(1),
  code: z
    .string()
    .length(6, 'TOTP code must be 6 digits')
    .regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
  /** Required if the user has multiple memberships. */
  tenantId: z.string().uuid().optional(),
})
export type TotpChallengeRequest = z.infer<typeof TotpChallengeRequestSchema>
