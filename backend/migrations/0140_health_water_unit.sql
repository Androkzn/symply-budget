-- Symply Health — the water-goal DISPLAY unit (mL / L / cups / fl oz), synced
-- server-side so it follows a member across devices and reinstalls, the same
-- way `gender` / `activity_level` (0125) already do.
--
-- The AMOUNT itself was already canonical millilitres on `daily_water_ml` —
-- nothing about that changes here. What was missing was a place to remember
-- WHICH unit a member last chose to see it in: `healthWaterStorage.ts`'s
-- ml/oz toggle has always been device-local only (its own header comment
-- explains why, for a two-unit toggle that never needed to travel). Widening
-- the toggle to four units and surfacing it during onboarding is what makes
-- that no longer good enough — a choice made once on first launch should not
-- have to be repeated on a second device.
--
-- NULL is "not set", same as every other `health_goals` biometric column —
-- the client falls back to 'ml' rather than the row defaulting to a guess.

ALTER TABLE health_goals ADD COLUMN water_unit TEXT;
