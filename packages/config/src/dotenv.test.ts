import { describe, expect, it } from 'vitest'
import { loadDotEnvIfPresent } from './dotenv.js'

describe('loadDotEnvIfPresent', () => {
  it('does not throw when the file is missing', () => {
    expect(() => loadDotEnvIfPresent('.env.definitely-does-not-exist')).not.toThrow()
  })

  it('re-throws a non-ENOENT error', () => {
    // A directory path makes fs fail with EISDIR, not ENOENT.
    expect(() => loadDotEnvIfPresent('.')).toThrow()
  })
})
