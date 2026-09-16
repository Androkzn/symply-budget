/**
 * Smart Project against a REAL member request and REAL photos.
 *
 * Input is verbatim from a member with five photos of their shed:
 *
 *   "I'm going to renovate my shed dimensions are length 5 m width 3m hight
 *    2.5 m I need to add ventilation I need to add insulation. I need to add
 *    OSB panel to cover walls and ceiling. Also, I want to paint the walls that
 *    more light and put something on the floor greater project for me."
 *
 * `GENERATION` below is what the multimodal model returns for that text plus
 * those photos — the photos establish the as-is state, which is the half a
 * description alone cannot settle:
 *
 *   present — plank roof deck and rafters; 2x4 stud walls; OSB sheathing behind
 *             the studs; bare concrete slab; ceiling light fitted; switch,
 *             receptacles and armoured cable at the door; one window; steel door
 *   absent  — nothing in the stud cavities; interior face of the studs bare;
 *             rafters and roof deck open; no vents; bare concrete; no paint
 *
 * Everything downstream of that object is the real shipping code: the schema
 * parse, `orderPhases`, `applyAsIsToPhases`, `deriveSmartProjectSurfaces` and
 * the whole `writeDraft` path. Only the model call is stood in for.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createHomeProjectTables } from '../../../routes/__tests__/home-projects-test-schema';
import type { Env, HomeProjectSmartDraftMessage } from '../../../types';
import {
  createCoreTables,
  resetAllTables,
} from '../../aihousekeeper/__tests__/test-helpers';

let generation: unknown;

const mockAssertCanUseAI = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../../entitlement-service', () => ({
  assertCanUseAI: (...args: unknown[]) => mockAssertCanUseAI(...args),
}));
vi.mock('../../ai-credential-resolver', () => ({
  resolveProviderApiKey: async () => ({ apiKey: 'test-key', provider: 'anthropic' }),
  hasUsableProviderKey: async () => true,
}));
vi.mock('../../ai-usage-service', () => ({ usageRecorderFor: () => () => {} }));
// The handler now sends IMAGES, so it uses `generate` with a forced `output`
// tool rather than `generateStructured` (which cannot carry them). The mock
// mirrors that shape: a tool_use block whose `input` is the generation.
vi.mock('../../../ai/provider-factory', () => ({
  createProviderAdapter: () => ({
    provider: 'anthropic',
    generate: async () => ({
      content: [{ type: 'tool_use', name: 'output', input: generation }],
      stopReason: 'tool_use',
      model: 'test',
    }),
  }),
}));
vi.mock('../../notification-service', () => ({
  NotificationService: class {
    async sendNotification(): Promise<void> {}
  },
}));

const { handleHomeProjectSmartDraftJob } = await import(
  '../home-project-smart-draft-job-handler'
);

/**
 * The handler reads photos out of R2 now. Tests that pass no keys never touch
 * it; the one that does gets an empty bucket, which the loader skips — proving
 * a missing object degrades the draft rather than failing it.
 */
const testEnv = {
  ...(env as unknown as Env),
  REPORTS_BUCKET: {
    get: async () => null,
  },
} as unknown as Env;
const HID = 'hh_shed';
const UID = 'u_shed';
const PROJECT_ID = 'p_shed';
const DRAFT_ID = 'd_shed';

/** The member's own numbers. Every area below is derived from these. */
// 2.5 m is the WALL height the member gave. The photos show the shed is open
// to its rafters, so the ridge is higher — 3.2 m, a 0.7 m rise, which is a
// normal shed pitch and what the wizard now asks for explicitly.
const SHED = { label: 'Shed', length_m: 5.0, width_m: 3.0, height_m: 2.5, ridge_height_m: 3.2 };

const DESCRIPTION =
  "I'm going to renovate my shed dimensions are length 5 m width 3m hight 2.5 m " +
  'I need to add ventilation I need to add insulation. I need to add OSB panel to ' +
  'cover walls and ceiling. Also, I want to paint the walls that more light and ' +
  'put something on the floor greater project for me.';

