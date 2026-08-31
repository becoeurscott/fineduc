import { Controller, HttpCode, Logger, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import { ChariowProvider } from '@fineduc/providers'
import { loadEnv } from '@fineduc/config'
import { WebhookIngestService } from '@fineduc/services'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { PrismaService } from '../platform/prisma.service.js'
import { SubscriptionReconcileService } from './subscription-reconcile.service.js'

/**
 * `POST /webhooks/subscriptions/chariow` — Chariow callbacks for Fineduc's
 * OWN subscription billing, not a parent's fee.
 *
 * Separate from the parent-fee webhook controller because:
 *   - the provider is platform-level (Fineduc's account), not per-school
 *   - the settlement path is `SubscriptionReconcileService`, not the full
 *     allocation/ledger/receipt flow
 *   - the reference encodes a `subscriptionPayment.id`, not a
 *     `fd:<tenantId>:<paymentId>` payment reference
 *
 * Same rules as the parent-fee controller: public, hostile territory, store
 * first, return 200 fast, never tell the caller anything it should not know.
 *
 * Chariow signs each Pulse with `x-chariow-signature: sha256=<hex>`, an
 * HMAC-SHA256 over the RAW body keyed by the Pulse's own signing secret
 * (`whsec_...`). The raw Buffer is what `express.raw()` leaves on
 * `request.body` for the `/webhooks` prefix, and it is passed through
 * untouched — re-serialising it would break every signature over a payload
 * containing a URL.
 */
@Controller('webhooks/subscriptions')
export class SubscriptionWebhookController {
  private readonly logger = new Logger(SubscriptionWebhookController.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: WebhookIngestService,
    private readonly reconcile: SubscriptionReconcileService,
  ) {}

  @Public()
  @SkipAudit()
  @HttpCode(200)
  @Post('chariow')
  async receive(@Req() request: Request) {
    const env = loadEnv()
    if (!env.CHARIOW_API_KEY || !env.CHARIOW_WEBHOOK_SECRET) {
      return { received: false, reason: 'subscription billing not configured' }
    }

    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from('')
    if (rawBody.length === 0) {
      return { received: false, reason: 'empty body' }
    }

    const provider = new ChariowProvider({
      apiKey: env.CHARIOW_API_KEY,
      webhookSecret: env.CHARIOW_WEBHOOK_SECRET,
      fetch: (url, init) => fetch(url, init),
    })

    const signature = request.header('x-chariow-signature')
    const headers: Record<string, string> = {}
    if (signature) headers['x-chariow-signature'] = signature

    const outcome = await this.ingest.ingest(this.prisma.client, provider, rawBody, headers)

    if (outcome.result === 'duplicate') {
      return { received: true, duplicate: true }
    }
    if (outcome.result !== 'accepted') {
      return { received: false, reason: outcome.reason }
    }

    // Resolve the subscription payment and tenant from the reference the
    // checkout minted. The reference IS the subscriptionPayment.id — a plain
    // UUID, not the `fd:tenantId:paymentId` format the parent-fee path uses.
    try {
      const event = provider.parseWebhook(JSON.parse(rawBody.toString('utf8')))
      if (event.reference) {
        const payment = await this.prisma.client.subscriptionPayment.findUnique({
          where: { id: event.reference },
        })
        if (payment) {
          await this.reconcile.reconcile(this.prisma.client, payment.tenantId, payment.id)
        }
      }
    } catch (error) {
      // The event is already stored and deduplicated. A reconcile failure
      // here is not fatal — the reconciler cron or a redelivery will pick
      // it up. Log and move on.
      this.logger.error(`Subscription webhook reconcile failed: ${String(error)}`)
    }

    return { received: true, duplicate: false }
  }
}
