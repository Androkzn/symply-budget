/**
 * Symply Health — "Clear all data" (`healthDataReset.ts`).
 *
 * `HealthMoreScreen.test.tsx` has said since it landed that "`healthDataReset.
 * test.ts` owns the verb itself" — that file never existed until now. This is
 * it, and the reason it matters more than a routine gap: `clearAllHealthData`
 * is the single most destructive action in the app, and one of the things it
 * is supposed to erase is `user_files` — the row that points at a member's
 * uploaded PHOTOS, including `body_photo`.
 *
 * THE HEADLINE RISK THIS FILE PROVES DOES NOT HAPPEN: a member taps "Clear all
 * data", is told their files were deleted (`HEALTH_CLEAR_DELETES` says "Files
 * you uploaded"), and the `user_files` rows the erase pulled from `/sync`
 * never actually reach `healthAssetsApi.deleteFile`. The row in
 * `clearAllHealthData` that is supposed to prevent that is:
 *
 *   deleteEach(liveIds(delta.user_files), (id) => healthAssetsApi.deleteFile(id))
 *
 * `HEALTH-RESET-020` below calls `clearAllHealthData()` against a delta that
 * carries real `user_files` rows and asserts `healthAssetsApi.deleteFile` was
 * called with each one's id — the direct, non-mocked proof that the wiring is
 * real. It IS wired correctly (confirmed by reading the source before writing
 * this suite); this test is what keeps it that way.
 *
 * Two layers:
 *  1. PURE — `planHealthTombstones`, the minimal-tombstone planner.
 *  2. THE VERB — `clearAllHealthData`, mocking every API module it touches so
 *     the suite can prove exactly which requests fire, in response to exactly
 *     which server state, without a live Worker.
 */

import {
  healthApi,
  type HealthPushResponse,
  type HealthSyncDelta,
  type HealthSyncRow,
} from '@api/health';
import { healthAssetsApi } from '@api/healthAssets';
import { healthFoodApi } from '@api/healthFood';
import { healthFridgeApi } from '@api/healthFridge';
import { healthInjuriesApi } from '@api/healthInjuries';

import { HEALTH_CACHE_KEYS } from '../healthCacheKeys';
import {
  clearAllHealthData,
  HEALTH_CLEAR_DELETES,
  HEALTH_CLEAR_DONE_MESSAGE,
  HEALTH_CLEAR_KEPT,
  HEALTH_CLEAR_PARTIAL_MESSAGE,
  HEALTH_CLEAR_UNREACHABLE_MESSAGE,
  HEALTH_TOMBSTONE_SPECS,
  planHealthTombstones,
} from '../healthDataReset';
import { clearHealthCache } from '../healthRepository';
import { syncHealthGlanceFromServer } from '../healthWidgetStorage';

// Each API module is mocked down to just the methods `healthDataReset.ts`
// calls, keeping every OTHER export real — a full `jest.mock('@api/health')`
// automock would also blank `HEALTH_SYNC_PUSH_MAX_ROWS` (a plain number) to
// something automock-generated, which `planHealthTombstones`'s default
// argument relies on.
jest.mock('@api/health', () => {
  const actual = jest.requireActual('@api/health');
  return {
    ...actual,
    healthApi: { ...actual.healthApi, sync: jest.fn(), syncPush: jest.fn(), saveGoal: jest.fn(), saveCycleSettings: jest.fn() },
  };
});
jest.mock('@api/healthAssets', () => {
  const actual = jest.requireActual('@api/healthAssets');
  return { ...actual, healthAssetsApi: { ...actual.healthAssetsApi, deleteFile: jest.fn() } };
});
jest.mock('@api/healthFood', () => {
  const actual = jest.requireActual('@api/healthFood');
  return {
    ...actual,
    healthFoodApi: { ...actual.healthFoodApi, deleteCustomFood: jest.fn(), deleteRecipe: jest.fn() },
  };
});
jest.mock('@api/healthFridge', () => {
  const actual = jest.requireActual('@api/healthFridge');
  return { ...actual, healthFridgeApi: { ...actual.healthFridgeApi, deleteFridgeItem: jest.fn() } };
});
jest.mock('@api/healthInjuries', () => {
  const actual = jest.requireActual('@api/healthInjuries');
  return { ...actual, healthInjuriesApi: { ...actual.healthInjuriesApi, deleteInjury: jest.fn() } };
});
// `healthDataReset.ts` imports only this one function from the module — the
// widget/watch publish step is a seam here, not something this suite re-proves
// (it has its own suite: `areas/widget.glance-publisher.test.ts`).
jest.mock('../healthWidgetStorage', () => ({ syncHealthGlanceFromServer: jest.fn() }));
// The local-cache wipe is a seam too: what matters HERE is WHEN it is called
// relative to the server calls (see HEALTH-RESET-024), not what it does
// internally — that is `healthRepository.test.ts` / the fridge suite's job.
jest.mock('../healthRepository', () => ({ clearHealthCache: jest.fn() }));

