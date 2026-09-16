/**
 * Deterministic, seeded generator for a realistic Symply House Wave-A ledger.
 *
 * WHY A PINNED COMPOSITION TABLE
 * ------------------------------
 * Every House stage from H2 to H12 is judged by re-running this harness and
 * diffing the numbers. That comparison is only meaningful if the corpus is
 * byte-identical between runs, so the composition is a fixed table rather than
 * a heuristic, there is no `Date.now()` and no `Math.random()` anywhere, and
 * `house-generator.test.ts` pins the resulting totals, per-table counts, field
 * sets and per-row byte sizes.
 *
 *   rows(table) = fixed + adults*perAdult + years*perYear + adults*years*perAdultYear
 *
 * SIZING — AND WHAT IT IS AND IS NOT
 * ----------------------------------
 * The plan (§4, stage H10) states the expected envelope per table and says in
 * as many words: "These are **estimates, not measurements** — that is the point
 * of the stage." This table lands inside every one of those ranges and near the
 * middle of the Wave-A total:
 *
 *   5y / 2 adults  →  14,557 rows   (plan envelope 8,000–20,000)
 *   10y / 2 adults →  28,867 rows   (plan envelope 16,000–40,000)
 *
 * The cardinality drivers are House's, not Budget's:
 *   - `maintenanceCompletions` is House's `expenses` — one row per occurrence of
 *     every recurring task, and the table that actually accumulates.
 *   - `tasks` is the widest row in the fleet (~58 columns). Its cost is the
 *     COLUMN COUNT, not the row count: per-field LWW means one ~40-byte stamp
 *     per column per row, which is the N5 hazard (plan §1.6) this harness exists
 *     to put a number on.
 *   - `maintenanceSubtasks` follows AI enrichment at 3–5 per enriched task.
 *
 * MULTI-PROPERTY IS NOT MODELLED HERE, ON PURPOSE
 * -----------------------------------------------
 * The plan lists "× properties (1–3)" as a House-only multiplier. The engine
 * holds ONE ledger per property and `lf_rows` is keyed `(household_id, tbl,
 * row_key)`, so a second property is a second ledger — not more rows in this
 * one. Generating 3× rows into a single ledger would misrepresent the row-key
 * space and flatter every lookup. The baseline therefore reports the multiplier
 * as declared arithmetic over the measured single-property numbers, labelled as
 * such, and H5 turns it into a measurement.
 *
 * Row shapes mirror the real API types field-for-field; each factory cites the
 * interface it mirrors.
 */
import { createHash } from 'node:crypto';

import {
  HOUSE_LEDGER_TABLE_KEYS,
  HOUSE_LEDGER_TABLE_NAMES,
  type HouseLedgerTableName,
} from '../../../../../src/features/house/local/schema';
import type { StoredOperation } from '../../../src/store/types';

import {
  buildLwwMap,
  bulkDeleteDeltaOf,
  chance,
  cloneLedgerOf,
  lwwStampCountOf,
  pad2,
  pick,
  rngFor,
  rowIdAtOf,
  totalRowsOf,
  type CorpusRegistry,
  type CorpusRow,
} from './corpus-core';

export type ScaleRow = CorpusRow;

export const HOUSE_REGISTRY: CorpusRegistry<HouseLedgerTableName> = {
  tableNames: HOUSE_LEDGER_TABLE_NAMES,
  tableKeys: HOUSE_LEDGER_TABLE_KEYS,
};

/**
 * Structural stand-in for `HouseLedger`. The real type cannot be imported here:
 * `engine.ts` pulls `@api/*`, which does not resolve outside the mobile
 * tsconfig. Call sites cast `as never` into the projection functions, exactly as
 * the Budget harness already does.
 */
export type HouseScaleLedger = {
  version: 1;
  household: ScaleRow;
  memberId: string;
  deviceId: string;
  ops: StoredOperation[];
  lww?: Record<string, unknown>;
  conflicts?: unknown[];
  pendingEnrolment?: boolean;
  crypto?: Record<string, string | number>;
} & { [T in HouseLedgerTableName]: ScaleRow[] };

export type HouseScaleSpec = { years: number; adults?: number; seed?: number };
export type HouseScaleId = { years: number; adults: number; rows: number; ops: number };

/** Distinct from Budget's `0x5c41e` so a mixed-up seed is obvious in a record. */
export const HOUSE_DEFAULT_SEED = 0x0405e;
export const HOUSE_REFERENCE_SPEC: Required<HouseScaleSpec> = {
  years: 5,
  adults: 2,
  seed: HOUSE_DEFAULT_SEED,
};

/** First year of ownership. Fixed so dates — and therefore JSON sizes — never drift. */
const BASE_YEAR = 2021;
const HOUSEHOLD_ID = 'hh_local_4d7e2f9a1c6b8305';
const ISO = '2026-03-14T08:21:44.512Z';
const LOCAL_DEVICE_ID = 'dev_h1o2u3s4e5f6';

