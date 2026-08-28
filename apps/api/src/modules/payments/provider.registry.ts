import { Injectable } from '@nestjs/common'
import { loadEnv } from '@fineduc/config'
import { NotFoundError } from '@fineduc/domain'
import type { TenantTransactionClient } from '@fineduc/db'
import { FakePaymentProvider, ManualPaymentProvider, MonerooProvider, type PaymentProvider } from '@fineduc/providers'
import { PaymentConnectionService, encryptionKeyFromHex } from '@fineduc/services'

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

    /*
     * NOTHING networked is registered here as a shared singleton.
     *
     * A school collects a parent's fees with ITS OWN aggregator account —
     * the funds go from the aggregator straight to the school's bank, and
     * Fineduc holds none of them. One platform key set shared by every
     * school would route every payment into Fineduc's account instead, and
     * make it a payment institution. Networked providers are therefore built
     * per tenant, from that school's stored credentials, by `forTenant`.
     *
     * `manual` needs no credentials — it records cash taken at the desk — and
     * `fake` is dev-only, so both stay shared.
     */
    this.connections = new PaymentConnectionService(
      encryptionKeyFromHex(env.ENCRYPTION_KEY),
      process.env['PUBLIC_API_URL'] ?? 'http://localhost:3010',
    )
  }

  private readonly connections: PaymentConnectionService

  /**
   * The provider that collects for THIS school, built from its own keys.
   *
   * A school with no connected account gets `null`, not a fallback: falling
   * back to a platform account is the exact bug this exists to prevent, and
   * it would be invisible — the payment would succeed and the money would be
   * in the wrong bank.
   */
  async forTenant(
    tx: TenantTransactionClient,
    tenantId: string,
    name: string,
  ): Promise<PaymentProvider | null> {
    // Credential-free providers are the same for everyone.
    const shared = this.providers.get(name)
    if (shared) return shared

    const connection = await this.connections.resolveForTenant(tx, tenantId, name)
    if (!connection) return null

    switch (name) {
      case 'moneroo':
        return new MonerooProvider({
          secretKey: connection.credentials.secretKey,
          webhookSecret: connection.credentials.webhookSecret,
          fetch: (url, init) => fetch(url, init),
        })
      default:
        // A stored connection for an aggregator with no adapter is a
        // configuration error, not something to guess at.
        return null
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
