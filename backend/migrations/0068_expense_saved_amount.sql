-- Grocery receipt scanning: track how much was saved on discounts/sales per expense.
-- saved_amount is the discount value in cents that applied to this line item
-- (0 when the item was bought at full price). Aggregated per month for the
-- "saved on discounts" figure.

ALTER TABLE expenses ADD COLUMN saved_amount INTEGER NOT NULL DEFAULT 0;
