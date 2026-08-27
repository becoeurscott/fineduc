-- Login has to answer "which tenants does this user belong to?" BEFORE any
-- tenant is known, so it cannot open a withTenant() context first. Under the
-- tenant-isolation policy alone that read returns nothing, and every sign-in
-- fails with NO_ACTIVE_MEMBERSHIP — staff and schools alike.
--
-- A second, SELECT-only policy keyed on app.user_id closes that gap without
-- widening tenant isolation: a session may read the membership rows of the one
-- user it names, and nothing else. Writes stay tenant-scoped through the
-- existing policy, and a query that sets neither variable still reads nothing.

CREATE POLICY membership_self_read ON membership
  FOR SELECT TO fineduc_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
