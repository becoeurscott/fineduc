-- Credentials an admin hands to a school after approving its request.
--
-- The code is stored ONLY as an argon2 hash: it is a password, and a
-- platform admin being able to read back a school's password is exactly the
-- property we do not want. It is returned in plaintext once, at approval,
-- and can be reissued if it is lost.

ALTER TABLE "signup_request"
  ADD COLUMN "temp_email"     text,
  ADD COLUMN "temp_code_hash" text,
  ADD COLUMN "approved_at"    TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "signup_request_temp_email_key" ON "signup_request" ("temp_email");
CREATE UNIQUE INDEX "signup_request_temp_identifier_key" ON "signup_request" ("temp_identifier");

-- Sequential school references (FIN-2026-0001). A sequence rather than a
-- locked counter row because gaps are harmless here — unlike receipt
-- numbers, where a gap reads to an auditor as a deleted receipt.
CREATE SEQUENCE IF NOT EXISTS signup_identifier_seq START 1;
GRANT USAGE, SELECT ON SEQUENCE signup_identifier_seq TO fineduc_app;
