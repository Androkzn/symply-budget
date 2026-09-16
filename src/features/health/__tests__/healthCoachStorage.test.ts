/**
 * Symply Health — AI COACH store (parity phase P3).
 *
 * THE MODEL IS NEVER CALLED. `@api/healthAi` is mocked wholesale, so every case
 * here — including the timeout and the refusal — is deterministic.
 *
 * Four properties are worth the file, and each is a way this feature could look
 * fine and be wrong:
 *
 *  1. **FAIL CLOSED, VISIBLY.** A turn with `reply: null` must become a bubble
 *     carrying the server's plain-words NOTICE — never an empty bubble, and
 *     never invented text. An empty assistant bubble reads as "the coach had
 *     nothing to say", which is a different fact from "the coach could not be
 *     reached".
 *  2. **A PROPOSAL IS CONFIRMED UNTOUCHED.** The numbers the person accepts have
 *     to be the numbers the coach hashed. If any screen or store re-rounds,
 *     re-orders or rebuilds the payload, the Worker 409s — and the version of
 *     that bug that reaches production is the one where the store "helpfully"
 *     normalises a float.
 *  3. **CONSENT IS DENY-BY-DEFAULT ON EVERY PATH**, including offline, including
 *     a failed grant. A cached `granted: true` that the server never issued
 *     shows an unlocked coach that 403s on the very next turn.
 *  4. **THE MESSAGE THE PERSON TYPED SURVIVES A FAILURE.** A screen that
 *     swallows what someone wrote because the network dropped is worse than one
 *     that shows it unanswered.
 */

import { healthAiApi, type HealthCoachProposal, type HealthCoachTurn } from '@api/healthAi';
import { storageHelpers } from '@services/storage';

import {
  appendTurn,
  BODY_INSIGHT_NEEDS_DATA_MESSAGE,
  clearCoachTranscript,
  COACH_CONSENT_MESSAGE,
  COACH_LOCKED_MESSAGE,
  COACH_OFFLINE_MESSAGE,
  confirmProposal,
  dismissProposal,
  generateBodyInsight,
  HEALTH_COACH_CONSENT_KEY,
  HEALTH_COACH_KEY,
  HISTORY_TURNS_SENT,
  loadCoachConsent,
  loadCoachState,
  PROPOSAL_CHANGED_MESSAGE,
  PROPOSAL_EXPIRED_MESSAGE,
  proposalHasExpired,
  sendCoachMessage,
  setCoachConsent,
  type CoachState,
} from '../healthCoachStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../healthRepository';

jest.mock('@api/healthAi');

type MockedAiApi = jest.Mocked<typeof healthAiApi>;
const api = healthAiApi as unknown as MockedAiApi;

/** The Worker answers with the bare object — no `{ data }` envelope. */
function body<T>(payload: T): T {
  return payload;
}

const NETWORK_ERROR = new Error('Network request failed');

/** A refusal carrying a status and the Worker's own error CODE. */
function httpError(status: number, code?: string) {
  return Object.assign(new Error('Request failed'), {
    response: { status, data: code ? { error: { code, message: 'server wording' } } : undefined },
  });
}

// Fixed local noon: `todayDateKey()` === '2026-07-25' in every timezone.
const FIXED_NOW = new Date(2026, 6, 25, 12, 0, 0);

function proposal(over: Partial<HealthCoachProposal> = {}): HealthCoachProposal {
  return {
    operation_id: over.operation_id ?? 'hop_1',
    operation_type: 'create',
    target_type: over.target_type ?? 'water',
    original_text: over.original_text ?? 'I drank a big glass',
    normalized_payload: over.normalized_payload ?? { kind: 'water', amount_ml: 500 },
    payload_hash: over.payload_hash ?? 'a1b2c3d4',
    expires_at: over.expires_at ?? new Date(FIXED_NOW.getTime() + 10 * 60 * 1000).toISOString(),
    commit_status: 'proposed',
  };
}

