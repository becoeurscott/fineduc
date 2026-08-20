/**
 * Public surface of @fineduc/providers — ports and adapters.
 *
 * Nothing above this package may reference a provider by name (AGENTS.md
 * rule #8). Callers depend on the PORT; which adapter is behind it is a
 * configuration decision, not a code one.
 */
export { ProviderError } from './payment/port.js'
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

export { runPaymentProviderContract } from './payment/port.contract.js'
export type { ProviderCapabilities } from './payment/port.contract.js'
