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
