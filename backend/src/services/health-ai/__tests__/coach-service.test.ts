/**
 * HEALTH-AI — the coach SERVICE (`coach-service.ts`), driven directly against a
 * live miniflare D1 with a scripted provider.
 *
 * `routes/__tests__/health-ai.test.ts` owns the HTTP contract; this file owns
 * the parts of the service the router short-circuits past or never varies:
 *
 *   - the CONSENT state machine, including the transitions the route never
 *     exercises in one request (revoke → re-grant, revoke before ever granting,
 *     and a receipt left behind by an OLD disclosure version);
 *   - `buildContext` on a day with figures on it, not just the empty account the
 *     route suite uses — the coach must be handed what the person actually
 *     logged, and nothing that came from the request body;
 *   - `runTurn`'s own escalation gate, which the router returns before ever
 *     calling (so it is only reachable here, and a service caller that forgets
 *     the router's check must still be safe);
 *   - `writeDomain` for WEIGHT and for a meal with missing macros.
 *
 * THE MODEL IS ALWAYS A LOCAL FAKE. There is no `@anthropic-ai/sdk` anywhere in
 * this file, so nothing here can reach a real provider.
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AIProvider, GenerateArgs, GenerateResult } from '../../../ai/provider';
import {
  createHealthAiTables,
  createHealthTables,
  resetHealthAiTables,
  resetHealthTables,
  seedHealthUsers,
} from '../../../routes/__tests__/health-test-helpers';
import type { Env } from '../../../types';
import { HealthService } from '../../health-service';
import { buildProposal } from '../coach-proposals';
import { COACH_CONSENT_VERSION, HealthCoachService } from '../coach-service';

const testEnv = env as unknown as Env;
const UID = 'u_coachsvc_alice';
const TODAY = '2026-07-25';
const NOW = new Date('2026-07-25T10:00:00.000Z');

/** A provider that answers from a script and records what it was asked. */
function fakeProvider(script: Array<GenerateResult | Error>): AIProvider & {
  calls: GenerateArgs[];
} {
  const calls: GenerateArgs[] = [];
  return {
    calls,
    name: 'fake',
    isAvailable: () => true,
    generate: async (args: GenerateArgs): Promise<GenerateResult> => {
      calls.push(args);
      const next = script.shift();
      if (next instanceof Error) throw next;
      return next ?? { content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', model: 'fake-model' };
    },
    generateStructured: async <T,>(): Promise<T> => ({}) as T,
  } as unknown as AIProvider & { calls: GenerateArgs[] };
}

function service(): HealthCoachService {
  return new HealthCoachService(testEnv.DB);
}

beforeEach(async () => {
  await createHealthTables(testEnv.DB);
  await createHealthAiTables(testEnv.DB);
  await resetHealthAiTables(testEnv.DB);
  await resetHealthTables(testEnv.DB);
  await seedHealthUsers(testEnv.DB, [UID]);
});

/* ================================ CONSENT ================================ */

describe('Symply Health coach service — consent', () => {
  it('HEALTH-AI-420: re-granting after a revoke clears revoked_at and re-stamps the grant', async () => {
    const svc = service();
    await svc.setConsent(UID, true);
    const revoked = await svc.setConsent(UID, false);
    expect(revoked.granted).toBe(false);
    expect(revoked.revoked_at).toBeTruthy();

    const again = await svc.setConsent(UID, true);
    expect(again.granted).toBe(true);
    // A live grant that still carried a revocation stamp would read as
    // "withdrawn" to anything auditing the receipt.
    expect(again.revoked_at).toBeNull();
    expect(again.granted_at).toBeTruthy();

    // Still ONE receipt — the unique index is on (user, scope).
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM health_coach_consent_receipts WHERE user_id = ?'
    )
      .bind(UID)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('HEALTH-AI-421: revoking BEFORE ever granting records the refusal without inventing a grant', async () => {
    const state = await service().setConsent(UID, false);
    expect(state.granted).toBe(false);
    expect(state.revoked_at).toBeTruthy();
    // Never granted, so there is no moment to claim it was.
    expect(state.granted_at).toBeNull();
  });

  it('HEALTH-AI-422: a receipt against an OLD disclosure version does not count as consent', async () => {
    // A consent is only meaningful against the words it was given for.
    await testEnv.DB.prepare(
      `INSERT INTO health_coach_consent_receipts
         (id, user_id, scope, granted, version, granted_at, revoked_at, created_at, updated_at, deleted_at)
       VALUES ('hcc_old', ?, 'insights', 1, 'health-coach-0', ?, NULL, ?, ?, NULL)`
    )
      .bind(UID, NOW.toISOString(), NOW.toISOString(), NOW.toISOString())
      .run();

    const state = await service().getConsent(UID);
    expect(state.granted).toBe(false);
    expect(state.version).toBe('health-coach-0');
    // …and the app is told which words it must ask against now.
    expect(state.required_version).toBe(COACH_CONSENT_VERSION);
  });

  it('HEALTH-AI-423: a REVOKED receipt of the current version is still not consent', async () => {
    const svc = service();
    await svc.setConsent(UID, true);
    await svc.setConsent(UID, false);
    const state = await svc.getConsent(UID);
    expect(state.granted).toBe(false);
    expect(state.version).toBe(COACH_CONSENT_VERSION);
  });
});

/* ================================ CONTEXT ================================ */

describe('Symply Health coach service — context', () => {
  async function seedDay() {
    const svc = new HealthService(testEnv.DB);
    await svc.saveGoal(UID, TODAY, { daily_calories: 2100, daily_protein_grams: 140, daily_water_ml: 2500 });
    await svc.createNutrition(UID, {
      date: TODAY,
      food_name: 'Oats',
      meal_type: 'breakfast',
      calories: 300.4,
      proteins: 10.2,
    });
    await svc.createWater(UID, { date: TODAY, amount_ml: 750 });
    await svc.createWeight(UID, { date: '2026-07-24', weight: 82.4, unit: 'kg' });
  }

  it('HEALTH-AI-424: a day with figures on it reports them, not null', async () => {
    await seedDay();
    const ctx = await service().buildContext(UID, TODAY);
    expect(ctx).toMatchObject({
      today: TODAY,
      calories: 300.4,
      calorie_goal: 2100,
      protein_g: 10.2,
      protein_goal_g: 140,
      water_ml: 750,
      water_goal_ml: 2500,
      meals_logged: 1,
    });
    expect(ctx.latest_weight).toEqual({ value: 82.4, unit: 'kg', date: '2026-07-24' });
  });

  it('HEALTH-AI-425: the prompt block carries the SERVER-read figures, rounded for reading', async () => {
    await seedDay();
    const provider = fakeProvider([
      { content: [{ type: 'text', text: 'Noted.' }], stopReason: 'end_turn', model: 'fake-model' },
    ]);
    await service().runTurn(
      { userId: UID, message: 'how am I doing', today: TODAY },
      provider,
      { model: 'fake-model', now: NOW }
    );
    const prompt = provider.calls[0].systemPrompt ?? '';
    expect(prompt).toContain('300 kcal');
    expect(prompt).toContain('2100 kcal');
    expect(prompt).toContain('750 ml');
    expect(prompt).toContain('82.4 kg on 2026-07-24');
    expect(prompt).toContain('Diary entries today');
  });

  it('HEALTH-AI-426: an EMPTY day reports nulls rather than zeroes', async () => {
    // Zero calories is a claim the person did not make; null is "nothing logged".
    const ctx = await service().buildContext(UID, TODAY);
    expect(ctx.calories).toBeNull();
    expect(ctx.protein_g).toBeNull();
    expect(ctx.water_ml).toBeNull();
    expect(ctx.latest_weight).toBeNull();
    expect(ctx.meals_logged).toBe(0);
  });
});

/* ================================= TURN ================================== */

describe('Symply Health coach service — runTurn', () => {
  it('HEALTH-AI-427: the escalation gate is inside the SERVICE, not only the router', async () => {
    // The router returns before calling `runTurn`, so this arm is reachable only
    // from a service caller — and a future caller that forgets the router's
    // check must still never reach a model with "I have chest pain".
    const provider = fakeProvider([]);
    const turn = await service().runTurn(
      { userId: UID, message: 'I have chest pain and I feel dizzy', today: TODAY },
      provider,
      { model: 'fake-model', now: NOW }
    );
    expect(turn.kind).toBe('escalation');
    expect(turn.ai_status).toBe('skipped');
    expect(turn.escalation?.category).toBe('chest_pain');
    expect(turn.escalation?.claims_help_contacted).toBe(false);
    // Not one token spent, and no health row even read.
    expect(provider.calls).toHaveLength(0);
    expect(turn.insights).toEqual([]);
  });

  it('HEALTH-AI-428: a tool turn that ALSO carries text keeps the text as the reply', async () => {
    // The model routinely says "let me note that down" alongside the tool call.
    // Dropping it leaves a confirm card with no sentence above it.
    const provider = fakeProvider([
      {
        content: [
          { type: 'text', text: 'I will note 500 ml for you.' },
          { type: 'tool_use', id: 'tu1', name: 'prepare_log_water', input: { amount_ml: 500 } },
        ],
        stopReason: 'tool_use',
        model: 'fake-model-1',
      },
      { content: [{ type: 'text', text: 'Ready when you are.' }], stopReason: 'end_turn', model: 'fake-model' },
    ]);

    const turn = await service().runTurn(
      { userId: UID, message: 'I drank a big glass', today: TODAY },
      provider,
      { model: 'fake-model', now: NOW, newId: () => 'hop_fixed' }
    );
    expect(turn.kind).toBe('proposal');
    expect(turn.reply).toBe('Ready when you are.');
    expect(turn.proposal?.normalized_payload).toEqual({ kind: 'water', amount_ml: 500 });
    // The second call must carry the assistant turn AND the tool result.
    expect(provider.calls).toHaveLength(2);
    const followUp = provider.calls[1].messages;
    expect(JSON.stringify(followUp)).toContain('I will note 500 ml for you.');
    expect(JSON.stringify(followUp)).toContain('tool_result');
  });

  it('HEALTH-AI-429: the model reported is the one that ANSWERED, not the one requested', async () => {
    // A provider resolves an alias to a dated id, so the requested name and the
    // answering name differ. The turn has to report what answered — that is the
    // only version of the two a reader can act on.
    const provider = fakeProvider([
      {
        content: [
          { type: 'tool_use', id: 'tu1', name: 'prepare_log_water', input: { amount_ml: 300 } },
        ],
        stopReason: 'tool_use',
        model: 'fake-model-20260101',
      },
      {
        content: [{ type: 'text', text: 'Done.' }],
        stopReason: 'end_turn',
        model: 'fake-model-20260101',
      },
    ]);
    const turn = await service().runTurn(
      { userId: UID, message: 'I drank 300ml', today: TODAY },
      provider,
      { model: 'fake-model-alias', now: NOW }
    );
    expect(turn.model).toBe('fake-model-20260101');
    // …and the alias is what was SENT, on every turn of the loop.
    expect(provider.calls.map((c) => c.model)).toEqual(['fake-model-alias', 'fake-model-alias']);
  });

  it('HEALTH-AI-430: called with no options at all it still refuses to invent a reply', async () => {
    // The default `opts` exists so a caller cannot accidentally get an
    // un-modelled turn; with no provider it is still the fail-closed shape.
    const turn = await service().runTurn(
      { userId: UID, message: 'how am I doing', today: TODAY },
      null
    );
    expect(turn.kind).toBe('unavailable');
    expect(turn.reply).toBeNull();
    expect(turn.notice).toMatch(/could not be reached/i);
    expect(turn.model).toBeNull();
  });
});

/* ================================ COMMIT ================================= */

describe('Symply Health coach service — writeDomain', () => {
  async function commit(toolName: string, input: unknown) {
    const proposal = buildProposal({
      toolName,
      input,
      originalText: 'test',
      now: NOW,
      newId: () => `hop_${toolName}_${Math.random().toString(16).slice(2)}`,
    })!;
    return service().commit({
      userId: UID,
      proposal,
      confirmedHash: proposal.payload_hash,
      today: TODAY,
      now: NOW,
    });
  }

  it('HEALTH-AI-431: a WEIGHT proposal writes one reading in the unit the person used', async () => {
    const out = await commit('prepare_log_weight', { weight: 82.4, unit: 'lb' });
    expect(out).toMatchObject({ ok: true, status: 'committed', target_type: 'weight' });

    const row = await testEnv.DB.prepare(
      'SELECT user_id, weight, unit, date, source FROM weight_entries WHERE id = ?'
    )
      .bind((out as { target_id: string }).target_id)
      .first<{ user_id: string; weight: number; unit: string; date: string; source: string }>();
    // Never converted — the donor's rule for an entry, and the coach uses the
    // ordinary create path, so the row is indistinguishable from a typed one.
    expect(row).toMatchObject({ user_id: UID, weight: 82.4, unit: 'lb', date: TODAY });
    expect(row?.source).toBe('manual');
  });

  it('HEALTH-AI-432: a meal item with NO macros lands as zeroes on a one-serving row', async () => {
    // The proposal keeps "the coach did not know" as null; the diary column is
    // NOT NULL, so the write has to choose — and it chooses the honest zero
    // rather than inventing a figure.
    const out = await commit('prepare_log_meal', {
      meal_type: 'dinner',
      items: [{ food_name: 'Leftover stew' }],
    });
    expect(out).toMatchObject({ ok: true, status: 'committed', target_type: 'nutrition' });

    const row = await testEnv.DB.prepare(
      'SELECT food_name, meal_type, calories, proteins, portion, unit FROM nutrition_entries WHERE user_id = ?'
    )
      .bind(UID)
      .first<{
        food_name: string;
        meal_type: string;
        calories: number;
        proteins: number;
        portion: number;
        unit: string;
      }>();
    expect(row).toMatchObject({
      food_name: 'Leftover stew',
      meal_type: 'dinner',
      calories: 0,
      proteins: 0,
      // No grams given → the table's own defaults, not a fabricated mass.
      portion: 1,
      unit: 'serving',
    });
  });

  it('HEALTH-AI-433: a meal with a gram figure is stored in grams', async () => {
    await commit('prepare_log_meal', {
      meal_type: 'lunch',
      items: [{ food_name: 'Rice', grams: 180, calories: 234 }],
    });
    const row = await testEnv.DB.prepare(
      'SELECT portion, unit, calories FROM nutrition_entries WHERE user_id = ?'
    )
      .bind(UID)
      .first<{ portion: number; unit: string; calories: number }>();
    expect(row).toMatchObject({ portion: 180, unit: 'g', calories: 234 });
  });

  it('HEALTH-AI-434: a proposal with NO meal slot lands in the snack slot, never nowhere', async () => {
    await commit('prepare_log_meal', { items: [{ food_name: 'Apple', calories: 80 }] });
    const row = await testEnv.DB.prepare(
      'SELECT meal_type FROM nutrition_entries WHERE user_id = ?'
    )
      .bind(UID)
      .first<{ meal_type: string }>();
    expect(row?.meal_type).toBe('snack');
  });

  it('HEALTH-AI-435: the ledger list defaults to the newest twenty receipts', async () => {
    for (let i = 0; i < 3; i++) {
      await commit('prepare_log_water', { amount_ml: 100 + i });
    }
    const all = await service().listOperations(UID);
    expect(all).toHaveLength(3);
    expect(all.every((r) => r.commit_status === 'committed')).toBe(true);
  });
});
