import 'reflect-metadata'
import { loadDotEnvIfPresent, loadEnv } from '@fineduc/config'
import { ManualPaymentProvider, FakePaymentProvider, type PaymentProvider } from '@fineduc/providers'
import { consoleLogger } from '@fineduc/services'
import { createRedis } from './queues/index.js'
import { createWebhookProcessor } from './jobs/webhook-processor.js'

/**
 * The worker process (ARCHITECTURE.md §3, §11).
 *
 * The same monolith as `apps/api`, in a different process. It shares the
 * application services through `@fineduc/services` rather than importing the
 * API — apps may never import each other — and runs no web framework.
 *
 * Only `webhook-processor` is wired today; the other queues in §11 land with
 * their phases. Starting the process with one live worker is deliberate: an
 * empty queue is honest, whereas a stubbed job that silently succeeds looks
 * like the work is done.
 */
loadDotEnvIfPresent('.env')
const env = loadEnv()
const logger = consoleLogger('worker')

function buildProviderRegistry(): Map<string, PaymentProvider> {
  const registry = new Map<string, PaymentProvider>()
  const manual = new ManualPaymentProvider()
  registry.set(manual.name, manual)

  // Never in production: a scriptable provider there would let anyone who
  // guessed the secret fabricate a settlement.
  if (env.NODE_ENV !== 'production') {
    const fake = new FakePaymentProvider({ secret: process.env['FAKE_WEBHOOK_SECRET'] })
    registry.set(fake.name, fake)
  }
  return registry
}

async function main(): Promise<void> {
  const connection = createRedis()
  const providers = buildProviderRegistry()

  const webhookProcessor = createWebhookProcessor({
    connection,
    resolveProvider: (name) => {
      const provider = providers.get(name)
      // Fail loudly. Guessing a provider would either drop real money or run
      // a stranger's payload through a parser that trusts it.
      if (!provider) throw new Error(`No payment provider registered as "${name}"`)
      return provider
    },
  })

  webhookProcessor.on('failed', (job, error) => {
    logger.error(`webhook-processor job ${job?.id ?? '?'} failed: ${error.message}`)
  })

  logger.log(`Fineduc worker started (${env.NODE_ENV}) — queues: webhook-processor`)

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, draining…`)
    // close() waits for in-flight jobs. A money job killed mid-transaction
    // would roll back, but the job would be marked stalled and retried, and
    // draining avoids that churn entirely.
    await webhookProcessor.close()
    await connection.quit()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  logger.error(`Fatal error during worker bootstrap: ${String(error)}`)
  process.exitCode = 1
})
