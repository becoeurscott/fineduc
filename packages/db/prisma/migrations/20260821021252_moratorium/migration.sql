-- Le moratoire — a parent-requested delay on ONE instalment
-- (ARCHITECTURE.md §8.5, AGENTS.md rules #4 and #9).
--
-- Backward-compatible by construction, so it is safe to apply before the
-- code that uses it ships (AGENTS.md: expand, migrate, contract):
--   * two NEW tables nothing reads yet;
--   * `reminder_rule.basis` added with a DEFAULT, so every existing rule
--     keeps its exact current meaning and code deployed before this
--     migration simply does not select a column it has never heard of;
--   * three new indexes, no column dropped, no type changed.
--
-- The Prisma-generated half is above. Everything below is hand-written and
-- idempotent, in the style of 20260818193836: RLS policies, the two partial
-- indexes the DSL cannot express, and the grants.

-- CreateEnum
CREATE TYPE "reminder_basis" AS ENUM ('due_date', 'moratorium_end');

-- CreateEnum
CREATE TYPE "moratorium_status" AS ENUM ('pending', 'granted', 'refused', 'cancelled');

-- CreateEnum
CREATE TYPE "moratorium_source" AS ENUM ('chatbot', 'staff');

-- AlterTable
ALTER TABLE "reminder_rule" ADD COLUMN     "basis" "reminder_basis" NOT NULL DEFAULT 'due_date';

-- CreateTable
CREATE TABLE "moratorium" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "instalment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "guardian_id" UUID,
    "status" "moratorium_status" NOT NULL DEFAULT 'pending',
    "source" "moratorium_source" NOT NULL,
    "requested_days" INTEGER NOT NULL,
    "original_due_on" DATE NOT NULL,
    "deferred_due_on" DATE NOT NULL,
    "reason" TEXT,
    "idempotency_key" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "moratorium_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moratorium_chat_link" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "instalment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moratorium_chat_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moratorium_tenant_id_idx" ON "moratorium"("tenant_id");

-- CreateIndex
CREATE INDEX "moratorium_tenant_id_status_idx" ON "moratorium"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "moratorium_tenant_id_idempotency_key_key" ON "moratorium"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "moratorium_chat_link_token_key" ON "moratorium_chat_link"("token");

-- CreateIndex
CREATE INDEX "moratorium_chat_link_tenant_id_idx" ON "moratorium_chat_link"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "moratorium_chat_link_tenant_id_instalment_id_guardian_id_key" ON "moratorium_chat_link"("tenant_id", "instalment_id", "guardian_id");

-- CreateIndex
CREATE INDEX "message_tenant_id_created_at_idx" ON "message"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "message_guardian_id_created_at_idx" ON "message"("guardian_id", "created_at");

-- CreateIndex
CREATE INDEX "message_credit_ledger_tenant_id_created_at_idx" ON "message_credit_ledger"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "moratorium" ADD CONSTRAINT "moratorium_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moratorium" ADD CONSTRAINT "moratorium_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "instalment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moratorium" ADD CONSTRAINT "moratorium_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moratorium" ADD CONSTRAINT "moratorium_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moratorium_chat_link" ADD CONSTRAINT "moratorium_chat_link_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moratorium_chat_link" ADD CONSTRAINT "moratorium_chat_link_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "instalment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moratorium_chat_link" ADD CONSTRAINT "moratorium_chat_link_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moratorium_chat_link" ADD CONSTRAINT "moratorium_chat_link_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- HAND-WRITTEN: grants, RLS, and the invariants Prisma's DSL cannot express
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. GRANTS
-- ----------------------------------------------------------------------------
-- The 20260818193836 migration revoked DELETE on ALL TABLES — but that
-- applied to the tables existing AT THAT MOMENT, and its
-- `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE`
-- hands DELETE to fineduc_app on every table created afterwards. So a new
-- table is born DELETE-able and has to be revoked explicitly. Miss this and
-- the append-never-delete posture quietly stops applying to new tables.
--
-- UPDATE is deliberately KEPT. A moratorium is a scheduling fact, not a
-- money row: rule #2 is about payments and ledger entries. It moves no
-- francs, allocates nothing, writes no ledger row, and never rewrites
-- instalment.due_on. Its closest analogue here is reminder_schedule, which
-- the settlement path already updates. Two transitions in a row's whole
-- life do not justify an event-sourced history table when audit_log plus
-- decided_at/decided_by/decision_note already record who did what.
REVOKE DELETE ON moratorium FROM fineduc_app;
REVOKE DELETE ON moratorium_chat_link FROM fineduc_app;

-- ----------------------------------------------------------------------------
-- 2. ROW-LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Fail-closed, same NULLIF-before-::uuid shape as every other policy — see
-- the long comment in 20260818193836 for why the empty string matters on a
-- pooled connection.
--
-- This matters more than usual for these two tables. `GET /moratoire/:token`
-- is PUBLIC and has no JWT, so the tenant comes out of the token itself. The
-- day someone "simplifies" that into a findUnique({ where: { token } })
-- outside withTenant(), this policy is what makes it return nothing instead
-- of every school's links.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['moratorium', 'moratorium_chat_link']
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

-- ----------------------------------------------------------------------------
-- 3. PARTIAL INDEXES — business invariants the Prisma DSL cannot express
-- ----------------------------------------------------------------------------
-- ONE open moratoire per instalment. This is "a parent can take a moratoire
-- only once per instalment" enforced by the database rather than by a
-- read-then-write that two concurrent requests would both pass.
--
-- PARTIAL, on (pending, granted), because whether a REFUSAL burns the
-- family's one attempt is the school's setting (`refusalFreesSlot`) and not
-- ours. The permissive shape lives in SQL; the stricter one is applied by
-- the service, which rejects a request when a refused row exists and the
-- school has turned that setting off. Same style as
-- cash_session_one_open_per_desk.
CREATE UNIQUE INDEX IF NOT EXISTS moratorium_one_open_per_instalment
  ON moratorium (tenant_id, instalment_id)
  WHERE status IN ('pending', 'granted');

-- The reminder-scheduler's scan for moratoires whose end is approaching,
-- and the join that suppresses the due-date ladder.
CREATE INDEX IF NOT EXISTS moratorium_active_by_end
  ON moratorium (tenant_id, deferred_due_on)
  WHERE status = 'granted';

-- Expired links are worth finding cheaply once a cleanup job exists.
CREATE INDEX IF NOT EXISTS moratorium_chat_link_expires_at
  ON moratorium_chat_link (expires_at)
  WHERE consumed_at IS NULL;
