/**
 * HEALTH-AI — the coach service, the parts nothing else reaches.
 *
 * `routes/__tests__/health-ai.test.ts` owns the HTTP contract and
 * `health-ai/__tests__/coach-service.test.ts` owns the consent state machine,
 * `buildContext` on a seeded day and `writeDomain` for weight and meals. This
 * file is the remainder, and every case here is a branch that had never been
 * executed by anything:
 *
 *  - **THE HABIT CONTEXT LINE.** `buildContext` reads the member's habit list so
 *    the coach can name one back to them, and `contextLines` renders it as
 *    `id — name — state`. That line is the ONLY place a habit id is ever shown
 *    to a model, and `prepare_log_habit` can only quote an id it has seen — so
 *    what is on it, and what is capped off it, is the whole reach of the habit
 *    verb. It landed with the three added verbs and had no test.
 *  - **THE TOOL LOOP'S SECOND CALL.** One confirm card cannot represent two
 *    writes, so only the FIRST `prepare_log_*` in a turn becomes a proposal and
 *    the rest are answered with a refusal the model can read. The route suite
 *    proves the first half (`HEALTH-AI-144`); the message the second call gets
 *    back — which is what stops the model retrying forever — was unasserted.
 *  - **THE LEDGER READERS.** `listOperations` and `getOperation` back the
 *    member-facing "what has the coach actually done" surface. Ordering, the
 *    soft-delete filter and the cross-user null are what make that surface safe.
 *  - **FRESHNESS.** `missing` is the honest "I have nothing to go on", and the
 *    exact boundary matters: a person with a weight on record but nothing logged
 *    today is NOT in that state, and telling them so would be wrong.
 *
 * THE MODEL IS ALWAYS A LOCAL FAKE. There is no `@anthropic-ai/sdk` in this
 * file and no network call is possible from it.
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AIProvider, GenerateArgs, GenerateResult } from '../../ai/provider';
import {
  createHealthAiTables,
  createHealthTables,
  resetHealthAiTables,
  resetHealthTables,
  seedHealthUsers,
} from '../../routes/__tests__/health-test-helpers';
import type { Env } from '../../types';
import { buildProposal } from '../health-ai/coach-proposals';
import { HealthCoachService, MAX_CONTEXT_HABITS } from '../health-ai/coach-service';
import { HealthService } from '../health-service';

const testEnv = env as unknown as Env;
const UID = 'u_coachx_alice';
const OTHER = 'u_coachx_bob';
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
      return (
        next ?? { content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', model: 'fake' }
      );
    },
    generateStructured: async <T,>(): Promise<T> => ({}) as T,
  } as unknown as AIProvider & { calls: GenerateArgs[] };
}

function toolUse(name: string, input: unknown, id = 'tu1'): GenerateResult {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    stopReason: 'tool_use',
    model: 'fake',
  };
}

function service(): HealthCoachService {
  return new HealthCoachService(testEnv.DB);
}

function health(): HealthService {
  return new HealthService(testEnv.DB);
}

/** The ledger receipt writer — the shape `commit` produces. */
async function seedReceipt(
  userId: string,
  operationId: string,
  over: { createdAt?: string; deleted?: boolean; status?: string; targetType?: string } = {}
): Promise<void> {
  const ts = over.createdAt ?? '2026-07-25T09:00:00.000Z';
  await testEnv.DB.prepare(
    `INSERT INTO health_coach_operations
       (operation_id, user_id, target_type, target_id, payload_hash, commit_status,
        expected_target_version, result_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'tgt', 'aaaaaaaa', ?, NULL, NULL, ?, ?, ?)`
  )
    .bind(
      operationId,
      userId,
      over.targetType ?? 'water',
      over.status ?? 'committed',
      ts,
      ts,
      over.deleted ? ts : null
    )
    .run();
}

beforeEach(async () => {
  await createHealthTables(testEnv.DB);
  await createHealthAiTables(testEnv.DB);
  await resetHealthAiTables(testEnv.DB);
  await resetHealthTables(testEnv.DB);
  await seedHealthUsers(testEnv.DB, [UID, OTHER]);
});

/* ==================================================================== */
/* Context — the habit line                                             */
/* ==================================================================== */

