import type { ZodError } from 'zod'

/**
 * Thrown once, at boot, with every invalid variable listed — not just the
 * first one. A developer fixing env config should not have to re-run the
 * app N times to discover N missing variables.
 */
export class EnvValidationError extends Error {
  constructor(zodError: ZodError) {
    const lines = zodError.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    super(`Invalid environment configuration:\n${lines.join('\n')}`)
    this.name = 'EnvValidationError'
  }
}
