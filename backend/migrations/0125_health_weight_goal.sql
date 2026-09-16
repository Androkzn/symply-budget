-- Symply Health — give WEIGHT a goal, a baseline, and the biometrics the donor
-- derives BMI / BMR / lean mass from.
--
-- WHY THIS EXISTS AT ALL. Weight is the app's headline feature and the one the
-- owner ranks first, and until now it had no target. `grep -rn 'goalWeight|
-- goal_weight|targetWeight' src/features/health` returned ZERO hits, because
-- there was nowhere on the wire to put one: `health_goals` carries calories,
-- macros, water, steps, workout minutes and sleep, and stops there. Every
-- weight surface the donor ships is downstream of that one missing number —
-- the goal RULE on the trend chart, the goal-progress ring, the "to go" figure,
-- the goal toggle on the weekly chart, and the AI trend prompt's
-- `targetWeight` context. There is no client-side workaround: `PUT /goals`
-- validates with a `z.object`, which STRIPS unknown keys and answers 200, so a
-- target sent today is silently discarded rather than rejected.
--
-- The same gap blocks the donor's body-metric maths. BMI needs height, BMR
-- needs height + sex + age, TDEE needs an activity level, and lean/fat mass
-- need height-free body fat (which we already have, on `body_measurements`).
-- `heightCm`, `bmi` and `bmr` are all zero hits across `src/` for exactly this
-- reason. They are added together because adding the target alone would leave
-- the Body Composition card and its explainer sheet — both weight surfaces —
-- still unbuildable, and a second ALTER pass on the same table a week later is
-- worse than one.
--
-- ============================ DONOR MAPPING ================================
--
-- Donor = `~/Desktop/Symply Ecosystem/Simply Health/backend/`, read-only.
-- Source: `migrations/011_health_profile.sql` + `080_starting_weight_tracking.sql`.
--
--   donor `users.height_cm`            → `health_goals.height_cm`
--   donor `users.activity_level`       → `health_goals.activity_level`
--   donor `users.weight_goal_type`     → `health_goals.weight_goal_type`
--   donor `users.target_weight_kg`     → `health_goals.target_weight_kg`
--   donor `users.starting_weight_kg`   → `health_goals.starting_weight_kg`
--   donor `users.starting_weight_date` → `health_goals.starting_weight_date`
--   donor `users.gender`               → `health_goals.gender`
--   donor `users.date_of_birth`        → `health_goals.birth_year`  ← DEVIATION
--
-- Column NAMES are the donor's, verbatim, including the `_kg` suffix that makes
-- the canonical unit part of the name. Vocabulary values are the donor's too:
-- `activity_level` ∈ sedentary | lightlyActive | moderatelyActive | veryActive |
-- extraActive, `weight_goal_type` ∈ lose | maintain | gain, `gender` ∈ male |
-- female | other. Renaming any of them would fork the one vocabulary the ported
-- screens already speak.
--
-- ============================ DEVIATIONS ===================================
--
--   * THE TABLE IS `health_goals`, NOT `users`. The donor hangs all eight
--     columns off its own `users` row because its `users` table serves exactly
--     one app. Ours does not: `users` is the SHARED ecosystem identity table
--     that House, Budget, Kaizen and Health all select from, so a height and a
--     sex stored there would be readable by every other brand's code path —
--     precisely the cross-app leak BRD §7 forbids, and precisely why the whole
--     Health domain was given its own tables in 0119. `health_goals` is already
--     the per-user, Health-only "what this person is aiming at" row, it is
--     already effective-dated, and it is already fetched by `goalFor()` on
--     every summary read, so the target arrives with the calorie target at no
--     extra round trip.
--
--   * EFFECTIVE-DATING IS A FEATURE HERE, not an accident of the host table.
--     The donor stores ONE target that is overwritten in place, so a member who
--     hits 75 kg and re-targets 72 kg destroys the history of the first goal and
--     every past day is retro-scored against a target that did not exist yet.
--     `goalFor(user, date)` returns the row in force ON that date, so a chart of
--     last spring draws last spring's line.
--
--   * `birth_year INTEGER` REPLACES the donor's `date_of_birth TEXT`. Age in
--     whole years is the ONLY thing that consumes it (Mifflin–St Jeor takes
--     age; so does the donor's metabolic-age comparison), and a full date of
--     birth is identity-grade PII sitting in the same row as a body weight and
--     a sex. A birth year cannot re-identify on its own, and it answers every
--     question the column exists for to within a year — which is inside the
--     ±5 kcal noise of any BMR formula. Stored as an INTEGER so an off-by-one
--     string ('1990 ') cannot silently become NaN in the estimator.
--
--   * NO CHECK CONSTRAINTS, unlike the donor's `011`, which could declare them
--     because it created the columns on a table it was also rebuilding. Ours
--     are ALTERs on a live table and SQLite cannot add a CHECK without a full
--     rebuild — the same call 0122 and 0124 made. Validation lives in zod at the
--     route boundary, which rejects a bad vocabulary value with a 400 instead of
--     letting the database surface it as a 500.
--
--   * EVERY COLUMN IS NULLABLE WITH NO DEFAULT, including `activity_level`,
--     where the donor defaults to 'moderatelyActive'. A defaulted activity level
--     is a guess that gets multiplied into a TDEE and then shown to the member
--     as a calorie figure. NULL is the honest "not told us yet", and the client
--     renders "set your details to see BMR" rather than a fabricated number.
--
--   * `target_weight_kg` IS CANONICAL KILOGRAMS even though `weight_entries`
--     stores whatever unit the member typed. That asymmetry is deliberate. An
--     ENTRY is a measurement and converting it would invent precision the member
--     never entered (which is why `weightDailyValues` excludes the minority unit
--     rather than converting it). A TARGET is a single scalar the member chose,
--     and storing it canonically is what lets them switch the display unit
--     without losing it. The client converts once, at the edge, for display and
--     for the goal rule.
--
--   * NO NEW `updated_at` / soft delete. `health_goals` already carries
--     `updated_at` and is keyed unique on (user_id, effective_date); the goal
--     row is upserted, never tombstoned. Every column added here rides the
--     EXISTING `updated_at`, so the delta-sync cursor needs no change.
--
-- ============================ APPLIED + DEPLOYED ===========================
--
-- APPLIED to BOTH Health D1s (staging and production) and the Worker deployed,
-- 2026-07-26. Verify with:
--   npx wrangler d1 migrations list DB --remote --env staging    -c wrangler.health.toml
--   npx wrangler d1 migrations list DB --remote --env production -c wrangler.health.toml
-- Migrations are immutable once applied remotely — do not edit the DDL below.
--
-- The client's forward-compatibility contract still stands and is still worth
-- knowing, because a member can be running an older build against this Worker:
-- an ABSENT key means "this Worker predates 0125" and the locally cached goal is
-- kept, whereas an explicit NULL means "the member cleared it" and the cache is
-- cleared with it. See `src/features/health/healthWeightStorage.ts`.

-- ---------------------------- the target ----------------------------------

-- Canonical kilograms. NULL = no target set (the honest default; the donor's
-- own goalProgress widget renders "Set a goal weight…" for exactly this state).
ALTER TABLE health_goals ADD COLUMN target_weight_kg REAL;

-- lose | maintain | gain. Derivable from target vs starting, but stored because
-- "maintain" is a real, distinct intent at a target the member is already at,
-- and deriving it would silently flip to 'lose' the first day they weigh 200 g
-- heavier than the number they typed.
ALTER TABLE health_goals ADD COLUMN weight_goal_type TEXT;

-- ---------------------------- the baseline --------------------------------

-- The weight progress is measured FROM. Distinct from "the first entry in the
-- window": a member who starts using the app mid-journey wants the progress ring
-- to count from where they actually began, not from their first weigh-in here.
-- NULL falls back to the earliest logged entry, which is what the donor does.
ALTER TABLE health_goals ADD COLUMN starting_weight_kg REAL;

-- YYYY-MM-DD. Only meaningful alongside `starting_weight_kg`; carried so the
-- progress card can say "since 3 Feb" instead of an undated percentage.
ALTER TABLE health_goals ADD COLUMN starting_weight_date TEXT;

-- ------------------------- biometrics for the maths -----------------------

-- Centimetres. Feeds BMI (kg ÷ m²), BMR and therefore TDEE.
ALTER TABLE health_goals ADD COLUMN height_cm REAL;

-- male | female | other. Needed by Mifflin–St Jeor and by the donor's
-- gender-split healthy body-fat ranges. 'other' has no published BMR constant,
-- so the client averages the two — and says so — rather than silently picking one.
ALTER TABLE health_goals ADD COLUMN gender TEXT;

-- Whole year, e.g. 1990. See the deviation note above for why this is not a DOB.
ALTER TABLE health_goals ADD COLUMN birth_year INTEGER;

-- sedentary | lightlyActive | moderatelyActive | veryActive | extraActive.
-- Multiplies BMR into TDEE. NULL = not told us, so no TDEE is shown.
ALTER TABLE health_goals ADD COLUMN activity_level TEXT;

-- "Which of this member's goal rows actually set a weight target" — the read
-- behind the goal rule and the progress ring, both of which resolve the LATEST
-- goal row carrying a target rather than the latest goal row overall (a member
-- who edits only their calorie target must not lose their weight goal).
CREATE INDEX IF NOT EXISTS idx_health_goals_target_weight
  ON health_goals(user_id, effective_date)
  WHERE target_weight_kg IS NOT NULL;
