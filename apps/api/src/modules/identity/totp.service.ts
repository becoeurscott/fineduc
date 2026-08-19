/**
 * TOTP 2FA service. Uses otplib for TOTP generation/verification.
 * The secret is stored encrypted with AES-256-GCM using the
 * ENCRYPTION_KEY env variable.
 *
 * ARCHITECTURE.md §10: "Optional TOTP on any account, mandatory for
 * director on Institution plan."
 */
import { Injectable } from '@nestjs/common'
import { generateSecret, generateURI, verifySync } from 'otplib'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { loadEnv } from '@fineduc/config'
import { AuthenticationError } from '@fineduc/domain'
import { PrismaService } from '../platform/prisma.service.js'

@Injectable()
export class TotpService {
  private readonly encryptionKey: Buffer

  constructor(private readonly prisma: PrismaService) {
    const env = loadEnv()
    // ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
    this.encryptionKey = Buffer.from(env.ENCRYPTION_KEY, 'hex')
  }

  /**
   * Enroll a user in 2FA. Generates a secret, encrypts it, and stores it.
   * Returns the secret and otpauth URI (for QR code).
   */
  async enroll(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
    })

    if (user.totpEnabled) {
      throw new AuthenticationError('TOTP_ALREADY_ENABLED', '2FA is already enabled')
    }

    const secret = generateSecret()
    const otpauthUri = generateURI({
      issuer: 'Fineduc',
      label: user.email,
      secret,
    })

    // Encrypt and store the secret (not yet enabled until first verify).
    const encrypted = this.encrypt(secret)
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { totpSecretEncrypted: encrypted },
    })

    return { secret, otpauthUri }
  }

  /**
   * Verify a TOTP code during enrollment. If valid, marks 2FA as enabled.
   */
  async verifyEnrollment(userId: string, code: string): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
    })

    if (!user.totpSecretEncrypted) {
      throw new AuthenticationError('TOTP_NOT_ENROLLED', 'Enroll in 2FA first')
    }

    const secret = this.decrypt(user.totpSecretEncrypted)
    const result = verifySync({ token: code, secret })
    if (!result.valid) {
      throw new AuthenticationError('INVALID_TOTP_CODE', 'Invalid 2FA code')
    }

    // Enable 2FA.
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { totpEnabled: true },
    })
  }

  /**
   * Verify a TOTP code during login (challenge step).
   */
  async challenge(userId: string, code: string): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
    })

    if (!user.totpEnabled || !user.totpSecretEncrypted) {
      throw new AuthenticationError('TOTP_NOT_ENABLED', '2FA is not enabled')
    }

    const secret = this.decrypt(user.totpSecretEncrypted)
    const result = verifySync({ token: code, secret })
    if (!result.valid) {
      throw new AuthenticationError('INVALID_TOTP_CODE', 'Invalid 2FA code')
    }
  }

  // ---------------------------------------------------------------------------
  // AES-256-GCM encryption for TOTP secrets
  // ---------------------------------------------------------------------------

  private encrypt(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    // Store as iv:authTag:ciphertext (all hex).
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
  }

  private decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':')
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted TOTP secret format')
    }
    const [ivHex, authTagHex, encryptedHex] = parts as [string, string, string]
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const encrypted = Buffer.from(encryptedHex, 'hex')
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  }
}
