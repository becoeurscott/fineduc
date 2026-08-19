/**
 * Local-development convenience only. Loads a `.env` file into
 * process.env using Node's native loader — no dependency needed.
 * Never call this in production; production secrets come from the
 * platform's own secret injection, not a file on disk.
 */
export function loadDotEnvIfPresent(path = '.env'): void {
  try {
    process.loadEnvFile(path)
  } catch (error) {
    // A missing .env is fine in CI/production; anything else, surface it.
    if (!isFileNotFound(error)) throw error
  }
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
