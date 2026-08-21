/**
 * The one error type every port raises.
 *
 * It lives here rather than inside `payment/port.ts` because messaging needs
 * the same thing, and a second, parallel error class would mean every caller
 * that handles a provider failure has to know which port it came from.
 */
export class ProviderError extends Error {
  readonly provider: string
  readonly code: string
  /** Whether retrying the same call could plausibly succeed. */
  readonly retryable: boolean

  constructor(provider: string, code: string, message: string, retryable = false) {
    super(message)
    this.name = 'ProviderError'
    this.provider = provider
    this.code = code
    this.retryable = retryable
  }
}
