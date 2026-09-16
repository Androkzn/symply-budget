-- Symply Health — widen `body_measurements` from the donor's LEGACY site list
-- to its COMPREHENSIVE one, minus the sites nothing in this app can produce.
--
-- WHY THIS EXISTS. `documents/apps/symply-health/UI_PARITY_AUDIT.md` §6 measures
-- the Body tab at 14 sites against the donor's 65 fields (22%), and §9 item 18
-- schedules closing it. The 14 the RN app collects are exactly the 14 columns
-- 0119 created, which are the donor's "Legacy Fields (kept for backward
-- compatibility)" block. Everything the donor added on top of that block —
-- five points per arm, eight per leg, four belly points, three chest points —
-- has never had a column here, and `POST /health/measurements` validates with a
-- `z.object`, which STRIPS unknown keys and answers 200. So a site sent by a
-- client today is silently discarded rather than rejected; the client and the
-- route have to widen together, and this migration is the third end of that.
--
-- ============================ DONOR MAPPING ================================
--
-- Donor = `~/Desktop/Symply Ecosystem/Simply Health/`, read-only.
-- Source: `SimpleHealth/Preview Content/Domain/Models/BodyPhoto/BodyPhotoModels.swift`
--         `struct BodyMeasurement` (the 65 `Double?` fields the audit counts).
--
--   donor `leftArmMid`  / `rightArmMid`      → left_arm_mid  / right_arm_mid
--   donor `leftForearmMid` / `rightForearmMid` → left_forearm_mid / right_forearm_mid
--   donor `leftWrist`   / `rightWrist`       → left_wrist    / right_wrist
--   donor `leftThighMid`/ `rightThighMid`    → left_thigh_mid  / right_thigh_mid
--   donor `leftThighLower`/`rightThighLower` → left_thigh_lower/ right_thigh_lower
--   donor `leftKnee`    / `rightKnee`        → left_knee     / right_knee
--   donor `leftCalfMid` / `rightCalfMid`     → left_calf_mid / right_calf_mid
--   donor `leftCalfLower`/`rightCalfLower`   → left_calf_lower/ right_calf_lower
--   donor `leftAnkle`   / `rightAnkle`       → left_ankle    / right_ankle
--   donor `waistNavel`                       → waist_navel
--   donor `waistUpper`                       → waist_upper
--   donor `waistLower`                       → waist_lower
--   donor `iliacCircumference`               → iliac              ← DEVIATION (name)
--   donor `chestUpper`                       → chest_upper
--   donor `chestUnder`                       → chest_under
--   donor `backWidth`                        → back_width
--   donor `torsoLength`                      → torso_length
--   donor `inseam`                           → inseam
--
-- 27 columns. Column names are the donor's field names in snake_case, matching
-- the 14 that 0119 already created, so the FE↔column map in
-- `src/features/health/healthBodyStorage.ts` (`METRIC_COLUMN`) stays mechanical.
--
-- ===================== DEVIATION 1: DONOR FIELDS NOT PORTED ================
--
-- (a) THE FOUR ALIASES OF A COLUMN THAT ALREADY EXISTS. The donor carries both
--     its legacy field and its comprehensive re-statement of the same site:
--
--       donor `waistNarrowest`      == the natural waist  == existing `waist`
--       donor `hipCircumference`    == max gluteal girth  == existing `hips`
--       donor `chestFull`           == chest at nipple    == existing `chest`
--       donor `leftArmUpper`/`rightArmUpper` == bicep at widest == `left_arm`/`right_arm`
--
--     The donor keeps both because its photo pipeline writes the new names and
--     its old readers still read the old ones. We have no such history: adding
--     `waist_narrowest` beside `waist` would put two chips meaning the same
--     thing in front of the member, and split one trend line into two. The
--     legacy column IS the comprehensive point, and the client's label copy says
--     which point it is ("narrowest", "at widest").
--
--     By the same rule `leftForearmUpper`/`rightForearmUpper` (max forearm
--     girth) are the existing `left_forearm`/`right_forearm`, and
--     `leftCalfUpper`/`rightCalfUpper` (max calf girth) are `left_calf`/
--     `right_calf`. Donor `shoulderWidth` is the existing `shoulders`, and the
--     donor's single-sided `forearm`, `wrist` and `ankle` are superseded by the
--     per-side columns — left/right asymmetry is a real signal and collapsing a
--     pair to one number throws it away.
--
-- (b) THE PLANAR MEASUREMENTS: donor `abdomenDepth`, `chestDepth`, `hipWidth`.
--     These are not girths and not surface paths. An antero-posterior DEPTH at
--     the navel or the sternum, and a front-view hip BREADTH, are the distance
--     between two points THROUGH or ACROSS the body, which needs an
--     anthropometer, a caliper, or the donor's calibrated side/front photo. A
--     flexible tape cannot produce any of the three. The donor only ever fills
--     them from its BodyPhoto AI pipeline, and BodyPhoto is deliberately not
--     ported (migration.md "Later — privacy": it needs its own storage,
--     retention and deletion spec). A column nothing can write is worse than an
--     absent one, so they are absent.
--
--     `back_width` IS ported despite being a width, because it is measured
--     ALONG the back with a tape from scapula to scapula — the standard
--     tailoring across-back measurement — exactly like the `shoulders` column
--     0119 already ships. Surface path in, projected breadth out.
--
-- (c) THE FOUR RATIOS: donor `waistToHipRatio`, `waistToHeightRatio`,
--     `shoulderToWaistRatio`, `chestToWaistRatio`. Not stored, because they are
--     pure functions of columns in this same row (plus `health_goals.height_cm`
--     from 0125). A stored ratio is a denormalised copy that goes stale the
--     moment either input is corrected, and the donor's own code recomputes
--     `waist / hips` inline in `BodyTabView` and `BodyProgressView` rather than
--     reading its own column. The client derives all four; see
--     `bodyRatiosFor()` in `healthBodyStorage.ts`.
--
-- (d) THE THREE SYMMETRY SCORES: donor `armSymmetryScore`, `legSymmetryScore`,
--     `overallSymmetryScore`. Derivable the same way (min/max of a left/right
--     pair), and additionally a SCORE is a grade. The client shows the plain
--     left-minus-right difference in the member's own unit instead, with no
--     score and no verdict.
--
-- (e) THE BODY-FAT ESTIMATE: donor `bodyFatEstimateLow`, `bodyFatEstimateHigh`,
--     `bodyFatCategory`. Registered as a deliberate non-port in the audit's
--     "known-unknowns" table (row `HEALTH-AI-172`): the US Navy formula would
--     derive a percentage from neck/waist/hips, and a body-fat percentage shown
--     by a health app reads as a measurement rather than an estimate.
--     `body_fat_percentage` stays what it has always been — what the member
--     measured and typed.
--
-- (f) POSTURE + ANALYSIS METADATA: donor `postureScore`, `postureNotes`,
--     `photosAnalyzed`, `measurementConfidence`, `angle`, `photoId`,
--     `analysisConfidence`, `analysisProvider`. All eight exist to describe a
--     photo analysis. No photos, no analysis, no columns.
--
-- (g) SMART-SCALE COMPOSITION. Not on `BodyMeasurement` at all (they live on the
--     donor's `BodyCompositionEntry`), and named here only because they are the
--     first thing a reader will look for: visceral fat, bone mass, body water,
--     metabolic age, protein %, subcutaneous fat and skeletal muscle need a
--     smart scale. There is no scale integration. The audit already files them
--     as 🚫 for exactly this reason and this migration does not revisit it.
--
-- ===================== DEVIATION 2: SHAPE OF THE WRITE =====================
--
-- Every column is REAL and NULLABLE with no default, like the 14 before them. A
-- measurement row is sparse by nature — nobody tapes 41 sites in one sitting —
-- and 0 is a real number that would draw a cliff on the trend chart, so "not
-- measured" has to be NULL and never a zero.
--
-- NO CHECK CONSTRAINTS, matching 0122 / 0124 / 0125: SQLite cannot add a CHECK
-- to a live table without a full rebuild. The positive/max-400 bound is enforced
-- in zod at the route boundary, which answers 400 instead of letting the
-- database surface a 500.
--
-- NO `ADD COLUMN IF NOT EXISTS`, because SQLite has no such form — only CREATE
-- TABLE / CREATE INDEX take `IF NOT EXISTS`, and both appear below in that form.
-- Run-once is the migration journal's job (`wrangler d1 migrations apply`), the
-- same contract 0122, 0124, 0125 and 0127 rely on.
--
-- NO NEW INDEX on the sites themselves. Every read of this table is
-- `WHERE user_id = ? AND deleted_at IS NULL ORDER BY date DESC`, which
-- `idx_body_measurements_user_date` already serves; a per-site index would pay
-- write cost on 41 sparse columns to serve a query nothing issues.
--
-- NO new `updated_at` / soft-delete plumbing: the columns ride the existing ones
-- and the delta-sync cursor is unchanged.
--
-- ========================= NOT APPLIED / NOT DEPLOYED ======================
--
-- Written but NOT run against any D1 and NOT deployed. Until it is applied,
-- `POST /health/measurements` keeps stripping these keys and answering 200 and
-- `GET /health/measurements` keeps omitting them, so a comprehensive site logged
-- on a handset lives in the offline cache and reconciles away on the first
-- successful read. `PATCH /health/measurements/:id` — which lets one site be
-- cleared out of a shared row instead of deleting the whole row — ships in the
-- same wave and is 404 until then.
--
-- Health-brand Worker only (`symply-health-api`), like 0119.

-- ------------------------- Arms (donor: 10 per pair) -----------------------
-- `left_arm` / `right_arm` already hold the bicep AT ITS WIDEST (donor
-- `*ArmUpper`); these are the second point up the same limb.
ALTER TABLE body_measurements ADD COLUMN left_arm_mid REAL;
ALTER TABLE body_measurements ADD COLUMN right_arm_mid REAL;

-- `left_forearm` / `right_forearm` already hold max forearm girth (donor
-- `*ForearmUpper`); these are mid-forearm.
ALTER TABLE body_measurements ADD COLUMN left_forearm_mid REAL;
ALTER TABLE body_measurements ADD COLUMN right_forearm_mid REAL;

-- Wrist at stylion level. The donor's legacy single `wrist` recorded per side,
-- because a dominant hand is measurably thicker and one number hides it.
ALTER TABLE body_measurements ADD COLUMN left_wrist REAL;
ALTER TABLE body_measurements ADD COLUMN right_wrist REAL;

-- ------------------------- Legs (donor: 16 per pair) -----------------------
-- `left_thigh` / `right_thigh` already hold the upper thigh at the gluteal fold
-- (donor `*ThighUpper`); these are the two points below it.
ALTER TABLE body_measurements ADD COLUMN left_thigh_mid REAL;
ALTER TABLE body_measurements ADD COLUMN right_thigh_mid REAL;
ALTER TABLE body_measurements ADD COLUMN left_thigh_lower REAL;
ALTER TABLE body_measurements ADD COLUMN right_thigh_lower REAL;

-- Knee circumference. Tracked on its own because it moves with swelling rather
-- than with training, which is what makes a knee/thigh pair readable at all.
ALTER TABLE body_measurements ADD COLUMN left_knee REAL;
ALTER TABLE body_measurements ADD COLUMN right_knee REAL;

-- `left_calf` / `right_calf` already hold max calf girth (donor `*CalfUpper`).
ALTER TABLE body_measurements ADD COLUMN left_calf_mid REAL;
ALTER TABLE body_measurements ADD COLUMN right_calf_mid REAL;
ALTER TABLE body_measurements ADD COLUMN left_calf_lower REAL;
ALTER TABLE body_measurements ADD COLUMN right_calf_lower REAL;

-- Ankle, minimum girth above the malleoli. Donor legacy `ankle`, per side.
ALTER TABLE body_measurements ADD COLUMN left_ankle REAL;
ALTER TABLE body_measurements ADD COLUMN right_ankle REAL;

-- ----------------------- Belly / core (donor: 8) ---------------------------
-- `waist` already holds the NARROWEST natural waist (donor `waistNarrowest`).
-- These are the three fixed-landmark belly points the donor tracks alongside it,
-- and the reason it tracks them is that the narrowest point MIGRATES as a body
-- changes, so it is the one belly figure that cannot be compared to itself.
ALTER TABLE body_measurements ADD COLUMN waist_navel REAL;   -- at the umbilicus
ALTER TABLE body_measurements ADD COLUMN waist_upper REAL;   -- 5 cm above navel
ALTER TABLE body_measurements ADD COLUMN waist_lower REAL;   -- 5 cm below navel

-- Donor `iliacCircumference`, at the iliac crest. Named `iliac` rather than
-- `iliac_circumference` because every other length column here is a
-- circumference and none of them says so — `waist`, not `waist_circumference`.
ALTER TABLE body_measurements ADD COLUMN iliac REAL;

-- -------------------- Chest, back (donor: 5, 2 not ported) -----------------
-- `chest` already holds the full chest at the nipple line (donor `chestFull`).
ALTER TABLE body_measurements ADD COLUMN chest_upper REAL;   -- above nipple line
ALTER TABLE body_measurements ADD COLUMN chest_under REAL;   -- under-bust / rib cage

-- Across-back, scapula to scapula. A surface path, unlike the donor's
-- `hipWidth` / `chestDepth` — see DEVIATION 1(b).
ALTER TABLE body_measurements ADD COLUMN back_width REAL;

-- ----------------------- Whole-body lengths (donor: 2) ---------------------
-- Donor legacy `torsoLength` / `inseam`. Both are in the donor's own manual
-- entry sheet ("Other" section) and neither had a column here.
ALTER TABLE body_measurements ADD COLUMN torso_length REAL;
ALTER TABLE body_measurements ADD COLUMN inseam REAL;
