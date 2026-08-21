import type { TenantTransactionClient } from '@fineduc/db'
import {
  addCalendarDays,
  effectiveDueOn,
  isMoratoriumActive,
  isInstalmentSettled,
  tenantLocalToInstant,
  toTenantDate,
  type MoratoriumStatus,
} from '@fineduc/domain'

/**
 * Materialising reminder intent for ONE instalment (ARCHITECTURE.md §8.5).
 *
 * There is exactly one implementation of "which reminders should exist for
 * this instalment right now", and both callers use it:
 *
 *  - the nightly `reminder-scheduler`, sweeping every instalment in a window;
 *  - the API, the moment a moratoire is granted, refused or cancelled.
 *
 * The second caller is not an optimisation. `message-sender` runs every
 * fifteen minutes, so a moratoire granted at 14:00 that only took effect at
 * the next 02:00 sweep would let the ordinary ladder chase the family all
 * afternoon — for a delay the school had just agreed to. Equally, a refusal
 * the day before a due date has to put the ladder BACK, or the family gets
 * nothing at all.
 *
 * Two implementations of that would drift, and the drift would be invisible
 * until a parent complained.
 *
 * This decides only what to MATERIALISE. Whether a materialised row actually
 * goes out is re-decided at send time by `decideEligibility` against the live
 * row (AGENTS.md rule #7). Nothing here is trusted later.
 */

/** Written to `skip_reason` on rows this service suppresses, and ONLY those. */
export const SUPPRESSED_BY_MORATORIUM = 'moratorium_granted'

export interface MaterialiseParams {
  readonly instalmentId: string
  /** YYYY-MM-DD in the tenant's timezone. */
  readonly today: string
  readonly timezone: string
  /** Tenant-local hour reminders are aimed at. */
  readonly sendHour: number
}

export interface MaterialiseResult {
  readonly created: number
  readonly updated: number
  readonly revived: number
  readonly suppressed: number
}

interface DesiredSchedule {
  readonly reminderRuleId: string
  readonly guardianId: string
  readonly scheduledFor: Date
}

export class ReminderSchedulingService {
  /**
   * Bring `reminder_schedule` into line with what the rules, the calendar and
   * any moratoire say should exist for this instalment.
   *
   * Idempotent: running it twice changes nothing the second time, which is
   * what makes the nightly sweep safe to re-run and safe to overlap with an
   * API call that has just granted something.
   */
  async materialiseFor(
    tx: TenantTransactionClient,
    tenantId: string,
    params: MaterialiseParams,
  ): Promise<MaterialiseResult> {
    const instalment = await tx.instalment.findUnique({
      where: { id: params.instalmentId },
      include: { invoice: { include: { enrollment: true } } },
    })
    if (!instalment || instalment.tenantId !== tenantId) {
      return { created: 0, updated: 0, revived: 0, suppressed: 0 }
    }

    const dueOn = toTenantDate(instalment.dueOn, 'UTC')
    const studentId = instalment.invoice.enrollment.studentId

    /*
     * A settled instalment gets nothing at all, and anything still standing
     * for it is cancelled. Belt to the sender's brace: the sender would skip
     * it as `settled` anyway, but leaving rows queued for a paid tranche
     * means a bursar reading the schedule sees chasing that will not happen.
     */
    if (isInstalmentSettled(instalment)) {
      const suppressed = await this.cancelAll(tx, tenantId, params.instalmentId, 'settled')
      return { created: 0, updated: 0, revived: 0, suppressed }
    }

    const moratorium = await tx.moratorium.findFirst({
      where: { tenantId, instalmentId: params.instalmentId, status: { in: ['pending', 'granted'] } },
    })
    const moratoriumView = moratorium
      ? {
          status: moratorium.status as MoratoriumStatus,
          deferredDueOn: toTenantDate(moratorium.deferredDueOn, 'UTC'),
          /** Tenant-local date the delay was agreed. Null while pending. */
          decidedOn: moratorium.decidedAt ? toTenantDate(moratorium.decidedAt, params.timezone) : null,
        }
      : null
    const active = isMoratoriumActive(moratoriumView, params.today)
    const anchorForEnd = effectiveDueOn({ dueOn }, moratoriumView)

    const [rules, payers] = await Promise.all([
      tx.reminderRule.findMany({ where: { tenantId, isActive: true } }),
      tx.studentGuardian.findMany({ where: { tenantId, studentId, paysFees: true } }),
    ])

    const desired: DesiredSchedule[] = []
    for (const rule of rules) {
      const anchor = rule.basis === 'moratorium_end' ? anchorForEnd : dueOn

      // While a delay is running the ordinary ladder is silent, and only then
      // do the end-of-moratoire rules have an anchor worth counting from.
      if (rule.basis === 'due_date' && active) continue
      if (rule.basis === 'moratorium_end' && !active) continue

      const on = addCalendarDays(anchor, rule.offsetDays)

      // Never schedule into the past — a sweep run late must not queue a
      // reminder about a date that has already gone by.
      if (on < params.today) continue

      /*
       * The seven-day trap. `deferred − 7` is `original + 7 − 7`, i.e. the
       * original due date, so a one-week moratoire granted ON that date
       * produces a "your delay ends in a week" reminder dated the very day it
       * was agreed. Requiring the anchor to fall strictly AFTER the day of
       * the decision drops it, and a 7-day moratoire correctly gets only the
       * eve reminder. Granted earlier, the same rule legitimately fires.
       */
      if (rule.basis === 'moratorium_end' && moratoriumView?.decidedOn && on <= moratoriumView.decidedOn) {
        continue
      }

      const scheduledFor = tenantLocalToInstant(on, params.sendHour, params.timezone)
      for (const payer of payers) {
        desired.push({ reminderRuleId: rule.id, guardianId: payer.guardianId, scheduledFor })
      }
    }

    return this.reconcile(tx, tenantId, params.instalmentId, desired)
  }

