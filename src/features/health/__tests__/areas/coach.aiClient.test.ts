/**
 * `src/api/healthAi.ts` — the AI COACH / SCANNER / BODY-INSIGHT wire layer.
 *
 * WHY THIS FILE EXISTS. Every other part of this area was already at 100%
 * (`healthCoachStorage.ts`, `HealthCoachScreen.tsx`, `HealthScanScreen.tsx`),
 * and the client that carries all of it was at **15.78% statements / 0%
 * branches**: the storage suite mocks `@api/healthAi` wholesale, so the module
 * that decides the URL, the envelope and the timeout was never executed by
 * anything. That is the wrong module to leave unexecuted, because three of its
 * decisions are invisible at runtime and expensive to get wrong:
 *
 *  1. **THE ENVELOPE.** The Worker answers BARE (`c.json({ turn })`), so every
 *     method here must return `r.data` — the axios body — and not reach through
 *     a second `{ data }` wrapper. `src/api/__tests__/healthEnvelope.test.ts`
 *     pins that at SOURCE level (no `api.*` helper imports); this file pins it
 *     BEHAVIOURALLY, which is the half that catches a hand-written
 *     `.then((r) => r.data.data)`.
 *  2. **`confirmed_payload_hash` IS DERIVED, NEVER SUPPLIED.** The commit
 *     contract only means something if the hash the client echoes is the hash
 *     carried on the proposal the person was shown. This module takes no hash
 *     argument at all, and that is the enforcement — a caller physically cannot
 *     confirm a hash that does not belong to the proposal it is sending.
 *  3. **THE TIMEOUT.** A vision call routinely outruns the 30 s axios default,
 *     and a 30 s cutoff surfaces to the member as a failed scan on a photo the
 *     model was still reading. Every model-bearing call must carry
 *     `AI_TIMEOUT_MS`; the pure-CRUD ones deliberately do not.
 *
 * NO MODEL, NO NETWORK. `./client` is mocked, so nothing here leaves the
 * process.
 */

jest.mock('@api/client', () => ({
  apiClient: {
    get: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
  },
}));

import { apiClient } from '@api/client';
import {
  AI_TIMEOUT_MS,
  healthAiApi,
  type HealthCoachProposal,
} from '@api/healthAi';
import healthAiDefault from '@api/healthAi';

const mockGet = apiClient.get as jest.Mock;
const mockPut = apiClient.put as jest.Mock;
const mockPost = apiClient.post as jest.Mock;

const BASE = '/health/ai';

/** The Worker's bare body, as axios hands it back. */
function body<T>(payload: T) {
  return { data: payload };
}

