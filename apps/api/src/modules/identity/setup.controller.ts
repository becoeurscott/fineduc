import { Body, Controller, Get, Param, Post, HttpCode, HttpException, HttpStatus } from '@nestjs/common'
import {
  SetupAccountRequestSchema,
  SetupVerifyRequestSchema,
  SetupResendRequestSchema,
} from '@fineduc/contracts'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { SetupService, SetupError } from './setup.service.js'

@Controller('auth/setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get(':token')
  @Public()
  @SkipAudit()
  async getInfo(@Param('token') token: string) {
    const info = await this.setup.getSetupInfo(token)
    if (!info) throw new HttpException({ message: 'Setup token not found' }, HttpStatus.NOT_FOUND)
    return info
  }

  @Post('account')
  @Public()
  @SkipAudit()
  async setupAccount(@Body() body: unknown) {
    const input = SetupAccountRequestSchema.parse(body)
    return this.wrap(() => this.setup.setupAccount(input.token, input.email, input.phone, input.password))
  }

  @Post('verify')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  async verify(@Body() body: unknown) {
    const input = SetupVerifyRequestSchema.parse(body)
    return this.wrap(() => this.setup.verifySetupCode(input.token, input.channel, input.code))
  }

  @Post('resend')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  async resend(@Body() body: unknown) {
    const input = SetupResendRequestSchema.parse(body)
    await this.setup.resendSetupCode(input.token, input.channel)
    return { ok: true }
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof SetupError) {
        const status =
          err.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND :
          err.code === 'TOO_MANY_ATTEMPTS' ? HttpStatus.TOO_MANY_REQUESTS :
          HttpStatus.BAD_REQUEST
        throw new HttpException({ message: err.message, code: err.code }, status)
      }
      throw err
    }
  }
}
