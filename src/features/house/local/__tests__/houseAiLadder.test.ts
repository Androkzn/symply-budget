/**
 * The three-stage ladder itself (plan §9, Q6; DoD H7).
 *
 * `egressAllowlist.test.ts` proves what a payload may contain. This suite proves
 * the machine around it: that Stage A wins whenever it can answer, that Stage B
 * is unreachable without a key, that Stage C always produces member-facing copy,
 * and — the one that keeps coming back in incident reviews — that a provider's
 * raw error text cannot escape through the ladder in any form.
 *
 * The context builder is tested here rather than in the allowlist suite because
 * it is where the allowlist is *applied*: `buildHouseAiContext` is the only
 * sanctioned way to turn a ledger into a payload, so its refusals are part of
 * the ladder's contract.
 *
 * Static imports only — `await import()` throws under this Jest config (§6.2).
 */
import {
  buildHouseAiContext,
  getHouseAiUnavailableCopy,
  houseAiUnavailable,
  runHouseAiLadder,
  HouseAiUnavailableError,
  type HouseAiContext,
  type HouseAiUnavailableReason,
} from '../ai/houseAiLadder';

const REASONS: HouseAiUnavailableReason[] = ['no_key', 'provider_failed', 'not_supported'];

/** A key-shaped string, so "did this leak" is a substring search. */
const FAKE_KEY = 'sk-ant-api03-THIS-MUST-NEVER-APPEAR-anywhere';

function emptyContext(): HouseAiContext {
  return { tables: {}, excludedTables: [], rowCount: 0 };
}

describe('Stage A wins whenever it can answer', () => {
  it('returns the deterministic answer and never calls Stage B', async () => {
    const stageB = jest.fn();
    const result = await runHouseAiLadder<string>({
      stageA: () => 'bin day is Wednesday',
      stageB,
      context: emptyContext(),
      hasProviderKey: true,
    });

    expect(result).toEqual({ stage: 'A', value: 'bin day is Wednesday' });
    // Stage A beating Stage B *even when a key exists* is the plan's rule: a
    // deterministic answer is free, instant, private and correct, and paying a
    // provider for a second opinion is a regression, not a feature.
    expect(stageB).not.toHaveBeenCalled();
  });

  it('treats an empty list as an answer, not as "no answer"', async () => {
    // The distinction the ladder rests on: `[]` means "nothing to report" and
    // `null` means "I cannot tell". Collapsing them sends every brand-new
    // household straight to a paid provider on first launch.
    const stageB = jest.fn();
    const result = await runHouseAiLadder<string[]>({
      stageA: () => [],
      stageB,
      context: emptyContext(),
      hasProviderKey: true,
    });

    expect(result).toEqual({ stage: 'A', value: [] });
    expect(stageB).not.toHaveBeenCalled();
  });

  it('works with no key, no Stage B and no network', async () => {
    // DoD H7: "Stage A parse tested offline". No `stageB`, no key, and nothing
    // in this test can reach a socket.
    const result = await runHouseAiLadder<number>({
      stageA: () => 42,
      context: emptyContext(),
      hasProviderKey: false,
    });
    expect(result).toEqual({ stage: 'A', value: 42 });
  });
});

describe('Stage B is unreachable without a key', () => {
  it('falls to Stage C `no_key` and never invokes the provider', async () => {
    const stageB = jest.fn();
    const result = await runHouseAiLadder<string>({
      stageA: () => null,
      stageB,
      context: emptyContext(),
      hasProviderKey: false,
    });

    expect(result).toEqual({ stage: 'C', reason: 'no_key' });
    expect(stageB).not.toHaveBeenCalled();
  });

  it('reports `not_supported` when nothing on the ladder can answer', async () => {
    const result = await runHouseAiLadder<string>({
      stageA: () => null,
      context: emptyContext(),
      hasProviderKey: true,
    });
    // A key does not help when no Stage B exists — saying `no_key` there would
    // send the member to Settings to fix something that is not the problem.
    expect(result).toEqual({ stage: 'C', reason: 'not_supported' });
  });

  it('hands Stage B the projected context and nothing else', async () => {
    const context = buildHouseAiContext(
      {
        tasks: [{ id: 't1', title: 'Bleed radiators', description: 'code 4792' }],
        households: [{ id: 'hh-1', address_line1: '14 Alder Street' }],
      },
      ['tasks', 'households'],
    );
    const stageB = jest.fn().mockResolvedValue('ok');

    await runHouseAiLadder<string>({
      stageA: () => null,
      stageB,
      context,
      hasProviderKey: true,
    });

    expect(stageB).toHaveBeenCalledTimes(1);
    const received = stageB.mock.calls[0]![0] as HouseAiContext;
    expect(received).toBe(context);
    // The signature is `(context) => …`, not `(ledger) => …`, and this is what
    // that buys: there is no argument through which a raw row could arrive.
    expect(JSON.stringify(received)).not.toContain('Alder Street');
    expect(JSON.stringify(received)).not.toContain('4792');
  });

  it('returns the Stage B answer when the provider succeeds', async () => {
    const result = await runHouseAiLadder<string>({
      stageA: () => null,
      stageB: async () => 'assistant says Tuesday',
      context: emptyContext(),
      hasProviderKey: true,
    });
    expect(result).toEqual({ stage: 'B', value: 'assistant says Tuesday' });
  });
});

