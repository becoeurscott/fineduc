/**
 * Reminder rules, templates, delivery log, and the prepaid message wallet
 * (ARCHITECTURE.md §8.5, PRD §7).
 */
import { z } from 'zod'
import { ChannelSchema, IsoDateTimeSchema, LocaleSchema, UuidSchema } from './common.js'
import { MoneySchema } from './money.js'

export const ReminderRuleSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  /** Signed offset from the instalment due date: -7 = seven days before. */
  offsetDays: z.number().int(),
  channel: ChannelSchema,
  templateCode: z.string(),
  /** 0 gentle → 1 firm → 2 formal notice. The escalation ladder. */
  escalationLevel: z.number().int().min(0).max(2),
  isActive: z.boolean(),
})
export type ReminderRule = z.infer<typeof ReminderRuleSchema>

export const MessageTemplateSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  channel: ChannelSchema,
  locale: LocaleSchema,
  body: z.string(),
  variables: z.array(z.string()),
  /** WhatsApp templates need Meta pre-approval before they can send. */
  whatsappTemplateStatus: z.enum(['not_submitted', 'pending', 'approved', 'rejected']).nullable(),
  isActive: z.boolean(),
})
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>

export const MessageLogItemSchema = z.object({
  id: UuidSchema,
  studentName: z.string().nullable(),
  guardianName: z.string(),
  toPhoneE164: z.string(),
  channel: ChannelSchema,
  templateCode: z.string(),
  status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed', 'undeliverable']),
  errorCode: z.string().nullable(),
  cost: MoneySchema,
  sentAt: IsoDateTimeSchema.nullable(),
  deliveredAt: IsoDateTimeSchema.nullable(),
})
export type MessageLogItem = z.infer<typeof MessageLogItemSchema>

/**
 * The prepaid wallet. Never a surprise bill (PRD §7) — the bursar sees the
 * balance and the burn rate, and sending stops at zero rather than
 * accruing debt.
 */
export const MessageCreditsSchema = z.object({
  balance: MoneySchema,
  /** Messages sent this month, and what they cost. */
  sentThisMonth: z.number().int().nonnegative(),
  spentThisMonth: MoneySchema,
  /** Tenant-set monthly cap; sending halts here and warns the bursar. */
  monthlyCap: MoneySchema.nullable(),
  whatsappUnitCost: MoneySchema,
  smsUnitCost: MoneySchema,
  lowBalanceWarning: z.boolean(),
})
export type MessageCredits = z.infer<typeof MessageCreditsSchema>

/** Manual send: one guardian, a class, or a filtered debtor list. */
export const SendReminderInputSchema = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('student'), studentId: UuidSchema }),
    z.object({ kind: z.literal('class'), classGroupId: UuidSchema }),
    z.object({ kind: z.literal('arrears'), minDaysOverdue: z.number().int().nonnegative() }),
  ]),
  templateCode: z.string(),
  channel: ChannelSchema,
  idempotencyKey: z.string().uuid(),
})
export type SendReminderInput = z.infer<typeof SendReminderInputSchema>

/**
 * Returned before an actual send so the UI can show a confirmation with
 * real numbers — how many recipients, how much it will cost. A reminder
 * storm is a financial incident (ARCHITECTURE.md §16); the human sees the
 * blast radius first.
 */
export const SendReminderPreviewSchema = z.object({
  recipientCount: z.number().int().nonnegative(),
  estimatedCost: MoneySchema,
  skipped: z.object({
    alreadyPaid: z.number().int().nonnegative(),
    optedOut: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
  }),
  exceedsBalance: z.boolean(),
})
export type SendReminderPreview = z.infer<typeof SendReminderPreviewSchema>
