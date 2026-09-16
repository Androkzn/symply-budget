-- Symply Budget — month scope on savings_recurring_payments (0151).
-- A payment can start mid-year or end before year-end. scope_type='custom_months'
-- restricts it to `active_months` (JSON array of 1-12) for `scope_year` ONLY —
-- every other year still runs the payment all 12 months. Existing rows default
-- to 'all_year' (unchanged behavior, both new columns stay NULL).
ALTER TABLE savings_recurring_payments ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'all_year';
ALTER TABLE savings_recurring_payments ADD COLUMN scope_year INTEGER;
ALTER TABLE savings_recurring_payments ADD COLUMN active_months TEXT;
