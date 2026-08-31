import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { PaymentsModule } from '../payments/payments.module.js'
import { TenantService } from './tenant.service.js'
import { SiteService } from './site.service.js'
import { SubscriptionCheckoutService } from './subscription-checkout.service.js'
import { SubscriptionReconcileService } from './subscription-reconcile.service.js'
import { TenantController } from './tenant.controller.js'
import { SiteController } from './site.controller.js'
import { SubscriptionController } from './subscription.controller.js'
import { SubscriptionWebhookController } from './subscription-webhook.controller.js'

@Module({
  imports: [PlatformModule, PaymentsModule],
  controllers: [TenantController, SiteController, SubscriptionController, SubscriptionWebhookController],
  providers: [TenantService, SiteService, SubscriptionCheckoutService, SubscriptionReconcileService],
  exports: [TenantService],
})
export class TenancyModule {}
