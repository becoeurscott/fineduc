-- Verification codes for signup email/phone OTP
CREATE TABLE verification_code (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target     TEXT NOT NULL,
  channel    TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  used_at    TIMESTAMPTZ(6),
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_code_target_channel ON verification_code (target, channel);

-- Pending signup requests between step 1 and account creation
CREATE TABLE signup_request (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL,
  school_name     TEXT NOT NULL,
  contact_name    TEXT NOT NULL,
  role            TEXT NOT NULL,
  student_count   INTEGER,
  country         CHAR(2) NOT NULL,
  email_verified  BOOLEAN NOT NULL DEFAULT false,
  phone_verified  BOOLEAN NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ(6),
  expires_at      TIMESTAMPTZ(6) NOT NULL,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX idx_signup_request_email ON signup_request (email);
