-- A charge toward the school's OWN subscription to Fineduc — not a parent's
-- fee. Kept separate from "payment", which requires a student and an
-- invoice and is money moving toward a SCHOOL's receivables. Mixing the two
-- would let a bug in one money path corrupt the other.

CREATE TABLE "subscription_payment" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            UUID NOT NULL REFERENCES "tenant"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "plan"                 "plan" NOT NULL,
  "billing_period"       "billing_period" NOT NULL,
  "amount_minor"         BIGINT NOT NULL,
  "currency"             CHAR(3) NOT NULL,
  "status"               "payment_status" NOT NULL DEFAULT 'pending',
  "provider"             TEXT NOT NULL,
  "provider_ref"         TEXT,
  "idempotency_key"      TEXT NOT NULL,
  "succeeded_at"         TIMESTAMPTZ(6),
  "raw_provider_payload" JSONB,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL
);

CREATE UNIQUE INDEX "subscription_payment_tenant_id_idempotency_key_key"
  ON "subscription_payment" ("tenant_id", "idempotency_key");
CREATE INDEX "subscription_payment_tenant_id_idx"
  ON "subscription_payment" ("tenant_id");

ALTER TABLE "subscription_payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_payment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_payment_tenant_isolation ON "subscription_payment";
CREATE POLICY subscription_payment_tenant_isolation ON "subscription_payment"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
