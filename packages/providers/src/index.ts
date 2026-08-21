/**
 * Public surface of @fineduc/providers — ports and adapters.
 *
 * Nothing above this package may reference a provider by name (AGENTS.md
 * rule #8). Callers depend on the PORT; which adapter is behind it is a
 * configuration decision, not a code one.
 *
 * The CONTRACT SUITES are deliberately NOT exported here. `port.contract.ts`
 * does `import { describe, it } from 'vitest'`, and re-exporting it from the
 * package root drags vitest into every runtime that imports this package —
 * the API crashed at boot on it, and in production, where devDependencies
 * are not installed, it would crash there too. Each adapter's spec imports
 * the suite by relative path instead, which is what they already did.
 */
export { ProviderError } from './provider-error.js'
export type {
  PaymentProvider,
  PaymentOperator,
  InitiatePaymentRequest,
  InitiatePaymentResult,
  ProviderPaymentStatus,
  WebhookVerification,
  NormalizedPaymentEvent,
  RefundResult,
} from './payment/port.js'

export { FakePaymentProvider } from './payment/adapters/fake.js'
export { ManualPaymentProvider } from './payment/adapters/manual.js'
export { CinetPayProvider } from './payment/adapters/cinetpay.js'
export type { CinetPayOptions } from './payment/adapters/cinetpay.js'

export { postJson, DEFAULT_POLICY, HttpTimeoutError } from './http.js'
export type { FetchLike, HttpPolicy } from './http.js'


/* ------------------------------------------------------------ messaging -- */

export { redactPhone, assertE164, assertChannel } from './messaging/port.js'
export type {
  MessagingProvider,
  Channel,
  MessageDeliveryStatus,
  OutboundMessage,
  SendResult,
  NormalizedMessageStatusEvent,
} from './messaging/port.js'

export { priceMessage, DEFAULT_UNIT_COSTS } from './messaging/cost.js'
export type { UnitCosts } from './messaging/cost.js'

export { ConsoleMessagingProvider } from './messaging/adapters/console.js'
export type { ConsoleMessagingOptions } from './messaging/adapters/console.js'
export { FakeMessagingProvider } from './messaging/adapters/fake.js'
export type { FakeMessagingOptions, FakeSentMessage } from './messaging/adapters/fake.js'