describe('Symply Health coach service — habit context', () => {
  it('HEALTH-AI-562: the habit list reaches the context with its done-today state', async () => {
    const svc = health();
    const med = await svc.createHabit(UID, { name: 'Meditate' });
    await svc.createHabit(UID, { name: 'Read' });
    await svc.toggleHabit(UID, med.id, TODAY);

    const ctx = await service().buildContext(UID, TODAY);

    expect(ctx.habits).toEqual(
      expect.arrayContaining([
        { id: med.id, name: 'Meditate', done_today: true },
        expect.objectContaining({ name: 'Read', done_today: false }),
      ])
    );
    // Nothing else about habits enters the context: no streak, no history, and
    // no judgement about a missed day.
    for (const h of ctx.habits) expect(Object.keys(h).sort()).toEqual(['done_today', 'id', 'name']);
  });

  it('HEALTH-AI-563: a habit ticked on ANOTHER day does not read as done today', async () => {
    // `done_today` is `days.includes(today)`. Reading a stale tick as today's
    // would let the coach tell someone they have already done something they
    // have not, and would make `prepare_log_habit` look redundant.
    const svc = health();
    const med = await svc.createHabit(UID, { name: 'Meditate' });
    await svc.toggleHabit(UID, med.id, '2026-07-24');

    const ctx = await service().buildContext(UID, TODAY);
    expect(ctx.habits[0]).toMatchObject({ done_today: false });
  });

  it(`HEALTH-AI-564: the context is capped at ${MAX_CONTEXT_HABITS} habits so the prompt cannot grow unboundedly`, async () => {
    const svc = health();
    for (let i = 0; i < MAX_CONTEXT_HABITS + 5; i++) {
      await svc.createHabit(UID, { name: `Habit ${i}` });
    }

    const ctx = await service().buildContext(UID, TODAY);
    expect(ctx.habits).toHaveLength(MAX_CONTEXT_HABITS);
  });

  it('HEALTH-AI-565: the prompt names each habit as id — name — state, and NOTHING else', async () => {
    // This is the only place a habit id is ever shown to a model, and a habit
    // that is not on this line does not exist as far as the coach is concerned
    // — the commit path re-checks ownership, but the prompt is what bounds what
    // can even be proposed.
    const svc = health();
    const med = await svc.createHabit(UID, { name: 'Meditate' });
    await svc.toggleHabit(UID, med.id, TODAY);
    const provider = fakeProvider([
      { content: [{ type: 'text', text: 'Noted.' }], stopReason: 'end_turn', model: 'fake' },
    ]);

    await service().runTurn({ userId: UID, message: 'how am I doing', today: TODAY }, provider, {
      model: 'fake',
      now: NOW,
    });

    const prompt = provider.calls[0].systemPrompt ?? '';
    expect(prompt).toContain('Your habits (id — name — state today)');
    expect(prompt).toContain(`${med.id} — Meditate — done today`);
  });

  it('HEALTH-AI-566: an account with NO habits gets a null line, not an empty list rendered as ""', async () => {
    // `buildHealthCoachContextBlock` prints nulls as "not logged"-shaped copy.
    // An empty string beside the heading would read as "you have a habit and it
    // has no name".
    const provider = fakeProvider([
      { content: [{ type: 'text', text: 'Noted.' }], stopReason: 'end_turn', model: 'fake' },
    ]);
    await service().runTurn({ userId: UID, message: 'hello', today: TODAY }, provider, {
      model: 'fake',
      now: NOW,
    });

    const prompt = provider.calls[0].systemPrompt ?? '';
    expect(prompt).toContain('Your habits (id — name — state today)');
    expect(prompt).not.toMatch(/Your habits \(id — name — state today\)\s*:\s*$/m);
  });

  it('HEALTH-AI-567: another member\'s habits never enter this member\'s context', async () => {
    const svc = health();
    await svc.createHabit(OTHER, { name: 'Bob only' });

    const ctx = await service().buildContext(UID, TODAY);
    expect(ctx.habits).toEqual([]);
  });
});

/* ==================================================================== */
/* Freshness                                                            */
/* ==================================================================== */

