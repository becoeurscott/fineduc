-- Add admin-managed columns to signup_request
ALTER TABLE "signup_request"
  ADD COLUMN "status"           text NOT NULL DEFAULT 'pending',
  ADD COLUMN "setup_token"      text,
  ADD COLUMN "temp_identifier"  text,
  ADD COLUMN "rejection_reason" text;

CREATE UNIQUE INDEX "signup_request_setup_token_key" ON "signup_request" ("setup_token");

-- Grant the app role access to the new columns
GRANT SELECT, INSERT, UPDATE ON "signup_request" TO fineduc_app;
