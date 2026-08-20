import { Injectable } from '@nestjs/common'
import type { PrismaClient } from '@fineduc/db'
import type { PaymentProvider } from '@fineduc/providers'

/**
 * Webhook INGEST (ARCHITECTURE.md §8.2, step "the browser redirect is a HINT").
 *
 * The endpoint is public and therefore hostile territory. This does the least
 * possible and gets out:
 *
 *   1. verify the HMAC over the RAW body, before parsing anything
 *   2. store the raw event, unique on (provider, event_id)
 *   3. return 200 fast — the business work happens in a job
 *
 * Step 2 IS the idempotency guard for a webhook delivered twice: the second
 * delivery conflicts on the unique index and stops there, so the aggregator's
 * retries are free (AGENTS.md rule #6).
 *
 * No business work happens here on purpose. An aggregator that does not get a
 * 200 within a couple of seconds retries, and a slow settlement inside the
 * request turns one payment into a retry storm.
 */

export type IngestOutcome =
  | { readonly result: 'accepted'; readonly providerEventId: string }
  | { readonly result: 'duplicate'; readonly providerEventId: string }
  | { readonly result: 'rejected'; readonly reason: string }

@Injectable()
export class WebhookIngestService {
  /**
   * `prisma`, not a tenant transaction: `provider_event` carries no RLS by
   * design, because the tenant is unknown until the payload is parsed and a
   * trusted worker resolves it later (see the model comment in schema.prisma).
   */
  async ingest(
    prisma: PrismaClient,
    provider: PaymentProvider,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<IngestOutcome> {
    const verification = provider.verifyWebhook(rawBody, headers)
    if (!verification.valid) {
      // Deliberately not stored. An unverified body is an unauthenticated
      // stranger's, and writing it would let anyone fill the table.
      return { result: 'rejected', reason: verification.reason ?? 'signature verification failed' }
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      return { result: 'rejected', reason: 'body is not valid JSON' }
    }

    let event
    try {
      event = provider.parseWebhook(payload)
    } catch (error) {
      return { result: 'rejected', reason: error instanceof Error ? error.message : 'unparseable event' }
    }

    // The idempotency guard. A conflict means we already have this delivery;
    // that is a 200, not an error — the aggregator is simply retrying.
    const existing = await prisma.providerEvent.findFirst({
      where: { provider: provider.name, eventId: event.eventId },
    })
    if (existing) {
      return { result: 'duplicate', providerEventId: existing.id }
    }

    try {
      const stored = await prisma.providerEvent.create({
        data: {
          provider: provider.name,
          eventId: event.eventId,
          eventType: event.status,
          signatureValid: true,
          payload: payload as object,
          receivedAt: new Date(),
        },
      })
      return { result: 'accepted', providerEventId: stored.id }
    } catch (error) {
      // Two deliveries racing: the unique index is the real guard, and losing
      // that race is still a duplicate, not a failure.
      if (isUniqueViolation(error)) {
        const raced = await prisma.providerEvent.findFirst({
          where: { provider: provider.name, eventId: event.eventId },
        })
        return { result: 'duplicate', providerEventId: raced?.id ?? '' }
      }
      throw error
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}
