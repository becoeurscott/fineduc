import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../platform/prisma.service.js'
import { AuthService } from './auth.service.js'

const CODE_EXPIRY_MINUTES = 10
const MAX_CODE_ATTEMPTS = 5
const ACCESS_TOKEN_EXPIRY_SECONDS = 900

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async approveSignup(signupId: string) {
    const signup = await this.prisma.client.signupRequest.findUnique({
      where: { id: signupId },
    })
    if (!signup) throw new SetupError('NOT_FOUND', 'Signup request not found')
    if (signup.completedAt) throw new SetupError('ALREADY_COMPLETED', 'This request has already been completed')

    const setupToken = this.generateToken()
    const tempIdentifier = `FIN-${new Date().getFullYear()}-${String(Date.now() % 10000).padStart(4, '0')}`

    const tenant = await this.prisma.client.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          name: signup.schoolName,
          country: signup.country,
          currency: currencyForCountry(signup.country),
          timezone: timezoneForCountry(signup.country),
          locale: 'fr',
          plan: 'essentiel',
          status: 'trial',
          settings: {},
        },
      })

      await tx.site.create({
        data: {
          tenantId: t.id,
          name: 'Campus principal',
          isPrimary: true,
        },
      })

      await tx.signupRequest.update({
        where: { id: signupId },
        data: {
          emailVerified: false,
          phoneVerified: false,
        },
      })

      return t
    })

    await this.prisma.client.signupRequest.update({
      where: { id: signupId },
      data: {
        // Store setupToken and tempIdentifier in the expiresAt field comment
        // In a real schema we'd add columns; for now we use a convention
      },
    })

    this.logger.log(`Approved signup "${signup.schoolName}" — temp ID: ${tempIdentifier}, token: ${setupToken}`)

    return {
      setupToken,
      tempIdentifier,
      tenantId: tenant.id,
      schoolName: signup.schoolName,
      contactName: signup.contactName,
      email: signup.email,
      phone: signup.phone,
    }
  }

  async getSetupInfo(token: string) {
    // In production this would look up the token from a setup_tokens table
    // For now we log a placeholder
    this.logger.warn(`[DEV] Setup info requested for token: ${token}`)
    return null
  }

  async setupAccount(token: string, email: string, phone: string, password: string) {
    // In production: look up token → get signup + tenant, create user + membership with this hash
    const passwordHash = await this.auth.hashPassword(password)
    this.logger.warn(`[DEV] Account setup for token ${token}: email=${email}, phone=${phone}, hash=${passwordHash.slice(0, 12)}…`)

    await this.sendCode(email, 'email')

    return { ok: true }
  }

  async verifySetupCode(token: string, channel: 'email' | 'phone', code: string) {
    this.logger.debug(`Verifying ${channel} code for setup token ${token}`)
    const target = channel // In production: resolve from token
    const codeHash = await this.hashCode(code)

    const record = await this.prisma.client.verificationCode.findFirst({
      where: {
        target,
        channel,
        codeHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!record) {
      await this.prisma.client.verificationCode.updateMany({
        where: { target, channel, usedAt: null, expiresAt: { gt: new Date() } },
        data: { attempts: { increment: 1 } },
      })

      const latest = await this.prisma.client.verificationCode.findFirst({
        where: { target, channel, usedAt: null },
        orderBy: { createdAt: 'desc' },
      })

      if (latest && latest.attempts >= MAX_CODE_ATTEMPTS) {
        throw new SetupError('TOO_MANY_ATTEMPTS', 'Too many failed attempts. Request a new code.')
      }

      throw new SetupError('INVALID_CODE', 'Invalid or expired verification code')
    }

    await this.prisma.client.verificationCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    })

    if (channel === 'email') {
      // Send phone code next
      // In production: resolve phone from token
      return { nextStep: 'verify-phone' as const }
    }

    // Both verified — issue tokens
    // In production: look up user from token, issue real tokens
    return {
      nextStep: 'complete' as const,
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    }
  }

  async resendSetupCode(token: string, channel: 'email' | 'phone') {
    // In production: resolve target from token
    this.logger.warn(`[DEV] Resend ${channel} code for setup token: ${token}`)
  }

  private async sendCode(target: string, channel: string): Promise<void> {
    const code = this.generateCode()
    const codeHash = await this.hashCode(code)

    await this.prisma.client.verificationCode.create({
      data: {
        target,
        channel,
        codeHash,
        expiresAt: new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000),
      },
    })

    this.logger.warn(`[DEV] ${channel} verification code for ${target}: ${code}`)
  }

  private generateToken(): string {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  private generateCode(): string {
    const array = new Uint32Array(1)
    crypto.getRandomValues(array)
    return String(array[0]! % 1_000_000).padStart(6, '0')
  }

  private async hashCode(code: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(code)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

export class SetupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SetupError'
  }
}

function currencyForCountry(country: string): string {
  const xafCountries = new Set(['CM', 'GA', 'CG', 'TD', 'CF', 'GQ'])
  const xofCountries = new Set(['CI', 'SN', 'ML', 'BF', 'BJ', 'TG', 'NE', 'GW'])
  if (xafCountries.has(country)) return 'XAF'
  if (xofCountries.has(country)) return 'XOF'
  if (country === 'CD') return 'CDF'
  return 'XAF'
}

function timezoneForCountry(country: string): string {
  const timezones: Record<string, string> = {
    CM: 'Africa/Douala',
    CI: 'Africa/Abidjan',
    SN: 'Africa/Dakar',
    CD: 'Africa/Kinshasa',
    GA: 'Africa/Libreville',
    CG: 'Africa/Brazzaville',
    TD: 'Africa/Ndjamena',
  }
  return timezones[country] ?? 'Africa/Douala'
}
