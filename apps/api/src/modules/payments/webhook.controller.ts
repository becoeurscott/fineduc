import { Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common'
import type { Request } from 'express'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { PrismaService } from '../platform/prisma.service.js'
import { PaymentProviderRegistry } from './provider.registry.js'
import { WebhookIngestService } from '@fineduc/services'
import { WebhookQueueService } from './webhook-queue.service.js'

/**
 * `POST /webhooks/payments/:provider` — public, and therefore HOSTILE
 * TERRITORY (ARCHITECTURE.md §9, §10).
 *
 * The endpoint does the least possible: verify, store, 200. No business work
 * happens in the request. An aggregator that does not get a fast 200 retries,
 * and a slow settlement inside the request turns one payment into a retry
 * storm — which is why §8.2 says "never do business work inside the webhook
 * request".
 *
 * It always answers 200, even for a body it rejected. A 4xx tells an
 * aggregator to retry (or, worse, tells an attacker which of their guesses
 * was closest); a 200 with a body saying `rejected` stops the retry loop and
 * leaves the truth in our logs where it belongs.
 *
 * `@Public` — an aggregator has no JWT. The signature IS the authentication,
 * which is why it is checked before the payload is parsed.
 * `@SkipAudit` — the audit log records what a USER changed; a callback that
 * was rejected changed nothing, and logging every delivery would bury the
 * writes an auditor actually reads.
 */
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
    private readonly ingest: WebhookIngestService,
    private readonly queue: WebhookQueueService,
  ) {}

  @Public()
  @SkipAudit()
  @HttpCode(200)
  @Post(':provider')
  async receive(
    @Param('provider') providerName: string,
    @Req() request: Request,
    @Headers() headers: Record<string, string>,
  ) {
    if (!this.registry.has(providerName)) {
      // Not a 404 body that names the registered providers — that would tell
      // a prober exactly which aggregators this school uses.
      return { received: false, reason: 'unknown provider' }
    }

    // The RAW bytes the aggregator signed. `express.raw()` is mounted for
    // this path in main.ts; re-serialising parsed JSON changes the bytes and
    // every signature check would fail.
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from('')
    if (rawBody.length === 0) {
      return { received: false, reason: 'empty body' }
    }

    const provider = this.registry.get(providerName)
    const outcome = await this.ingest.ingest(this.prisma.client, provider, rawBody, headers)

    switch (outcome.result) {
      case 'accepted':
        // Hand off and return. The settlement happens in apps/worker; this
        // request must not wait for it.
        await this.queue.enqueue({
          tenantId: '',
          requestId: (headers['x-request-id'] as string | undefined) ?? '',
          providerEventId: outcome.providerEventId,
          provider: providerName,
        })
        return { received: true, duplicate: false }
      case 'duplicate':
        // The aggregator is retrying a delivery we already hold. That is a
        // success from its point of view and must not provoke another retry.
        return { received: true, duplicate: true }
      default:
        return { received: false, reason: outcome.reason }
    }
  }
}
