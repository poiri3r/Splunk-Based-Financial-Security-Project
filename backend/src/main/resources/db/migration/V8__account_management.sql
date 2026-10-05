ALTER TABLE accounts ADD COLUMN alias_encrypted TEXT;
ALTER TABLE accounts ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN debit_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE accounts ADD COLUMN settings_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN pin_hash VARCHAR(100);
ALTER TABLE accounts ADD COLUMN pin_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN pin_locked_until TIMESTAMP(6) WITH TIME ZONE;
ALTER TABLE accounts ADD COLUMN security_version BIGINT NOT NULL DEFAULT 0;
-- Preserve existing users' unlimited policy; defaults for NEW users are assigned in BankUser.
ALTER TABLE bank_users ADD COLUMN per_transfer_limit NUMERIC(19,2);
ALTER TABLE bank_users ADD COLUMN daily_limit NUMERIC(19,2);
ALTER TABLE bank_users ADD COLUMN limit_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE transfer_actions ADD COLUMN account_security_version BIGINT NOT NULL DEFAULT 0;
CREATE TABLE limit_usage (
 id VARCHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES bank_users(id),
 usage_date DATE NOT NULL, amount NUMERIC(38,2) NOT NULL,
 UNIQUE(user_id,usage_date)
);
-- V9 fills prior usage with explicit Java Asia/Seoul conversion.
CREATE TABLE setting_actions (
 token_hash VARCHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES bank_users(id),
 target_id VARCHAR(36) NOT NULL,purpose VARCHAR(32) NOT NULL,payload_hash VARCHAR(64) NOT NULL,
 expires_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,consumed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_setting_actions_expiry ON setting_actions(expires_at);
CREATE TABLE beneficiaries (
 id VARCHAR(36) PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES bank_users(id),
 bank_code VARCHAR(16) NOT NULL,number_encrypted TEXT NOT NULL,number_lookup VARCHAR(64) NOT NULL,
 alias_encrypted TEXT,created_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,version BIGINT NOT NULL DEFAULT 0,
 UNIQUE(user_id,bank_code,number_lookup)
);
