/**
 * Subscription checkout — a school paying Fineduc for its own plan.
 *
 * Separate from `payments.ts`, which is a parent paying a school. The two
 * must never share a schema: they travel through different settlement paths,
 * different webhook controllers, and different Chariow/Moneroo accounts.
 */
import { z } from 'zod'

export const SubscriptionPlanSchema = z.enum(['essentiel', 'croissance', 'institution'])
export type SubscriptionPlanContract = z.infer<typeof SubscriptionPlanSchema>

export const SubscriptionBillingPeriodSchema = z.enum(['monthly'])
export type SubscriptionBillingPeriodContract = z.infer<typeof SubscriptionBillingPeriodSchema>

export const SubscriptionCheckoutRequestSchema = z.object({
  plan: SubscriptionPlanSchema,
  billingPeriod: SubscriptionBillingPeriodSchema,
  payerPhoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/, 'must be an E.164 phone number'),
  payerName: z.string().max(120).optional(),
  payerEmail: z.string().email().optional(),
  returnUrl: z.string().url().optional(),
})
export type SubscriptionCheckoutRequest = z.infer<typeof SubscriptionCheckoutRequestSchema>

export const SubscriptionCheckoutResultSchema = z.object({
  subscriptionPaymentId: z.string().uuid(),
  checkoutUrl: z.string().url().nullable(),
})
export type SubscriptionCheckoutResult = z.infer<typeof SubscriptionCheckoutResultSchema>
