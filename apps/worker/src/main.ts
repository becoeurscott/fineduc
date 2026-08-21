import 'reflect-metadata'
import { loadDotEnvIfPresent, loadEnv } from '@fineduc/config'
import {
  ConsoleMessagingProvider,
  FakePaymentProvider,
  ManualPaymentProvider,
  type MessagingProvider,
  type PaymentProvider,
} from '@fineduc/providers'
import { consoleLogger } from '@fineduc/services'
import { createRedis } from './queues/index.js'
import { createWebhookProcessor } from './jobs/webhook-processor.js'
import { createReminderScheduler } from './jobs/reminder-scheduler.js'
import { createMessageSender } from './jobs/message-sender.js'

/**
 * The worker process (ARCHITECTURE.md §3, §11).
 *
 * The same monolith as `apps/api`, in a different process. It shares the
 * application services through `@fineduc/services` rather than importing the
 * API — apps may never import each other — and runs no web framework.
 *
 * `webhook-processor`, `reminder-scheduler` and `message-sender` are wired.
 * The other queues in §11 land with their phases: an empty queue is honest,
 * whereas a stubbed job that silently succeeds looks like the work is done.
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

/**
 * Console only, for both rails.
 *
 * There is no WhatsApp adapter and no SMS adapter yet — both need a
 * third-party account this project does not have, and AGENTS.md forbids
 * adding one without asking. Console logs a REDACTED number instead of
 * sending, which is also what stops a dev or test environment from
 * messaging a real family by accident.
 *
 * When the real adapters land they are registered here, per channel, and
 * nothing above this function changes.
 */
function buildMessagingRegistry(): (channel: 'whatsapp' | 'sms') => MessagingProvider {
  const consoleProvider = new ConsoleMessagingProvider()
  return () => consoleProvider
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

  const reminderScheduler = createReminderScheduler({ connection })
  const messageSender = createMessageSender({ connection, resolveProvider: buildMessagingRegistry() })

  const workers = [
    ['webhook-processor', webhookProcessor],
    ['reminder-scheduler', reminderScheduler],
    ['message-sender', messageSender],
  ] as const

  for (const [name, worker] of workers) {
    worker.on('failed', (job, error) => {
      logger.error(`${name} job ${job?.id ?? '?'} failed: ${error.message}`)
    })
  }

  logger.log(
    `Fineduc worker started (${env.NODE_ENV}) — queues: ${workers.map(([name]) => name).join(', ')}`,
  )

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, draining…`)
    // close() waits for in-flight jobs. A money job killed mid-transaction
    // would roll back, but the job would be marked stalled and retried, and
    // draining avoids that churn entirely.
    await Promise.all(workers.map(([, worker]) => worker.close()))
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
