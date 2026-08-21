/**
 * Le moratoire — a parent-requested delay on one instalment.
 *
 * A parent who cannot pay a tranche on time asks for a delay from the
 * reminder message itself, through a guided chat behind a tokenised link.
 * The school decides whether that is granted on the spot or queued for a
 * bursar. It moves a DATE, never an amount: no ledger entry, no allocation,
 * and `instalment.due_on` itself is never rewritten.
 */
import { z } from 'zod'
import { CalendarDateSchema, IsoDateTimeSchema, LocaleSchema, UuidSchema } from './common.js'
import { MoneySchema } from './money.js'

/**
 * Three weeks, and it is NOT configurable — not by a setting, not by an
 * admin, not by hand-editing `tenant.settings`. A school may offer less.
 * The cap exists so "moratoire" cannot become an indefinite snooze, which
 * is the failure mode that would make the whole feature harmful to the
 * school that switched it on.
 */
export const MAX_MORATORIUM_DAYS = 21

export const MoratoriumStatusSchema = z.enum(['pending', 'granted', 'refused', 'cancelled'])
export type MoratoriumStatus = z.infer<typeof MoratoriumStatusSchema>

export const MoratoriumSourceSchema = z.enum(['chatbot', 'staff'])
export type MoratoriumSource = z.infer<typeof MoratoriumSourceSchema>

export const MoratoriumApprovalModeSchema = z.enum(['auto', 'manual'])
export type MoratoriumApprovalMode = z.infer<typeof MoratoriumApprovalModeSchema>

/** Why the chat cannot offer a moratoire. Every value is shown to a parent. */
export const MoratoriumBlockedReasonSchema = z.enum([
  /** The school has not switched the feature on. */
  'disabled',
  /** Already paid, waived or cancelled — there is nothing to defer. */
  'settled',
  /** This instalment has had its one moratoire. */
  'already_used',
  /** The reminder window has not opened yet. */
  'too_early',
  /** Past the school's grace window, or past original + 21 days. */
  'too_late',
  /** A full scholarship: the tranche is 0, so a delay is meaningless. */
  'zero_amount',
])
export type MoratoriumBlockedReason = z.infer<typeof MoratoriumBlockedReasonSchema>

/* ------------------------------------------------- the school's policy -- */

/**
 * What a school configures, stored at `tenant.settings.moratorium`.
 *
 * Two schemas on purpose, and the difference matters:
 *
 * - `MoratoriumPolicyInputSchema` is STRICT and is what the director's
 *   settings endpoint validates against. A director who asks for 30 days
 *   gets a 422 telling them the cap, not a silent fallback.
 * - `readMoratoriumPolicy` is LENIENT and is what the 02:00 scheduler uses.
 *   A settings blob written by an older version, or corrupted by hand, must
 *   not throw in a job that fans out to four hundred families — and it must
 *   not discard a school's other valid settings because one field is wrong.
 */
export const MoratoriumPolicyInputSchema = z.object({
  /** Off by default. A school opts in. */
  enabled: z.boolean(),
  /** 'auto' grants in the chat; 'manual' queues it for a bursar. */
  approval: MoratoriumApprovalModeSchema,
  /** The durations offered as buttons. Each one capped at three weeks. */
  allowedDurationsDays: z.array(z.number().int().min(1).max(MAX_MORATORIUM_DAYS)).min(1).max(5),
  /** The link rides on reminders sent this many days before the due date. */
  offerFromDaysBeforeDue: z.number().int().min(1).max(60),
  /**
   * How many days past the due date a parent may still ask. 0 means the
   * offer dies on the due date. Note the delay is still measured from the
   * ORIGINAL due date, so asking late buys less time, never more.
   */
  lateGraceDays: z.number().int().min(0).max(MAX_MORATORIUM_DAYS),
  /**
   * true: a refused request can be replaced, so a refusal is not final.
   * false: one attempt per instalment, and a refusal burns it.
   */
  refusalFreesSlot: z.boolean(),
})
export type MoratoriumPolicy = z.infer<typeof MoratoriumPolicyInputSchema>

export const DEFAULT_MORATORIUM_POLICY: MoratoriumPolicy = {
  enabled: false,
  approval: 'manual',
  allowedDurationsDays: [7, 14, 21],
  offerFromDaysBeforeDue: 14,
  lateGraceDays: 7,
  refusalFreesSlot: true,
}

