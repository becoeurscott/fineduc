# Providers

Ports and adapters. **No provider name may appear in `packages/domain` or in
any module service** (AGENTS.md rule #8) — callers depend on the port, and
which adapter sits behind it is configuration, not code.

## The contract suite

`src/payment/port.contract.ts` exports `runPaymentProviderContract()` and
`src/messaging/port.contract.ts` exports `runMessagingProviderContract()`.
Every adapter calls one of them, so adding a provider is one line and any
behaviour the rest of the system relies on is checked before it goes near
money or a family's phone.

`capabilities` lets an adapter opt out of what it genuinely cannot do — the
manual provider has no webhooks, the console adapter has no delivery
callbacks — WITHOUT weakening the suite: an opted-out capability is asserted
to fail loudly rather than skipped.

Both suites are run against a deliberately narrowed adapter as well as the
real ones (`FakeMessagingProvider({ channels: ['sms'] })`), because a
capability assertion that always returns early proves nothing.

## Adapter rules

- Adapters **never write to the database**. They translate, call, return.
  A messaging adapter in particular never debits the credit wallet: the
  sender does that inside the transaction that writes the `message` row,
  using `estimateCost`, and only then calls out.
- `verifyWebhook` runs on the RAW body. Re-serialising parsed JSON changes
  the bytes and every HMAC check then fails; the suite has a test for it.
- Verify BEFORE parsing. A webhook endpoint is public and hostile territory.
- **No phone number in an error message or a log line** (AGENTS.md rule #11).
  Use `redactPhone`; the messaging contract suite asserts it.

## Status

| Adapter | State |
| --- | --- |
| `FakePaymentProvider` | done — deterministic, scriptable, real HMAC |
| `ManualPaymentProvider` | done — cash/transfer/cheque, settles on the spot |
| `CinetPayProvider` | done — **unverified against a live account**, see `docs/providers/cinetpay.md` |
| Flutterwave | **not built** |
| `ConsoleMessagingProvider` | done — logs a redacted number, no callbacks |
| `FakeMessagingProvider` | done — in-memory outbox, scriptable failures |
| WhatsApp Cloud API | **not built** — needs a verified Business number + Meta template approval |
| SMS aggregator | **not built** — no aggregator account |
