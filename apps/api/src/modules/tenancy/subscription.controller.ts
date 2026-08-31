import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common'
import { SubscriptionCheckoutRequestSchema, type SubscriptionState } from '@fineduc/contracts'
import { withTenant } from '@fineduc/db'
import {
  PLAN_TERMS,
  priceFor,
  tenantLocalToInstant,
  type SubscriptionBillingPeriod,
  type SubscriptionPlan,
} from '@fineduc/domain'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { AllowsLapsed } from '../../common/decorators/allows-lapsed.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { PrismaService } from '../platform/prisma.service.js'
import { SubscriptionCheckoutService } from './subscription-checkout.service.js'

/**
 * `@AllowsLapsed` on the whole controller: this is the way back in. A school
 * blocked by SubscriptionGuard reaches exactly these routes and nothing else,
 * so the lock it is under is one it can pay its way out of.
 */
@AllowsLapsed()
@Controller('tenant/subscription')
export class SubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: SubscriptionCheckoutService,
  ) {}

  /**
   * Where the school stands: the plan, the deadline, and whether the lock has
   * already closed. Read by the dashboard banner on every page.
   *
   * Every role may read it, not just the director. A cashier who suddenly
   * cannot take a payment needs to know the subscription lapsed rather than
   * conclude the software is broken — even though only a director can pay.
   */
  @Roles('director', 'bursar', 'cashier', 'secretary', 'auditor')
  @Get()
  async state(@CurrentUser() user: AuthenticatedUser): Promise<SubscriptionState> {
    const row = await withTenant(this.prisma.client, user.tenantId, async (tx) => {
      const [tenant, subscription] = await Promise.all([
        tx.tenant.findUnique({ where: { id: user.tenantId }, select: { timezone: true } }),
        tx.subscription.findUnique({ where: { tenantId: user.tenantId } }),
      ])
      return tenant && subscription ? { timezone: tenant.timezone, subscription } : null
    })

    if (!row) throw new NotFoundException('This school has no subscription.')

    const { subscription, timezone } = row
    const periodEnd = subscription.currentPeriodEnd.toISOString().slice(0, 10)

    /*
     * Midnight local on the day AFTER the period ends — the same boundary
     * SubscriptionGuard enforces, which gives a school the whole of its final
     * day. Resolved here, where the school's timezone is known, so the browser
     * never has to guess it.
     */
    const accessEndsAt = tenantLocalToInstant(addDays(periodEnd, 1), 0, timezone)

    return {
      plan: subscription.plan as SubscriptionPlan,
      billingPeriod: subscription.billingPeriod as SubscriptionBillingPeriod,
      status: subscription.status,
      currentPeriodEnd: periodEnd,
      accessEndsAt: accessEndsAt.toISOString(),
      lapsed: subscription.status === 'cancelled' || Date.now() >= accessEndsAt.getTime(),
      priceMinor: (subscription.priceMinor > 0n
        ? subscription.priceMinor
        : priceFor(subscription.plan as SubscriptionPlan, subscription.billingPeriod as SubscriptionBillingPeriod)
      ).toString(),
      // Priced here, from the same constant the checkout charges against.
      plans: (['essentiel', 'croissance', 'institution'] as const).map((plan) => ({
        plan,
        monthlyMinor: PLAN_TERMS[plan].monthlyMinor.toString(),
        studentCap: PLAN_TERMS[plan].studentCap,
      })),
    }
  }

  @Roles('director')
  @Post('checkout')
  async initiateCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const input = SubscriptionCheckoutRequestSchema.parse(body)
    return this.checkout.initiate(this.prisma.client, user.tenantId, input)
  }
}

/** `YYYY-MM-DD` plus n days, via UTC so month and year roll over correctly. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days))
  return shifted.toISOString().slice(0, 10)
}
