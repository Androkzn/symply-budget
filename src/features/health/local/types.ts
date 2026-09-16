/**
 * Row shapes for the 8 Wave A ledger tables — Stage He1.
 *
 * These mirror `backend/src/db/schema-health.ts` column-for-column (snake_case
 * preserved, because the ledger stores the D1 row verbatim and the projection
 * buckets on the D1 column names in `schema.ts`). Nullable D1 columns are
 * optional here; `NOT NULL` columns are required.
 *
 * `deleted_at` is present on seven of the eight because the ledger's tombstone
 * is authoritative — the column is carried so a restored backup and a D1 export
 * round-trip without losing the server's own soft-delete marker.
 */

/** Fields every ledgered Health row carries. */
export interface HealthLedgerRowBase {
  id: string;
  user_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** `source` provenance. `'healthkit'` only appears from He11a (Wave B). */
export type HealthEntrySource = 'manual' | 'healthkit' | 'import' | string;

export interface LocalWeightEntry extends HealthLedgerRowBase {
  date: string;
  weight: number;
  unit: string;
  note?: string | null;
  source: HealthEntrySource;
}

/**
 * NOTE: `water_entries` has NO `source` column (verified against
 * `schema-health.ts`). HealthKit water is therefore out of Wave B until a
 * migration adds one — plan §1.5 row 2 and §11 Q2.
 */
export interface LocalWaterEntry extends HealthLedgerRowBase {
  date: string;
  amount_ml: number;
  beverage_type: string;
  container?: string | null;
}

export interface LocalNutritionEntry extends HealthLedgerRowBase {
  date: string;
  food_name: string;
  portion: number;
  unit: string;
  meal_type: string;
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
  food_id?: string | null;
  base_calories_per_100?: number | null;
  base_proteins_per_100?: number | null;
  base_carbs_per_100?: number | null;
  base_fats_per_100?: number | null;
  detected_category?: string | null;
  is_processed?: number | null;
  source_recipe_id?: string | null;
  source: HealthEntrySource;
}

/** Activity / sleep / steps — discriminated by `entry_type`, payload in `data`. */
export interface LocalHealthEntry extends HealthLedgerRowBase {
  date: string;
  entry_type: string;
  data: string;
  source: HealthEntrySource;
  intensity?: string | null;
}

/**
 * `body_measurements` is 40+ optional numeric columns. They are enumerated
 * rather than indexed so a typo is a compile error and the He3 port cannot
 * silently drop a girth site.
 */
export interface LocalBodyMeasurement extends HealthLedgerRowBase {
  date: string;
  unit: string;
  chest?: number | null;
  waist?: number | null;
  hips?: number | null;
  neck?: number | null;
  shoulders?: number | null;
  body_fat_percentage?: number | null;
  left_arm?: number | null;
  right_arm?: number | null;
  left_arm_mid?: number | null;
  right_arm_mid?: number | null;
  left_forearm?: number | null;
  right_forearm?: number | null;
  left_forearm_mid?: number | null;
  right_forearm_mid?: number | null;
  left_wrist?: number | null;
  right_wrist?: number | null;
  left_thigh?: number | null;
  right_thigh?: number | null;
  left_thigh_mid?: number | null;
  right_thigh_mid?: number | null;
  left_thigh_lower?: number | null;
  right_thigh_lower?: number | null;
  left_knee?: number | null;
  right_knee?: number | null;
  left_calf?: number | null;
  right_calf?: number | null;
  left_calf_mid?: number | null;
  right_calf_mid?: number | null;
  left_calf_lower?: number | null;
  right_calf_lower?: number | null;
  left_ankle?: number | null;
  right_ankle?: number | null;
  waist_navel?: number | null;
  waist_upper?: number | null;
  waist_lower?: number | null;
  iliac?: number | null;
  chest_upper?: number | null;
  chest_under?: number | null;
  back_width?: number | null;
  torso_length?: number | null;
  inseam?: number | null;
}

export interface LocalUserHabit extends HealthLedgerRowBase {
  template_id?: string | null;
  name: string;
  icon: string;
  category: string;
  time_of_day: string;
  frequency: string;
  custom_days?: string | null;
  reminder_time?: string | null;
  reminder_enabled?: number | null;
  target_duration?: number | null;
  notes?: string | null;
  is_archived?: number | null;
  sort_order: number;
}

/** `unique(habit_id, date)` — deterministic id, see `ids.ts`. */
export interface LocalHabitLog extends HealthLedgerRowBase {
  habit_id?: string | null;
  date: string;
  time_of_day: string;
  completed_at: string;
  duration?: number | null;
  notes?: string | null;
}

/**
 * `unique(user_id, effective_date)` — deterministic id, see `ids.ts`.
 *
 * Wide by design: calories/macros carry both a daily value and a per-weekday
 * override set, plus the profile fields the calculators need.
 */
export interface LocalHealthGoal extends HealthLedgerRowBase {
  effective_date: string;
  daily_calories: number;
  use_per_day_calories?: number | null;
  monday_calories?: number | null;
  tuesday_calories?: number | null;
  wednesday_calories?: number | null;
  thursday_calories?: number | null;
  friday_calories?: number | null;
  saturday_calories?: number | null;
  sunday_calories?: number | null;
  daily_protein_grams?: number | null;
  daily_carbs_grams?: number | null;
  daily_fats_grams?: number | null;
  use_per_day_macros?: number | null;
  monday_protein_grams?: number | null;
  monday_carbs_grams?: number | null;
  monday_fats_grams?: number | null;
  tuesday_protein_grams?: number | null;
  tuesday_carbs_grams?: number | null;
  tuesday_fats_grams?: number | null;
  wednesday_protein_grams?: number | null;
  wednesday_carbs_grams?: number | null;
  wednesday_fats_grams?: number | null;
  thursday_protein_grams?: number | null;
  thursday_carbs_grams?: number | null;
  thursday_fats_grams?: number | null;
  friday_protein_grams?: number | null;
  friday_carbs_grams?: number | null;
  friday_fats_grams?: number | null;
  saturday_protein_grams?: number | null;
  saturday_carbs_grams?: number | null;
  saturday_fats_grams?: number | null;
  sunday_protein_grams?: number | null;
  sunday_carbs_grams?: number | null;
  sunday_fats_grams?: number | null;
  daily_water_ml?: number | null;
  daily_steps?: number | null;
  daily_active_calories?: number | null;
  daily_workout_minutes?: number | null;
  daily_sleep_hours?: number | null;
  exclude_burned_calories?: number | null;
  target_weight_kg?: number | null;
  weight_goal_type?: string | null;
  starting_weight_kg?: number | null;
  starting_weight_date?: string | null;
  height_cm?: number | null;
  gender?: string | null;
  birth_year?: number | null;
  activity_level?: string | null;
  water_unit?: string | null;
  unit_system?: string | null;
}

/**
 * The personal household binding (plan §1.2).
 *
 * One implicit household per user, N devices. There is deliberately no member
 * list: the control plane refuses a second `user_id` (He5), and Settings copy
 * says "your other device", never "invite a member".
 */
export interface LocalHealthHousehold {
  id: string;
  userId: string;
  createdAt: string;
}
