ALTER TABLE bank_users ADD COLUMN login_failures INTEGER NOT NULL DEFAULT 0;
-- Existing sessions predate idle expiry and must sign in again after deployment.
DELETE FROM auth_tokens;
ALTER TABLE auth_tokens ADD COLUMN last_activity_at TIMESTAMP(6) WITH TIME ZONE NOT NULL;
CREATE TABLE recovery_grants(
 token_hash VARCHAR(64) PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES bank_users(id),
 auth_version BIGINT NOT NULL,purpose VARCHAR(24) NOT NULL,
 expires_at TIMESTAMP(6) WITH TIME ZONE NOT NULL,consumed BOOLEAN NOT NULL DEFAULT FALSE
);
-- Old finite PIN locks become explicit-unlock locks; never reset failure history silently.
UPDATE accounts SET pin_failures=4 WHERE pin_locked_until IS NOT NULL;
UPDATE accounts SET pin_locked_until=NULL;
UPDATE bank_users SET per_transfer_limit=1000000 WHERE per_transfer_limit IS NULL;
UPDATE bank_users SET daily_limit=5000000 WHERE daily_limit IS NULL;

ALTER TABLE accounts ADD COLUMN opening_terms_version VARCHAR(32);
ALTER TABLE accounts ADD COLUMN opening_terms_accepted_at TIMESTAMP(6) WITH TIME ZONE;
