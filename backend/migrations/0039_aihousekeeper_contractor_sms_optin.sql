-- ============================================
-- Migration: Contractor SMS opt-in / TCPA fields (Stream A5)
-- Date: 2026-04-23
-- Plan: documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v3.1.md §A5
-- Description: TCPA compliance columns on `contractors`. Aihousekeeper will never
--              SMS a contractor without a non-null `sms_opt_in_at` and a
--              null `sms_opt_out_at`. `phone_e164` is the canonical form
--              (existing `phone` column stays for display / backfill source).
-- ============================================

-- TCPA compliance + canonical phone storage
ALTER TABLE contractors ADD COLUMN phone_e164 TEXT;
ALTER TABLE contractors ADD COLUMN sms_opt_in_at TEXT;
ALTER TABLE contractors ADD COLUMN sms_opt_out_at TEXT;
ALTER TABLE contractors ADD COLUMN sms_opt_in_source TEXT;   -- 'homeowner_attest' | 'self_reply_start' | 'inbound_sms'

CREATE INDEX IF NOT EXISTS idx_contractors_sms_optin
  ON contractors(sms_opt_in_at, sms_opt_out_at);
CREATE INDEX IF NOT EXISTS idx_contractors_phone_e164
  ON contractors(phone_e164);
