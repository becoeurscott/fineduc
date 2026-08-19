/**
 * The director's screen (ARCHITECTURE.md §13). One call, cached 30s.
 * This is the "le directeur voit tout en temps réel" surface — the thing
 * the buyer actually pays for.
 */
import { z } from 'zod'
import { CalendarDateSchema, IsoDateTimeSchema, UuidSchema } from './common.js'
import { MoneySchema } from './money.js'

/** Arrears bucketed by age (PRD §4). */
export const AgeBucketSchema = z.enum(['0-30', '31-60', '61-90', '90+'])
export type AgeBucket = z.infer<typeof AgeBucketSchema>

export const CollectionPointSchema = z.object({
  on: CalendarDateSchema,
  collected: MoneySchema,
})

export const MethodMixSchema = z.object({
  method: z.enum(['mobile_money', 'cash', 'bank_transfer', 'cheque', 'card', 'waiver']),
  amount: MoneySchema,
  /** Basis points of the period total — integer, so no float drift in a pie chart. */
  shareBp: z.number().int().min(0).max(10_000),
})

export const ArrearsByClassSchema = z.object({
  classGroupId: UuidSchema,
  className: z.string(),
  studentsInArrears: z.number().int().nonnegative(),
  totalStudents: z.number().int().nonnegative(),
  outstanding: MoneySchema,
})

export const ArrearsAgeingSchema = z.object({
  bucket: AgeBucketSchema,
  outstanding: MoneySchema,
  studentCount: z.number().int().nonnegative(),
})

export const OpenCashSessionSchema = z.object({
  sessionId: UuidSchema,
  deskName: z.string(),
  cashierName: z.string(),
  openedAt: IsoDateTimeSchema,
  expectedInDrawer: MoneySchema,
})

/**
 * Reminder effectiveness — the number that justifies the messaging spend,
 * and the anti-metric from PRD §6 (cost per 1 000 XAF collected).
 */
export const ReminderEffectivenessSchema = z.object({
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  collectedWithin72h: MoneySchema,
  messagingCost: MoneySchema,
})

export const DashboardOverviewSchema = z.object({
  asOf: IsoDateTimeSchema,
  tenantName: z.string(),
  academicYearName: z.string(),

  collectedToday: MoneySchema,
  collectedThisWeek: MoneySchema,
  collectedThisTerm: MoneySchema,
  expectedThisTerm: MoneySchema,

  /** Basis points: 8 750 = 87.50%. Integer — never a float percentage. */
  recoveryRateBp: z.number().int().min(0).max(10_000),

  totalOutstanding: MoneySchema,
  studentsInArrears: z.number().int().nonnegative(),
  totalStudents: z.number().int().nonnegative(),

  arrearsByClass: z.array(ArrearsByClassSchema),
  arrearsAgeing: z.array(ArrearsAgeingSchema),
  methodMix: z.array(MethodMixSchema),
  collectionTrend: z.array(CollectionPointSchema),
  openCashSessions: z.array(OpenCashSessionSchema),
  reminders: ReminderEffectivenessSchema,

  /** Non-blocking warnings the director should see: unclosed desk, credits low, reconciliation mismatch. */
  alerts: z.array(
    z.object({
      severity: z.enum(['info', 'warning', 'critical']),
      code: z.string(),
      message: z.string(),
    }),
  ),
})
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>
