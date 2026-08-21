# ARCHITECTURE — Fineduc

> The complete technical file: stack, system design, data models, module boundaries, security,
> integrations, jobs, and deployment. This is the long one — it holds all the detail.
> For the fast reference an agent should load first, see
> [ARCHITECTURE-ESSENTIALS.md](ARCHITECTURE-ESSENTIALS.md).
> For *what* and *why*, see [PRD.md](PRD.md).

- **Status:** v1 design, pre-code
- **Last updated:** 2026-08-18

---

## 1. Guiding principles

1. **The ledger is the product.** Everything else — reminders, dashboards, links — is a view
   over, or a trigger on, a correct student ledger. Get the ledger right and the rest is easy.
2. **Money is append-only.** No money row is ever updated or deleted. Corrections are new,
   signed, reason-coded rows. A balance is a projection, never an authoritative field you edit.
3. **Integers only, currency exponent respected.** XAF/XOF have **zero** decimal places.
   Store `bigint` in the currency's minor unit and carry the exponent explicitly.
   Never a float. Never a hard-coded `× 100`.
4. **Idempotency everywhere a write moves money or sends a message.** The network is bad, the
   webhooks retry, the cashier double-taps.
5. **The tenant boundary is enforced by the database, not by remembering a `where` clause.**
   Postgres Row-Level Security is the backstop for every application bug we have not written yet.
6. **One deployable, clean modules.** A modular monolith. Module boundaries are enforced by
   lint, not by network hops.
7. **External providers are ports.** Payment and messaging are interfaces with swappable
   adapters. No provider name appears in domain code, ever.
8. **Backend-first.** The API and the domain are complete and tested before a dashboard pixel
   is drawn. Every UI is a client of a documented API.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript 5.x**, strict, `noUncheckedIndexedAccess` | One language across API, jobs, dashboard, landing. Types are the spec agents read. |
| Runtime | **Node.js 22 LTS** | Stable, cheap to host, huge ecosystem for the providers we need. |
| API framework | **NestJS 11** | Module boundaries, DI, guards and interceptors map exactly onto tenancy/auth/audit cross-cuts. Opinionated structure is a feature when agents write the code. |
| Database | **PostgreSQL 16** | Transactions, RLS, `numeric`/`bigint`, partial indexes, `jsonb`, generated columns. The tenancy and money model depend on it. |
| ORM / access | **Prisma 6** for schema + typed reads, **raw SQL** for money-critical writes and reports | Prisma for velocity and a readable schema; SQL where locking and correctness matter. |
| Migrations | **Prisma Migrate**, forward-only, reviewed | |
| Cache / queue backing | **Redis 7** | Job queue, rate limits, idempotency keys, short-lived locks. |
| Jobs & scheduling | **BullMQ** | Reminder scheduling, webhook processing, reconciliation, exports. Retries with backoff, dead-letter queues, per-queue concurrency. |
| Validation | **Zod** at every boundary | One schema generates runtime validation + TS types + OpenAPI. |
| Auth | **JWT access (15 min) + rotating refresh (30 d)**, argon2id passwords, TOTP 2FA | |
| API docs | **OpenAPI 3.1**, generated from Zod | The dashboard and landing consume it. |
| Dashboard | **Next.js 15** (App Router) + **TanStack Query** + **Tailwind** + **shadcn/ui** + **Recharts** | Mobile-first; the director uses a phone. |
| Landing | **Next.js 15**, static, + **Framer Motion** | Framer-template look; SSG for speed on 3G. |
| Files | **S3-compatible object storage** (Cloudflare R2) | Receipts, exports, student photos. Never in the database. |
| PDF | **@react-pdf/renderer** in a worker | Receipts and reports. |
| Email (staff only) | **Resend** | Guardians are reached by WhatsApp/SMS, never email. |
| Errors / tracing | **Sentry** + **OpenTelemetry** → Grafana Cloud | |
| Logs | **Pino**, JSON, structured, `tenant_id` on every line, PII redacted | |
| Tests | **Vitest** (unit), **Supertest** (API), **Testcontainers** (real Postgres), **Playwright** (dashboard) | |
| Repo | **pnpm workspaces + Turborepo** monorepo | |
| CI | **GitHub Actions** | typecheck → lint → test → migrate-check → build |
| Hosting | API + workers on **Railway** or **Fly.io** (Paris/Frankfurt region), Postgres managed with PITR, web on **Vercel** | Low latency to West/Central Africa; cheap at our scale. |

### Deliberate non-choices
- **No microservices.** One API deployable, one worker deployable. Modules, not services.
- **No GraphQL.** REST + OpenAPI. Fewer moving parts, easier caching, easier for agents.
- **No event-sourcing framework.** The money tables *are* append-only; that is enough.
- **No Kafka.** BullMQ on Redis handles our volume by three orders of magnitude.
- **No direct telco integration.** One aggregator, behind a port. Non-negotiable — a direct
  MoMo/Orange contract drags us into licensing we do not want.

## 3. System shape

```
                    ┌──────────────────────────────────────────────┐
   Guardian phone   │  apps/web  (Next.js, static)                 │
   WhatsApp / SMS   │  Landing • pricing • demo request            │
        │           └──────────────────────────────────────────────┘
        │
        │  tap link      ┌──────────────────────────────────────────┐
        └──────────────► │  apps/pay  (Next.js, public, no login)   │
                         │  Payment link page → aggregator checkout │
                         └────────────────┬─────────────────────────┘
                                          │
   Director / Bursar /   ┌────────────────┴─────────────────────────┐
   Cashier browser  ───► │  apps/dashboard  (Next.js, authed)       │
                         └────────────────┬─────────────────────────┘
                                          │  REST + OpenAPI, Bearer JWT
                         ┌────────────────▼─────────────────────────┐
                         │  apps/api   (NestJS, modular monolith)   │
                         │  ┌────────────────────────────────────┐  │
                         │  │ identity · tenancy · students ·    │  │
                         │  │ billing · payments · cashbox ·     │  │
                         │  │ messaging · analytics · audit      │  │
                         │  └────────────────────────────────────┘  │
                         └───┬──────────────┬──────────────┬────────┘
                             │              │              │
                 ┌───────────▼──┐   ┌───────▼──────┐   ┌───▼──────────┐
                 │ PostgreSQL 16│   │  Redis 7     │   │  S3 (R2)     │
                 │  RLS per     │   │ queues·locks │   │ receipts     │
                 │  tenant      │   │ idempotency  │   │ exports      │
                 └──────────────┘   └───────┬──────┘   └──────────────┘
                                            │
                         ┌──────────────────▼───────────────────────┐
                         │  apps/worker  (BullMQ)                   │
                         │  reminder-scheduler · message-sender ·   │
                         │  webhook-processor · reconciler ·        │
                         │  receipt-renderer · exporter · digest    │
                         └───┬─────────────────────────┬────────────┘
                             │                         │
                  ┌──────────▼─────────┐   ┌───────────▼────────────┐
                  │ PaymentProvider    │   │ MessagingProvider      │
                  │ port               │   │ port                   │
                  │ → CinetPay adapter │   │ → WhatsApp Cloud API   │
                  │ → Flutterwave      │   │ → SMS aggregator       │
                  │ → Manual/offline   │   │ → Console (dev)        │
                  └────────────────────┘   └────────────────────────┘
                             ▲
                             │ signed webhooks (public endpoint,
                             │ signature-verified, replay-protected)
                    aggregator callbacks
```

