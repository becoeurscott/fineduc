/**
 * Vitest globalSetup: compile with the real `tsc` before any test runs.
 *
 * Tests import from `dist/`, never `src/` — the same rule apps/api follows,
 * and for the same reason: a transpile-on-the-fly runner does not exercise
 * the output that actually ships.
 *
 * `apps/api` is built too, because the fixture raises an invoice through its
 * InvoicingService. That is a TEST-only reach across the app boundary; the
 * worker's own source imports nothing from apps/api, which the lint boundary
 * enforces.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export default function setup() {
  const workerRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  const apiRoot = path.resolve(workerRoot, '..', 'api')

  for (const cwd of [apiRoot, workerRoot]) {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], { cwd, stdio: 'inherit', shell: true })
  }
}