  /**
   * Make the stored rows match `desired`, without ever resurrecting history.
   */
  private async reconcile(
    tx: TenantTransactionClient,
    tenantId: string,
    instalmentId: string,
    desired: readonly DesiredSchedule[],
  ): Promise<MaterialiseResult> {
    const existing = await tx.reminderSchedule.findMany({ where: { tenantId, instalmentId } })
    const key = (ruleId: string, guardianId: string): string => `${ruleId}:${guardianId}`
    const byKey = new Map(existing.map((row) => [key(row.reminderRuleId, row.guardianId), row]))
    const wanted = new Set(desired.map((row) => key(row.reminderRuleId, row.guardianId)))

    let created = 0
    let updated = 0
    let revived = 0

    for (const row of desired) {
      const current = byKey.get(key(row.reminderRuleId, row.guardianId))

      if (!current) {
        await tx.reminderSchedule.create({
          data: {
            tenantId,
            instalmentId,
            reminderRuleId: row.reminderRuleId,
            guardianId: row.guardianId,
            scheduledFor: row.scheduledFor,
            status: 'scheduled',
          },
        })
        created += 1
        continue
      }

      if (current.status === 'scheduled') {
        if (current.scheduledFor.getTime() !== row.scheduledFor.getTime()) {
          await tx.reminderSchedule.update({
            where: { id: current.id },
            data: { scheduledFor: row.scheduledFor },
          })
          updated += 1
        }
        continue
      }

      /*
       * A row we suppressed ourselves may come back — that is a refused or
       * cancelled moratoire putting the ladder back. Anything else stays
       * where it is: a `sent` row must never be re-queued, and one cancelled
       * because the family PAID must never be revived by a scheduler sweep.
       * The skip reason is the only thing that distinguishes them, which is
       * why this service writes a reason nothing else writes.
       */
      if (current.status === 'cancelled' && current.skipReason === SUPPRESSED_BY_MORATORIUM) {
        await tx.reminderSchedule.update({
          where: { id: current.id },
          data: { status: 'scheduled', skipReason: null, scheduledFor: row.scheduledFor },
        })
        revived += 1
      }
    }

    // Anything still `scheduled` that is no longer wanted is a due-date rung
    // silenced by a delay the school granted.
    const staleIds = existing
      .filter((row) => row.status === 'scheduled' && !wanted.has(key(row.reminderRuleId, row.guardianId)))
      .map((row) => row.id)

    let suppressed = 0
    if (staleIds.length > 0) {
      const result = await tx.reminderSchedule.updateMany({
        where: { id: { in: staleIds } },
        data: { status: 'cancelled', skipReason: SUPPRESSED_BY_MORATORIUM },
      })
      suppressed = result.count
    }

    return { created, updated, revived, suppressed }
  }

  private async cancelAll(
    tx: TenantTransactionClient,
    tenantId: string,
    instalmentId: string,
    reason: string,
  ): Promise<number> {
    const result = await tx.reminderSchedule.updateMany({
      where: { tenantId, instalmentId, status: 'scheduled' },
      data: { status: 'cancelled', skipReason: reason },
    })
    return result.count
  }
}