### Monorepo layout

```
fineduc/
├─ apps/
│  ├─ api/          NestJS HTTP API                 ← build first
│  ├─ worker/       BullMQ processors               ← build first
│  ├─ dashboard/    Next.js admin & director UI     ← build second
│  ├─ pay/          Next.js public payment page     ← build second
│  └─ web/          Next.js marketing landing       ← build last
├─ packages/
│  ├─ domain/       pure business logic, zero I/O   ← the heart
│  ├─ db/           Prisma schema, migrations, seed
│  ├─ contracts/    Zod schemas + generated OpenAPI types (shared by api & clients)
│  ├─ providers/    payment + messaging ports and adapters
│  ├─ services/     application services BOTH api and worker run
│  ├─ money/        Money value object, currency table, formatting
│  ├─ config/       typed env loading (Zod), fail-fast at boot
│  └─ ui/           shared React components + design tokens
├─ docs/            ADRs, runbooks, provider notes
└─ infra/           Docker Compose (dev), deployment config
```

**Dependency rule, enforced by `eslint-plugin-boundaries` in CI:**
`domain` depends on nothing but `money` — a zero-dependency, I/O-free value type; reimplementing
its allocation or rounding inside `domain` would break rule #1. `db`, `providers` may depend on
`domain`, `money`, and `config`.
`services` holds the application services that BOTH `api` and `worker` execute — settlement,
webhook ingest and processing today. It exists because apps may never import each other, and
duplicating a money path across that boundary would drift; the first symptom of drift on a money
path is a balance nobody can explain. **Entry rule, deliberately narrow: something belongs in
`services` only when both processes genuinely run it.** Anything one app alone uses stays in that
app, or `services` becomes a junk drawer — and a junk drawer between two processes is how a
modular monolith quietly becomes a distributed one. Nothing in `services` imports a web
framework: `api` wires it up with explicit factory providers, and `worker` simply constructs it.
`ui` and the client apps may depend on `money` for **display only** — formatting lives in
`packages/money` and is never reimplemented elsewhere (AGENTS.md rule #1).
`api`/`worker` depend on all packages. Apps never import from each other.
**Nothing** imports from `apps/*`.

## 4. Multi-tenancy

**Model:** shared database, shared schema, `tenant_id` on every business table, isolated by
**Postgres Row-Level Security**.

Why not a schema or database per tenant: a few hundred schools, and cross-tenant analytics,
migrations and support all become painful. RLS gives us the isolation without the operational cost.

**How it works**

1. Every business table carries `tenant_id uuid not null`.
2. Every business table has `enable row level security` plus a policy:
   `using (tenant_id = current_setting('app.tenant_id')::uuid)`.
3. The API runs as a role **without** `BYPASSRLS`. Migrations run as a separate role that has it.
4. A `TenantContext` interceptor resolves the tenant from the JWT, opens a transaction, and
   issues `set local app.tenant_id = $1` before any query in the request.
5. `set local` is transaction-scoped, so a pooled connection can never leak a tenant into the
   next request.
6. Jobs set the same variable from the job payload's `tenantId`. A job without a tenant is
   rejected at enqueue time.

**Test that must exist and must never be deleted:** create two tenants with data, authenticate
as tenant A, attempt to read every table, and assert zero tenant-B rows. Run it in CI on every PR.

**Sites (campuses).** A tenant has one or more `sites`. Students, cash desks and users belong to
a site. Site is a *filter*, not an isolation boundary — a group director sees all sites, a site
bursar is scoped to one.

## 5. Money

`packages/money` owns this and nothing else may reimplement it.

```ts
type Money = { amount: bigint; currency: CurrencyCode }   // amount is in MINOR units
```

- Currencies carry an explicit exponent: **XAF 0, XOF 0**, NGN 2, GHS 2, USD 2, EUR 2.
  For XAF, one minor unit *is* one franc. There is no ×100.
- Stored as two columns: `amount_minor bigint` + `currency char(3)`. Never `numeric`, never
  `float`, never a single "amount" column whose unit you have to guess.
- All arithmetic goes through the `Money` type. Adding two different currencies throws.
- **Allocation and split use largest-remainder** so the parts always re-sum to the whole. A
  three-way split of 100 000 XAF is 33 334 / 33 333 / 33 333 — never 33 333.33.
- Percentage discounts round **half-up to the minor unit**, computed on the base amount, and the
  resulting integer is what is stored — never the percentage re-applied later.
- Formatting is presentation-only, locale-aware (`fr-CM`: `45 000 FCFA`), and lives in `ui`.
- A tenant has **one** currency, set at creation and immutable. A payment arriving in another
  currency is rejected and flagged for manual handling, never auto-converted.

## 6. Data model

Core tables. `tenant_id`, `created_at`, `updated_at`, `created_by` are on everything and
omitted below for readability.

### Tenancy and identity
- **tenant** — school. `name, legal_name, country, currency, timezone, locale, plan,
  status, logo_url, settings jsonb`
- **site** — campus. `tenant_id, name, address, is_primary`
- **user** — staff. `email, phone, password_hash, name, status, totp_secret_encrypted,
  totp_enabled, last_login_at, failed_login_count, locked_until`
- **membership** — user ↔ tenant ↔ role, optionally scoped to a site.
  `user_id, tenant_id, site_id, role, status` — a user may serve several schools (a group's
  accountant). **Unique on (user_id, tenant_id).**
- **refresh_token** — `user_id, token_hash, family_id, expires_at, revoked_at, user_agent, ip`
  (rotation with reuse detection)
- **api_key** — `tenant_id, name, key_hash, scopes[], last_used_at, expires_at` (Institution plan)

### Academic structure
- **academic_year** — `name ("2026-2027"), starts_on, ends_on, status (draft|active|closed)`.
  **Only one `active` per tenant** (partial unique index).
- **term** — `academic_year_id, name, starts_on, ends_on, sequence`
- **grade_level** — `name ("6ème", "CM2"), sequence, cycle` (the class *level*)
- **class_group** — `grade_level_id, academic_year_id, site_id, name ("6ème A"), capacity,
  head_teacher_name`

### People
- **student** — `matricule (unique per tenant), first_name, last_name, sex, born_on,
  photo_url, status (enrolled|left|graduated|suspended), notes`
- **guardian** — `first_name, last_name, phone_e164 (indexed), phone_alt_e164, email,
  relationship, preferred_channel (whatsapp|sms), preferred_locale,
  whatsapp_opt_in, opt_out_at, verification_status, bounce_count, quarantined_at`
- **student_guardian** — `student_id, guardian_id, is_primary, pays_fees, share_percent`
  (a fee split between two separated parents is a real case)
- **enrollment** — `student_id, class_group_id, academic_year_id, enrolled_on, left_on,
  status, fee_schedule_id, carried_forward_balance_minor`
  **The row that creates money owed.** Unique on `(student_id, academic_year_id)`.

### Fees and the ledger
- **fee_schedule** — `academic_year_id, grade_level_id, name, version, effective_from,
  status (draft|published|archived), total_minor` — **versioned, never mutated after publish**
- **fee_item** — `fee_schedule_id, code, label, category (tuition|registration|exam|canteen|
  transport|uniform|boarding|other), amount_minor, is_mandatory, is_recurring, sequence`
- **instalment_plan** — `fee_schedule_id, name, instalment_count`
- **instalment_template** — `instalment_plan_id, sequence, label ("1ère tranche"),
  due_offset_days | due_on, percent_bp | amount_minor`
- **invoice** — one per enrollment per academic year. `enrollment_id, number, issued_on,
  total_minor, discount_minor, net_minor, paid_minor, balance_minor, status`
  *(`paid_minor`/`balance_minor` are **maintained projections**, recomputed inside the same
  transaction as every ledger write and verified nightly — never edited by hand.)*
- **invoice_line** — `invoice_id, fee_item_id, label, amount_minor, quantity`
- **instalment** — `invoice_id, sequence, label, due_on (DATE, tenant timezone),
  amount_minor, allocated_minor, status (pending|partial|paid|overdue|waived|cancelled)`
  **The unit reminders and payments hang off.**
- **discount** — `invoice_id | invoice_line_id, type (sibling|staff|merit|hardship|commercial),
  method (percent|fixed), value, amount_minor, reason, granted_by, approved_by, granted_at`
- **adjustment** — `invoice_id, type (credit|debit), amount_minor, reason_code, note,
  created_by, approved_by` — how a mid-year fee change or a correction is recorded
- **student_ledger_entry** — **append-only.** `student_id, invoice_id, instalment_id,
  entry_type (charge|payment|discount|adjustment|refund|reversal|carry_forward),
  amount_minor (signed), balance_after_minor, source_type, source_id, occurred_on, memo`
  *The audit-grade truth of a student's account. Nothing here is ever updated or deleted.*

### Payments
- **payment** — `student_id, invoice_id, method (mobile_money|cash|bank_transfer|cheque|
  card|waiver), amount_minor, currency, status (pending|processing|succeeded|failed|
  cancelled|expired|refunded|partially_refunded), provider, provider_ref, provider_fee_minor,
  fee_borne_by (payer|school), payer_phone_e164, payer_name, idempotency_key (unique per tenant),
  cash_session_id, initiated_by, received_at, reconciled_at, raw_provider_payload jsonb`
- **payment_allocation** — `payment_id, instalment_id, amount_minor` — how one payment is spread
  across instalments. A partial payment produces one row; a large payment produces several.
- **payment_link** — `student_id, invoice_id, instalment_id (nullable → "pay anything"),
  token (unguessable, 32 bytes), suggested_amount_minor, min_amount_minor, expires_at,
  used_at, created_by`
- **receipt** — `payment_id, number (gapless per tenant per year), issued_at, pdf_url,
  sent_at, sent_channel` — **immutable**; a correction issues a credit note, not an edit
- **refund** — `payment_id, amount_minor, reason_code, note, status, requested_by,
  approved_by, provider_ref, processed_at`
- **provider_event** — every inbound webhook, stored raw before processing.
  `provider, event_id (unique), event_type, signature_valid, payload jsonb, received_at,
  processed_at, processing_error, attempts` — **the replay log; also our idempotency guard**

### Cash control
- **cash_desk** — `site_id, name, is_active`
- **cash_session** — `cash_desk_id, cashier_user_id, opened_at, opening_float_minor,
  closed_at, declared_close_minor, expected_close_minor, variance_minor, variance_reason,
  status (open|closed|reconciled|flagged), closed_by, reconciled_by`
  **Partial unique index: one `open` session per desk.**
- **cash_movement** — `cash_session_id, type (payment|float_in|float_out|deposit_to_bank|
  correction), amount_minor (signed), reference, note, created_by` — append-only

### Messaging
- **message_template** — `code, channel, locale, subject, body, variables[], whatsapp_template_name,
  whatsapp_template_status, is_active` — WhatsApp templates need Meta pre-approval, so the
  approval status lives here
- **reminder_rule** — `tenant_id, name, offset_days (signed; −7 = seven days before due),
  channel, template_code, escalation_level, is_active, applies_to (all|class|status),
  basis (due_date|moratorium_end)` — `basis` is what `offset_days` counts FROM, so the two
  end-of-moratoire reminders reuse this table and `reminder_schedule` rather than needing
  their own
- **reminder_schedule** — materialised intent. `instalment_id, reminder_rule_id, guardian_id,
  scheduled_for (timestamptz, computed in tenant tz), status (scheduled|sent|skipped|
  cancelled|failed), skip_reason, message_id` — **unique on (instalment_id, rule_id, guardian_id)**
- **message** — `guardian_id, student_id, channel, provider, to_phone_e164, template_code,
  locale, body_rendered, status (queued|sent|delivered|read|failed|undeliverable),
  provider_message_id, error_code, cost_minor, sent_at, delivered_at, read_at`
- **message_credit_ledger** — append-only wallet. `tenant_id, entry_type (topup|debit|
  refund|adjustment), amount_minor, balance_after_minor, message_id, note`
- **moratorium** — a parent-requested delay on ONE instalment. `instalment_id, student_id,
  guardian_id, status (pending|granted|refused|cancelled), source (chatbot|staff),
  requested_days, original_due_on, deferred_due_on, reason, idempotency_key, decided_at,
  decided_by, decision_note`. **`instalment.due_on` is never rewritten** — reads compute
  `effectiveDueOn = moratorium?.deferred_due_on ?? instalment.due_on`, so "was this actually
  late?" stays answerable. MUTABLE, unlike the money tables: rule #2 covers payments and
  ledger entries, and a moratoire moves no francs. DELETE stays revoked.
- **moratorium_chat_link** — the token behind the link in a reminder. `instalment_id,
  student_id, guardian_id, token (unique), expires_at, consumed_at`. Scoped to one instalment
  and one guardian; the token carries the tenant so the public chat page can open an RLS
  context with no JWT.

### Platform
- **subscription** — `tenant_id, plan, billing_period, student_cap, price_minor,
  current_period_start, current_period_end, status`
- **audit_log** — **append-only, no delete grant.** `tenant_id, actor_user_id, actor_role,
  action, entity_type, entity_id, before jsonb, after jsonb, ip, user_agent, request_id,
  occurred_at`
- **outbox** — transactional outbox. `aggregate_type, aggregate_id, event_type, payload jsonb,
  published_at, attempts` — a domain event is written in the *same transaction* as its state
  change, then published to the queue by a poller. This is how we avoid "payment saved but
  receipt never sent".

### Indexes that matter
```sql
create unique index on student (tenant_id, matricule);
create index     on guardian (tenant_id, phone_e164);
create index     on instalment (tenant_id, due_on, status) where status in ('pending','partial','overdue');
create index     on payment (tenant_id, received_at desc);
create unique index on payment (tenant_id, idempotency_key);
create unique index on provider_event (provider, event_id);
create unique index on cash_session (cash_desk_id) where status = 'open';
create unique index on academic_year (tenant_id) where status = 'active';
create index     on student_ledger_entry (tenant_id, student_id, occurred_on desc);
create index     on reminder_schedule (status, scheduled_for) where status = 'scheduled';
create unique index on moratorium (tenant_id, instalment_id) where status in ('pending','granted');
create index     on moratorium (tenant_id, deferred_due_on) where status = 'granted';
create index     on audit_log (tenant_id, entity_type, entity_id, occurred_at desc);
```

## 7. Modules

Each is a NestJS module with a public service interface. Cross-module calls go through that
interface only — never into another module's repository.

| Module | Owns | Key operations |
|---|---|---|
| `identity` | user, membership, refresh_token, api_key | login, refresh, 2FA enrol/verify, invite, role change, password reset |
| `tenancy` | tenant, site, subscription, settings | onboard school, manage sites, plan limits, feature flags |
| `academics` | academic_year, term, grade_level, class_group | open/close a year, promote a cohort |
| `students` | student, guardian, student_guardian, enrollment | enrol, re-enrol, transfer, withdraw, attach guardian, merge duplicates |
| `billing` | fee_schedule, fee_item, instalment_plan, invoice, instalment, discount, adjustment, student_ledger_entry | publish a schedule, **generate an invoice + instalments on enrolment**, apply a discount, post an adjustment, compute a balance |
| `payments` | payment, payment_allocation, payment_link, receipt, refund, provider_event | initiate mobile money, record cash, **process a webhook**, allocate, issue a receipt, refund, reconcile |
| `cashbox` | cash_desk, cash_session, cash_movement | open, take cash, close with a count, reconcile, daily report |
| `messaging` | message_template, reminder_rule, reminder_schedule, message, message_credit_ledger, moratorium, moratorium_chat_link | schedule reminders, render, send, track delivery, meter credits, honour opt-out, grant and decide moratoires |
| `analytics` | read-only projections | director dashboard, arrears ageing, recovery rate, method mix, reminder effectiveness |
| `audit` | audit_log | write (via interceptor), query, export |
| `platform` | health, config, jobs admin, provider status | ops surface |

## 8. Critical flows

### 8.1 Enrolment creates the money owed

```
POST /enrollments  { studentId, classGroupId, academicYearId, feeScheduleId?, planId? }
  ↓ single transaction
  1. validate: year is active, student not already enrolled that year, schedule is published
  2. create enrollment
  3. resolve fee_schedule (explicit, or the published one for that grade_level + year)
  4. create invoice + invoice_lines from fee_items
  5. apply automatic discounts (sibling rule) → discount rows, recompute net
  6. expand instalment_templates → instalment rows
       due_on = a DATE resolved in the TENANT timezone
       amounts split by largest-remainder so they re-sum to net exactly
  7. if carried_forward_balance > 0 → a `carry_forward` ledger entry + an extra instalment
  8. write student_ledger_entry (type=charge) per line
  9. write outbox event `enrollment.created`
  ↓ commit
  worker: schedule reminders for every instalment; send a welcome message to the guardian
```
**Invariant checked in the same transaction:** `sum(instalment.amount) == invoice.net_minor`.

### 8.2 Mobile money payment — the aggregator path

```
Guardian taps the link in the WhatsApp reminder
  → GET /pay/:token           (public, no auth, rate-limited)
      resolve student + balance + suggested amount. Token is single-purpose and expiring.
  → POST /pay/:token/initiate { amountMinor, payerPhone, operator }
      Idempotency-Key header REQUIRED (client-generated UUID, replayed on retry)
      1. re-validate amount against the LIVE balance (the parent may have paid meanwhile)
      2. create payment(status=pending, provider_ref=null, idempotency_key)
      3. call PaymentProvider.initiate() → checkout URL / USSD push
      4. store provider_ref
      5. return the redirect
  → parent authorises on their phone (MoMo / Orange / Wave PIN prompt)

  ── the browser redirect is a HINT. It is never trusted. ──

  ── our `reference` is `fd:<tenantId>:<paymentId>` and the aggregator echoes it back.
     It is the ONLY way the worker can attribute a callback: `provider_event`
     carries no RLS (the tenant is unknown until the payload is parsed), and
     `payment` IS tenant-scoped, so looking the tenant up from provider_ref
     would already need the context we are trying to establish. ──

  → POST /webhooks/payments/:provider     (public, signature-verified)
      1. verify HMAC signature; reject and alert on failure
      2. INSERT INTO provider_event (unique on provider+event_id)
         → conflict means we already have it → 200 OK, stop. This is the idempotency guard.
      3. enqueue webhook-processor job, return 200 within ~200 ms
         (never do business work inside the webhook request)

  worker: webhook-processor
      1. SELECT ... FOR UPDATE on the payment
      2. state machine: pending → succeeded | failed | expired. Illegal transitions are logged
         and dropped, never applied.
      3. on success, in ONE transaction:
           payment.status = succeeded, received_at, provider_fee_minor
           allocate across instalments (oldest due first, or the pinned instalment)
           → payment_allocation rows
           → instalment.allocated_minor, status
           → student_ledger_entry(type=payment, signed, balance_after)
           → invoice.paid_minor / balance_minor recomputed
           → overpayment becomes a credit adjustment
           → CANCEL every scheduled reminder for the now-settled instalments
           → outbox: payment.succeeded
      4. commit
      5. from the outbox: render the receipt PDF → S3 → send it to the guardian on the
         channel they used
```

### 8.3 Cash payment at the desk

```
Cashier must have an OPEN cash_session, else the endpoint 409s.
POST /payments/cash { studentId, amountMinor, instalmentId?, payerName }
   Idempotency-Key REQUIRED — the cashier will double-tap on a slow connection
   one transaction: payment(method=cash, status=succeeded, cash_session_id)
                  + allocation + ledger entries + cash_movement + reminder cancellation
   → receipt number assigned GAPLESSLY from a per-tenant-per-year sequence
     (a dedicated counter row locked FOR UPDATE — a Postgres sequence has gaps on rollback,
      and gapless receipt numbering is an audit requirement)
   → print/share the receipt; optionally send it to the guardian
```

### 8.4 Closing the desk — the anti-leak control

```
POST /cash-sessions/:id/close { declaredMinor, note }
  expected = opening_float + Σ cash_movement(session)
  variance = declared − expected
  variance != 0  → variance_reason is REQUIRED, session status = flagged, director notified
  variance == 0  → status = closed
  the session becomes immutable; any later correction is a NEW movement in a NEW session,
  reason-coded and audited
```

### 8.5 Reminders — schedule, then decide at send time

```
Nightly (per tenant, at 02:00 tenant time) — reminder-scheduler
  for each unpaid instalment in the horizon, by EFFECTIVE due date
      (effective = moratorium.deferred_due_on when granted, else instalment.due_on):
    a granted moratoire still running:
        suppress every basis='due_date' rule (skip_reason = 'moratorium_granted')
        materialise the basis='moratorium_end' rules against deferred_due_on
    a PENDING request: change nothing — nothing has been promised yet
    otherwise: the ordinary ladder
    for each guardian with pays_fees = true:
      upsert reminder_schedule(instalment, rule, guardian)
        scheduled_for = anchor + offset_days, at the tenant's send hour, in TENANT TZ
      (unique constraint makes the whole job safely re-runnable)

  The scan filters on i.due_on WIDENED by the 21-day cap and re-filters on the
  effective date: COALESCE is not sargable, and a single COALESCE predicate
  gives up the (tenant_id, due_on, status) index and scans the whole table.

  Never materialise a moratorium_end row whose anchor is not strictly AFTER the
  day the moratoire was decided — for a one-week delay, deferred minus 7 days
  IS the original due date, and it would otherwise fire the day it was granted.

  A grant, refusal or cancellation re-runs the SAME function immediately. The
  sender runs every 15 minutes; waiting for 02:00 would chase a family all
  afternoon for a delay just agreed, and a refusal the day before a due date
  would send them nothing at all.

Every 15 min — message-sender picks up rows where scheduled_for <= now and status = scheduled
  AT SEND TIME, and only at send time, check:
    ✗ instalment already paid or waived      → skip (reason: settled)   ← the #1 trust bug
    ✗ due-date rung while a moratoire runs   → skip (moratorium_active)
    ✗ end-of-moratoire rung once it is over  → skip (moratorium_ended)
    ✗ guardian opted out / quarantined       → skip
    ✗ outside tenant quiet hours (default 07:00–20:00 tenant tz) → defer
    ✗ guardian already messaged N times today (default 2) → defer
    ✗ tenant daily message cap reached       → defer + warn the bursar
    ✗ message credit balance == 0            → skip + alert    (never send on credit)
  then, in ONE transaction:
    render the template (locale, variables, school signature)
    mint or reuse a moratorium_chat_link token when the template offers a delay
    write the message row + debit message_credit_ledger + flip the schedule to sent
  and only AFTER it commits:
    MessagingProvider.send() — WhatsApp first; on undeliverable, fall back to SMS
    store provider_message_id for delivery callbacks
    on failure: mark the message failed and REFUND the credit (a new row, not a reversal)

  The boundary is the design. Crash between the debit and the flip and the next
  tick re-sends and double-charges; call the provider first and a crash loses
  the charge and the audit. The residual risk is deliberate: a crash between
  COMMIT and the call means one missed reminder rather than two sent.
```

### 8.5b Le moratoire — a parent-requested delay

```
The J-14 reminder carries a link: https://<PUBLIC_PAY_URL>/moratoire/<token>
  token = <tenantId>.<32 random bytes>, scoped to ONE instalment and ONE guardian

GET  /moratoire/:token   -> school, student FIRST NAME only, amount owed, the offer
POST /moratoire/:token/request { durationDays, reason?, idempotencyKey }
  deferred_due_on = ORIGINAL due_on + N, N <= 21 — never measured from the request
    date, so asking late buys less time, never more, and a moratoire cannot
    become an indefinite snooze
  once per instalment (partial unique index on status IN ('pending','granted'))
  auto-granted or left pending for a bursar — THE SCHOOL CONFIGURES WHICH

Per-school policy in tenant.settings.moratorium: enabled, approval (auto|manual),
  allowedDurationsDays, offerFromDaysBeforeDue, lateGraceDays, refusalFreesSlot.
  MAX_MORATORIUM_DAYS = 21 is a CONSTANT, not a setting: a school may offer less,
  never more, not even by hand-editing the blob.
```
**Hard limits enforced in the sender, not the scheduler** — a scheduler bug must not be able to
bypass them.

### 8.6 Reconciliation — the safety net

```
Every 30 min — reconciler
  payments in (pending, processing) older than 15 min
    → PaymentProvider.getStatus(provider_ref)
    → apply the same state machine as the webhook processor (shared code path)
  payments pending > 2 h → expire, cancel, notify the bursar
  daily 03:00 — integrity sweep, per tenant:
    Σ payment_allocation(instalment)      == instalment.allocated_minor
    Σ instalment.amount                   == invoice.net_minor
    Σ ledger entries(student)             == invoice.balance_minor
    Σ cash_movement(closed session)       == session.expected_close_minor
    latest ledger balance_after           == computed running balance
  any mismatch → the tenant is flagged, an incident is opened, the director is NOT shown a
  number we cannot prove. Silence is worse than an honest "reconciling".
```

## 9. Provider ports

No provider name appears in `packages/domain` or in any module service. Ever.

```ts
// packages/providers/payment/port.ts
export interface PaymentProvider {
  readonly name: string
  readonly supportedMethods: PaymentMethod[]
  initiate(req: InitiatePaymentRequest): Promise<InitiatePaymentResult>
  getStatus(providerRef: string): Promise<ProviderPaymentStatus>
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification
  parseWebhook(payload: unknown): NormalizedPaymentEvent
  refund(providerRef: string, amount: Money, reason: string): Promise<RefundResult>
}

// packages/providers/messaging/port.ts
export interface MessagingProvider {
  readonly name: string
  readonly channels: readonly ('whatsapp' | 'sms')[]
  send(msg: OutboundMessage): Promise<SendResult>       // must accept an idempotencyKey
  parseStatusWebhook(payload: unknown): readonly NormalizedMessageStatusEvent[]
  estimateCost(msg: OutboundMessage): Money
}
```

`channels` is a list, not the singular `channel` this section first sketched:
the console and fake adapters genuinely serve both rails, and the sender picks
an adapter per channel, so the plural is the honest shape.

`estimateCost` is not a nicety. The sender debits the prepaid wallet in the
same transaction as the `message` row, and it cannot debit an amount it does
not yet know — so the estimate must be exact, including the segment count for
an SMS body that forces UCS-2.

**Adapters, v1**
- Payment: **CinetPay** (primary — MTN, Orange, Moov, Wave, card across Cameroon, CIV,
  Senegal, Burkina, Mali, Togo, Benin), **Flutterwave** (secondary — anglophone reach),
  `ManualProvider` (cash/transfer, no network), `FakeProvider` (deterministic, for tests).
- Messaging: **WhatsApp Cloud API** (Meta, direct — cheapest and richest),
  an **SMS aggregator** (Africa's Talking / a local one per country),
  `ConsoleProvider` (dev), `FakeProvider` (tests).

**Adapter rules**
- Every adapter is fully exercised by contract tests written against the *port*, so a new
  provider is proven by making the same suite pass.
- Adapters never write to the database. They translate, call, and return normalised results.
- Every outbound call has a timeout (10 s), a retry policy (3, exponential + jitter, only on
  5xx/network), and a circuit breaker.
- Provider credentials come from env only, are never logged, and are validated at boot.
- **Webhook endpoints are public and therefore hostile territory**: verify the signature before
  parsing, use a raw-body parser, enforce a timestamp window against replay, rate-limit by IP,
  and store the raw event before doing anything with it.

## 10. Security

**Tenant isolation** — Postgres RLS as described in §4. The application `where` clause is a
convenience; the policy is the guarantee. The API database role must not have `BYPASSRLS`.

**Authentication** — argon2id (memory 64 MB, iterations 3). Access JWT 15 min, refresh 30 d,
rotated on every use with **reuse detection**: a replayed refresh token revokes the whole token
family and alerts. TOTP 2FA mandatory for Director and Bursar, optional elsewhere. Account
lockout after 5 failures, exponential backoff, unlock by the director or by email.

**Authorisation** — RBAC + explicit permission checks, deny by default.

| Capability | Director | Bursar | Cashier | Secretary | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| View dashboard & reports | ✅ | ✅ | ✖ | ✖ | ✅ (read) |
| Enrol / edit students | ✅ | ✅ | ✖ | ✅ | ✖ |
| Publish a fee schedule | ✅ | ✅ | ✖ | ✖ | ✖ |
| Grant a discount / scholarship | ✅ | ⚠ needs approval | ✖ | ✖ | ✖ |
| Take a cash payment | ✅ | ✅ | ✅ | ✖ | ✖ |
| Close a cash session | ✅ | ✅ | ✅ (own only) | ✖ | ✖ |
| Reconcile a flagged session | ✅ | ✖ | ✖ | ✖ | ✖ |
| Refund / reverse a payment | ⚠ dual approval | ⚠ requests | ✖ | ✖ | ✖ |
| Send a manual reminder | ✅ | ✅ | ✖ | ✅ | ✖ |
| Change reminder rules / templates | ✅ | ✅ | ✖ | ✖ | ✖ |
| Manage users & roles | ✅ | ✖ | ✖ | ✖ | ✖ |
| Export all data | ✅ | ✅ | ✖ | ✖ | ✅ |
| View the audit log | ✅ | ✅ (own tenant) | ✖ | ✖ | ✅ |

**Four-eyes controls** — refunds, reversals, discounts above a tenant-set threshold, and cash
variance reconciliation all require a second, different user. Enforced in the service layer with
an `approval` record, not in the UI.

**Audit** — an interceptor writes an `audit_log` row for every mutating request: actor, role,
action, entity, before/after diff, IP, user agent, request id. The table has `INSERT` and
`SELECT` grants only; no `UPDATE`, no `DELETE`, for any application role. Retention 7 years.

**Data protection** — TLS 1.3 everywhere, HSTS. At rest: managed Postgres encryption plus
application-level AES-256-GCM on TOTP secrets and provider credentials. Student photos in
private S3 buckets reached only by short-lived signed URLs. PII (phone, name, matricule)
redacted from logs by a Pino serialiser — enforced by a test that greps a log fixture for
a known phone number.

**Input & transport** — Zod validation at every boundary, `helmet`, a strict CORS allowlist,
a 1 MB body cap, `express-rate-limit` on Redis (auth 5/min/IP, payment initiation 10/min/token,
public payment page 60/min/IP), and parameterised queries only.

**Payment link tokens** — 32 random bytes, base64url, single student, expiring (default 30 days),
revoked on payment, rate-limited, and carrying **no** PII in the URL. The page shows a first
name and a masked matricule, never a full identity.

**Secrets** — env only, loaded and validated by `packages/config` at boot, fail-fast if a
required var is missing. `.env` is git-ignored; `.env.example` is committed with placeholders.
No secret ever reaches a log, an error message, or a Sentry payload.

**Compliance posture** — Fineduc is **not** a payment institution: funds settle from the
aggregator directly to the school's own account and never touch a Fineduc account. GDPR-shaped
data handling as the baseline (it is stricter than most local regimes and travels well):
purpose limitation, a documented retention schedule, export and erasure on request, and a
DPA with the school. Guardians' phone numbers are processed on the school's legitimate interest
in collecting fees, and opt-out is always honoured for marketing-shaped messages while
transactional receipts remain.

## 11. Background jobs

| Queue | Trigger | Concurrency | Retries | Notes |
|---|---|---|---|---|
| `webhook-processor` | on webhook receipt | 10 | 5, exp backoff | Idempotent by `provider_event.event_id`. DLQ alerts immediately. |
| `reminder-scheduler` | cron, 02:00 tenant tz | 1 per tenant | 3 | Idempotent via the unique constraint; safe to re-run any time. |
| `message-sender` | cron, every 15 min | 5 | 3 | All the safety checks live here. |
| `message-status` | on delivery webhook | 10 | 3 | Updates delivery/read state, drives fallback and quarantine. |
| `reconciler` | cron, every 30 min | 1 | 3 | Re-queries non-final payments. Shares the webhook state machine. |
| `integrity-sweep` | cron, 03:00 daily | 1 | 1 | The invariant checks in §8.6. Pages on mismatch. |
| `receipt-renderer` | outbox event | 5 | 5 | PDF → S3 → deliver. |
| `exporter` | on request | 2 | 2 | Large Excel/PDF exports, delivered as a signed URL. |
| `director-digest` | cron, 07:00 tenant tz | 1 per tenant | 2 | The daily WhatsApp summary — the habit-forming feature. |
| `outbox-publisher` | every 5 s | 1 | ∞ | Polls the outbox, publishes to queues, marks published. |

Every job payload carries `tenantId`, `requestId` and `attempt`. Every job sets
`app.tenant_id` before touching the database. A job that cannot resolve a tenant fails loudly.

## 12. API surface

REST, `/api/v1`, JSON, Bearer JWT, OpenAPI-documented.

```
POST   /auth/login | /auth/refresh | /auth/logout | /auth/2fa/{enroll,verify}
GET    /me

GET    /students | POST /students | GET,PATCH /students/:id
GET    /students/:id/ledger            ← the student file: charges, payments, balance
GET    /students/:id/statement.pdf
POST   /students/:id/guardians | DELETE /students/:id/guardians/:gid

POST   /enrollments | POST /enrollments/:id/withdraw | POST /enrollments/bulk-promote

GET,POST /fee-schedules | POST /fee-schedules/:id/publish
GET,POST /instalment-plans

GET    /invoices/:id | GET /invoices/:id/instalments
POST   /invoices/:id/discounts | POST /invoices/:id/adjustments

POST   /payments/cash                 ← Idempotency-Key required
POST   /payments/manual               ← transfer / cheque
GET    /payments | GET /payments/:id
POST   /payments/:id/refund           ← dual approval
GET    /payments/:id/receipt.pdf | POST /payments/:id/receipt/send

POST   /payment-links | GET /payment-links/:id
GET    /pay/:token                    ← PUBLIC, no auth
POST   /pay/:token/initiate           ← PUBLIC, Idempotency-Key required
POST   /webhooks/payments/:provider   ← PUBLIC, signature-verified
POST   /webhooks/messages/:provider   ← PUBLIC, signature-verified

POST   /cash-sessions | POST /cash-sessions/:id/close | POST /cash-sessions/:id/reconcile
GET    /cash-sessions/:id/report.pdf

GET,POST,PATCH /reminder-rules
GET,POST,PATCH /message-templates
POST   /reminders/send                ← manual: one guardian, a class, or a debtor filter
GET    /messages                      ← the delivery log
GET    /message-credits | POST /message-credits/topup

GET    /dashboard/overview            ← the director screen, one call
GET    /dashboard/arrears?groupBy=class|age|amount
GET    /dashboard/collections?from&to&granularity
GET    /dashboard/cash-status
GET    /reports/:type/export?format=xlsx|pdf

GET    /audit-log
GET,PATCH /settings | GET,POST /users | PATCH /users/:id/role
GET    /health | /health/ready | /health/providers
```

**Conventions.** Cursor pagination (`?cursor&limit`, max 100). Errors are RFC 9457
`application/problem+json` with a stable `type`, a `traceId` and, on validation failures, a
field map. `Idempotency-Key` is mandatory on every money-moving POST and honoured for 24 h.
Money crosses the wire as `{ "amountMinor": "45000", "currency": "XAF" }` — a **string** for the
integer, so no JavaScript client can silently lose precision. Timestamps are ISO 8601 UTC;
**due dates are plain `YYYY-MM-DD`** and must never be turned into a timestamp.

## 13. Dashboard

Next.js 15 App Router, server components for shell and static data, TanStack Query for live
data, Tailwind + shadcn/ui, Recharts. Design tokens shared with the landing page via
`packages/ui`.

**Mobile-first is a hard requirement, not a nice-to-have.** The director's primary device is a
phone. Build every screen at 360 px first and let it grow.

- **Director home** — collected today vs expected, recovery-rate gauge, arrears by class,
  cash-desk status, method mix, a 30-day collection sparkline. One API call, cached 30 s,
  auto-refresh 60 s.
- **Students** — searchable list (name, matricule, phone), filters (class, status, balance),
  and the **student file**: identity, guardians, instalments with a status timeline, full
  ledger, message history, one-tap "send a reminder" and "record a payment".
- **Arrears** — the bursar's work queue. Filter, sort by amount or age, multi-select, bulk
  remind, export.
- **Cash desk** — open/close, live session total, movement list, close-with-count flow with the
  variance shown before confirmation.
- **Payments** — searchable, filterable, reconciliation status visible; a payment stuck in
  `pending` must be obvious and actionable.
- **Fees** — schedule builder, instalment-plan editor with a live preview of the dates and
  amounts a student will actually get.
- **Reminders** — rule ladder editor, template editor with a live preview and variable
  validation, delivery log, credit balance and burn rate.
- **Admin** — users and roles, sites, academic years, settings, audit log.

**Accessibility and reality:** WCAG 2.1 AA, works at 200% zoom, every state (loading, empty,
error, offline) designed. Optimistic UI is **banned** on money operations — the cashier must see
the server's truth, not a hopeful local one.

## 14. Environments and deployment

| Env | Purpose | Data | Providers |
|---|---|---|---|
| `local` | Docker Compose: Postgres, Redis, MailHog | seeded fake school | Fake/Console adapters |
| `staging` | pre-production, full pipeline | anonymised | provider sandboxes |
| `production` | live schools | real | live credentials |

**CI (GitHub Actions):** typecheck → lint (incl. boundary rules) → unit → integration
(Testcontainers Postgres) → migration check (up, then down, then up again on a copy of the
staging schema) → build. A PR cannot merge red.

**CD:** staging on merge to `main`, production on a tagged release with a manual gate.
Migrations run as a separate step **before** the new code is released, and every migration must
be backward-compatible with the currently-running version (expand → migrate → contract).

**Backups:** managed Postgres PITR, 30-day retention, plus a nightly logical dump to a
different provider. **A restore is rehearsed monthly and the runbook lives in `docs/runbooks/`.**
An unrehearsed backup is not a backup.

**Observability:** Sentry for errors, OpenTelemetry traces (request → job → provider call, one
trace), Pino JSON logs with `tenant_id` and `request_id` on every line.
Alert, with a human on the other end, on: webhook DLQ depth > 0 · reconciliation mismatch ·
message send failure rate > 5% · a tenant's message credits at zero · a cash session open
> 14 h · p95 latency > 1 s · any 5xx on a payment path.

## 15. Build order

Strictly backend-first. Nothing in a later phase starts before the phase above it is tested.

1. **Foundation** — monorepo, config, `money`, Prisma schema, migrations, RLS policies and the
   cross-tenant isolation test, seed script, health endpoints.
2. **Identity & tenancy** — auth, 2FA, RBAC, memberships, tenant context interceptor, audit
   interceptor.
3. **Academics & students** — years, classes, students, guardians, enrolment.
4. **Billing** — fee schedules, instalment plans, invoice + instalment generation, discounts,
   the student ledger. *This is the hardest and most important module. Over-test it.*
5. **Payments — cash first.** Cash sessions, cash payments, allocation, receipts, closing and
   variance. A school is usable at this point with zero external providers.
6. **Payments — mobile money.** The `PaymentProvider` port, the CinetPay adapter, payment links,
   the public pay page, webhooks, the reconciler.
7. **Messaging.** The `MessagingProvider` port, templates, reminder rules, the scheduler, the
   sender with every safety check, the credit wallet, delivery tracking.
8. **Analytics.** Dashboard projections and exports.
9. **Dashboard UI.** Director home → students → arrears → cash → fees → reminders → admin.
10. **Landing page.** Framer-styled marketing site.

## 16. Hard questions

*Technical answers to the questions in [PRD.md §9](PRD.md#9-hard-questions).*

### What will break?

- **Balance projections drifting from the ledger.** `invoice.paid_minor` is a cache; caches go
  stale. → It is only ever written inside the same transaction as the ledger entry, and the
  nightly integrity sweep recomputes and compares. A mismatch is an incident, not a warning.
- **Concurrent payments on the same instalment.** Two cashiers, or a cashier and a webhook, at
  the same moment. → `SELECT ... FOR UPDATE` on the invoice row before any allocation. All
  allocation flows through **one** service method. There is no second code path.
- **Webhook floods and replays.** → `provider_event` unique on `(provider, event_id)`; the
  endpoint stores raw and returns 200 in under ~200 ms; all work is queued.
- **Connection-pool tenant leakage.** The single worst possible bug in this system. → `set local`
  inside a transaction, never `set`; the API role lacks `BYPASSRLS`; an automated cross-tenant
  test runs on every PR.
- **Receipt-number gaps.** A Postgres sequence increments outside the transaction, so a rollback
  leaves a hole — and an auditor reads a hole as a deleted receipt. → A dedicated counter row per
  tenant per year, locked `FOR UPDATE`, incremented inside the transaction.
- **Timezone bugs on due dates.** → `due_on` is a `DATE`, resolved and compared in tenant time.
  A lint rule bans `new Date()` in `packages/domain`; a clock is injected.
- **`bigint` serialising to JSON.** `JSON.stringify(1n)` throws; `Number(bigint)` loses precision
  above 2^53. → Money crosses the wire as a string, enforced by the Zod contract.
- **A stuck queue nobody notices.** → DLQ depth is alerted, not merely dashboarded.
- **The aggregator changing its webhook payload without notice.** → Store raw, parse
  defensively, and treat a parse failure as a retryable job with a page, so an event is never
  silently dropped.
- **Prisma's connection pool versus RLS.** Prisma reuses connections aggressively. → Interactive
  transactions for every tenant-scoped request, and an integration test that hammers concurrent
  requests from two tenants and asserts zero bleed.

### What edge cases are we missing?

Payment arriving after the academic year closed (accept it, post to the closed year with a
reopen-audit entry, never silently drop) · guardian paying more than the total balance
(overpayment → credit, surfaced, refundable) · a student withdrawing with a credit
(refund flow, dual approval) · a fee schedule edited after invoices exist (blocked — publish a
new version and post adjustments) · two guardians paying the same instalment simultaneously
(row lock; the second becomes an overpayment/credit) · a webhook arriving for a payment we
never created (log, alert, do **not** auto-create) · a guardian's phone number reassigned by the
telco to a stranger (quarantine on bounces, re-verify) · a cashier deleted while holding an open
session (block user deactivation while a session is open) · clock skew on the aggregator's
timestamps (tolerate a window, do not reject) · a tenant changing timezone mid-year (freeze
already-scheduled reminders, reschedule the rest) · daylight saving (none in our target
countries, but the code must not assume it) · a leap-year due date on 29 February · an
instalment amount of zero (a full scholarship — must not generate a reminder) · a student in two
schools of the same group (two tenants or two enrolments — decided as: two enrolments, one
tenant, per-site).

### What is over-engineered?

Cut, on purpose: **CQRS with separate read models** (Postgres views and good indexes are enough
at a few hundred schools) · **an event-sourcing framework** (append-only money tables plus an
outbox give us the audit trail without the machinery) · **Kubernetes** (two containers and a
managed Postgres) · **a plugin architecture for providers** (two interfaces and a factory) ·
**a generic rules engine for reminders** (offset + channel + template covers every school we
have met) · **GraphQL** (REST is fine and cacheable) · **a service mesh, feature-flag SaaS, or a
data warehouse** (a boolean in `tenant.settings`; SQL on the primary; revisit at 100 schools) ·
**offline-first sync in the dashboard** (huge complexity, and a wrong offline balance is worse
than a spinner — a small, explicitly-queued offline cash mode is v1.1 at the earliest) ·
**building our own PDF layout engine** · **supporting more than one currency per tenant.**
