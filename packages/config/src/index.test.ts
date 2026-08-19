import { describe, expect, it } from 'vitest'
import * as Pkg from './index.js'

describe('public surface', () => {
  it('exports everything a consumer needs, from one entrypoint', () => {
    expect(Pkg.loadEnv).toBeDefined()
    expect(Pkg.loadDotEnvIfPresent).toBeDefined()
    expect(Pkg.EnvValidationError).toBeDefined()
    expect(Pkg.SENSITIVE_ENV_KEYS).toContain('JWT_SECRET')
  })
})