const mockSync = healthApi.sync as jest.Mock;
const mockSyncPush = healthApi.syncPush as jest.Mock;
const mockSaveGoal = healthApi.saveGoal as jest.Mock;
const mockSaveCycleSettings = healthApi.saveCycleSettings as jest.Mock;
const mockDeleteFile = healthAssetsApi.deleteFile as jest.Mock;
const mockDeleteCustomFood = healthFoodApi.deleteCustomFood as jest.Mock;
const mockDeleteRecipe = healthFoodApi.deleteRecipe as jest.Mock;
const mockDeleteFridgeItem = healthFridgeApi.deleteFridgeItem as jest.Mock;
const mockDeleteInjury = healthInjuriesApi.deleteInjury as jest.Mock;
const mockClearHealthCache = clearHealthCache as jest.Mock;
const mockSyncGlance = syncHealthGlanceFromServer as jest.Mock;

const ISO = '2026-07-13T08:00:00.000Z';
const NETWORK_ERROR = new Error('Network request failed');

function syncRow(over: Partial<HealthSyncRow> = {}): HealthSyncRow {
  return { id: 'row_1', updated_at: ISO, deleted_at: null, ...over };
}

/** A fully-populated, otherwise-empty delta — every bucket the verb reads. */
function baseDelta(over: Partial<HealthSyncDelta> = {}): HealthSyncDelta {
  return {
    since: '1970-01-01T00:00:00.000Z',
    server_time: ISO,
    weight_entries: [],
    water_entries: [],
    nutrition_entries: [],
    body_measurements: [],
    health_entries: [],
    habits: [],
    habit_logs: [],
    period_entries: [],
    cycle_symptom_entries: [],
    mens_health_entries: [],
    cycle_settings: [],
    health_goals: [],
    mens_health_settings: [],
    widget_preferences: [],
    activity_notification_preferences: [],
    custom_foods: [],
    recipes: [],
    injuries: [],
    fridge_items: [],
    user_files: [],
    ...over,
  };
}

