/**
 * `localTaskDraftsApi` — the "Tier B origin, Tier A afterlife" module.
 *
 * Drafts are minted by the reports pipeline, which can never leave the server
 * (plan §1.2), but every triage action a member performs on them is local. This
 * suite pins both halves: the ported filter/sort/summary behaviour from
 * `backend/src/services/task-draft-service.ts`, and the hard edge where
 * `generate` refuses rather than reaching for a server that has no rows.
 *
 * Static imports only — `await import()` throws under this Jest config (§6.2).
 */
import type { TaskDraft } from '@api/task-drafts';

import {
  getLocalHouseLedger,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnsupportedError } from '../errors';
import {
  HOUSE_LOCAL_TASK_DRAFTS_REMOTE_METHODS,
  localTaskDraftsApi,
} from '../localTaskDraftsApi';
import { getHouseUnsupportedCopy } from '../unsupportedCopy';

const USER = 'user-drafts-1';

async function freshSession() {
  await resetLocalHouseSession();
  return openLocalHouseSession({ userId: USER, displayName: 'Drafts home' });
}

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

function draftRow(id: string, overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    id,
    household_id: getLocalHouseLedger().household.id,
    report_id: 'rep_1',
    finding_id: null,
    title: `Draft ${id}`,
    description: 'Found during inspection',
    plain_language_summary: 'Worth fixing before winter',
    system_category: 'roofing',
    severity: 'major',
    priority_score: 50,
    suggested_timeframe: '3-6_months',
    suggested_frequency: null,
    is_recurring_suggestion: false,
    estimated_cost_min: 100,
    estimated_cost_max: 400,
    diy_possible: false,
    diy_difficulty: null,
    diy_cost_min: null,
    diy_cost_max: null,
    source_page_numbers: [4],
    source_quotes: ['shingles cupping'],
    image_ids: [],
    status: 'draft',
    converted_to_task_id: null,
    dismissed_reason: null,
    dismissed_at: null,
    converted_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Seed in ONE op — the fixture must not itself violate the bulk-write rule. */
async function seedDrafts(drafts: TaskDraft[]): Promise<void> {
  await mutateLocalHouseLedger(
    (ledger) => {
      ledger.taskDrafts.push(...drafts);
    },
    {
      opType: 'TEST_SEED_DRAFTS',
      entityType: 'taskDraft',
      entityId: drafts[0]!.id,
      payload: { count: drafts.length },
    },
  );
}

describe('localTaskDraftsApi — list', () => {
  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('defaults to status=draft, priority_score desc, with unscored drafts last', async () => {
    const ledger = await freshSession();
    await seedDrafts([
      draftRow('d1', { priority_score: 10 }),
      draftRow('d2', { priority_score: 90 }),
      draftRow('d3', { priority_score: null }),
      draftRow('d4', { status: 'dismissed', priority_score: 99 }),
    ]);

    const result = await localTaskDraftsApi.list(ledger.household.id);
    expect(result.drafts.map((draft) => draft.id)).toEqual(['d2', 'd1', 'd3']);
    expect(result.total).toBe(3);
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
  });

  it('filters by report, severity, category and status', async () => {
    const ledger = await freshSession();
    await seedDrafts([
      draftRow('d1', { report_id: 'rep_a', severity: 'critical', system_category: 'roofing' }),
      draftRow('d2', { report_id: 'rep_b', severity: 'critical', system_category: 'plumbing' }),
      draftRow('d3', { report_id: 'rep_a', severity: 'minor', system_category: 'roofing' }),
      draftRow('d4', { report_id: 'rep_a', severity: 'critical', status: 'converted' }),
    ]);

    expect(
      (await localTaskDraftsApi.list(ledger.household.id, { report_id: 'rep_a' })).drafts.map(
        (draft) => draft.id,
      ),
    ).toEqual(['d1', 'd3']);
    expect(
      (await localTaskDraftsApi.list(ledger.household.id, { severity: 'critical' })).drafts.map(
        (draft) => draft.id,
      ),
    ).toEqual(['d1', 'd2']);
    expect(
      (
        await localTaskDraftsApi.list(ledger.household.id, { system_category: 'plumbing' })
      ).drafts.map((draft) => draft.id),
    ).toEqual(['d2']);
    expect(
      (await localTaskDraftsApi.list(ledger.household.id, { status: 'converted' })).drafts.map(
        (draft) => draft.id,
      ),
    ).toEqual(['d4']);
  });

  it('paginates while `total` keeps counting the whole filtered set', async () => {
    const ledger = await freshSession();
    await seedDrafts([
      draftRow('d1', { priority_score: 90 }),
      draftRow('d2', { priority_score: 80 }),
      draftRow('d3', { priority_score: 70 }),
    ]);

    const page = await localTaskDraftsApi.list(ledger.household.id, { limit: 2, offset: 1 });
    expect(page.drafts.map((draft) => draft.id)).toEqual(['d2', 'd3']);
    expect(page.total).toBe(3);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
  });

  it('sorts by severity on the Worker’s rank ladder, by category and by date', async () => {
    const ledger = await freshSession();
    await seedDrafts([
      draftRow('d1', { severity: 'critical', system_category: 'roofing', created_at: '2026-08-03T00:00:00.000Z' }),
      draftRow('d2', { severity: 'informational', system_category: 'attic', created_at: '2026-08-01T00:00:00.000Z' }),
      draftRow('d3', { severity: 'minor', system_category: 'plumbing', created_at: '2026-08-02T00:00:00.000Z' }),
    ]);

    // `desc` on the ladder (critical=1 … informational=4) surfaces
    // informational FIRST. Counter-intuitive, and exactly what SQL does.
    expect(
      (
        await localTaskDraftsApi.list(ledger.household.id, {
          sort_by: 'severity',
          sort_order: 'desc',
        })
      ).drafts.map((draft) => draft.id),
    ).toEqual(['d2', 'd3', 'd1']);

    expect(
      (
        await localTaskDraftsApi.list(ledger.household.id, {
          sort_by: 'severity',
          sort_order: 'asc',
        })
      ).drafts.map((draft) => draft.id),
    ).toEqual(['d1', 'd3', 'd2']);

    expect(
      (
        await localTaskDraftsApi.list(ledger.household.id, {
          sort_by: 'category',
          sort_order: 'asc',
        })
      ).drafts.map((draft) => draft.id),
    ).toEqual(['d2', 'd3', 'd1']);

    expect(
      (
        await localTaskDraftsApi.list(ledger.household.id, {
          sort_by: 'created_at',
          sort_order: 'desc',
        })
      ).drafts.map((draft) => draft.id),
    ).toEqual(['d1', 'd3', 'd2']);
  });
});

describe('localTaskDraftsApi — summary', () => {
  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('folds open drafts only, and scopes to a report when asked', async () => {
    const ledger = await freshSession();
    await seedDrafts([
      draftRow('d1', {
        report_id: 'rep_a',
        severity: 'critical',
        system_category: 'roofing',
        estimated_cost_min: 100,
        estimated_cost_max: 500,
        diy_possible: true,
        is_recurring_suggestion: true,
      }),
      draftRow('d2', {
        report_id: 'rep_a',
        severity: 'minor',
        system_category: 'roofing',
        estimated_cost_min: null,
        estimated_cost_max: null,
      }),
      draftRow('d3', { report_id: 'rep_b', severity: 'major', system_category: 'hvac' }),
      // Converted drafts are out of the summary — it counts what is left to do.
      draftRow('d4', { report_id: 'rep_a', severity: 'critical', status: 'converted' }),
    ]);

    const all = await localTaskDraftsApi.getSummary(ledger.household.id);
    expect(all.total).toBe(3);
    expect(all.by_severity).toEqual({ critical: 1, major: 1, minor: 1, informational: 0 });
    expect(all.by_category).toEqual({ roofing: 2, hvac: 1 });
    expect(all.diy_possible_count).toBe(1);
    expect(all.recurring_suggestions).toBe(1);
    expect(all.total_cost_min).toBe(200);
    expect(all.total_cost_max).toBe(900);

    const scoped = await localTaskDraftsApi.getSummary(ledger.household.id, 'rep_b');
    expect(scoped.total).toBe(1);
    expect(scoped.by_category).toEqual({ hvac: 1 });
  });
});

describe('localTaskDraftsApi — conversion', () => {
  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('writes the task the service writes and flips the draft in one op', async () => {
    const ledger = await freshSession();
    await seedDrafts([draftRow('d1', { suggested_frequency: 'quarterly' })]);

    const before = opCount();
    const { taskId } = await localTaskDraftsApi.convert(ledger.household.id, 'd1', {});
    expect(opCount() - before).toBe(1);

    const task = getLocalHouseLedger().tasks.find((row) => row.id === taskId)!;
    expect(task.title).toBe('Draft d1');
    expect(task.system_category).toBe('roofing');
    expect(task.source).toBe('ai_generated');
    expect(task.is_active).toBe(true);
    expect(task.reminder_days_before).toBe(7);
    // No `add_recurring`, so the task is a one-off — 'custom' in the service.
    expect(task.frequency).toBe('custom');

    const draft = getLocalHouseLedger().taskDrafts.find((row) => row.id === 'd1')!;
    expect(draft.status).toBe('converted');
    expect(draft.converted_to_task_id).toBe(taskId);
    expect(draft.converted_at).toEqual(expect.any(String));
  });

  it('honours add_recurring, falling back through request → draft → yearly', async () => {
    const ledger = await freshSession();
    await seedDrafts([
      draftRow('d1', { suggested_frequency: 'quarterly' }),
      draftRow('d2', { suggested_frequency: null }),
      draftRow('d3', { suggested_frequency: 'monthly' }),
    ]);

    const withRequest = await localTaskDraftsApi.convert(ledger.household.id, 'd1', {
      add_recurring: true,
      frequency: 'weekly',
      start_date: '2026-10-01',
    });
    const fromDraft = await localTaskDraftsApi.convert(ledger.household.id, 'd3', {
      add_recurring: true,
    });
    const fallback = await localTaskDraftsApi.convert(ledger.household.id, 'd2', {
      add_recurring: true,
    });

    const tasks = getLocalHouseLedger().tasks;
    expect(tasks.find((row) => row.id === withRequest.taskId)!.frequency).toBe('weekly');
    expect(tasks.find((row) => row.id === withRequest.taskId)!.next_due_date).toBe('2026-10-01');
    expect(tasks.find((row) => row.id === fromDraft.taskId)!.frequency).toBe('monthly');
    expect(tasks.find((row) => row.id === fallback.taskId)!.frequency).toBe('yearly');
  });

  it('coerces a frequency the union does not know rather than storing it', async () => {
    const ledger = await freshSession();
    await seedDrafts([draftRow('d1')]);

    const { taskId } = await localTaskDraftsApi.convert(ledger.household.id, 'd1', {
      add_recurring: true,
      frequency: 'every_other_tuesday',
    });
    expect(getLocalHouseLedger().tasks.find((row) => row.id === taskId)!.frequency).toBe('yearly');
  });

  it('refuses to convert a draft that was already processed', async () => {
    const ledger = await freshSession();
    await seedDrafts([draftRow('d1', { status: 'dismissed' })]);

    await expect(localTaskDraftsApi.convert(ledger.household.id, 'd1', {})).rejects.toThrow(
      'Task draft already processed',
    );
    await expect(localTaskDraftsApi.convert(ledger.household.id, 'nope', {})).rejects.toThrow(
      'Task draft not found',
    );
  });

  it('bulk-converts 50 drafts in ONE op and still reports per-draft errors', async () => {
    const ledger = await freshSession();
    const drafts = Array.from({ length: 50 }, (_, index) => draftRow(`d${index}`));
    await seedDrafts([...drafts, draftRow('gone', { status: 'converted' })]);

    const before = opCount();
    const result = await localTaskDraftsApi.bulkConvert(ledger.household.id, {
      draft_ids: [...drafts.map((draft) => draft.id), 'gone', 'missing'],
    });

    // The Worker loops one UPDATE per draft; here 50 drafts are one chunk and
    // therefore one op. Anything else is the quadratic path `localWrite.ts`
    // exists to prevent.
    expect(opCount() - before).toBe(1);
    expect(result.success).toBe(50);
    expect(result.failed).toBe(2);
    expect(result.errors).toEqual([
      'gone: Task draft already processed',
      'missing: Task draft not found',
    ]);

    expect(getLocalHouseLedger().tasks).toHaveLength(50);
    const converted = getLocalHouseLedger().taskDrafts.filter(
      (row) => row.status === 'converted',
    );
    expect(converted).toHaveLength(51);
  });
});

describe('localTaskDraftsApi — dismiss, delete, get', () => {
  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('dismisses with a reason and stays idempotent for an unknown id', async () => {
    const ledger = await freshSession();
    await seedDrafts([draftRow('d1')]);

    await expect(
      localTaskDraftsApi.dismiss(ledger.household.id, 'd1', { reason: 'Already fixed' }),
    ).resolves.toEqual({ success: true });

    const draft = getLocalHouseLedger().taskDrafts.find((row) => row.id === 'd1')!;
    expect(draft.status).toBe('dismissed');
    expect(draft.dismissed_reason).toBe('Already fixed');
    expect(draft.dismissed_at).toEqual(expect.any(String));

    await expect(localTaskDraftsApi.dismiss(ledger.household.id, 'ghost')).resolves.toEqual({
      success: true,
    });
  });

  it('deletes a draft', async () => {
    const ledger = await freshSession();
    await seedDrafts([draftRow('d1'), draftRow('d2')]);

    await expect(localTaskDraftsApi.delete(ledger.household.id, 'd1')).resolves.toEqual({
      success: true,
    });
    expect(getLocalHouseLedger().taskDrafts.map((row) => row.id)).toEqual(['d2']);
  });

  it('returns the draft with its Tier-B relations empty rather than absent', async () => {
    const ledger = await freshSession();
    await seedDrafts([draftRow('d1', { finding_id: 'find_1' })]);

    const draft = await localTaskDraftsApi.get(ledger.household.id, 'd1');
    expect(draft.id).toBe('d1');
    // `findings` and `report_images` are Tier B — the keys exist so the detail
    // screen's optional chaining renders without the evidence panel.
    expect(draft.finding).toBeNull();
    expect(draft.images).toEqual([]);

    await expect(localTaskDraftsApi.get(ledger.household.id, 'ghost')).rejects.toThrow(
      'Task draft not found',
    );
  });
});

describe('localTaskDraftsApi — tier boundaries', () => {
  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('declares no remote-by-design methods — generate is unsupported, not remote', () => {
    expect(HOUSE_LOCAL_TASK_DRAFTS_REMOTE_METHODS).toEqual([]);
  });

  it('throws member-facing copy for generate (H7) instead of omitting the key', async () => {
    await freshSession();
    expect(typeof localTaskDraftsApi.generate).toBe('function');
    await expect(localTaskDraftsApi.generate()).rejects.toBeInstanceOf(HouseLocalUnsupportedError);
    // The copy is per-feature now (H7 DoD: "no raw error strings"), so this
    // asserts the PROPERTY — real product copy, no method identifier — rather
    // than duplicating the sentence. `unsupportedCopy.test.ts` owns the wording.
    const error = await localTaskDraftsApi.generate().catch((e) => e);
    expect(error.message).toBe(getHouseUnsupportedCopy('task-drafts.generate').message);
    expect(error.message).not.toContain('task-drafts.generate');
  });

  it('covers every method on the remote module', () => {
    const remoteMethods = [
      'list',
      'getSummary',
      'generate',
      'get',
      'convert',
      'bulkConvert',
      'dismiss',
      'delete',
    ];
    expect(Object.keys(localTaskDraftsApi).sort()).toEqual([...remoteMethods].sort());
  });
});