function proposal(over: Partial<HealthCoachProposal> = {}): HealthCoachProposal {
  return {
    operation_id: 'hop_1',
    operation_type: 'create',
    target_type: 'water',
    original_text: 'I drank a big glass',
    normalized_payload: { kind: 'water', amount_ml: 500 },
    payload_hash: 'a1b2c3d4',
    expires_at: '2026-07-25T12:15:00.000Z',
    commit_status: 'proposed',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

/* ==================================================================== */
/* Consent                                                               */
/* ==================================================================== */

describe('healthAiApi — coach consent', () => {
  it('HEALTH-AI-531: reading consent GETs the coach path and returns the BARE body', async () => {
    const consent = {
      granted: false,
      version: null,
      granted_at: null,
      revoked_at: null,
      required_version: 'health-coach-2',
    };
    mockGet.mockResolvedValueOnce(body({ consent }));

    const result = await healthAiApi.getCoachConsent();

    expect(mockGet).toHaveBeenCalledWith(`${BASE}/coach/consent`);
    // `{ consent }`, not `{ data: { consent } }` — the Worker does not wrap, and
    // a client that unwrapped twice would resolve `undefined` against the live
    // server while every fixture-backed test still passed.
    expect(result).toEqual({ consent });
  });

  it('HEALTH-AI-532: setting consent PUTs the boolean, in BOTH directions', async () => {
    mockPut.mockResolvedValue(body({ consent: { granted: true } }));

    await healthAiApi.setCoachConsent(true);
    expect(mockPut).toHaveBeenLastCalledWith(`${BASE}/coach/consent`, { granted: true });

    // The REVOKE direction exists on the wire even though no screen offers it —
    // see `coach.posture.test.ts`. If it is ever wired up, this is the contract
    // it is wired against.
    await healthAiApi.setCoachConsent(false);
    expect(mockPut).toHaveBeenLastCalledWith(`${BASE}/coach/consent`, { granted: false });
  });

  it('HEALTH-AI-533: neither consent call carries the vision timeout', async () => {
    // A 2-minute ceiling on a one-row read would leave a member staring at a
    // spinner for two minutes when the Worker is unreachable. The long timeout
    // is for calls that actually wait on a model.
    mockGet.mockResolvedValueOnce(body({ consent: {} }));
    mockPut.mockResolvedValueOnce(body({ consent: {} }));

    await healthAiApi.getCoachConsent();
    await healthAiApi.setCoachConsent(true);

    expect(mockGet.mock.calls[0]).toHaveLength(1);
    expect(mockPut.mock.calls[0][2]).toBeUndefined();
  });
});

/* ==================================================================== */
/* Turn                                                                  */
/* ==================================================================== */

describe('healthAiApi — coach turn', () => {
  it('HEALTH-AI-534: a turn POSTs the payload verbatim with the 2-minute ceiling', async () => {
    const turn = { kind: 'reply', reply: 'ok' };
    mockPost.mockResolvedValueOnce(body({ turn }));

    const payload = {
      message: 'how am I doing',
      today: '2026-07-25',
      history: [{ role: 'user' as const, text: 'earlier' }],
    };
    const result = await healthAiApi.coachTurn(payload);

    expect(mockPost).toHaveBeenCalledWith(`${BASE}/coach/turn`, payload, {
      timeout: AI_TIMEOUT_MS,
    });
    expect(AI_TIMEOUT_MS).toBe(120000);
    expect(result).toEqual({ turn });
  });

  it('HEALTH-AI-535: nothing is added to the turn payload on the way out', async () => {
    // The Worker reads the member's own rows itself. A client that helpfully
    // attached a figure here would be sending health data the consent text does
    // not describe.
    mockPost.mockResolvedValueOnce(body({ turn: {} }));

    await healthAiApi.coachTurn({ message: 'hi', today: '2026-07-25' });

    expect(Object.keys(mockPost.mock.calls[0][1] as object).sort()).toEqual([
      'message',
      'today',
    ]);
  });
});

/* ==================================================================== */
/* Commit                                                                */
/* ==================================================================== */

describe('healthAiApi — commit', () => {
  it('HEALTH-AI-536: the confirmed hash is DERIVED from the proposal, never passed in', async () => {
    // The whole guarantee of the confirm card. `commitProposal` takes no hash
    // argument, so a caller cannot echo a hash that belongs to a different
    // payload — and the proposal object itself goes up untouched.
    const p = proposal({ payload_hash: 'deadbeef' });
    mockPost.mockResolvedValueOnce(
      body({ status: 'committed', target_type: 'water', target_id: 'h2o_1' })
    );

    const result = await healthAiApi.commitProposal({ proposal: p, today: '2026-07-25' });

    expect(mockPost).toHaveBeenCalledWith(`${BASE}/coach/commit`, {
      proposal: p,
      confirmed_payload_hash: 'deadbeef',
      today: '2026-07-25',
    });
    // Identity, not equality: a rebuilt payload hashes differently and 409s.
    expect((mockPost.mock.calls[0][1] as { proposal: unknown }).proposal).toBe(p);
    expect(result.status).toBe('committed');
  });

  it('HEALTH-AI-537: the commit call carries NO extended timeout — the model is done', async () => {
    // Commit writes a row the person already read. It is an ordinary write, and
    // giving it a two-minute ceiling would hide a dead Worker behind a spinner.
    mockPost.mockResolvedValueOnce(body({ status: 'committed' }));

    await healthAiApi.commitProposal({ proposal: proposal(), today: '2026-07-25' });

    expect(mockPost.mock.calls[0][2]).toBeUndefined();
  });

  it('HEALTH-AI-538: a replayed commit surfaces its status rather than being swallowed', async () => {
    mockPost.mockResolvedValueOnce(
      body({ status: 'idempotent_replay', target_type: 'water', target_id: 'h2o_1' })
    );

    const result = await healthAiApi.commitProposal({ proposal: proposal(), today: '2026-07-25' });

    // The store turns this into "That was already saved." — saying "Saved."
    // would imply a second glass of water landed in the diary.
    expect(result.status).toBe('idempotent_replay');
    expect(result.target_id).toBe('h2o_1');
  });
});

/* ==================================================================== */
/* Ledger                                                                */
/* ==================================================================== */

describe('healthAiApi — ledger', () => {
  it('HEALTH-AI-539: a limit is sent as a param and an omitted one sends none', async () => {
    mockGet.mockResolvedValue(body({ operations: [] }));

    await healthAiApi.listCoachOperations(5);
    expect(mockGet).toHaveBeenLastCalledWith(`${BASE}/coach/operations`, {
      params: { limit: 5 },
    });

    await healthAiApi.listCoachOperations();
    expect(mockGet).toHaveBeenLastCalledWith(`${BASE}/coach/operations`, {
      params: undefined,
    });
  });

  it('HEALTH-AI-548b: one receipt is fetched by id, with the id ESCAPED into the path', async () => {
    // The id goes into the URL rather than a query, so anything the Worker
    // considers path-significant has to be encoded — an unescaped `/` would
    // silently address a different route and 404 with no clue why.
    mockGet.mockResolvedValue(body({ operation: { operation_id: 'hop_1' } }));

    const result = await healthAiApi.getCoachOperation('hop_1');
    expect(mockGet).toHaveBeenLastCalledWith(`${BASE}/coach/operations/hop_1`);
    expect(result.operation.operation_id).toBe('hop_1');

    await healthAiApi.getCoachOperation('hop/../x y');
    expect(mockGet).toHaveBeenLastCalledWith(
      `${BASE}/coach/operations/${encodeURIComponent('hop/../x y')}`
    );
  });

  it('HEALTH-AI-540: a limit of ZERO sends no param rather than ?limit=0', async () => {
    // `limit ? … : undefined` is a truthiness test, so 0 falls to the Worker's
    // own default of 20. Asserting it pins which of the two readings ships:
    // `?limit=0` would clamp to 1 on the Worker and return a single receipt,
    // which is not what "no limit" means to a caller.
    mockGet.mockResolvedValueOnce(body({ operations: [] }));

    await healthAiApi.listCoachOperations(0);

    expect(mockGet).toHaveBeenLastCalledWith(`${BASE}/coach/operations`, {
      params: undefined,
    });
  });
});

/* ==================================================================== */
/* Scanners                                                              */
/* ==================================================================== */

describe('healthAiApi — scanners', () => {
  const images = [{ data: 'AAAA', media_type: 'image/jpeg' }];

  it('HEALTH-AI-541: the label scanner POSTs the frames with the vision timeout', async () => {
    const draft = { product_name: 'Oat milk', per_100_source: 'label' };
    mockPost.mockResolvedValueOnce(body({ draft }));

    const result = await healthAiApi.scanNutritionLabel(images);

    expect(mockPost).toHaveBeenCalledWith(
      `${BASE}/nutrition-label`,
      { images },
      { timeout: AI_TIMEOUT_MS }
    );
    expect(result).toEqual({ draft });
  });

  it('HEALTH-AI-542: the meal scanner uses its OWN route, not the label one', async () => {
    // Two prompts, two shapes. A client that pointed both at one path would
    // return a label draft to a meal review card and render nothing.
    const draft = { foods: [], total_calories: null };
    mockPost.mockResolvedValueOnce(body({ draft }));

    const result = await healthAiApi.analyzeMealPhoto(images);

    expect(mockPost).toHaveBeenCalledWith(
      `${BASE}/meal-photo`,
      { images },
      { timeout: AI_TIMEOUT_MS }
    );
    expect(result).toEqual({ draft });
  });

  it('HEALTH-AI-543: a frame with NO declared media type is sent as-is — the bytes decide', async () => {
    // `media_type` is advisory: the Worker sniffs the real signature, because a
    // .png that is really a JPEG is a 400 from the provider otherwise. The
    // client must therefore not invent one.
    mockPost.mockResolvedValueOnce(body({ draft: {} }));

    await healthAiApi.scanNutritionLabel([{ data: 'AAAA' }]);

    expect(mockPost.mock.calls[0][1]).toEqual({ images: [{ data: 'AAAA' }] });
  });

  it('HEALTH-AI-544: a multi-frame batch keeps its ORDER', async () => {
    // Both frames are read as ONE product, and a two-shot label reads front then
    // back. Reordering them changes what the model is looking at.
    mockPost.mockResolvedValueOnce(body({ draft: {} }));
    const batch = [{ data: 'FRONT' }, { data: 'BACK' }];

    await healthAiApi.analyzeMealPhoto(batch);

    expect((mockPost.mock.calls[0][1] as { images: unknown[] }).images).toEqual(batch);
  });
});

/* ==================================================================== */
/* Body insight                                                          */
/* ==================================================================== */

describe('healthAiApi — body insight', () => {
  it('HEALTH-AI-545: generating POSTs the LOCAL day with the vision timeout', async () => {
    const payload = {
      insight: { strengths: '[]' },
      facts: { changes: [] },
      ai_status: 'ok',
      dropped_ungrounded: 0,
    };
    mockPost.mockResolvedValueOnce(body(payload));

    const result = await healthAiApi.generateBodyInsight('2026-07-25');

    expect(mockPost).toHaveBeenCalledWith(
      `${BASE}/body-insights/generate`,
      { date: '2026-07-25' },
      { timeout: AI_TIMEOUT_MS }
    );
    expect(result).toEqual(payload);
  });
});

/* ==================================================================== */
/* Module shape                                                          */
/* ==================================================================== */

describe('healthAiApi — module shape', () => {
  it('HEALTH-AI-546: the default export is the same object as the named one', async () => {
    // Both are imported across the app; two different objects would mean a
    // `jest.mock` on one leaving the other live.
    expect(healthAiDefault).toBe(healthAiApi);
  });

  it('HEALTH-AI-547: every method sits under /health/ai and nothing reaches another Worker path', async () => {
    // The base path is what `requireHealthApi()` 404s on every non-Health
    // Worker. A method that slipped outside it would answer 200 on House.
    mockGet.mockResolvedValue(body({}));
    mockPut.mockResolvedValue(body({}));
    mockPost.mockResolvedValue(body({}));

    await healthAiApi.getCoachConsent();
    await healthAiApi.setCoachConsent(true);
    await healthAiApi.coachTurn({ message: 'hi', today: '2026-07-25' });
    await healthAiApi.commitProposal({ proposal: proposal(), today: '2026-07-25' });
    await healthAiApi.listCoachOperations();
    await healthAiApi.getCoachOperation('hop_1');
    await healthAiApi.scanNutritionLabel([{ data: 'A' }]);
    await healthAiApi.analyzeMealPhoto([{ data: 'A' }]);
    await healthAiApi.generateBodyInsight('2026-07-25');

    const paths = [...mockGet.mock.calls, ...mockPut.mock.calls, ...mockPost.mock.calls].map(
      (call) => call[0] as string
    );
    // Every exported method was driven — a new one added without a case here
    // fails this count rather than shipping unexercised.
    expect(paths).toHaveLength(Object.keys(healthAiApi).length);
    const outside = paths.filter((p) => !p.startsWith('/health/ai/'));
    expect(outside).toEqual([]);
  });
});
