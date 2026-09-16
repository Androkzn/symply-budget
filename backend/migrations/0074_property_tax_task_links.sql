-- Link a property tax record to the reminder tasks auto-created for it while
-- it is UNPAID. On import the backend can spawn up to two one-time tasks:
--   * main_payment_task_id — "Pay <year> property tax" (due on the main due date)
--   * grant_task_id        — "Claim <year> Home Owner Grant" (when the notice
--                            shows a grant, claimed by the same due date)
-- Marking the tax paid deletes the pay task; recording the grant as
-- applied/approved deletes the grant task. Cleared to NULL when no task links.
ALTER TABLE property_taxes ADD COLUMN main_payment_task_id TEXT;
ALTER TABLE property_taxes ADD COLUMN grant_task_id TEXT;

-- Cheaply find the property tax a given task belongs to (and vice-versa).
CREATE INDEX IF NOT EXISTS property_taxes_main_payment_task_id_idx ON property_taxes(main_payment_task_id);
CREATE INDEX IF NOT EXISTS property_taxes_grant_task_id_idx ON property_taxes(grant_task_id);
