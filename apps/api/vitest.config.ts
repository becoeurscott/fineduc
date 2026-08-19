import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Real DI resolution matters here (see AGENTS.md's tsx/esbuild note) —
    // run tests against the compiled output, never transpile-on-the-fly.
    globalSetup: ['./test/build-before-tests.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    /*
     * One file at a time.
     *
     * These suites are integration tests against ONE shared Postgres and
     * Redis: several of them boot a full Nest application, and they read
     * and write the same tables. Running files in parallel both starves
     * the connection pool — which is how this surfaced, as a 30s hook
     * timeout in whichever suite lost the race — and lets one suite's
     * fixtures corrupt another's assertions.
     *
     * Slower, but a test that fails depending on scheduling is worse than
     * a test that takes an extra minute.
     */
    fileParallelism: false,
  },
})
