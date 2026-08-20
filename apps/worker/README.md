# Worker

The same monolith as `apps/api`, in a different process (ARCHITECTURE.md §3).

It shares the application layer through `@fineduc/services` rather than
importing the API — apps may never import each other — and runs no web
framework.

```bash
pnpm --filter @fineduc/worker build
pnpm --filter @fineduc/worker start
```

Needs the same `DATABASE_URL` and `REDIS_URL` as the API. It connects as the
least-privilege `fineduc_app` role and sets `app.tenant_id` on every job, like
every other database caller.

## Tests

```bash
pnpm --filter @fineduc/worker test
```

Needs the dev stack up. Runs against the compiled `dist`, like `apps/api`,
and builds `apps/api` too — the fixture raises an invoice through its
`InvoicingService`. That is a **test-only** reach across the app boundary;
`src/` imports nothing from another app, which the lint boundary enforces.

The regression these exist for: `processWebhookJob` once received an empty
tenant id and passed it to `withTenant`, which rejects a non-uuid — so no
webhook could settle. Every service it called was well tested; the WIRING was
not, because it was welded to a BullMQ `Worker` and nothing could reach it.
The handler is now a plain function, and the queue wrapper is deliberately
thin enough to have nothing worth testing in it.

## Queues

Definitions live in `src/queues/index.ts`, with the concurrency and retry
values from ARCHITECTURE.md §11 in one place because they are load-bearing.

| Queue | State |
| --- | --- |
| `webhook-processor` | **live** — settles a mobile-money payment |
| `reminder-scheduler` · `message-sender` · `message-status` | phase 7 |
| `reconciler` · `integrity-sweep` | phase 6/8 |
| `receipt-renderer` · `exporter` · `director-digest` | later |
| `outbox-publisher` | later |

Only `webhook-processor` is wired. An unwired queue is honest; a stubbed job
that silently succeeds looks like the work is done.
