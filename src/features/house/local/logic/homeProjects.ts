/**
 * Home-project arithmetic and seed data — the server's, ported (H11 C4).
 *
 * Ported from `backend/src/services/home-projects-service.ts` (`computeRollups`,
 * `HUB_CHILD_CAP`, the `exportProjectSummary` line builder) and
 * `backend/src/services/home-projects/templates.ts` (the whole catalogue) —
 * keep in sync.
 *
 * WHY EACH OF THESE HAD TO COME ACROSS
 * ------------------------------------
 * The rule §11.1.4 settled on C1 is "estimate a facade by what the method
 * COMPUTES, not by how many methods there are", and three separate things in
 * this module are the answer to it here.
 *
 * 1. **`computeBudgetRollups` is the number on the screen.** `getHub` returns a
 *    `rollups` block that `HomeProjectHubScreen` renders as the estimate, the
 *    actual, the contingency and a health badge. It is composed per request out
 *    of `home_project_budget_lines` and never stored — a stored aggregate under
 *    per-field LWW is the derived-collection rule's exact failure mode, two
 *    members editing two different lines offline and converging on one device's
 *    total. Left remote, a Worker holding none of those lines would answer
 *    `estimate_total: 0` with a 200, and a member looking at a fully-specified
 *    twelve-thousand-dollar bathroom would be told it costs nothing. That is
 *    C1's `getDashboard` failure with a bigger number attached.
 *
 * 2. **The template catalogue is the create path, not a list.** It is tempting
 *    to read `listTemplates` as a Tier-C catalogue read and declare it remote —
 *    it is global, identical for every household and carries nothing of theirs,
 *    which is exactly `garbageCollectionApi.getMunicipalities`. The reason that
 *    is wrong here is `createProject`: picking `bathroom_reno` seeds five phases,
 *    five selections, one blocker and four budget lines, and every one of those
 *    is a ledger row the DEVICE has to write. So the catalogue has to be on the
 *    device regardless, and once it is, serving the wizard's list from the
 *    server as well would give one fact two sources — the drift the whole
 *    programme is arranged to avoid. It is a compiled-in constant, not a ledger
 *    table: nothing syncs it and `HOUSE_NEVER_INVALIDATED_KEYS` names its query
 *    key so no delta can pretend otherwise.
 *
 * 3. **The export text is composed, not fetched.** `exportProjectSummary` builds
 *    a share string out of the hub — title, status, budget, every selection,
 *    every phase — and then writes a PDF to R2. Only the second half needs a
 *    server. Splitting them is what lets a member share their project from a
 *    basement, and the DTO already admits it: `pdfUrl` is typed `string | null`
 *    and `HomeProjectHubScreen` falls through to a text share when it is null.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * `buildSimplePdf` (`backend/src/utils/simple-pdf.ts`) writes the PDF bytes.
 * Not ported: the bytes would have nowhere to go — R2 is not reachable from a
 * local-first household and the H6 blob channel is for member attachments, not
 * for a document regenerated on every share — and the screen's own fallback is
 * better than a PDF nobody can open. `pdfUrl` is null and that is the answer the
 * DTO already describes.
 *
 * `suggestTakeoffFromGeometry` turns a RoomPlan scan's wall and floor areas into
 * paint and flooring selections. Not ported because its input is
 * `home_project_geometry`, which is **Tier D** and is never ledgered — there is
 * no geometry on device for it to read, so the function would compute over
 * nothing every time.
 */

// ---------------------------------------------------------------------------
// Material option pricing
// ---------------------------------------------------------------------------

/**
 * `services/home-projects/pricing.ts`, ported — shelf price → "what this floor
 * costs".
 *
 * The three numbers on an option card are not one number scaled:
 *
 *   price per unit   what the shop charges for one box / piece / pail
 *   price per area   that price divided by what the box covers  ($/sqft)
 *   area total       units you must actually BUY, rounded UP, times unit price
 *
 * The rounding is the point of the third. 24 m² at 2.2 m² a box is 10.9 boxes,
 * and no shop sells 0.9 of a box — you buy 11, and with 10% waste you buy 12. A
 * card showing `area × price_per_area` would quote a floor nobody can purchase,
 * cheaper than the real one, on the screen where the member decides what to
 * spend. So the total is always `ceil(units) × unitPrice`.
 *
 * **This file and the Worker's must agree exactly**, and neither asserts its own
 * expected values: both suites run
 * `backend/src/services/home-projects/pricing-fixtures.json`. Two sides each
 * certifying their own arithmetic is how a rounding divergence ships green.
 */

