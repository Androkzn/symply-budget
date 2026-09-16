-- Symply Budget — autopay flag on savings_recurring_payments (0150).
-- When a payment is on autopay, the household never needs a due-day nudge for
-- it, so day_of_month is cleared alongside is_automated=1 (both server-side on
-- create/update and here for any pre-existing row a client marks automated).
ALTER TABLE savings_recurring_payments ADD COLUMN is_automated INTEGER NOT NULL DEFAULT 0;
