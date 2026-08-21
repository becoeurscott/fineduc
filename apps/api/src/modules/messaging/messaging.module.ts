import { Module } from '@nestjs/common'
import { ReminderSchedulingService } from '@fineduc/services'
import { HaikuDateRequestParser, FakeDateRequestParser } from '@fineduc/providers'
import { PlatformModule } from '../platform/platform.module.js'
import { MoratoriumService, DATE_REQUEST_PARSER } from './moratorium.service.js'
import { MoratoriumController } from './moratorium.controller.js'
import { MoratoriumChatController } from './moratorium-chat.controller.js'

/**
 * The messaging module (ARCHITECTURE.md §7).
 *
 * Only the moratoire lives here so far. Reminder rules, templates and the
 * message log are read and written by the WORKER today; the staff endpoints
 * for them land with the dashboard, not before — an endpoint nothing calls
 * is a maintenance cost, not a feature.
 *
 * `ReminderSchedulingService` comes from `@fineduc/services` because both
 * apps run it. It has no Nest decorators, so it is wired with an explicit
 * factory rather than by constructor scanning.
 */
@Module({
  imports: [PlatformModule],
  controllers: [MoratoriumController, MoratoriumChatController],
  providers: [
    { provide: ReminderSchedulingService, useFactory: () => new ReminderSchedulingService() },
    {
      provide: DATE_REQUEST_PARSER,
      useFactory: () => {
        const apiKey = process.env['OPENROUTER_API_KEY']
        if (!apiKey) return null
        if (process.env['NODE_ENV'] === 'test') return new FakeDateRequestParser()
        return new HaikuDateRequestParser({
          apiKey,
          model: process.env['OPENROUTER_MODEL'] ?? 'claude-haiku-4-5-20251001',
          fetch: globalThis.fetch,
        })
      },
    },
    MoratoriumService,
  ],
  exports: [MoratoriumService],
})
export class MessagingModule {}