describe('Stage C never surfaces a raw provider error', () => {
  it('maps a null Stage B answer to `provider_failed`', async () => {
    const result = await runHouseAiLadder<string>({
      stageA: () => null,
      stageB: async () => null,
      context: emptyContext(),
      hasProviderKey: true,
    });
    expect(result).toEqual({ stage: 'C', reason: 'provider_failed' });
  });

  it('swallows a thrown provider error, including one carrying an API key', async () => {
    // The exact failure this prevents: a 401 body echoed into `error.message`
    // and rendered by a screen. The thrown text below contains a key, a URL and
    // a stack-looking string — none of it may appear in the result.
    const raw = `401 Unauthorized from https://api.anthropic.com/v1/messages?key=${FAKE_KEY} — invalid x-api-key ${FAKE_KEY}`;
    const result = await runHouseAiLadder<string>({
      stageA: () => null,
      stageB: async () => {
        throw new Error(raw);
      },
      context: emptyContext(),
      hasProviderKey: true,
    });

    expect(result).toEqual({ stage: 'C', reason: 'provider_failed' });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toContain('401');
    expect(serialized).not.toContain('api.anthropic.com');
    expect(serialized).not.toContain('x-api-key');
  });

  it('swallows a non-Error throw too', async () => {
    const result = await runHouseAiLadder<string>({
      stageA: () => null,
      // Providers and fetch polyfills throw strings and plain objects; a `catch`
      // that assumes `Error` is how a raw value reaches the UI.
      stageB: async () => {
        throw FAKE_KEY;
      },
      context: emptyContext(),
      hasProviderKey: true,
    });
    expect(result).toEqual({ stage: 'C', reason: 'provider_failed' });
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });

  it('swallows a Stage B that resolves undefined', async () => {
    const result = await runHouseAiLadder<string | undefined>({
      stageA: () => null,
      stageB: async () => undefined,
      context: emptyContext(),
      hasProviderKey: true,
    });
    expect(result).toEqual({ stage: 'C', reason: 'provider_failed' });
  });
});

describe('Stage C copy is member-facing (DoD H7)', () => {
  it.each(REASONS)('%s has its own title and message', (reason) => {
    const copy = getHouseAiUnavailableCopy(reason);
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.title.length).toBeLessThanOrEqual(60);
    expect(copy.title).not.toMatch(/[.]$/);
    expect(copy.message.length).toBeGreaterThan(80);
  });

  it('gives each reason distinct copy', () => {
    // Three reasons collapsing to one sentence is how "explicit copy" decays
    // into a shrug — the same regression `unsupportedCopy.ts` was written for.
    const messages = REASONS.map((r) => getHouseAiUnavailableCopy(r).message);
    expect(new Set(messages).size).toBe(REASONS.length);
  });

  it.each(REASONS)('%s copy contains no identifier, code or jargon', (reason) => {
    const copy = getHouseAiUnavailableCopy(reason);
    const text = `${copy.title} ${copy.message}`;
    expect(text).not.toMatch(/[a-z]+_[a-z]+/); // snake_case codes
    expect(text).not.toMatch(/[a-z]+\.[a-zA-Z]+\(/); // method names
    expect(text).not.toContain('HouseAi');
    expect(text).not.toContain('undefined');
    expect(text.toLowerCase()).not.toContain('e2ee');
    expect(text.toLowerCase()).not.toContain('byok');
    expect(text.toLowerCase()).not.toContain('stage');
    expect(text.toLowerCase()).not.toContain('token');
  });

  it.each(REASONS)('%s copy says what still works', (reason) => {
    expect(getHouseAiUnavailableCopy(reason).message).toMatch(/still|instead|keeps? working|can/i);
  });

  it('falls back to the "cannot answer" copy for an unknown reason', () => {
    const unknown = 'something_new' as HouseAiUnavailableReason;
    expect(getHouseAiUnavailableCopy(unknown)).toEqual(getHouseAiUnavailableCopy('not_supported'));
  });

  it('throws an error whose `message` is the copy, not a diagnostic', () => {
    const error = houseAiUnavailable('no_key');
    expect(error).toBeInstanceOf(HouseAiUnavailableError);
    expect(error.name).toBe('HouseAiUnavailableError');
    expect(error.code).toBe('house_ai_unavailable');
    expect(error.reason).toBe('no_key');
    expect(error.message).toBe(getHouseAiUnavailableCopy('no_key').message);
    expect(error.message).not.toContain('no_key');
  });
});

