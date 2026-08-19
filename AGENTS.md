# AGENTS.md — how to work inside Fineduc

> The single instruction file for any coding agent in this repo.
> `CLAUDE.md` points here. Do not duplicate rules across the two.

---

## Read this first, in this order

1. **[ARCHITECTURE-ESSENTIALS.md](ARCHITECTURE-ESSENTIALS.md)** — every task, always. It is short.
2. **[PRD.md](PRD.md)** — when the task touches product behaviour, pricing, or scope.
3. **[ARCHITECTURE.md](ARCHITECTURE.md)** — only the section you need. It is long; do not load
   it whole for a one-file change.

If the three disagree, **ARCHITECTURE.md wins on technical matters, PRD.md wins on product
matters.** Then fix the disagreement in the same PR.

## What this product is

Fee collection for private African schools. A file per student, dated instalments, automatic
WhatsApp/SMS reminders, mobile money through a third-party aggregator, and a real-time view for
the director. **It is not a school-management system** — no grades, no attendance, no timetable.
If a request drifts there, say so before building it.

## Non-negotiables

These are correctness rules, not style preferences. Violating one is a bug even if the tests pass.

1. **XAF and XOF have zero decimal places.** Money is `bigint` in minor units with an explicit
   currency exponent, and all arithmetic goes through `packages/money`. If you write a float, a
   `toFixed(2)`, or a hard-coded `* 100` for money, you have introduced a defect.
2. **Never update or delete a money row.** Payments, allocations and ledger entries are
   append-only. A correction is a new, signed, reason-coded row.
3. **Balances are projections.** Write them only inside the same transaction as the ledger entry
   that changes them. Never patch one to "fix" a number.
4. **Every tenant-scoped query runs inside a transaction that has issued
   `set local app.tenant_id`.** Never `set` (session-scoped — it leaks across pooled
   connections). Never add `BYPASSRLS` to the application role.
5. **Every money-moving POST and every message send requires an idempotency key.**
6. **The payment webhook is the source of truth.** Never mark a payment succeeded from a browser
   redirect or a client call.
7. **Reminder eligibility is re-checked at send time against the live balance.** Never send from
   a decision made at schedule time.
8. **No provider name in `packages/domain` or in any module service.** Go through the port.
9. **`due_on` is a `DATE` in the tenant's timezone.** Never a timestamp, never UTC arithmetic on
   a due date.
10. **Every mutating endpoint writes an audit row.** If you add a mutation and no audit row
    appears, the feature is incomplete.
11. **Never log a phone number, a full name, a matricule, a token, or a secret.**
12. **Fineduc never holds funds.** If a design implies money passing through our account, stop
    and flag it.

## How to build a feature

Work in this order. Do not jump to the controller.

1. **Contract first** — a Zod schema in `packages/contracts`. Types are derived from it, never
   hand-written alongside it.
2. **Domain logic** — pure functions in `packages/domain`. No database, no HTTP, no clock, no
   randomness. Inject anything impure.
3. **Persistence** — Prisma schema change plus a migration. Money-critical writes use raw SQL
   with explicit locking.
4. **Service** — the module service orchestrates: transaction boundary, locks, ledger writes,
   outbox event.
5. **HTTP** — a thin NestJS controller. Validate, delegate, map the result. **No business logic
   in a controller.**
6. **Job** — if there is asynchronous work, it is triggered by an outbox event, not by a direct
   `queue.add()` inside the transaction.
7. **Tests** — see below.
8. **Docs** — if you changed a rule, a model or a flow, update ARCHITECTURE.md **and** the
   corresponding line in ARCHITECTURE-ESSENTIALS.md in the same PR.

## Config gotcha: `ENCRYPTION_KEY` is 64 HEX characters, not 32 chars

`TotpService` does `Buffer.from(env.ENCRYPTION_KEY, 'hex')`. Node's hex
parser stops silently at the first non-hex character, so a 32-character
passphrase — or 64 characters that merely look like a key, e.g.
`'y'.repeat(64)` — yields a short buffer and AES-256 throws
`RangeError: Invalid key length`. Not at boot: at the moment a director
first enables 2FA. `packages/config` now enforces `/^[0-9a-fA-F]{64}$/`, so
this fails at startup instead. Generate one with `openssl rand -hex 32`,
and use a valid hex key in tests too.

## Tooling gotcha: never run a NestJS app through `tsx`

`tsx` (and any esbuild-based runner) does not implement TypeScript's
`emitDecoratorMetadata`. NestJS's constructor DI reads that metadata to know
which provider to inject for `private readonly foo: FooService` — without
it, Nest boots and logs as if everything worked, but silently injects
`undefined` for every constructor parameter, only crashing later when the
handler actually calls a method on it. `packages/db/src/seed.ts` (a plain
script, no DI) can use `tsx` freely; `apps/api` and `apps/worker` cannot.
Always run them via `tsc` + `node dist/…` — `pnpm dev` uses `tsc-watch` for
exactly this reason. Don't "simplify" it back to `tsx watch`.

