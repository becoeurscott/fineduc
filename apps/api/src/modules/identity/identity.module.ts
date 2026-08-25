import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { AuthService } from './auth.service.js'
import { TotpService } from './totp.service.js'
import { UserService } from './user.service.js'
import { SignupService } from './signup.service.js'
import { SetupService } from './setup.service.js'
import { AuthController } from './auth.controller.js'
import { UserController } from './user.controller.js'
import { SignupController } from './signup.controller.js'
import { SetupController } from './setup.controller.js'
import { AdminSignupController } from './admin-signup.controller.js'
import { OnboardingController } from './onboarding.controller.js'

@Module({
  imports: [PlatformModule],
  controllers: [AuthController, UserController, SignupController, SetupController, AdminSignupController, OnboardingController],
  providers: [AuthService, TotpService, UserService, SignupService, SetupService],
  exports: [AuthService, UserService],
})
export class IdentityModule {}
