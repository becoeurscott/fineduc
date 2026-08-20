/**
 * Reading an invoice and a student's statement (ARCHITECTURE.md §12).
 *
 * Every amount is a `MoneySchema` — an integer string plus a currency, never
 * a JSON number. `remaining` and `balance` are computed server-side and sent
 * explicitly rather than left for the client to subtract: four clients
 * subtracting bigints in JavaScript is four chances to reintroduce the
 * floating-point bug the whole money design exists to prevent.
 */
import { z } from 'zod'
import { CalendarDateSchema, UuidSchema } from './common.js'
import { MoneySchema } from './money.js'
import { InstalmentSchema, LedgerEntrySchema } from './students.js'
import { FeeCategorySchema } from './fees.js'

export const InvoiceStatusSchema = z.enum(['open', 'partial', 'paid', 'cancelled'])
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>

export const InvoiceLineSchema = z.object({
  id: UuidSchema,
  label: z.string(),
  category: FeeCategorySchema,
  amount: MoneySchema,
  quantity: z.number().int().positive(),
  /** amount × quantity, computed here so no client multiplies money itself. */
  lineTotal: MoneySchema,
})
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>

export const InvoiceDiscountSchema = z.object({
  id: UuidSchema,
  type: z.enum(['sibling', 'staff', 'merit', 'hardship', 'commercial']),
  method: z.enum(['percent', 'fixed']),
  /**
   * The resolved integer, which is what actually applied. The original
   * percentage is kept alongside it purely so a bursar can explain the
   * figure — it is never re-applied (ARCHITECTURE.md §5).
   */
  amount: MoneySchema,
  percentBp: z.number().int().nullable(),
  reason: z.string().nullable(),
})
export type InvoiceDiscount = z.infer<typeof InvoiceDiscountSchema>

export const InvoiceSchema = z.object({
  id: UuidSchema,
  number: z.string(),
  status: InvoiceStatusSchema,
  issuedOn: CalendarDateSchema,

  studentId: UuidSchema,
  studentName: z.string(),
  matricule: z.string(),
  className: z.string(),
  academicYearName: z.string(),

  /** Gross, before discounts. */
  total: MoneySchema,
  discount: MoneySchema,
  /** total − discount. What the instalments must sum to, exactly. */
  net: MoneySchema,
  paid: MoneySchema,
  balance: MoneySchema,

  lines: z.array(InvoiceLineSchema),
  discounts: z.array(InvoiceDiscountSchema),
  instalments: z.array(InstalmentSchema),
})
export type Invoice = z.infer<typeof InvoiceSchema>

/**
 * The account statement: the append-only ledger, oldest first, as a bursar
 * or a parent would read it down the page.
 */
export const StudentStatementSchema = z.object({
  studentId: UuidSchema,
  studentName: z.string(),
  matricule: z.string(),
  /** The running balance after the last entry — what is still owed. */
  balance: MoneySchema,
  entries: z.array(LedgerEntrySchema),
})
export type StudentStatement = z.infer<typeof StudentStatementSchema>