## Testing

Write these, in this priority order:

- **Domain unit tests** — the money maths, allocation, largest-remainder splitting, instalment
  generation, discount application, the payment state machine. Fast, no I/O, exhaustive.
- **Integration tests** against a real Postgres via Testcontainers — RLS isolation, transaction
  boundaries, locking, the gapless receipt counter under concurrency.
- **Provider contract tests** written against the port. A new adapter is proven by making the
  existing suite pass. Never test against a live provider.
- **API tests** with Supertest — authorisation matrix, idempotency replay, validation errors.
- **E2E** with Playwright for exactly three journeys: enrol → invoice, cash payment → receipt →
  close the desk, reminder → payment link → webhook → settled.

**Tests that must exist and must never be deleted:**
- Two tenants, authenticate as A, attempt to read every table, assert zero B rows.
- A webhook delivered twice produces exactly one settlement.
- A reminder is not sent for an instalment paid between scheduling and sending.
- Concurrent payments on one instalment do not over-allocate.
- 100 000 XAF split three ways re-sums to exactly 100 000.
- A log fixture contains no phone number.

Money paths are not "covered enough" at 80%. Get them to 100% of branches.

## Code conventions

- TypeScript strict, `noUncheckedIndexedAccess`, no `any`, no non-null `!` on anything that
  crosses a boundary. `unknown` + a Zod parse instead of a cast.
- Errors: typed domain errors in `domain`, mapped to RFC 9457 `problem+json` at the HTTP edge.
  Never throw a bare `Error` with a string for something a client must handle.
- Naming: `snake_case` in the database, `camelCase` in TypeScript, `kebab-case` for files.
  Money fields always end in `_minor` / `Minor`. Dates that are calendar dates end in `_on`;
  instants end in `_at`.
- No barrel `index.ts` re-export files except at a package root.
- Comments explain **why**, never what. Match the density of the surrounding code.
- Commits: conventional commits, imperative, scoped — `feat(billing): generate instalments on enrolment`.
- French is the product's first language, but **code, identifiers, comments, commit messages and
  these docs are in English.** Domain terms may carry the French in a comment
  (`// grille tarifaire`).

## Things you must not do without asking

- Add a dependency that is not already in the lockfile.
- Add a new third-party service, a new provider, or a new hosting component.
- Change the money representation, the tenancy strategy, or the append-only rule.
- Run a destructive migration, or any migration that is not backward-compatible with the
  currently-deployed code.
- Touch production data, or run anything against production credentials.
- Weaken or bypass a rate limit, a quiet-hours check, or a message cap "to make a test pass".
- Send a real message or initiate a real payment from a dev or test environment. Use the Fake
  adapters.
- Widen v1 scope into grades, attendance, timetable, payroll, or a parent portal.

## When something is ambiguous

Do the part that is unambiguous, then state the assumption or ask the one question that
actually changes the work. Do not stop with nothing delivered, and do not silently pick a
money-affecting default.

## Before you say a task is done

- [ ] `pnpm typecheck && pnpm lint && pnpm test` all pass
- [ ] New money path has domain tests **and** an integration test
- [ ] Mutation writes an audit row
- [ ] Money-moving endpoint accepts and honours `Idempotency-Key`
- [ ] Tenant-scoped query runs under `set local app.tenant_id`
- [ ] No phone number, name, token or secret in any log line
- [ ] Migration is backward-compatible and reversible
- [ ] `.env.example` updated if a new variable exists
- [ ] Docs updated if a rule, model or flow changed
- [ ] You have said plainly what you did **not** do

## Hard questions — ask these of your own work

Before opening a PR, answer these three out loud in the PR description. They are the reason the
rest of this repo's documentation exists.

- **What will break?** Under concurrency, under a bad network, on a retry, at a tenant boundary,
  across a timezone, at the end of an academic year.
- **What edge cases am I missing?** Partial payment · overpayment · a refund on a partially
  allocated payment · a zero-amount instalment from a full scholarship · a payment for a closed
  year · a guardian with children in several classes · a wrong or reassigned phone number.
- **What is over-engineered?** If you added an abstraction with one implementation, a queue for
  work that is synchronous, a cache for a query that runs twice a day, or a configuration option
  no school has asked for — delete it before review.

## Current state

Pre-code. The scaffold in `apps/` and `packages/` is intentionally empty or barely drafted —
it exists to fix the shape of the project, not to be working software. Start at
**[ARCHITECTURE.md §15, Build order](ARCHITECTURE.md#15-build-order)**, phase 1. Do not start at
phase 9 because the UI is more fun.