const GENERATION = {
  title: 'Shed interior finish',
  type: 'renovation',
  target_use: null,
  summary:
    'Finish the inside of an existing shed: ventilate it, insulate the walls and ' +
    'ceiling, sheet them in OSB, paint the walls a light colour and put a floor ' +
    'finish over the slab.',
  as_is: [
    { element: 'roof', state: 'present', evidence: 'plank roof deck and rafters are in place' },
    { element: 'framing', state: 'present', evidence: '2x4 stud walls throughout' },
    { element: 'exterior_walls', state: 'present', evidence: 'OSB sheathing behind the studs' },
    { element: 'foundation_slab', state: 'present', evidence: 'bare concrete slab floor' },
    { element: 'windows', state: 'present', evidence: 'one window on the side wall' },
    { element: 'doors', state: 'present', evidence: 'steel entry door fitted' },
    { element: 'electrical_supply', state: 'present', evidence: 'switch, receptacles and armoured cable at the door' },
    { element: 'lighting', state: 'present', evidence: 'ceiling light fixture already fitted' },
    { element: 'insulation', state: 'absent', evidence: 'stud cavities are open' },
    { element: 'wall_covering', state: 'absent', evidence: 'interior face of the studs is bare' },
    { element: 'ceiling_covering', state: 'absent', evidence: 'rafters and roof deck are open' },
    { element: 'ventilation', state: 'absent', evidence: 'no vents visible; member asked for ventilation' },
    { element: 'floor_covering', state: 'absent', evidence: 'bare concrete' },
    { element: 'paint', state: 'absent', evidence: 'nothing painted inside' },
    { element: 'vapour_barrier', state: 'unknown' },
  ],
  phases: [
    { title: 'Ventilation', sort_order: 0, depends_on: [], rationale: 'Vents go in before anything closes the walls up.' },
    { title: 'Insulation', sort_order: 1, depends_on: ['Ventilation'] },
    { title: 'Wall and ceiling covering (OSB)', sort_order: 2, depends_on: ['Insulation'] },
    { title: 'Paint', sort_order: 3, depends_on: ['Wall and ceiling covering (OSB)'] },
    { title: 'Floor finish', sort_order: 4, depends_on: ['Paint'] },
  ],
  surfaces: [
    { name: 'Walls', kind: 'wall', category: 'finish', waste_factor_pct: 10 },
    { name: 'Ceiling', kind: 'ceiling', category: 'finish', waste_factor_pct: 10 },
    { name: 'Floor', kind: 'floor', category: 'finish', waste_factor_pct: 10 },
  ],
  materials: [
    { label: 'Mineral wool batt insulation, 2x4 cavity', surface_name: 'Walls', category: 'insulation', unit: 'bag', coverage_per_unit: 5.6, coverage_unit: 'm2', confidence: 'medium' },
    { label: 'Mineral wool batt insulation, rafter depth', surface_name: 'Ceiling', category: 'insulation', unit: 'bag', coverage_per_unit: 4.2, coverage_unit: 'm2', confidence: 'medium' },
    { label: 'OSB sheathing panel 4x8, 7/16"', surface_name: 'Walls', category: 'panel', unit: 'sheet', coverage_per_unit: 2.98, coverage_unit: 'm2', confidence: 'high' },
    { label: 'OSB sheathing panel 4x8, 7/16"', surface_name: 'Ceiling', category: 'panel', unit: 'sheet', coverage_per_unit: 2.98, coverage_unit: 'm2', confidence: 'high' },
    { label: 'Interior latex paint, white', surface_name: 'Walls', category: 'paint', unit: 'can', coverage_per_unit: 10, coverage_unit: 'm2', confidence: 'medium', notes: 'OSB drinks the first coat — prime or expect two.' },
    { label: 'Gable and soffit vents', category: 'ventilation', unit: 'each', confidence: 'medium' },
    { label: 'Floor coating or interlocking tile', surface_name: 'Floor', category: 'flooring', unit: 'kit', coverage_per_unit: 18.5, coverage_unit: 'm2', confidence: 'low', notes: 'Depends whether the slab stays dry — check before choosing.' },
  ],
  tasks: [
    { title: 'Check the slab for damp before choosing a floor finish', rationale: 'A shed slab often has no vapour break under it.' },
    { title: 'Confirm the existing circuit can carry a vent fan', phase_title: 'Ventilation' },
  ],
  blockers: [
    { title: 'Passive vents or a powered fan?', severity: 'medium', question: 'A fan needs a circuit and a switch; passive gable vents do not. Which do you want?' },
    { title: 'Is a vapour barrier needed here?', severity: 'medium', question: 'It depends on your climate and whether the shed will be heated. Worth confirming before the OSB goes on.' },
  ],
  confidence: 'medium',
};

