/**
 * Smart Project job handler.
 *
 * The assertions that carry the product decisions:
 *   - no budget line ever gets a non-zero `estimate_cents`, and no selection
 *     gets a `unit_price_cents`, even when the model tries (BRD D3);
 *   - every `area_value` matches the member's typed dimensions exactly, and no
 *     surfaces exist at all when dimensions were skipped (BRD D2);
 *   - a phase for work the as-is state says is done never reaches the project.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createHomeProjectTables } from '../../../routes/__tests__/home-projects-test-schema';
import type { Env, HomeProjectSmartDraftMessage } from '../../../types';
import {
  createCoreTables,
  resetAllTables,
} from '../../aihousekeeper/__tests__/test-helpers';

/** What the fake model returns. Each test sets this before invoking. */
let generation: unknown;

// Typed with a rest parameter so the `(...args)` forwarding below is a
// legal spread rather than a TS2556.
const mockAssertCanUseAI = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../../entitlement-service', () => ({
  assertCanUseAI: (...args: unknown[]) => mockAssertCanUseAI(...args),
}));
vi.mock('../../ai-credential-resolver', () => ({
  resolveProviderApiKey: async () => ({ apiKey: 'test-key', provider: 'anthropic' }),
  hasUsableProviderKey: async () => true,
}));
vi.mock('../../ai-usage-service', () => ({
  usageRecorderFor: () => () => {},
}));
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

const HID = 'hh_sdjob';
const UID = 'u_sdjob';
const PROJECT_ID = 'p_sdjob';
const DRAFT_ID = 'd_sdjob';

/** The shed from the BRD: 6.0 × 3.6 × 2.4. */
const SHED = { label: 'Shed', length_m: 6.0, width_m: 3.6, height_m: 2.4 };

const SHED_GENERATION = {
  title: 'Shed → woodworking shop',
  type: 'conversion',
  target_use: 'woodworking shop',
  as_is: [
    { element: 'roof', state: 'present', evidence: 'it has a roof' },
    { element: 'foundation_slab', state: 'present', evidence: 'concrete floor' },
    { element: 'insulation', state: 'absent' },
    { element: 'plumbing_rough_in', state: 'unknown' },
  ],
  phases: [
    { title: 'Insulation', sort_order: 1, depends_on: ['Electrical rough-in'] },
    { title: 'Electrical rough-in', sort_order: 0, depends_on: [] },
    { title: 'Roofing', sort_order: 2, depends_on: [] },
  ],
  surfaces: [
    { name: 'Walls', kind: 'wall', category: 'finish', waste_factor_pct: 10 },
    { name: 'Ceiling', kind: 'ceiling', category: 'finish', waste_factor_pct: 10 },
    { name: 'Floor', kind: 'floor', category: 'finish', waste_factor_pct: 10 },
  ],
  materials: [
    {
      label: 'Batt insulation R14',
      surface_name: 'Walls',
      category: 'insulation',
      unit: 'bag',
      coverage_per_unit: 4,
      coverage_unit: 'm2',
      confidence: 'medium',
    },
  ],
  tasks: [{ title: 'Confirm shed circuit capacity at the panel' }],
  blockers: [
    { title: 'Is a subpanel needed?', severity: 'high', question: 'Confirm with an electrician' },
  ],
  confidence: 'medium',
};

function message(): HomeProjectSmartDraftMessage {
  return {
    draftId: DRAFT_ID,
    projectId: PROJECT_ID,
    householdId: HID,
    userId: UID,
    attachmentR2Keys: [],
    enqueuedAt: Date.now(),
  };
}