export type HomeProjectAreaUnit = 'm2' | 'sqft';

const M2_PER_SQFT = 0.09290304;

/** Area in `unit` → m². */
export function toSquareMeters(
  value: number,
  unit: HomeProjectAreaUnit,
): number {
  return unit === 'sqft' ? value * M2_PER_SQFT : value;
}

/** m² → `unit`. */
export function fromSquareMeters(
  m2: number,
  unit: HomeProjectAreaUnit,
): number {
  return unit === 'sqft' ? m2 / M2_PER_SQFT : m2;
}

export function isHomeProjectAreaUnit(
  value: unknown,
): value is HomeProjectAreaUnit {
  return value === 'm2' || value === 'sqft';
}

/** The three group fields the pricing reads. */
export type PricingGroupInput = {
  area_value: number | null;
  area_unit: string | null;
  waste_factor_pct: number;
};

/** The four option fields the pricing reads. */
export type PricingOptionInput = {
  qty: number;
  unit_price_cents: number | null;
  coverage_per_unit: number | null;
  coverage_unit: string | null;
};

export type OptionPricing = {
  unit_price_cents: number | null;
  price_per_area_cents: number | null;
  price_per_area_unit: HomeProjectAreaUnit | null;
  units_needed: number | null;
  area_total_cents: number | null;
  line_total_cents: number | null;
  /** Which input was missing, so the card says so instead of showing a zero. */
  unavailable_reason: 'no_price' | 'no_coverage' | 'no_area' | null;
};

/**
 * Price one option against its group.
 *
 * Reports every number it can and nulls the rest — a faucet (price, no
 * coverage) still gets `line_total_cents`, and a tile in a group with no area
 * still gets `price_per_area_cents`.
 */
export function priceOption(
  group: PricingGroupInput,
  option: PricingOptionInput,
): OptionPricing {
  const unitPrice =
    option.unit_price_cents != null && option.unit_price_cents >= 0
      ? option.unit_price_cents
      : null;

  const qty = Number.isFinite(option.qty) && option.qty > 0 ? option.qty : 1;
  const lineTotal = unitPrice != null ? unitPrice * qty : null;

  const coverageUnit = isHomeProjectAreaUnit(option.coverage_unit)
    ? option.coverage_unit
    : null;
  const coverage =
    option.coverage_per_unit != null && option.coverage_per_unit > 0
      ? option.coverage_per_unit
      : null;
  const hasCoverage = coverage != null && coverageUnit != null;

  // In the COVERAGE's unit, not the group's: a box labelled "20 sqft" reads
  // back as "$/sqft" even when the member measured the room in m².
  const pricePerArea =
    unitPrice != null && hasCoverage ? Math.round(unitPrice / coverage) : null;

  const areaUnit = isHomeProjectAreaUnit(group.area_unit)
    ? group.area_unit
    : null;
  const hasArea =
    group.area_value != null && group.area_value > 0 && areaUnit != null;

  let unitsNeeded: number | null = null;
  let areaTotal: number | null = null;
  if (hasArea && hasCoverage) {
    const waste = Number.isFinite(group.waste_factor_pct)
      ? Math.max(0, group.waste_factor_pct)
      : 0;
    const neededM2 =
      toSquareMeters(group.area_value as number, areaUnit) * (1 + waste / 100);
    const perUnitM2 = toSquareMeters(coverage, coverageUnit);
    unitsNeeded = Math.ceil(neededM2 / perUnitM2);
    if (unitPrice != null) areaTotal = unitsNeeded * unitPrice;
  }

  let reason: OptionPricing['unavailable_reason'] = null;
  if (areaTotal == null) {
    if (unitPrice == null) reason = 'no_price';
    else if (!hasCoverage) reason = 'no_coverage';
    else reason = 'no_area';
  }

  return {
    unit_price_cents: unitPrice,
    price_per_area_cents: pricePerArea,
    price_per_area_unit: hasCoverage ? coverageUnit : null,
    units_needed: unitsNeeded,
    area_total_cents: areaTotal,
    line_total_cents: lineTotal,
    unavailable_reason: reason,
  };
}