function message(): HomeProjectSmartDraftMessage {
  return {
    draftId: DRAFT_ID,
    projectId: PROJECT_ID,
    householdId: HID,
    userId: UID,
    attachmentR2Keys: ['r2/shed-1.jpg', 'r2/shed-2.jpg', 'r2/shed-3.jpg', 'r2/shed-4.jpg', 'r2/shed-5.jpg'],
    enqueuedAt: 0,
  };
}

beforeEach(async () => {
  generation = GENERATION;
  await createCoreTables(testEnv.DB);
  await createHomeProjectTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  for (const t of [
    'home_project_as_is', 'home_project_smart_drafts', 'home_project_phases',
    'home_project_option_groups', 'home_project_selections', 'home_project_blockers',
    'home_project_budget_lines', 'home_project_geometry', 'home_projects',
  ]) {
    await testEnv.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await testEnv.DB.prepare(
    `INSERT INTO home_projects (id, household_id, title, type, status, visibility, created_by, created_at, updated_at)
     VALUES (?, ?, 'Drafting…', 'renovation', 'planning', 'draft', ?, datetime('now'), datetime('now'))`
  ).bind(PROJECT_ID, HID, UID).run();
  await testEnv.DB.prepare(
    `INSERT INTO home_project_smart_drafts (id, project_id, status, description, spaces_json, created_by, created_at, updated_at)
     VALUES (?, ?, 'generating', ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(DRAFT_ID, PROJECT_ID, DESCRIPTION, JSON.stringify([SHED]), UID).run();
});

describe('the shed, end to end through the real pipeline', () => {
  it('produces the draft, and the draft is right', async () => {
    const outcome = await handleHomeProjectSmartDraftJob(testEnv, message(), {
      attempt: 1,
      maxAttempts: 3,
    });
    expect(outcome.kind).toBe('completed');

    // ---- areas, from the member's 5 x 3 x 2.5 -----------------------------
    const groups = await testEnv.DB.prepare(
      'SELECT name, area_value, area_unit, area_source, waste_factor_pct FROM home_project_option_groups WHERE project_id = ? ORDER BY sort_order'
    ).bind(PROJECT_ID).all<{ name: string; area_value: number; area_unit: string; area_source: string; waste_factor_pct: number }>();
    const byName = Object.fromEntries(groups.results.map(g => [g.name, g]));

    expect(byName['Floor'].area_value).toBeCloseTo(15, 2);      // 5 x 3 — a roof does not move the slab
    // Vaulted: two 1.655 m slopes x 5 m, NOT the 15 m2 footprint.
    expect(byName['Ceiling'].area_value).toBeCloseTo(16.55, 1);
    // 2(5+3) x 2.5 = 40, plus the two gable triangles (3 x 0.7 = 2.1).
    expect(byName['Walls'].area_value).toBeCloseTo(42.1, 1);
    for (const g of groups.results) expect(g.area_source).toBe('manual');

    // ---- what the photos said is already there ---------------------------
    const asIs = await testEnv.DB.prepare(
      'SELECT element, state, evidence FROM home_project_as_is WHERE project_id = ? ORDER BY element'
    ).bind(PROJECT_ID).all<{ element: string; state: string; evidence: string }>();
    const state = Object.fromEntries(asIs.results.map(a => [a.element, a.state]));
    expect(state['roof']).toBe('present');
    expect(state['foundation_slab']).toBe('present');
    expect(state['lighting']).toBe('present');
    expect(state['insulation']).toBe('absent');
    expect(state['ventilation']).toBe('absent');

    // ---- phases, in build order, with nothing already-done ----------------
    const phases = await testEnv.DB.prepare(
      'SELECT title, draft_source FROM home_project_phases WHERE project_id = ? ORDER BY sort_order'
    ).bind(PROJECT_ID).all<{ title: string; draft_source: string }>();
    const titles = phases.results.map(p => p.title);

    // Nothing that already exists got planned.
    expect(titles).not.toContain('Roofing');
    expect(titles.some(t => /framing/i.test(t))).toBe(false);
    // Cover-up never precedes what it covers.
    expect(titles.indexOf('Insulation')).toBeLessThan(
      titles.indexOf('Wall and ceiling covering (OSB)')
    );
    expect(titles.indexOf('Wall and ceiling covering (OSB)')).toBeLessThan(titles.indexOf('Paint'));

    // ---- no money, anywhere ----------------------------------------------
    const lines = await testEnv.DB.prepare(
      'SELECT estimate_cents FROM home_project_budget_lines WHERE project_id = ?'
    ).bind(PROJECT_ID).all<{ estimate_cents: number }>();
    for (const l of lines.results) expect(l.estimate_cents).toBe(0);

    const sels = await testEnv.DB.prepare(
      'SELECT name, unit, coverage_per_unit, unit_price_cents, extraction_source FROM home_project_selections WHERE project_id = ? ORDER BY sort_order'
    ).bind(PROJECT_ID).all<{ name: string; unit: string; coverage_per_unit: number | null; unit_price_cents: number | null; extraction_source: string }>();
    for (const s of sels.results) expect(s.unit_price_cents).toBeNull();

    // ---- still private ----------------------------------------------------
    const project = await testEnv.DB.prepare(
      'SELECT visibility, title FROM home_projects WHERE id = ?'
    ).bind(PROJECT_ID).first<{ visibility: string; title: string }>();
    expect(project!.visibility).toBe('draft');

    // ---- print the draft a member would actually see ----------------------
    const blockers = await testEnv.DB.prepare(
      'SELECT title, severity, notes FROM home_project_blockers WHERE project_id = ?'
    ).bind(PROJECT_ID).all<{ title: string; severity: string; notes: string }>();
    const draft = await testEnv.DB.prepare(
      'SELECT dropped_json, tasks_json, confidence FROM home_project_smart_drafts WHERE id = ?'
    ).bind(DRAFT_ID).first<{ dropped_json: string; tasks_json: string; confidence: string }>();

    const qty = (area: number, cov: number | null, waste: number) =>
      cov ? Math.ceil((area * (1 + waste / 100)) / cov) : null;

    // Resolve each material to the surface it is ACTUALLY linked to, by
    // option_group_id, rather than guessing from its label. The first version
    // of this print guessed by keyword and reported both OSB rows against the
    // walls — the rows were right and the display was wrong, which is exactly
    // the failure the real card must not have.
    const groupById = new Map(
      (await testEnv.DB.prepare(
        'SELECT id, name, area_value, waste_factor_pct FROM home_project_option_groups WHERE project_id = ?'
      ).bind(PROJECT_ID).all<{ id: string; name: string; area_value: number; waste_factor_pct: number }>()
      ).results.map(g => [g.id, g])
    );
    const linked = await testEnv.DB.prepare(
      'SELECT name, unit, coverage_per_unit, option_group_id FROM home_project_selections WHERE project_id = ? ORDER BY sort_order'
    ).bind(PROJECT_ID).all<{ name: string; unit: string; coverage_per_unit: number | null; option_group_id: string | null }>();

    const out: string[] = [];
    out.push(`\n╭─ ${project!.title}  ·  draft, only you can see this`);
    out.push(`│  5.0 × 3.0 × 2.5 m — your measurements`);
    out.push(`├─ SURFACES`);
    for (const g of groups.results) {
      out.push(`│    ${g.name.padEnd(9)} ${String(g.area_value).padStart(6)} m²  (+${g.waste_factor_pct}% waste)`);
    }
    out.push(`├─ MATERIALS  (quantities computed from your areas — no prices)`);
    for (const s of linked.results) {
      const g = s.option_group_id ? groupById.get(s.option_group_id) : undefined;
      const n = g ? qty(g.area_value, s.coverage_per_unit, g.waste_factor_pct) : null;
      const where = g ? g.name : '—';
      out.push(
        `│    ${s.name.slice(0, 42).padEnd(44)} ${where.padEnd(8)} ${n ? `${String(n).padStart(3)} ${s.unit}` : '  you decide'}`
      );
    }
    out.push(`├─ PHASES`);
    titles.forEach((t, i) => out.push(`│    ${i + 1}. ${t}`));
    const dropped = JSON.parse(draft!.dropped_json || '[]');
    if (dropped.length) {
      out.push(`├─ SKIPPED — you already have these`);
      for (const d of dropped) out.push(`│    ${d.title}  (${d.because.replace(/_/g, ' ')})`);
    }
    out.push(`├─ QUESTIONS FOR YOU`);
    for (const b of blockers.results) out.push(`│    [${b.severity}] ${b.title}${b.notes ? `\n│           ${b.notes}` : ''}`);
    out.push(`├─ TASKS (created only when you publish)`);
    for (const t of JSON.parse(draft!.tasks_json || '[]')) out.push(`│    ${t.title}`);
    out.push(`╰─ confidence: ${draft!.confidence}\n`);
    console.log(out.join('\n'));
  });
});
