ALTER TABLE bank_users ADD COLUMN name_encrypted TEXT;
ALTER TABLE bank_users ADD COLUMN email_encrypted TEXT;
ALTER TABLE bank_users ADD COLUMN email_lookup VARCHAR(64);
ALTER TABLE bank_users ADD COLUMN phone_encrypted TEXT;
ALTER TABLE bank_users ADD COLUMN phone_lookup VARCHAR(64);
ALTER TABLE bank_users ADD COLUMN profile_version BIGINT NOT NULL DEFAULT 0;
CREATE INDEX idx_users_email_lookup ON bank_users(email_lookup);
CREATE INDEX idx_users_phone_lookup ON bank_users(phone_lookup);
ALTER TABLE accounts ADD COLUMN account_name VARCHAR(255) NOT NULL DEFAULT '프로젝트 입출금통장';
ALTER TABLE accounts ADD COLUMN account_type VARCHAR(20) NOT NULL DEFAULT 'CHECKING';
ALTER TABLE accounts ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'KRW';
ALTER TABLE accounts ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
-- Unknown historical dates and balance snapshots are deliberately left NULL.
ALTER TABLE accounts ADD COLUMN opened_at TIMESTAMP(6) WITH TIME ZONE;
ALTER TABLE ledger_entries ADD COLUMN balance_after NUMERIC(19,2);
