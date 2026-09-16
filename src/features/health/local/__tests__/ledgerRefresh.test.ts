/**
 * §7 refresh contract (normative) — the six cases named in plan §12.1, which is
 * a **DoD He3c exit** alongside the summary parity suite. The row, quoted:
 *
 * > `notifyHealthLedgerChanged` contract — **6 cases** (local no-op; `ingest`
 * > fans out; inbound hits Home not Habits; hidden tab skipped; re-entrant
 * > subscriber does not loop; **session opened after a screen already hydrated
 * > re-hydrates it without a navigation event**) — `local/__tests__/ledgerRefresh.test.ts`
 *
 * Numbered against that list below:
 *
 *  1. `origin: 'local'` is a no-op for subscribers.
 *  2. `origin: 'ingest'` DOES fan out (the HealthKit drain no screen rendered).
 *  3. An inbound `nutritionEntries` change hits Home and not Habits.
 *  4. A hidden tab is skipped.
 *  5. A re-entrant subscriber does not loop.
 *  6. A session opened AFTER a screen already hydrated re-hydrates it without a
 *     navigation event — the cold-start race.
 *
 * Why He3c owns this and not He3b: the summaries are the reads that go stale
 * silently. A weight row arriving from the member's other device changes Home's
 * ring, Trends' chart and the streak on the Habits card — none of which the
 * screen can notice on its own, because they are derived and there is no query
 * key to invalidate. Case 3 is therefore asserted over the tables the He7-lite
 * summaries actually read, not just over one convenient pair.
 *
 * The engine is mocked: this suite owns the refresh contract, not the merge
 * engine, and `local/engine.ts` lands separately. The mock is the whole surface
 * `ledgerRefresh.ts` consumes — `subscribeToHealthLedgerChanges` and
 * `getHealthLedgerRevision` — plus test-only emitters.
 *
 * `React.createElement` rather than JSX so this file stays `.test.ts`, the path
 * the plan pins.
 */
import React from 'react';
import { InteractionManager } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useHealthLedgerStore } from '../healthLedgerStore';
import {
  HEALTH_SCREEN_KEYS,
  HEALTH_TABLE_SCREEN_KEYS,
  healthTablesForScreen,
  notifyHealthLedgerChanged,
  startHealthLedgerRefreshBridge,
  stopHealthLedgerRefreshBridge,
  useHealthLedgerHydration,
  type HealthLedgerChangeOrigin,
  type HealthScreenKey,
} from '../ledgerRefresh';
import { HEALTH_LEDGER_TABLE_NAMES, type HealthLedgerTableName } from '../schema';

/**
 * `Mock`-prefixed on purpose: `babel-plugin-jest-hoist` rejects any identifier
 * inside a `jest.mock` factory that is bound outside it — type annotations
 * included — unless the name starts with `mock` (case-insensitive).
 */
type MockEngineChange = {
  revision: number;
  tables: readonly HealthLedgerTableName[];
  origin: HealthLedgerChangeOrigin;
};

type MockEngineListener = (change: MockEngineChange) => void;

interface EngineMock {
  getHealthLedgerRevision: () => number;
  /** Emit a change as the engine would after applying a delta. */
  __emit: (change: MockEngineChange) => void;
  /** Advance the revision WITHOUT notifying — a hydrate that ran before the bridge started. */
  __setRevision: (revision: number) => void;
  __listenerCount: () => number;
}

let mockIsFocused = true;

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockIsFocused,
}));

