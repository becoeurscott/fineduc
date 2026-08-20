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
| DI resolves for real (the tsx/esbuild trap) | `health.e2e.test.ts` |

## Still owed

- A webhook delivered twice settles once.
- No reminder for an instalment paid between scheduling and sending.
- Concurrent allocation does not over-allocate.
- A log fixture contains no phone number.
