import { Injectable, Logger } from '@nestjs/common'
import argon2 from 'argon2'
import { PrismaService } from '../platform/prisma.service.js'
import { AuthService } from './auth.service.js'
import type { SignupRequestListItem, ApproveSignupResponse, OnboardingStep } from '@fineduc/contracts'

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

  async listSignupRequests(): Promise<SignupRequestListItem[]> {
    const rows = await this.prisma.client.signupRequest.findMany({
      orderBy: { createdAt: 'desc' },
    })

    const dashboardUrl = process.env['NEXT_PUBLIC_DASHBOARD_URL'] ?? process.env['PUBLIC_PAY_URL'] ?? ''

    const completedIds = rows
      .filter((r) => r.status === 'setup_complete' && r.tempEmail)

    const onboardingMap = new Map<string, OnboardingStep>()

    if (completedIds.length > 0) {
      const tempEmails = completedIds.map((r) => r.tempEmail!)
      const users = await this.prisma.client.user.findMany({
        where: {
          OR: [
            { email: { in: tempEmails } },
            { email: { notIn: tempEmails }, memberships: { some: { status: 'active' } } },
          ],
        },
        select: { email: true, phone: true, memberships: { select: { tenant: { select: { name: true } } } } },
      })

      for (const r of completedIds) {
        let user = users.find((u) => u.email === r.tempEmail)
        if (!user) {
          user = users.find((u) =>
            !u.email.endsWith('@fineduc.school') &&
            u.memberships.some((m) => m.tenant.name === r.schoolName),
          )
        }

        if (!user) {
          onboardingMap.set(r.id, 'first_login')
        } else if (user.email.endsWith('@fineduc.school')) {
          onboardingMap.set(r.id, 'first_login')
        } else if (!r.phoneVerified) {
          onboardingMap.set(r.id, 'email_replaced')
        } else {
          onboardingMap.set(r.id, 'complete')
        }
      }
    }

    return rows.map((r) => {
      let onboardingStep: OnboardingStep
      if (r.status === 'rejected') onboardingStep = 'rejected'
      else if (r.status === 'expired') onboardingStep = 'expired'
      else if (r.status === 'pending') onboardingStep = 'pending'
      else if (r.status === 'approved') onboardingStep = 'approved'
      else onboardingStep = onboardingMap.get(r.id) ?? 'first_login'

      return {
        id: r.id,
        schoolName: r.schoolName,
        contactName: r.contactName,
        role: r.role,
        email: r.email,
        phone: r.phone,
        studentCount: r.studentCount,
        country: r.country,
        status: r.status as SignupRequestListItem['status'],
        emailVerified: r.emailVerified,
        phoneVerified: r.phoneVerified,
        setupToken: r.setupToken,
        setupUrl: r.setupToken ? `${dashboardUrl}/setup/${r.setupToken}` : null,
        tempIdentifier: r.tempIdentifier,
        tempEmail: r.tempEmail,
        onboardingStep,
        createdAt: r.createdAt.toISOString(),
        approvedAt: r.approvedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        expiresAt: r.expiresAt.toISOString(),
      }
    })
  }

  async approveSignup(signupId: string): Promise<ApproveSignupResponse> {
    const signup = await this.prisma.client.signupRequest.findUnique({
      where: { id: signupId },
    })
    if (!signup) throw new SetupError('NOT_FOUND', 'Signup request not found')
    if (signup.status !== 'pending') throw new SetupError('INVALID_STATUS', 'Only pending requests can be approved')

    const rows = await this.prisma.client.$queryRaw<
      Array<{ nextval: bigint }>
    >`SELECT nextval('signup_identifier_seq')`
    const nextval = rows[0]?.nextval
    if (nextval === undefined) {
      throw new SetupError('SEQUENCE_FAILED', 'Could not allocate a school identifier')
    }

    const year = new Date().getFullYear()
    const serial = String(nextval).padStart(4, '0')
    const tempIdentifier = `FIN-${year}-${serial}`
    const tempEmail = `fin-${year}-${serial}@fineduc.school`
    const tempCode = this.generateAccessCode()

    await this.prisma.client.signupRequest.update({
      where: { id: signupId },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        tempIdentifier,
        tempEmail,
        tempCodeHash: await this.auth.hashPassword(tempCode),
      },
    })

    this.logger.log(`Approved "${signup.schoolName}" as ${tempIdentifier}`)

    return { tempIdentifier, tempEmail, tempCode, loginUrl: this.loginUrl(signup.setupToken!) }
  }

  /**
   * Issues a fresh code for an already-approved school. This exists because
   * the code is only ever stored hashed: if the admin loses it before it
   * reaches the school, there is nothing to look up — the only honest move
   * is to replace it. Any code already sent stops working.
   */
  async reissueCode(signupId: string): Promise<ApproveSignupResponse> {
    const signup = await this.prisma.client.signupRequest.findUnique({
      where: { id: signupId },
    })
    if (!signup) throw new SetupError('NOT_FOUND', 'Signup request not found')
    if (signup.status !== 'approved' || !signup.tempIdentifier || !signup.tempEmail) {
      throw new SetupError('INVALID_STATUS', 'Only an approved request has a code to reissue')
    }

    const tempCode = this.generateAccessCode()
    await this.prisma.client.signupRequest.update({
      where: { id: signupId },
      data: { tempCodeHash: await this.auth.hashPassword(tempCode) },
    })

    this.logger.log(`Reissued access code for ${signup.tempIdentifier}`)

    return {
      tempIdentifier: signup.tempIdentifier,
      tempEmail: signup.tempEmail,
      tempCode,
      loginUrl: this.loginUrl(signup.setupToken!),
    }
  }

  private loginUrl(setupToken: string): string {
    const base = process.env['NEXT_PUBLIC_DASHBOARD_URL'] ?? 'https://fineduc-dashboard.vercel.app'
    return `${base.replace(/\/$/, '')}/first-login/${setupToken}`
  }

  async rejectSignup(signupId: string, reason: string): Promise<void> {
    const signup = await this.prisma.client.signupRequest.findUnique({
      where: { id: signupId },
    })
    if (!signup) throw new SetupError('NOT_FOUND', 'Signup request not found')
    if (signup.status !== 'pending') throw new SetupError('INVALID_STATUS', 'Only pending requests can be rejected')

    await this.prisma.client.signupRequest.update({
      where: { id: signupId },
      data: {
        status: 'rejected',
        rejectionReason: reason,
      },
    })

    this.logger.log(`Rejected signup "${signup.schoolName}" — reason: ${reason}`)
  }

  /**
   * Signs a school in with its e-mail and access code.
   *
   * `setupToken` is present when the school arrives through the WhatsApp link
   * and absent when it types the e-mail at /login.
   *
   * Which row holds the credentials depends on whether the school has signed in
   * before. Until it has, only the signup request exists and the temporary
   * e-mail is the only address that works. Once provisioned, the user row is
   * the identity: the access code was stored as its password, so the code keeps
   * working after onboarding swaps the temporary e-mail for the school's real
   * one — the address it types from then on. Authenticating a provisioned
   * school against the signup row instead would lock it out the moment it
   * finished onboarding.
   */
  async loginSchool(setupToken: string | null, email: string, code: string): Promise<{
    accessToken: string
    refreshToken: string
    expiresIn: number
    needsOnboarding: boolean
  }> {
    const address = email.toLowerCase().trim()

    // One message for every failure below: a school that mistypes its e-mail
    // must not be able to tell it apart from one that mistypes the code.
    const wrong = new SetupError('INVALID_CREDENTIALS', 'E-mail ou code incorrect')

    const signup = setupToken
      ? await this.prisma.client.signupRequest.findUnique({ where: { setupToken } })
      : await this.prisma.client.signupRequest.findFirst({
          where: { tempEmail: { equals: address, mode: 'insensitive' } },
          orderBy: { approvedAt: 'desc' },
        })

    if (!signup || signup.status !== 'approved' || !signup.tempCodeHash) {
      return await this.loginProvisionedSchool(address, code, wrong)
    }

    if (signup.tempEmail?.toLowerCase() !== address) throw wrong
    if (!(await argon2.verify(signup.tempCodeHash, code))) throw wrong

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

      const passwordHash = await this.auth.hashPassword(code)
      const user = await tx.user.create({
        data: {
          email: signup.tempEmail!,
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
        data: {
          status: 'setup_complete',
          completedAt: new Date(),
        },
      })

      return { user, tenant }
    })

    const tokens = await this.auth.issueTokens(
      result.user.id,
      result.user.email,
      result.tenant.id,
      'director',
    )

    this.logger.log(`School "${signup.schoolName}" signed in for the first time`)

    return { ...tokens, expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS, needsOnboarding: true }
  }

  /**
   * Signs in a school whose tenant already exists, against the address it holds
   * now rather than the temporary one it was issued. A school that stopped
   * partway through onboarding is sent back to finish it.
   */
  private async loginProvisionedSchool(address: string, code: string, wrong: SetupError) {
    const user = await this.prisma.client.user.findFirst({
      where: { email: { equals: address, mode: 'insensitive' }, status: 'active' },
      include: { memberships: { where: { status: 'active' } } },
    })

    const membership = user?.memberships[0]
    if (!user?.passwordHash || !membership) throw wrong
    if (!(await argon2.verify(user.passwordHash, code))) throw wrong

    const tokens = await this.auth.issueTokens(user.id, user.email, membership.tenantId, membership.role)

    return {
      ...tokens,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      needsOnboarding: user.email.endsWith('@fineduc.school'),
    }
  }

  async getSetupInfo(token: string) {
    const signup = await this.prisma.client.signupRequest.findUnique({
      where: { setupToken: token },
    })

    if (!signup || signup.status !== 'approved') return null

    return {
      schoolName: signup.schoolName,
      contactName: signup.contactName,
      tempIdentifier: signup.tempIdentifier ?? '',
      email: signup.email,
      phone: signup.phone,
    }
  }

  async setupAccount(token: string, email: string, phone: string, password: string) {
    const signup = await this.prisma.client.signupRequest.findUnique({
      where: { setupToken: token },
    })
    if (!signup || signup.status !== 'approved') {
      throw new SetupError('NOT_FOUND', 'Invalid or expired setup token')
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
          email,
          phone,
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
        data: {
          status: 'setup_complete',
          completedAt: new Date(),
          emailVerified: true,
          phoneVerified: true,
        },
      })

      return { user, tenant }
    })

    const tokens = await this.auth.issueTokens(
      result.user.id,
      result.user.email,
      result.tenant.id,
      'director',
    )

    this.logger.log(`Setup complete for "${signup.schoolName}" by ${signup.contactName}`)

    return {
      ...tokens,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    }
  }

  // ---------------------------------------------------------------------------
  // Onboarding (Phase 4): replace temp email, verify phone
  // ---------------------------------------------------------------------------

  async getOnboardingStatus(userId: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } })
    const emailReplaced = !user.email.endsWith('@fineduc.school')
    const phoneVerified = emailReplaced && !!user.phone
    return {
      emailReplaced,
      phoneVerified,
      complete: emailReplaced && phoneVerified,
      currentEmail: user.email,
      currentPhone: user.phone,
    }
  }

  async sendOnboardingEmailCode(userId: string, newEmail: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } })
    if (!user.email.endsWith('@fineduc.school')) {
      throw new SetupError('ALREADY_DONE', 'Email has already been replaced')
    }

    const existing = await this.prisma.client.user.findUnique({ where: { email: newEmail.toLowerCase().trim() } })
    if (existing && existing.id !== userId) {
      throw new SetupError('EMAIL_TAKEN', 'This email is already in use')
    }

    await this.sendCode(newEmail.toLowerCase().trim(), 'email')
    this.logger.log(`Sent onboarding email code to ${newEmail} for user ${userId}`)
  }

  async verifyOnboardingEmail(userId: string, code: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } })
    if (!user.email.endsWith('@fineduc.school')) {
      throw new SetupError('ALREADY_DONE', 'Email has already been replaced')
    }

    const codeHash = await this.hashCode(code)
    const record = await this.prisma.client.verificationCode.findFirst({
      where: {
        channel: 'email',
        codeHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!record) {
      throw new SetupError('INVALID_CODE', 'Invalid or expired verification code')
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.verificationCode.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      })
      await tx.user.update({
        where: { id: userId },
        data: { email: record.target },
      })
    })

    this.logger.log(`User ${userId} replaced temp email with ${record.target}`)
    return { emailReplaced: true, newEmail: record.target }
  }

  async sendOnboardingPhoneCode(userId: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } })
    if (!user.phone) {
      throw new SetupError('NO_PHONE', 'No phone number on file')
    }
    await this.sendCode(user.phone, 'phone')
    this.logger.log(`Sent onboarding phone code to ${user.phone} for user ${userId}`)
  }

  async verifyOnboardingPhone(userId: string, code: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } })
    if (!user.phone) {
      throw new SetupError('NO_PHONE', 'No phone number on file')
    }

    const codeHash = await this.hashCode(code)
    const record = await this.prisma.client.verificationCode.findFirst({
      where: {
        target: user.phone,
        channel: 'phone',
        codeHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!record) {
      throw new SetupError('INVALID_CODE', 'Invalid or expired verification code')
    }

    await this.prisma.client.verificationCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    })

    this.logger.log(`User ${userId} verified phone ${user.phone}`)
    return { phoneVerified: true }
  }

  async verifySetupCode(token: string, channel: 'email' | 'phone', code: string) {
    const signup = await this.prisma.client.signupRequest.findUnique({
      where: { setupToken: token },
    })
    if (!signup) throw new SetupError('NOT_FOUND', 'Invalid setup token')

    const target = channel === 'email' ? signup.email : signup.phone
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
      await this.sendCode(signup.phone, 'phone')
      return { nextStep: 'verify-phone' as const }
    }

    return {
      nextStep: 'complete' as const,
    }
  }

  async resendSetupCode(token: string, channel: 'email' | 'phone') {
    const signup = await this.prisma.client.signupRequest.findUnique({
      where: { setupToken: token },
    })
    if (!signup) throw new SetupError('NOT_FOUND', 'Invalid setup token')

    const target = channel === 'email' ? signup.email : signup.phone
    await this.sendCode(target, channel)
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

  /**
   * A code a human reads off WhatsApp and types into a phone. The alphabet
   * omits O/0, I/1 and L — the pairs that turn a working credential into a
   * support call — and the grouping keeps it transcribable.
   */
  private generateAccessCode(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length])
    return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
      .map((group) => group.join(''))
      .join('-')
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
