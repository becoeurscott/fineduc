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
