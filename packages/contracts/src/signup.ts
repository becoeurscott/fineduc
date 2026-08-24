import { z } from 'zod'

export const SignupStartRequestSchema = z.object({
  schoolName: z.string().min(1).max(200),
  contactName: z.string().min(1).max(100),
  role: z.string().min(1).max(100),
  email: z.string().email().max(254),
  phone: z.string().min(8).max(20),
  studentCount: z.number().int().positive().optional(),
  country: z.string().length(2),
})
export type SignupStartRequest = z.infer<typeof SignupStartRequestSchema>

export const SignupStartResponseSchema = z.object({
  signupId: z.string().uuid(),
})
export type SignupStartResponse = z.infer<typeof SignupStartResponseSchema>

export const VerifyEmailRequestSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
})
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>

export const VerifyPhoneRequestSchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().length(6),
})
export type VerifyPhoneRequest = z.infer<typeof VerifyPhoneRequestSchema>

export const SignupCompleteRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
})
export type SignupCompleteRequest = z.infer<typeof SignupCompleteRequestSchema>

export const SignupCompleteResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
})
export type SignupCompleteResponse = z.infer<typeof SignupCompleteResponseSchema>

export const ResendCodeRequestSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(8).max(20).optional(),
})
export type ResendCodeRequest = z.infer<typeof ResendCodeRequestSchema>

export const SignupRequestStatusSchema = z.enum(['pending', 'approved', 'rejected', 'setup_complete', 'expired'])
export type SignupRequestStatus = z.infer<typeof SignupRequestStatusSchema>

export const SignupRequestListItemSchema = z.object({
  id: z.string(),
  schoolName: z.string(),
  contactName: z.string(),
  role: z.string(),
  email: z.string(),
  phone: z.string(),
  studentCount: z.number().nullable(),
  country: z.string(),
  status: SignupRequestStatusSchema,
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  setupToken: z.string().nullable(),
  setupUrl: z.string().nullable(),
  tempIdentifier: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  expiresAt: z.string(),
})
export type SignupRequestListItem = z.infer<typeof SignupRequestListItemSchema>

export const ApproveSignupResponseSchema = z.object({
  setupToken: z.string(),
  setupUrl: z.string(),
  tempIdentifier: z.string(),
})
export type ApproveSignupResponse = z.infer<typeof ApproveSignupResponseSchema>

export const SetupAccountRequestSchema = z.object({
  token: z.string(),
  email: z.string().email().max(254),
  phone: z.string().min(8).max(20),
  password: z.string().min(8).max(128),
})
export type SetupAccountRequest = z.infer<typeof SetupAccountRequestSchema>

export const SetupVerifyRequestSchema = z.object({
  token: z.string(),
  channel: z.enum(['email', 'phone']),
  code: z.string().length(6),
})
export type SetupVerifyRequest = z.infer<typeof SetupVerifyRequestSchema>

export const SetupResendRequestSchema = z.object({
  token: z.string(),
  channel: z.enum(['email', 'phone']),
})
export type SetupResendRequest = z.infer<typeof SetupResendRequestSchema>

export const SetupInfoSchema = z.object({
  schoolName: z.string(),
  contactName: z.string(),
  tempIdentifier: z.string(),
  email: z.string(),
  phone: z.string(),
})
export type SetupInfo = z.infer<typeof SetupInfoSchema>
