-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('trial', 'active', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "plan" AS ENUM ('essentiel', 'croissance', 'institution');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('invited', 'active', 'suspended', 'locked');

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('director', 'bursar', 'cashier', 'secretary', 'auditor');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('invited', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "academic_year_status" AS ENUM ('draft', 'active', 'closed');

-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('enrolled', 'left', 'graduated', 'suspended');

-- CreateEnum
CREATE TYPE "preferred_channel" AS ENUM ('whatsapp', 'sms');

-- CreateEnum
CREATE TYPE "guardian_verification_status" AS ENUM ('unverified', 'verified', 'quarantined');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('active', 'withdrawn', 'transferred', 'completed');

-- CreateEnum
CREATE TYPE "fee_schedule_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "fee_category" AS ENUM ('tuition', 'registration', 'exam', 'canteen', 'transport', 'uniform', 'boarding', 'other');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('open', 'partial', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "instalment_status" AS ENUM ('pending', 'partial', 'paid', 'overdue', 'waived', 'cancelled');

-- CreateEnum
CREATE TYPE "discount_type" AS ENUM ('sibling', 'staff', 'merit', 'hardship', 'commercial');

-- CreateEnum
CREATE TYPE "discount_method" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "adjustment_type" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "ledger_entry_type" AS ENUM ('charge', 'payment', 'discount', 'adjustment', 'refund', 'reversal', 'carry_forward');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('mobile_money', 'cash', 'bank_transfer', 'cheque', 'card', 'waiver');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "fee_borne_by" AS ENUM ('payer', 'school');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('requested', 'approved', 'rejected', 'processing', 'completed');

-- CreateEnum
CREATE TYPE "cash_session_status" AS ENUM ('open', 'closed', 'reconciled', 'flagged');

-- CreateEnum
CREATE TYPE "cash_movement_type" AS ENUM ('payment', 'float_in', 'float_out', 'deposit_to_bank', 'correction');

-- CreateEnum
CREATE TYPE "message_channel" AS ENUM ('whatsapp', 'sms');

-- CreateEnum
CREATE TYPE "reminder_applies_to" AS ENUM ('all', 'class', 'status');

-- CreateEnum
CREATE TYPE "reminder_schedule_status" AS ENUM ('scheduled', 'sent', 'skipped', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "message_status" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed', 'undeliverable');

-- CreateEnum
CREATE TYPE "credit_ledger_entry_type" AS ENUM ('topup', 'debit', 'refund', 'adjustment');

-- CreateEnum
CREATE TYPE "billing_period" AS ENUM ('monthly', 'annual');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "plan" "plan" NOT NULL DEFAULT 'essentiel',
    "status" "tenant_status" NOT NULL DEFAULT 'trial',
    "logo_url" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "totp_secret_encrypted" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "site_id" UUID,
    "role" "membership_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'invited',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_year" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" "academic_year_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "academic_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_level" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "cycle" TEXT,

    CONSTRAINT "grade_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_group" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "grade_level_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "head_teacher_name" TEXT,

    CONSTRAINT "class_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "matricule" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "sex" CHAR(1) NOT NULL,
    "born_on" DATE,
    "photo_url" TEXT,
    "status" "student_status" NOT NULL DEFAULT 'enrolled',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "phone_alt_e164" TEXT,
    "email" TEXT,
    "relationship" TEXT NOT NULL,
    "preferred_channel" "preferred_channel" NOT NULL DEFAULT 'whatsapp',
    "preferred_locale" TEXT NOT NULL DEFAULT 'fr',
    "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "opt_out_at" TIMESTAMPTZ(6),
    "verification_status" "guardian_verification_status" NOT NULL DEFAULT 'unverified',
    "bounce_count" INTEGER NOT NULL DEFAULT 0,
    "quarantined_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardian" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "pays_fees" BOOLEAN NOT NULL DEFAULT true,
    "share_percent" INTEGER,

    CONSTRAINT "student_guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_group_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "enrolled_on" DATE NOT NULL,
    "left_on" DATE,
    "status" "enrollment_status" NOT NULL DEFAULT 'active',
    "fee_schedule_id" UUID NOT NULL,
    "carried_forward_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "grade_level_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" DATE NOT NULL,
    "status" "fee_schedule_status" NOT NULL DEFAULT 'draft',
    "total_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fee_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fee_schedule_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "fee_category" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "is_recurring" BOOLEAN NOT NULL DEFAULT true,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "fee_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instalment_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fee_schedule_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "instalment_count" INTEGER NOT NULL,

    CONSTRAINT "instalment_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instalment_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "instalment_plan_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "due_offset_days" INTEGER,
    "due_on" DATE,
    "percent_bp" INTEGER,
    "amount_minor" BIGINT,

    CONSTRAINT "instalment_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "issued_on" DATE NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "net_minor" BIGINT NOT NULL,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "balance_minor" BIGINT NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "fee_item_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instalment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "allocated_minor" BIGINT NOT NULL DEFAULT 0,
    "status" "instalment_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "instalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "invoice_line_id" UUID,
    "type" "discount_type" NOT NULL,
    "method" "discount_method" NOT NULL,
    "value" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reason" TEXT,
    "granted_by" UUID NOT NULL,
    "approved_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "type" "adjustment_type" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_ledger_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "invoice_id" UUID,
    "instalment_id" UUID,
    "entry_type" "ledger_entry_type" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "balance_after_minor" BIGINT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "occurred_on" DATE NOT NULL,
    "memo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "provider_ref" TEXT,
    "provider_fee_minor" BIGINT,
    "fee_borne_by" "fee_borne_by",
    "payer_phone_e164" TEXT,
    "payer_name" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "cash_session_id" UUID,
    "initiated_by" UUID,
    "received_at" TIMESTAMPTZ(6),
    "reconciled_at" TIMESTAMPTZ(6),
    "raw_provider_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "instalment_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,

    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_link" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "instalment_id" UUID,
    "token" TEXT NOT NULL,
    "suggested_amount_minor" BIGINT,
    "min_amount_minor" BIGINT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_url" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "sent_channel" "message_channel",

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "note" TEXT,
    "status" "refund_status" NOT NULL DEFAULT 'requested',
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "provider_ref" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_event" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "processing_error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "provider_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_desk" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cash_desk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_session" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cash_desk_id" UUID NOT NULL,
    "cashier_user_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float_minor" BIGINT NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "declared_close_minor" BIGINT,
    "expected_close_minor" BIGINT,
    "variance_minor" BIGINT,
    "variance_reason" TEXT,
    "status" "cash_session_status" NOT NULL DEFAULT 'open',
    "closed_by" UUID,
    "reconciled_by" UUID,

    CONSTRAINT "cash_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "type" "cash_movement_type" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_counter" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receipt_counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "channel" "message_channel" NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "whatsapp_template_name" TEXT,
    "whatsapp_template_status" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "channel" "message_channel" NOT NULL,
    "template_code" TEXT NOT NULL,
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "applies_to" "reminder_applies_to" NOT NULL DEFAULT 'all',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reminder_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_schedule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "instalment_id" UUID NOT NULL,
    "reminder_rule_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "status" "reminder_schedule_status" NOT NULL DEFAULT 'scheduled',
    "skip_reason" TEXT,
    "message_id" UUID,

    CONSTRAINT "reminder_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "student_id" UUID,
    "channel" "message_channel" NOT NULL,
    "provider" TEXT NOT NULL,
    "to_phone_e164" TEXT NOT NULL,
    "template_code" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "body_rendered" TEXT NOT NULL,
    "status" "message_status" NOT NULL DEFAULT 'queued',
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "cost_minor" BIGINT NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_credit_ledger" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entry_type" "credit_ledger_entry_type" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "balance_after_minor" BIGINT NOT NULL,
    "message_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan" "plan" NOT NULL,
    "billing_period" "billing_period" NOT NULL,
    "student_cap" INTEGER,
    "price_minor" BIGINT NOT NULL,
    "current_period_start" DATE NOT NULL,
    "current_period_end" DATE NOT NULL,
    "status" "subscription_status" NOT NULL DEFAULT 'trialing',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_tenant_id_idx" ON "site"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "membership_tenant_id_idx" ON "membership"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_user_id_tenant_id_key" ON "membership"("user_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_key_hash_key" ON "api_key"("key_hash");

-- CreateIndex
CREATE INDEX "api_key_tenant_id_idx" ON "api_key"("tenant_id");

-- CreateIndex
CREATE INDEX "academic_year_tenant_id_idx" ON "academic_year"("tenant_id");

-- CreateIndex
CREATE INDEX "term_tenant_id_idx" ON "term"("tenant_id");

-- CreateIndex
CREATE INDEX "term_academic_year_id_idx" ON "term"("academic_year_id");

-- CreateIndex
CREATE INDEX "grade_level_tenant_id_idx" ON "grade_level"("tenant_id");

-- CreateIndex
CREATE INDEX "class_group_tenant_id_idx" ON "class_group"("tenant_id");

-- CreateIndex
CREATE INDEX "class_group_academic_year_id_idx" ON "class_group"("academic_year_id");

-- CreateIndex
CREATE INDEX "student_tenant_id_idx" ON "student"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_tenant_id_matricule_key" ON "student"("tenant_id", "matricule");

-- CreateIndex
CREATE INDEX "guardian_tenant_id_idx" ON "guardian"("tenant_id");

-- CreateIndex
CREATE INDEX "guardian_tenant_id_phone_e164_idx" ON "guardian"("tenant_id", "phone_e164");

-- CreateIndex
CREATE INDEX "student_guardian_tenant_id_idx" ON "student_guardian"("tenant_id");

-- CreateIndex
CREATE INDEX "student_guardian_guardian_id_idx" ON "student_guardian"("guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_guardian_student_id_guardian_id_key" ON "student_guardian"("student_id", "guardian_id");

-- CreateIndex
CREATE INDEX "enrollment_tenant_id_idx" ON "enrollment"("tenant_id");

-- CreateIndex
CREATE INDEX "enrollment_class_group_id_idx" ON "enrollment"("class_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_student_id_academic_year_id_key" ON "enrollment"("student_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "fee_schedule_tenant_id_idx" ON "fee_schedule"("tenant_id");

-- CreateIndex
CREATE INDEX "fee_schedule_academic_year_id_grade_level_id_idx" ON "fee_schedule"("academic_year_id", "grade_level_id");

-- CreateIndex
CREATE INDEX "fee_item_tenant_id_idx" ON "fee_item"("tenant_id");

-- CreateIndex
CREATE INDEX "fee_item_fee_schedule_id_idx" ON "fee_item"("fee_schedule_id");

-- CreateIndex
CREATE INDEX "instalment_plan_tenant_id_idx" ON "instalment_plan"("tenant_id");

-- CreateIndex
CREATE INDEX "instalment_plan_fee_schedule_id_idx" ON "instalment_plan"("fee_schedule_id");

-- CreateIndex
CREATE INDEX "instalment_template_tenant_id_idx" ON "instalment_template"("tenant_id");

-- CreateIndex
CREATE INDEX "instalment_template_instalment_plan_id_idx" ON "instalment_template"("instalment_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_enrollment_id_key" ON "invoice"("enrollment_id");

-- CreateIndex
CREATE INDEX "invoice_tenant_id_idx" ON "invoice"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenant_id_number_key" ON "invoice"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "invoice_line_tenant_id_idx" ON "invoice_line"("tenant_id");

-- CreateIndex
CREATE INDEX "invoice_line_invoice_id_idx" ON "invoice_line"("invoice_id");

-- CreateIndex
CREATE INDEX "instalment_tenant_id_idx" ON "instalment"("tenant_id");

-- CreateIndex
CREATE INDEX "instalment_invoice_id_idx" ON "instalment"("invoice_id");

-- CreateIndex
CREATE INDEX "instalment_tenant_id_due_on_status_idx" ON "instalment"("tenant_id", "due_on", "status");

-- CreateIndex
CREATE INDEX "discount_tenant_id_idx" ON "discount"("tenant_id");

-- CreateIndex
CREATE INDEX "discount_invoice_id_idx" ON "discount"("invoice_id");

-- CreateIndex
CREATE INDEX "adjustment_tenant_id_idx" ON "adjustment"("tenant_id");

-- CreateIndex
CREATE INDEX "adjustment_invoice_id_idx" ON "adjustment"("invoice_id");

-- CreateIndex
CREATE INDEX "student_ledger_entry_tenant_id_idx" ON "student_ledger_entry"("tenant_id");

-- CreateIndex
CREATE INDEX "student_ledger_entry_tenant_id_student_id_occurred_on_idx" ON "student_ledger_entry"("tenant_id", "student_id", "occurred_on" DESC);

-- CreateIndex
CREATE INDEX "payment_tenant_id_idx" ON "payment"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_tenant_id_received_at_idx" ON "payment"("tenant_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payment_tenant_id_idempotency_key_key" ON "payment"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_allocation_tenant_id_idx" ON "payment_allocation"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_allocation_payment_id_idx" ON "payment_allocation"("payment_id");

-- CreateIndex
CREATE INDEX "payment_allocation_instalment_id_idx" ON "payment_allocation"("instalment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_token_key" ON "payment_link"("token");

-- CreateIndex
CREATE INDEX "payment_link_tenant_id_idx" ON "payment_link"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_payment_id_key" ON "receipt"("payment_id");

-- CreateIndex
CREATE INDEX "receipt_tenant_id_idx" ON "receipt"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_tenant_id_number_key" ON "receipt"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "refund_tenant_id_idx" ON "refund"("tenant_id");

-- CreateIndex
CREATE INDEX "refund_payment_id_idx" ON "refund"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_event_provider_event_id_key" ON "provider_event"("provider", "event_id");

-- CreateIndex
CREATE INDEX "cash_desk_tenant_id_idx" ON "cash_desk"("tenant_id");

-- CreateIndex
CREATE INDEX "cash_session_tenant_id_idx" ON "cash_session"("tenant_id");

-- CreateIndex
CREATE INDEX "cash_session_cash_desk_id_idx" ON "cash_session"("cash_desk_id");

-- CreateIndex
CREATE INDEX "cash_movement_tenant_id_idx" ON "cash_movement"("tenant_id");

-- CreateIndex
CREATE INDEX "cash_movement_cash_session_id_idx" ON "cash_movement"("cash_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_counter_tenant_id_year_key" ON "receipt_counter"("tenant_id", "year");

-- CreateIndex
CREATE INDEX "message_template_tenant_id_idx" ON "message_template"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_tenant_id_code_locale_key" ON "message_template"("tenant_id", "code", "locale");

-- CreateIndex
CREATE INDEX "reminder_rule_tenant_id_idx" ON "reminder_rule"("tenant_id");

-- CreateIndex
CREATE INDEX "reminder_schedule_tenant_id_idx" ON "reminder_schedule"("tenant_id");

-- CreateIndex
CREATE INDEX "reminder_schedule_status_scheduled_for_idx" ON "reminder_schedule"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_schedule_instalment_id_reminder_rule_id_guardian_i_key" ON "reminder_schedule"("instalment_id", "reminder_rule_id", "guardian_id");

-- CreateIndex
CREATE INDEX "message_tenant_id_idx" ON "message"("tenant_id");

-- CreateIndex
CREATE INDEX "message_guardian_id_idx" ON "message"("guardian_id");

-- CreateIndex
CREATE INDEX "message_credit_ledger_tenant_id_idx" ON "message_credit_ledger"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_tenant_id_key" ON "subscription"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_idx" ON "audit_log"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entity_type_entity_id_occurred_at_idx" ON "audit_log"("tenant_id", "entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "outbox_event_published_at_idx" ON "outbox_event"("published_at");

-- CreateIndex
CREATE INDEX "outbox_event_tenant_id_idx" ON "outbox_event"("tenant_id");

-- AddForeignKey
ALTER TABLE "site" ADD CONSTRAINT "site_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_year" ADD CONSTRAINT "academic_year_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term" ADD CONSTRAINT "term_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_level" ADD CONSTRAINT "grade_level_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_group" ADD CONSTRAINT "class_group_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_class_group_id_fkey" FOREIGN KEY ("class_group_id") REFERENCES "class_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_item" ADD CONSTRAINT "fee_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_item" ADD CONSTRAINT "fee_item_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instalment_plan" ADD CONSTRAINT "instalment_plan_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instalment_plan" ADD CONSTRAINT "instalment_plan_fee_schedule_id_fkey" FOREIGN KEY ("fee_schedule_id") REFERENCES "fee_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instalment_template" ADD CONSTRAINT "instalment_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instalment_template" ADD CONSTRAINT "instalment_template_instalment_plan_id_fkey" FOREIGN KEY ("instalment_plan_id") REFERENCES "instalment_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instalment" ADD CONSTRAINT "instalment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instalment" ADD CONSTRAINT "instalment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount" ADD CONSTRAINT "discount_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount" ADD CONSTRAINT "discount_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount" ADD CONSTRAINT "discount_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_ledger_entry" ADD CONSTRAINT "student_ledger_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_ledger_entry" ADD CONSTRAINT "student_ledger_entry_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_ledger_entry" ADD CONSTRAINT "student_ledger_entry_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_ledger_entry" ADD CONSTRAINT "student_ledger_entry_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "instalment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "instalment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link" ADD CONSTRAINT "payment_link_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link" ADD CONSTRAINT "payment_link_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link" ADD CONSTRAINT "payment_link_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link" ADD CONSTRAINT "payment_link_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "instalment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk" ADD CONSTRAINT "cash_desk_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk" ADD CONSTRAINT "cash_desk_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_cash_desk_id_fkey" FOREIGN KEY ("cash_desk_id") REFERENCES "cash_desk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_counter" ADD CONSTRAINT "receipt_counter_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_rule" ADD CONSTRAINT "reminder_rule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_schedule" ADD CONSTRAINT "reminder_schedule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_schedule" ADD CONSTRAINT "reminder_schedule_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "instalment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_schedule" ADD CONSTRAINT "reminder_schedule_reminder_rule_id_fkey" FOREIGN KEY ("reminder_rule_id") REFERENCES "reminder_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_schedule" ADD CONSTRAINT "reminder_schedule_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_schedule" ADD CONSTRAINT "reminder_schedule_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_credit_ledger" ADD CONSTRAINT "message_credit_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
