import { Body, Controller, Post } from '@nestjs/common'
import { SubscriptionCheckoutRequestSchema } from '@fineduc/contracts'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { AllowsLapsed } from '../../common/decorators/allows-lapsed.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { PrismaService } from '../platform/prisma.service.js'
import { SubscriptionCheckoutService } from './subscription-checkout.service.js'

/**
 * `@AllowsLapsed` on the whole controller: this is the way back in. A school
 * blocked by SubscriptionGuard reaches exactly these routes and nothing else,
 * so the lock it is under is one it can pay its way out of.
 */
@AllowsLapsed()
@Controller('tenant/subscription')
export class SubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: SubscriptionCheckoutService,
  ) {}

  @Roles('director')
  @Post('checkout')
  async initiateCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const input = SubscriptionCheckoutRequestSchema.parse(body)
    return this.checkout.initiate(this.prisma.client, user.tenantId, input)
  }
}
