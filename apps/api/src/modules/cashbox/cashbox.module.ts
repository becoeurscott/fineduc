import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { CashSessionService } from './cash-session.service.js'
import { CashPaymentService } from './cash-payment.service.js'
import { CashController } from './cash.controller.js'

/**
 * Cashbox — the desk and the money that crosses it (ARCHITECTURE.md §8.3-8.4).
 *
 * Owns the cash_session, cash_movement, payment and receipt tables. Other
 * modules go through these services; nothing reaches into those tables.
 */
@Module({
  imports: [PlatformModule],
  controllers: [CashController],
  providers: [CashSessionService, CashPaymentService],
  exports: [CashSessionService, CashPaymentService],
})
export class CashboxModule {}
