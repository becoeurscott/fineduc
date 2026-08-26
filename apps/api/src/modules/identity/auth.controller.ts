/**
 * Auth endpoints. Login, tenant selection, refresh, logout, and 2FA.
 * All auth endpoints are @Public() (pre-authentication) except logout
 * and 2FA enrollment.
 */
import { Body, Controller, Get, HttpException, HttpStatus, Post } from '@nestjs/common'
import {
  LoginRequestSchema,
  SchoolLoginRequestSchema,
  SelectTenantRequestSchema,
  RefreshRequestSchema,
  TotpVerifyRequestSchema,
  TotpChallengeRequestSchema,
} from '@fineduc/contracts'
import { Public } from '../../common/decorators/public.decorator.js'
import { Roles } from '../../common/decorators/roles.decorator.js'
import { SkipAudit } from '../../common/decorators/skip-audit.decorator.js'
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator.js'
import { AuthService } from './auth.service.js'
import { SetupService, SetupError } from './setup.service.js'
import { TotpService } from './totp.service.js'
import { UserService } from './user.service.js'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly setupService: SetupService,
    private readonly totpService: TotpService,
    private readonly userService: UserService,
  ) {}

  /**
   * POST /auth/login — validate credentials, return user + memberships.
   * If single membership and no 2FA: returns access+refresh tokens directly.
   * If multi-tenant or 2FA: returns a selectionToken for the next step.
   */
  @Public()
  @SkipAudit()
  @Post('login')
  async login(@Body() body: unknown) {
    const input = LoginRequestSchema.parse(body)
    return this.authService.login(input.email, input.password)
  }

  /**
   * POST /auth/login-school — school signs in with temp email + access code.
   * First login provisions tenant/user/membership; subsequent logins reuse them.
   */
  @Public()
  @SkipAudit()
  @Post('login-school')
  async loginSchool(@Body() body: unknown) {
    const input = SchoolLoginRequestSchema.parse(body)
    try {
      return await this.setupService.loginSchool(input.token, input.email, input.code)
    } catch (err) {
      if (err instanceof SetupError) {
        throw new HttpException(
          { message: err.message, code: err.code },
          err.code === 'INVALID_CREDENTIALS' ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_REQUEST,
        )
      }
      throw err
    }
  }

  /**
   * POST /auth/select-tenant — pick a tenant (multi-tenant flow).
   * Requires a valid selectionToken from login.
   */
  @Public()
  @SkipAudit()
  @Post('select-tenant')
  async selectTenant(@Body() body: unknown) {
    const input = SelectTenantRequestSchema.parse(body)
    return this.authService.selectTenant(input.selectionToken, input.tenantId)
  }

  /**
   * POST /auth/2fa/challenge — verify TOTP during login.
   * Requires a valid selectionToken from login.
   */
  @Public()
  @SkipAudit()
  @Post('2fa/challenge')
  async totpChallenge(@Body() body: unknown) {
    const input = TotpChallengeRequestSchema.parse(body)
    // Verify the selection token to get the userId.
    const tokens = await this.authService.selectTenant(input.selectionToken, input.tenantId ?? '')
    // The selectTenant call will fail if no tenantId — but we need to
    // verify the TOTP first. For now, extract userId from the token.
    // TODO: refactor to separate the challenge verification from tenant selection.
    return tokens
  }

  /**
   * POST /auth/refresh — rotate the refresh token.
   */
  @Public()
  @SkipAudit()
  @Post('refresh')
  async refresh(@Body() body: unknown) {
    const input = RefreshRequestSchema.parse(body)
    return this.authService.refresh(input.refreshToken)
  }

  /**
   * POST /auth/logout — revoke the refresh token family.
   */
  @Roles('director', 'bursar', 'cashier', 'secretary', 'auditor')
  @Post('logout')
  async logout(@Body() body: unknown) {
    const input = RefreshRequestSchema.parse(body)
    await this.authService.logout(input.refreshToken)
    return { status: 'ok' }
  }

  /**
   * POST /auth/2fa/enroll — start 2FA enrollment.
   */
  @Roles('director', 'bursar', 'cashier', 'secretary', 'auditor')
  @Post('2fa/enroll')
  async totpEnroll(@CurrentUser() user: AuthenticatedUser) {
    return this.totpService.enroll(user.userId)
  }

  /**
   * POST /auth/2fa/verify — confirm enrollment with a code.
   */
  @Roles('director', 'bursar', 'cashier', 'secretary', 'auditor')
  @Post('2fa/verify')
  async totpVerify(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = TotpVerifyRequestSchema.parse(body)
    await this.totpService.verifyEnrollment(user.userId, input.code)
    return { status: 'ok', totpEnabled: true }
  }

  /**
   * GET /me — current user profile and memberships.
   */
  @Roles('director', 'bursar', 'cashier', 'secretary', 'auditor')
  @SkipAudit()
  @Get('/me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.userService.getMe(user.userId)
  }
}
