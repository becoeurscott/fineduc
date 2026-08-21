# ARCHITECTURE-ESSENTIALS — Fineduc

> **The outline only.** Load this on every task. Open the full
> [ARCHITECTURE.md](ARCHITECTURE.md) only when you need the detail behind a line here.

---

## What it is
Fee-collection SaaS for private schools in Africa. One file per student, dated instalments,
automatic WhatsApp/SMS reminders, mobile-money payment through a **third-party aggregator**,
real-time director dashboard. **Not** a school-management system.

## Stack
TypeScript · Node 22 · **NestJS** API · **PostgreSQL 16** (+RLS) · **Prisma** · **Redis** ·
**BullMQ** workers · **Zod** contracts · **Next.js 15** dashboard / pay page / landing ·
S3 (R2) · Sentry + OTel.
Monorepo: pnpm workspaces + Turborepo. Modular monolith — **no microservices, no GraphQL.**

## Layout
```
apps/     api · worker · dashboard · pay · web
packages/ domain · db · contracts · providers · services · money · config · ui
```
`domain` imports nothing but `money` (a zero-dep, I/O-free value type). Apps never import from
apps — anything BOTH api and worker run lives in `services`, which imports no web framework.
Enforced by lint in CI.

## The ten rules — break one and the system is wrong

1. **XAF/XOF have ZERO decimals.** Money is `bigint` minor units + an explicit currency
   exponent. No floats. No hard-coded `× 100`. All arithmetic via `packages/money`.
2. **Money tables are append-only.** Never update, never delete a payment or a ledger entry.
   Corrections are new, signed, reason-coded rows.
3. **Balances are projections**, written only in the same transaction as the ledger entry that
   changes them, and verified by the nightly integrity sweep.
4. **Tenant isolation is Postgres RLS.** `set local app.tenant_id` inside a transaction, on
   every request and every job. The API role has **no** `BYPASSRLS`.
5. **`Idempotency-Key` is mandatory** on every money-moving POST and every message send.
6. **The webhook is authoritative; the browser redirect is a hint.** Store the raw event first
   (unique on `provider + event_id`), return 200 fast, do the work in a job.
7. **Reminder eligibility is decided at SEND time, not schedule time.** Re-check the live
   balance. Messaging a parent who already paid is the fastest way to lose a school.
8. **Provider names never appear in domain code.** Payment and messaging are ports with
   swappable adapters. No direct telco integration, ever.
9. **`due_on` is a `DATE` in tenant timezone.** Never a timestamp. Never UTC arithmetic.
10. **Every mutating request writes an `audit_log` row.** That table has INSERT/SELECT grants
    only.

## Core data model
```
tenant ─ site ─ user ─ membership(role)
academic_year ─ term ─ grade_level ─ class_group
student ─ student_guardian ─ guardian
enrollment            ← the act that creates money owed
  └ invoice ─ invoice_line ─ discount ─ adjustment
       └ instalment    ← what reminders and payments hang off
            └ moratorium ─ moratorium_chat_link   ← a parent-requested delay
            └ payment_allocation ─ payment ─ receipt / refund
student_ledger_entry  ← APPEND-ONLY truth of a student's account
cash_desk ─ cash_session ─ cash_movement     ← the anti-leak control
reminder_rule(basis) ─ reminder_schedule ─ message ─ message_credit_ledger
message_template · payment_link · provider_event · outbox · audit_log
```

## Modules
`identity` · `tenancy` · `academics` · `students` · **`billing`** · **`payments`** ·
**`cashbox`** · **`messaging`** · `analytics` · `audit` · `platform`.
Cross-module calls go through the public service interface only — never into another module's
repository.

## The four flows that matter
- **Enrol →** one transaction: enrollment + invoice + lines + discounts + instalments + ledger
  entries. Invariant: `Σ instalment.amount == invoice.net_minor`.
- **Pay (mobile money) →** initiate (idempotent, re-validate against the **live** balance) →
  aggregator → **webhook** → job → lock invoice `FOR UPDATE` → allocate oldest-due-first →
  ledger → cancel that instalment's reminders → receipt.
- **Pay (cash) →** requires an open `cash_session`; same allocation path; **gapless** receipt
  number from a locked counter row (not a Postgres sequence — sequences gap on rollback).
- **Remind →** nightly scheduler materialises intent against the EFFECTIVE due date
  (`moratorium.deferred_due_on ?? instalment.due_on`); the sender every 15 min re-checks: paid?
  under moratoire? opted out? quarantined? quiet hours? frequency cap? tenant daily cap?
  credits > 0? — **all limits live in the sender, not the scheduler.** The message row, the
  credit debit and the schedule's flip to `sent` commit together; the provider is called after.
