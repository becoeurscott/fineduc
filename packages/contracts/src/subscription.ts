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

/**
 * What can be SOLD. Monthly only: Chariow charges a pre-priced product and
 * only the three monthly ones exist, so an annual checkout has no product to
 * bill against.
 */
export const SubscriptionBillingPeriodSchema = z.enum(['monthly'])
export type SubscriptionBillingPeriodContract = z.infer<typeof SubscriptionBillingPeriodSchema>

/**
 * What can be REPORTED — deliberately wider than what can be sold.
 *
 * The database still holds `annual`, and a school that signed one before
 * annual was withdrawn must still be able to see its own status. Narrowing
 * this to match the checkout would make the dashboard throw for exactly the
 * schools that already paid the most.
 */
export const SubscriptionPeriodReadSchema = z.enum(['monthly', 'annual'])
export type SubscriptionPeriodRead = z.infer<typeof SubscriptionPeriodReadSchema>

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

export const SubscriptionStatusSchema = z.enum(['trialing', 'active', 'past_due', 'cancelled'])

/**
 * What the dashboard needs to show a school where it stands.
 *
 * `accessEndsAt` is the whole point of this shape. It is the exact INSTANT
 * the lock closes, resolved server-side from the school's own timezone — the
 * browser must never recompute it, because a bursar's laptop set to the wrong
 * zone would count down to the wrong moment and the banner would contradict
 * the guard that actually blocks them.
 */
export const SubscriptionStateSchema = z.object({
  plan: SubscriptionPlanSchema,
  billingPeriod: SubscriptionPeriodReadSchema,
  status: SubscriptionStatusSchema,
  /** Last day covered, as a calendar date in the school's timezone. */
  currentPeriodEnd: z.string(),
  /** The instant access is cut off: midnight local, the day after the period ends. */
  accessEndsAt: z.string(),
  /** True once `accessEndsAt` has passed — the guard is refusing requests. */
  lapsed: z.boolean(),
  /** What renewing costs, in XAF minor units, as a string (bigint over JSON). */
  priceMinor: z.string(),
  /**
   * The plans on offer, priced by the SERVER.
   *
   * Sent rather than hard-coded in the dashboard so a price cannot drift
   * between the button a director clicks and the amount they are charged —
   * the same reason packages/domain keeps these figures in one constant. It
   * also spares the browser a dependency on the domain package.
   */
  plans: z.array(
    z.object({
      plan: SubscriptionPlanSchema,
      monthlyMinor: z.string(),
      /** `null` on the top plan, which is sold uncapped. */
      studentCap: z.number().int().positive().nullable(),
    }),
  ),
})
export type SubscriptionState = z.infer<typeof SubscriptionStateSchema>