/**
 * Field-by-field, so one bad value costs one default rather than all of
 * them. `.catch()` covers a missing field and a malformed one alike.
 */
const LenientPolicySchema = z.object({
  enabled: z.boolean().catch(DEFAULT_MORATORIUM_POLICY.enabled),
  approval: MoratoriumApprovalModeSchema.catch(DEFAULT_MORATORIUM_POLICY.approval),
  allowedDurationsDays: z
    .array(z.number().int().min(1).max(MAX_MORATORIUM_DAYS))
    .min(1)
    .max(5)
    .catch([...DEFAULT_MORATORIUM_POLICY.allowedDurationsDays]),
  offerFromDaysBeforeDue: z.number().int().min(1).max(60).catch(DEFAULT_MORATORIUM_POLICY.offerFromDaysBeforeDue),
  lateGraceDays: z.number().int().min(0).max(MAX_MORATORIUM_DAYS).catch(DEFAULT_MORATORIUM_POLICY.lateGraceDays),
  refusalFreesSlot: z.boolean().catch(DEFAULT_MORATORIUM_POLICY.refusalFreesSlot),
})

/**
 * Read the policy out of a whole `tenant.settings` blob.
 *
 * Takes `unknown` and parses rather than casting, because the column is
 * plain JSON and nothing at the database level constrains its shape.
 */
export function readMoratoriumPolicy(settings: unknown): MoratoriumPolicy {
  const container = typeof settings === 'object' && settings !== null ? (settings as Record<string, unknown>) : {}
  const parsed = LenientPolicySchema.parse(container['moratorium'] ?? {})

  // Sorted and de-duplicated so the chat renders buttons in a sane order
  // whatever the school typed.
  return { ...parsed, allowedDurationsDays: [...new Set(parsed.allowedDurationsDays)].sort((a, b) => a - b) }
}

/* --------------------------------------------------- the public chat ---- */

export const MoratoriumOfferOptionSchema = z.object({
  days: z.number().int(),
  /**
   * The resulting date, computed SERVER-SIDE.
   *
   * The chat must never derive this: a browser clock in the wrong timezone
   * would show a parent a different deadline from the one the school
   * recorded, and they would plan around the wrong day.
   */
  deferredDueOn: CalendarDateSchema,
})
export type MoratoriumOfferOption = z.infer<typeof MoratoriumOfferOptionSchema>

export const MoratoriumOfferSchema = z.object({
  available: z.boolean(),
  /** Populated only when `available` is false. */
  reason: MoratoriumBlockedReasonSchema.nullable(),
  /** The buttons to render, each with its end date. Empty when unavailable. */
  options: z.array(MoratoriumOfferOptionSchema),
  /** The furthest date on offer, so the chat can state it before asking. */
  latestDeferredDueOn: CalendarDateSchema.nullable(),
  /**
   * True when the longest available delay lands on or after the NEXT
   * tranche. The parent is TOLD, never silently given less than they chose.
   */
  collidesWithNextInstalment: z.boolean(),
})
export type MoratoriumOffer = z.infer<typeof MoratoriumOfferSchema>

/**
 * What `GET /moratoire/:token` returns.
 *
 * First name only, and no matricule: the link reaches whoever holds the SIM,
 * and a reassigned number must not hand a stranger a child's file
 * (AGENTS.md rule #11).
 */
export const MoratoriumChatViewSchema = z.object({
  schoolName: z.string(),
  studentFirstName: z.string(),
  instalmentLabel: z.string(),
  /** Still owed, not the original amount — a partial payment counts. */
  amountDue: MoneySchema,
  dueOn: CalendarDateSchema,
  locale: LocaleSchema,
  approvalMode: MoratoriumApprovalModeSchema,
  offer: MoratoriumOfferSchema,
  /** A moratoire already on this instalment, so the chat can report it. */
  existing: z
    .object({
      status: MoratoriumStatusSchema,
      requestedDays: z.number().int(),
      deferredDueOn: CalendarDateSchema,
      decisionNote: z.string().nullable(),
    })
    .nullable(),
})
export type MoratoriumChatView = z.infer<typeof MoratoriumChatViewSchema>

