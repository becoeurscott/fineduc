import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../platform/prisma.service.js'
import { AuthService } from './auth.service.js'
import type { SignupStartRequest } from '@fineduc/contracts'

const CODE_EXPIRY_MINUTES = 10
const SIGNUP_EXPIRY_HOURS = 24
const MAX_CODE_ATTEMPTS = 5
const ACCESS_TOKEN_EXPIRY_SECONDS = 900

@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async start(input: SignupStartRequest): Promise<{ signupId: string }> {
    const existing = await this.prisma.client.user.findUnique({
      where: { email: input.email },
    })
    if (existing) {
      throw new SignupError('EMAIL_TAKEN', 'An account with this email already exists')
    }

    const signup = await this.prisma.client.signupRequest.create({
      data: {
        email: input.email,
        phone: input.phone,
        schoolName: input.schoolName,
        contactName: input.contactName,
        role: input.role,
        studentCount: input.studentCount ?? null,
        country: input.country.toUpperCase(),
        expiresAt: new Date(Date.now() + SIGNUP_EXPIRY_HOURS * 60 * 60 * 1000),
      },
    })

    await this.sendEmailCode(input.email)

    return { signupId: signup.id }
  }

  async verifyEmail(email: string, code: string): Promise<void> {
    await this.verifyCode(email, 'email', code)

    await this.prisma.client.signupRequest.updateMany({
      where: { email, completedAt: null },
      data: { emailVerified: true },
    })

    await this.sendPhoneCode(email)
  }

  async verifyPhone(phone: string, code: string): Promise<void> {
    await this.verifyCode(phone, 'phone', code)

    await this.prisma.client.signupRequest.updateMany({
      where: { phone, completedAt: null },
      data: { phoneVerified: true },
    })
  }

  async complete(email: string, password: string) {
    const signup = await this.prisma.client.signupRequest.findFirst({
      where: {
        email,
        emailVerified: true,
        phoneVerified: true,
        completedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!signup) {
      throw new SignupError('INVALID_SIGNUP', 'No verified signup found for this email')
    }

    const passwordHash = await this.auth.hashPassword(password)

    const result = await this.prisma.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
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
          tenantId: tenant.id,
          name: 'Campus principal',
          isPrimary: true,
        },
      })

      const user = await tx.user.create({
        data: {
          email: signup.email,
          phone: signup.phone,
          name: signup.contactName,
          passwordHash,
          status: 'active',
        },
      })

      await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: 'director',
          status: 'active',
        },
      })

      await tx.signupRequest.update({
        where: { id: signup.id },
        data: { completedAt: new Date() },
      })

      return { user, tenant }
    })

    const tokens = await this.auth.issueTokens(
      result.user.id,
      result.user.email,
      result.tenant.id,
      'director',
    )

    this.logger.log(`School "${signup.schoolName}" created by ${signup.contactName}`)

    return {
      ...tokens,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    }
  }

  async resendEmailCode(email: string): Promise<void> {
    await this.sendEmailCode(email)
  }

  async resendPhoneCode(phone: string): Promise<void> {
    const signup = await this.prisma.client.signupRequest.findFirst({
      where: { phone, completedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!signup) return
    await this.sendPhoneCodeDirect(phone)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async sendEmailCode(email: string): Promise<void> {
    const code = this.generateCode()
    const codeHash = await this.hashCode(code)

    await this.prisma.client.verificationCode.create({
      data: {
        target: email,
        channel: 'email',
        codeHash,
        expiresAt: new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000),
      },
    })

    // TODO: send via email provider when one exists
    this.logger.warn(`[DEV] Email verification code for ${email}: ${code}`)
  }

  private async sendPhoneCode(email: string): Promise<void> {
    const signup = await this.prisma.client.signupRequest.findFirst({
      where: { email, completedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (!signup) return
    await this.sendPhoneCodeDirect(signup.phone)
  }

  private async sendPhoneCodeDirect(phone: string): Promise<void> {
    const code = this.generateCode()
    const codeHash = await this.hashCode(code)

    await this.prisma.client.verificationCode.create({
      data: {
        target: phone,
        channel: 'phone',
        codeHash,
        expiresAt: new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000),
      },
    })

    // TODO: send via SMS provider when one exists
    this.logger.warn(`[DEV] Phone verification code for ${phone}: ${code}`)
  }

  private async verifyCode(target: string, channel: string, code: string): Promise<void> {
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
      // Increment attempts on the latest code for this target+channel
      await this.prisma.client.verificationCode.updateMany({
        where: {
          target,
          channel,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { attempts: { increment: 1 } },
      })

      const latest = await this.prisma.client.verificationCode.findFirst({
        where: { target, channel, usedAt: null },
        orderBy: { createdAt: 'desc' },
      })

      if (latest && latest.attempts >= MAX_CODE_ATTEMPTS) {
        throw new SignupError('TOO_MANY_ATTEMPTS', 'Too many failed attempts. Request a new code.')
      }

      throw new SignupError('INVALID_CODE', 'Invalid or expired verification code')
    }

    await this.prisma.client.verificationCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    })
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

export class SignupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SignupError'
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
