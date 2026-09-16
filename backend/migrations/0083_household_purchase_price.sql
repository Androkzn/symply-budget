-- Record the property's REAL purchase price — what the owner actually paid when
-- they bought it — separate from BC Assessment's assessed value and from the
-- public "sales history" printed on the assessment notice. Lets the app show a
-- true cost basis and a purchase-price-based effective tax rate. Both columns
-- are nullable: most households won't have this filled until the owner enters it
-- (optionally pre-filled from the notice's most recent sale).
ALTER TABLE households ADD COLUMN purchase_price INTEGER; -- in cents
ALTER TABLE households ADD COLUMN purchase_date TEXT;     -- ISO 'YYYY-MM-DD'
