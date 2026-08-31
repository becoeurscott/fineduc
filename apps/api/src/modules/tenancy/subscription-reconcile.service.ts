import { Injectable, Logger } from '@nestjs/common'
import type { PrismaClient } from '@fineduc/db'
import { withTenant } from '@fineduc/db'
import { nextPeriodEnd, type SubscriptionBillingPeriod } from '@fineduc/domain'
import { ChariowProvider } from '@fineduc/providers'
import { loadEnv } from '@fineduc/config'

/**
 * Settles a subscription payment by RE-PULLING Chariow, never by trusting the
 * webhook body. A webhook is what triggers this, not what decides anything —
 * the integration reference is explicit that a callback must never credit on
 * its own word, and the same reasoning that protects a parent's payment
 * protects Fineduc's own revenue here.
 *
 * Idempotent by construction: `subscriptionPayment.status` only transitions
 * out of `pending` once, guarded by the `WHERE status = 'pending'` on the
 * update, so a webhook redelivered five times settles once.
 */
@Injectable()
export class SubscriptionReconcileService {
  private readonly logger = new Logger(SubscriptionReconcileService.name)

  /** `subscriptionPaymentId` — OUR id, the `reference` the checkout minted. */
  async reconcile(prisma: PrismaClient, tenantId: string, subscriptionPaymentId: string): Promise<void> {
    const env = loadEnv()
    if (!env.CHARIOW_API_KEY || !env.CHARIOW_WEBHOOK_SECRET) return

    const provider = new ChariowProvider({
      apiKey: env.CHARIOW_API_KEY,
      webhookSecret: env.CHARIOW_WEBHOOK_SECRET,
      fetch: (url, init) => fetch(url, init),
    })

    await withTenant(prisma, tenantId, async (tx) => {
      const payment = await tx.subscriptionPayment.findUnique({ where: { id: subscriptionPaymentId } })
      if (!payment || payment.tenantId !== tenantId) return
      // Already settled — a redelivered webhook or a racing reconcile call.
      if (payment.status !== 'pending') return
      if (!payment.providerRef) return

      const remote = await provider.getStatus(payment.providerRef)
      if (remote.status !== 'succeeded') return

      /*
       * Amount checked against what THIS row expected, in its own currency —
       * a mismatch is refused rather than credited, same guard as every
       * other settlement path in this codebase.
       */
      if (remote.paidAmount && remote.paidAmount.amount !== payment.amountMinor) {
        this.logger.error(
          `Subscription payment ${payment.id}: Chariow reports ${remote.paidAmount.amount} ${remote.paidAmount.currency}, expected ${payment.amountMinor} ${payment.currency}. NOT settled.`,
        )
        return
      }

      const updated = await tx.subscriptionPayment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'succeeded', succeededAt: new Date() },
      })
      // Lost the race to a concurrent reconcile — the other call already
      // did everything below.
      if (updated.count === 0) return

      const subscription = await tx.subscription.findUnique({ where: { tenantId } })
      if (!subscription) return

      /*
       * Anchored to the subscription's OWN previous period end, not to
       * "now" — a school that pays three days late must not have its
       * billing day walked forward, or a year of late renewals quietly
       * sells eleven months for twelve.
       */
      const anchor = subscription.currentPeriodEnd > new Date() ? subscription.currentPeriodEnd : new Date()
      const newEnd = nextPeriodEnd(anchor, payment.billingPeriod as SubscriptionBillingPeriod)

      await tx.subscription.update({
        where: { tenantId },
        data: {
          plan: payment.plan,
          billingPeriod: payment.billingPeriod,
          priceMinor: payment.amountMinor,
          currentPeriodStart: new Date(),
          currentPeriodEnd: newEnd,
          status: 'active',
        },
      })

      this.logger.log(`Subscription payment ${payment.id} settled — tenant ${tenantId} renewed through ${newEnd.toISOString().slice(0, 10)}.`)
    })
  }
}
