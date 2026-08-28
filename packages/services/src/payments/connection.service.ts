import { withTenant, type PrismaClient, type TenantTransactionClient } from '@fineduc/db'
import { NotFoundError, ValidationError } from '@fineduc/domain'
import { mintTenantToken, parseTenantToken } from '../shared/tenant-token.js'
import { openJson, sealJson } from '../shared/secret-box.js'

/**
 * A school's own aggregator credentials (ARCHITECTURE.md §9).
 *
 * Every school collects with its OWN account, so there is no single provider
 * instance the whole system shares — the credentials are resolved per tenant,
 * decrypted, and handed to an adapter built for that one call.
 *
 * Lives in `packages/services` rather than in the API because the WORKER
 * needs it as well: the API takes a callback and enqueues it, and the worker
 * is what verifies the signature and settles the money. Both have to reach
 * the same school's webhook secret.
 *
 * Nothing here names an aggregator. `provider` is a string that matches an
 * adapter's `name`, and which adapter is behind it stays a configuration
 * decision (AGENTS.md rule #8).
 */

/** What a school pastes in. Shapes differ per aggregator; this is Moneroo's. */
export interface MonerooCredentials {
  readonly secretKey: string
  readonly webhookSecret: string
}

export interface PaymentConnectionSummary {
  readonly id: string
  readonly provider: string
  readonly isActive: boolean
  /** The URL the school pastes into its aggregator dashboard. */
  readonly webhookUrl: string
  readonly lastVerifiedAt: string | null
  /**
   * Enough to recognise which account is connected, never enough to use it.
   * The secret key itself is not returned by any endpoint, ever.
   */
  readonly secretKeyHint: string
}

export interface ResolvedConnection {
  readonly id: string
  readonly tenantId: string
  readonly provider: string
  readonly credentials: MonerooCredentials
}

export class PaymentConnectionService {
  constructor(
    private readonly encryptionKey: Buffer,
    /** e.g. https://api.fineduc.com — used to render the callback URL. */
    private readonly apiBaseUrl: string,
  ) {}

  /**
   * Save (or replace) a school's credentials for one aggregator.
   *
   * The webhook token is minted ONCE and kept across updates. Rotating it
   * when a school corrects a typo in its secret key would silently break the
   * URL already sitting in its aggregator dashboard, and the symptom —
   * payments that initiate and never settle — takes a day to trace.
   */
  async connect(
    prisma: PrismaClient,
    tenantId: string,
    provider: string,
    credentials: MonerooCredentials,
  ): Promise<PaymentConnectionSummary> {
    this.assertUsable(credentials)

    return withTenant(prisma, tenantId, async (tx) => {
      const existing = await tx.paymentConnection.findFirst({ where: { tenantId, provider } })
      const webhookToken = existing?.webhookToken ?? mintTenantToken(tenantId, 'payment_connection_tenant_invalid')

      const row = await tx.paymentConnection.upsert({
        where: { tenantId_provider: { tenantId, provider } },
        create: {
          tenantId,
          provider,
          credentialsSealed: sealJson(credentials, this.encryptionKey),
          webhookToken,
          isActive: true,
        },
        update: {
          credentialsSealed: sealJson(credentials, this.encryptionKey),
          isActive: true,
        },
      })

      return this.summarise(row, credentials)
    })
  }

  /** What the settings screen shows. Never includes a usable secret. */
  async list(tx: TenantTransactionClient, tenantId: string): Promise<PaymentConnectionSummary[]> {
    const rows = await tx.paymentConnection.findMany({ where: { tenantId }, orderBy: { provider: 'asc' } })
    return rows.map((row) => this.summarise(row, this.tryOpen(row.credentialsSealed)))
  }