async function seedDraft(spaces: unknown[] | null): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO home_projects (id, household_id, title, type, status, visibility, created_by, created_at, updated_at)
     VALUES (?, ?, 'Drafting…', 'renovation', 'planning', 'draft', ?, datetime('now'), datetime('now'))`
  )
    .bind(PROJECT_ID, HID, UID)
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO home_project_smart_drafts (id, project_id, status, description, spaces_json, created_by, created_at, updated_at)
     VALUES (?, ?, 'generating', ?, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind(
      DRAFT_ID,
      PROJECT_ID,
      'I have a shed with a roof, walls and a concrete floor. Convert it to a woodworking shop.',
      spaces ? JSON.stringify(spaces) : null,
      UID
    )
    .run();
}

const opts = { attempt: 1, maxAttempts: 3 };

beforeEach(async () => {
  generation = SHED_GENERATION;
  mockAssertCanUseAI.mockClear();
  await createCoreTables(testEnv.DB);
  await createHomeProjectTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  // `resetAllTables` only knows the core tables, so home-project rows survive
  // between tests and the second seed hits a PK collision. Clear them here
  // rather than teaching the shared helper about a feature it does not own.
  for (const table of [
    'home_project_as_is',
    'home_project_smart_drafts',
    'home_project_phases',
    'home_project_option_groups',
    'home_project_selections',
    'home_project_blockers',
    'home_project_budget_lines',
    'home_project_geometry',
    'home_projects',
  ]) {
    await testEnv.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('areas come from the member, quantities from shared code', () => {
  it('writes surface areas computed from the typed dimensions', async () => {
    await seedDraft([SHED]);
    const outcome = await handleHomeProjectSmartDraftJob(testEnv, message(), opts);
    expect(outcome.kind).toBe('completed');

    const groups = await testEnv.DB.prepare(
      'SELECT name, area_value, area_unit, area_source FROM home_project_option_groups WHERE project_id = ?'
    )
      .bind(PROJECT_ID)
      .all<{ name: string; area_value: number; area_unit: string; area_source: string }>();

    const byName = Object.fromEntries(groups.results.map(g => [g.name, g]));
    // 6.0 × 3.6 = 21.6 ; perimeter 19.2 × 2.4 = 46.08
    expect(byName['Floor'].area_value).toBeCloseTo(21.6, 2);
    expect(byName['Ceiling'].area_value).toBeCloseTo(21.6, 2);
    expect(byName['Walls'].area_value).toBeCloseTo(46.08, 2);
    // 'manual' — the numbers came from the member, through exact arithmetic.
    expect(byName['Walls'].area_source).toBe('manual');
    expect(byName['Walls'].area_unit).toBe('m2');
  });

  it('writes NO surfaces at all when dimensions were skipped', async () => {
    await seedDraft(null);
    const outcome = await handleHomeProjectSmartDraftJob(testEnv, message(), opts);
    expect(outcome.kind).toBe('completed');

    const groups = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM home_project_option_groups WHERE project_id = ?'
    )
      .bind(PROJECT_ID)
      .first<{ n: number }>();
    // Not "surfaces with zero area" — none. A guessed area gets bought.
    expect(groups!.n).toBe(0);
  });

  it('stores the room model as manual geometry the surface editor can open', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const geom = await testEnv.DB.prepare(
      'SELECT source, status, payload_json FROM home_project_geometry WHERE project_id = ?'
    )
      .bind(PROJECT_ID)
      .first<{ source: string; status: string; payload_json: string }>();
    expect(geom!.source).toBe('manual');
    expect(geom!.status).toBe('completed');
    const model = JSON.parse(geom!.payload_json);
    expect(model.surfaces.filter((s: { kind: string }) => s.kind === 'wall')).toHaveLength(4);
  });

  it('ignores an area the model tries to smuggle into a surface', async () => {
    await seedDraft([SHED]);
    generation = {
      ...SHED_GENERATION,
      surfaces: [{ name: 'Walls', kind: 'wall', category: 'finish', area_m2: 999 }],
    };
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const walls = await testEnv.DB.prepare(
      "SELECT area_value FROM home_project_option_groups WHERE project_id = ? AND name = 'Walls'"
    )
      .bind(PROJECT_ID)
      .first<{ area_value: number }>();
    expect(walls!.area_value).toBeCloseTo(46.08, 2);
  });
});

describe('no money reaches the project', () => {
  it('writes budget lines with a zero estimate', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const lines = await testEnv.DB.prepare(
      'SELECT estimate_cents, actual_cents FROM home_project_budget_lines WHERE project_id = ?'
    )
      .bind(PROJECT_ID)
      .all<{ estimate_cents: number; actual_cents: number }>();
    expect(lines.results.length).toBeGreaterThan(0);
    for (const line of lines.results) {
      expect(line.estimate_cents).toBe(0);
      expect(line.actual_cents).toBe(0);
    }
  });

  it('leaves every material unpriced — NULL, not a rendered $0.00', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const sels = await testEnv.DB.prepare(
      'SELECT unit_price_cents, list_price_cents, sale_price_cents FROM home_project_selections WHERE project_id = ?'
    )
      .bind(PROJECT_ID)
      .all<{
        unit_price_cents: number | null;
        list_price_cents: number | null;
        sale_price_cents: number | null;
      }>();
    expect(sels.results.length).toBeGreaterThan(0);
    for (const s of sels.results) {
      expect(s.unit_price_cents).toBeNull();
      expect(s.list_price_cents).toBeNull();
      expect(s.sale_price_cents).toBeNull();
    }
  });

  it('ignores a price the model tries to attach to a material', async () => {
    await seedDraft([SHED]);
    generation = {
      ...SHED_GENERATION,
      materials: [
        {
          label: 'Batt insulation',
          category: 'insulation',
          unit: 'bag',
          unit_price_cents: 4599,
          estimate_cents: 120000,
        },
      ],
    };
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const sel = await testEnv.DB.prepare(
      'SELECT unit_price_cents FROM home_project_selections WHERE project_id = ?'
    )
      .bind(PROJECT_ID)
      .first<{ unit_price_cents: number | null }>();
    expect(sel!.unit_price_cents).toBeNull();
  });
});

describe('as-is state keeps finished work out of the plan', () => {
  it('does not write a phase for work the member says is done', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const phases = await testEnv.DB.prepare(
      'SELECT title FROM home_project_phases WHERE project_id = ? ORDER BY sort_order'
    )
      .bind(PROJECT_ID)
      .all<{ title: string }>();
    const titles = phases.results.map(p => p.title);
    expect(titles).not.toContain('Roofing');
    expect(titles).toContain('Insulation');
  });

  it('records why the phase was skipped so review can explain the gap', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const draft = await testEnv.DB.prepare(
      'SELECT dropped_json FROM home_project_smart_drafts WHERE id = ?'
    )
      .bind(DRAFT_ID)
      .first<{ dropped_json: string }>();
    const dropped = JSON.parse(draft!.dropped_json);
    expect(dropped).toEqual([{ title: 'Roofing', because: 'roof' }]);
  });

  it('orders phases so rough-in precedes what covers it', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const phases = await testEnv.DB.prepare(
      'SELECT title FROM home_project_phases WHERE project_id = ? ORDER BY sort_order'
    )
      .bind(PROJECT_ID)
      .all<{ title: string }>();
    const titles = phases.results.map(p => p.title);
    expect(titles.indexOf('Electrical rough-in')).toBeLessThan(titles.indexOf('Insulation'));
  });

  it('turns an unknown element into a question rather than a phase', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const blockers = await testEnv.DB.prepare(
      'SELECT title FROM home_project_blockers WHERE project_id = ?'
    )
      .bind(PROJECT_ID)
      .all<{ title: string }>();
    expect(blockers.results.some(b => b.title.includes('Plumbing rough in'))).toBe(true);
  });

  it('persists the as-is rows with their evidence', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const rows = await testEnv.DB.prepare(
      "SELECT element, state, evidence, source FROM home_project_as_is WHERE project_id = ? AND element = 'roof'"
    )
      .bind(PROJECT_ID)
      .first<{ element: string; state: string; evidence: string; source: string }>();
    expect(rows).toMatchObject({
      state: 'present',
      evidence: 'it has a roof',
      source: 'smart_project',
    });
  });
});

describe('provenance and holding', () => {
  it('badges everything it wrote as AI drafted', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    for (const table of [
      'home_project_phases',
      'home_project_option_groups',
      'home_project_blockers',
    ]) {
      const row = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ? AND draft_source != 'smart_project'`
      )
        .bind(PROJECT_ID)
        .first<{ n: number }>();
      expect(row!.n).toBe(0);
    }
  });

  it('holds tasks on the draft row instead of the household task list', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const linked = await testEnv.DB.prepare(
      // Migration 0170: the link is a JSON array on the project row.
      'SELECT linked_task_ids AS ids FROM home_projects WHERE id = ?'
    )
      .bind(PROJECT_ID)
      .first<{ ids: string | null }>();
    expect(JSON.parse(linked!.ids ?? '[]')).toEqual([]);

    const draft = await testEnv.DB.prepare(
      'SELECT tasks_json FROM home_project_smart_drafts WHERE id = ?'
    )
      .bind(DRAFT_ID)
      .first<{ tasks_json: string }>();
    expect(JSON.parse(draft!.tasks_json)).toHaveLength(1);
  });

  it('leaves the project a draft — generation never publishes', async () => {
    await seedDraft([SHED]);
    await handleHomeProjectSmartDraftJob(testEnv, message(), opts);

    const project = await testEnv.DB.prepare(
      'SELECT visibility, title, target_use FROM home_projects WHERE id = ?'
    )
      .bind(PROJECT_ID)
      .first<{ visibility: string; title: string; target_use: string }>();
    expect(project!.visibility).toBe('draft');
    expect(project!.title).toBe('Shed → woodworking shop');
    expect(project!.target_use).toBe('woodworking shop');
  });
});