/**
 * What the winning option puts into the budget.
 *
 * Area total when there is an area, qty × price otherwise (a per-piece group is
 * legitimate, not broken), and 0 when there is no price — a chosen-but-unpriced
 * option belongs in the budget as a visible zero, not as a missing line.
 */
export function budgetEstimateCents(
  group: PricingGroupInput,
  option: PricingOptionInput,
): number {
  const pricing = priceOption(group, option);
  return pricing.area_total_cents ?? pricing.line_total_cents ?? 0;
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

/** The hub's per-child page size, ported (`HUB_CHILD_CAP`). */
export const HOME_PROJECT_HUB_CHILD_CAP = 200;

export type HomeProjectBudgetHealth = 'ok' | 'watch' | 'over';

export type HomeProjectRollups = {
  estimate_total: number;
  actual_total: number;
  contingency_cents: number;
  target_budget_cents: number | null;
  budget_health: HomeProjectBudgetHealth;
};

/** The two fields of a project the rollup reads. */
export type RollupProject = {
  contingency_pct: number;
  target_budget_cents: number | null;
};

/** The two fields of a budget line the rollup reads. */
export type RollupBudgetLine = {
  category: string;
  estimate_cents: number;
  actual_cents: number;
};

/**
 * `computeRollups`, ported — the number the member reads as "what this project
 * currently costs", composed per request out of the budget lines.
 *
 *  - **The contingency is a LINE if one exists and a PERCENTAGE if not.** A
 *    member who adds an explicit `contingency` line owns that figure, and zero is
 *    a value rather than a miss (`??`, not `||`) so deliberately zeroing it gives
 *    zero. No TEMPLATE seeds that line any more, which is what lets the
 *    percentage track a project as it gets priced.
 *  - **The percentage itself defaults to 0**, and the `??` on it matters for the
 *    same reason as the one on the line. Templates seed no rate, so contingency
 *    is a thing a member switches on rather than a buffer the app applies to
 *    numbers it has never seen.
 *  - **`estimate_total` is the subtotal PLUS the contingency**, always. It used
 *    to be `sum(every line) || subtotal + contingency`, which agreed with itself
 *    only while every template seeded an explicit contingency line. With those
 *    seeds gone the `||` silently dropped the buffer out of the total the moment
 *    any real figure was typed — the project would read $5,000 while its own
 *    header showed $750 of contingency sitting on top of it.
 *  - **`budget_health` is only computed when the target is set AND positive.**
 *    A project with no target budget is always `'ok'`, never `'watch'` — there
 *    is nothing to be over.
 *
 * The comparison is `> target * 0.9` for `'watch'`, so a project at exactly 90%
 * of target is still `'ok'`. That boundary is the server's.
 */
export function computeBudgetRollups(
  project: RollupProject,
  lines: readonly RollupBudgetLine[],
): HomeProjectRollups {
  const estimateSubtotal = lines
    .filter(line => line.category !== 'contingency')
    .reduce((sum, line) => sum + (line.estimate_cents || 0), 0);
  const contingencyLine = lines.find(line => line.category === 'contingency');
  // `?? 0`, never `|| 15`. The `||` read a deliberate 0% as "unset" and put a 15%
  // buffer back on top of it, so switching contingency off did not switch it off.
  // Zero is the default now, which made that fallback the common case.
  const contingencyCents =
    contingencyLine?.estimate_cents ??
    Math.round((estimateSubtotal * (project.contingency_pct ?? 0)) / 100);
  const estimateTotal = estimateSubtotal + contingencyCents;
  const actualTotal = lines.reduce(
    (sum, line) => sum + (line.actual_cents || 0),
    0,
  );
  const target = project.target_budget_cents;
  let budgetHealth: HomeProjectBudgetHealth = 'ok';
  if (target != null && target > 0) {
    if (estimateTotal > target) budgetHealth = 'over';
    else if (estimateTotal > target * 0.9) budgetHealth = 'watch';
  }
  return {
    estimate_total: estimateTotal,
    actual_total: actualTotal,
    contingency_cents: contingencyCents,
    target_budget_cents: target,
    budget_health: budgetHealth,
  };
}

// ---------------------------------------------------------------------------
// The template catalogue
// ---------------------------------------------------------------------------

export const HOME_PROJECT_TEMPLATE_KEYS = [
  'bathroom_reno',
  'kitchen_reno',
  'basement_finish',
  'expand_space',
  'paint_refresh',
  'flooring_replace',
  'furniture_replace',
  'appliance_replace',
  'plumbing_replace',
  'electrical_upgrade',
  'hvac_replace',
  'roof_replace',
  'window_door_replace',
  'replace_fixture',
  'outdoor_refresh',
  'blank',
] as const;

export type HomeProjectTemplateKey =
  (typeof HOME_PROJECT_TEMPLATE_KEYS)[number];

export type TemplatePhaseSeed = { title: string; sortOrder: number };
export type TemplateBlockerSeed = {
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
};
/** A budget ROW to price, never a price. Seeded at zero — see below. */
export type TemplateBudgetSeed = {
  category: string;
  label: string;
  sortOrder: number;
};

export type HomeProjectTemplateSeed = {
  key: HomeProjectTemplateKey;
  title: string;
  type: string;
  /** Rough national-average hint; always labelled as varying by location. */
  phases: TemplatePhaseSeed[];
  blockers: TemplateBlockerSeed[];
  budgetLines: TemplateBudgetSeed[];
  contingencyPct: number;
};

/*
 * The backend's `CONTINGENCY` helper is GONE from both catalogues, and its
 * absence is load-bearing rather than tidy.
 *
 * No template seeds money any more — budget lines seed at zero, no `contingency`
 * line is seeded at all, and `contingencyPct` seeds at 0. The figures that used
 * to be here were national averages invented without this household's city,
 * contractor or scope, and they landed in the hub's Estimate the moment the
 * project existed: the same false anchor the wizard's "~$12k avg" caption was
 * removed for, one screen later.
 *
 * The per-template 10/15/20% buffer went last. A rate is a smaller lie than an
 * amount but it is still a guess about a job nobody has scoped, and it compounds
 * every real figure the member types. Contingency is opt-in now, set and
 * explained on the Budget tab.
 *
 * The contingency LINE in particular had to go rather than be zeroed, because
 * `computeBudgetRollups` prefers an explicit line to the percentage (`??`, and
 * zero is a value) — a line seeded at zero would peg the buffer at zero even for
 * a member who later sets a rate. With no line, `contingency_pct` computes live
 * off whatever the member has actually priced.
 *
 * Mirrors `backend/src/services/home-projects/templates.ts`. Keep the two in step.
 */

/** `HOME_PROJECT_TEMPLATES`, ported verbatim. Insertion order is the list order. */
export const HOME_PROJECT_TEMPLATE_SEEDS: Record<
  HomeProjectTemplateKey,
  HomeProjectTemplateSeed
> = {
  bathroom_reno: {
    key: 'bathroom_reno',
    title: 'Bathroom renovation',
    type: 'renovation',
    contingencyPct: 0,
    phases: [
      { title: 'Demo', sortOrder: 0 },
      { title: 'Rough-in', sortOrder: 1 },
      { title: 'Surfaces', sortOrder: 2 },
      { title: 'Fixtures', sortOrder: 3 },
      { title: 'Finish', sortOrder: 4 },
    ],
    blockers: [{ title: 'Permits / plumbing inspection', severity: 'high' }],
    budgetLines: [
      { category: 'materials', label: 'Materials', sortOrder: 0 },
      { category: 'labor', label: 'Labor', sortOrder: 1 },
      { category: 'permits', label: 'Permits', sortOrder: 2 },
    ],
  },
  kitchen_reno: {
    key: 'kitchen_reno',
    title: 'Kitchen renovation',
    type: 'renovation',
    contingencyPct: 0,
    phases: [
      { title: 'Design & measure', sortOrder: 0 },
      { title: 'Demo', sortOrder: 1 },
      { title: 'Rough-in', sortOrder: 2 },
      { title: 'Cabinets', sortOrder: 3 },
      { title: 'Countertops', sortOrder: 4 },
      { title: 'Appliances & finish', sortOrder: 5 },
    ],
    blockers: [
      { title: 'Permits / electrical inspection', severity: 'high' },
      { title: 'Countertop template needs cabinets set', severity: 'medium' },
      { title: 'Appliance lead times', severity: 'medium' },
    ],
    budgetLines: [
      {
        category: 'materials',
        label: 'Cabinets + countertops',
        sortOrder: 0,
      },
      { category: 'materials', label: 'Appliances', sortOrder: 1 },
      { category: 'labor', label: 'Labor', sortOrder: 2 },
      { category: 'permits', label: 'Permits', sortOrder: 3 },
    ],
  },
  basement_finish: {
    key: 'basement_finish',
    title: 'Finish a basement',
    type: 'renovation',
    contingencyPct: 0,
    phases: [
      { title: 'Design & permits', sortOrder: 0 },
      { title: 'Framing', sortOrder: 1 },
      { title: 'Rough-in', sortOrder: 2 },
      { title: 'Insulation & drywall', sortOrder: 3 },
      { title: 'Flooring', sortOrder: 4 },
      { title: 'Finish', sortOrder: 5 },
    ],
    blockers: [
      { title: 'Moisture / waterproofing check', severity: 'critical' },
      { title: 'Egress window required?', severity: 'high' },
      { title: 'Ceiling height clearance', severity: 'medium' },
    ],
    budgetLines: [
      {
        category: 'materials',
        label: 'Framing + drywall',
        sortOrder: 0,
      },
      {
        category: 'materials',
        label: 'Flooring + finishes',
        sortOrder: 1,
      },
      { category: 'labor', label: 'Labor', sortOrder: 2 },
      {
        category: 'permits',
        label: 'Permits / inspections',
        sortOrder: 3,
      },
    ],
  },
  expand_space: {
    key: 'expand_space',
    title: 'Expand a space',
    type: 'expansion',
    contingencyPct: 0,
    phases: [
      { title: 'Design', sortOrder: 0 },
      { title: 'Structural / permits', sortOrder: 1 },
      { title: 'Demo', sortOrder: 2 },
      { title: 'Build', sortOrder: 3 },
      { title: 'Finish', sortOrder: 4 },
    ],
    blockers: [
      { title: 'Load-bearing wall?', severity: 'critical' },
      { title: 'Electrical capacity', severity: 'high' },
    ],
    budgetLines: [
      { category: 'materials', label: 'Materials', sortOrder: 0 },
      { category: 'labor', label: 'Labor', sortOrder: 1 },
      {
        category: 'permits',
        label: 'Permits / engineering',
        sortOrder: 2,
      },
    ],
  },
  paint_refresh: {
    key: 'paint_refresh',
    title: 'Paint refresh',
    type: 'finish_refresh',
    contingencyPct: 0,
    phases: [
      { title: 'Prep', sortOrder: 0 },
      { title: 'Paint', sortOrder: 1 },
      { title: 'Touch-up', sortOrder: 2 },
    ],
    blockers: [],
    budgetLines: [
      { category: 'materials', label: 'Paint + primer', sortOrder: 0 },
      { category: 'labor', label: 'Labor', sortOrder: 1 },
    ],
  },
  flooring_replace: {
    key: 'flooring_replace',
    title: 'Replace flooring',
    type: 'replacement',
    contingencyPct: 0,
    phases: [
      { title: 'Measure & order', sortOrder: 0 },
      { title: 'Remove old flooring', sortOrder: 1 },
      { title: 'Subfloor prep', sortOrder: 2 },
      { title: 'Install', sortOrder: 3 },
      { title: 'Trim & transitions', sortOrder: 4 },
    ],
    blockers: [
      { title: 'Subfloor moisture / level check', severity: 'medium' },
      { title: 'Asbestos check on old tile', severity: 'high' },
      { title: 'Room has to be emptied', severity: 'low' },
    ],
    budgetLines: [
      {
        category: 'materials',
        label: 'Flooring + underlayment',
        sortOrder: 0,
      },
      { category: 'labor', label: 'Install labor', sortOrder: 1 },
      {
        category: 'other',
        label: 'Removal + disposal',
        sortOrder: 2,
      },
    ],
  },
  furniture_replace: {
    key: 'furniture_replace',
    title: 'Replace furniture',
    type: 'replacement',
    contingencyPct: 0,
    phases: [
      { title: 'Measure the space', sortOrder: 0 },
      { title: 'Choose & order', sortOrder: 1 },
      { title: 'Clear the old pieces', sortOrder: 2 },
      { title: 'Delivery', sortOrder: 3 },
      { title: 'Place & assemble', sortOrder: 4 },
    ],
    blockers: [
      { title: 'Doorway / stairwell clearance', severity: 'medium' },
      { title: 'Delivery window & lead time', severity: 'low' },
      { title: 'Old pieces need hauling or donating', severity: 'low' },
    ],
    budgetLines: [
      { category: 'materials', label: 'Furniture', sortOrder: 0 },
      {
        category: 'other',
        label: 'Delivery + assembly',
        sortOrder: 1,
      },
      {
        category: 'other',
        label: 'Haul-away / donation',
        sortOrder: 2,
      },
    ],
  },
  appliance_replace: {
    key: 'appliance_replace',
    title: 'Replace an appliance',
    type: 'replacement',
    contingencyPct: 0,
    phases: [
      { title: 'Measure & choose', sortOrder: 0 },
      { title: 'Order & schedule delivery', sortOrder: 1 },
      { title: 'Disconnect the old unit', sortOrder: 2 },
      { title: 'Install & test', sortOrder: 3 },
    ],
    blockers: [
      { title: 'Gas vs electric hookup mismatch', severity: 'medium' },
      { title: 'Opening size & door swing', severity: 'medium' },
      { title: 'Delivery + haul-away scheduling', severity: 'low' },
    ],
    budgetLines: [
      { category: 'materials', label: 'Appliance', sortOrder: 0 },
      { category: 'labor', label: 'Install / hookup', sortOrder: 1 },
      { category: 'other', label: 'Haul-away', sortOrder: 2 },
    ],
  },
  plumbing_replace: {
    key: 'plumbing_replace',
    title: 'Plumbing replacement',
    type: 'replacement',
    contingencyPct: 0,
    phases: [
      { title: 'Inspection & scope', sortOrder: 0 },
      { title: 'Shut-off & drain', sortOrder: 1 },
      { title: 'Replace supply lines', sortOrder: 2 },
      { title: 'Replace valves & fixtures', sortOrder: 3 },
      { title: 'Pressure test & inspection', sortOrder: 4 },
      { title: 'Patch & restore', sortOrder: 5 },
    ],
    blockers: [
      { title: 'Permit + plumbing inspection', severity: 'high' },
      { title: 'Whole-home water shut-off needed', severity: 'high' },
      { title: 'Wall / ceiling access to open', severity: 'medium' },
    ],
    budgetLines: [
      {
        category: 'materials',
        label: 'Pipe + fittings',
        sortOrder: 0,
      },
      { category: 'labor', label: 'Plumber labor', sortOrder: 1 },
      {
        category: 'permits',
        label: 'Permits / inspection',
        sortOrder: 2,
      },
      {
        category: 'other',
        label: 'Drywall patch + paint',
        sortOrder: 3,
      },
    ],
  },
  electrical_upgrade: {
    key: 'electrical_upgrade',
    title: 'Electrical upgrade',
    type: 'replacement',
    contingencyPct: 0,
    phases: [
      { title: 'Load assessment & quotes', sortOrder: 0 },
      { title: 'Permit', sortOrder: 1 },
      { title: 'Panel / circuit work', sortOrder: 2 },
      { title: 'Device install', sortOrder: 3 },
      { title: 'Inspection', sortOrder: 4 },
    ],
    blockers: [
      { title: 'Permit + electrical inspection', severity: 'critical' },
      { title: 'Utility disconnect scheduling', severity: 'high' },
      { title: 'Knob-and-tube or aluminum wiring found', severity: 'high' },
    ],
    budgetLines: [
      {
        category: 'materials',
        label: 'Panel + devices',
        sortOrder: 0,
      },
      {
        category: 'labor',
        label: 'Electrician labor',
        sortOrder: 1,
      },
      {
        category: 'permits',
        label: 'Permits / inspection',
        sortOrder: 2,
      },
    ],
  },
  hvac_replace: {
    key: 'hvac_replace',
    title: 'HVAC replacement',
    type: 'replacement',
    contingencyPct: 0,
    phases: [
      { title: 'Load calculation & quotes', sortOrder: 0 },
      { title: 'Order equipment', sortOrder: 1 },
      { title: 'Remove the old unit', sortOrder: 2 },
      { title: 'Install', sortOrder: 3 },
      { title: 'Commission & test', sortOrder: 4 },
    ],
    blockers: [
      { title: 'Ductwork & line-set compatibility', severity: 'high' },
      { title: 'Permit + mechanical inspection', severity: 'medium' },
      { title: 'Rebate application deadline', severity: 'low' },
    ],
    budgetLines: [
      { category: 'materials', label: 'Equipment', sortOrder: 0 },
      { category: 'labor', label: 'Install labor', sortOrder: 1 },
      { category: 'permits', label: 'Permits', sortOrder: 2 },
    ],
  },
  roof_replace: {
    key: 'roof_replace',
    title: 'Roof replacement',
    type: 'replacement',
    contingencyPct: 0,
    phases: [
      { title: 'Inspection & quotes', sortOrder: 0 },
      { title: 'Permit & materials', sortOrder: 1 },
      { title: 'Tear-off', sortOrder: 2 },
      { title: 'Deck repair', sortOrder: 3 },
      { title: 'Install', sortOrder: 4 },
      { title: 'Cleanup & inspection', sortOrder: 5 },
    ],
    blockers: [
      { title: 'Weather window', severity: 'high' },
      { title: 'Insurance claim / adjuster', severity: 'medium' },
      { title: 'Deck rot found at tear-off', severity: 'medium' },
    ],
    budgetLines: [
      {
        category: 'materials',
        label: 'Roofing materials',
        sortOrder: 0,
      },
      { category: 'labor', label: 'Labor', sortOrder: 1 },
      {
        category: 'other',
        label: 'Tear-off + disposal',
        sortOrder: 2,
      },
      { category: 'permits', label: 'Permits', sortOrder: 3 },
    ],
  },
  window_door_replace: {
    key: 'window_door_replace',
    title: 'Windows & doors',
    type: 'replacement',
    contingencyPct: 0,
    phases: [
      { title: 'Measure & quote', sortOrder: 0 },
      { title: 'Order', sortOrder: 1 },
      { title: 'Remove old units', sortOrder: 2 },
      { title: 'Install', sortOrder: 3 },
      { title: 'Trim, seal & finish', sortOrder: 4 },
    ],
    blockers: [
      { title: 'Lead time on custom sizes', severity: 'medium' },
      { title: 'Egress / code sizing', severity: 'high' },
    ],
    budgetLines: [
      {
        category: 'materials',
        label: 'Windows + doors',
        sortOrder: 0,
      },
      { category: 'labor', label: 'Install labor', sortOrder: 1 },
      { category: 'other', label: 'Disposal', sortOrder: 2 },
    ],
  },
  replace_fixture: {
    key: 'replace_fixture',
    title: 'Replace a fixture',
    type: 'replacement',
    contingencyPct: 0,
    phases: [{ title: 'Replace', sortOrder: 0 }],
    blockers: [],
    budgetLines: [
      {
        category: 'materials',
        label: 'Fixture + supplies',
        sortOrder: 0,
      },
      { category: 'labor', label: 'Labor', sortOrder: 1 },
    ],
  },
  outdoor_refresh: {
    key: 'outdoor_refresh',
    title: 'Outdoor refresh',
    type: 'outdoor',
    contingencyPct: 0,
    phases: [
      { title: 'Plan & measure', sortOrder: 0 },
      { title: 'Clear & prep', sortOrder: 1 },
      { title: 'Build / plant', sortOrder: 2 },
      { title: 'Finish & cleanup', sortOrder: 3 },
    ],
    blockers: [
      { title: 'Utility locate before digging', severity: 'high' },
      { title: 'HOA / municipal approval', severity: 'medium' },
      { title: 'Planting season window', severity: 'low' },
    ],
    budgetLines: [
      {
        category: 'materials',
        label: 'Plants + materials',
        sortOrder: 0,
      },
      { category: 'labor', label: 'Labor', sortOrder: 1 },
      {
        category: 'other',
        label: 'Equipment rental',
        sortOrder: 2,
      },
    ],
  },
  blank: {
    key: 'blank',
    title: 'Blank project',
    type: 'custom',
    contingencyPct: 0,
    phases: [],
    blockers: [],
    budgetLines: [],
  },
};

/**
 * `getTemplate`, ported — an unknown key is `null`, not a throw.
 *
 * `createProject` therefore falls back to a bare project with one contingency
 * line rather than rejecting the request, which is the server's behaviour and
 * the reason the route's zod enum is the only thing narrowing the key at all.
 */
export function getHomeProjectTemplateSeed(
  key: string | undefined | null,
): HomeProjectTemplateSeed | null {
  if (!key) return null;
  return HOME_PROJECT_TEMPLATE_SEEDS[key as HomeProjectTemplateKey] ?? null;
}

// ---------------------------------------------------------------------------
// The export summary
// ---------------------------------------------------------------------------

export type ExportSummaryInput = {
  project: { title: string; status: string; type: string };
  rollups: HomeProjectRollups;
  selections: readonly { name: string; unit_price_cents: number | null }[];
  phases: readonly { title: string; status: string }[];
};

/**
 * `exportProjectSummary`'s line builder, ported verbatim.
 *
 * Every formatting decision here is observable, because the result is text a
 * member shares out of the app: cents divided by 100 and rendered with
 * `toFixed(0)` (so `$12,000.49` shares as `$12000`), `'n/a'` rather than a blank
 * for an unset target, the blank line before each of the two lists, and the
 * dashes. A household that switched backends would otherwise share two
 * different-looking documents for the same project.
 *
 * The server passes `lines.slice(1)` into the PDF builder and the whole array
 * into the share text; only the share text survives here, so the array is
 * returned whole and the caller joins it.
 */
export function buildHomeProjectSummaryLines(
  input: ExportSummaryInput,
): string[] {
  const { project, rollups, selections, phases } = input;
  return [
    `Home Project: ${project.title}`,
    `Status: ${project.status} · Type: ${project.type}`,
    `Budget target: ${
      rollups.target_budget_cents != null
        ? `$${(rollups.target_budget_cents / 100).toFixed(0)}`
        : 'n/a'
    }`,
    `Estimate: $${(rollups.estimate_total / 100).toFixed(0)} · Actual: $${(
      rollups.actual_total / 100
    ).toFixed(0)}`,
    `Health: ${rollups.budget_health}`,
    '',
    'Selections:',
    ...selections.map(
      selection =>
        `- ${selection.name}${
          selection.unit_price_cents != null
            ? ` ($${(selection.unit_price_cents / 100).toFixed(0)})`
            : ''
        }`,
    ),
    '',
    'Phases:',
    ...phases.map(phase => `- ${phase.title} (${phase.status})`),
  ];
}
