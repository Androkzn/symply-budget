-- Symply Health — WORKOUT LIBRARY (exercise catalogue).
--
-- Ported from the donor Worker (`~/Desktop/Symply Ecosystem/Simply Health/backend/`):
--   006_video_analysis.sql        → exercise_library (table + 26 seed rows)
--   013_yoga_mobility_exercises.sql → 55 further yoga/stretch/mobility/rehab rows
--   008_difficulty_levels.sql     → the 5-star `level1..level5` difficulty scale
--
-- Conventions carried from 0119/0120: soft deletes + `updated_at` everywhere so
-- the delta-sync cursor can carry a tombstone, and `users` is the PLATFORM users
-- table.
--
-- Deviations from the donor, and why:
--   * The donor's library was a VIDEO library (workout_videos, custom uploads,
--     watch history, sharing). Videos and video analysis are P4 media and are
--     deliberately absent. What is ported is the part the RN app has none of: the
--     EXERCISE CATALOGUE the donor kept in `exercise_library`.
--   * `name_ru` / Cyrillic aliases are dropped. They existed so the donor's
--     Russian-language video analyser could name-match a detected movement; this
--     surface is a browse/search catalogue and the app ships English copy.
--   * NEW `body_parts`: the donor stored only muscle groups, but the injury gate
--     reads `/health/injuries/active-body-parts`, whose vocabulary is JOINTS
--     (knee, wrist, shoulder). Without it a wrist injury could not flag a push-up,
--     whose muscles are chest/triceps. This column is what makes the safety
--     surface work; see `services/health-exercise-service.ts`.
--   * NEW `workout_type` + `default_minutes`: "log this" writes a real session
--     through the EXISTING `/health/entries/workouts` route, which needs a
--     `workout_type` from the app's own enum. Seeding it here keeps the mapping
--     out of the client.
--   * `media_url` is the donor's `video_reference_url`, kept as the P4 landing
--     spot and seeded NULL — no third-party media is committed. `illustration`
--     is a Symply Health icon-kit key, which is what actually renders today.
--
-- The catalogue is GLOBAL and read-only over HTTP: it is authored here, in
-- migrations. Only `exercise_favorites` is user-writable, and every row of it is
-- scoped to the authenticated user like the rest of the Health domain (BRD §7).

-- ============ Catalogue (global, seeded, read-only over HTTP) ============
CREATE TABLE IF NOT EXISTS exercise_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- JSON array of search synonyms. The donor used these for name matching; here
  -- they widen text search so "press up" finds "Push-up".
  aliases TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL CHECK (category IN (
    'strength', 'cardio', 'yoga', 'stretching', 'mobility', 'rehabilitation', 'recovery'
  )),
  -- JSON arrays of muscle tokens (chest, quads, lower_back, …).
  muscle_groups TEXT NOT NULL DEFAULT '[]',
  secondary_muscles TEXT NOT NULL DEFAULT '[]',
  -- JSON array of equipment tokens (none, dumbbells, yoga_mat, …).
  equipment TEXT NOT NULL DEFAULT '[]',
  -- JSON array of JOINT tokens the movement loads — the injury-gate vocabulary.
  body_parts TEXT NOT NULL DEFAULT '[]',
  difficulty TEXT NOT NULL DEFAULT 'level1' CHECK (difficulty IN (
    'level1', 'level2', 'level3', 'level4', 'level5'
  )),
  instructions TEXT,
  -- Symply Health icon-kit key; degrades to the Ionicons fallback when missing.
  illustration TEXT,
  -- P4 video/animation reference. Seeded NULL on purpose.
  media_url TEXT,
  default_minutes INTEGER NOT NULL DEFAULT 10,
  -- Mirrors the app's WorkoutType enum so "log this" can post a valid session.
  workout_type TEXT NOT NULL DEFAULT 'strength' CHECK (workout_type IN (
    'walk', 'run', 'strength', 'cycle', 'swim', 'yoga', 'other'
  )),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_exercise_library_category ON exercise_library(category);
CREATE INDEX IF NOT EXISTS idx_exercise_library_difficulty ON exercise_library(difficulty);
CREATE INDEX IF NOT EXISTS idx_exercise_library_name ON exercise_library(name);

