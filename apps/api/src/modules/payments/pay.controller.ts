import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { InitiatePayLinkSchema } from '@fineduc/contracts'
import { loadEnv } from '@fineduc/config'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { PrismaService } from '../platform/prisma.service.js'
import { PayLinkService } from './pay-link.service.js'

/**
 * `GET /pay/:token` and `POST /pay/:token/initiate` — the public pay page
 * (ARCHITECTURE.md §8.2).
 *
 * `@Public` because the payer is a parent with a link, not a user with a
 * JWT. The token IS the authorisation, which is why it is 32 random bytes
 * and why every way of being wrong returns the same 404.
 *
 * `@SkipAudit` on the GET only: looking at a page changes nothing, and a row
 * per view would bury the writes an auditor reads. The POST is audited — it
 * creates a payment.
 */
@Controller('pay')
export class PayController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payLinks: PayLinkService,
  ) {}

  @Public()
  @SkipAudit()
  @Get(':token')
  async view(@Param('token') token: string) {
    return this.payLinks.view(this.prisma.client, token)
  }

  @Public()
  @Post(':token/initiate')
  async initiate(@Param('token') token: string, @Body() body: unknown) {
    const input = InitiatePayLinkSchema.parse(body)
    const env = loadEnv()

    return this.payLinks.initiate(this.prisma.client, token, {
      amountMinor: BigInt(input.amount.amountMinor),
      operator: input.operator,
      payerPhoneE164: input.payerPhoneE164,
      payerName: input.payerName,
      idempotencyKey: input.idempotencyKey,
      // Which aggregator collects is configuration, never the payer's choice
      // — a caller-supplied provider name would let anyone route a payment
      // at an adapter of their choosing.
      providerName: process.env['PAYMENT_PROVIDER'] ?? 'fake',
      notifyUrl: process.env['PUBLIC_API_URL']
        ? `${process.env['PUBLIC_API_URL']}/webhooks/payments/${process.env['PAYMENT_PROVIDER'] ?? 'fake'}`
        : undefined,
      returnUrl: env.CORS_ALLOWED_ORIGINS[0],
    })
  }
}
