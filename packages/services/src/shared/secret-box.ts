import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM for secrets held at rest (ARCHITECTURE.md §10).
 *
 * Extracted from `TotpService`, which had it as a private method, because a
 * school's payment credentials need the same treatment and are read by BOTH
 * the API and the worker — the worker settles the callback, so it has to
 * decrypt the webhook secret to verify it. A private method in one Nest
 * service could not be reached from a process that has no Nest.
 *
 * The key is the existing `ENCRYPTION_KEY`, not a second master key. The
 * skill this pattern came from suggests a separate `BYOK_ENCRYPTION_KEY`,
 * which is right for a product with no key of its own; here it would mean
 * two secrets to rotate, two ways to misconfigure, and one of them silently
 * unused. One key, one rotation.
 *
 * GCM, not CBC: the auth tag means a tampered ciphertext fails to open
 * rather than decrypting to plausible rubbish that then gets used as an API
 * key. The IV is random per seal, which is what stops two identical secrets
 * from producing identical ciphertext and leaking that they are the same.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretBoxError'
  }
}

/** `ENCRYPTION_KEY` as bytes. 64 hex characters, validated at boot by config. */
export function encryptionKeyFromHex(hex: string): Buffer {
  const key = Buffer.from(hex, 'hex')
  if (key.length !== KEY_BYTES) {
    // Never echo the value, not even its length in characters — a log line
    // that narrows the key space is a log line that helps an attacker.
    throw new SecretBoxError('ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).')
  }
  return key
}

/**
 * `iv:authTag:ciphertext`, all hex — the same shape TOTP secrets already use,
 * so the two are interchangeable and no migration re-encodes anything.
 */
export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Throws on anything that is not exactly what `seal` produced, including a
 * ciphertext whose auth tag no longer matches. A caller must never be handed
 * a "best effort" secret: a half-decrypted API key would be sent to a
 * provider and fail in a way that looks like the provider's fault.
 */
export function open(sealed: string, key: Buffer): string {
  const parts = sealed.split(':')
  if (parts.length !== 3) {
    throw new SecretBoxError('Malformed sealed secret.')
  }
  const [ivHex, authTagHex, cipherHex] = parts as [string, string, string]

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString('utf8')
  } catch {
    // The underlying error names the cipher and the tag length; neither helps
    // a caller and both are worth keeping out of a log.
    throw new SecretBoxError('Could not open sealed secret — wrong key, or the value was tampered with.')
  }
}

/** Seal a credentials object. The plaintext is its JSON. */
export function sealJson(value: unknown, key: Buffer): string {
  return seal(JSON.stringify(value), key)
}

export function openJson<T>(sealed: string, key: Buffer): T {
  return JSON.parse(open(sealed, key)) as T
}
