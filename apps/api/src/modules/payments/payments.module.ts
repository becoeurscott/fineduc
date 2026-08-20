import { Module } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { SettlementService, WebhookIngestService, WebhookProcessorService } from '@fineduc/services'
import { PlatformModule } from '../platform/platform.module.js'
import { PaymentProviderRegistry } from './provider.registry.js'
import { PaymentWebhookController } from './webhook.controller.js'

/**
 * Payments — settling money against an invoice, whichever rail it arrived on
 * (ARCHITECTURE.md §8.2, §8.3).
 *
 * The services themselves live in `@fineduc/services` because `apps/worker`
 * runs them too and apps may never import each other. They carry no framework
 * decorator, so they are wired here with EXPLICIT factory providers rather
 * than by reflection — which also makes the dependency graph readable without
 * knowing how Nest resolves constructor metadata.
 */
@Module({
  imports: [PlatformModule],
  controllers: [PaymentWebhookController],
  providers: [
    PaymentProviderRegistry,
    { provide: SettlementService, useFactory: () => new SettlementService() },
    { provide: WebhookIngestService, useFactory: () => new WebhookIngestService() },
    {
      provide: WebhookProcessorService,
      useFactory: (settlement: SettlementService) => {
        const nest = new Logger('WebhookProcessorService')
        return new WebhookProcessorService(settlement, {
          warn: (m) => nest.warn(m),
          error: (m) => nest.error(m),
          log: (m) => nest.log(m),
        })
      },
      inject: [SettlementService],
    },
  ],
  exports: [SettlementService, WebhookIngestService, WebhookProcessorService, PaymentProviderRegistry],
})
export class PaymentsModule {}
