/**
 * Home Project template seeds (TRD / Implementation §9).
 *
 * A template supplies STRUCTURE, not a price: the phases a job runs through, the
 * decisions someone has to make, the things that stop the job, and the budget
 * rows to fill in.
 *
 * **No seed carries money, and that now includes the RATE.** Budget lines seed at
 * zero, no contingency line is seeded at all, and `contingencyPct` seeds at 0 —
 * so a project created from a template costs nothing until its owner prices
 * something, and then costs exactly what they priced. The figures that used to be
 * here were national averages invented without this household's city, contractor
 * or scope, and they landed in the hub's Estimate the moment the project existed
 * — the same false anchor the wizard's "~$12k avg" caption was removed for, one
 * screen later.
 *
 * The per-template 10/15/20% buffer went last and for the same reason. A rate is
 * a smaller lie than an amount but it is still a guess about a job nobody has
 * scoped, and it compounds every real figure the member types: price $5,000 of
 * tile and the project quietly claims $5,750. Contingency is now something a
 * member turns ON — the Budget tab has the field and explains what it buys.
 *
 * Leaving the contingency line OUT is still load-bearing rather than tidy:
 * `computeRollups` prefers an explicit `contingency` LINE to the percentage, so a
 * line seeded at zero would peg contingency at zero even for a member who later
 * sets a rate. With no line, the project's `contingencyPct` computes live off
 * whatever the member has actually priced.
 *
 * Mirrored on device at `src/features/house/local/logic/homeProjects.ts` for
 * local-first households — the seeds are ledger rows the device writes itself.
 * Keep the two in sync: a template added here and not there creates a project
 * with no phases on a local-first household.
 */

export type TemplateKey =
  | 'bathroom_reno'
  | 'kitchen_reno'
  | 'basement_finish'
  | 'expand_space'
  | 'paint_refresh'
  | 'flooring_replace'
  | 'furniture_replace'
  | 'appliance_replace'
  | 'plumbing_replace'
  | 'electrical_upgrade'
  | 'hvac_replace'
  | 'roof_replace'
  | 'window_door_replace'
  | 'replace_fixture'
  | 'outdoor_refresh'
  | 'blank';

export interface TemplatePhaseSeed {
  title: string;
  sortOrder: number;
}

export interface TemplateBlockerSeed {
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/** A budget ROW to price, never a price. Seeded at zero — see the file header. */
export interface TemplateBudgetSeed {
  category: string;
  label: string;
  sortOrder: number;
}

export interface HomeProjectTemplate {
  key: TemplateKey;
  title: string;
  type: string;
  phases: TemplatePhaseSeed[];
  blockers: TemplateBlockerSeed[];
  budgetLines: TemplateBudgetSeed[];
  contingencyPct: number;
}

/**
 * Insertion order is the order the wizard lists them in, so the grouping is
 * deliberate: whole-room jobs, then finishes, then the system and component
 * replacements a household actually plans around, then the open-ended ones.
 *
 * `contingencyPct` is 0 on every template — a template supplies no money at all,
 * not even as a rate. It remains a field rather than being deleted because it is
 * a real project column the member can set themselves on the Budget tab.
 */
export const HOME_PROJECT_TEMPLATES: Record<TemplateKey, HomeProjectTemplate> =
  {
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
        { category: 'materials', label: 'Framing + drywall', sortOrder: 0 },
        { category: 'materials', label: 'Flooring + finishes', sortOrder: 1 },
        { category: 'labor', label: 'Labor', sortOrder: 2 },
        { category: 'permits', label: 'Permits / inspections', sortOrder: 3 },
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
        { category: 'permits', label: 'Permits / engineering', sortOrder: 2 },
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
        { category: 'other', label: 'Removal + disposal', sortOrder: 2 },
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
        { category: 'other', label: 'Delivery + assembly', sortOrder: 1 },
        { category: 'other', label: 'Haul-away / donation', sortOrder: 2 },
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
        { category: 'materials', label: 'Pipe + fittings', sortOrder: 0 },
        { category: 'labor', label: 'Plumber labor', sortOrder: 1 },
        { category: 'permits', label: 'Permits / inspection', sortOrder: 2 },
        { category: 'other', label: 'Drywall patch + paint', sortOrder: 3 },
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
        { category: 'materials', label: 'Panel + devices', sortOrder: 0 },
        { category: 'labor', label: 'Electrician labor', sortOrder: 1 },
        { category: 'permits', label: 'Permits / inspection', sortOrder: 2 },
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
        { category: 'materials', label: 'Roofing materials', sortOrder: 0 },
        { category: 'labor', label: 'Labor', sortOrder: 1 },
        { category: 'other', label: 'Tear-off + disposal', sortOrder: 2 },
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
        { category: 'materials', label: 'Windows + doors', sortOrder: 0 },
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
        { category: 'materials', label: 'Fixture + supplies', sortOrder: 0 },
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
        { category: 'materials', label: 'Plants + materials', sortOrder: 0 },
        { category: 'labor', label: 'Labor', sortOrder: 1 },
        { category: 'other', label: 'Equipment rental', sortOrder: 2 },
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
 * The catalogue's keys as a tuple, for `z.enum` on the create route.
 *
 * Derived rather than re-typed: the route validates `templateKey` before the
 * service ever looks it up, so a key listed in the catalogue and forgotten in a
 * hand-written enum is a 400 on a template the wizard is already offering.
 */
export const TEMPLATE_KEYS = Object.keys(HOME_PROJECT_TEMPLATES) as [
  TemplateKey,
  ...TemplateKey[],
];

export function getTemplate(
  key: string | undefined | null,
): HomeProjectTemplate | null {
  if (!key) return null;
  return HOME_PROJECT_TEMPLATES[key as TemplateKey] ?? null;
}
