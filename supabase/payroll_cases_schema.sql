-- Run in Supabase SQL Editor: supabase.com → project → SQL Editor

CREATE TABLE IF NOT EXISTS payroll_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('CSI', 'PAYROLL')),
  entity TEXT NOT NULL,
  entity_name TEXT,
  period CHAR(6) NOT NULL,
  seq_no INT NOT NULL,

  -- Workflow status
  status TEXT NOT NULL DEFAULT 'uploaded',
  -- uploaded | check_generated | check_approval_sent | check_reviewer_approved |
  -- check_approved | check_rejected | bank_file_generated | bank_uploaded |
  -- payment_approval_sent | payment_approved | payment_rejected | zoho_posted

  -- Step 1: Upload
  payment_date DATE,
  original_file_name TEXT,
  original_file_hash TEXT,
  parsed_data JSONB,
  uploaded_by_id TEXT,
  uploaded_by_name TEXT,
  uploaded_by_email TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  upload_ip TEXT,

  -- Step 2: Check file
  check_data JSONB,
  check_generated_at TIMESTAMPTZ,

  -- Step 3: Check approval
  check_approval_sent_at TIMESTAMPTZ,
  check_reviewer_name TEXT,
  check_reviewer_approved_at TIMESTAMPTZ,
  check_final_approver_name TEXT,
  check_approved_at TIMESTAMPTZ,
  check_approval_cert JSONB,
  check_rejected_at TIMESTAMPTZ,
  check_rejection_reason TEXT,
  check_escalated_at TIMESTAMPTZ,

  -- Step 4: Bank file
  bank_file_name TEXT,
  bank_file_hash TEXT,
  bank_file_data TEXT,
  bank_file_generated_at TIMESTAMPTZ,
  bank_file_triggered_by TEXT,

  -- Step 5: Bank upload + receipt
  bank_upload_by TEXT,
  bank_portal_ref TEXT,
  bank_upload_at TIMESTAMPTZ,
  bank_receipt_name TEXT,
  bank_receipt_attached_at TIMESTAMPTZ,

  -- Step 6: Payment approval (Director)
  payment_approval_sent_at TIMESTAMPTZ,
  payment_approved_by TEXT,
  payment_approved_at TIMESTAMPTZ,
  payment_approval_cert JSONB,
  payment_rejected_at TIMESTAMPTZ,
  payment_rejection_reason TEXT,

  -- Step 7: Zoho posting
  zoho_org_id TEXT,
  zoho_journal_ids JSONB,
  zoho_posted_at TIMESTAMPTZ,
  zoho_posted_by TEXT,

  -- Step 9: Audit package
  audit_assembled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_approval_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES payroll_cases(id) ON DELETE CASCADE,
  step INT NOT NULL,
  approver_email TEXT NOT NULL,
  approver_name TEXT NOT NULL,
  approver_role TEXT NOT NULL, -- reviewer | final | director
  token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  action_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES payroll_cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  performed_by TEXT,
  user_id TEXT,
  ip_address TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payroll_cases_type_idx        ON payroll_cases (type);
CREATE INDEX IF NOT EXISTS payroll_cases_status_idx      ON payroll_cases (status);
CREATE INDEX IF NOT EXISTS payroll_cases_created_at_idx  ON payroll_cases (created_at DESC);
CREATE INDEX IF NOT EXISTS payroll_audit_log_case_idx    ON payroll_audit_log (case_id);
CREATE INDEX IF NOT EXISTS payroll_approval_token_idx    ON payroll_approval_tokens (token);
