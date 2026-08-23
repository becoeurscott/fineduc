import { Body, Controller, Post, HttpCode, HttpException, HttpStatus } from '@nestjs/common'
import {
  SignupStartRequestSchema,
  VerifyEmailRequestSchema,
  VerifyPhoneRequestSchema,
  SignupCompleteRequestSchema,
  ResendCodeRequestSchema,
} from '@fineduc/contracts'
import { Public } from '../../common/decorators/public.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { SignupService, SignupError } from './signup.service.js'

@Controller('auth/signup')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  @Post('start')
  @Public()
  @SkipAudit()
  async start(@Body() body: unknown) {
    const input = SignupStartRequestSchema.parse(body)
    return this.wrap(() => this.signup.start(input))
  }

  @Post('verify-email')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown) {
    const { email, code } = VerifyEmailRequestSchema.parse(body)
    await this.wrap(() => this.signup.verifyEmail(email, code))
    return { ok: true }
  }

  @Post('verify-phone')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  async verifyPhone(@Body() body: unknown) {
    const { phone, code } = VerifyPhoneRequestSchema.parse(body)
    await this.wrap(() => this.signup.verifyPhone(phone, code))
    return { ok: true }
  }

  @Post('complete')
  @Public()
  @SkipAudit()
  async complete(@Body() body: unknown) {
    const { email, password } = SignupCompleteRequestSchema.parse(body)
    return this.wrap(() => this.signup.complete(email, password))
  }

  @Post('resend-email')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  async resendEmail(@Body() body: unknown) {
    const { email } = ResendCodeRequestSchema.parse(body)
    if (email) await this.signup.resendEmailCode(email)
    return { ok: true }
  }

  @Post('resend-phone')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  async resendPhone(@Body() body: unknown) {
    const { phone } = ResendCodeRequestSchema.parse(body)
    if (phone) await this.signup.resendPhoneCode(phone)
    return { ok: true }
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof SignupError) {
        const status =
          err.code === 'EMAIL_TAKEN' ? HttpStatus.CONFLICT :
          err.code === 'TOO_MANY_ATTEMPTS' ? HttpStatus.TOO_MANY_REQUESTS :
          HttpStatus.BAD_REQUEST
        throw new HttpException({ message: err.message, code: err.code }, status)
      }
      throw err
    }
  }
}
