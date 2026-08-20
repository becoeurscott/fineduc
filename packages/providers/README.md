# Providers

Ports and adapters. **No provider name may appear in `packages/domain` or in
any module service** (AGENTS.md rule #8) — callers depend on the port, and
which adapter sits behind it is configuration, not code.

## The contract suite

`src/payment/port.contract.ts` exports `runPaymentProviderContract()`. Every
adapter calls it, so adding a provider is one line and any behaviour the rest
of the system relies on is checked before it goes near money.

`capabilities` lets an adapter opt out of what it genuinely cannot do — the
manual provider has no webhooks — WITHOUT weakening the suite: an opted-out
capability is asserted to fail loudly rather than skipped.

## Adapter rules

- Adapters **never write to the database**. They translate, call, return.
- `verifyWebhook` runs on the RAW body. Re-serialising parsed JSON changes
  the bytes and every HMAC check then fails; the suite has a test for it.
- Verify BEFORE parsing. A webhook endpoint is public and hostile territory.

## Status

| Adapter | State |
| --- | --- |
| `FakePaymentProvider` | done — deterministic, scriptable, real HMAC |
| `ManualPaymentProvider` | done — cash/transfer/cheque, settles on the spot |
| CinetPay | **not built** (phase 6) |
| Flutterwave | **not built** |
| Messaging (WhatsApp, SMS, console) | **not built** (phase 7) |
