-- Expand first. Plaintext stays until V4 successfully backfills and V5 contracts.
ALTER TABLE bank_users ADD COLUMN public_id VARCHAR(36);
ALTER TABLE bank_users ADD COLUMN username_enc TEXT;
ALTER TABLE bank_users ADD COLUMN username_lookup VARCHAR(64);
ALTER TABLE accounts ADD COLUMN public_id VARCHAR(36);
ALTER TABLE accounts ADD COLUMN number_enc TEXT;
ALTER TABLE accounts ADD COLUMN number_lookup VARCHAR(64);
ALTER TABLE ledger_entries ADD COLUMN public_id VARCHAR(36);
ALTER TABLE ledger_entries ADD COLUMN counterparty_enc TEXT;

CREATE TABLE crypto_metadata (
 id VARCHAR(16) PRIMARY KEY,
 encrypted_check TEXT NOT NULL,
 lookup_check VARCHAR(64) NOT NULL
);