/** One device per member, matching how the op factory attributes authorship. */
export function memberIdsFor(adults: number): string[] {
  return Array.from({ length: adults }, (_, m) => `mem_${String(m).padStart(2, '0')}h7d3b52e`);
}

export function deviceIdsFor(adults: number): string[] {
  return Array.from({ length: adults }, (_, m) =>
    m === 0 ? LOCAL_DEVICE_ID : `dev_${String(m).padStart(2, '0')}b8f3d61e4a`,
  );
}

type Composition = { fixed: number; perAdult: number; perYear: number; perAdultYear: number };

const c = (fixed: number, perAdult = 0, perYear = 0, perAdultYear = 0): Composition => ({
  fixed,
  perAdult,
  perYear,
  perAdultYear,
});

/**
 * Rows per table. Totals by construction:
 *   fixed 236 · perAdult 15 · perYear 630 · perAdultYear 1,040
 *   5y/2a  = 236 + 30 + 3,150 + 10,400 = 14,557  ✓ plan envelope 8,000–20,000
 *   10y/2a = 236 + 30 + 6,300 + 20,800 = 28,867  ✓ plan envelope 16,000–40,000
 */
export const HOUSE_TABLE_COMPOSITION: Record<HouseLedgerTableName, Composition> = {
  // fixed — the property itself, set up once
  households: c(1),
  householdSpaces: c(18),
  homeFeatures: c(45),
  appliances: c(22),
  garbageSchedules: c(1),
  recurringChecklists: c(8),
  recurringChecklistItems: c(64),

  // per adult — one membership and one settings set each
  householdMembers: c(0, 1),
  settings: c(12, 14),

  // per year — the property's own calendar
  tasks: c(40, 0, 100, 126),
  applianceServiceHistory: c(0, 0, 30),
  seasonalChecklists: c(0, 0, 4),
  seasonalChecklistItems: c(0, 0, 48),
  checklistInstances: c(0, 0, 56),
  checklistItemCompletions: c(0, 0, 340),
  householdNotes: c(6, 0, 8),
  recurringReminders: c(0, 0, 24),
  taskDrafts: c(0, 0, 120),

  // per adult-year — the rows that actually accumulate
  maintenanceCompletions: c(0, 0, 0, 550),
  maintenanceSubtasks: c(0, 0, 0, 350),
  maintenanceTaskNotes: c(0, 0, 0, 40),
};

/**
 * Ops per row: one create plus a later edit on half of them, i.e. Budget's
 * measured 1.5 ops-per-row ratio. House has no independently observed ratio yet
 * — inheriting Budget's is a declared assumption, and the baseline says so.
 */
const OPS_PER_ROW_EXTRA = 0.5;

function resolved(spec: HouseScaleSpec): Required<HouseScaleSpec> {
  return {
    years: spec.years,
    adults: spec.adults ?? 2,
    seed: spec.seed ?? HOUSE_DEFAULT_SEED,
  };
}

export function rowCounts(spec: HouseScaleSpec): Record<HouseLedgerTableName, number> {
  const { years, adults } = resolved(spec);
  const out = {} as Record<HouseLedgerTableName, number>;
  for (const table of HOUSE_LEDGER_TABLE_NAMES) {
    const comp = HOUSE_TABLE_COMPOSITION[table];
    out[table] =
      comp.fixed +
      adults * comp.perAdult +
      years * comp.perYear +
      adults * years * comp.perAdultYear;
  }
  return out;
}

export function scaleId(spec: HouseScaleSpec): HouseScaleId {
  const { years, adults } = resolved(spec);
  const counts = rowCounts(spec);
  let rows = 0;
  for (const table of HOUSE_LEDGER_TABLE_NAMES) rows += counts[table];
  return { years, adults, rows, ops: rows + Math.round(rows * OPS_PER_ROW_EXTRA) };
}

// ---------------------------------------------------------------------------
// vocabulary — sized so JSON/AEAD costs vary the way real text does
// ---------------------------------------------------------------------------

const TASK_TITLES = [
  'Replace furnace filter',
  'Clean gutters',
  'Test smoke and CO alarms',
  'Flush water heater',
  'Service the HVAC system',
  'Reseal the deck',
  'Check attic for moisture',
  'Drain outdoor taps before frost',
  'Inspect roof flashing',
  'Clean dryer vent',
  'Sweep the chimney',
  'Lubricate garage door tracks',
  'Descale the dishwasher',
  'Check sump pump operation',
  'Reseal grout in the main bath',
  'Aerate and overseed the lawn',
  'Prune the front hedge',
  'Change refrigerator water filter',
  'Touch up exterior trim paint',
  'Inspect the driveway for cracks',
  'Vacuum the fridge condenser coils',
  'Check window and door weatherstripping',
] as const;

const SYSTEM_CATEGORIES = [
  'hvac',
  'plumbing',
  'electrical',
  'roofing',
  'exterior',
  'appliances',
  'landscaping',
  'safety',
  'interior',
  'structural',
] as const;

