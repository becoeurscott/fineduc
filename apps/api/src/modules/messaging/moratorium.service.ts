import { Inject, Injectable, Optional } from '@nestjs/common'
import { withTenant, type PrismaClient, type TenantTransactionClient } from '@fineduc/db'
import { Money, assertCurrencyCode } from '@fineduc/money'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  computeDeferredDueOn,
  decideMoratoriumOffer,
  decideMoratoriumRequest,
  moratoriumTransition,
  toTenantDate,
  MAX_MORATORIUM_DAYS,
  type MoratoriumContext,
  type MoratoriumStatus,
} from '@fineduc/domain'
import {
  fromMoney,
  readMoratoriumPolicy,
  type ApproveMoratoriumInput,
  type MoratoriumChatView,
  type MoratoriumListItem,
  type MoratoriumRequestInput,
  type MoratoriumRequestResult,
  type ParseDelayResult,
  type StaffGrantMoratoriumInput,
} from '@fineduc/contracts'
import { ReminderSchedulingService, parseTenantToken } from '@fineduc/services'
import { readMessagingSettings } from '@fineduc/contracts'
import type { DateRequestParser } from '@fineduc/providers'

export const DATE_REQUEST_PARSER = Symbol('DATE_REQUEST_PARSER')

/**
 * Le moratoire (ARCHITECTURE.md §8.5b).
 *
 * Lives in `apps/api` rather than `packages/services` on purpose: the entry
 * rule for that package is "only if BOTH api and worker run it", and the
 * worker never grants, approves or refuses anything. What both DO run —
 * turning a moratoire into reminder schedules — is
 * `ReminderSchedulingService`, which is where it belongs.
 *
 * Every write re-materialises the reminder schedules in the SAME transaction.
 * The sender runs every fifteen minutes, so waiting for the 02:00 sweep would
 * chase a family all afternoon for a delay just agreed — and, on a refusal,
 * would leave them with no reminder at all.
 */
@Injectable()
export class MoratoriumService {
  constructor(
    private readonly scheduling: ReminderSchedulingService,
    @Optional() @Inject(DATE_REQUEST_PARSER) private readonly parser: DateRequestParser | null,
  ) {}

  /* ------------------------------------------------------- public chat -- */

  /**
   * `GET /moratoire/:token`.
   *
   * Every way of being wrong — malformed, unknown, expired, or a token whose
   * tenant does not own the instalment — returns the SAME 404. Telling them
   * apart would confirm which schools and which links exist.
   *
   * One deliberate exception, AFTER the 256-bit secret has checked out: an
   * unavailable offer comes back as a 200 with a reason, so the chat can say
   * "cette tranche est déjà payée" instead of sending a parent to the
   * secretary for nothing. Nothing leaks — it only speaks to someone who
   * already held the token.
   */
  async view(prisma: PrismaClient, token: string, now: Date): Promise<MoratoriumChatView> {
    const parsed = parseTenantToken(token)
    if (!parsed) throw new NotFoundError('moratorium_chat_link', 'token')

    return withTenant(prisma, parsed.tenantId, async (tx) => {
      const link = await this.findLink(tx, parsed.tenantId, token, now)
      const ctx = await this.loadContext(tx, parsed.tenantId, link.instalmentId, now)
      const offer = decideMoratoriumOffer(ctx.context)

      // The page is written for whoever holds the LINK, so the language is
      // the guardian's, not the student's — a student row has no locale and
      // should not grow one for this.
      const guardian = await tx.guardian.findUniqueOrThrow({ where: { id: link.guardianId } })
      const locale = guardian.preferredLocale === 'en' ? ('en' as const) : ('fr' as const)

      const existing = ctx.moratorium
      return {
        schoolName: ctx.tenant.name,
        studentFirstName: ctx.student.firstName,
        instalmentLabel: ctx.instalment.label,
        amountDue: fromMoney(ctx.owed),
        dueOn: ctx.context.instalment.dueOn,
        locale,
        approvalMode: ctx.context.policy.approval,
        offer: offer.offer
          ? {
              available: true,
              reason: null,
              // Each option carries its own end date, computed here. The chat
              // never does date arithmetic — a browser clock in the wrong
              // timezone would show a parent a different deadline from the
              // one the school recorded.
              options: offer.durationsDays.map((days) => ({
                days,
                deferredDueOn: computeDeferredDueOn(ctx.context.instalment.dueOn, days),
              })),
              latestDeferredDueOn: offer.latestDeferredDueOn,
              collidesWithNextInstalment: offer.collidesWithNextInstalment,
            }
          : {
              available: false,
              reason: offer.reason,
              options: [],
              latestDeferredDueOn: null,
              collidesWithNextInstalment: false,
            },
        existing: existing
          ? {
              status: existing.status as MoratoriumStatus,
              requestedDays: existing.requestedDays,
              deferredDueOn: toTenantDate(existing.deferredDueOn, 'UTC'),
              decisionNote: existing.decisionNote,
            }
          : null,
      }
    })
  }