describe('Symply Health coach service — freshness boundary', () => {
  it('HEALTH-AI-568: nothing logged today AND no weight on record is the honest "missing"', async () => {
    const provider = fakeProvider([
      { content: [{ type: 'text', text: 'Noted.' }], stopReason: 'end_turn', model: 'fake' },
    ]);
    const turn = await service().runTurn(
      { userId: UID, message: 'how am I doing', today: TODAY },
      provider,
      { model: 'fake', now: NOW }
    );

    expect(turn.insights).toHaveLength(1);
    expect(turn.insights[0].kind).toBe('unknown_data');
    // "Missing data means unknown — not zero" — an insight saying "you logged 0"
    // about a day the person never opened the app is a lie dressed as a fact.
    expect(turn.insights[0].facts).toEqual([]);
  });

  it('HEALTH-AI-569: a WEIGHT on record alone lifts the day out of "missing"', async () => {
    // The exact boundary in `freshnessOf`: nothing logged today is not the same
    // fact as nothing known about this person at all. With a weight on file the
    // day is `fresh`, and the insight list is then driven purely by which
    // figures exist — which for an untouched day is still `unknown_data`, but
    // reached by the other route.
    await health().createWeight(UID, { date: '2026-07-20', weight: 80, unit: 'kg' });
    const provider = fakeProvider([
      { content: [{ type: 'text', text: 'Noted.' }], stopReason: 'end_turn', model: 'fake' },
    ]);

    const turn = await service().runTurn(
      { userId: UID, message: 'how am I doing', today: TODAY },
      provider,
      { model: 'fake', now: NOW }
    );

    expect(turn.insights).toHaveLength(1);
    expect(turn.insights[0].kind).toBe('unknown_data');
    // …and the prompt DOES know the weight, which is the difference the
    // freshness flag alone cannot show.
    expect(provider.calls[0].systemPrompt ?? '').toContain('80 kg on 2026-07-20');
  });

  it('HEALTH-AI-570: one logged figure produces its own grounded insight, not the unknown card', async () => {
    await health().createWater(UID, { date: TODAY, amount_ml: 750 });
    const provider = fakeProvider([
      { content: [{ type: 'text', text: 'Noted.' }], stopReason: 'end_turn', model: 'fake' },
    ]);

    const turn = await service().runTurn(
      { userId: UID, message: 'how much water', today: TODAY },
      provider,
      { model: 'fake', now: NOW }
    );

    expect(turn.insights.map((i) => i.kind)).toEqual(['water']);
    expect(turn.insights[0].speakable).toContain('750');
  });
});

/* ==================================================================== */
/* Tool loop                                                            */
/* ==================================================================== */

describe('Symply Health coach service — tool loop', () => {
  it('HEALTH-AI-571: a SECOND prepare_log_* in one turn is refused with a message the model can act on', async () => {
    // One confirm card cannot represent two writes. The refusal has to be
    // readable rather than silent, or the model retries the same call until the
    // iteration ceiling and the person waits for nothing.
    const provider = fakeProvider([
      {
        content: [
          { type: 'tool_use', id: 'tu1', name: 'prepare_log_water', input: { amount_ml: 500 } },
          { type: 'tool_use', id: 'tu2', name: 'prepare_log_water', input: { amount_ml: 250 } },
        ],
        stopReason: 'tool_use',
        model: 'fake',
      },
      { content: [{ type: 'text', text: 'Ready to confirm the first one.' }], stopReason: 'end_turn', model: 'fake' },
    ]);

    const turn = await service().runTurn(
      { userId: UID, message: 'I drank two glasses', today: TODAY },
      provider,
      { model: 'fake', now: NOW }
    );

    expect(turn.kind).toBe('proposal');
    // The FIRST call wins — the donor's rule.
    expect(turn.proposal?.normalized_payload).toEqual({ kind: 'water', amount_ml: 500 });

    // The follow-up turn carries BOTH tool results — one per call, addressed by
    // `tool_use_id` — and the second says why it was not honoured.
    const followUp = provider.calls[1].messages.at(-1);
    const blocks = (followUp?.content ?? []) as Array<{ tool_use_id: string; content: string }>;
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['tu1', 'tu2']);
    expect(JSON.parse(blocks[0].content)).toMatchObject({
      ok: true,
      prepared: { kind: 'water', amount_ml: 500 },
    });
    expect(JSON.parse(blocks[1].content)).toEqual({
      ok: false,
      error: 'proposal already prepared this turn',
    });
  });

  it('HEALTH-AI-572: a tool call the model INVENTED is answered as unknown_tool and writes nothing', async () => {
    const provider = fakeProvider([
      toolUse('delete_all_my_food', { confirm: true }),
      { content: [{ type: 'text', text: 'I cannot do that.' }], stopReason: 'end_turn', model: 'fake' },
    ]);

    const turn = await service().runTurn(
      { userId: UID, message: 'wipe my diary', today: TODAY },
      provider,
      { model: 'fake', now: NOW }
    );

    expect(turn.proposal).toBeNull();
    expect(turn.kind).toBe('reply');
    const followUp = JSON.stringify(provider.calls[1].messages.at(-1)?.content ?? '');
    expect(followUp).toContain('unknown_tool');
  });

  it('HEALTH-AI-573: an out-of-range tool call is answered with a RESTATEMENT prompt, not a card', async () => {
    // Building the proposal anyway and letting the commit route 400 later would
    // show the person a card offering to log something the server will refuse.
    const provider = fakeProvider([
      toolUse('prepare_log_workout', { workout_type: 'Running', minutes: 100000 }),
      { content: [{ type: 'text', text: 'How long was that, roughly?' }], stopReason: 'end_turn', model: 'fake' },
    ]);

    const turn = await service().runTurn(
      { userId: UID, message: 'I ran forever', today: TODAY },
      provider,
      { model: 'fake', now: NOW }
    );

    expect(turn.proposal).toBeNull();
    const followUp = JSON.stringify(provider.calls[1].messages.at(-1)?.content ?? '');
    expect(followUp).toContain('outside what this app will store');
  });

  it('HEALTH-AI-574: a model that never stops asking for tools is bounded, and still answers', async () => {
    // Without the ceiling a looping model holds the request open until the
    // Worker's own limit and the person sees nothing at all.
    const script: GenerateResult[] = Array.from({ length: 12 }, (_, i) =>
      toolUse('prepare_log_water', { amount_ml: 100 + i }, `tu${i}`)
    );
    const provider = fakeProvider(script);

    const turn = await service().runTurn(
      { userId: UID, message: 'log some water', today: TODAY },
      provider,
      { model: 'fake', now: NOW }
    );

    // Five iterations, never twelve.
    expect(provider.calls.length).toBeLessThanOrEqual(5);
    // And the loop still produced the first proposal rather than giving up.
    expect(turn.kind).toBe('proposal');
    expect(turn.proposal?.normalized_payload).toEqual({ kind: 'water', amount_ml: 100 });
  });
});