function turn(over: Partial<HealthCoachTurn> = {}): HealthCoachTurn {
  return {
    kind: over.kind ?? 'reply',
    reply: over.reply === undefined ? 'You have not logged anything yet today.' : over.reply,
    proposal: over.proposal ?? null,
    escalation: over.escalation ?? null,
    insights: over.insights ?? [],
    ai_status: over.ai_status ?? 'ok',
    notice: over.notice ?? null,
    model: over.model ?? 'mock',
  };
}

const EMPTY: CoachState = { messages: [], insights: [], aiStatus: 'idle' };

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick'] });
  __setHealthOfflineForTests(false);
  await clearHealthCache([HEALTH_COACH_KEY, HEALTH_COACH_CONSENT_KEY]);
  api.getCoachConsent.mockResolvedValue(
    body({
      consent: {
        granted: false,
        version: null,
        granted_at: null,
        revoked_at: null,
        required_version: 'health-coach-1',
      },
    })
  );
});

afterEach(() => {
  jest.useRealTimers();
});

/* ==================================================================== */
/* Consent                                                               */
/* ==================================================================== */

describe('healthCoachStorage — consent', () => {
  it('HEALTH-AI-210: an account that never answered reads granted:false', async () => {
    expect((await loadCoachConsent()).granted).toBe(false);
  });

  it('HEALTH-AI-211: OFFLINE with no cache falls back to DENIED, never to granted', async () => {
    __setHealthOfflineForTests(true);
    expect((await loadCoachConsent()).granted).toBe(false);
  });

  it('HEALTH-AI-212: a granted consent is cached and read back', async () => {
    const granted = {
      granted: true,
      version: 'health-coach-1',
      granted_at: '2026-07-25T12:00:00.000Z',
      revoked_at: null,
      required_version: 'health-coach-1',
    };
    api.setCoachConsent.mockResolvedValue(body({ consent: granted }));
    api.getCoachConsent.mockResolvedValue(body({ consent: granted }));

    expect((await setCoachConsent(true)).granted).toBe(true);
    expect(await storageHelpers.getObject(HEALTH_COACH_CONSENT_KEY)).toMatchObject({
      granted: true,
    });
  });

  it('HEALTH-AI-213: a FAILED grant stays denied — a cached true the server never issued is a lie', async () => {
    api.setCoachConsent.mockRejectedValue(NETWORK_ERROR);
    api.getCoachConsent.mockRejectedValue(NETWORK_ERROR);

    const consent = await setCoachConsent(true);
    expect(consent.granted).toBe(false);
    expect(await storageHelpers.getObject(HEALTH_COACH_CONSENT_KEY)).toMatchObject({
      granted: false,
    });
  });
});

/* ==================================================================== */
/* Turns                                                                 */
/* ==================================================================== */

