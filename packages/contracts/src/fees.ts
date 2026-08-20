/**
 * Fee schedules (grilles tarifaires) and instalment plans (échéanciers).
 */
import { z } from 'zod'
import { CalendarDateSchema, UuidSchema } from './common.js'
import { MoneySchema } from './money.js'

export const FeeCategorySchema = z.enum([
  'tuition',
  'registration',
  'exam',
  'canteen',
  'transport',
  'uniform',
  'boarding',
  'other',
])
export type FeeCategory = z.infer<typeof FeeCategorySchema>

export const FeeItemSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  label: z.string(),
  category: FeeCategorySchema,
  amount: MoneySchema,
  isMandatory: z.boolean(),
  isRecurring: z.boolean(),
  sequence: z.number().int().positive(),
})

export const InstalmentTemplateSchema = z.object({
  id: UuidSchema,
  sequence: z.number().int().positive(),
  label: z.string(),
  dueOn: CalendarDateSchema,
  amount: MoneySchema,
})

export const FeeScheduleSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  gradeLevelName: z.string(),
  academicYearName: z.string(),
  /** Versioned and immutable once published (ARCHITECTURE.md §16). */
  version: z.number().int().positive(),
  status: z.enum(['draft', 'published', 'archived']),
  effectiveFrom: CalendarDateSchema,
  total: MoneySchema,
  items: z.array(FeeItemSchema),
  instalmentPlan: z.object({
    id: UuidSchema,
    name: z.string(),
    instalmentCount: z.number().int().positive(),
    templates: z.array(InstalmentTemplateSchema),
  }),
  /** How many enrolments already reference this version — why editing is blocked. */
  enrolmentCount: z.number().int().nonnegative(),
})
export type FeeSchedule = z.infer<typeof FeeScheduleSchema>

/* ------------------------------------------------------------------ writes
 * A schedule is built as a DRAFT, then published. Publishing is one-way
 * (ARCHITECTURE.md §6): an invoice raised in September must still be
 * explainable in June, and it cannot be if the prices behind it were edited
 * in between. Correcting a published schedule means a new version;
 * correcting an invoice already raised against it means an `adjustment`.
 *
 * Amounts arrive as integer STRINGS of minor units, like every other money
 * value on the wire (see money.ts) — a JSON number would lose precision and
 * invites someone to divide XAF by 100.
 */

/** Minor units, as an integer string. Non-negative: a fee is never a credit. */
export const AmountMinorSchema = z
  .string()
  .regex(/^\d+$/, 'amountMinor must be a non-negative integer string')

export const CreateFeeScheduleRequestSchema = z.object({
  academicYearId: UuidSchema,
  gradeLevelId: UuidSchema,
  name: z.string().min(1).max(120),
  effectiveFrom: CalendarDateSchema,
})
export type CreateFeeScheduleRequest = z.infer<typeof CreateFeeScheduleRequestSchema>

export const FeeItemInputSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, 'code must be lowercase letters, digits, hyphen or underscore'),
  label: z.string().min(1).max(120),
  category: FeeCategorySchema,
  amountMinor: AmountMinorSchema,
  /** Mandatory items are billed to every student; optional ones only when chosen. */
  isMandatory: z.boolean().default(true),
  isRecurring: z.boolean().default(true),
  sequence: z.number().int().positive(),
})
export type FeeItemInput = z.input<typeof FeeItemInputSchema>

export const ReplaceFeeItemsRequestSchema = z.object({
  items: z.array(FeeItemInputSchema).min(1),
})
export type ReplaceFeeItemsRequest = z.input<typeof ReplaceFeeItemsRequestSchema>

/**
 * A template sets EXACTLY ONE of amountMinor/percentBp, and exactly one of
 * dueOffsetDays/dueOn. The domain rejects the ambiguous combinations too;
 * catching them at the edge just turns a 500 into a 400 with a field name.
 */
export const InstalmentTemplateInputSchema = z
  .object({
    sequence: z.number().int().positive(),
    label: z.string().min(1).max(80),
    dueOffsetDays: z.number().int().optional(),
    dueOn: CalendarDateSchema.optional(),
    percentBp: z.number().int().positive().max(10_000).optional(),
    amountMinor: AmountMinorSchema.optional(),
  })
  .refine((t) => (t.amountMinor == null) !== (t.percentBp == null), {
    message: 'set exactly one of amountMinor or percentBp',
    path: ['amountMinor'],
  })
  .refine((t) => (t.dueOffsetDays == null) !== (t.dueOn == null), {
    message: 'set exactly one of dueOffsetDays or dueOn',
    path: ['dueOn'],
  })
export type InstalmentTemplateInput = z.input<typeof InstalmentTemplateInputSchema>

export const SetInstalmentPlanRequestSchema = z.object({
  name: z.string().min(1).max(80),
  templates: z.array(InstalmentTemplateInputSchema).min(1),
})
export type SetInstalmentPlanRequest = z.input<typeof SetInstalmentPlanRequestSchema>

export const FeeScheduleSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'published', 'archived']),
  effectiveFrom: CalendarDateSchema,
  total: MoneySchema,
  itemCount: z.number().int().nonnegative(),
  instalmentCount: z.number().int().nonnegative(),
})
export type FeeScheduleSummary = z.infer<typeof FeeScheduleSummarySchema>