const SPACE_NAMES = [
  'Living Room',
  'Kitchen',
  'Dining Room',
  'Master Bedroom',
  'Bedroom',
  'Bathroom',
  'Home Office',
  'Laundry Room',
  'Backyard',
  'Front Yard',
  'Deck',
  'Patio',
  'Garden',
  'Garage',
  'Basement',
  'Attic',
  'Storage Room',
  'Utility Room',
] as const;

const APPLIANCE_NAMES = [
  'Furnace',
  'Water Heater',
  'Refrigerator',
  'Dishwasher',
  'Washing Machine',
  'Dryer',
  'Range',
  'Microwave',
  'Air Conditioner',
  'Heat Pump',
  'Garage Door Opener',
  'Sump Pump',
  'Water Softener',
  'Range Hood',
  'Freezer',
  'Air Exchanger',
  'Humidifier',
  'Garburator',
  'Wine Fridge',
  'Central Vacuum',
  'Ceiling Fan',
  'Bathroom Fan',
] as const;

const BRANDS = [
  'Lennox',
  'Carrier',
  'Rheem',
  'Whirlpool',
  'Bosch',
  'Samsung',
  'LG',
  'GE Appliances',
] as const;

const NOTE_BODIES = [
  'Shut-off valve is behind the panel in the utility room.',
  'Filter size is 20x25x1 — the hardware store on Main stocks them.',
  'Gate code for the side yard, changed each spring.',
  'Roof warranty runs to 2039; paperwork is in the binder.',
  'Do not run the dishwasher and the washer at the same time.',
  'The upstairs bath fan is on the same breaker as the hallway light.',
] as const;

const CONTRACTOR_NAMES = [
  'Northside Heating & Cooling',
  'Harbour Plumbing',
  'Cedar Roofing Co.',
  'Bright Spark Electric',
  'Greenline Landscaping',
] as const;