  /**
   * `POST /moratoire/:token/request`.
   *
   * Idempotent in the way that matters to a parent tapping twice on a 2G
   * connection: the second tap shows the SAME answer, as a 200, not a 409.
   * The partial unique index is the authority — a read-then-write would let
   * two concurrent requests both pass.
   */
  async request(
    prisma: PrismaClient,
    token: string,
    input: MoratoriumRequestInput,
    now: Date,
  ): Promise<MoratoriumRequestResult> {
    const parsed = parseTenantToken(token)
    if (!parsed) throw new NotFoundError('moratorium_chat_link', 'token')
    const tenantId = parsed.tenantId

    /*
     * 1. THE REPLAY CHECK, FIRST — before the offer is even consulted.
     *
     * A parent who taps twice sends the same idempotency key twice. If the
     * offer ran first it would see the row the first tap created and answer
     * `already_used`, which is true of a SECOND request and a lie about a
     * retry of the first one. Rule #5 means the key decides.
     */
    const replay = await withTenant(prisma, tenantId, (tx) =>
      tx.moratorium.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
      }),
    )
    if (replay) return this.outcomeOf(replay)

    let instalmentId = ''
    try {
      return await withTenant(prisma, tenantId, async (tx) => {
        const link = await this.findLink(tx, tenantId, token, now)
        instalmentId = link.instalmentId
        const ctx = await this.loadContext(tx, tenantId, link.instalmentId, now)

        const decision = decideMoratoriumRequest({ ...ctx.context, requestedDays: input.durationDays })
        if (decision.outcome === 'rejected') {
          return {
            status: 'rejected' as const,
            deferredDueOn: null,
            reason: isBlockedReason(decision.reason) ? decision.reason : null,
            mayAskAgain: this.mayAskAgain(ctx.context, ctx.moratorium?.status as MoratoriumStatus | undefined),
          }
        }

        const created = await tx.moratorium.create({
          data: {
            tenantId,
            instalmentId: link.instalmentId,
            studentId: link.studentId,
            guardianId: link.guardianId,
            status: decision.outcome === 'granted' ? 'granted' : 'pending',
            source: 'chatbot',
            requestedDays: input.durationDays,
            originalDueOn: new Date(decision.originalDueOn),
            deferredDueOn: new Date(decision.deferredDueOn),
            reason: input.reason ?? null,
            idempotencyKey: input.idempotencyKey,
            decidedAt: decision.outcome === 'granted' ? now : null,
          },
        })

        await this.emit(
          tx,
          tenantId,
          created.id,
          decision.outcome === 'granted' ? 'moratorium.granted' : 'moratorium.requested',
          {
            instalmentId: link.instalmentId,
            studentId: link.studentId,
            requestedDays: input.durationDays,
            deferredDueOn: decision.deferredDueOn,
          },
        )

        await tx.moratoriumChatLink.update({ where: { id: link.id }, data: { consumedAt: now } })
        await this.rematerialise(tx, tenantId, link.instalmentId, ctx, now)

        return {
          status: decision.outcome,
          deferredDueOn: decision.deferredDueOn,
          reason: null,
          mayAskAgain: false,
        }
      })
    } catch (error) {
      if (!isUniqueViolation(error) || !instalmentId) throw error

      /*
       * 2. A TRUE RACE: two guardians, or two taps with different keys, in
       * the same instant. Both passed the offer check because neither could
       * see the other yet, and the partial unique index picked one.
       *
       * The re-read runs in a NEW transaction, and that is the whole point
       * of catching out here: Postgres aborts a transaction on a constraint
       * violation, so a re-read inside the failed one fails too. Doing it
       * inline looks tidier and returns a 500.
       *
       * The loser gets the WINNER'S answer, as a 200. To a parent tapping
       * twice, "idempotent" means the second tap shows the same answer.
       */
      return withTenant(prisma, tenantId, async (tx) => {
        const winner = await tx.moratorium.findFirstOrThrow({
          where: { tenantId, instalmentId, status: { in: ['pending', 'granted'] } },
        })
        return this.outcomeOf(winner)
      })
    }
  }

  /** Report a stored row as though this request had produced it. */
  private outcomeOf(row: {
    status: string
    deferredDueOn: Date
  }): MoratoriumRequestResult {
    return {
      status: row.status === 'granted' ? 'granted' : row.status === 'pending' ? 'pending' : 'rejected',
      deferredDueOn: toTenantDate(row.deferredDueOn, 'UTC'),
      reason: null,
      mayAskAgain: false,
    }
  }

  /* ------------------------------------------------- free-text parsing -- */

  /**
   * `POST /moratoire/:token/parse` — LLM fallback for typed input.
   *
   * Read-only: returns the parsed duration so the UI can pre-select a button,
   * but moves no date. The parent still confirms through the existing request
   * flow. If no parser is configured, returns null.
   */
  async parseDelay(
    prisma: PrismaClient,
    token: string,
    text: string,
    now: Date,
  ): Promise<ParseDelayResult> {
    if (!this.parser) return { days: null, deferredDueOn: null }

    const parsed = parseTenantToken(token)
    if (!parsed) throw new NotFoundError('moratorium_chat_link', 'token')

    return withTenant(prisma, parsed.tenantId, async (tx) => {
      const link = await this.findLink(tx, parsed.tenantId, token, now)
      const ctx = await this.loadContext(tx, parsed.tenantId, link.instalmentId, now)
      const offer = decideMoratoriumOffer(ctx.context)
      if (!offer.offer) return { days: null, deferredDueOn: null }

      const guardian = await tx.guardian.findUniqueOrThrow({ where: { id: link.guardianId } })
      const locale = guardian.preferredLocale === 'en' ? 'en' : 'fr'

      const result = await this.parser!.parse(text, offer.durationsDays, locale)
      if (result.days === null) return { days: null, deferredDueOn: null }

      const deferredDueOn = computeDeferredDueOn(ctx.context.instalment.dueOn, result.days)
      return { days: result.days, deferredDueOn }
    })
  }

  /* ------------------------------------------------------ staff-facing -- */

  async list(
    tx: TenantTransactionClient,
    tenantId: string,
    filters: { status?: MoratoriumStatus },
  ): Promise<MoratoriumListItem[]> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
    const currency = assertCurrencyCode(tenant.currency)

    const rows = await tx.moratorium.findMany({
      where: { tenantId, ...(filters.status ? { status: filters.status } : {}) },
      orderBy: { requestedAt: 'desc' },
      include: {
        student: true,
        instalment: { include: { invoice: { include: { enrollment: { include: { classGroup: true } } } } } },
      },
    })

    // How many times this family has already been told no on this tranche.
    // A bursar being asked a second time should be able to see it.
    const refusals = await tx.moratorium.groupBy({
      by: ['instalmentId'],
      where: { tenantId, status: 'refused' },
      _count: { _all: true },
    })
    const refusalsByInstalment = new Map(refusals.map((row) => [row.instalmentId, row._count._all]))

    return rows.map((row) => ({
      id: row.id,
      studentId: row.studentId,
      studentName: `${row.student.firstName} ${row.student.lastName}`,
      className: row.instalment.invoice.enrollment.classGroup?.name ?? null,
      instalmentId: row.instalmentId,
      instalmentLabel: row.instalment.label,
      amountDue: fromMoney(
        Money.of(row.instalment.amountMinor - row.instalment.allocatedMinor, currency),
      ),
      status: row.status as MoratoriumStatus,
      source: row.source,
      requestedDays: row.requestedDays,
      originalDueOn: toTenantDate(row.originalDueOn, 'UTC'),
      deferredDueOn: toTenantDate(row.deferredDueOn, 'UTC'),
      reason: row.reason,
      requestedAt: row.requestedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
      priorRefusals: refusalsByInstalment.get(row.instalmentId) ?? 0,
    }))
  }

  async approve(
    tx: TenantTransactionClient,
    tenantId: string,
    moratoriumId: string,
    input: ApproveMoratoriumInput,
    actorUserId: string,
    now: Date,
  ): Promise<{ status: MoratoriumStatus; deferredDueOn: string }> {
    const row = await this.findOwn(tx, tenantId, moratoriumId)
    const next = moratoriumTransition(row.status as MoratoriumStatus, 'approve')

    const originalDueOn = toTenantDate(row.originalDueOn, 'UTC')
    let deferredDueOn = toTenantDate(row.deferredDueOn, 'UTC')

    if (input.deferredDueOn) {
      /*
       * A bursar may SHORTEN a delay, never lengthen it past the cap. The
       * hand-typed date goes through the same ceiling as the chat, because a
       * staff field is exactly where a 21-day rule would otherwise be worked
       * around one keystroke at a time.
       */
      const latest = computeDeferredDueOn(originalDueOn, MAX_MORATORIUM_DAYS)
      if (input.deferredDueOn > latest) {
        throw new ValidationError(
          'moratorium_duration_out_of_range',
          `A moratoire cannot run past ${latest} — ${MAX_MORATORIUM_DAYS} days from the original due date.`,
        )
      }
      if (input.deferredDueOn <= originalDueOn) {
        throw new ValidationError(
          'moratorium_deferred_not_after_due',
          `A moratoire must end after the original due date (${originalDueOn}).`,
        )
      }
      deferredDueOn = input.deferredDueOn
    }

    await tx.moratorium.update({
      where: { id: moratoriumId },
      data: {
        status: next,
        deferredDueOn: new Date(deferredDueOn),
        decidedAt: now,
        decidedBy: actorUserId,
        decisionNote: input.note ?? null,
      },
    })
    await this.emit(tx, tenantId, moratoriumId, 'moratorium.granted', { deferredDueOn })
    await this.rematerialiseById(tx, tenantId, row.instalmentId, now)

    return { status: next, deferredDueOn }
  }

  async decline(
    tx: TenantTransactionClient,
    tenantId: string,
    moratoriumId: string,
    action: 'refuse' | 'cancel',
    note: string,
    actorUserId: string,
    now: Date,
  ): Promise<{ status: MoratoriumStatus }> {
    const row = await this.findOwn(tx, tenantId, moratoriumId)
    const next = moratoriumTransition(row.status as MoratoriumStatus, action)

    await tx.moratorium.update({
      where: { id: moratoriumId },
      data: { status: next, decidedAt: now, decidedBy: actorUserId, decisionNote: note },
    })
    await this.emit(tx, tenantId, moratoriumId, `moratorium.${next}`, { note: null })
    // Puts the ordinary ladder BACK, in this transaction. A refusal the day
    // before a due date must not leave the family with nothing.
    await this.rematerialiseById(tx, tenantId, row.instalmentId, now)

    return { status: next }
  }

  /** A bursar recording a moratoire for a parent who walked into the office. */
  async grantAtDesk(
    tx: TenantTransactionClient,
    tenantId: string,
    instalmentId: string,
    input: StaffGrantMoratoriumInput,
    actorUserId: string,
    now: Date,
  ): Promise<{ status: MoratoriumStatus; deferredDueOn: string }> {
    const ctx = await this.loadContext(tx, tenantId, instalmentId, now)
    const decision = decideMoratoriumRequest({ ...ctx.context, requestedDays: input.durationDays })
    if (decision.outcome === 'rejected') {
      throw new ConflictError('MORATORIUM_NOT_AVAILABLE', `Cannot grant a moratoire here: ${decision.reason}.`)
    }

    // Staff-granted is always granted — a bursar approving their own entry
    // through a pending state would be theatre.
    const created = await tx.moratorium.create({
      data: {
        tenantId,
        instalmentId,
        studentId: ctx.student.id,
        guardianId: input.guardianId ?? null,
        status: 'granted',
        source: 'staff',
        requestedDays: input.durationDays,
        originalDueOn: new Date(decision.originalDueOn),
        deferredDueOn: new Date(decision.deferredDueOn),
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey,
        decidedAt: now,
        decidedBy: actorUserId,
      },
    })
    await this.emit(tx, tenantId, created.id, 'moratorium.granted', { deferredDueOn: decision.deferredDueOn })
    await this.rematerialise(tx, tenantId, instalmentId, ctx, now)

    return { status: 'granted', deferredDueOn: decision.deferredDueOn }
  }

  /* ------------------------------------------------------------ internals */

  private async findLink(
    tx: TenantTransactionClient,
    tenantId: string,
    token: string,
    now: Date,
  ): Promise<{ id: string; instalmentId: string; studentId: string; guardianId: string }> {
    const link = await tx.moratoriumChatLink.findUnique({ where: { token } })
    // One 404 for every way of being wrong (see the doc comment on `view`).
    if (!link || link.tenantId !== tenantId || link.expiresAt <= now) {
      throw new NotFoundError('moratorium_chat_link', 'token')
    }
    return link
  }

  private async findOwn(tx: TenantTransactionClient, tenantId: string, id: string) {
    const row = await tx.moratorium.findUnique({ where: { id } })
    // Belt-and-braces on top of RLS, the same as every other service here.
    if (!row || row.tenantId !== tenantId) throw new NotFoundError('moratorium', id)
    return row
  }

  private mayAskAgain(context: MoratoriumContext, status: MoratoriumStatus | undefined): boolean {
    if (!status) return true
    if (status === 'pending' || status === 'granted') return false
    return context.policy.refusalFreesSlot
  }

  private async emit(
    tx: TenantTransactionClient,
    tenantId: string,
    moratoriumId: string,
    eventType: string,
    payload: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    // Written in the business transaction because it is free and it is audit.
    // NOTHING here may depend on it: no outbox-publisher exists yet, so these
    // rows accumulate unread — which is why the reminder re-scheduling above
    // happens inline rather than as an event handler.
    await tx.outboxEvent.create({
      data: { tenantId, aggregateType: 'moratorium', aggregateId: moratoriumId, eventType, payload },
    })
  }

  private async rematerialiseById(
    tx: TenantTransactionClient,
    tenantId: string,
    instalmentId: string,
    now: Date,
  ): Promise<void> {
    const ctx = await this.loadContext(tx, tenantId, instalmentId, now)
    await this.rematerialise(tx, tenantId, instalmentId, ctx, now)
  }

  private async rematerialise(
    tx: TenantTransactionClient,
    tenantId: string,
    instalmentId: string,
    ctx: LoadedContext,
    now: Date,
  ): Promise<void> {
    void now
    await this.scheduling.materialiseFor(tx, tenantId, {
      instalmentId,
      today: ctx.context.today,
      timezone: ctx.tenant.timezone,
      sendHour: ctx.sendHour,
    })
  }

  /**
   * Everything the domain decision needs, read once.
   */
  private async loadContext(
    tx: TenantTransactionClient,
    tenantId: string,
    instalmentId: string,
    now: Date,
  ): Promise<LoadedContext> {
    const instalment = await tx.instalment.findUnique({
      where: { id: instalmentId },
      include: { invoice: { include: { enrollment: { include: { student: true } } } } },
    })
    if (!instalment || instalment.tenantId !== tenantId) throw new NotFoundError('instalment', instalmentId)

    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
    const policy = readMoratoriumPolicy(tenant.settings)
    const messaging = readMessagingSettings(tenant.settings)
    const currency = assertCurrencyCode(tenant.currency)
    const today = toTenantDate(now, tenant.timezone)
    const dueOn = toTenantDate(instalment.dueOn, 'UTC')

    const moratorium = await tx.moratorium.findFirst({
      where: { tenantId, instalmentId },
      orderBy: { requestedAt: 'desc' },
    })

    // The NEXT tranche, for the collision warning. Same invoice, later date.
    const next = await tx.instalment.findFirst({
      where: { tenantId, invoiceId: instalment.invoiceId, dueOn: { gt: instalment.dueOn } },
      orderBy: { dueOn: 'asc' },
    })

    const student = instalment.invoice.enrollment.student
    return {
      tenant,
      student,
      instalment,
      sendHour: messaging.sendHour,
      owed: Money.of(instalment.amountMinor - instalment.allocatedMinor, currency),
      moratorium,
      context: {
        policy,
        instalment: {
          status: instalment.status,
          amountMinor: instalment.amountMinor,
          allocatedMinor: instalment.allocatedMinor,
          dueOn,
        },
        nextInstalmentDueOn: next ? toTenantDate(next.dueOn, 'UTC') : null,
        existingMoratorium: moratorium ? { status: moratorium.status as MoratoriumStatus } : null,
        today,
      },
    }
  }
}

interface LoadedContext {
  tenant: { id: string; name: string; timezone: string; currency: string }
  student: { id: string; firstName: string; lastName: string }
  instalment: { id: string; label: string; invoiceId: string }
  sendHour: number
  owed: Money
  moratorium: {
    status: string
    requestedDays: number
    deferredDueOn: Date
    decisionNote: string | null
  } | null
  context: MoratoriumContext
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}

const BLOCKED = new Set(['disabled', 'settled', 'already_used', 'too_early', 'too_late', 'zero_amount'])
function isBlockedReason(reason: string): reason is MoratoriumChatView['offer']['reason'] & string {
  return BLOCKED.has(reason)
}
