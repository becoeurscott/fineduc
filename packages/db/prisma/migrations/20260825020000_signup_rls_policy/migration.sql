-- signup_request and verification_code are pre-tenant tables (no tenant_id
-- column) — RLS was enabled on them with no policies, which denies every
-- row unconditionally, including for the fineduc_app role. Add explicit
-- policies allowing the app role full access; there is no tenant to scope
-- by at this stage of the flow.

ALTER TABLE "signup_request" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signup_request_app_access ON "signup_request";
CREATE POLICY signup_request_app_access ON "signup_request"
  FOR ALL TO fineduc_app
  USING (true)
  WITH CHECK (true);

ALTER TABLE "verification_code" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS verification_code_app_access ON "verification_code";
CREATE POLICY verification_code_app_access ON "verification_code"
  FOR ALL TO fineduc_app
  USING (true)
  WITH CHECK (true);
