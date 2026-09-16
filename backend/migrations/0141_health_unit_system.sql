-- Symply Health — a single global "Imperial vs Metric" preference, synced
-- server-side so it follows a member across devices and reinstalls, the same
-- reasoning `water_unit` (0140) already established for this table.
--
-- 'metric' means kg + cm + km; 'imperial' means lb + ft/in + mi. This is
-- DELIBERATELY separate from `water_unit` (mL / L / cups / fl oz) — water
-- keeps its own independent 4-way switcher, it is not derived from this
-- column.
--
-- NULL is "not set", same contract as every other `health_goals` biometric
-- column added since 0125 — the client falls back to 'metric' rather than the
-- row defaulting to a guess.

ALTER TABLE health_goals ADD COLUMN unit_system TEXT;
