import { z } from 'zod'

/**
 * A calendar DATE in the tenant's timezone — never a timestamp
 * (AGENTS.md rule #9). Instalment due dates, enrolment dates, and ledger
 * posting dates all use this; an instant uses `IsoDateTimeSchema`.
 */
export const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
export type CalendarDate = z.infer<typeof CalendarDateSchema>

export const IsoDateTimeSchema = z.string().datetime({ offset: true })

export const UuidSchema = z.string().uuid()

/** Cursor pagination (ARCHITECTURE.md §12). Max page size 100. */
export const PageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
})

export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  })
}

/** RFC 9457 problem+json (ARCHITECTURE.md §12). */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  traceId: z.string().optional(),
  errors: z.record(z.array(z.string())).optional(),
})
export type Problem = z.infer<typeof ProblemSchema>

export const RoleSchema = z.enum(['director', 'bursar', 'cashier', 'secretary', 'auditor'])
export type Role = z.infer<typeof RoleSchema>

export const LocaleSchema = z.enum(['fr', 'en'])
export type Locale = z.infer<typeof LocaleSchema>

export const ChannelSchema = z.enum(['whatsapp', 'sms'])
export type Channel = z.infer<typeof ChannelSchema>