-- ============ Favourites (user-scoped, soft-deleted) ============
-- Un-favouriting SOFT deletes so the delete propagates on the next sync pull;
-- re-favouriting resurrects the same row (UNIQUE(user_id, exercise_id)) rather
-- than accumulating a tombstone per toggle.
CREATE TABLE IF NOT EXISTS exercise_favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(user_id, exercise_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercise_library(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exercise_favorites_user ON exercise_favorites(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_exercise_favorites_sync ON exercise_favorites(user_id, updated_at);

-- ============ Seed catalogue ============
-- 88 movements across the seven categories. `INSERT OR IGNORE` so re-running the
-- migration against a partially-seeded D1 is a no-op rather than a PK collision.

INSERT OR IGNORE INTO exercise_library
  (id, name, aliases, category, muscle_groups, secondary_muscles, equipment, body_parts, difficulty, workout_type, illustration, default_minutes, instructions)
VALUES
-- ---------------------------- STRENGTH ----------------------------
('ex_pushup', 'Push-up', '["push up","pushups","press up"]', 'strength', '["chest","triceps"]', '["shoulders","abs"]', '["none"]', '["shoulder","elbow","wrist"]', 'level2', 'strength', 'strength', 8,
 'Start in a high plank with hands under the shoulders. Lower until the chest is a fist above the floor, keeping the ribs down and hips level, then press back up.'),
('ex_squat', 'Squat', '["squats","air squat","bodyweight squat"]', 'strength', '["quads","glutes"]', '["hamstrings","abs"]', '["none","barbell","dumbbells"]', '["knee","hip","lower_back","ankle"]', 'level2', 'strength', 'strength', 10,
 'Stand feet shoulder-width apart. Sit the hips back and down until the thighs are roughly parallel, knees tracking over the toes, then drive through the whole foot to stand.'),
('ex_lunges', 'Lunges', '["lunge","walking lunges","forward lunge"]', 'strength', '["quads","glutes"]', '["hamstrings","calves"]', '["none","dumbbells"]', '["knee","hip","ankle"]', 'level2', 'strength', 'strength', 10,
 'Step forward and lower until both knees are near 90 degrees, front shin vertical. Push through the front heel to return, then alternate legs.'),
('ex_plank', 'Plank', '["front plank","forearm plank"]', 'strength', '["abs","obliques"]', '["shoulders","back"]', '["none","yoga_mat"]', '["shoulder","lower_back","wrist"]', 'level2', 'strength', 'strength', 5,
 'Rest on the forearms and toes with a straight line from head to heels. Squeeze the glutes and brace the abs so the lower back never sags. Breathe steadily.'),
('ex_deadlift', 'Deadlift', '["deadlifts","conventional deadlift"]', 'strength', '["back","glutes","hamstrings"]', '["quads","forearms"]', '["barbell","dumbbells","kettlebell"]', '["lower_back","hip","knee"]', 'level4', 'strength', 'strength', 15,
 'Hinge at the hips with a flat back and the bar over mid-foot. Brace, then stand tall by driving the floor away — the bar stays close to the legs the whole way.'),
('ex_bench_press', 'Bench Press', '["bench","chest press"]', 'strength', '["chest"]', '["triceps","shoulders"]', '["barbell","dumbbells","bench"]', '["shoulder","elbow","wrist"]', 'level3', 'strength', 'strength', 15,
 'Lie on the bench with feet planted and shoulder blades pinned back. Lower the bar to the lower chest with elbows about 45 degrees, then press up and slightly back.'),
('ex_pull_up', 'Pull-up', '["pullup","chin up","chinup"]', 'strength', '["back","biceps"]', '["shoulders","forearms"]', '["pull_up_bar"]', '["shoulder","elbow","wrist"]', 'level4', 'strength', 'strength', 10,
 'Hang with hands just outside the shoulders. Pull the elbows down and back until the chin clears the bar, then lower under control to a full hang.'),
('ex_bicep_curl', 'Bicep Curl', '["curl","curls","biceps curl"]', 'strength', '["biceps"]', '["forearms"]', '["dumbbells","barbell","cables"]', '["elbow","wrist"]', 'level1', 'strength', 'strength', 8,
 'Stand tall with the elbows pinned to the ribs. Curl the weight up without swinging the torso, pause at the top and lower slowly.'),
('ex_tricep_dip', 'Tricep Dip', '["dips","dip","bench dip"]', 'strength', '["triceps"]', '["shoulders","chest"]', '["bench","none"]', '["shoulder","elbow","wrist"]', 'level3', 'strength', 'strength', 8,
 'Hands on a bench behind you, legs out front. Bend the elbows straight back until the upper arms are near parallel, then press back up. Stop short of any shoulder pinch.'),
('ex_shoulder_press', 'Shoulder Press', '["overhead press","military press"]', 'strength', '["shoulders"]', '["triceps"]', '["dumbbells","barbell"]', '["shoulder","elbow","neck"]', 'level3', 'strength', 'strength', 12,
 'Start with the weight at shoulder height and the ribs down. Press overhead until the arms lock out beside the ears, then lower under control.'),
('ex_russian_twist', 'Russian Twist', '["twists","seated twist"]', 'strength', '["obliques","abs"]', '[]', '["none","medicine_ball"]', '["lower_back","hip"]', 'level2', 'strength', 'strength', 6,
 'Sit with the knees bent and lean back to about 45 degrees. Rotate the ribcage side to side, tapping the floor beside each hip. Move from the trunk, not the arms.'),
('ex_leg_raise', 'Leg Raise', '["leg raises","hanging leg raise"]', 'strength', '["abs","hip_flexors"]', '[]', '["none","pull_up_bar"]', '["lower_back","hip"]', 'level2', 'strength', 'strength', 6,
 'Lie flat with the hands under the hips. Press the lower back into the floor and raise straight legs to vertical, then lower only as far as the back stays flat.'),
('ex_crunches', 'Crunches', '["crunch","abdominal crunch"]', 'strength', '["abs"]', '[]', '["none","yoga_mat"]', '["neck","lower_back"]', 'level1', 'strength', 'strength', 6,
 'Lie with knees bent and hands light behind the head. Curl the shoulder blades off the floor by shortening the abs — the neck stays long and the chin off the chest.'),
('ex_hip_thrust', 'Hip Thrust', '["glute bridge","barbell hip thrust"]', 'strength', '["glutes"]', '["hamstrings"]', '["none","barbell","bench"]', '["hip","lower_back"]', 'level2', 'strength', 'strength', 12,
 'Upper back on a bench, feet flat. Drive the hips up until the torso is parallel to the floor, squeeze the glutes hard, then lower without arching the lower back.'),
('ex_calf_raise', 'Calf Raise', '["calf raises","heel raise"]', 'strength', '["calves"]', '[]', '["none","dumbbells"]', '["ankle","foot"]', 'level1', 'strength', 'strength', 6,
 'Stand tall, rise onto the balls of the feet as high as possible, pause for a beat and lower slowly through the full range.'),
('ex_kettlebell_swing', 'Kettlebell Swing', '["swing","kb swing"]', 'strength', '["glutes","hamstrings"]', '["back","shoulders"]', '["kettlebell"]', '["lower_back","hip","shoulder"]', 'level3', 'strength', 'strength', 10,
 'Hinge at the hips and hike the bell back between the legs. Snap the hips forward to float it to chest height — the arms only steer, they never lift.'),
('ex_rowing', 'Bent-over Row', '["bent over row","barbell row","row"]', 'strength', '["back","biceps"]', '["shoulders","forearms"]', '["barbell","dumbbells"]', '["lower_back","shoulder","elbow"]', 'level3', 'strength', 'strength', 12,
 'Hinge to about 45 degrees with a flat back. Pull the weight to the lower ribs, leading with the elbows, then lower under control without rounding.'),
('ex_lateral_raise', 'Lateral Raise', '["side raise","lateral raises"]', 'strength', '["shoulders"]', '[]', '["dumbbells"]', '["shoulder","elbow"]', 'level2', 'strength', 'strength', 8,
 'Stand tall with a soft bend in the elbows. Lift the weights out to shoulder height, lead with the elbows rather than the hands, then lower slowly.'),
('ex_sit_up', 'Sit-up', '["situp","sit ups"]', 'strength', '["abs"]', '["hip_flexors"]', '["none","yoga_mat"]', '["neck","lower_back"]', 'level2', 'strength', 'strength', 6,
 'Knees bent, feet flat. Curl all the way up to a tall seated position leading with the chest, then lower one vertebra at a time.'),
('ex_wall_sit', 'Wall Sit', '["wall squat","chair pose against wall"]', 'strength', '["quads","glutes"]', '["calves"]', '["none"]', '["knee","hip"]', 'level2', 'strength', 'strength', 5,
 'Back flat against a wall, slide down until the thighs are parallel and the knees sit over the ankles. Hold, breathing normally.'),

-- ----------------------------- CARDIO -----------------------------
('ex_burpees', 'Burpees', '["burpee"]', 'cardio', '["full_body"]', '[]', '["none"]', '["knee","shoulder","wrist","lower_back"]', 'level4', 'other', 'run', 10,
 'From standing, drop the hands down, jump the feet back to a plank, optionally add a push-up, jump the feet in and stand or jump up. Keep the spine long throughout.'),
('ex_jumping_jacks', 'Jumping Jacks', '["jumping jack","star jump"]', 'cardio', '["full_body"]', '[]', '["none"]', '["knee","ankle","shoulder"]', 'level1', 'other', 'run', 8,
 'Jump the feet wide while sweeping the arms overhead, then back together. Land softly through the middle of the foot.'),
('ex_mountain_climbers', 'Mountain Climbers', '["mountain climber"]', 'cardio', '["abs","quads"]', '["shoulders"]', '["none"]', '["shoulder","wrist","hip"]', 'level3', 'other', 'run', 8,
 'Hold a high plank with the shoulders over the wrists. Drive one knee towards the chest and switch, keeping the hips level and the back flat.'),
('ex_box_jump', 'Box Jump', '["box jumps","plyo jump"]', 'cardio', '["quads","glutes","calves"]', '[]', '["none"]', '["knee","ankle"]', 'level4', 'other', 'run', 10,
 'Dip the hips, swing the arms and jump onto the box, landing softly with the knees tracking over the toes. Step — never jump — back down.'),
('ex_high_knees', 'High Knees', '["high knee run","knee lifts"]', 'cardio', '["quads","hip_flexors"]', '["calves","abs"]', '["none"]', '["knee","hip","ankle"]', 'level2', 'other', 'run', 6,
 'Run on the spot bringing each knee to hip height. Stay tall on the balls of the feet with quick, light contacts.'),
('ex_brisk_walk', 'Brisk Walk', '["walking","power walk"]', 'cardio', '["quads","calves"]', '["glutes","hamstrings"]', '["none"]', '["knee","ankle","hip"]', 'level1', 'walk', 'walk', 30,
 'Walk at a pace where talking is possible but singing is not. Stand tall, roll heel to toe and let the arms swing from the shoulders.'),
('ex_easy_run', 'Easy Run', '["jog","jogging","running"]', 'cardio', '["quads","hamstrings","calves"]', '["glutes","abs"]', '["none"]', '["knee","ankle","hip"]', 'level3', 'run', 'run', 30,
 'Run at a conversational effort. Keep the cadence quick and the stride short so the foot lands under the hips rather than out in front.'),
('ex_stationary_cycle', 'Stationary Cycle', '["bike","cycling","spin"]', 'cardio', '["quads","glutes"]', '["hamstrings","calves"]', '["none"]', '["knee","hip"]', 'level2', 'cycle', 'movement', 30,
 'Set the saddle so the knee keeps a slight bend at the bottom of the stroke. Pedal smoothly with a relaxed grip and upright chest.'),
('ex_swim_freestyle', 'Freestyle Swim', '["swimming","front crawl"]', 'cardio', '["back","shoulders"]', '["abs","quads"]', '["none"]', '["shoulder","neck"]', 'level3', 'swim', 'movement', 30,
 'Keep the body long and flat, rotate from the hips and breathe to the side rather than lifting the head forward.'),
('ex_jump_rope', 'Jump Rope', '["skipping","skip rope"]', 'cardio', '["calves","quads"]', '["shoulders","forearms"]', '["none"]', '["ankle","knee","foot"]', 'level3', 'other', 'run', 10,
 'Turn the rope from the wrists, not the arms. Small hops on the balls of the feet — just enough to clear the rope.'),

-- ------------------------------ YOGA ------------------------------
('ex_childs_pose', 'Child''s Pose', '["balasana","childs pose"]', 'yoga', '["lower_back","hip_flexors"]', '["shoulders"]', '["yoga_mat"]', '["knee","lower_back","ankle"]', 'level1', 'yoga', 'stretch', 5,
 'Kneel with the big toes together and knees wide. Sit the hips back to the heels, walk the hands forward and let the forehead rest down. Breathe into the back ribs.'),
('ex_cat_cow', 'Cat-Cow Stretch', '["cat cow","marjaryasana"]', 'yoga', '["back","abs"]', '["shoulders","hip_flexors"]', '["yoga_mat"]', '["back","lower_back","wrist","knee"]', 'level1', 'yoga', 'stretch', 5,
 'On hands and knees, inhale and let the belly drop as the chest lifts, then exhale and round the spine towards the ceiling. Move with the breath.'),
('ex_cobra', 'Cobra Pose', '["cobra","bhujangasana"]', 'yoga', '["back","abs"]', '["shoulders","glutes"]', '["yoga_mat"]', '["lower_back","wrist","shoulder"]', 'level2', 'yoga', 'stretch', 5,
 'Lie face down with the hands under the shoulders. Press lightly and lift the chest, keeping the elbows bent and the shoulders drawing away from the ears.'),
('ex_upward_dog', 'Upward Facing Dog', '["up dog","urdhva mukha svanasana"]', 'yoga', '["back","chest"]', '["shoulders","abs"]', '["yoga_mat"]', '["lower_back","wrist","shoulder"]', 'level3', 'yoga', 'stretch', 5,
 'From face down, press the hands into the mat and straighten the arms so the thighs lift clear of the floor. Keep the shoulders back and the neck long.'),
('ex_downward_dog', 'Downward Dog', '["down dog","adho mukha svanasana"]', 'yoga', '["shoulders","hamstrings","calves"]', '["back"]', '["yoga_mat"]', '["shoulder","wrist","ankle"]', 'level2', 'yoga', 'stretch', 5,
 'From hands and knees, lift the hips up and back into an inverted V. Bend the knees as much as needed to keep the spine long rather than forcing the heels down.'),
('ex_warrior', 'Warrior Pose', '["warrior 1","warrior 2","virabhadrasana"]', 'yoga', '["quads","glutes"]', '["shoulders"]', '["yoga_mat"]', '["knee","hip","shoulder"]', 'level2', 'yoga', 'stretch', 6,
 'Step one foot back into a long stance. Bend the front knee over the ankle, ground the back foot and reach the arms up or out. Hold, then switch sides.'),
('ex_pigeon', 'Pigeon Pose', '["eka pada rajakapotasana","pigeon"]', 'yoga', '["hip_flexors","glutes"]', '["lower_back"]', '["yoga_mat"]', '["hip","knee","lower_back"]', 'level3', 'yoga', 'stretch', 6,
 'Bring one shin forward across the mat and extend the other leg straight back. Square the hips and fold forward only as far as the front knee stays comfortable.'),
('ex_tree_pose', 'Tree Pose', '["vrksasana","tree"]', 'yoga', '["calves","quads"]', '["abs","hip_flexors"]', '["yoga_mat"]', '["ankle","knee","hip"]', 'level2', 'yoga', 'stretch', 5,
 'Stand on one leg and place the other foot on the calf or inner thigh — never on the knee. Press foot and leg together, and fix the gaze on one point.'),
('ex_triangle', 'Triangle Pose', '["trikonasana","triangle"]', 'yoga', '["obliques","hamstrings"]', '["shoulders","hip_flexors"]', '["yoga_mat"]', '["hip","lower_back","knee"]', 'level2', 'yoga', 'stretch', 5,
 'From a wide stance, straighten the front leg and hinge sideways over it. Rest the lower hand on the shin and open the chest towards the ceiling.'),
('ex_extended_side_angle', 'Extended Side Angle', '["parsvakonasana","side angle"]', 'yoga', '["obliques","quads"]', '["shoulders","hip_flexors"]', '["yoga_mat"]', '["hip","knee","shoulder"]', 'level3', 'yoga', 'stretch', 5,
 'From a bent front knee, rest the forearm on the thigh and sweep the top arm over the ear. Lengthen from the back heel to the fingertips.'),
('ex_half_moon', 'Half Moon Pose', '["ardha chandrasana","half moon"]', 'yoga', '["glutes","obliques"]', '["shoulders","hamstrings"]', '["yoga_mat"]', '["ankle","hip","knee"]', 'level4', 'yoga', 'stretch', 5,
 'Balance on one leg with the hand on the floor or a block, lifting the other leg to hip height. Stack the hips and open the chest skywards.'),
('ex_bridge', 'Bridge Pose', '["setu bandhasana","bridge"]', 'yoga', '["glutes","lower_back"]', '["hamstrings","abs"]', '["yoga_mat"]', '["lower_back","hip","neck"]', 'level1', 'yoga', 'stretch', 5,
 'Lie on the back with the knees bent and feet hip-width. Press through the feet to lift the hips, keeping the neck still and the chin unpinned from the chest.'),
('ex_sphinx', 'Sphinx Pose', '["salamba bhujangasana","sphinx"]', 'yoga', '["lower_back","abs"]', '["shoulders"]', '["yoga_mat"]', '["lower_back","elbow"]', 'level1', 'yoga', 'stretch', 5,
 'Lie face down and prop up on the forearms with the elbows under the shoulders. Let the lower back settle into a gentle, pain-free curve.'),
('ex_locust', 'Locust Pose', '["salabhasana","locust"]', 'yoga', '["lower_back","glutes"]', '["hamstrings","shoulders"]', '["yoga_mat"]', '["lower_back","neck"]', 'level3', 'yoga', 'stretch', 5,
 'Lie face down with the arms alongside the body. Lift the chest, arms and legs a few inches, lengthening rather than crunching the lower back.'),
('ex_supported_fish', 'Supported Fish Pose', '["matsyasana","fish pose"]', 'yoga', '["chest","back"]', '["shoulders"]', '["yoga_mat"]', '["neck","back"]', 'level2', 'yoga', 'stretch', 6,
 'Lie back over a rolled mat or bolster placed along the spine. Let the arms fall open and the chest broaden. Support the head if the neck feels strained.'),
('ex_corpse', 'Corpse Pose', '["savasana","shavasana","final relaxation"]', 'yoga', '[]', '[]', '["yoga_mat"]', '[]', 'level1', 'yoga', 'recovery', 8,
 'Lie flat with the legs and arms relaxed and the palms up. Let the breath settle to its own rhythm and release the weight of the body into the floor.'),

-- --------------------------- STRETCHING ---------------------------
('ex_butterfly', 'Butterfly Stretch', '["baddha konasana","seated butterfly"]', 'stretching', '["adductors","hip_flexors"]', '["lower_back"]', '["yoga_mat"]', '["hip","knee"]', 'level1', 'yoga', 'stretch', 4,
 'Sit with the soles of the feet together and the heels a comfortable distance from the hips. Sit tall and let the knees drift down under their own weight.'),
('ex_seated_forward_fold', 'Seated Forward Fold', '["paschimottanasana","forward fold"]', 'stretching', '["hamstrings","lower_back"]', '["calves"]', '["yoga_mat"]', '["lower_back","hip","knee"]', 'level2', 'yoga', 'stretch', 4,
 'Sit with the legs straight. Hinge from the hips with a long spine and reach towards the feet, bending the knees a little rather than rounding the back.'),
('ex_standing_forward_fold', 'Standing Forward Fold', '["uttanasana","standing fold"]', 'stretching', '["hamstrings","lower_back"]', '["calves"]', '["yoga_mat","none"]', '["lower_back","hip","knee"]', 'level2', 'yoga', 'stretch', 4,
 'Stand with the feet hip-width. Soften the knees and fold from the hips, letting the head and arms hang heavy. Roll up slowly to finish.'),
('ex_reclined_twist', 'Reclined Spinal Twist', '["supta matsyendrasana","spinal twist"]', 'stretching', '["obliques","lower_back"]', '["glutes"]', '["yoga_mat"]', '["lower_back","back","hip"]', 'level1', 'yoga', 'stretch', 5,
 'Lie on the back, draw one knee in and guide it across the body. Keep both shoulders on the floor and turn the head the opposite way. Switch sides.'),
('ex_happy_baby', 'Happy Baby Pose', '["ananda balasana","happy baby"]', 'stretching', '["hip_flexors","lower_back"]', '["adductors"]', '["yoga_mat"]', '["hip","knee","lower_back"]', 'level1', 'yoga', 'stretch', 4,
 'On your back, draw the knees towards the armpits and hold the outer feet. Gently pull down while pressing the tailbone into the floor.'),
('ex_thread_needle', 'Thread the Needle', '["thread needle"]', 'stretching', '["back","shoulders"]', '["obliques"]', '["yoga_mat"]', '["shoulder","neck","back"]', 'level2', 'yoga', 'stretch', 4,
 'From hands and knees, slide one arm underneath the body and rest the shoulder and ear on the mat. Keep the hips stacked over the knees. Switch sides.'),
('ex_kneeling_hip_flexor', 'Kneeling Hip Flexor Stretch', '["hip flexor stretch","low lunge stretch"]', 'stretching', '["hip_flexors","quads"]', '["glutes"]', '["yoga_mat"]', '["hip","knee"]', 'level1', 'yoga', 'stretch', 4,
 'Half-kneel with the front foot flat. Tuck the tailbone under and shift gently forward until the front of the back hip lengthens. Switch sides.'),
('ex_figure_four', 'Figure Four Stretch', '["figure 4","piriformis stretch"]', 'stretching', '["glutes","hip_flexors"]', '["lower_back"]', '["yoga_mat"]', '["hip","knee","lower_back"]', 'level1', 'yoga', 'stretch', 4,
 'Lie on the back, cross one ankle over the opposite thigh and draw that thigh towards the chest. Keep the head and shoulders relaxed on the floor.'),
('ex_side_lying_twist', 'Side Lying Twist', '["side twist","open book"]', 'stretching', '["obliques","lower_back"]', '["chest"]', '["yoga_mat"]', '["lower_back","back","shoulder"]', 'level1', 'yoga', 'stretch', 4,
 'Lie on one side with the knees stacked and bent. Open the top arm across the body towards the floor, following it with the eyes. Switch sides.'),
('ex_neck_stretch', 'Neck Stretch', '["lateral neck stretch","neck side bend"]', 'stretching', '["back"]', '["shoulders"]', '["none"]', '["neck"]', 'level1', 'yoga', 'stretch', 3,
 'Sit or stand tall. Drop one ear towards the shoulder without lifting that shoulder, and let the opposite arm hang heavy. Hold, then switch sides.'),
('ex_standing_quad_stretch', 'Standing Quad Stretch', '["quad stretch"]', 'stretching', '["quads"]', '["hip_flexors"]', '["none"]', '["knee","hip","ankle"]', 'level1', 'yoga', 'stretch', 3,
 'Stand on one leg, catch the other ankle behind you and draw the knee down beside the standing leg. Keep the hips level and the tailbone tucked.'),
('ex_standing_hamstring', 'Standing Hamstring Stretch', '["hamstring stretch"]', 'stretching', '["hamstrings"]', '["calves","lower_back"]', '["none"]', '["hip","knee","lower_back"]', 'level1', 'yoga', 'stretch', 3,
 'Place one heel on a low step with the leg straight. Hinge forward from the hips with a flat back until the back of the thigh lengthens.'),
('ex_standing_calf_stretch', 'Standing Calf Stretch', '["calf stretch"]', 'stretching', '["calves"]', '[]', '["none"]', '["ankle","foot","knee"]', 'level1', 'yoga', 'stretch', 3,
 'Face a wall, step one foot back with the heel down and the toes pointing forward. Lean in until the back calf lengthens. Switch sides.'),
('ex_chest_doorway_stretch', 'Doorway Chest Stretch', '["chest stretch","pec stretch"]', 'stretching', '["chest"]', '["shoulders"]', '["none"]', '["shoulder","chest"]', 'level1', 'yoga', 'stretch', 3,
 'Place the forearms on a doorframe with the elbows at shoulder height. Step one foot through and lean gently until the chest opens.'),
('ex_cross_body_shoulder', 'Cross-body Shoulder Stretch', '["shoulder stretch"]', 'stretching', '["shoulders"]', '["back"]', '["none"]', '["shoulder","elbow"]', 'level1', 'yoga', 'stretch', 3,
 'Bring one arm straight across the chest and hook it with the other forearm. Draw it in without shrugging the shoulder. Switch sides.'),
('ex_tricep_overhead', 'Overhead Tricep Stretch', '["tricep stretch"]', 'stretching', '["triceps"]', '["shoulders"]', '["none"]', '["shoulder","elbow"]', 'level1', 'yoga', 'stretch', 3,
 'Reach one hand down the middle of the back and use the other to guide the elbow gently towards the head. Keep the ribs down. Switch sides.'),
('ex_reclining_bound_angle', 'Reclining Bound Angle', '["supta baddha konasana","reclining butterfly"]', 'stretching', '["adductors","hip_flexors"]', '["lower_back"]', '["yoga_mat"]', '["hip","knee"]', 'level1', 'yoga', 'stretch', 6,
 'Lie back with the soles of the feet together and the knees falling open. Support the outer thighs with cushions and rest here, breathing slowly.'),

-- ---------------------------- MOBILITY ----------------------------
('ex_hip_circles', 'Hip Circles', '["hip rotations"]', 'mobility', '["hip_flexors","glutes"]', '["adductors"]', '["yoga_mat","none"]', '["hip","lower_back"]', 'level1', 'other', 'movement', 4,
 'Stand or kneel tall and draw slow circles with one knee, exploring the full range of the hip socket without letting the lower back move.'),
('ex_shoulder_circles', 'Shoulder Circles', '["shoulder rotations","arm circles"]', 'mobility', '["shoulders"]', '["back"]', '["none"]', '["shoulder","neck"]', 'level1', 'other', 'movement', 3,
 'Roll the shoulders slowly up, back and down, then reverse. Keep the neck relaxed and the movement smooth rather than snapped.'),
('ex_ankle_circles', 'Ankle Circles', '["ankle rotations"]', 'mobility', '["calves"]', '[]', '["none"]', '["ankle","foot"]', 'level1', 'other', 'movement', 3,
 'Lift one foot and trace slow circles with the toes in both directions, moving only at the ankle.'),
('ex_wrist_circles', 'Wrist Circles', '["wrist rotations"]', 'mobility', '["forearms"]', '[]', '["none"]', '["wrist","elbow"]', 'level1', 'other', 'movement', 3,
 'Interlace the fingers or make loose fists and circle the wrists slowly both ways. A good warm-up before any hands-on-the-floor work.'),
('ex_thoracic_rotation', 'Thoracic Spine Rotation', '["thoracic rotation","open book rotation"]', 'mobility', '["back","obliques"]', '["shoulders"]', '["yoga_mat"]', '["back","shoulder","lower_back"]', 'level2', 'other', 'movement', 5,
 'Half-kneel or side-lie with the hips locked in place. Rotate the ribcage and reach one arm around, letting the eyes follow the hand.'),
('ex_wall_angel', 'Wall Angel', '["wall slides"]', 'mobility', '["shoulders","back"]', '["chest"]', '["none"]', '["shoulder","neck","back"]', 'level2', 'other', 'movement', 4,
 'Stand with the back, head and arms against a wall. Slide the arms up and down keeping every contact point touching. Stop where contact is lost.'),
('ex_foam_roll_back', 'Foam Rolling — Back', '["foam roll back","myofascial release back"]', 'mobility', '["back"]', '["lower_back"]', '["foam_roller"]', '["back","lower_back"]', 'level2', 'other', 'movement', 5,
 'Lie with the roller across the upper back, hips down. Roll slowly between the shoulder blades and the mid back — never over the lower back.'),
('ex_foam_roll_it_band', 'Foam Rolling — IT Band', '["foam roll it band","iliotibial band"]', 'mobility', '["quads","glutes"]', '["hip_flexors"]', '["foam_roller"]', '["hip","knee"]', 'level3', 'other', 'movement', 5,
 'Lie on one side with the roller under the outer thigh. Roll slowly between the hip and just above the knee, pausing on tender spots.'),
('ex_foam_roll_quads', 'Foam Rolling — Quads', '["foam roll quads"]', 'mobility', '["quads"]', '["hip_flexors"]', '["foam_roller"]', '["knee","hip"]', 'level2', 'other', 'movement', 5,
 'Lie face down with the roller under the front of the thighs. Roll from hip to just above the knee, keeping the abs braced.'),
('ex_foam_roll_calves', 'Foam Rolling — Calves', '["foam roll calves"]', 'mobility', '["calves"]', '[]', '["foam_roller"]', '["ankle","knee"]', 'level1', 'other', 'movement', 4,
 'Sit with the roller under the calves and the hands behind you. Lift the hips and roll from ankle to just below the knee.'),

-- ------------------------- REHABILITATION -------------------------
('ex_pelvic_tilt', 'Pelvic Tilt', '["pelvic tilts"]', 'rehabilitation', '["abs","lower_back"]', '["glutes"]', '["yoga_mat"]', '["lower_back","hip"]', 'level1', 'other', 'recovery', 4,
 'Lie with the knees bent. Flatten the lower back into the floor by tilting the pelvis, hold for a breath, then release. Small, controlled movement only.'),
('ex_dead_bug', 'Dead Bug', '["deadbug"]', 'rehabilitation', '["abs","hip_flexors"]', '["lower_back"]', '["yoga_mat"]', '["lower_back","hip"]', 'level2', 'other', 'recovery', 5,
 'On your back with arms up and knees at 90 degrees, lower one arm and the opposite leg while keeping the lower back glued to the floor. Alternate.'),
('ex_bird_dog', 'Bird Dog', '["birddog","quadruped opposite arm leg"]', 'rehabilitation', '["lower_back","abs"]', '["glutes","shoulders"]', '["yoga_mat"]', '["lower_back","shoulder","knee","wrist"]', 'level2', 'other', 'recovery', 5,
 'From hands and knees, extend one arm and the opposite leg until level with the torso. Keep the hips square and the neck long, then switch.'),
('ex_kegel', 'Pelvic Floor Squeeze', '["kegel","kegels","pelvic floor"]', 'rehabilitation', '["hip_flexors"]', '["abs"]', '["none"]', '["hip"]', 'level1', 'other', 'recovery', 4,
 'Draw the pelvic floor gently up and in as if stopping a flow, hold for a few breaths and fully release. The glutes and jaw stay relaxed.'),
('ex_diaphragmatic_breathing', 'Diaphragmatic Breathing', '["belly breathing","breathing exercise","diaphragm breathing"]', 'rehabilitation', '[]', '[]', '["yoga_mat"]', '[]', 'level1', 'other', 'breathing', 5,
 'Lie down with one hand on the chest and one on the belly. Breathe so only the lower hand rises, then exhale slowly and completely.'),
('ex_lying_leg_raise', 'Lying Leg Raise', '["lying leg lift","straight leg raise"]', 'rehabilitation', '["hip_flexors","abs"]', '["quads"]', '["yoga_mat"]', '["hip","lower_back","knee"]', 'level1', 'other', 'recovery', 4,
 'Lie on your back with one knee bent. Keep the other leg straight and lift it to the height of the bent knee, then lower under control.'),
('ex_clamshell', 'Clamshell', '["clam shell","clams"]', 'rehabilitation', '["glutes"]', '["hip_flexors"]', '["yoga_mat","resistance_bands"]', '["hip","knee"]', 'level1', 'other', 'recovery', 4,
 'Lie on one side with the knees bent and stacked. Keeping the feet together, open the top knee without letting the pelvis roll back.'),
('ex_glute_bridge_single', 'Single-leg Glute Bridge', '["single leg bridge"]', 'rehabilitation', '["glutes"]', '["hamstrings","lower_back"]', '["yoga_mat"]', '["hip","lower_back","knee"]', 'level3', 'other', 'recovery', 5,
 'Set up for a bridge, then extend one leg. Lift the hips using only the planted leg, keeping the pelvis perfectly level. Switch sides.'),
('ex_prone_leg_lift', 'Prone Leg Lift', '["prone leg raise"]', 'rehabilitation', '["glutes","lower_back"]', '["hamstrings"]', '["yoga_mat"]', '["lower_back","hip"]', 'level1', 'other', 'recovery', 4,
 'Lie face down with the forehead on the hands. Squeeze one glute and lift that leg a few inches without arching the lower back. Alternate.'),
('ex_side_lying_leg_lift', 'Side-lying Leg Lift', '["side leg raise"]', 'rehabilitation', '["glutes","hip_flexors"]', '["obliques"]', '["yoga_mat"]', '["hip","knee"]', 'level1', 'other', 'recovery', 4,
 'Lie on one side in a straight line. Lift the top leg to about 45 degrees with the toes facing forward, then lower slowly. Switch sides.'),
('ex_wall_pushup', 'Wall Push-up', '["wall press up"]', 'rehabilitation', '["chest","triceps"]', '["shoulders"]', '["none"]', '["shoulder","elbow","wrist"]', 'level1', 'other', 'recovery', 5,
 'Stand an arm''s length from a wall with the hands at chest height. Bend the elbows to bring the chest towards the wall, then press away.'),
('ex_swimming', 'Swimming (Superman)', '["superman","prone swimming"]', 'rehabilitation', '["lower_back","glutes"]', '["shoulders","hamstrings"]', '["yoga_mat"]', '["lower_back","shoulder","neck"]', 'level2', 'other', 'recovery', 5,
 'Lie face down with the arms overhead. Lift one arm and the opposite leg a few inches and alternate in a slow, steady flutter.'),

-- ---------------------------- RECOVERY ----------------------------
('ex_legs_up_wall', 'Legs Up the Wall', '["viparita karani","legs up wall"]', 'recovery', '["hamstrings","lower_back"]', '[]', '["yoga_mat"]', '["lower_back","hip"]', 'level1', 'yoga', 'recovery', 10,
 'Sit side-on to a wall, swing the legs up and lie back. Rest the arms wide and stay for several minutes, breathing slowly.'),
('ex_box_breathing', 'Box Breathing', '["square breathing","4-4-4-4 breathing"]', 'recovery', '[]', '[]', '["none"]', '[]', 'level1', 'other', 'breathing', 5,
 'Inhale for four counts, hold for four, exhale for four, hold for four. Repeat, keeping every phase the same length and the shoulders soft.'),
('ex_body_scan', 'Body Scan Relaxation', '["progressive relaxation","body scan"]', 'recovery', '[]', '[]', '["yoga_mat"]', '[]', 'level1', 'other', 'mindfulness', 10,
 'Lie comfortably and move attention slowly from the feet to the head, noticing and softening each area in turn without trying to change it.');
