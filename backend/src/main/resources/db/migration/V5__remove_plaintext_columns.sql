-- Deploy only after backup and V4 validation. Old binaries cannot run this schema.
ALTER TABLE bank_users ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE bank_users ALTER COLUMN username_enc SET NOT NULL;
ALTER TABLE bank_users ALTER COLUMN username_lookup SET NOT NULL;
CREATE UNIQUE INDEX uq_users_public_id ON bank_users(public_id);
CREATE UNIQUE INDEX uq_users_username_lookup ON bank_users(username_lookup);
ALTER TABLE accounts ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE accounts ALTER COLUMN number_enc SET NOT NULL;
ALTER TABLE accounts ALTER COLUMN number_lookup SET NOT NULL;
CREATE UNIQUE INDEX uq_accounts_public_id ON accounts(public_id);
CREATE UNIQUE INDEX uq_accounts_number_lookup ON accounts(number_lookup);
ALTER TABLE ledger_entries ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE ledger_entries ALTER COLUMN counterparty_enc SET NOT NULL;
CREATE UNIQUE INDEX uq_ledger_public_id ON ledger_entries(public_id);
ALTER TABLE bank_users DROP COLUMN username;
ALTER TABLE accounts DROP COLUMN number;
ALTER TABLE ledger_entries DROP COLUMN counterparty;
