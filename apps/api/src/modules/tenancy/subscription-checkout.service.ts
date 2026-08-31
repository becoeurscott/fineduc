import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@fineduc/db'
import { withTenant } from '@fineduc/db'
import { Money } from '@fineduc/money'
import { priceFor, type SubscriptionBillingPeriod, type SubscriptionPlan } from '@fineduc/domain'
import { ChariowProvider, ProviderError } from '@fineduc/providers'
import { loadEnv } from '@fineduc/config'

/**
 * Fineduc's OWN subscription billing — a school paying FOR Fineduc, not a
 * parent paying a school. This is deliberately the one payment path in the
 * codebase that is NOT BYOK: the platform's own Chariow account collects it,
 * because the money belongs to Fineduc.
 *
 * Chariow charges a pre-priced PRODUCT, one per (plan, billing period),
 * created once in the Chariow dashboard. `productIdFor` is the only place
 * that translates a plan into the id Chariow knows — get one wrong here and
 * a school is checked out for the wrong plan's price, which `initiate`'s own
 * price-match guard in the adapter then catches before the buyer pays.
 */

export interface InitiateSubscriptionCheckoutParams {
  readonly plan: SubscriptionPlan
  readonly billingPeriod: SubscriptionBillingPeriod
  readonly payerPhoneE164: string
  readonly payerName?: string
  readonly payerEmail?: string
  readonly returnUrl?: string
}

export interface SubscriptionCheckoutResult {
  readonly subscriptionPaymentId: string
  readonly checkoutUrl: string | null
}

@Injectable()
export class SubscriptionCheckoutService {
  private readonly logger = new Logger(SubscriptionCheckoutService.name)

  async initiate(
    prisma: PrismaClient,
    tenantId: string,
    params: InitiateSubscriptionCheckoutParams,
  ): Promise<SubscriptionCheckoutResult> {
    const env = loadEnv()
    if (!env.CHARIOW_API_KEY || !env.CHARIOW_WEBHOOK_SECRET) {
      // The same rule as any other provider: without the webhook secret a
      // payment can be taken but never confirmed. Refused here rather than
      // failing invisibly the first time a school's renewal is due.
      throw new ProviderError(
        'chariow',
        'MISCONFIGURED',
        'Subscription billing is not configured. Set CHARIOW_API_KEY and CHARIOW_WEBHOOK_SECRET.',
      )
    }

    const productId = productIdFor(env, params.plan, params.billingPeriod)
    if (!productId) {
      throw new ProviderError(
        'chariow',
        'MISCONFIGURED',
        `No Chariow product is configured for ${params.plan}/${params.billingPeriod}.`,
      )
    }

    const priceMinor = priceFor(params.plan, params.billingPeriod)
    const idempotencyKey = randomUUID()

    // Written PENDING and committed before the network call, same reasoning
    // as the pay-link flow: if Chariow never answers, there is still a row
    // to reconcile against rather than a payment that only ever existed in
    // memory.
    const row = await withTenant(prisma, tenantId, (tx) =>
      tx.subscriptionPayment.create({
        data: {
          tenantId,
          plan: params.plan,
          billingPeriod: params.billingPeriod,
          amountMinor: priceMinor,
          currency: 'XAF',
          status: 'pending',
          provider: 'chariow',
          idempotencyKey,
        },
      }),
    )

    const provider = new ChariowProvider({
      apiKey: env.CHARIOW_API_KEY,
      webhookSecret: env.CHARIOW_WEBHOOK_SECRET,
      fetch: (url, init) => fetch(url, init),
    })

    try {
      const result = await provider.initiate({
        reference: row.id,
        amount: Money.of(priceMinor, 'XAF'),
        operator: 'card',
        payerPhoneE164: params.payerPhoneE164,
        payerName: params.payerName,
        payerEmail: params.payerEmail,
        description: `Abonnement Fineduc — ${params.plan} (${params.billingPeriod})`,
        idempotencyKey,
        returnUrl: params.returnUrl,
        productId,
      })

      await withTenant(prisma, tenantId, (tx) =>
        tx.subscriptionPayment.update({ where: { id: row.id }, data: { providerRef: result.providerRef } }),
      )

      return { subscriptionPaymentId: row.id, checkoutUrl: result.checkoutUrl ?? null }
    } catch (error) {
      // The row survives as `pending` with no providerRef. It is not marked
      // `failed` here — the checkout attempt failing tells us nothing about
      // whether a later retry with the same idempotency key would too, and
      // a subscription-expiry re-notice is what prompts a retry, not this
      // catch block.
      this.logger.error(`Chariow checkout failed for subscription payment ${row.id}: ${String(error)}`)
      throw error
    }
  }
}

/** The one place a plan becomes a Chariow product id. */
function productIdFor(
  env: ReturnType<typeof loadEnv>,
  plan: SubscriptionPlan,
  _period: SubscriptionBillingPeriod,
): string {
  const key = `CHARIOW_PRODUCT_${plan.toUpperCase()}_MONTHLY` as
    | 'CHARIOW_PRODUCT_ESSENTIEL_MONTHLY'
    | 'CHARIOW_PRODUCT_CROISSANCE_MONTHLY'
    | 'CHARIOW_PRODUCT_INSTITUTION_MONTHLY'
  return env[key]
}
