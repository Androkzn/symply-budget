-- Sales tax attributed to each expense line, in cents. The `amount` column is
-- now stored TAX-INCLUSIVE by receipt scanning; tax_amount records how much of
-- that amount is sales tax (0 = tax-exempt or no tax on the receipt). Existing
-- rows default to 0 (their amount was pre-tax / tax-free, unchanged).
ALTER TABLE expenses ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0;
