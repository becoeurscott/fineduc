import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    // Testcontainers boots a real Postgres, applies every migration, and
    // tears it down — slower than a unit test, deliberately not mocked.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
