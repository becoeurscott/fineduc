-- A school's own aggregator account.
--
-- Fineduc never holds a parent's money: the funds go from the aggregator
-- straight to the school's bank account, which is only true if the school
-- collects with its own credentials. One platform key set for every school
-- would route every payment into Fineduc's account instead.

CREATE TABLE "payment_connection" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          UUID NOT NULL REFERENCES "tenant"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "provider"           TEXT NOT NULL,
  -- AES-256-GCM under ENCRYPTION_KEY, stored as iv:authTag:ciphertext.
  "credentials_sealed" TEXT NOT NULL,
  -- '<tenantId>.<secret>' — the callback URL the school pastes into its
  -- aggregator dashboard. Unique because it is looked up by itself.
  "webhook_token"      TEXT NOT NULL UNIQUE,
  "is_active"          BOOLEAN NOT NULL DEFAULT true,
  "last_verified_at"   TIMESTAMPTZ(6),
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(6) NOT NULL
);

-- One account per aggregator per school: two would make a callback ambiguous,
-- with no way to know which keys signed it.
CREATE UNIQUE INDEX "payment_connection_tenant_id_provider_key"
  ON "payment_connection" ("tenant_id", "provider");
CREATE INDEX "payment_connection_tenant_id_idx"
  ON "payment_connection" ("tenant_id");

-- Tenant-scoped like every other tenant table. The webhook resolves the
-- tenant from the token in its own URL and opens a context BEFORE reading
-- the row, which is the same thing the pay link does with its token.
ALTER TABLE "payment_connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_connection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_connection_tenant_isolation ON "payment_connection";
CREATE POLICY payment_connection_tenant_isolation ON "payment_connection"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
