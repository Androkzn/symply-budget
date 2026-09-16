-- Symply House — a single global "Imperial vs Metric" preference for
-- room/space size display and entry (sqft vs sqm). Household-wide, same tier
-- as `country` on this table: one physical property, one unit system, not a
-- per-member display choice.
--
-- `household_spaces.area_sqft` stays canonical square feet regardless of this
-- column's value — only how it is DISPLAYED and TYPED changes, the same
-- "canonical amount, separate display-unit" contract Health's `water_unit`
-- (0140) established.
--
-- NULL is "not set" — the client falls back to a country-derived default,
-- not a guessed value stored here.

ALTER TABLE households ADD COLUMN unit_system TEXT;
