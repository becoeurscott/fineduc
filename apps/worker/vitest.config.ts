import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Against the COMPILED dist, like apps/api — and for the same reason:
    // vitest's own transform would not exercise the output that actually
    // ships. See apps/api/test/health.e2e.test.ts.
    globalSetup: ['./test/build-before-tests.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One file at a time: these share a Postgres with apps/api's suites.
    fileParallelism: false,
  },
})