- **Moratoire →** the J-14 reminder carries a tokenised chat link; the parent picks up to
  **21 days from the ORIGINAL due date**, once per instalment. Auto-granted or queued for a
  bursar — **the school configures which**, in `tenant.settings.moratorium`. A grant suppresses
  the due-date ladder and schedules two `moratorium_end` reminders (J-7 and the eve).

## Security
argon2id · JWT 15 min + rotating refresh with reuse detection · TOTP 2FA for Director & Bursar ·
RBAC deny-by-default (Director / Bursar / Cashier / Secretary / Auditor) · **four-eyes** on
refunds, reversals, large discounts and cash-variance reconciliation · Zod at every boundary ·
rate limits · signature-verified webhooks with a replay window · payment-link tokens carry no
PII · PII redacted from logs · secrets from env only, validated at boot.
**Fineduc never holds funds** — the aggregator settles directly to the school's account.

## Providers (v1)
Payment: **CinetPay** primary, Flutterwave secondary, Manual (cash/transfer), Fake (tests).
Messaging: **WhatsApp Cloud API** first (cheap), SMS aggregator fallback, Console/Fake.
Every adapter must pass the same port contract test suite.

## Jobs
`webhook-processor` · `reminder-scheduler` (02:00 tenant tz) · `message-sender` (15 min) ·
`message-status` · `reconciler` (30 min) · `integrity-sweep` (03:00) · `receipt-renderer` ·
`exporter` · `director-digest` (07:00 tenant tz) · `outbox-publisher` (5 s).
Every payload carries `tenantId` + `requestId` and sets `app.tenant_id`.

## API
REST `/api/v1`, Bearer JWT, OpenAPI from Zod. Cursor pagination. RFC 9457 problem+json errors.
Money on the wire: `{ "amountMinor": "45000", "currency": "XAF" }` — **a string**, so no client
loses precision. Due dates: plain `YYYY-MM-DD`.
Public, unauthenticated, hostile-territory endpoints: `GET /pay/:token`,
`POST /pay/:token/initiate`, `GET /moratoire/:token`,
`POST /moratoire/:token/request`, `POST /webhooks/*`.
All are IP rate-limited — never keyed by token, which would let anyone who
saw a forwarded link lock a family out of their own page.

## Build order — backend first, strictly
1 foundation (money, schema, **RLS + cross-tenant test**) → 2 identity/tenancy → 3 students →
**4 billing** (hardest — over-test it) → **5 cash payments** (usable school, zero providers) →
6 mobile money + webhooks → 7 messaging → 8 analytics → 9 dashboard UI → 10 landing page.

## UI
Dashboard: Next.js 15 + TanStack Query + Tailwind v4 + Recharts. **Mobile-first at 360 px
— the director decides from a phone.** French-first, English toggle.
**Optimistic UI is banned on money operations.**
Landing: FintechX Framer look — `#1d1d1d` on `#edf1f4`, slate `#4d585f`, blue `#3b82f6`,
emerald `#10b981`, Inter, scroll reveals, sticky step stacks. Calm and financial, not edtech.

**Charts** — palettes are VALIDATED, never eyeballed (`packages/ui/src/tokens/charts.ts`):
categorical `#10b981,#ff8b06,#3b82f6,#e11d48` (passes all-pairs CVD); arrears ageing is a
SEQUENTIAL single-hue ramp `#f87171→#7f1d1d`, because bucketed age is ordered data, not four
categories. Brand slate `#4d585f` is a TEXT colour only — chroma 0.018 reads as gray.
Every chart ships a value-bearing legend AND a data-table toggle; that is the required relief
for a sub-3:1 contrast warning, not decoration.

**Tailwind + workspace packages** — `apps/dashboard/src/app/globals.css` must carry
`@source "../../../../packages/ui/src"`. Tailwind v4 excludes `node_modules`, where pnpm
symlinks workspace packages, so without it every utility used only inside `packages/ui`
silently generates nothing (verified: the recovery meter computed to `height:0`).

## Pricing (drives plan limits in code)
Essentiel 25 000 XAF/mo ≤250 students, 500 msgs · Croissance 60 000 XAF/mo ≤800, 2 000 msgs ·
Institution from 120 000 XAF/mo. Annual −20%. Prepaid message wallet (WhatsApp 10 XAF, SMS
30 XAF). Onboarding 150 000 XAF. Aggregator fees passed through, never absorbed.

## The five things most likely to break
1. Balance projections drifting from the ledger → nightly integrity sweep, page on mismatch.
2. Tenant leaking through a pooled connection → `set local` in a transaction + a CI test.
3. A reminder storm or reminding someone who already paid → all caps in the sender.
4. Double payment on a bad network → idempotency keys + duplicate-settlement detection.
5. Receipt-number gaps read as deleted receipts by an auditor → locked counter row.
