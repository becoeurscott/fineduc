import { Module } from '@nestjs/common'
import { PlatformModule } from '../platform/platform.module.js'
import { AuthService } from './auth.service.js'
import { TotpService } from './totp.service.js'
import { UserService } from './user.service.js'
import { AuthController } from './auth.controller.js'
import { UserController } from './user.controller.js'

@Module({
  imports: [PlatformModule],
  controllers: [AuthController, UserController],
  providers: [AuthService, TotpService, UserService],
  exports: [AuthService, UserService],
})
export class IdentityModule {}
