/**
 * `healthCoachStorage.ts` — the BODY-INSIGHT HISTORY and the COACH LEDGER.
 *
 * These readers close the longest-standing dead end in the Health port: the
 * producer has persisted a summary through `POST /ai/body-insights/generate`
 * since P3, `GET /health/body-insights`, `/latest` and `/photo` have served them
 * since P2, and `GET /ai/coach/operations` has recorded every commit — with
 * NOTHING on this side asking for any of it. The member-visible effect was a
 * summary that existed only in the response that created it, and no way at all
 * to see what the coach had written on their behalf.
 *
 * `__tests__/healthCoachStorage.test.ts` owns consent, turns, proposals and the
 * generate call. This file owns the readers, and each case is a way a reader can
 * look right and be wrong:
 *
 *  1. **OFFLINE MUST DEGRADE, NEVER THROW.** These surfaces are the "what
 *     happened" screen; a member checking it on a bad connection gets the cached
 *     answer or an empty one, never a crash and never an invented row.
 *  2. **A STORED ROW IS NOT A FRESH ONE.** `analysis_provider` is the only
 *     signal saying whether prose was written by a model or is the deterministic
 *     arithmetic. A reader that defaulted it either way would mislabel the
 *     card — and it is a TEXT column, so anything can be in it.
 *  3. **THE JSON-IN-TEXT COLUMNS.** `strengths` and friends hold JSON in a TEXT
 *     column. A malformed one must become an empty list, never the literal
 *     characters `["…"]` rendered under a heading about the person's body.
 *  4. **NO RAW SERVER STRING, EVER.** `commit_status` and `target_type` are
 *     column values. What the member reads is this module's own words, including
 *     for a value this build has never heard of.
 *
 * THE MODEL IS NEVER CALLED — both API clients are mocked wholesale.
 */

import { healthApi, type HealthBodyInsight } from '@api/health';
import { healthAiApi, type HealthCoachOperation } from '@api/healthAi';
import { storageHelpers } from '@services/storage';

import {
  BODY_INSIGHT_HISTORY_LIMIT,
  COACH_OPERATION_PENDING_LABEL,
  COACH_OPERATIONS_LIMIT,
  coachOperationEntryCount,
  coachOperationStatusLabel,
  coachOperationTargetLabel,
  confirmProposal,
  generateBodyInsight,
  HEALTH_BODY_INSIGHTS_KEY,
  HEALTH_COACH_OPERATIONS_KEY,
  loadBodyInsightHistory,
  loadCoachOperationReceipt,
  loadCoachOperations,
  loadLatestBodyInsight,
  PROPOSAL_TARGET_GONE_MESSAGE,
} from '../../healthCoachStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../../healthRepository';

/**
 * Only the CLIENT is mocked. `parseHealthInsightList` is a pure decoder that
 * lives beside it, and auto-mocking it away would make every "a malformed column
 * degrades to an empty list" case pass for the wrong reason — the reader would
 * be handed `undefined` rather than exercising the decode this file is about.
 */
jest.mock('@api/health', () => {
  const actual = jest.requireActual('@api/health');
  return {
    ...actual,
    healthApi: {
      listBodyInsights: jest.fn(),
      latestBodyInsight: jest.fn(),
      listBodyPhotoInsights: jest.fn(),
    },
  };
});
jest.mock('@api/healthAi');

const api = healthApi as unknown as jest.Mocked<typeof healthApi>;
const aiApi = healthAiApi as unknown as jest.Mocked<typeof healthAiApi>;

const NETWORK_ERROR = new Error('Network request failed');

/** A stored `body_comprehensive_insights` row, as the reader sees it. */
function insightRow(over: Partial<HealthBodyInsight> = {}): HealthBodyInsight {
  return {
    id: 'bci_1',
    date: '2026-07-25',
    strengths: JSON.stringify(['Your waist reads 86.6 cm now, down from 88.']),
    areas_of_improvement: JSON.stringify(['Log your hips twice so it has a trend.']),
    recommended_focus_areas: JSON.stringify(['hips']),
    analysis_provider: 'symply-health-coach',
    created_at: '2026-07-25T10:00:00.000Z',
    ...over,
  } as unknown as HealthBodyInsight;
}

