-- Tables that RLS denies completely, because they have no policy.
--
-- A table with RLS ENABLED and no policy denies every row unconditionally,
-- including for fineduc_app. Production hit this on "user": a school opened a
-- valid setup link, submitted the form, and Postgres answered
--
--   42501: new row violates row-level security policy for table "user"
--
-- which the API returned as a bare 500 "unexpected error". No school could
-- finish signing up. The same fault was already found and fixed once, for
-- signup_request and verification_code (20260825020000) — this is the rest of
-- it.
--
-- The policy loop in 20260818193836 lists tables explicitly, so anything added
-- later, and anything without a tenant_id, was simply never given one.
--
-- ## This migration only CREATES POLICIES. It never enables or disables RLS.
--
-- Deliberate. A policy on a table whose RLS is off is inert; the same policy
-- on a table whose RLS is on is the fix. So this repairs production wherever
-- RLS was turned on outside version control — which is how "user" got into
-- this state — and changes nothing anywhere else. Enabling RLS here instead
-- could break a table that works today, which is the opposite of the point.

-- ----------------------------------------------------------------------------
-- Pre-tenant tables: no tenant_id, and none is possible.
--
-- Login has to find a user by e-mail BEFORE any tenant is known, and a refresh
-- token is presented before a tenant context exists. Scoping these by
-- app.tenant_id would deny the very lookups that establish it. Same reasoning
-- as signup_request and verification_code.
--
-- Isolation for these is enforced in application code, not by RLS: the row a
-- session may read is decided by the token it presents.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS user_app_access ON "user";
CREATE POLICY user_app_access ON "user"
  FOR ALL TO fineduc_app
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS refresh_token_app_access ON "refresh_token";
CREATE POLICY refresh_token_app_access ON "refresh_token"
  FOR ALL TO fineduc_app
  USING (true)
  WITH CHECK (true);

-- Webhook de-duplication, keyed on (provider, event_id). It is written by the
-- webhook path before any tenant is resolved — that is the whole point of
-- storing the raw event first — so it cannot be tenant-scoped either.
DROP POLICY IF EXISTS provider_event_app_access ON "provider_event";
CREATE POLICY provider_event_app_access ON "provider_event"
  FOR ALL TO fineduc_app
  USING (true)
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- Tenant-scoped tables the loop missed.
--
-- Both arrived in 20260821021252, after the policy loop was written, and the
-- loop names its tables explicitly rather than discovering them. They carry a
-- tenant_id, so they get the ordinary isolation policy — identical in shape to
-- every other tenant table.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS moratorium_tenant_isolation ON "moratorium";
CREATE POLICY moratorium_tenant_isolation ON "moratorium"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS moratorium_chat_link_tenant_isolation ON "moratorium_chat_link";
CREATE POLICY moratorium_chat_link_tenant_isolation ON "moratorium_chat_link"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- outbox_event is deliberately NOT given one. Its tenant_id is nullable by
-- design — the publisher reads rows across tenants — and 20260818193836 says
-- so explicitly. A tenant_id policy there would deny every platform-level row.
