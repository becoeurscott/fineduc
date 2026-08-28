import { describe, expect, it } from 'vitest'
import { seal, open, sealJson, openJson, encryptionKeyFromHex, SecretBoxError } from './secret-box.js'

const KEY = encryptionKeyFromHex('a'.repeat(64))
const OTHER_KEY = encryptionKeyFromHex('b'.repeat(64))

/**
 * What this protects: a database snapshot that leaks every school's payment
 * credentials. The tests that matter are the ones about what happens when
 * something is WRONG — a tampered blob must fail shut, because the failure
 * mode of "decrypts to rubbish" is an API key sent to a provider.
 */
describe('sealing a secret', () => {
  it('round-trips', () => {
    expect(open(seal('sk_live_abc123', KEY), KEY)).toBe('sk_live_abc123')
  })

  it('round-trips a credentials object', () => {
    const creds = { secretKey: 'sk_live_abc', webhookSecret: 'whsec_xyz' }
    expect(openJson(sealJson(creds, KEY), KEY)).toEqual(creds)
  })

  it('never leaves the plaintext in the sealed value', () => {
    expect(seal('sk_live_abc123', KEY)).not.toContain('sk_live_abc123')
  })

  it('produces a different ciphertext each time for the same input', () => {
    // A random IV per seal. Without it, two schools using the same key would
    // produce identical ciphertext and the database would leak that fact.
    expect(seal('same', KEY)).not.toBe(seal('same', KEY))
  })

  it('refuses to open with the wrong key', () => {
    expect(() => open(seal('secret', KEY), OTHER_KEY)).toThrow(SecretBoxError)
  })

  it('refuses a tampered ciphertext rather than returning rubbish', () => {
    const sealed = seal('sk_live_abc123', KEY)
    const [iv, tag, cipher] = sealed.split(':') as [string, string, string]
    const flipped = cipher.slice(0, -2) + (cipher.endsWith('00') ? '11' : '00')
    // GCM's auth tag is the whole point: a caller must never be handed a
    // half-decrypted API key that then fails at the provider.
    expect(() => open(`${iv}:${tag}:${flipped}`, KEY)).toThrow(SecretBoxError)
  })

  it('refuses a tampered auth tag', () => {
    const sealed = seal('sk_live_abc123', KEY)
    const [iv, tag, cipher] = sealed.split(':') as [string, string, string]
    const flipped = tag.slice(0, -2) + (tag.endsWith('00') ? '11' : '00')
    expect(() => open(`${iv}:${flipped}:${cipher}`, KEY)).toThrow(SecretBoxError)
  })

  it('refuses a malformed value', () => {
    for (const bad of ['', 'nonsense', 'a:b', 'a:b:c:d']) {
      expect(() => open(bad, KEY)).toThrow(SecretBoxError)
    }
  })

  it('does not echo the secret in the error', () => {
    try {
      open(seal('sk_live_TOPSECRET', KEY), OTHER_KEY)
      throw new Error('should have thrown')
    } catch (error) {
      expect(String(error)).not.toContain('TOPSECRET')
    }
  })
})

describe('the encryption key', () => {
  it('accepts the 64-hex form config already validates', () => {
    expect(encryptionKeyFromHex('a'.repeat(64))).toHaveLength(32)
  })

  it('refuses a key of the wrong length rather than padding it', () => {
    for (const bad of ['a'.repeat(32), 'a'.repeat(63), '']) {
      expect(() => encryptionKeyFromHex(bad)).toThrow(SecretBoxError)
    }
  })

  it('does not echo the key material in the error', () => {
    try {
      encryptionKeyFromHex('deadbeef')
      throw new Error('should have thrown')
    } catch (error) {
      expect(String(error)).not.toContain('deadbeef')
    }
  })
})
