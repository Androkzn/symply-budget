-- Receipt recognition v2: period roll-up of container deposits / US CRV.
-- Review-time `fees[]` stay off-disk. No `taxable` column — Tax pill is tax_amount > 0.
-- Shared fleet schema: apply to every brand D1 (House, Budget, Kaizen, Health)
-- on staging AND production BEFORE deploy:fleet writes this column.

ALTER TABLE expenses ADD COLUMN deposit_amount INTEGER NOT NULL DEFAULT 0;