/** YYYY-MM-DD spread across the corpus's calendar window. */
function dateAt(years: number, i: number, r: () => number): string {
  const year = BASE_YEAR + (i % years);
  const month = 1 + Math.floor(r() * 12);
  const day = 1 + Math.floor(r() * 28);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isoAt(years: number, i: number, r: () => number): string {
  return `${dateAt(years, i, r)}T${pad2(Math.floor(r() * 24))}:${pad2(Math.floor(r() * 60))}:00.000Z`;
}

function periodStartAt(years: number, i: number): string {
  const year = BASE_YEAR + (Math.floor(i / 52) % years);
  const week = i % 52;
  const month = 1 + Math.floor(week / 4.34);
  const day = 1 + (week % 4) * 7;
  return `${year}-${pad2(Math.min(12, month))}-${pad2(day)}`;
}

// ---------------------------------------------------------------------------
// row factories — each mirrors the real DTO field-for-field
// ---------------------------------------------------------------------------

type Ctx = { years: number; adults: number; members: string[] };
type Factory = (i: number, r: () => number, ctx: Ctx) => ScaleRow;

const memberOf = (ctx: Ctx, i: number): string => ctx.members[i % ctx.members.length]!;

/** src/api/households.ts:15 Household — the ledgered domain row (plan §1.5 S5). */
const makeHousehold: Factory = () => ({
  id: HOUSEHOLD_ID,
  name: 'Maple Grove',
  address_line1: '184 Maple Grove Crescent',
  address_line2: null,
  city: 'Victoria',
  state_province: 'BC',
  postal_code: 'V8X 2K7',
  country: 'CA',
  unit_system: 'metric',
  photo_key: 'households/hh_local_4d7e2f9a1c6b8305/cover.jpg',
  photo_url: null,
  purchase_price: 84_500_00,
  purchase_date: '2021-04-19',
  created_at: ISO,
  updated_at: ISO,
  member_count: 2,
  my_role: 'owner',
});

/** src/api/households.ts:39 HouseholdMember + household_id (S3b deterministic id). */
const makeHouseholdMember: Factory = (i, r, ctx) => ({
  id: `hm_${'0'.repeat(24)}${pad2(i)}${pad2(i)}${pad2(i)}`,
  household_id: HOUSEHOLD_ID,
  user_id: memberOf(ctx, i),
  display_name: pick(r, ['Alex', 'Sam', 'Jordan', 'Riley'] as const),
  avatar_url: null,
  email: `member${i}@example.com`,
  role: i === 0 ? 'owner' : 'member',
  joined_at: ISO,
});

/** src/api/household-spaces.ts:4 HouseholdSpace */
const makeHouseholdSpace: Factory = (i, r) => ({
  id: `spc_${i}`,
  household_id: HOUSEHOLD_ID,
  name: SPACE_NAMES[i % SPACE_NAMES.length]!,
  space_type: i < 12 ? 'preset' : 'custom',
  category: pick(r, ['indoor', 'outdoor', 'garage', 'basement', 'attic'] as const),
  floor_level: Math.floor(r() * 3) - 1,
  icon_emoji: pick(r, ['🛋️', '🍳', '🛏️', '🚿', '🌳', '🚗'] as const),
  icon_color: `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`,
  custom_image_key: chance(r, 0.3) ? `spaces/spc_${i}/photo.jpg` : null,
  custom_image_url: null,
  description: chance(r, 0.4) ? 'Renovated in 2023; laminate over the original subfloor.' : null,
  area_sqft: Math.floor(60 + r() * 400),
  display_order: i,
  created_at: ISO,
  updated_at: ISO,
  version: 1 + Math.floor(r() * 4),
});

/**
 * src/api/tasks.ts:90 Task — the widest row in the fleet.
 *
 * Every optional field is populated on purpose. An "enriched" task is the
 * common case once the AI Housekeeper has run, and a row that omits half its
 * columns produces half the LWW stamps — which would understate exactly the
 * cost (N5, plan §1.6) this corpus exists to expose.
 */
const makeTask: Factory = (i, r, ctx) => ({
  id: `task_${i}`,
  household_id: HOUSEHOLD_ID,
  system_category: pick(r, SYSTEM_CATEGORIES),
  title: `${TASK_TITLES[i % TASK_TITLES.length]!} #${i}`,
  description: 'Seasonal maintenance item captured from the inspection report and enriched.',
  frequency: pick(r, ['one_time', 'monthly', 'quarterly', 'yearly', 'custom'] as const),
  custom_interval_days: chance(r, 0.2) ? 45 : null,
  next_due_date: dateAt(ctx.years, i, r),
  last_completed_at: isoAt(ctx.years, i, r),
  assigned_to: { id: memberOf(ctx, i), display_name: 'Alex' },
  space_id: `spc_${i % 18}`,
  is_active: !chance(r, 0.1),
  source: pick(r, ['manual', 'ai_generated', 'template'] as const),
  priority_severity: pick(r, ['urgent', 'important', 'nice_to_have'] as const),
  risk_level: pick(r, ['low', 'medium', 'high', 'critical'] as const),
  complexity: pick(r, ['trivial', 'simple', 'moderate', 'involved', 'expert'] as const),
  time_effort: pick(r, ['quick', 'short', 'medium', 'half_day', 'all_day'] as const),
  ai_rationale: 'Neglecting this shortens equipment life and voids part of the warranty.',
  enrichment_status: 'enriched',
  clarification_question: null,
  purchase_suggestion: chance(r, 0.25)
    ? { label: 'Add filters to planned spending', amount_cents: 4_200, category: 'home' }
    : null,
  blocked: chance(r, 0.08),
  blocker_reason: chance(r, 0.08) ? 'Waiting on the contractor quote' : null,
  blocked_at: chance(r, 0.08) ? isoAt(ctx.years, i, r) : null,
  blocked_by: chance(r, 0.08) ? { id: memberOf(ctx, i + 1), display_name: 'Sam' } : null,
  reminder_enabled: true,
  reminder_days_before: 1 + Math.floor(r() * 14),
  reminder_time: `${pad2(7 + Math.floor(r() * 12))}:00`,
  reminder_repeat: chance(r, 0.4),
  ...(chance(r, 0.15) ? { snooze_until: dateAt(ctx.years, i, r) } : {}),
  needs_contractor: chance(r, 0.3),
  contractor_category: pick(r, ['hvac', 'plumbing', 'roofing', 'electrical'] as const),
  workflow_stage: pick(r, ['identified', 'quoting', 'scheduled', 'in_progress', 'done'] as const),
  ...(chance(r, 0.35) ? { scheduled_work_date: dateAt(ctx.years, i, r) } : {}),
  scheduled_work_time_start: '09:00',
  scheduled_work_time_end: '12:00',
  ...(chance(r, 0.2) ? { selected_quote_id: `quo_${i % 400}` } : {}),
  ...(chance(r, 0.12) ? { linked_project_id: `prj_${i % 60}` } : {}),
  is_personal: chance(r, 0.1),
  created_by: memberOf(ctx, i),
  created_at: isoAt(ctx.years, i, r),
  updated_at: ISO,
  cover_photo_id: chance(r, 0.3) ? `pho_${i}` : null,
  cover_photo_url: null,
});

/** src/api/tasks.ts:168 MaintenanceCompletion + owning FKs — House's `expenses`. */
const makeMaintenanceCompletion: Factory = (i, r, ctx) => ({
  id: `mcp_${i}`,
  household_id: HOUSEHOLD_ID,
  task_id: `task_${i % Math.max(1, 40 + ctx.years * 100)}`,
  completed_by: { id: memberOf(ctx, i), display_name: 'Alex' },
  completed_at: isoAt(ctx.years, i, r),
  notes: chance(r, 0.45)
    ? 'Done. Filter was noticeably dirtier than last quarter; ordered two spares.'
    : null,
  photo_keys: chance(r, 0.3) ? [`completions/mcp_${i}/1.jpg`, `completions/mcp_${i}/2.jpg`] : [],
});

/** src/api/tasks.ts:180 MaintenanceSubtask + household_id */
const makeMaintenanceSubtask: Factory = (i, r, ctx) => ({
  id: `mst_${i}`,
  household_id: HOUSEHOLD_ID,
  task_id: `task_${i % Math.max(1, 40 + ctx.years * 100)}`,
  title: pick(r, [
    'Shut off the supply valve',
    'Remove and label the old part',
    'Vacuum the surrounding area',
    'Fit the replacement',
    'Run a test cycle',
  ] as const),
  description: chance(r, 0.5) ? 'Check the manual for torque spec before tightening.' : null,
  sort_order: i % 5,
  is_completed: chance(r, 0.6),
  completed_at: chance(r, 0.6) ? isoAt(ctx.years, i, r) : null,
  completed_by: chance(r, 0.6) ? { id: memberOf(ctx, i), display_name: 'Alex' } : null,
  reminder_enabled: chance(r, 0.3),
  reminder_days_before: 2,
  reminder_time: '09:00',
  reminder_date: chance(r, 0.3) ? dateAt(ctx.years, i, r) : null,
  created_at: isoAt(ctx.years, i, r),
  updated_at: ISO,
});

/** src/api/tasks.ts:373 TaskNote + owning FKs */
const makeTaskNote: Factory = (i, r, ctx) => ({
  id: `tnt_${i}`,
  household_id: HOUSEHOLD_ID,
  task_id: `task_${i % Math.max(1, 40 + ctx.years * 100)}`,
  kind: pick(r, ['progress', 'blocker', 'resolution'] as const),
  body: pick(r, [
    'Called the contractor; they can come Thursday morning.',
    'Part is backordered until the end of the month.',
    'Resolved — the leak was the washer, not the valve.',
  ] as const),
  created_at: isoAt(ctx.years, i, r),
  author: { id: memberOf(ctx, i), display_name: 'Sam' },
});

/** src/api/home-features.ts:7 HomeFeature */
const makeHomeFeature: Factory = (i, r, ctx) => ({
  id: `hft_${i}`,
  household_id: HOUSEHOLD_ID,
  feature_type: pick(r, ['window', 'door', 'faucet', 'outlet', 'vent', 'light_fixture'] as const),
  feature_subtype: chance(r, 0.6) ? 'double-glazed' : null,
  quantity: 1 + Math.floor(r() * 6),
  location: SPACE_NAMES[i % SPACE_NAMES.length]!,
  brand: chance(r, 0.5) ? pick(r, BRANDS) : null,
  model: chance(r, 0.4) ? `M-${Math.floor(r() * 9000) + 1000}` : null,
  serial_number: chance(r, 0.25) ? `SN${Math.floor(r() * 1e9)}` : null,
  install_date: dateAt(ctx.years, i, r),
  warranty_expires: chance(r, 0.4) ? dateAt(ctx.years, i + 3, r) : null,
  age_years: Math.floor(r() * 25),
  condition: pick(r, ['excellent', 'good', 'fair', 'poor', 'unknown'] as const),
  notes: chance(r, 0.3) ? 'Sticks in humid weather; planed the frame in 2024.' : null,
  source: pick(r, ['manual', 'report_extraction', 'user_input'] as const),
  source_report_id: chance(r, 0.35) ? `rep_${i % 8}` : null,
  extraction_confidence: chance(r, 0.35) ? Number(r().toFixed(3)) : null,
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/appliances.ts:25 Appliance */
const makeAppliance: Factory = (i, r, ctx) => ({
  id: `app_${i}`,
  household_id: HOUSEHOLD_ID,
  space_id: `spc_${i % 18}`,
  name: APPLIANCE_NAMES[i % APPLIANCE_NAMES.length]!,
  category: pick(r, ['hvac', 'kitchen', 'laundry', 'water', 'exterior'] as const),
  type: pick(r, ['gas', 'electric', 'hybrid'] as const),
  location: SPACE_NAMES[i % SPACE_NAMES.length]!,
  brand: pick(r, BRANDS),
  model: `M-${Math.floor(r() * 9000) + 1000}`,
  serial_number: `SN${Math.floor(r() * 1e9)}`,
  purchase_date: dateAt(ctx.years, i, r),
  install_date: dateAt(ctx.years, i, r),
  expected_lifespan: 8 + Math.floor(r() * 15),
  warranty: {
    provider: pick(r, BRANDS),
    expires_at: dateAt(ctx.years, i + 2, r),
    covers_parts: true,
    covers_labour: chance(r, 0.5),
  },
  purchase_cost: Math.floor(30_000 + r() * 900_000),
  total_maintenance_cost: Math.floor(r() * 250_000),
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/appliances.ts:55 ServiceHistoryEntry + household_id */
const makeApplianceServiceHistory: Factory = (i, r, ctx) => ({
  id: `ash_${i}`,
  household_id: HOUSEHOLD_ID,
  appliance_id: `app_${i % 22}`,
  service_date: dateAt(ctx.years, i, r),
  description: pick(r, [
    'Annual service — cleaned burners and checked the heat exchanger.',
    'Replaced the igniter under warranty.',
    'Flushed the tank and replaced the anode rod.',
  ] as const),
  cost: Math.floor(5_000 + r() * 60_000),
  ...(chance(r, 0.6) ? { provider_id: `srv_${i % 5}` } : {}),
  provider_name: pick(r, CONTRACTOR_NAMES),
  created_at: ISO,
});

/** src/api/garbage-collection.ts:29 GarbageSchedule */
const makeGarbageSchedule: Factory = (i, r) => ({
  id: `gsc_${i}`,
  household_id: HOUSEHOLD_ID,
  municipality: 'District of Saanich',
  schedules: [
    { type: 'garbage', day_of_week: 3, frequency: 'biweekly', next_date: '2026-03-18' },
    { type: 'recycling', day_of_week: 3, frequency: 'weekly', next_date: '2026-03-18' },
    { type: 'organics', day_of_week: 3, frequency: 'weekly', next_date: '2026-03-18' },
  ],
  set_out_time: '20:00',
  collection_start_time: '07:00',
  remove_by_time: '21:00',
  holiday_shifts: [
    { holiday: 'Christmas Day', date: '2026-12-25', shiftDays: 1, affectedDays: [3, 4] },
    { holiday: 'Canada Day', date: '2026-07-01', shiftDays: 1, affectedDays: [3] },
  ],
  reminders: {
    nightBefore: { enabled: true, time: '19:30' },
    morningOf: { enabled: chance(r, 0.5), time: '06:30' },
  },
  source: 'municipal_api',
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/seasonal-checklists.ts:19 SeasonalChecklist, flattened (items are derived). */
const makeSeasonalChecklist: Factory = (i, _r, ctx) => ({
  id: `scl_${i}`,
  household_id: HOUSEHOLD_ID,
  season: (['spring', 'summer', 'fall', 'winter'] as const)[i % 4]!,
  year: BASE_YEAR + (Math.floor(i / 4) % ctx.years),
  climate_zone: 'coastal-temperate',
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/seasonal-checklists.ts:6 SeasonalChecklistItem + household_id */
const makeSeasonalChecklistItem: Factory = (i, r, ctx) => ({
  id: `sci_${i}`,
  household_id: HOUSEHOLD_ID,
  checklist_id: `scl_${i % Math.max(1, ctx.years * 4)}`,
  ...(chance(r, 0.7) ? { task_template_id: `tpl_${i % 120}` } : {}),
  title: TASK_TITLES[i % TASK_TITLES.length]!,
  category: pick(r, SYSTEM_CATEGORIES),
  is_completed: chance(r, 0.55),
  ...(chance(r, 0.3) ? { notes: 'Skipped this year — did it late last season.' } : {}),
  ...(chance(r, 0.2) ? { photo_keys: [`seasonal/sci_${i}/1.jpg`] } : {}),
  sort_order: i % 12,
  ...(chance(r, 0.55) ? { completed_at: isoAt(ctx.years, i, r) } : {}),
});

/** src/api/checklists.ts:15 Checklist, flattened. Registered as `recurringChecklists` (S1). */
const makeRecurringChecklist: Factory = (i, r, ctx) => ({
  id: `chk_${i}`,
  household_id: HOUSEHOLD_ID,
  name: pick(r, [
    'Weekly reset',
    'Monthly systems check',
    'Quarterly deep clean',
    'Pre-winter prep',
  ] as const),
  description: chance(r, 0.6) ? 'Runs every week; keeps the small things from piling up.' : null,
  frequency: pick(r, ['daily', 'weekly', 'monthly', 'quarterly', 'seasonal', 'yearly'] as const),
  icon: pick(r, ['broom', 'wrench', 'leaf', 'snowflake'] as const),
  color: `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')}`,
  is_active: true,
  season: chance(r, 0.3) ? 'fall' : null,
  custom_days: null,
  sort_order: i,
  created_by: memberOf(ctx, i),
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/checklists.ts:4 ChecklistItem + household_id. Registered as `recurringChecklistItems` (S1). */
const makeRecurringChecklistItem: Factory = (i, r) => ({
  id: `cki_${i}`,
  household_id: HOUSEHOLD_ID,
  checklist_id: `chk_${i % 8}`,
  title: pick(r, [
    'Wipe down the counters',
    'Check the water softener salt',
    'Run the dishwasher cleaner',
    'Empty the dehumidifier',
    'Sweep the entryway',
  ] as const),
  description: chance(r, 0.4) ? 'Takes about five minutes.' : null,
  sort_order: i % 8,
  is_required: chance(r, 0.5),
  linked_task_id: chance(r, 0.25) ? `task_${i % 40}` : null,
  created_at: ISO,
});

/** src/api/checklists.ts:33 ChecklistInstance — windows on period_start. */
const makeChecklistInstance: Factory = (i, r, ctx) => ({
  id: `cin_${i}`,
  household_id: HOUSEHOLD_ID,
  checklist_id: `chk_${i % 8}`,
  period_start: periodStartAt(ctx.years, i),
  period_end: periodStartAt(ctx.years, i + 1),
  period_label: chance(r, 0.5) ? `Week ${(i % 52) + 1}` : null,
  total_items: 8,
  completed_items: Math.floor(r() * 9),
  status: pick(r, ['not_started', 'in_progress', 'completed'] as const),
  completed_at: chance(r, 0.5) ? isoAt(ctx.years, i, r) : null,
  completed_by: chance(r, 0.5) ? memberOf(ctx, i) : null,
  created_at: isoAt(ctx.years, i, r),
  updated_at: ISO,
});

/** src/api/checklists.ts:62 ChecklistItemCompletion + household_id (S3b deterministic id). */
const makeChecklistItemCompletion: Factory = (i, r, ctx) => ({
  id: `cic_${i}`,
  household_id: HOUSEHOLD_ID,
  instance_id: `cin_${i % Math.max(1, ctx.years * 56)}`,
  item_id: `cki_${i % 64}`,
  completed_by: memberOf(ctx, i),
  completed_at: isoAt(ctx.years, i, r),
  notes: chance(r, 0.15) ? 'Ran out of cleaner; picked more up.' : null,
});

/** backend/src/db/schema-household-notes.ts householdNotes */
const makeHouseholdNote: Factory = (i, r, ctx) => ({
  id: `hnt_${i}`,
  household_id: HOUSEHOLD_ID,
  created_by: memberOf(ctx, i),
  title: chance(r, 0.7) ? pick(r, ['Shut-offs', 'Filter sizes', 'Gate code', 'Warranty'] as const) : null,
  body: NOTE_BODIES[i % NOTE_BODIES.length]!,
  pinned: chance(r, 0.2),
  created_at: isoAt(ctx.years, i, r),
  updated_at: ISO,
  deleted_at: null,
});

/** src/api/settings.ts:4 Setting (S3b deterministic id). */
const makeSetting: Factory = (i, r, ctx) => ({
  id: `set_${i}`,
  user_id: memberOf(ctx, i),
  household_id: HOUSEHOLD_ID,
  key: pick(r, [
    'unit_system',
    'reminder_default_time',
    'week_starts_on',
    'notifications.tasks',
    'notifications.digest',
    'theme',
    'currency',
  ] as const),
  value: JSON.stringify({ v: pick(r, ['metric', 'imperial', 'auto', 'on', 'off'] as const) }),
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/recurringReminders.ts:30 RecurringReminder (S3b deterministic id). */
const makeRecurringReminder: Factory = (i, r, ctx) => ({
  id: `rrm_${i}`,
  household_id: HOUSEHOLD_ID,
  type: pick(r, ['furnace_filter', 'smoke_alarm_test', 'gutter_clean', 'hvac_service'] as const),
  reference_type: 'task',
  reference_id: `task_${i % 40}`,
  period_key: `${BASE_YEAR + (Math.floor(i / 12) % ctx.years)}-${pad2((i % 12) + 1)}`,
  status: chance(r, 0.6) ? 'done' : 'pending',
  title: TASK_TITLES[i % TASK_TITLES.length]!,
  body: 'Due this month — tap to mark it done or push it out.',
  data: JSON.stringify({ type: 'task_reminder', screen: 'TaskDetail', taskId: `task_${i % 40}` }),
  frequency: pick(r, ['monthly', 'quarterly', 'yearly'] as const),
  next_nudge_at: isoAt(ctx.years, i, r),
  last_nudged_at: chance(r, 0.5) ? isoAt(ctx.years, i, r) : null,
  nudge_count: Math.floor(r() * 4),
  snoozed_until: chance(r, 0.15) ? dateAt(ctx.years, i, r) : null,
  completed_at: chance(r, 0.6) ? isoAt(ctx.years, i, r) : null,
  completed_by_user_id: chance(r, 0.6) ? memberOf(ctx, i) : null,
  completed_reason: chance(r, 0.6) ? pick(r, ['manual', 'auto_detected'] as const) : null,
  created_at: ISO,
  updated_at: ISO,
});

/** src/api/task-drafts.ts:4 TaskDraft — report-seeded, user-editable. */
const makeTaskDraft: Factory = (i, r, ctx) => ({
  id: `tdr_${i}`,
  household_id: HOUSEHOLD_ID,
  report_id: `rep_${i % 8}`,
  finding_id: chance(r, 0.8) ? `fnd_${i}` : null,
  title: `${TASK_TITLES[i % TASK_TITLES.length]!} (from report)`,
  description: 'Inspector flagged this in the section on the mechanical systems.',
  plain_language_summary: 'Worth doing before next winter; not urgent today.',
  system_category: pick(r, SYSTEM_CATEGORIES),
  severity: pick(r, ['critical', 'major', 'minor', 'informational'] as const),
  priority_score: Number((r() * 100).toFixed(1)),
  suggested_timeframe: pick(r, ['0-30_days', '3-6_months', '1_year', '2-5_years'] as const),
  suggested_frequency: pick(r, ['one_time', 'yearly', 'quarterly'] as const),
  is_recurring_suggestion: chance(r, 0.4),
  estimated_cost_min: Math.floor(r() * 50_000),
  estimated_cost_max: Math.floor(50_000 + r() * 250_000),
  diy_possible: chance(r, 0.6),
  diy_difficulty: pick(r, ['easy', 'medium', 'hard', 'professional_only'] as const),
  diy_cost_min: Math.floor(r() * 10_000),
  diy_cost_max: Math.floor(10_000 + r() * 40_000),
  source_page_numbers: [12 + (i % 40), 13 + (i % 40)],
  source_quotes: ['"Evidence of prior moisture staining at the north wall."'],
  image_ids: chance(r, 0.5) ? [`img_${i}a`, `img_${i}b`] : [],
  status: pick(r, ['draft', 'converted', 'dismissed'] as const),
  converted_to_task_id: chance(r, 0.3) ? `task_${i % 40}` : null,
  dismissed_reason: chance(r, 0.15) ? 'Already handled by the previous owner.' : null,
  dismissed_at: chance(r, 0.15) ? isoAt(ctx.years, i, r) : null,
  converted_at: chance(r, 0.3) ? isoAt(ctx.years, i, r) : null,
  created_at: isoAt(ctx.years, i, r),
  updated_at: ISO,
});

const FACTORIES: Record<HouseLedgerTableName, Factory> = {
  households: makeHousehold,
  householdMembers: makeHouseholdMember,
  householdSpaces: makeHouseholdSpace,
  tasks: makeTask,
  maintenanceCompletions: makeMaintenanceCompletion,
  maintenanceSubtasks: makeMaintenanceSubtask,
  maintenanceTaskNotes: makeTaskNote,
  homeFeatures: makeHomeFeature,
  appliances: makeAppliance,
  applianceServiceHistory: makeApplianceServiceHistory,
  garbageSchedules: makeGarbageSchedule,
  seasonalChecklists: makeSeasonalChecklist,
  seasonalChecklistItems: makeSeasonalChecklistItem,
  recurringChecklists: makeRecurringChecklist,
  recurringChecklistItems: makeRecurringChecklistItem,
  checklistInstances: makeChecklistInstance,
  checklistItemCompletions: makeChecklistItemCompletion,
  householdNotes: makeHouseholdNote,
  settings: makeSetting,
  recurringReminders: makeRecurringReminder,
  taskDrafts: makeTaskDraft,
};

// ---------------------------------------------------------------------------

export function generateHouseLedger(spec: HouseScaleSpec): HouseScaleLedger {
  const { years, adults, seed } = resolved(spec);
  const ctx: Ctx = { years, adults, members: memberIdsFor(adults) };
  const counts = rowCounts(spec);

  const ledger = {
    version: 1,
    household: {
      id: HOUSEHOLD_ID,
      name: 'Maple Grove',
      created_at: ISO,
      updated_at: ISO,
      member_count: adults,
      my_role: 'owner',
    },
    memberId: ctx.members[0]!,
    deviceId: LOCAL_DEVICE_ID,
    ops: [] as StoredOperation[],
    lww: {},
    conflicts: [],
    pendingEnrolment: false,
  } as unknown as HouseScaleLedger;

  for (const table of HOUSE_LEDGER_TABLE_NAMES) {
    const factory = FACTORIES[table];
    const n = counts[table];
    const rows: ScaleRow[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      rows[i] = factory(i, rngFor(seed, table, i), ctx);
    }
    ledger[table] = rows;
  }

  ledger.lww = buildLwwMap(ledger as unknown as Record<string, unknown>, HOUSE_REGISTRY, {
    members: ctx.members,
    devices: deviceIdsFor(adults),
  });

  return ledger;
}

export function lwwStampCount(ledger: HouseScaleLedger): number {
  return lwwStampCountOf(ledger.lww);
}

/**
 * Identity of the corpus, so `compare` can refuse to diff numbers produced from
 * two different ones. Derived from a real 1-year corpus rather than a hand-bumped
 * constant: a factory tweak, a new field or a change to the watermark map moves
 * it automatically and nobody has to remember.
 */
export function corpusFingerprint(spec?: HouseScaleSpec): string {
  const { adults, seed } = resolved(spec ?? HOUSE_REFERENCE_SPEC);
  const probe = generateHouseLedger({ years: 1, adults, seed });
  return createHash('sha256').update(JSON.stringify(probe), 'utf8').digest('hex').slice(0, 16);
}

export function bulkDeleteDelta(
  ledger: HouseScaleLedger,
  table: HouseLedgerTableName,
  count: number,
  offset = 0,
): { v: 1; d: Record<string, string[]> } {
  return bulkDeleteDeltaOf(
    ledger as unknown as Record<string, unknown>,
    HOUSE_REGISTRY,
    table,
    count,
    offset,
  );
}

export function totalRows(ledger: HouseScaleLedger): number {
  return totalRowsOf(ledger as unknown as Record<string, unknown>, HOUSE_REGISTRY);
}

export function rowIdAt(
  ledger: HouseScaleLedger,
  table: HouseLedgerTableName,
  index: number,
): string {
  return rowIdAtOf(ledger as unknown as Record<string, unknown>, HOUSE_REGISTRY, table, index);
}

export function cloneLedger(ledger: HouseScaleLedger): HouseScaleLedger {
  return cloneLedgerOf(ledger as unknown as Record<string, unknown>, HOUSE_REGISTRY) as
    unknown as HouseScaleLedger;
}
