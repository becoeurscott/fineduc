import 'reflect-metadata'
import { loadDotEnvIfPresent, loadEnv } from '@fineduc/config'
import {
  ConsoleMessagingProvider,
  FakePaymentProvider,
  ManualPaymentProvider,
  MonerooProvider,
  type MessagingProvider,
  type PaymentProvider,
} from '@fineduc/providers'
import { createPrismaClient, resolveAppDatabaseUrl } from '@fineduc/db'
import { consoleLogger } from '@fineduc/services'
import { createQueue, createRedis } from './queues/index.js'
import { createWebhookProcessor } from './jobs/webhook-processor.js'
import { createReminderScheduler } from './jobs/reminder-scheduler.js'
import { createMessageSender } from './jobs/message-sender.js'
import { createSubscriptionExpiryWorker } from './jobs/subscription-expiry.js'
import { createDailySweepWorker, installDailySchedule } from './jobs/daily-sweep.js'

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

  /*
   * Moneroo has to be resolvable HERE as well as in the API: the API only
   * enqueues the callback, and it is this process that parses it and settles
   * the money. A provider registered in one and not the other means every
   * parent payment is accepted and then never applied.
   *
   * Both halves of the credential are required for the same reason as in the
   * API — without the webhook secret nothing can be verified, and an
   * unverifiable callback is one this worker must refuse.
   */
  if (env.MONEROO_SECRET_KEY && env.MONEROO_WEBHOOK_SECRET) {
    const moneroo = new MonerooProvider({
      secretKey: env.MONEROO_SECRET_KEY,
      webhookSecret: env.MONEROO_WEBHOOK_SECRET,
      fetch: (url, init) => fetch(url, init),
    })
    registry.set(moneroo.name, moneroo)
  }

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

  // Nothing renews itself: Moneroo has no card on file, so a school that is
  // not warned simply stops working one morning.
  const prisma = createPrismaClient({
    databaseUrl: resolveAppDatabaseUrl(env.DATABASE_URL, env.APP_DATABASE_URL),
  })
  /*
   * Fineduc pays for its own dunning SMS, so this deliberately does NOT go
   * through message-sender: that path debits the school's prepaid credits,
   * and charging a school to be chased for money it owes us would be
   * indefensible. It also could not, since message.guardian_id is NOT NULL
   * and a director is a User.
   */
  const expirySms = {
    send: (message: { toPhoneE164: string; body: string; idempotencyKey: string }) =>
      buildMessagingRegistry()('sms').send({ ...message, channel: 'sms' as const }),
  }

  /*
   * Warned unconditionally, and NOT gated on SMS_API_KEY, because the key is
   * not what is missing: packages/providers' sms.ts and whatsapp.ts are both
   * `export {}` stubs, so buildMessagingRegistry hands back the CONSOLE
   * adapter whatever the environment says. Setting the key would change
   * nothing, and a warning that disappeared once it was set would read as
   * "now it sends" when it still only logs.
   */
  logger.warn(
    'No real messaging adapter exists (sms.ts/whatsapp.ts are stubs) — expiry and reminder ' +
      'messages are LOGGED, not sent. The in-app countdown is the only warning a school actually receives.',
  )

  const subscriptionExpiry = createSubscriptionExpiryWorker(connection, {
    prisma,
    sms: expirySms,
    renewUrl: env.SUBSCRIPTION_RENEW_URL,
  })

  /*
   * The producer every other recurring queue was missing. Without it those
   * workers listen to queues nothing writes to — which is exactly how this
   * system shipped with no school ever warned and no parent ever reminded.
   */
  const dailySweep = createDailySweepWorker(connection, {
    prisma,
    queues: {
      subscriptionExpiry: createQueue('subscription-expiry', connection),
      reminderScheduler: createQueue('reminder-scheduler', connection),
      messageSender: createQueue('message-sender', connection),
    },
  })
  await installDailySchedule(connection, logger)

  const workers = [
    ['webhook-processor', webhookProcessor],
    ['reminder-scheduler', reminderScheduler],
    ['message-sender', messageSender],
    ['subscription-expiry', subscriptionExpiry],
    ['daily-sweep', dailySweep],
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
    await prisma.$disconnect()
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
