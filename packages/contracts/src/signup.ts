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
