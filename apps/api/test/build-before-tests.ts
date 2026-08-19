/**
 * Vitest globalSetup: compiles the app with the real `tsc` before any test
 * runs. Tests import from `dist/`, never `src/`, and never through a
 * transpile-on-the-fly runner (vitest's own esbuild transform included) —
 * see AGENTS.md's tsx/esbuild note. A test that imported `../src/...`
 * directly would inherit the same silently-broken NestJS DI this project
 * hit once already, and would not have caught it.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export default function setup() {
  const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: true,
  })
}
