# Infra

## Local development

```bash
docker compose -f infra/docker-compose.yml up -d
```

Starts Postgres 16 (`localhost:5432`, user/db `fineduc`/`fineduc`), Redis 7
(`localhost:6379`), a MinIO S3-compatible store (`localhost:9000`, console
on `9001`), and MailHog (`localhost:8025`) for staff-facing email.

Then, from the repo root:

```bash
cp .env.example .env          # fill in DATABASE_URL/REDIS_URL if you changed the defaults
pnpm db:migrate:deploy         # applies every migration, including RLS (packages/db/prisma/migrations)
pnpm db:seed                   # one fake school — packages/db/src/seed.ts
```

The RLS migration creates a `fineduc_app` Postgres role with a **local-dev-
only** password (`fineduc_app_dev_only`, NOBYPASSRLS). The API and worker
connect as this role, never as the `fineduc` bootstrap/owner role — see
`packages/db/prisma/migrations/*_row_level_security_and_invariants/migration.sql`
for why that distinction is load-bearing.

## Deployment

Not yet configured. Target shape (ARCHITECTURE.md §14): API + worker on
Railway or Fly.io (Paris/Frankfurt region, for latency to West/Central
Africa), managed Postgres with point-in-time recovery, web/dashboard/pay on
Vercel.