/* ==================================================================== */
/* Ledger readers                                                       */
/* ==================================================================== */

describe('Symply Health coach service — ledger readers', () => {
  it('HEALTH-AI-575: receipts come back NEWEST first', async () => {
    await seedReceipt(UID, 'hop_old', { createdAt: '2026-07-20T08:00:00.000Z' });
    await seedReceipt(UID, 'hop_new', { createdAt: '2026-07-25T08:00:00.000Z' });

    const rows = await service().listOperations(UID);
    expect(rows.map((r) => r.operation_id)).toEqual(['hop_new', 'hop_old']);
  });

  it('HEALTH-AI-576: a SOFT-DELETED receipt is not listed', async () => {
    await seedReceipt(UID, 'hop_live');
    await seedReceipt(UID, 'hop_gone', { deleted: true });

    const rows = await service().listOperations(UID);
    expect(rows.map((r) => r.operation_id)).toEqual(['hop_live']);
  });

  it('HEALTH-AI-577: the limit is honoured and another member\'s receipts are never in the list', async () => {
    await seedReceipt(UID, 'hop_1', { createdAt: '2026-07-21T08:00:00.000Z' });
    await seedReceipt(UID, 'hop_2', { createdAt: '2026-07-22T08:00:00.000Z' });
    await seedReceipt(OTHER, 'hop_bob', { createdAt: '2026-07-23T08:00:00.000Z' });

    const rows = await service().listOperations(UID, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].operation_id).toBe('hop_2');
    expect((await service().listOperations(UID)).map((r) => r.operation_id)).not.toContain(
      'hop_bob'
    );
  });

  it('HEALTH-AI-578: getOperation returns null for another member\'s id, and for one that never existed', async () => {
    // The route turns BOTH into 404, which is what stops an id being probed for
    // existence on someone else's account. The service must not distinguish
    // them either, or a future caller will.
    await seedReceipt(OTHER, 'hop_bob');

    expect(await service().getOperation(UID, 'hop_bob')).toBeNull();
    expect(await service().getOperation(UID, 'hop_never')).toBeNull();
    expect(await service().getOperation(OTHER, 'hop_bob')).not.toBeNull();
  });

  it('HEALTH-AI-579: a PENDING receipt is readable — an unfinished confirmation is not hidden', async () => {
    // The ledger is claimed BEFORE the diary write, so `pending` means "you
    // confirmed this and it did not finish". Filtering it out of the
    // member-facing list would smooth over exactly the state they need to see.
    await seedReceipt(UID, 'hop_pending', { status: 'pending' });

    const rows = await service().listOperations(UID);
    expect(rows).toHaveLength(1);
    expect(rows[0].commit_status).toBe('pending');
  });
});

