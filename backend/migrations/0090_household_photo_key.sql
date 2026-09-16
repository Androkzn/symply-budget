-- Household cover photo R2 key.
-- House production already had this column (ad-hoc). Budget D1s applied ADD COLUMN
-- in the first ship of this migration. Keep as no-op so House migrate:remote succeeds.
SELECT 1;
