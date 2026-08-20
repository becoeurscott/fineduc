# CinetPay

Primary payment aggregator (ARCHITECTURE.md §9). MTN, Orange, Moov, Wave and
card across Cameroon, Côte d'Ivoire, Senegal, Burkina, Mali, Togo and Benin.

Adapter: `packages/providers/src/payment/adapters/cinetpay.ts`

## ⚠️ Not yet verified against a live account

AGENTS.md forbids testing against a real provider, so the adapter is written
from CinetPay's published v2 API and is proven **only** by the port contract
suite. Three things must be checked against their current docs and a sandbox
account before it touches real money. They are isolated in the adapter to make
that cheap:

| What | Where | If it is wrong |
| --- | --- | --- |
| Signature field order | `SIGNATURE_FIELDS` | Every callback is rejected as forged. Fails **safe** — nothing settles, nothing is mis-settled. |
| Result codes | `STATUS_MAP` | An unmapped code falls back to `pending`, never `succeeded`. Fails **safe**. |
| Endpoints and the `code === '201'` convention | `initiate`, `getStatus` | Initiate throws; no payment is created. Fails **safe**. |

Every unknown is deliberately biased toward "do not settle". A wrong guess
here stalls payments; it does not credit a family that has not paid.

## Signature scheme

CinetPay does **not** sign the raw body. It concatenates the values of the
fields in `SIGNATURE_FIELDS`, in that order, and HMAC-SHA256s the result with
the site's secret key, sending it as `x-token`.

That matters for the contract suite: the shared test that a re-serialised body
must fail verification applies only to byte-signing providers, so this adapter
declares `signsRawBytes: false`. The port still receives raw bytes, because a
byte-signing provider cannot work without them.

## Quirks

- **XAF/XOF amounts must be a multiple of 5.** The smallest circulating coin
  is 5 francs. The adapter rejects anything else up front and names the two
  nearest usable figures, rather than letting the aggregator return a 400 that
  a parent reads as "payment failed".
- **Callbacks arrive as JSON *or* form-encoded.** `verifyWebhook` handles both.
- **No separate delivery id.** `cpm_trans_id` is used as the `eventId`, so two
  callbacks for one transaction are correctly treated as the same event by the
  unique index on `provider_event`.
- **Our reference travels in `cpm_custom`.** It is what lets the worker
  attribute a callback to a tenant — see `packages/services/src/payments/payment-reference.ts`.
- **No refund API** on the v2 checkout product. Refunds happen in their back
  office; the adapter throws rather than reporting a quiet failure.

## Configuration

`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_WEBHOOK_SECRET` — validated
at boot by `packages/config`, and required in production. The adapter also
refuses to construct without the first two, so a misconfiguration surfaces at
startup rather than at a parent's checkout.

## Still to do

- Sandbox credentials and a manual end-to-end run.
- Confirm operator coverage and per-country channel codes.
- Fee schedule, so `provider_fee_minor` can be recorded.
