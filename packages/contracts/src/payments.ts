/**
 * Payments and the cash desk — including the cash-session controls that
 * answer "espèces mal tracées" (PRD §4, ARCHITECTURE.md §8.3-8.4).
 */
import { z } from 'zod'
import { IsoDateTimeSchema, UuidSchema } from './common.js'
import { MoneySchema } from './money.js'

export const PaymentMethodSchema = z.enum([
  'mobile_money',
  'cash',
  'bank_transfer',
  'cheque',
  'card',
  'waiver',
])
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>

export const PaymentStatusSchema = z.enum([
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
])
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>

export const PaymentListItemSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  matricule: z.string(),
  method: PaymentMethodSchema,
  amount: MoneySchema,
  status: PaymentStatusSchema,
  provider: z.string().nullable(),
  receivedAt: IsoDateTimeSchema.nullable(),
  /** Null while unreconciled — the dashboard must make a stuck payment obvious. */
  reconciledAt: IsoDateTimeSchema.nullable(),
  receiptNumber: z.string().nullable(),
})
export type PaymentListItem = z.infer<typeof PaymentListItemSchema>

export const PaymentQuerySchema = z.object({
  search: z.string().optional(),
  method: PaymentMethodSchema.optional(),
  status: PaymentStatusSchema.optional(),
  /** Surfaces payments stuck in pending/processing — the reconciliation queue. */
  unreconciledOnly: z.boolean().optional(),
})

/**
 * Recording a cash payment. `idempotencyKey` is REQUIRED, not optional —
 * AGENTS.md rule #5. The cashier will double-tap on a bad connection, and
 * the contract is where that stops being possible.
 */
export const RecordCashPaymentSchema = z.object({
  studentId: UuidSchema,
  amount: MoneySchema,
  instalmentId: UuidSchema.optional(),
  payerName: z.string().optional(),
  idempotencyKey: z.string().uuid(),
})
export type RecordCashPayment = z.infer<typeof RecordCashPaymentSchema>

export const CashSessionStatusSchema = z.enum(['open', 'closed', 'reconciled', 'flagged'])

export const CashMovementSchema = z.object({
  id: UuidSchema,
  type: z.enum(['payment', 'float_in', 'float_out', 'deposit_to_bank', 'correction']),
  amount: MoneySchema,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
})

export const CashSessionSchema = z.object({
  id: UuidSchema,
  deskName: z.string(),
  cashierName: z.string(),
  status: CashSessionStatusSchema,
  openedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.nullable(),
  openingFloat: MoneySchema,
  /** Computed: opening float + Σ movements. Shown BEFORE the cashier confirms a count. */
  expectedClose: MoneySchema,
  declaredClose: MoneySchema.nullable(),
  variance: MoneySchema.nullable(),
  varianceReason: z.string().nullable(),
  movements: z.array(CashMovementSchema),
})
export type CashSession = z.infer<typeof CashSessionSchema>

export const OpenCashSessionInputSchema = z.object({
  cashDeskId: UuidSchema,
  openingFloat: MoneySchema,
  idempotencyKey: z.string().uuid(),
})

/**
 * Closing a desk. `varianceReason` is required whenever the declared count
 * differs from expected — enforced here, not just in the UI
 * (ARCHITECTURE.md §8.4).
 */
export const CloseCashSessionInputSchema = z
  .object({
    declaredClose: MoneySchema,
    varianceReason: z.string().min(1).optional(),
    expectedClose: MoneySchema,
    idempotencyKey: z.string().uuid(),
  })
  .refine(
    (input) => input.declaredClose.amountMinor === input.expectedClose.amountMinor || Boolean(input.varianceReason),
    { message: 'varianceReason is required when the declared count differs from expected', path: ['varianceReason'] },
  )
export type CloseCashSessionInput = z.infer<typeof CloseCashSessionInputSchema>

export type PaymentQuery = z.infer<typeof PaymentQuerySchema>

/* ------------------------------------------------------------ payment link
 * The PUBLIC pay page (ARCHITECTURE.md §8.2). No authentication, hostile
 * territory, and the payer is a parent on a phone with a bad connection.
 */

export const PaymentOperatorSchema = z.enum(['mtn', 'orange', 'moov', 'wave', 'card'])
export type PaymentOperator = z.infer<typeof PaymentOperatorSchema>

/**
 * What the pay page shows. Deliberately thin: enough for a parent to be sure
 * they are paying for the right child at the right school, and nothing an
 * onward-forwarded link should not carry.
 */
export const PayLinkViewSchema = z.object({
  schoolName: z.string(),
  studentName: z.string(),
  className: z.string(),
  /** What is still owed on the whole invoice. */
  balance: MoneySchema,
  /** What this particular link is for — a named tranche, or the balance. */
  suggestedAmount: MoneySchema,
  minAmount: MoneySchema,
  instalmentLabel: z.string().nullable(),
  expiresAt: IsoDateTimeSchema,
  operators: z.array(PaymentOperatorSchema),
})
export type PayLinkView = z.infer<typeof PayLinkViewSchema>

/**
 * `idempotencyKey` is REQUIRED (rule #5). A parent on a failing connection
 * will tap twice, and the contract is where that stops being possible.
 */
export const InitiatePayLinkSchema = z.object({
  amount: MoneySchema,
  operator: PaymentOperatorSchema,
  /** E.164. The phone that will get the PIN prompt. */
  payerPhoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/, 'must be an E.164 phone number'),
  payerName: z.string().max(120).optional(),
  idempotencyKey: z.string().uuid(),
})
export type InitiatePayLink = z.infer<typeof InitiatePayLinkSchema>

export const InitiatePayLinkResultSchema = z.object({
  paymentId: UuidSchema,
  /** Present when the provider hosts a page; absent when it pushed a prompt. */
  checkoutUrl: z.string().url().nullable(),
  pushSent: z.boolean(),
  status: PaymentStatusSchema,
})
export type InitiatePayLinkResult = z.infer<typeof InitiatePayLinkResultSchema>