describe('healthCoachStorage — turns', () => {
  it('HEALTH-AI-220: a good turn appends both sides and mirrors ai_status', async () => {
    api.coachTurn.mockResolvedValue(body({ turn: turn({ reply: 'You logged nothing yet.' }) }));

    const result = await sendCoachMessage('how am I doing');
    expect(result.status).toBe('answered');
    expect(result.state.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.state.messages[1].text).toBe('You logged nothing yet.');
    expect(result.state.aiStatus).toBe('ok');
  });

  it('HEALTH-AI-221: only the message and history go up — never a health figure', async () => {
    api.coachTurn.mockResolvedValue(body({ turn: turn() }));
    await sendCoachMessage('how am I doing');

    const sent = api.coachTurn.mock.calls[0][0];
    expect(Object.keys(sent).sort()).toEqual(['history', 'message', 'today']);
    expect(sent.today).toBe('2026-07-25');
  });

  it(`HEALTH-AI-222: history is capped at ${HISTORY_TURNS_SENT} turns`, async () => {
    api.coachTurn.mockResolvedValue(body({ turn: turn() }));
    // Build a long transcript by replaying turns through the store.
    for (let i = 0; i < 8; i++) await sendCoachMessage(`message ${i}`);

    const lastCall = api.coachTurn.mock.calls[api.coachTurn.mock.calls.length - 1][0];
    expect(lastCall.history).toHaveLength(HISTORY_TURNS_SENT);
  });

  it('HEALTH-AI-223: a NULL reply becomes the notice, never an empty bubble', async () => {
    api.coachTurn.mockResolvedValue(
      body({
        turn: turn({
          kind: 'unavailable',
          reply: null,
          ai_status: 'unavailable',
          notice: 'The coach could not be reached just now.',
        }),
      })
    );

    const result = await sendCoachMessage('how am I doing');
    const assistant = result.state.messages[1];
    expect(assistant.text).toBe('The coach could not be reached just now.');
    expect(assistant.text.trim().length).toBeGreaterThan(0);
  });

  it('HEALTH-AI-224: a null reply with NO notice still says something plain', async () => {
    // Belt and braces: a Worker that answered `reply: null, notice: null` must
    // not produce a blank bubble either.
    const state = appendTurn(EMPTY, turn({ reply: null, notice: null, kind: 'unavailable' }));
    expect(state.messages[0].text).toBe(COACH_OFFLINE_MESSAGE);
  });

  it('HEALTH-AI-225: an OFFLINE turn keeps what the person typed, unanswered', async () => {
    api.coachTurn.mockRejectedValue(NETWORK_ERROR);

    const result = await sendCoachMessage('how am I doing');
    expect(result.status).toBe('offline');
    expect(result.message).toBe(COACH_OFFLINE_MESSAGE);
    expect(result.state.messages).toHaveLength(1);
    expect(result.state.messages[0]).toMatchObject({ role: 'user', text: 'how am I doing' });
    // And it is persisted, so a remount does not lose it.
    expect((await loadCoachState()).messages).toHaveLength(1);
  });

  it('HEALTH-AI-226: the two 403s are told apart by CODE, not by message', async () => {
    // Both are "forbidden"; one is fixable here and now, the other is an account
    // state. Same status, different copy and a different next step.
    api.coachTurn.mockRejectedValue(httpError(403, 'coach_consent_required'));
    let result = await sendCoachMessage('hello');
    expect(result.status).toBe('consent_required');
    expect(result.message).toBe(COACH_CONSENT_MESSAGE);

    api.coachTurn.mockRejectedValue(httpError(403, 'ai_access_required'));
    result = await sendCoachMessage('hello');
    expect(result.status).toBe('locked');
    expect(result.message).toBe(COACH_LOCKED_MESSAGE);
  });

  it('HEALTH-AI-227: no server wording ever reaches the member', async () => {
    api.coachTurn.mockRejectedValue(httpError(500, 'internal'));
    const result = await sendCoachMessage('hello');
    expect(result.message).not.toContain('server wording');
    expect(result.message).not.toMatch(/Error|undefined|null|500/);
  });

  it('HEALTH-AI-228: an ESCALATION turn drops the insight cards', async () => {
    // A calorie card under an emergency notice is the wrong screen.
    const withInsights: CoachState = {
      messages: [],
      insights: [
        {
          id: 'calories',
          priority: 1,
          kind: 'calories',
          title: 'Calories today',
          facts: [{ label: 'Logged', value: 1850, unit: 'kcal' }],
          caveats: [],
          data_window: { start: 'a', end: 'b' },
          speakable: 'You logged 1850 kcal.',
        },
      ],
      aiStatus: 'ok',
    };
    const state = appendTurn(
      withInsights,
      turn({
        kind: 'escalation',
        reply: 'Chest pain can be serious.',
        ai_status: 'skipped',
        escalation: {
          category: 'chest_pain',
          message: 'Chest pain can be serious.',
          claims_help_contacted: false,
          collect_location: false,
        },
      })
    );
    expect(state.insights).toEqual([]);
    expect(state.messages[0].escalation).toBe(true);
  });

  it('HEALTH-AI-229: an empty message sends nothing', async () => {
    const result = await sendCoachMessage('   ');
    expect(api.coachTurn).not.toHaveBeenCalled();
    expect(result.state.messages).toEqual([]);
  });

  it('HEALTH-AI-230: clearing wipes the transcript on this device', async () => {
    api.coachTurn.mockResolvedValue(body({ turn: turn() }));
    await sendCoachMessage('hello');
    expect((await loadCoachState()).messages).toHaveLength(2);

    await clearCoachTranscript();
    expect((await loadCoachState()).messages).toEqual([]);
  });

  it('HEALTH-AI-231: a corrupt cached transcript degrades to empty, never crashes', async () => {
    await storageHelpers.setObject(HEALTH_COACH_KEY, { messages: 'not an array' });
    expect((await loadCoachState()).messages).toEqual([]);
  });
});