function operation(over: Partial<HealthCoachOperation> = {}): HealthCoachOperation {
  return {
    operation_id: 'hop_1',
    user_id: 'u_1',
    target_type: 'water',
    target_id: 'h2o_1',
    payload_hash: 'a1b2c3d4',
    commit_status: 'committed',
    result_json: JSON.stringify({ ids: ['h2o_1'] }),
    created_at: '2026-07-25T10:00:00.000Z',
    updated_at: '2026-07-25T10:00:00.000Z',
    ...over,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  __setHealthOfflineForTests(false);
  await clearHealthCache([HEALTH_BODY_INSIGHTS_KEY, HEALTH_COACH_OPERATIONS_KEY]);
  api.listBodyInsights.mockResolvedValue({ insights: [] });
  api.latestBodyInsight.mockResolvedValue({ insight: null });
  aiApi.listCoachOperations.mockResolvedValue({ operations: [] });
});

/* ==================================================================== */
/* Body-insight history                                                  */
/* ==================================================================== */

describe('healthCoachStorage — body-insight history', () => {
  it('HEALTH-AI-594: a stored row becomes the card model, parsed out of its TEXT columns', async () => {
    api.listBodyInsights.mockResolvedValue({ insights: [insightRow()] });

    const [entry] = await loadBodyInsightHistory();

    expect(entry).toEqual({
      id: 'bci_1',
      date: '2026-07-25',
      observations: ['Your waist reads 86.6 cm now, down from 88.'],
      whatToLogNext: ['Log your hips twice so it has a trend.'],
      singleReadingSites: ['hips'],
      aiWritten: true,
      createdAt: '2026-07-25T10:00:00.000Z',
    });
  });

  it('HEALTH-AI-595: the history read is BOUNDED by default and honours an explicit limit', async () => {
    await loadBodyInsightHistory();
    expect(api.listBodyInsights).toHaveBeenLastCalledWith({ limit: BODY_INSIGHT_HISTORY_LIMIT });

    await loadBodyInsightHistory(5);
    expect(api.listBodyInsights).toHaveBeenLastCalledWith({ limit: 5 });
  });

  it('HEALTH-AI-596: a deterministic row is labelled as such, and so is an UNKNOWN provider', async () => {
    // `analysis_provider` is a TEXT column. Only the producer's own AI tag counts
    // as "a model wrote this" — defaulting anything else to true would put an
    // AI label on the person's own arithmetic, which is the one claim this card
    // must never make by accident.
    api.listBodyInsights.mockResolvedValue({
      insights: [
        insightRow({ id: 'a', date: '2026-07-25', analysis_provider: 'deterministic' }),
        insightRow({ id: 'b', date: '2026-07-24', analysis_provider: 'some-future-writer' }),
        insightRow({ id: 'c', date: '2026-07-23', analysis_provider: null }),
      ] as unknown as HealthBodyInsight[],
    });

    expect((await loadBodyInsightHistory()).map((e) => e.aiWritten)).toEqual([false, false, false]);
  });

  it('HEALTH-AI-597: a MALFORMED JSON column degrades to an empty list, never to raw characters', async () => {
    // Rendering `["Your waist` under a heading about someone's body is worse
    // than rendering nothing, and the column is TEXT so it can hold anything.
    api.listBodyInsights.mockResolvedValue({
      insights: [
        insightRow({
          strengths: '{not json',
          areas_of_improvement: '"a bare string"',
          recommended_focus_areas: null,
        }),
      ] as unknown as HealthBodyInsight[],
    });

    const [entry] = await loadBodyInsightHistory();
    expect(entry.observations).toEqual([]);
    expect(entry.whatToLogNext).toEqual([]);
    expect(entry.singleReadingSites).toEqual([]);
  });

  it('HEALTH-AI-598: a row missing its id and date reads as empty strings, not "undefined"', async () => {
    // The card prints `Summary of ${date}`. An absent column must not become the
    // word "undefined" beside the person's measurements.
    api.listBodyInsights.mockResolvedValue({
      insights: [{ strengths: '[]', areas_of_improvement: '[]' }] as unknown as HealthBodyInsight[],
    });

    const [entry] = await loadBodyInsightHistory();
    expect(entry.id).toBe('');
    expect(entry.date).toBe('');
    expect(entry.createdAt).toBe('');
    expect(JSON.stringify(entry)).not.toMatch(/undefined|null/);
  });

  it('HEALTH-AI-599: OFFLINE with no cache is an EMPTY history, never a throw', async () => {
    __setHealthOfflineForTests(true);
    await expect(loadBodyInsightHistory()).resolves.toEqual([]);
  });

  it('HEALTH-AI-600: a cached history is read back offline', async () => {
    api.listBodyInsights.mockResolvedValue({ insights: [insightRow()] });
    await loadBodyInsightHistory();

    __setHealthOfflineForTests(true);
    const cached = await loadBodyInsightHistory();
    expect(cached).toHaveLength(1);
    expect(cached[0].observations).toEqual(['Your waist reads 86.6 cm now, down from 88.']);
  });
});

