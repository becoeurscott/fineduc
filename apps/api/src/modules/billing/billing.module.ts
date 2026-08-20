import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { InvoicingService } from './invoicing.service.js'

/**
 * Billing — the money owed (ARCHITECTURE.md §7, §8.1).
 *
 * Exposes `InvoicingService` as its public interface. Other modules call it;
 * nothing outside this module touches the invoice, instalment, discount or
 * ledger tables directly.
 */
@Module({
  imports: [PlatformModule],
  providers: [InvoicingService],
  exports: [InvoicingService],
})
export class BillingModule {}
