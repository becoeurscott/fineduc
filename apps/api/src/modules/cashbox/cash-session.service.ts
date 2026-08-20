import { Injectable } from '@nestjs/common'
import type { TenantTransactionClient } from '@fineduc/db'
import { Money, assertCurrencyCode, type CurrencyCode } from '@fineduc/money'
import {
  ConflictError,
  NotFoundError,
  assertSessionOpen,
  assertValidFloat,
  closeSession,
  expectedClose,
} from '@fineduc/domain'

/**
 * The cash desk (ARCHITECTURE.md §8.4).
 *
 * One open session per desk, enforced here AND by a partial unique index in
 * the database — the check below gives a readable 409, the index is what
 * actually holds under two cashiers opening at once.
 *
 * Closing is the anti-leak control: the system computes what the drawer
 * should hold, the cashier counts what it does, and any difference has to be
 * explained in writing before the session can be closed at all.
 */
@Injectable()
export class CashSessionService {
  async open(
    tx: TenantTransactionClient,
    tenantId: string,
    input: { cashDeskId: string; openingFloatMinor: bigint; cashierUserId: string },
  ): Promise<{ id: string }> {
    const currency = await this.currencyOf(tx, tenantId)
    assertValidFloat(Money.of(input.openingFloatMinor, currency))

    const desk = await tx.cashDesk.findUnique({ where: { id: input.cashDeskId } })
    if (!desk || desk.tenantId !== tenantId) {
      throw new NotFoundError('cash_desk', input.cashDeskId)
    }
    if (!desk.isActive) {
      throw new ConflictError('CASH_DESK_INACTIVE', `Cash desk ${desk.name} is not active.`)
    }

    const alreadyOpen = await tx.cashSession.findFirst({
      where: { tenantId, cashDeskId: input.cashDeskId, status: 'open' },
    })
    if (alreadyOpen) {
      throw new ConflictError(
        'CASH_SESSION_ALREADY_OPEN',
        `Desk ${desk.name} already has an open session (${alreadyOpen.id}). Close it before opening another.`,
      )
    }

    const session = await tx.cashSession.create({
      data: {
        tenantId,
        cashDeskId: input.cashDeskId,
        cashierUserId: input.cashierUserId,
        openingFloatMinor: input.openingFloatMinor,
        status: 'open',
      },
    })

    // The float is itself a movement, so the drawer's expected contents are
    // always float + Σ movements with no special case for the opening.
    await tx.cashMovement.create({
      data: {
        tenantId,
        cashSessionId: session.id,
        type: 'float_in',
        amountMinor: 0n,
        note: 'Ouverture de caisse',
        createdBy: input.cashierUserId,
      },
    })

    return { id: session.id }
  }

  /**
   * Close the desk against a counted amount.
   *
   * A non-zero variance lands the session `flagged`, never `closed`, and
   * requires a written reason — the domain enforces both. The session
   * becomes immutable either way; a later correction is a new movement in a
   * NEW session.
   */
  async close(
    tx: TenantTransactionClient,
    tenantId: string,
    sessionId: string,
    input: { declaredMinor: bigint; varianceReason?: string; closedByUserId: string },
  ): Promise<{ expectedMinor: bigint; varianceMinor: bigint; status: 'closed' | 'flagged' }> {
    const currency = await this.currencyOf(tx, tenantId)
    const session = await this.load(tx, tenantId, sessionId)
    assertSessionOpen(session)

    const movements = await tx.cashMovement.findMany({ where: { tenantId, cashSessionId: sessionId } })

    const result = closeSession({
      openingFloat: Money.of(session.openingFloatMinor, currency),
      movements: movements.map((m) => ({ type: m.type, amountMinor: m.amountMinor })),
      declared: Money.of(input.declaredMinor, currency),
      varianceReason: input.varianceReason,
    })

    await tx.cashSession.update({
      where: { id: sessionId },
      data: {
        status: result.status,
        closedAt: new Date(),
        closedBy: input.closedByUserId,
        declaredCloseMinor: result.declaredMinor,
        expectedCloseMinor: result.expectedMinor,
        varianceMinor: result.varianceMinor,
        varianceReason: input.varianceReason ?? null,
      },
    })

    // A flagged session is the director's problem, not the cashier's — the
    // outbox is what gets it in front of them without this transaction
    // depending on a notification succeeding.
    if (result.status === 'flagged') {
      await tx.outboxEvent.create({
        data: {
          tenantId,
          aggregateType: 'cash_session',
          aggregateId: sessionId,
          eventType: 'cash_session.flagged',
          payload: {
            cashSessionId: sessionId,
            expectedMinor: result.expectedMinor.toString(),
            declaredMinor: result.declaredMinor.toString(),
            varianceMinor: result.varianceMinor.toString(),
            varianceReason: input.varianceReason ?? null,
            currency,
          },
        },
      })
    }

    return { expectedMinor: result.expectedMinor, varianceMinor: result.varianceMinor, status: result.status }
  }

  /**
   * What the drawer should hold right now — shown to the cashier BEFORE
   * they commit to a count, so the close screen is not a guess.
   */
  async currentExpected(
    tx: TenantTransactionClient,
    tenantId: string,
    sessionId: string,
  ): Promise<{ expectedMinor: bigint; currency: CurrencyCode }> {
    const currency = await this.currencyOf(tx, tenantId)
    const session = await this.load(tx, tenantId, sessionId)
    const movements = await tx.cashMovement.findMany({ where: { tenantId, cashSessionId: sessionId } })
    const expected = expectedClose(
      Money.of(session.openingFloatMinor, currency),
      movements.map((m) => ({ type: m.type, amountMinor: m.amountMinor })),
    )
    return { expectedMinor: expected.amount, currency }
  }

  /** The open session for a cashier at a desk, or null. */
  async findOpenForUser(tx: TenantTransactionClient, tenantId: string, cashierUserId: string) {
    return tx.cashSession.findFirst({ where: { tenantId, cashierUserId, status: 'open' } })
  }

  private async load(tx: TenantTransactionClient, tenantId: string, sessionId: string) {
    const session = await tx.cashSession.findUnique({ where: { id: sessionId } })
    if (!session || session.tenantId !== tenantId) {
      throw new NotFoundError('cash_session', sessionId)
    }
    return session
  }

  private async currencyOf(tx: TenantTransactionClient, tenantId: string): Promise<CurrencyCode> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('tenant', tenantId)
    return assertCurrencyCode(tenant.currency)
  }
}
