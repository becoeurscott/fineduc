-- Row-Level Security tenant isolation, the least-privilege app role, and the
-- two business invariants Prisma's schema DSL cannot express (partial
-- unique indexes). See ARCHITECTURE.md §4 and §6 "Indexes that matter",
-- and AGENTS.md rule #4.
--
-- Everything in this file is idempotent (IF NOT EXISTS / OR REPLACE-style
-- guards) so it is safe to re-run against a database that already has it.

-- ============================================================================
-- 1. THE APPLICATION ROLE
-- ============================================================================
-- A dedicated, least-privilege role for the API and worker processes.
-- Deliberately NOT a superuser and NOT the schema owner, and explicitly
-- NOBYPASSRLS — RLS silently does nothing for a role that owns the tables
-- or has BYPASSRLS, which would make every policy below a no-op.
--
-- Migrations run as a different, more privileged role (the one that owns
-- the schema and applied this file) — ARCHITECTURE.md §4.
--
-- The password below is a LOCAL-DEVELOPMENT DEFAULT ONLY. Production must
-- rotate it immediately after provisioning, via `ALTER ROLE fineduc_app
-- WITH PASSWORD '...'` issued from the secrets manager — NEVER by editing
-- this file, which is version-controlled and therefore public.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'fineduc_app') THEN
    CREATE ROLE fineduc_app LOGIN PASSWORD 'fineduc_app_dev_only' NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO fineduc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fineduc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fineduc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fineduc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fineduc_app;

-- ----------------------------------------------------------------------------
-- Money and audit tables are APPEND-ONLY at the application layer
-- (AGENTS.md rule #2, #10). Revoke DELETE everywhere as the default posture
-- — this business never hard-deletes a business record, everything is
-- soft-deleted via a status column — then revoke UPDATE too on the small
-- set of tables that must never even be corrected in place.
-- ----------------------------------------------------------------------------
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM fineduc_app;
-- Refresh-token cleanup is the one legitimate hard-delete: expired/revoked
-- tokens carry no money and no audit value once past their expiry.
GRANT DELETE ON refresh_token TO fineduc_app;

REVOKE UPDATE, DELETE ON audit_log FROM fineduc_app;              -- INSERT/SELECT only (ARCHITECTURE.md §10)
REVOKE UPDATE, DELETE ON student_ledger_entry FROM fineduc_app;   -- the ledger truth
REVOKE UPDATE, DELETE ON cash_movement FROM fineduc_app;
REVOKE UPDATE, DELETE ON payment_allocation FROM fineduc_app;
REVOKE UPDATE, DELETE ON message_credit_ledger FROM fineduc_app;
REVOKE UPDATE, DELETE ON receipt FROM fineduc_app;                 -- immutable; a correction is a new row elsewhere

-- ============================================================================
-- 2. ROW-LEVEL SECURITY
-- ============================================================================
-- Every policy below is fail-closed: `tenant_id = <the setting>` is never
-- true when the setting is absent, so a query that forgets to call
-- withTenant() sees zero rows rather than every tenant's rows.
--
-- The comparison is wrapped in NULLIF(..., '') before the ::uuid cast for a
-- real Postgres gotcha, verified against a live instance while building
-- this migration: `current_setting('app.tenant_id', true)` returns NULL
-- only the FIRST time a session touches this custom GUC. Once
-- set_config(..., true) has committed at least once on a pooled
-- connection — which happens constantly, since Prisma reuses connections
-- across requests — the value reverts to an EMPTY STRING, not NULL, once
-- the setting transaction ends. Casting '' directly to ::uuid throws a
-- hard "invalid input syntax" error instead of failing closed. NULLIF
-- normalises both "never set" and "reverted after a previous request" to
-- NULL, so every policy behaves identically regardless of connection
-- history.
--
-- NOT included, by design (see the model comments in schema.prisma):
--   - user, refresh_token   — global identity, not tenant data.
--   - provider_event        — tenant is unknown until the payload is parsed;
--                             processed by a trusted worker.
--   - outbox_event          — tenant_id is nullable; the outbox-publisher
--                             poller scans across all tenants at once.

-- `tenant` compares its own `id`, not a `tenant_id` column. A fresh tenant's
-- UUID is generated application-side (Prisma's @default(uuid()) runs in the
-- client, not the database) BEFORE the insert, so onboarding opens its
-- withTenant(newTenantId, ...) context first and the WITH CHECK below passes
-- normally — no privileged bypass role is needed for tenant creation.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant;
CREATE POLICY tenant_isolation ON tenant
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'site', 'membership', 'api_key',
    'academic_year', 'term', 'grade_level', 'class_group',
    'student', 'guardian', 'student_guardian', 'enrollment',
    'fee_schedule', 'fee_item', 'instalment_plan', 'instalment_template',
    'invoice', 'invoice_line', 'instalment', 'discount', 'adjustment',
    'student_ledger_entry',
    'payment', 'payment_allocation', 'payment_link', 'receipt', 'refund', 'receipt_counter',
    'cash_desk', 'cash_session', 'cash_movement',
    'message_template', 'reminder_rule', 'reminder_schedule', 'message', 'message_credit_ledger',
    'subscription', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid);',
      t || '_tenant_isolation', t
    );
  END LOOP;
END
$$;

-- ============================================================================
-- 3. PARTIAL UNIQUE INDEXES — business invariants Prisma's DSL can't express
-- ============================================================================
-- One `open` cash session per desk (ARCHITECTURE.md §8.4 — the anti-leak control).
CREATE UNIQUE INDEX IF NOT EXISTS cash_session_one_open_per_desk
  ON cash_session (cash_desk_id)
  WHERE status = 'open';

-- One `active` academic year per tenant (ARCHITECTURE.md §6).
CREATE UNIQUE INDEX IF NOT EXISTS academic_year_one_active_per_tenant
  ON academic_year (tenant_id)
  WHERE status = 'active';