describe('failure handling', () => {
  it('treats a malformed generation as permanent, not retryable', async () => {
    await seedDraft([SHED]);
    generation = { nonsense: true };
    const outcome = await handleHomeProjectSmartDraftJob(testEnv, message(), opts);
    expect(outcome).toEqual({ kind: 'failed-permanent', code: 'malformed_generation' });

    const draft = await testEnv.DB.prepare(
      'SELECT status, error_code FROM home_project_smart_drafts WHERE id = ?'
    )
      .bind(DRAFT_ID)
      .first<{ status: string; error_code: string }>();
    expect(draft!.status).toBe('failed');
    expect(draft!.error_code).toBe('malformed_generation');
  });

  it('does not resurrect a cancelled draft on a late redelivery', async () => {
    await seedDraft([SHED]);
    await testEnv.DB.prepare(
      "UPDATE home_project_smart_drafts SET status = 'cancelled' WHERE id = ?"
    )
      .bind(DRAFT_ID)
      .run();

    const outcome = await handleHomeProjectSmartDraftJob(testEnv, message(), opts);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'status_is_cancelled' });

    const phases = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM home_project_phases WHERE project_id = ?'
    )
      .bind(PROJECT_ID)
      .first<{ n: number }>();
    expect(phases!.n).toBe(0);
  });

  it('retries a missing row before giving up on it', async () => {
    const outcome = await handleHomeProjectSmartDraftJob(testEnv, message(), {
      attempt: 1,
      maxAttempts: 3,
    });
    expect(outcome).toEqual({ kind: 'retry', code: 'row_missing' });
  });

  it('fails closed when the member has no AI entitlement', async () => {
    await seedDraft([SHED]);
    mockAssertCanUseAI.mockRejectedValueOnce(
      Object.assign(new Error('no ai'), { name: 'AIAccessError' })
    );

    const outcome = await handleHomeProjectSmartDraftJob(testEnv, message(), opts);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'entitlement_denied' });

    const draft = await testEnv.DB.prepare(
      'SELECT status, error_code FROM home_project_smart_drafts WHERE id = ?'
    )
      .bind(DRAFT_ID)
      .first<{ status: string; error_code: string }>();
    expect(draft!.status).toBe('failed');
    expect(draft!.error_code).toBe('entitlement_denied');
  });
});
