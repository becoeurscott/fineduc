/**
 * The student file — "un dossier par élève" (PRD §2), the core of the product.
 */
import { z } from 'zod'
import { CalendarDateSchema, ChannelSchema, IsoDateTimeSchema, UuidSchema } from './common.js'
import { MoneySchema } from './money.js'

export const StudentStatusSchema = z.enum(['enrolled', 'left', 'graduated', 'suspended'])
export const InstalmentStatusSchema = z.enum([
  'pending',
  'partial',
  'paid',
  'overdue',
  'waived',
  'cancelled',
])
export type InstalmentStatus = z.infer<typeof InstalmentStatusSchema>

export const GuardianSchema = z.object({
  id: UuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  phoneE164: z.string(),
  relationship: z.string(),
  isPrimary: z.boolean(),
  paysFees: z.boolean(),
  preferredChannel: ChannelSchema,
  optedOut: z.boolean(),
  /** Quarantined after repeated delivery failures — a wrong/reassigned number (ARCHITECTURE.md §16). */
  quarantined: z.boolean(),
})
export type Guardian = z.infer<typeof GuardianSchema>

/** Row in the students list. Deliberately lean — the list must fly on 3G. */
export const StudentListItemSchema = z.object({
  id: UuidSchema,
  matricule: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  className: z.string(),
  status: StudentStatusSchema,
  balance: MoneySchema,
  /** Null when nothing is outstanding. */
  nextDueOn: CalendarDateSchema.nullable(),
  daysOverdue: z.number().int().nonnegative(),
})
export type StudentListItem = z.infer<typeof StudentListItemSchema>

export const InstalmentSchema = z.object({
  id: UuidSchema,
  sequence: z.number().int().positive(),
  label: z.string(),
  dueOn: CalendarDateSchema,
  amount: MoneySchema,
  allocated: MoneySchema,
  remaining: MoneySchema,
  status: InstalmentStatusSchema,
})
export type Instalment = z.infer<typeof InstalmentSchema>

export const LedgerEntryTypeSchema = z.enum([
  'charge',
  'payment',
  'discount',
  'adjustment',
  'refund',
  'reversal',
  'carry_forward',
])

export const LedgerEntrySchema = z.object({
  id: UuidSchema,
  occurredOn: CalendarDateSchema,
  entryType: LedgerEntryTypeSchema,
  memo: z.string().nullable(),
  /** Signed. Negative reduces what the family owes. */
  amount: MoneySchema,
  balanceAfter: MoneySchema,
})
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>

export const StudentMessageSchema = z.object({
  id: UuidSchema,
  sentAt: IsoDateTimeSchema.nullable(),
  channel: ChannelSchema,
  toPhoneE164: z.string(),
  status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed', 'undeliverable']),
  templateCode: z.string(),
  bodyRendered: z.string(),
})

export const StudentFileSchema = z.object({
  id: UuidSchema,
  matricule: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  sex: z.enum(['M', 'F']),
  bornOn: CalendarDateSchema.nullable(),
  photoUrl: z.string().nullable(),
  status: StudentStatusSchema,
  className: z.string(),
  academicYearName: z.string(),
  enrolledOn: CalendarDateSchema,

  totalDue: MoneySchema,
  totalPaid: MoneySchema,
  balance: MoneySchema,

  guardians: z.array(GuardianSchema),
  instalments: z.array(InstalmentSchema),
  ledger: z.array(LedgerEntrySchema),
  messages: z.array(StudentMessageSchema),

  /**
   * Same-guardian siblings, for the consolidated view PRD §4 calls for.
   * Carries the matricule because name collisions are common in a single
   * school — two unrelated "Aïcha Mballa" must be tellable apart.
   */
  siblings: z.array(
    z.object({
      id: UuidSchema,
      matricule: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      className: z.string(),
    }),
  ),
})
export type StudentFile = z.infer<typeof StudentFileSchema>

export const StudentQuerySchema = z.object({
  search: z.string().optional(),
  classGroupId: UuidSchema.optional(),
  status: StudentStatusSchema.optional(),
  hasBalance: z.boolean().optional(),
})

/** The bursar's work queue (ARCHITECTURE.md §13). */
export const ArrearsQuerySchema = z.object({
  search: z.string().optional(),
  classGroupId: UuidSchema.optional(),
  minDaysOverdue: z.number().int().nonnegative().optional(),
  sort: z.enum(['amount_desc', 'age_desc', 'name_asc']).default('amount_desc'),
})

export type StudentQuery = z.infer<typeof StudentQuerySchema>
export type ArrearsQuery = z.infer<typeof ArrearsQuerySchema>

export const CreateStudentRequestSchema = z.object({
  matricule: z.string().min(1, 'Matricule is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  sex: z.enum(['M', 'F']),
  bornOn: CalendarDateSchema.optional(),
  photoUrl: z.string().url().optional(),
  notes: z.string().optional(),
})
export type CreateStudentRequest = z.infer<typeof CreateStudentRequestSchema>

export const UpdateStudentRequestSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  sex: z.enum(['M', 'F']).optional(),
  bornOn: CalendarDateSchema.nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: StudentStatusSchema.optional(),
})
export type UpdateStudentRequest = z.infer<typeof UpdateStudentRequestSchema>

export const CreateGuardianRequestSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 phone number'),
  phoneAltE164: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 phone number').optional(),
  email: z.string().email().optional(),
  relationship: z.string().min(1, 'Relationship is required'),
  preferredChannel: ChannelSchema.default('whatsapp'),
  isPrimary: z.boolean().default(false),
  paysFees: z.boolean().default(true),
  sharePercent: z.number().int().min(1).max(100).optional(),
})
export type CreateGuardianRequest = z.infer<typeof CreateGuardianRequestSchema>

export const UpdateGuardianRequestSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  phoneAltE164: z.string().regex(/^\+[1-9]\d{6,14}$/).nullable().optional(),
  email: z.string().email().nullable().optional(),
  relationship: z.string().min(1).optional(),
  preferredChannel: ChannelSchema.optional(),
  whatsappOptIn: z.boolean().optional(),
})
export type UpdateGuardianRequest = z.infer<typeof UpdateGuardianRequestSchema>

export const LinkGuardianRequestSchema = z.object({
  guardianId: UuidSchema,
  relationship: z.string().min(1, 'Relationship is required'),
  isPrimary: z.boolean().default(false),
  paysFees: z.boolean().default(true),
  sharePercent: z.number().int().min(1).max(100).optional(),
})
export type LinkGuardianRequest = z.infer<typeof LinkGuardianRequestSchema>

export const EnrollStudentRequestSchema = z.object({
  studentId: UuidSchema,
  classGroupId: UuidSchema,
  academicYearId: UuidSchema,
  feeScheduleId: UuidSchema,
  enrolledOn: CalendarDateSchema.optional(),
  carriedForwardBalanceMinor: z.string().regex(/^-?\d+$/).optional().default('0'),
})
export type EnrollStudentRequest = z.input<typeof EnrollStudentRequestSchema>