// The factory owns its own state: `jest.mock` is hoisted above the imports, so
// it cannot close over anything declared in this file without hitting a TDZ.
jest.mock(
  '../engine',
  () => {
    const listeners = new Set<MockEngineListener>();
    const state = { revision: 0 };
    return {
      subscribeToHealthLedgerChanges: (listener: MockEngineListener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getHealthLedgerRevision: () => state.revision,
      __emit: (change: MockEngineChange) => {
        state.revision = change.revision;
        for (const listener of [...listeners]) listener(change);
      },
      __setRevision: (revision: number) => {
        state.revision = revision;
      },
      __listenerCount: () => listeners.size,
    };
  },
  // NOT `{ virtual: true }` — same defect as syncWake.test.ts. `../engine` is a
  // real module, so a virtual mock is registered under the specifier while the
  // code under test resolves the real file; which one wins depends on
  // resolver-cache state that is shared across workers and persists between
  // runs. That is why both suites were green serially and flaked at
  // --maxWorkers=4.
);

const engine = jest.requireMock('../engine') as unknown as EngineMock;

interface ProbeProps {
  hydrate: () => void;
  screen: HealthScreenKey;
}

/** A screen, reduced to the one hook this contract adds to it. */
function Probe({ hydrate, screen }: ProbeProps): null {
  useHealthLedgerHydration(hydrate, healthTablesForScreen(screen));
  return null;
}

function probe(hydrate: () => void, screen: HealthScreenKey): React.ReactElement {
  return React.createElement(Probe, { hydrate, screen });
}

const mounted: ReactTestRenderer[] = [];

async function mount(element: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  mounted.push(renderer);
  return renderer;
}

describe('Health ledger refresh contract (§7)', () => {
  beforeEach(() => {
    mockIsFocused = true;
    useHealthLedgerStore.setState({ revision: 0, touched: [] });
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((cb) => {
      const handle = { cancel: jest.fn() };
      // Run immediately in tests — production waits for gestures to settle.
      (cb as () => void)();
      return handle as unknown as ReturnType<typeof InteractionManager.runAfterInteractions>;
    });
  });

  afterEach(async () => {
    await act(async () => {
      for (const renderer of mounted.splice(0)) renderer.unmount();
    });
    stopHealthLedgerRefreshBridge();
    jest.restoreAllMocks();
  });

  // 1 ------------------------------------------------------------------------
  it('is a no-op for origin "local" — the mutating screen already rendered it', async () => {
    const hydrate = jest.fn();
    await mount(probe(hydrate, 'weight'));

    await act(async () => {
      notifyHealthLedgerChanged(['weightEntries'], 'local');
    });

    expect(hydrate).not.toHaveBeenCalled();
    // Not even a revision bump: a local echo must be invisible to subscribers.
    expect(useHealthLedgerStore.getState().revision).toBe(0);
  });

  // 1b -----------------------------------------------------------------------
  it("treats an UNKNOWN origin as inbound — only 'local' is ever silent", async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const hydrate = jest.fn();
    await mount(probe(hydrate, 'weight'));

    await act(async () => {
      notifyHealthLedgerChanged(
        ['weightEntries'],
        'sync' as unknown as HealthLedgerChangeOrigin,
      );
    });

    // Refresh once rather than show stale data forever — the safe direction.
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  // 2 ------------------------------------------------------------------------
  it('fans out origin "ingest" — a HealthKit drain no screen rendered', async () => {
    // Start before mounting so any cold-start catch-up lands before the probe
    // baselines; this case is about the delta path only.
    startHealthLedgerRefreshBridge();

    const hydrate = jest.fn();
    await mount(probe(hydrate, 'activity'));
    expect(hydrate).not.toHaveBeenCalled();

    await act(async () => {
      engine.__emit({ revision: 1, tables: ['healthEntries'], origin: 'ingest' });
    });

    expect(hydrate).toHaveBeenCalledTimes(1);

    // The asymmetry is the whole point: the SAME table on the SAME screen stays
    // silent when the origin is a local echo. A drain tagged `'local'` is how
    // the HealthKit refresh that ships today regresses at He11.
    await act(async () => {
      engine.__emit({ revision: 2, tables: ['healthEntries'], origin: 'local' });
    });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  // 3 ------------------------------------------------------------------------
  it('routes an inbound nutritionEntries change to Home and not to Habits', async () => {
    const homeHydrate = jest.fn();
    const habitsHydrate = jest.fn();
    await mount(probe(homeHydrate, 'home'));
    await mount(probe(habitsHydrate, 'habits'));

    await act(async () => {
      notifyHealthLedgerChanged(['nutritionEntries'], 'inbound');
    });

    expect(homeHydrate).toHaveBeenCalledTimes(1);
    expect(habitsHydrate).not.toHaveBeenCalled();
    expect(HEALTH_TABLE_SCREEN_KEYS.nutritionEntries).toContain('home');
    expect(HEALTH_TABLE_SCREEN_KEYS.nutritionEntries).not.toContain('habits');
  });

  // 3b -----------------------------------------------------------------------
  it('routes every table a He7-lite summary reads to both Home and Trends', () => {
    // The six on-device summaries read these five tables (`localSummariesApi`).
    // Each is DERIVED, so a peer's delta changes a figure no screen can notice
    // by itself — the reason the refresh contract is an He3c exit and not a
    // nicety. `healthGoals` is included because every ring is drawn against it.
    for (const table of [
      'weightEntries',
      'nutritionEntries',
      'waterEntries',
      'healthEntries',
      'healthGoals',
    ] as const) {
      expect(HEALTH_TABLE_SCREEN_KEYS[table]).toContain('home');
      expect(HEALTH_TABLE_SCREEN_KEYS[table]).toContain('trends');
    }
    // Habit streaks are derived from the LOGS, so a tick on the other device has
    // to reach Home, Trends and the Habits tab alike.
    for (const table of ['userHabits', 'habitLogs'] as const) {
      expect(HEALTH_TABLE_SCREEN_KEYS[table]).toEqual(
        expect.arrayContaining(['home', 'trends', 'habits']),
      );
    }
  });

  // 3c -----------------------------------------------------------------------
  it('wakes Trends when a peer logs a weigh-in, without touching Goals', async () => {
    const trendsHydrate = jest.fn();
    const goalsHydrate = jest.fn();
    await mount(probe(trendsHydrate, 'trends'));
    await mount(probe(goalsHydrate, 'goals'));

    await act(async () => {
      notifyHealthLedgerChanged(['weightEntries'], 'inbound');
    });

    // The weekly trend and the weight statistics both move; the Goals screen
    // renders none of it.
    expect(trendsHydrate).toHaveBeenCalledTimes(1);
    expect(goalsHydrate).not.toHaveBeenCalled();
  });

  // 4 ------------------------------------------------------------------------
  it('skips a hidden tab, and catches it up when it becomes visible', async () => {
    mockIsFocused = false;
    const hydrate = jest.fn();
    const renderer = await mount(probe(hydrate, 'weight'));

    await act(async () => {
      notifyHealthLedgerChanged(['weightEntries'], 'inbound');
    });
    expect(hydrate).not.toHaveBeenCalled();

    // The change is held, not dropped: the tab refreshes once it is focused.
    mockIsFocused = true;
    await act(async () => {
      renderer.update(probe(hydrate, 'weight'));
    });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  // 5 ------------------------------------------------------------------------
  it('does not loop when a subscriber writes back synchronously', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const hydrate = jest.fn();
    await mount(probe(hydrate, 'weight'));

    // Stands in for a subscriber calling `mutateLocalHealthLedger` straight out
    // of its handler — the write comes back as another change, every time.
    let handled = 0;
    const unsubscribe = useHealthLedgerStore.subscribe(() => {
      handled += 1;
      if (handled > 100) throw new Error('runaway ledger refresh');
      notifyHealthLedgerChanged(['weightEntries'], 'inbound');
    });

    await act(async () => {
      notifyHealthLedgerChanged(['weightEntries'], 'inbound');
    });
    unsubscribe();

    expect(handled).toBeGreaterThan(0);
    // `MAX_COALESCED_PASSES` is 4, and each pass notifies the store once; the
    // bound is what separates "coalesced" from "spinning".
    expect(handled).toBeLessThanOrEqual(8);
    // …and it terminates by REPORTING, not by silently stopping.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('ledger refresh feedback loop'),
      expect.anything(),
    );
    // The screen still hydrated — a feedback loop must not cost the refresh it
    // was carrying.
    expect(hydrate).toHaveBeenCalled();
  });

  // 6 ------------------------------------------------------------------------
  it('re-hydrates a screen that mounted before the session opened, with no navigation', async () => {
    const hydrate = jest.fn();
    await mount(probe(hydrate, 'home'));
    // The screen's own `useFocusEffect` already ran, against an empty ledger.
    expect(hydrate).not.toHaveBeenCalled();

    // `ensureHealthLocalSession` hydrates the ledger — advancing the engine's
    // revision — and only then starts the bridge.
    engine.__setRevision(42);
    await act(async () => {
      startHealthLedgerRefreshBridge();
    });
    expect(hydrate).toHaveBeenCalledTimes(1);

    // Restarting the bridge on a revision it has already forwarded must NOT
    // re-fire — otherwise every session-open call site (§7 names three) costs
    // Home a 17-way `Promise.all` it does not need.
    stopHealthLedgerRefreshBridge();
    await act(async () => {
      startHealthLedgerRefreshBridge();
    });
    expect(hydrate).toHaveBeenCalledTimes(1);

    // The explicit account-switch / restore site fans out the same way.
    await act(async () => {
      notifyHealthLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
    });
    expect(hydrate).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------
  it('maps every ledger table to at least one screen, and uses every screen key', () => {
    for (const table of HEALTH_LEDGER_TABLE_NAMES) {
      expect(HEALTH_TABLE_SCREEN_KEYS[table].length).toBeGreaterThan(0);
    }
    for (const screen of HEALTH_SCREEN_KEYS) {
      expect(healthTablesForScreen(screen).length).toBeGreaterThan(0);
    }
  });

  it('starts the bridge idempotently and detaches on stop', () => {
    startHealthLedgerRefreshBridge();
    startHealthLedgerRefreshBridge();
    expect(engine.__listenerCount()).toBe(1);

    stopHealthLedgerRefreshBridge();
    expect(engine.__listenerCount()).toBe(0);
  });
});
