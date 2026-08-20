import { Injectable, Logger } from '@nestjs/common'
import { loadEnv } from '@fineduc/config'
import { NotFoundError } from '@fineduc/domain'
import { FakePaymentProvider, ManualPaymentProvider, type PaymentProvider } from '@fineduc/providers'

/**
 * Resolves a provider by the name in the webhook URL.
 *
 * This is the ONLY place a provider is named. Everything else takes a
 * `PaymentProvider` (AGENTS.md rule #8) — swapping aggregator is a change
 * here and in configuration, not through the module tree.
 *
 * An unknown name is a 404, not a fallback to a default. Silently routing an
 * unrecognised aggregator's callback to some other adapter would either drop
 * real money or run a stranger's payload through a parser that trusts it.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly logger = new Logger(PaymentProviderRegistry.name)
  private readonly providers = new Map<string, PaymentProvider>()

  constructor() {
    const env = loadEnv()

    // Always available: no network, no credentials.
    this.register(new ManualPaymentProvider())

    // Test-only. Registering a scriptable provider in production would give
    // anyone who guessed the secret a way to fabricate a settlement.
    if (env.NODE_ENV !== 'production') {
      this.register(new FakePaymentProvider({ secret: process.env['FAKE_WEBHOOK_SECRET'] }))
    }

    // CinetPay and Flutterwave register here once their adapters exist.
    // Until then their callbacks 404 rather than being quietly mishandled.
    if (env.NODE_ENV === 'production' && this.providers.size <= 1) {
      this.logger.warn(
        'No networked payment provider is registered. Mobile money will be unavailable until an adapter is added.',
      )
    }
  }

  register(provider: PaymentProvider): void {
    this.providers.set(provider.name, provider)
  }

  get(name: string): PaymentProvider {
    const provider = this.providers.get(name)
    if (!provider) {
      throw new NotFoundError('payment_provider', name)
    }
    return provider
  }

  has(name: string): boolean {
    return this.providers.has(name)
  }

  names(): string[] {
    return [...this.providers.keys()]
  }
}
