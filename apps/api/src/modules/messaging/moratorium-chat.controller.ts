import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { MoratoriumRequestInputSchema } from '@fineduc/contracts'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { PrismaService } from '../platform/prisma.service.js'
import { MoratoriumService } from './moratorium.service.js'

/**
 * `GET /moratoire/:token` and `POST /moratoire/:token/request` — the public
 * chat a parent reaches from a reminder message (ARCHITECTURE.md §8.5b).
 *
 * `@Public` because the caller is a parent with a link, not a user with a
 * JWT. The token IS the authorisation, which is why it is 32 random bytes
 * and why every way of being wrong returns the same 404. Injects
 * `PrismaService` directly, like `PayController`: there is no tenant context
 * to inherit, so the service opens one from the token itself.
 *
 * `@SkipAudit` on the GET only. Looking at a page changes nothing, and a row
 * per view would bury the writes an auditor actually reads. The POST is
 * audited — it moves a date a family will plan around.
 */
@Controller('moratoire')
export class MoratoriumChatController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moratoriums: MoratoriumService,
  ) {}

  @Public()
  @SkipAudit()
  @Get(':token')
  async view(@Param('token') token: string) {
    return this.moratoriums.view(this.prisma.client, token, new Date())
  }

  @Public()
  @Post(':token/request')
  async request(@Param('token') token: string, @Body() body: unknown) {
    const input = MoratoriumRequestInputSchema.parse(body)
    return this.moratoriums.request(this.prisma.client, token, input, new Date())
  }
}