/** A `POST /sync/push` answer where every row the client sent was `applied`. */
function pushResponse(appliedCount: number, over: Partial<HealthPushResponse> = {}): HealthPushResponse {
  return {
    server_time: ISO,
    summary: { applied: appliedCount, unchanged: 0, stale: 0, tombstoned: 0, forbidden: 0, invalid: 0, total: appliedCount },
    results: {},
    unsupported: [],
    ...over,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSync.mockResolvedValue(baseDelta());
  mockSyncPush.mockResolvedValue(pushResponse(0));
  mockSaveGoal.mockResolvedValue({ goal: null });
  mockSaveCycleSettings.mockResolvedValue({ settings: null });
  mockDeleteFile.mockResolvedValue({ deleted: true });
  mockDeleteCustomFood.mockResolvedValue({ deleted: true });
  mockDeleteRecipe.mockResolvedValue({ deleted: true });
  mockDeleteFridgeItem.mockResolvedValue({ deleted: true });
  mockDeleteInjury.mockResolvedValue({ deleted: true });
  mockClearHealthCache.mockResolvedValue(undefined);
  mockSyncGlance.mockResolvedValue(true);
  jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Pure — tombstone planning                                            */
/* ------------------------------------------------------------------ */

describe('planHealthTombstones', () => {
  it('HEALTH-RESET-001: a tombstone carries only the id, the two stamps, and its natural key', () => {
    const delta = baseDelta({ weight_entries: [syncRow({ id: 'w1' })] as never });
    const [batch] = planHealthTombstones(delta, '2026-07-26T00:00:00.000Z');
    expect(batch).toEqual({
      weight_entries: [{ id: 'w1', updated_at: '2026-07-26T00:00:00.000Z', deleted_at: '2026-07-26T00:00:00.000Z' }],
    });
  });

  it('HEALTH-RESET-002: a row already tombstoned (deleted_at set) is skipped — it is already gone', () => {
    const delta = baseDelta({
      weight_entries: [syncRow({ id: 'w1', deleted_at: '2026-01-01T00:00:00.000Z' })] as never,
    });
    expect(planHealthTombstones(delta, ISO)).toEqual([]);
  });

  it('HEALTH-RESET-003: a row with no id is skipped rather than sent malformed', () => {
    const delta = baseDelta({ weight_entries: [{ updated_at: ISO } as unknown as HealthSyncRow] as never });
    expect(planHealthTombstones(delta, ISO)).toEqual([]);
  });

  it('HEALTH-RESET-004: natural-key collections carry their key columns, id-keyed ones do not', () => {
    const delta = baseDelta({
      habit_logs: [{ id: 'hl1', habit_id: 'hab1', date: '2026-07-01', updated_at: ISO, deleted_at: null }] as never,
      period_entries: [syncRow({ id: 'p1', date: '2026-07-02' })] as never,
    });
    const [batch] = planHealthTombstones(delta, ISO);
    expect(batch.habit_logs).toEqual([
      { id: 'hl1', habit_id: 'hab1', date: '2026-07-01', updated_at: ISO, deleted_at: ISO },
    ]);
    expect(batch.period_entries).toEqual([{ id: 'p1', date: '2026-07-02', updated_at: ISO, deleted_at: ISO }]);
  });

  it('HEALTH-RESET-005: cycle_settings and health_goals never appear — they are singletons, not tombstoned', () => {
    const delta = baseDelta({
      cycle_settings: [syncRow({ id: 'cs1' })],
      health_goals: [syncRow({ id: 'g1' })],
    });
    expect(planHealthTombstones(delta, ISO)).toEqual([]);
    expect(HEALTH_TOMBSTONE_SPECS.map((s) => s.collection)).not.toContain('cycle_settings');
    expect(HEALTH_TOMBSTONE_SPECS.map((s) => s.collection)).not.toContain('health_goals');
  });

  it('HEALTH-RESET-006: an empty or missing delta plans nothing', () => {
    expect(planHealthTombstones(baseDelta(), ISO)).toEqual([]);
    expect(planHealthTombstones(null, ISO)).toEqual([]);
    expect(planHealthTombstones(undefined, ISO)).toEqual([]);
  });

  it('HEALTH-RESET-007: a non-array bucket (a drifted or malformed payload) is skipped, not thrown', () => {
    const delta = baseDelta({ weight_entries: 'not-an-array' as never });
    expect(planHealthTombstones(delta, ISO)).toEqual([]);
  });

  it('HEALTH-RESET-008: the row cap is ACROSS collections, and children plan before parents', () => {
    // habit_logs is listed before habits in HEALTH_TOMBSTONE_SPECS — a habit's
    // logs must tombstone in the same or an earlier batch than the habit
    // itself, or a replay could reference a habit id the server has already
    // dropped.
    const delta = baseDelta({
      habit_logs: [
        { id: 'hl1', habit_id: 'h1', date: '2026-07-01', updated_at: ISO, deleted_at: null },
        { id: 'hl2', habit_id: 'h1', date: '2026-07-02', updated_at: ISO, deleted_at: null },
      ] as never,
      habits: [syncRow({ id: 'h1' })] as never,
    });
    const batches = planHealthTombstones(delta, ISO, 2);
    expect(batches).toHaveLength(2);
    expect(batches[0].habit_logs).toHaveLength(2);
    expect(batches[1].habits).toHaveLength(1);
  });

  it('HEALTH-RESET-009: a genuinely non-object row (null, a string, a number) is skipped, not thrown', () => {
    const delta = baseDelta({ weight_entries: [null, 'garbage', 42] as never });
    expect(planHealthTombstones(delta, ISO)).toEqual([]);
  });

  it('HEALTH-RESET-009b: a natural-key column missing from the source row is simply omitted from the tombstone', () => {
    // `date` is a natural key for period_entries. A row that never carries it
    // (a drifted/malformed payload) must not send `date: undefined` — the key
    // is left off entirely rather than sent as a literal undefined.
    const delta = baseDelta({
      period_entries: [{ id: 'p1', updated_at: ISO, deleted_at: null } as never],
    });
    const [batch] = planHealthTombstones(delta, ISO);
    expect(batch.period_entries).toEqual([{ id: 'p1', updated_at: ISO, deleted_at: ISO }]);
    expect('date' in (batch.period_entries?.[0] ?? {})).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* clearAllHealthData — nothing touched when the pull itself fails      */
/* ------------------------------------------------------------------ */

describe('clearAllHealthData — the initial pull fails', () => {
  it('HEALTH-RESET-010: no delete of any kind is attempted, and the copy says nothing was touched', async () => {
    mockSync.mockRejectedValue(NETWORK_ERROR);

    const result = await clearAllHealthData();

    expect(result).toEqual({ status: 'failed', message: HEALTH_CLEAR_UNREACHABLE_MESSAGE, deleted: 0, failed: 0 });
    expect(mockSyncPush).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockDeleteCustomFood).not.toHaveBeenCalled();
    expect(mockDeleteRecipe).not.toHaveBeenCalled();
    expect(mockDeleteFridgeItem).not.toHaveBeenCalled();
    expect(mockDeleteInjury).not.toHaveBeenCalled();
    expect(mockClearHealthCache).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* clearAllHealthData — THE HEADLINE CASE: user_files → deleteFile       */
/* ------------------------------------------------------------------ */

describe('clearAllHealthData — user_files is wired to healthAssetsApi.deleteFile', () => {
  it('HEALTH-RESET-020: every LIVE user_files row is deleted through healthAssetsApi.deleteFile', async () => {
    mockSync.mockResolvedValue(
      baseDelta({
        user_files: [
          syncRow({ id: 'file_body_1' }), // a body_photo, by hypothesis the most sensitive row in the account
          syncRow({ id: 'file_doc_1' }),
        ],
      })
    );

    const result = await clearAllHealthData();

    // The direct proof: BOTH ids the pull returned reached the files DELETE
    // route. This is the one call that stands between "cleared" and a member's
    // photos silently surviving their own erase.
    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    expect(mockDeleteFile).toHaveBeenCalledWith('file_body_1');
    expect(mockDeleteFile).toHaveBeenCalledWith('file_doc_1');
    expect(result.status).toBe('cleared');
    expect(result.deleted).toBeGreaterThanOrEqual(2);
    expect(result.failed).toBe(0);
  });

  it('HEALTH-RESET-021: an already-tombstoned file is NOT re-sent — it is already gone server-side', async () => {
    mockSync.mockResolvedValue(
      baseDelta({
        user_files: [
          syncRow({ id: 'file_live' }),
          syncRow({ id: 'file_already_gone', deleted_at: '2026-01-01T00:00:00.000Z' }),
        ],
      })
    );

    await clearAllHealthData();

    expect(mockDeleteFile).toHaveBeenCalledTimes(1);
    expect(mockDeleteFile).toHaveBeenCalledWith('file_live');
  });

  it('HEALTH-RESET-022: no user_files on the account means no call at all, and the erase still completes', async () => {
    mockSync.mockResolvedValue(baseDelta({ user_files: [] }));

    const result = await clearAllHealthData();

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(result.status).toBe('cleared');
  });

  it('HEALTH-RESET-023: a file whose delete fails is counted as FAILED, not silently dropped or fatal', async () => {
    mockSync.mockResolvedValue(
      baseDelta({ user_files: [syncRow({ id: 'file_ok' }), syncRow({ id: 'file_down' })] })
    );
    mockDeleteFile.mockImplementation((id: string) =>
      id === 'file_down' ? Promise.reject(NETWORK_ERROR) : Promise.resolve({ deleted: true })
    );

    const result = await clearAllHealthData();

    expect(mockDeleteFile).toHaveBeenCalledWith('file_ok');
    expect(mockDeleteFile).toHaveBeenCalledWith('file_down');
    expect(result.status).toBe('partial');
    expect(result.message).toBe(HEALTH_CLEAR_PARTIAL_MESSAGE);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('HEALTH-RESET-024: the SERVER delete happens before the local cache is dropped', async () => {
    // "ORDER MATTERS" per the module header: clearing the local cache before
    // the server has actually deleted the file would let the very next
    // read-through repopulate the list from a server that still holds it — an
    // erase that LOOKS like it worked and then undoes itself.
    const order: string[] = [];
    mockSync.mockResolvedValue(baseDelta({ user_files: [syncRow({ id: 'file_1' })] }));
    mockDeleteFile.mockImplementation(async () => {
      order.push('deleteFile');
      return { deleted: true };
    });
    mockClearHealthCache.mockImplementation(async () => {
      order.push('clearHealthCache');
    });

    await clearAllHealthData();

    expect(order).toEqual(['deleteFile', 'clearHealthCache']);
  });

  it('HEALTH-RESET-025: clearHealthCache is called with the full registered key list', async () => {
    await clearAllHealthData();
    expect(mockClearHealthCache).toHaveBeenCalledWith(HEALTH_CACHE_KEYS);
  });
});

/* ------------------------------------------------------------------ */
/* clearAllHealthData — the other P2 collections, same shape as files   */
/* ------------------------------------------------------------------ */

describe('clearAllHealthData — the sibling per-route deletes', () => {
  it('HEALTH-RESET-026: custom foods, recipes, injuries and fridge items each reach their own delete route', async () => {
    mockSync.mockResolvedValue(
      baseDelta({
        custom_foods: [syncRow({ id: 'food_1' })],
        recipes: [syncRow({ id: 'recipe_1' })],
        injuries: [syncRow({ id: 'injury_1' })],
        fridge_items: [syncRow({ id: 'fridge_1' })],
      })
    );

    await clearAllHealthData();

    expect(mockDeleteCustomFood).toHaveBeenCalledWith('food_1');
    expect(mockDeleteRecipe).toHaveBeenCalledWith('recipe_1');
    expect(mockDeleteInjury).toHaveBeenCalledWith('injury_1');
    expect(mockDeleteFridgeItem).toHaveBeenCalledWith('fridge_1');
  });

  it('HEALTH-RESET-026b: a delta that OMITS a bucket entirely (older Worker) is treated as empty, not thrown', async () => {
    // `baseDelta()` always supplies every bucket as `[]`; this proves the
    // `liveIds` / `clearGoalHistory` guards that handle a MISSING key (rather
    // than an empty array) the same way — a server that has not shipped a
    // bucket yet must not crash the erase.
    mockSync.mockResolvedValue({ server_time: ISO } as unknown as HealthSyncDelta);

    const result = await clearAllHealthData();

    expect(mockDeleteCustomFood).not.toHaveBeenCalled();
    expect(mockDeleteRecipe).not.toHaveBeenCalled();
    expect(mockDeleteInjury).not.toHaveBeenCalled();
    expect(mockDeleteFridgeItem).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockSaveGoal).not.toHaveBeenCalled();
    expect(mockSaveCycleSettings).not.toHaveBeenCalled();
    expect(result.status).toBe('cleared');
  });
});

/* ------------------------------------------------------------------ */
/* clearAllHealthData — tracking rows via the sync PUSH tombstone       */
/* ------------------------------------------------------------------ */

describe('clearAllHealthData — the tombstone push', () => {
  it('HEALTH-RESET-027: applied and unchanged both count as deleted; anything else counts as failed', async () => {
    mockSync.mockResolvedValue(
      baseDelta({ weight_entries: [syncRow({ id: 'w1' }), syncRow({ id: 'w2' })] as never })
    );
    mockSyncPush.mockResolvedValue(pushResponse(1)); // only 1 of the 2 rows applied

    const result = await clearAllHealthData();

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe('partial');
  });

  it('HEALTH-RESET-028: a push that never lands marks every row in it as failed, without throwing', async () => {
    mockSync.mockResolvedValue(baseDelta({ weight_entries: [syncRow({ id: 'w1' })] as never }));
    mockSyncPush.mockRejectedValue(NETWORK_ERROR);

    const result = await clearAllHealthData();

    expect(result.status).toBe('partial');
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('HEALTH-RESET-028b: a malformed response (no summary at all) still counts every row as failed, not thrown', async () => {
    // A 200 with an unexpected/empty body — the `response?.summary?.applied`
    // optional chain is what stands between this and a TypeError.
    mockSync.mockResolvedValue(baseDelta({ weight_entries: [syncRow({ id: 'w1' })] as never }));
    mockSyncPush.mockResolvedValue(undefined as never);

    const result = await clearAllHealthData();

    expect(result.status).toBe('partial');
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* clearAllHealthData — the singletons                                  */
/* ------------------------------------------------------------------ */

describe('clearAllHealthData — goals and cycle settings', () => {
  it('HEALTH-RESET-029: every goal row is patched with the CLEARABLE fields, keyed by its own effective_date', async () => {
    mockSync.mockResolvedValue(
      baseDelta({
        health_goals: [
          { id: 'g1', updated_at: ISO, effective_date: '2026-01-01' },
          { id: 'g2', updated_at: ISO, effective_date: '2026-07-01' },
        ],
      })
    );

    await clearAllHealthData();

    expect(mockSaveGoal).toHaveBeenCalledWith(expect.objectContaining({ effective_date: '2026-01-01', target_weight_kg: null }));
    expect(mockSaveGoal).toHaveBeenCalledWith(expect.objectContaining({ effective_date: '2026-07-01', target_weight_kg: null }));
    // The daily calorie target is NOT NULL server-side and must never be sent as null.
    expect(mockSaveGoal.mock.calls.every(([body]) => !('daily_calories' in body))).toBe(true);
  });

  it('HEALTH-RESET-030: a goal row missing effective_date is skipped rather than sent malformed', async () => {
    mockSync.mockResolvedValue(baseDelta({ health_goals: [{ id: 'g1', updated_at: ISO } as HealthSyncRow] }));
    await clearAllHealthData();
    expect(mockSaveGoal).not.toHaveBeenCalled();
  });

  it('HEALTH-RESET-030b: a goal PATCH that fails is counted as FAILED and flips the verdict to partial', async () => {
    mockSync.mockResolvedValue(
      baseDelta({
        health_goals: [
          { id: 'g1', updated_at: ISO, effective_date: '2026-01-01' },
          { id: 'g2', updated_at: ISO, effective_date: '2026-07-01' },
        ],
      })
    );
    mockSaveGoal.mockImplementation((body: { effective_date: string }) =>
      body.effective_date === '2026-07-01'
        ? Promise.reject(NETWORK_ERROR)
        : Promise.resolve({ goal: null })
    );

    const result = await clearAllHealthData();

    expect(mockSaveGoal).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('partial');
    expect(result.message).toBe(HEALTH_CLEAR_PARTIAL_MESSAGE);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('HEALTH-RESET-031: cycle settings clear only the period history, and only when a settings row exists', async () => {
    mockSync.mockResolvedValue(baseDelta({ cycle_settings: [syncRow({ id: 'cs1' })] }));
    await clearAllHealthData();
    expect(mockSaveCycleSettings).toHaveBeenCalledWith({ last_period_start: null });
  });

  it('HEALTH-RESET-032: no cycle_settings row means the endpoint is never called', async () => {
    mockSync.mockResolvedValue(baseDelta({ cycle_settings: [] }));
    await clearAllHealthData();
    expect(mockSaveCycleSettings).not.toHaveBeenCalled();
  });

  it('HEALTH-RESET-032b: a failed cycle-settings clear is counted as FAILED, not silently ignored', async () => {
    mockSync.mockResolvedValue(baseDelta({ cycle_settings: [syncRow({ id: 'cs1' })] }));
    mockSaveCycleSettings.mockRejectedValue(NETWORK_ERROR);

    const result = await clearAllHealthData();

    expect(mockSaveCycleSettings).toHaveBeenCalledWith({ last_period_start: null });
    expect(result.status).toBe('partial');
    expect(result.message).toBe(HEALTH_CLEAR_PARTIAL_MESSAGE);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* clearAllHealthData — the widget glance refresh                       */
/* ------------------------------------------------------------------ */

describe('clearAllHealthData — the widget/watch glance', () => {
  it('HEALTH-RESET-033: the glance is republished from the server after the erase', async () => {
    await clearAllHealthData();
    expect(mockSyncGlance).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-RESET-034: a failed glance refresh does not change the verdict', async () => {
    mockSyncGlance.mockRejectedValue(NETWORK_ERROR);
    const result = await clearAllHealthData();
    expect(result.status).toBe('cleared');
  });
});

/* ------------------------------------------------------------------ */
/* clearAllHealthData — the overall verdict                             */
/* ------------------------------------------------------------------ */

describe('clearAllHealthData — cleared vs partial', () => {
  it('HEALTH-RESET-035: everything succeeding reports "cleared" with the exact done-message', async () => {
    mockSync.mockResolvedValue(
      baseDelta({ user_files: [syncRow({ id: 'f1' })], weight_entries: [syncRow({ id: 'w1' })] as never })
    );
    mockSyncPush.mockResolvedValue(pushResponse(1));

    const result = await clearAllHealthData();
    expect(result).toEqual({ status: 'cleared', message: HEALTH_CLEAR_DONE_MESSAGE, deleted: 2, failed: 0 });
  });

  it('HEALTH-RESET-036: any single failure anywhere flips the whole verdict to "partial"', async () => {
    mockSync.mockResolvedValue(baseDelta({ user_files: [syncRow({ id: 'f1' })] }));
    mockDeleteFile.mockRejectedValue(NETWORK_ERROR);

    const result = await clearAllHealthData();
    expect(result.status).toBe('partial');
    expect(result.message).toBe(HEALTH_CLEAR_PARTIAL_MESSAGE);
  });
});

/* ------------------------------------------------------------------ */
/* The confirmation copy stays honest                                   */
/* ------------------------------------------------------------------ */

describe('the confirmation copy names what the verb actually does', () => {
  it('HEALTH-RESET-037: the delete list promises files are erased — tying the copy to the behaviour above', () => {
    expect(HEALTH_CLEAR_DELETES).toContain('Files you uploaded');
  });

  it('HEALTH-RESET-038: the kept list promises the account and preferences survive', () => {
    expect(HEALTH_CLEAR_KEPT.some((line) => /account/i.test(line))).toBe(true);
    expect(HEALTH_CLEAR_KEPT.some((line) => /preference|setting/i.test(line))).toBe(true);
  });
});
