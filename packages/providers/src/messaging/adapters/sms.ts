/*
 * SMS aggregator fallback. Universal but roughly 3x the cost, so it is what
 * `resolveChannel` falls back TO, never what it reaches for.
 *
 * Deliberately still a stub: no aggregator account exists, and AGENTS.md
 * forbids adding a third-party service without asking. Proven the same way
 * WhatsApp will be — by passing `runMessagingProviderContract`.
 *
 * ref: ARCHITECTURE.md section 9
 */

export {}