/* ==================================================================== */
/* Latest                                                                */
/* ==================================================================== */

describe('healthCoachStorage — latest body insight', () => {
  it('HEALTH-AI-601: the newest summary comes from /latest, not from pulling the whole history', async () => {
    api.latestBodyInsight.mockResolvedValue({ insight: insightRow({ id: 'newest' }) });

    const latest = await loadLatestBodyInsight();

    expect(latest?.id).toBe('newest');
    expect(api.latestBodyInsight).toHaveBeenCalledTimes(1);
    expect(api.listBodyInsights).not.toHaveBeenCalled();
  });

  it('HEALTH-AI-602: no stored summary at all is NULL, not an empty card', async () => {
    api.latestBodyInsight.mockResolvedValue({ insight: null });
    expect(await loadLatestBodyInsight()).toBeNull();
  });

  it('HEALTH-AI-603: a failed /latest falls back to the HEAD of the cached list', async () => {
    // The cache holds the raw rows precisely so this fallback needs no second
    // key — and the head is the newest, because the Worker orders that way.
    await storageHelpers.setObject(HEALTH_BODY_INSIGHTS_KEY, [
      insightRow({ id: 'cached_newest', date: '2026-07-25' }),
      insightRow({ id: 'cached_older', date: '2026-07-20' }),
    ]);
    api.latestBodyInsight.mockRejectedValue(NETWORK_ERROR);

    const latest = await loadLatestBodyInsight();
    expect(latest?.id).toBe('cached_newest');
  });

  it('HEALTH-AI-604: a failed /latest with NO cache is null rather than a throw', async () => {
    api.latestBodyInsight.mockRejectedValue(NETWORK_ERROR);
    await expect(loadLatestBodyInsight()).resolves.toBeNull();
  });

  it('HEALTH-AI-605: a CORRUPT cache falls back to null instead of indexing junk', async () => {
    await storageHelpers.setObject(HEALTH_BODY_INSIGHTS_KEY, { not: 'an array' });
    api.latestBodyInsight.mockRejectedValue(NETWORK_ERROR);
    await expect(loadLatestBodyInsight()).resolves.toBeNull();
  });
});

/* ==================================================================== */
/* Generate refreshes the history                                        */
/* ==================================================================== */

describe('healthCoachStorage — generate refreshes the stored history', () => {
  const facts = {
    window_from: '2026-06-01',
    window_to: '2026-07-01',
    dates_logged: 2,
    sites_logged: 1,
    changes: [],
    single_reading_sites: [],
    mixed_units: false,
  };

  it('HEALTH-AI-606: a successful generate re-reads the history so the list agrees at once', async () => {
    // Without this the card and the "Earlier summaries" list disagree until the
    // next open, and an immediately-offline read shows a summary that is not
    // there.
    aiApi.generateBodyInsight.mockResolvedValue({
      insight: { strengths: '["A"]', areas_of_improvement: '[]' },
      facts,
      ai_status: 'ok',
      dropped_ungrounded: 0,
    });
    api.listBodyInsights.mockResolvedValue({ insights: [insightRow()] });

    const result = await generateBodyInsight('2026-07-25');

    expect(result.outcome).toBe('generated');
    expect(api.listBodyInsights).toHaveBeenCalledWith({ limit: BODY_INSIGHT_HISTORY_LIMIT });
    expect(await storageHelpers.getObject(HEALTH_BODY_INSIGHTS_KEY)).toHaveLength(1);
  });

  it('HEALTH-AI-607: a FAILED history refresh does not fail the generate that succeeded', async () => {
    // The summary was made. Surfacing a stale-list error over it would report a
    // failure the member did not experience.
    aiApi.generateBodyInsight.mockResolvedValue({
      insight: { strengths: '["A"]', areas_of_improvement: '[]' },
      facts,
      ai_status: 'ok',
      dropped_ungrounded: 0,
    });
    api.listBodyInsights.mockRejectedValue(NETWORK_ERROR);

    const result = await generateBodyInsight('2026-07-25');
    expect(result.outcome).toBe('generated');
    expect(result.message).toBeNull();
    expect(result.insight?.observations).toEqual(['A']);
  });

  it('HEALTH-AI-608: a REFUSED generate never touches the stored history', async () => {
    aiApi.generateBodyInsight.mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { status: 422 } })
    );

    const result = await generateBodyInsight('2026-07-25');
    expect(result.outcome).toBe('needs_data');
    expect(api.listBodyInsights).not.toHaveBeenCalled();
  });
});

