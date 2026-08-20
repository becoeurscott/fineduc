/**
 * The smallest logger this package can depend on.
 *
 * `apps/api` runs inside Nest and has its own `Logger`; `apps/worker` does
 * not. Rather than force a framework into a shared package — or, worse, have
 * the worker boot a Nest container just to log a line — callers pass
 * whatever they already have, and the default writes to the console.
 */
export interface Logger {
  warn(message: string): void
  error(message: string): void
  log(message: string): void
}

export function consoleLogger(context: string): Logger {
  const stamp = (level: string, message: string) => `[${level}] [${context}] ${message}`
  return {
    warn: (message) => console.warn(stamp('WARN', message)),
    error: (message) => console.error(stamp('ERROR', message)),
    log: (message) => console.log(stamp('LOG', message)),
  }
}
