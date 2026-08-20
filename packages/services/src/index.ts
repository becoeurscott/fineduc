/**
 * Public surface of @fineduc/services — the application services that BOTH
 * `apps/api` and `apps/worker` need.
 *
 * The entry rule is narrow on purpose: something belongs here only when both
 * processes genuinely run it. Anything used by one app stays in that app.
 * Without that rule this becomes a junk drawer, and a junk drawer between two
 * processes is how a monolith quietly becomes a distributed one.
 *
 * Nothing here imports a web framework. `apps/api` wires these up with
 * explicit factory providers; the worker just constructs them.
 */
export { SettlementService } from './payments/settlement.service.js'
export type { SettleParams, SettleResult } from './payments/settlement.service.js'

export { WebhookIngestService } from './payments/webhook-ingest.service.js'
export type { IngestOutcome } from './payments/webhook-ingest.service.js'

export { WebhookProcessorService } from './payments/webhook-processor.service.js'
export type { ProcessOutcome } from './payments/webhook-processor.service.js'

export { encodePaymentReference, decodePaymentReference } from './payments/payment-reference.js'
export type { PaymentReference } from './payments/payment-reference.js'

export { consoleLogger } from './logger.js'
export type { Logger } from './logger.js'