/* ==================================================================== */
/* Coach ledger                                                          */
/* ==================================================================== */

describe('healthCoachStorage — coach ledger', () => {
  it('HEALTH-AI-609: the ledger is read bounded, cached, and readable offline', async () => {
    aiApi.listCoachOperations.mockResolvedValue({ operations: [operation()] });

    expect(await loadCoachOperations()).toHaveLength(1);
    expect(aiApi.listCoachOperations).toHaveBeenLastCalledWith(COACH_OPERATIONS_LIMIT);

    __setHealthOfflineForTests(true);
    expect(await loadCoachOperations()).toHaveLength(1);
  });

  it('HEALTH-AI-610: OFFLINE with no cache is an empty ledger, never a throw', async () => {
    __setHealthOfflineForTests(true);
    await expect(loadCoachOperations()).resolves.toEqual([]);
  });

  it('HEALTH-AI-611: a receipt is fetched FRESH and is never cached under a per-id key', async () => {
    // A per-id key cannot be enumerated by the sign-out clear in
    // `healthCacheKeys.ts`, and a Health key that survives sign-out is the exact
    // cross-user leak that file exists to prevent.
    aiApi.getCoachOperation.mockResolvedValue({ operation: operation() });

    const receipt = await loadCoachOperationReceipt('hop_1');

    expect(receipt?.operation_id).toBe('hop_1');
    expect(aiApi.getCoachOperation).toHaveBeenCalledWith('hop_1');
    const keys = await storageHelpers.getAllKeys();
    expect(keys.filter((k) => k.includes('hop_1'))).toEqual([]);
  });

  it('HEALTH-AI-612: a missing id, someone else\'s id and a dead network are ONE answer', async () => {
    // The Worker answers 404 for the first two on purpose — distinguishing them
    // would confirm an id exists on another account — so the caller may not
    // distinguish them either.
    for (const failure of [
      Object.assign(new Error('nope'), { response: { status: 404 } }),
      NETWORK_ERROR,
    ]) {
      aiApi.getCoachOperation.mockRejectedValueOnce(failure);
      await expect(loadCoachOperationReceipt('hop_x')).resolves.toBeNull();
    }
  });
});

/* ==================================================================== */
/* Confirming keeps the ledger current                                   */
/* ==================================================================== */

describe('healthCoachStorage — confirming refreshes the ledger', () => {
  const proposal = {
    operation_id: 'hop_1',
    operation_type: 'create' as const,
    target_type: 'habit' as const,
    original_text: 'I meditated',
    normalized_payload: {
      kind: 'habit' as const,
      habit_id: 'habit_med',
      habit_name: 'Meditate',
    },
    payload_hash: 'a1b2c3d4',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    commit_status: 'proposed' as const,
  };

  it('HEALTH-AI-645: a successful commit re-reads the receipts so the list is current at once', async () => {
    // Without this the member confirms something, looks straight down at "what
    // the coach has logged", and sees it missing until the next open — which
    // reads as the write having failed.
    aiApi.commitProposal.mockResolvedValue({
      status: 'committed',
      target_type: 'habit',
      target_id: 'habit_med',
    });
    aiApi.listCoachOperations.mockResolvedValue({
      operations: [operation({ target_type: 'habit', target_id: 'habit_med' })],
    });

    const result = await confirmProposal('a1', proposal);

    expect(result.outcome).toBe('saved');
    expect(aiApi.listCoachOperations).toHaveBeenCalledWith(COACH_OPERATIONS_LIMIT);
    expect(await storageHelpers.getObject(HEALTH_COACH_OPERATIONS_KEY)).toHaveLength(1);
  });

  it('HEALTH-AI-646: a FAILED ledger refresh does not turn a successful save into a failure', async () => {
    // The row was written. Reporting an error because a follow-up read failed
    // would send the member to re-confirm something already saved.
    aiApi.commitProposal.mockResolvedValue({
      status: 'committed',
      target_type: 'habit',
      target_id: 'habit_med',
    });
    aiApi.listCoachOperations.mockRejectedValue(NETWORK_ERROR);

    const result = await confirmProposal('a1', proposal);
    expect(result.outcome).toBe('saved');
    expect(result.message).toBeNull();
  });

  it('HEALTH-AI-647: a 409 target_unavailable is its OWN outcome, not "the numbers changed"', async () => {
    // The third 409. Nothing about the figures moved — the habit did — so
    // "those numbers changed since the coach suggested them" would be false and
    // would send the member looking for a change that is not there. The copy
    // deliberately does not say WHICH of the three checks failed, because the
    // Worker answers the same way for all of them so that a refusal cannot be
    // used to discover whether an id exists on another account.
    aiApi.commitProposal.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        response: { status: 409, data: { error: { code: 'target_unavailable' } } },
      })
    );

    const result = await confirmProposal('a1', proposal);

    expect(result.outcome).toBe('target_gone');
    expect(result.message).toBe(PROPOSAL_TARGET_GONE_MESSAGE);
    expect(result.message).toMatch(/no longer one of your habits/);
    expect(result.message).not.toMatch(/not yours|another account|404|409/i);
    // The card is cleared: asking again is the next step, not retrying this one.
    expect(result.state.messages.find((m) => m.id === 'a1')?.proposal ?? null).toBeNull();
    // And nothing was written, so the ledger was NOT re-read.
    expect(aiApi.listCoachOperations).not.toHaveBeenCalled();
  });
});