/* ==================================================================== */
/* Proposals                                                             */
/* ==================================================================== */

describe('healthCoachStorage — proposals', () => {
  async function transcriptWithProposal(p = proposal()) {
    api.coachTurn.mockResolvedValue(
      body({ turn: turn({ kind: 'proposal', reply: 'Ready to confirm.', proposal: p }) })
    );
    const result = await sendCoachMessage('I drank a big glass');
    return { state: result.state, messageId: result.state.messages[1].id };
  }

  it('HEALTH-AI-240: the proposal is passed through UNTOUCHED', async () => {
    // The whole guarantee: the numbers accepted are the numbers hashed. A store
    // that re-rounded a float here would 409 every commit in production and
    // never in a happy-path test.
    const p = proposal({
      normalized_payload: {
        kind: 'nutrition',
        meal_type: 'lunch',
        items: [
          { food_name: 'Chicken', grams: 150.5, calories: 248, protein_g: 46, carbs_g: null, fat_g: null },
        ],
      },
    });
    const { messageId } = await transcriptWithProposal(p);
    api.commitProposal.mockResolvedValue(
      body({ status: 'committed', target_type: 'nutrition', target_id: 'n_1' })
    );

    await confirmProposal(messageId, p);
    const sent = api.commitProposal.mock.calls[0][0];
    expect(sent.proposal).toBe(p);
    expect(sent.proposal.payload_hash).toBe(p.payload_hash);
    expect(sent.today).toBe('2026-07-25');
  });

  it('HEALTH-AI-241: a confirmed proposal is cleared off the bubble', async () => {
    const { messageId } = await transcriptWithProposal();
    api.commitProposal.mockResolvedValue(
      body({ status: 'committed', target_type: 'water', target_id: 'h2o_1' })
    );

    const result = await confirmProposal(messageId, proposal());
    expect(result.outcome).toBe('saved');
    expect(result.state.messages.find((m) => m.id === messageId)?.proposal).toBeNull();
  });

  it('HEALTH-AI-242: a replay reports already_saved rather than a second save', async () => {
    const { messageId } = await transcriptWithProposal();
    api.commitProposal.mockResolvedValue(
      body({ status: 'idempotent_replay', target_type: 'water', target_id: 'h2o_1' })
    );

    expect((await confirmProposal(messageId, proposal())).outcome).toBe('already_saved');
  });

  it('HEALTH-AI-243: an EXPIRED proposal is refused on the device, with no request', async () => {
    const stale = proposal({ expires_at: '2020-01-01T00:00:00.000Z' });
    const { messageId } = await transcriptWithProposal(stale);

    const result = await confirmProposal(messageId, stale);
    expect(result.outcome).toBe('expired');
    expect(result.message).toBe(PROPOSAL_EXPIRED_MESSAGE);
    expect(api.commitProposal).not.toHaveBeenCalled();
  });

  it('HEALTH-AI-244: a 409 hash mismatch reads as CHANGED, not as expired', async () => {
    const { messageId } = await transcriptWithProposal();
    api.commitProposal.mockRejectedValue(httpError(409, 'payload_hash_mismatch'));

    const result = await confirmProposal(messageId, proposal());
    expect(result.outcome).toBe('changed');
    expect(result.message).toBe(PROPOSAL_CHANGED_MESSAGE);
  });

  it('HEALTH-AI-294: a 409 the SERVER calls expired reads as expired, not as changed', async () => {
    // Both 409s clear the card, but the next step differs: "ask again" for an
    // expired window, "those numbers moved" for a hash mismatch. The two are
    // told apart by the Worker's CODE, never by its message.
    const { messageId } = await transcriptWithProposal();
    api.commitProposal.mockRejectedValue(httpError(409, 'proposal_expired'));

    const result = await confirmProposal(messageId, proposal());
    expect(result.outcome).toBe('expired');
    expect(result.message).toBe(PROPOSAL_EXPIRED_MESSAGE);
    expect(result.state.messages.find((m) => m.id === messageId)?.proposal).toBeNull();
  });

  it('HEALTH-AI-295: a 409 with a non-string code falls to the safer "changed" reading', async () => {
    // The code is read defensively because it arrives from the wire. A payload
    // whose `code` is not a string must not be compared as if it were — the
    // fallback says the numbers moved, which is the reading that asks the
    // member to look again rather than the one that says "just retry".
    const { messageId } = await transcriptWithProposal();
    api.commitProposal.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        response: { status: 409, data: { error: { code: 1409 } } },
      })
    );

    const result = await confirmProposal(messageId, proposal());
    expect(result.outcome).toBe('changed');
    expect(result.message).toBe(PROPOSAL_CHANGED_MESSAGE);
    expect(result.message).not.toMatch(/1409|Error|undefined/);
  });

  it('HEALTH-AI-245: a transient failure KEEPS the card so it can be retried', async () => {
    // The ledger makes a duplicate impossible, so retrying is safe and dropping
    // the card would strand the suggestion.
    const { messageId } = await transcriptWithProposal();
    api.commitProposal.mockRejectedValue(NETWORK_ERROR);

    const result = await confirmProposal(messageId, proposal());
    expect(result.outcome).toBe('failed');
    expect(result.state.messages.find((m) => m.id === messageId)?.proposal).not.toBeNull();
  });

  it('HEALTH-AI-246: dismissing writes nothing and clears the card', async () => {
    const { messageId } = await transcriptWithProposal();
    const state = await dismissProposal(messageId);
    expect(api.commitProposal).not.toHaveBeenCalled();
    expect(state.messages.find((m) => m.id === messageId)?.proposal).toBeNull();
  });

  it('HEALTH-AI-247: proposalHasExpired reads the stamp, not the clock it was built on', () => {
    expect(proposalHasExpired(proposal())).toBe(false);
    expect(proposalHasExpired(proposal({ expires_at: '2020-01-01T00:00:00.000Z' }))).toBe(true);
    expect(proposalHasExpired(proposal({ expires_at: 'not a date' }))).toBe(true);
  });
});