  /**
   * The credentials to collect with, for a school that is live.
   *
   * Returns null rather than throwing when a school has not connected an
   * account: on the pay path that is not an error, it is a school that has
   * not finished setting up, and the caller answers the same 404 it answers
   * for every other unusable link.
   */
  async resolveForTenant(
    tx: TenantTransactionClient,
    tenantId: string,
    provider: string,
  ): Promise<ResolvedConnection | null> {
    const row = await tx.paymentConnection.findFirst({ where: { tenantId, provider, isActive: true } })
    if (!row) return null
    return {
      id: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      credentials: openJson<MonerooCredentials>(row.credentialsSealed, this.encryptionKey),
    }
  }

  /**
   * The credentials that signed an inbound callback, from the token in its
   * own URL.
   *
   * The tenant comes out of the token, which is the only thing that can open
   * a tenant context for an unauthenticated request — `payment_connection` is
   * RLS-protected and the caller has no session. The stored token is then
   * compared in full, so knowing a tenant id is not enough to reach a row.
   */
  async resolveByWebhookToken(prisma: PrismaClient, token: string): Promise<ResolvedConnection | null> {
    const parsed = parseTenantToken(token)
    if (!parsed) return null

    return withTenant(prisma, parsed.tenantId, async (tx) => {
      const row = await tx.paymentConnection.findFirst({
        where: { tenantId: parsed.tenantId, webhookToken: token, isActive: true },
      })
      if (!row) return null
      return {
        id: row.id,
        tenantId: row.tenantId,
        provider: row.provider,
        credentials: openJson<MonerooCredentials>(row.credentialsSealed, this.encryptionKey),
      }
    })
  }

  /** Records that a callback verified, for the "is this school live?" view. */
  async markVerified(prisma: PrismaClient, tenantId: string, connectionId: string): Promise<void> {
    await withTenant(prisma, tenantId, (tx) =>
      tx.paymentConnection.updateMany({ where: { id: connectionId, tenantId }, data: { lastVerifiedAt: new Date() } }),
    )
  }

  async disconnect(prisma: PrismaClient, tenantId: string, provider: string): Promise<void> {
    await withTenant(prisma, tenantId, async (tx) => {
      const updated = await tx.paymentConnection.updateMany({
        where: { tenantId, provider },
        data: { isActive: false },
      })
      if (updated.count === 0) throw new NotFoundError('payment_connection', provider)
    })
  }

  webhookUrlFor(token: string, provider: string): string {
    return `${this.apiBaseUrl.replace(/\/$/, '')}/webhooks/payments/${provider}/${token}`
  }

  /**
   * Both halves are required.
   *
   * A secret key on its own would let a school take a payment it could never
   * confirm — the callback is what settles money, and without the webhook
   * secret every one is rejected as forged. Accepting that would strand every
   * parent who paid, so it is refused at the point the school pastes it,
   * where the message can still name what is missing.
   */
  private assertUsable(credentials: MonerooCredentials): void {
    if (!credentials.secretKey?.trim()) {
      throw new ValidationError('payment_connection_secret_missing', 'The API key is required.')
    }
    if (!credentials.webhookSecret?.trim()) {
      throw new ValidationError(
        'payment_connection_webhook_secret_missing',
        'The webhook secret is required — without it a payment can be taken but never confirmed.',
      )
    }
  }

  private summarise(
    row: {
      id: string
      provider: string
      isActive: boolean
      webhookToken: string
      lastVerifiedAt: Date | null
    },
    credentials: MonerooCredentials | null,
  ): PaymentConnectionSummary {
    return {
      id: row.id,
      provider: row.provider,
      isActive: row.isActive,
      webhookUrl: this.webhookUrlFor(row.webhookToken, row.provider),
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      secretKeyHint: hint(credentials?.secretKey),
    }
  }

  /** A row sealed under a rotated key must not break the settings screen. */
  private tryOpen(sealed: string): MonerooCredentials | null {
    try {
      return openJson<MonerooCredentials>(sealed, this.encryptionKey)
    } catch {
      return null
    }
  }
}

/** Last four characters only — enough to recognise, useless to an attacker. */
function hint(secretKey: string | undefined): string {
  if (!secretKey || secretKey.length < 4) return '••••'
  return `••••${secretKey.slice(-4)}`
}
