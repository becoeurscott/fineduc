import { Body, Controller, Get, HttpException, HttpStatus, Post } from '@nestjs/common'
import { z } from 'zod'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { SetupService, SetupError } from './setup.service.js'

const UpdateEmailSchema = z.object({
  email: z.string().email(),
})

const VerifyCodeSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
})

@Controller('auth/onboarding')
@Roles('director', 'bursar', 'cashier', 'secretary', 'auditor')
export class OnboardingController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  async status(@CurrentUser() user: AuthenticatedUser) {
    return this.setup.getOnboardingStatus(user.userId)
  }

  @Post('send-email-code')
  async sendEmailCode(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { email } = UpdateEmailSchema.parse(body)
    try {
      await this.setup.sendOnboardingEmailCode(user.userId, email)
      return { ok: true }
    } catch (err) {
      if (err instanceof SetupError) {
        throw new HttpException({ message: err.message, code: err.code }, HttpStatus.BAD_REQUEST)
      }
      throw err
    }
  }

  @Post('verify-email')
  async verifyEmail(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { code } = VerifyCodeSchema.parse(body)
    try {
      return await this.setup.verifyOnboardingEmail(user.userId, code)
    } catch (err) {
      if (err instanceof SetupError) {
        const status = err.code === 'INVALID_CODE' || err.code === 'TOO_MANY_ATTEMPTS'
          ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_REQUEST
        throw new HttpException({ message: err.message, code: err.code }, status)
      }
      throw err
    }
  }

  @Post('send-phone-code')
  async sendPhoneCode(@CurrentUser() user: AuthenticatedUser) {
    try {
      await this.setup.sendOnboardingPhoneCode(user.userId)
      return { ok: true }
    } catch (err) {
      if (err instanceof SetupError) {
        throw new HttpException({ message: err.message, code: err.code }, HttpStatus.BAD_REQUEST)
      }
      throw err
    }
  }

  @Post('verify-phone')
  async verifyPhone(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { code } = VerifyCodeSchema.parse(body)
    try {
      return await this.setup.verifyOnboardingPhone(user.userId, code)
    } catch (err) {
      if (err instanceof SetupError) {
        const status = err.code === 'INVALID_CODE' || err.code === 'TOO_MANY_ATTEMPTS'
          ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_REQUEST
        throw new HttpException({ message: err.message, code: err.code }, status)
      }
      throw err
    }
  }
}
