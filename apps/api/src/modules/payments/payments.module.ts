import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { SettlementService } from './settlement.service.js'
import { WebhookIngestService } from './webhook.service.js'
import { WebhookProcessorService } from './webhook-processor.service.js'

/**
 * Payments — settling money against an invoice, whichever rail it arrived on
 * (ARCHITECTURE.md §8.2, §8.3).
 *
 * Exposes `SettlementService` as its public interface; the cashbox and the
 * webhook processor both go through it rather than each allocating for
 * themselves.
 */
@Module({
  imports: [PlatformModule],
  providers: [SettlementService, WebhookIngestService, WebhookProcessorService],
  exports: [SettlementService, WebhookIngestService, WebhookProcessorService],
})
export class PaymentsModule {}