/* ==================================================================== */
/* Ledger labels — the app owns every word                               */
/* ==================================================================== */

describe('healthCoachStorage — ledger labels', () => {
  it('HEALTH-AI-613: every shipped target type has member-facing words', () => {
    // All six verbs the coach can propose. A missing case would print the raw
    // column, which is a repo-wide rule violation and reads as a leak.
    expect(coachOperationTargetLabel('water')).toBe('Water');
    expect(coachOperationTargetLabel('weight')).toBe('Weight');
    expect(coachOperationTargetLabel('nutrition')).toBe('Food diary');
    expect(coachOperationTargetLabel('workout')).toBe('Workout');
    expect(coachOperationTargetLabel('period')).toBe('Period day');
    expect(coachOperationTargetLabel('habit')).toBe('Habit');
  });

  it('HEALTH-AI-614: a target type this build has never heard of is named plainly, not printed', () => {
    // A newer Worker, or a row from a later version. "Something else" is honest;
    // `sleep_session` on a member's screen is a database column.
    expect(coachOperationTargetLabel('sleep_session')).toBe('Something else');
    expect(coachOperationTargetLabel('')).toBe('Something else');
  });

  it('HEALTH-AI-615: a PENDING receipt says what actually happened, not "failed"', () => {
    // The ledger is claimed BEFORE the diary write, so pending means "you
    // confirmed this and it did not finish" — which is the sentence that
    // explains a missing entry.
    expect(coachOperationStatusLabel(operation({ commit_status: 'committed' }))).toBe('Saved');
    expect(coachOperationStatusLabel(operation({ commit_status: 'pending' }))).toBe(
      COACH_OPERATION_PENDING_LABEL
    );
    expect(COACH_OPERATION_PENDING_LABEL).toMatch(/nothing was saved/);
    // Anything else is admitted as unknown rather than guessed at.
    expect(coachOperationStatusLabel(operation({ commit_status: 'exploded' }))).toBe('Unknown');
  });

  it('HEALTH-AI-616: the entry count reads result_json, and refuses to guess', () => {
    // A meal is several diary rows from ONE confirmation, so the count is worth
    // showing — and a pending or malformed row must read 0 rather than 1.
    expect(coachOperationEntryCount(operation())).toBe(1);
    expect(
      coachOperationEntryCount(operation({ result_json: JSON.stringify({ ids: ['a', 'b', 'c'] }) }))
    ).toBe(3);
    expect(coachOperationEntryCount(operation({ result_json: null }))).toBe(0);
    expect(coachOperationEntryCount(operation({ result_json: '{not json' }))).toBe(0);
    expect(coachOperationEntryCount(operation({ result_json: JSON.stringify({}) }))).toBe(0);
    expect(
      coachOperationEntryCount(operation({ result_json: JSON.stringify({ ids: 'h2o_1' }) }))
    ).toBe(0);
    // A blank id is not an entry — `writeDomain` returns `''` when a meal wrote
    // nothing, and counting it would claim a row that does not exist.
    expect(
      coachOperationEntryCount(operation({ result_json: JSON.stringify({ ids: ['', 'a', 7] }) }))
    ).toBe(1);
  });
});
