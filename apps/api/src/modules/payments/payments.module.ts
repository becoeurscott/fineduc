import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { SettlementService } from './settlement.service.js'
import { WebhookIngestService } from './webhook.service.js'
import { WebhookProcessorService } from './webhook-processor.service.js'
import { PaymentProviderRegistry } from './provider.registry.js'
import { PaymentWebhookController } from './webhook.controller.js'

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
  controllers: [PaymentWebhookController],
  providers: [SettlementService, WebhookIngestService, WebhookProcessorService, PaymentProviderRegistry],
  exports: [SettlementService, WebhookIngestService, WebhookProcessorService, PaymentProviderRegistry],
})
export class PaymentsModule {}
