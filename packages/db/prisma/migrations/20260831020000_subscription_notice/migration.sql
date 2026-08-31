-- One row per expiry notice actually sent to a school.
--
-- This table exists for IDEMPOTENCY, not for reporting. The expiry job runs
-- daily and is retried up to three times on failure, so without a uniqueness
-- constraint a school would be texted repeatedly about the same deadline —
-- and a director messaged every morning stops reading the one notice that
-- matters.
--
-- The key is (tenant, period_end, days_remaining), which is the DEADLINE
-- rather than the day the job happened to run. A retry, a re-run, or a
-- catch-up after an outage therefore all recognise a notice as already sent.
-- `days_remaining` is part of the key because 7, 3 and 1 are three distinct
-- notices about the same period, and 0 is the lapse itself.

CREATE TABLE "subscription_notice" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID NOT NULL REFERENCES "tenant"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "period_end"     DATE NOT NULL,
  "days_remaining" INTEGER NOT NULL,
  -- 'sms', or 'none' when the school had no reachable phone. Recorded either
  -- way, so a school nobody could reach is visible in the data rather than
  -- indistinguishable from one that was successfully warned.
  "channel"        TEXT NOT NULL,
  "to_phone_e164"  TEXT,
  "sent_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "subscription_notice_tenant_id_period_end_days_remaining_key"
  ON "subscription_notice" ("tenant_id", "period_end", "days_remaining");
CREATE INDEX "subscription_notice_tenant_id_idx"
  ON "subscription_notice" ("tenant_id");

ALTER TABLE "subscription_notice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_notice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_notice_tenant_isolation ON "subscription_notice";
CREATE POLICY subscription_notice_tenant_isolation ON "subscription_notice"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
