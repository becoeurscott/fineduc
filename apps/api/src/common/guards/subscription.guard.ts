/**
 * Subscription enforcement. A school that has not paid for the current period
 * loses the app until it does.
 *
 * The `subscription-expiry` worker already warns at seven, three and one day
 * and marks a lapsed row `past_due`. This guard is what makes that mean
 * something: without it the status was recorded and then ignored, and a school
 * that never paid kept full access indefinitely.
 *
 * ## Why the date, not the status
 *
 * The lapse is computed from `currentPeriodEnd`, NOT from `status === past_due`.
 * `past_due` is written by a background job, and a guard that trusted it would
 * hand every school in the system free access for as long as that job happened
 * to be down — a billing failure that is invisible precisely because nothing
 * breaks. The date is the fact; the status is a job's opinion about the date.
 *
 * `cancelled` IS honoured, because that is a decision rather than a deadline.
 *
 * ## What stays reachable
 *
 * Blocking a school that owes money is only defensible if it can still pay, so:
 *
 *   - `@Public()` routes are never touched. That covers the webhooks and the
 *     parent-facing pay page, and the webhook carve-out is not a nicety: the
 *     Chariow callback is what SETTLES a renewal. Blocking it would mean a
 *     school pays, the settlement is refused, the subscription is never
 *     extended, and it stays locked out having already been charged.
 *   - `@AllowsLapsed()` routes stay open for the renewal itself.
 *
 * ## One day of grace, deliberately
 *
 * The domain's `expiryNoticeFor(0)` treats the end date itself as expired —
 * right for a warning, wrong for a lock. A school that paid through the 30th
 * should have the 30th. This blocks strictly AFTER the period ends, so the
 * guard is exactly one day more generous than the notice. Erring the other way
 * would lock out a school that has paid.
 */
import {
  CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { withTenant } from '@fineduc/db'
import { daysUntil, toTenantDate } from '@fineduc/domain'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js'
import { ALLOWS_LAPSED_KEY } from '../decorators/allows-lapsed.decorator.js'
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js'
import { PrismaService } from '../../modules/platform/prisma.service.js'

/**
 * How long an ALLOW is trusted without re-reading the row.
 *
 * Only the allow is cached, never the block. The asymmetry is the point: a
 * school that renews is let back in on its very next request rather than
 * waiting out a TTL, while the overwhelmingly common "still subscribed" answer
 * costs one query a minute instead of one per request. The cost of the cache is
 * therefore at most a few extra seconds of access for a school that lapsed
 * mid-window, which is harmless.
 */
const ALLOW_TTL_MS = 30_000

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name)
  private readonly allowedUntil = new Map<string, number>()

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const allowsLapsed = this.reflector.getAllAndOverride<boolean>(ALLOWS_LAPSED_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (allowsLapsed) return true

    const request = context.switchToHttp().getRequest<Request>()
    const user = (request as Request & { user?: AuthenticatedUser }).user
    // No tenant to check. AuthGuard owns that decision, not this guard.
    if (!user?.tenantId) return true

    const cached = this.allowedUntil.get(user.tenantId)
    if (cached !== undefined && cached > Date.now()) return true

    const state = await this.readSubscription(user.tenantId)

    /*
     * A tenant with no subscription row is not blocked. It is a tenant that was
     * never fully provisioned — a bug in signup, not a school that refused to
     * pay — and locking it out would punish the wrong party while hiding the
     * real fault. The expiry worker takes the same view and warns instead.
     */
    if (!state) {
      this.logger.warn(`no subscription row for tenant ${user.tenantId}; allowing`)
      return true
    }

    if (state.cancelled) {
      throw lapsed('This school\'s subscription has been cancelled. Renew it to restore access.')
    }

    // Strictly after the period end — see "One day of grace" above.
    if (daysUntil(state.today, state.currentPeriodEnd) < 0) {
      throw lapsed(
        `This school's subscription ended on ${state.currentPeriodEnd.toISOString().slice(0, 10)}. Renew it to restore access.`,
      )
    }

    this.allowedUntil.set(user.tenantId, Date.now() + ALLOW_TTL_MS)
    return true
  }

  private async readSubscription(tenantId: string) {
    return withTenant(this.prisma.client, tenantId, async (tx) => {
      const [tenant, subscription] = await Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
        tx.subscription.findUnique({
          where: { tenantId },
          select: { currentPeriodEnd: true, status: true },
        }),
      ])
      if (!tenant || !subscription) return null
      return {
        // The school's own calendar day, not the server's: a school in Douala
        // and one in Dakar do not cross into tomorrow at the same instant, and
        // a UTC comparison would lock one of them out early.
        today: toTenantDate(new Date(), tenant.timezone),
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelled: subscription.status === 'cancelled',
      }
    })
  }
}

/**
 * 402, with a stable `code` the French-first UI can map to its own copy —
 * matching on the English prose would break the first time someone reworded it.
 */
function lapsed(detail: string): HttpException {
  return new HttpException(
    { message: detail, code: 'SUBSCRIPTION_LAPSED' },
    HttpStatus.PAYMENT_REQUIRED,
  )
}
