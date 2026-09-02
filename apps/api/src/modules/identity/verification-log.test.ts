import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AGENTS.md rule #11 — "never log a phone number, a full name, a matricule,
 * a token, or a secret" — and the standing testing rule "a log fixture
 * contains no phone number".
 *
 * Both were already true of the MESSAGING path, which has its own tests. The
 * identity path had none, and three log lines shipped that printed a live
 * verification code NEXT TO the email or phone it belonged to:
 *
 *     [DEV] Phone verification code for +237670000001: 483920
 *
 * A single line of production log was therefore a working credential and the
 * person to use it against.
 *
 * This reads the source rather than capturing a logger, deliberately. The
 * failure mode is someone adding a NEW log line in a flow no test exercises —
 * exactly how the last three survived — so the assertion has to cover every
 * line in the file, not the handful a test happens to run.
 */

const IDENTITY_DIR = join(process.cwd(), 'src', 'modules', 'identity')
const FILES = ['signup.service.ts', 'setup.service.ts', 'auth.service.ts', 'user.service.ts']

/** `logger.x(`…`)` — the template literal is what interpolates a secret. */
function loggedTemplates(source: string): string[] {
  return [...source.matchAll(/this\.logger\.\w+\(\s*`([^`]*)`/g)].map((m) => m[1] ?? '')
}

describe('the identity flows never log a credential or the person it belongs to', () => {
  for (const file of FILES) {
    const source = readFileSync(join(IDENTITY_DIR, file), 'utf8')
    const templates = loggedTemplates(source)

    it(`${file} never interpolates an email or phone into a log line`, () => {
      const leaks = templates.filter((line) =>
        /\$\{\s*(email|phone|target|newEmail|newPhone|toPhoneE164|user\.email|user\.phone)\s*\}/.test(line),
      )
      expect(leaks, `these log lines interpolate PII:\n${leaks.join('\n')}`).toEqual([])
    })

    /**
     * The code may still be printed in development — with no email or SMS
     * adapter wired it is the only way to finish a signup — but never in
     * production, so every such line must sit behind a NODE_ENV guard.
     */
    it(`${file} only logs a verification code outside production`, () => {
      const codeLines = templates.filter((line) => /\$\{\s*code\s*\}/.test(line))
      for (const line of codeLines) {
        const at = source.indexOf(line)
        const preceding = source.slice(Math.max(0, at - 400), at)
        expect(
          preceding.includes("NODE_ENV'] !== 'production'") ||
            preceding.includes("NODE_ENV !== 'production'"),
          `this line logs a code with no production guard: ${line}`,
        ).toBe(true)
      }
    })
  }
})