describe('buildHouseAiContext is where the allowlist is applied', () => {
  const ledger = {
    tasks: [
      {
        id: 't1',
        household_id: 'hh-1',
        title: 'Service the furnace',
        description: 'Gate code 4792, ask for Sam Delgado',
        next_due_date: '2026-09-01',
        assigned_to: { id: 'user-9', display_name: 'Sam Delgado' },
        is_active: true,
      },
    ],
    households: [{ id: 'hh-1', address_line1: '14 Alder Street', purchase_price: 910000 }],
    householdMembers: [{ id: 'm1', user_id: 'user-9', display_name: 'Sam Delgado' }],
    settings: [{ id: 's1', key: 'reminder_time', value: '09:00' }],
  };

  it('includes an allowed table, projected down to allowed fields', () => {
    const context = buildHouseAiContext(ledger, ['tasks']);
    expect(context.tables.tasks).toEqual([
      {
        id: 't1',
        title: 'Service the furnace',
        next_due_date: '2026-09-01',
        is_active: true,
      },
    ]);
    expect(context.rowCount).toBe(1);
    expect(context.excludedTables).toEqual([]);
  });

  it('records a forbidden table as excluded and contributes none of it', () => {
    const context = buildHouseAiContext(ledger, [
      'tasks',
      'households',
      'householdMembers',
      'settings',
    ]);
    expect(context.excludedTables).toEqual(['households', 'householdMembers', 'settings']);
    expect(context.tables.households).toBeUndefined();
    expect(context.tables.householdMembers).toBeUndefined();
    expect(context.tables.settings).toBeUndefined();
    // `excludedTables` exists for observability — it must not become a smuggling
    // route by carrying the rows it refused.
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('Alder Street');
    expect(serialized).not.toContain('910000');
    expect(serialized).not.toContain('Sam Delgado');
    expect(serialized).not.toContain('user-9');
  });

  it('does not count or include a table with nothing to project', () => {
    const context = buildHouseAiContext({ appliances: [] }, ['appliances']);
    expect(context.tables.appliances).toBeUndefined();
    expect(context.rowCount).toBe(0);
  });

  it('treats a missing or non-array ledger value as empty rather than throwing', () => {
    // A half-restored ledger, or a table added to the registry before the engine
    // populates it. Throwing here would take down whichever screen asked.
    expect(() => buildHouseAiContext({ tasks: null }, ['tasks'])).not.toThrow();
    expect(buildHouseAiContext({}, ['tasks']).rowCount).toBe(0);
    expect(buildHouseAiContext({ tasks: 'oops' }, ['tasks']).rowCount).toBe(0);
  });

  it('clamps rows before projecting, so a ten-year ledger cannot become a prompt', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}` }));
    const context = buildHouseAiContext({ tasks: many }, ['tasks'], { maxRowsPerTable: 25 });
    expect(context.tables.tasks).toHaveLength(25);
    expect(context.rowCount).toBe(25);
    // Default clamp still applies when the caller says nothing.
    expect(buildHouseAiContext({ tasks: many }, ['tasks']).rowCount).toBe(200);
  });

  it('redacts inside the projected payload as the second layer', () => {
    const context = buildHouseAiContext(
      {
        tasks: [
          { id: 't1', title: 'Call the plumber on 604-555-0142' },
          { id: 't2', title: 'Email invoice to owner@example.com' },
        ],
      },
      ['tasks'],
    );
    const serialized = JSON.stringify(context.tables.tasks);
    expect(serialized).toContain('[redacted]');
    expect(serialized).not.toContain('604-555-0142');
    expect(serialized).not.toContain('owner@example.com');
  });

  it('counts rows across every included table', () => {
    const context = buildHouseAiContext(
      {
        tasks: [{ id: 't1', title: 'a' }],
        appliances: [
          { id: 'a1', name: 'Furnace' },
          { id: 'a2', name: 'Dishwasher' },
        ],
      },
      ['tasks', 'appliances'],
    );
    expect(context.rowCount).toBe(3);
  });
});