export const MoratoriumRequestInputSchema = z.object({
  durationDays: z.number().int().min(1).max(MAX_MORATORIUM_DAYS),
  /** Free text from a parent. Never logged, never rendered into a message. */
  reason: z.string().max(280).optional(),
  idempotencyKey: z.string().uuid(),
})
export type MoratoriumRequestInput = z.infer<typeof MoratoriumRequestInputSchema>

export const MoratoriumRequestResultSchema = z.object({
  status: z.enum(['granted', 'pending', 'rejected']),
  /** Null on a rejection. On `pending` this is what WOULD be granted. */
  deferredDueOn: CalendarDateSchema.nullable(),
  reason: MoratoriumBlockedReasonSchema.nullable(),
  /**
   * Whether this family may try again. Driven by the school's
   * `refusalFreesSlot`, so the chat can say which it is instead of leaving
   * a parent guessing.
   */
  mayAskAgain: z.boolean(),
})
export type MoratoriumRequestResult = z.infer<typeof MoratoriumRequestResultSchema>

/* -------------------------------------------- free-text delay parsing -- */

/**
 * `POST /moratoire/:token/parse` — the fallback for parents who type instead
 * of tapping a button. The LLM maps their text to a duration from the
 * school's allowlist; the domain still decides eligibility.
 */
export const ParseDelayInputSchema = z.object({
  text: z.string().min(1).max(280),
})
export type ParseDelayInput = z.infer<typeof ParseDelayInputSchema>

export const ParseDelayResultSchema = z.object({
  /** A value from the school's allowedDurationsDays, or null when unparseable. */
  days: z.number().int().min(1).max(MAX_MORATORIUM_DAYS).nullable(),
  /** The server-computed end date for the parsed duration, if any. */
  deferredDueOn: z.string().nullable(),
})
export type ParseDelayResult = z.infer<typeof ParseDelayResultSchema>

/* -------------------------------------------------------- staff-facing -- */

export const MoratoriumListItemSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  className: z.string().nullable(),
  instalmentId: UuidSchema,
  instalmentLabel: z.string(),
  amountDue: MoneySchema,
  status: MoratoriumStatusSchema,
  source: MoratoriumSourceSchema,
  requestedDays: z.number().int(),
  originalDueOn: CalendarDateSchema,
  deferredDueOn: CalendarDateSchema,
  reason: z.string().nullable(),
  requestedAt: IsoDateTimeSchema,
  decidedAt: IsoDateTimeSchema.nullable(),
  decisionNote: z.string().nullable(),
  /**
   * A previous refusal on this same instalment, when the school allows a
   * second attempt. Shown so a bursar can see they are being asked twice.
   */
  priorRefusals: z.number().int().nonnegative(),
})
export type MoratoriumListItem = z.infer<typeof MoratoriumListItemSchema>

export const ApproveMoratoriumInputSchema = z.object({
  /**
   * Optional, and may only SHORTEN. Validated against original + 21 server
   * side — a hand-typed date is not a way around the cap.
   */
  deferredDueOn: CalendarDateSchema.optional(),
  note: z.string().max(500).optional(),
})
export type ApproveMoratoriumInput = z.infer<typeof ApproveMoratoriumInputSchema>

/**
 * `note` is REQUIRED, mirroring the rule that a cash variance cannot be
 * closed without a written reason. A family is owed an explanation, and the
 * next person to look at the file is owed one too.
 */
export const RefuseMoratoriumInputSchema = z.object({
  note: z.string().min(1).max(500),
})
export type RefuseMoratoriumInput = z.infer<typeof RefuseMoratoriumInputSchema>

export const CancelMoratoriumInputSchema = RefuseMoratoriumInputSchema
export type CancelMoratoriumInput = z.infer<typeof CancelMoratoriumInputSchema>

/** A bursar recording a moratoire for a parent who walked into the office. */
export const StaffGrantMoratoriumInputSchema = z.object({
  durationDays: z.number().int().min(1).max(MAX_MORATORIUM_DAYS),
  guardianId: UuidSchema.optional(),
  reason: z.string().max(280).optional(),
  idempotencyKey: z.string().uuid(),
})
export type StaffGrantMoratoriumInput = z.infer<typeof StaffGrantMoratoriumInputSchema>
