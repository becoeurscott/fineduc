/**
 * The outbound-call policy every adapter shares (ARCHITECTURE.md §9):
 * a 10 s timeout, three retries with exponential backoff and jitter, and
 * retries ONLY on 5xx or a network failure.
 *
 * The "only" matters. Retrying a 4xx re-sends a request the provider has
 * already rejected on its merits; if that request was "collect money from
 * this phone", a retry loop on a misread 400 is how a family gets charged
 * four times.
 *
 * `fetch` is injected rather than imported so adapters can be driven by the
 * contract suite with no network at all. A payment adapter that can only be
 * tested against a live aggregator is one that never gets tested.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface HttpPolicy {
  readonly timeoutMs: number
  readonly attempts: number
  readonly baseDelayMs: number
}

export const DEFAULT_POLICY: HttpPolicy = { timeoutMs: 10_000, attempts: 3, baseDelayMs: 300 }

export class HttpTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`)
    this.name = 'HttpTimeoutError'
  }
}

/** Full jitter: spreads a thundering herd instead of synchronising it. */
function delayFor(attempt: number, baseDelayMs: number, random: () => number): number {
  return Math.floor(random() * baseDelayMs * 2 ** attempt)
}

export interface RequestOptions {
  readonly fetch: FetchLike
  readonly policy?: HttpPolicy
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

/**
 * POST JSON, with the policy applied. Returns the parsed body and status;
 * a non-2xx is NOT thrown here — adapters map provider error codes
 * themselves, and they need the body to do it.
 */
export async function postJson(
  url: string,
  body: unknown,
  options: RequestOptions & { readonly headers?: Record<string, string> },
): Promise<{ status: number; body: unknown }> {
  const policy = options.policy ?? DEFAULT_POLICY
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const random = options.random ?? Math.random

  let lastError: unknown
  for (let attempt = 0; attempt < policy.attempts; attempt++) {
    if (attempt > 0) await sleep(delayFor(attempt - 1, policy.baseDelayMs, random))

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs)
    try {
      const response = await options.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      // 5xx is worth another go; 4xx never is.
      if (response.status >= 500 && attempt < policy.attempts - 1) {
        lastError = new Error(`Upstream ${response.status}`)
        continue
      }

      const text = await response.text()
      let parsed: unknown = null
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = { raw: text }
      }
      return { status: response.status, body: parsed }
    } catch (error) {
      lastError = controller.signal.aborted ? new HttpTimeoutError(url, policy.timeoutMs) : error
      if (attempt === policy.attempts - 1) break
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * GET JSON, with the same policy, timeout and retry behaviour as `postJson`.
 *
 * Exists because some providers verify a payment over GET rather than POST,
 * and a re-query on the settlement path must not be the one call in the
 * system without a timeout — a hung verify would hold a webhook open until
 * the provider gave up and redelivered it.
 */
export async function getJson(
  url: string,
  options: RequestOptions & { readonly headers?: Record<string, string> },
): Promise<{ status: number; body: unknown }> {
  const policy = options.policy ?? DEFAULT_POLICY
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const random = options.random ?? Math.random

  let lastError: unknown
  for (let attempt = 0; attempt < policy.attempts; attempt++) {
    if (attempt > 0) await sleep(delayFor(attempt - 1, policy.baseDelayMs, random))

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs)
    try {
      const response = await options.fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...options.headers },
        signal: controller.signal,
      })

      if (response.status >= 500 && attempt < policy.attempts - 1) {
        lastError = new Error(`Upstream ${response.status}`)
        continue
      }

      const text = await response.text()
      let parsed: unknown = null
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = { raw: text }
      }
      return { status: response.status, body: parsed }
    } catch (error) {
      lastError = controller.signal.aborted ? new HttpTimeoutError(url, policy.timeoutMs) : error
      if (attempt === policy.attempts - 1) break
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