/* ==================================================================== */
/* writeDomain — the added verbs at service level                       */
/* ==================================================================== */

describe('Symply Health coach service — writeDomain for the added verbs', () => {
  /** Build a genuine proposal the way `runTurn` would, then commit it. */
  async function commitTool(tool: string, input: unknown, opId: string) {
    const proposal = buildProposal({
      toolName: tool,
      input,
      originalText: 'said so',
      now: NOW,
      newId: () => opId,
    });
    expect(proposal, `${tool} produced no proposal`).not.toBeNull();
    return service().commit({
      userId: UID,
      proposal,
      confirmedHash: proposal!.payload_hash,
      today: TODAY,
      now: NOW,
    });
  }

  it('HEALTH-AI-580: two period commits for the SAME day upsert rather than duplicating', async () => {
    // `logPeriodDay` upserts on (user, date) and re-anchors the cycle exactly as
    // the ordinary route does, so a confirmed proposal and a tap on the Cycle
    // screen are the same write. Two DIFFERENT operations for one day are not a
    // ledger replay — they are two confirmations — and the row must still be one.
    const first = await commitTool('prepare_log_period_day', { flow_level: 2 }, 'hop_p1');
    const second = await commitTool(
      'prepare_log_period_day',
      { flow_level: 4, notes: 'heavier' },
      'hop_p2'
    );

    expect(first).toMatchObject({ ok: true, status: 'committed', target_id: TODAY });
    expect(second).toMatchObject({ ok: true, status: 'committed', target_id: TODAY });

    const { results } = await testEnv.DB.prepare(
      'SELECT flow_level, notes FROM period_entries WHERE user_id = ? AND date = ? AND deleted_at IS NULL'
    )
      .bind(UID, TODAY)
      .all<{ flow_level: number; notes: string | null }>();
    expect(results).toHaveLength(1);
    expect(results?.[0]).toMatchObject({ flow_level: 4, notes: 'heavier' });

    // Two receipts, though — the audit records both confirmations.
    expect(await service().listOperations(UID)).toHaveLength(2);
  });

  it('HEALTH-AI-581: the habit NAME check ignores case and surrounding space', async () => {
    // The card shows what the model typed. Refusing "meditate " against a stored
    // "Meditate" would be a false alarm on the member's own habit, and the check
    // exists to catch a mismatched PAIR, not a different capitalisation.
    const habit = await health().createHabit(UID, { name: 'Meditate' });

    const result = await commitTool(
      'prepare_log_habit',
      { habit_id: habit.id, habit_name: '  meditate  ' },
      'hop_h1'
    );

    expect(result).toMatchObject({ ok: true, status: 'committed', target_id: habit.id });
  });

  it('HEALTH-AI-582: a habit DELETED since the proposal was made refuses rather than throwing', async () => {
    const habit = await health().createHabit(UID, { name: 'Meditate' });
    await testEnv.DB.prepare('UPDATE user_habits SET deleted_at = ? WHERE id = ?')
      .bind(NOW.toISOString(), habit.id)
      .run();

    const result = await commitTool(
      'prepare_log_habit',
      { habit_id: habit.id, habit_name: 'Meditate' },
      'hop_h2'
    );

    expect(result).toEqual({ ok: false, reason: 'target_unavailable' });
    // The confirmation is still on record, unfinished.
    const rows = await service().listOperations(UID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ commit_status: 'pending', target_type: 'habit' });
  });

  it('HEALTH-AI-583: a workout with an explicit ZERO burn stores zero, not "unstated"', async () => {
    // 0 kcal read off a device is a figure the person stated; null is one they
    // did not. `optNum`-style coercion that treated 0 as absent would erase the
    // difference, and the row would render as "not recorded".
    const result = await commitTool(
      'prepare_log_workout',
      { workout_type: 'Stretching', minutes: 10, calories: 0 },
      'hop_w1'
    );
    expect(result.ok).toBe(true);

    const row = await testEnv.DB.prepare('SELECT data FROM health_entries WHERE id = ?')
      .bind((result as { target_id: string }).target_id)
      .first<{ data: string }>();
    expect(JSON.parse(row?.data ?? '{}')).toMatchObject({ calories: 0 });
  });
});