/* ==================================================================== */
/* Body insight                                                          */
/* ==================================================================== */

describe('healthCoachStorage — body insight', () => {
  const facts = {
    window_from: '2026-06-01',
    window_to: '2026-07-01',
    dates_logged: 2,
    sites_logged: 2,
    changes: [
      {
        site: 'waist',
        first: 88,
        latest: 86.6,
        delta: -1.4,
        unit: 'cm',
        from_date: '2026-06-01',
        to_date: '2026-07-01',
        readings: 2,
      },
    ],
    single_reading_sites: [],
    mixed_units: false,
  };

  it('HEALTH-AI-250: JSON-array columns are parsed into lists', async () => {
    api.generateBodyInsight.mockResolvedValue(
      body({
        insight: {
          strengths: JSON.stringify(['Your waist moved from 88 to 86.6 cm.']),
          areas_of_improvement: JSON.stringify(['Log your hips too.']),
        },
        facts,
        ai_status: 'ok' as const,
        dropped_ungrounded: 0,
      })
    );

    const result = await generateBodyInsight('2026-07-25');
    expect(result.outcome).toBe('generated');
    expect(result.insight?.observations).toEqual(['Your waist moved from 88 to 86.6 cm.']);
    expect(result.insight?.whatToLogNext).toEqual(['Log your hips too.']);
    expect(result.insight?.facts.changes[0].delta).toBe(-1.4);
  });

  it('HEALTH-AI-251: a corrupt column degrades to an empty list, not a crash', async () => {
    api.generateBodyInsight.mockResolvedValue(
      body({
        insight: { strengths: '{not json', areas_of_improvement: null },
        facts,
        ai_status: 'unavailable' as const,
        dropped_ungrounded: 3,
      })
    );
    const result = await generateBodyInsight('2026-07-25');
    expect(result.insight?.observations).toEqual([]);
    expect(result.insight?.droppedUngrounded).toBe(3);
  });

  it('HEALTH-AI-296: a column already sent as an ARRAY is used as-is, minus non-strings', async () => {
    // `strengths` is a TEXT column holding JSON, but the route is free to hand
    // back the decoded array. Both shapes have to land on the same list, and a
    // stray non-string inside it must not render as "null" on the card.
    api.generateBodyInsight.mockResolvedValue(
      body({
        insight: {
          strengths: ['Your waist moved from 88 to 86.6 cm.', 42, null],
          // A JSON scalar rather than a JSON array — parsed fine, but not a list.
          areas_of_improvement: '"Log your hips too."',
        },
        facts,
        ai_status: 'ok' as const,
        dropped_ungrounded: 0,
      })
    );

    const result = await generateBodyInsight('2026-07-25');
    expect(result.insight?.observations).toEqual(['Your waist moved from 88 to 86.6 cm.']);
    expect(result.insight?.whatToLogNext).toEqual([]);
  });

  it('HEALTH-AI-297: an answer carrying no insight row still reports its FACTS', async () => {
    // The prose is the model's; the facts are the member's own readings. An
    // answer with no prose is still worth showing, so the card falls back to
    // empty lists rather than throwing on a missing row.
    api.generateBodyInsight.mockResolvedValue(
      body({
        insight: undefined as unknown as Record<string, unknown>,
        facts,
        ai_status: 'unavailable' as const,
        dropped_ungrounded: 2,
      })
    );

    const result = await generateBodyInsight();

    expect(result.outcome).toBe('generated');
    expect(result.insight?.observations).toEqual([]);
    expect(result.insight?.whatToLogNext).toEqual([]);
    expect(result.insight?.facts.changes[0].delta).toBe(-1.4);
    expect(result.insight?.aiStatus).toBe('unavailable');
    // Called with no date at all, it asks about the device's OWN local day.
    expect(api.generateBodyInsight).toHaveBeenCalledWith('2026-07-25');
  });

  it('HEALTH-AI-252: no measurements is its own outcome with an actionable message', async () => {
    api.generateBodyInsight.mockRejectedValue(httpError(422, 'no_measurements'));
    const result = await generateBodyInsight('2026-07-25');
    expect(result.outcome).toBe('needs_data');
    expect(result.message).toBe(BODY_INSIGHT_NEEDS_DATA_MESSAGE);
    expect(result.insight).toBeNull();
  });

  it('HEALTH-AI-253: a 403 points at the consent card, not at a generic failure', async () => {
    api.generateBodyInsight.mockRejectedValue(httpError(403, 'coach_consent_required'));
    const result = await generateBodyInsight('2026-07-25');
    expect(result.outcome).toBe('consent_required');
    expect(result.message).toBe(COACH_CONSENT_MESSAGE);
  });

  it('HEALTH-AI-254: any other failure is plain words with no server string', async () => {
    api.generateBodyInsight.mockRejectedValue(httpError(500, 'internal'));
    const result = await generateBodyInsight('2026-07-25');
    expect(result.outcome).toBe('failed');
    expect(result.message).not.toContain('server wording');
    expect(result.message).not.toMatch(/Error|undefined|500/);
  });
});
