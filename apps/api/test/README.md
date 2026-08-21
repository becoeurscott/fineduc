# API tests

Run against the shared dev stack (`infra/docker-compose.yml`) and against the
COMPILED `dist`, never `src` — see the note in `health.e2e.test.ts` about
esbuild silently dropping constructor DI metadata. `vitest.config.ts` runs
these files one at a time; they share one Postgres and would otherwise
corrupt each other's fixtures.

## Tests that MUST EXIST AND NEVER BE DELETED (AGENTS.md)

| Guarantee | Where |
| --- | --- |
| Cross-tenant isolation across every RLS table | `packages/db/src/rls.integration.test.ts` |
| Enrolment and its invoice commit atomically | `enrollment-invoice.e2e.test.ts` |
| `sum(instalment) == invoice.net` on PERSISTED rows | `enrollment-invoice.e2e.test.ts` |
| One tenant cannot see another's invoice/ledger | `enrollment-invoice.e2e.test.ts` |
| 100 000 XAF split three ways re-sums to 100 000 | `packages/domain/src/billing/instalments.test.ts` |
| One tenant cannot READ another's invoice by its real id | `enrollment-invoice.e2e.test.ts` |
| Money leaves the API as an integer string, never a number | `enrollment-invoice.e2e.test.ts` |
| A webhook delivered twice settles ONCE | `webhook-settlement.e2e.test.ts` |
| A late `failed` after settlement is dropped, not applied | `webhook-settlement.e2e.test.ts` |
| An unsigned or forged webhook is rejected and NOT stored | `webhook-settlement.e2e.test.ts` |
| The webhook endpoint verifies the RAW bytes, not a re-parse | `webhook-endpoint.e2e.test.ts` |
| A double-tapped payment settles ONCE | `cash-payment.e2e.test.ts` |
| Concurrent allocation does not over-allocate | `cash-payment.e2e.test.ts` |
| Receipt numbers are gapless, even across a rollback | `cash-payment.e2e.test.ts` |
| A cash variance cannot be closed without a written reason | `cash-payment.e2e.test.ts` |
| DI resolves for real (the tsx/esbuild trap) | `health.e2e.test.ts` |
| **No reminder for an instalment paid between scheduling and sending** | `apps/worker/test/reminder-flow.e2e.test.ts` |
| **A log fixture contains no phone number** (nor a link token) | `apps/worker/test/reminder-flow.e2e.test.ts` |
| A granted moratoire silences the ordinary reminder ladder | `apps/worker/test/reminder-flow.e2e.test.ts` |
| A reminder cancelled by a PAYMENT is never revived by a sweep | `apps/worker/test/reminder-flow.e2e.test.ts` |
| A new table is not silently DELETE-able by the app role | `packages/db/src/rls.integration.test.ts` |
| **One moratoire per instalment, under concurrency** | `moratorium.e2e.test.ts` |
| **`refusalFreesSlot` honoured in BOTH configurations** | `moratorium.e2e.test.ts` |
| **A moratoire never runs past 21 days from the ORIGINAL due date**, including a hand-typed staff date | `moratorium.e2e.test.ts` |
| **Every way of being wrong on `/moratoire/:token` is the SAME 404** | `moratorium.e2e.test.ts` |
| A replayed request returns the first answer, never an error | `moratorium.e2e.test.ts` |
| The public chat leaks no surname, matricule or phone | `moratorium.e2e.test.ts` |

Some of these live under `apps/worker/test/`. They are listed here because
this table is the index of the AGENTS.md guarantees, not of one app's suite —
and the two that were owed since phase 7 were owed by the reminder path,
which is a worker concern.

## Known gap, stated rather than left to be noticed

There is still no helper for authenticating over HTTP in this suite, so the
moratoire AUTHORISATION MATRIX (cashier and auditor refused on approve;
secretary refused on approve but allowed on list) is covered by the
`RolesGuard` unit test and the declarative `@Roles(...)` on the controller,
not by an end-to-end request. Building that helper is worth its own commit.

## Still owed

Nothing from the AGENTS.md list. Anything added to that list belongs in the
table above, with the file that proves it, in the same PR.
