/**
 * §5.2 — the UI invalidation contract.
 *
 * This is the one place the plan says Budget's pattern must NOT be copied, so
 * it gets a test rather than a comment. The failure it prevents is not a crash:
 * a blanket invalidate still *works*, it just turns every remote op into a
 * burst of network requests against the Tier-B endpoints local-first exists to
 * stop calling — invisible in development, expensive and permanent in the field.
 */
import { HOUSE_LEDGER_TABLE_NAMES, type HouseLedgerTableName } from '../schema';
import {
  HOUSE_NEVER_INVALIDATED_KEYS,
  HOUSE_TABLE_QUERY_KEYS,
  invalidateForTables,
  queryKeysForTables,
  tablesWithoutQueryKeys,
} from '../sync/ledgerRefresh';

// `mock`-prefixed so jest's out-of-scope guard allows the factory to close
// over it (the hoisted `jest.mock` runs before the module body).
const mockInvalidateQueries = jest.fn();

jest.mock('@/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  },
}));

beforeEach(() => {
  mockInvalidateQueries.mockClear();
});

describe('the map is exhaustive and bounded', () => {
  it('maps every registered ledger table', () => {
    expect(tablesWithoutQueryKeys()).toEqual([]);
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      expect(HOUSE_TABLE_QUERY_KEYS[table].length).toBeGreaterThan(0);
    }
  });

  it('maps no table that is not in the registry', () => {
    const mapped = Object.keys(HOUSE_TABLE_QUERY_KEYS) as HouseLedgerTableName[];
    expect(new Set(mapped)).toEqual(new Set(HOUSE_LEDGER_TABLE_NAMES));
  });

  it('never emits an EMPTY key prefix, which would match every query', () => {
    // `invalidateQueries({ queryKey: [] })` is a blanket invalidate wearing a
    // map. This is the single assertion that keeps the whole design honest.
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      for (const key of HOUSE_TABLE_QUERY_KEYS[table]) {
        expect(key.length).toBeGreaterThan(0);
        expect(key[0]).toBeTruthy();
      }
    }
  });
});

describe('Tier B and Tier C are never invalidated by a local write', () => {
  /** True when `key` would be matched by React Query's prefix matching of `prefix`. */
  const prefixMatches = (prefix: readonly string[], key: readonly string[]): boolean =>
    prefix.length <= key.length && prefix.every((part, i) => key[i] === part);

  it('no mapped prefix can reach a forbidden key', () => {
    const offenders: string[] = [];
    for (const table of HOUSE_LEDGER_TABLE_NAMES) {
      for (const prefix of HOUSE_TABLE_QUERY_KEYS[table]) {
        for (const forbidden of HOUSE_NEVER_INVALIDATED_KEYS) {
          if (prefixMatches(prefix, forbidden)) {
            offenders.push(`${table} → [${prefix.join(',')}] reaches [${forbidden.join(',')}]`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is capable of failing — a bare ["home"] prefix WOULD reach home-budget', () => {
    // Proof the matcher above is not vacuous: `['home']` is exactly the kind of
    // over-broad prefix someone would add for convenience, and it would drag in
    // `['home','home-budget']`, which is Tier B.
    expect(prefixMatches(['home'], ['home', 'home-budget'])).toBe(true);
    // …which is why the real map only ever uses the two-segment forms.
    expect(HOUSE_TABLE_QUERY_KEYS.appliances.some((k) => k.length === 1 && k[0] === 'home')).toBe(
      false,
    );
  });
});

describe('queryKeysForTables', () => {
  it('returns nothing for no tables — a non-data bump invalidates nothing', () => {
    expect(queryKeysForTables([])).toEqual([]);
    invalidateForTables([]);
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it('dedupes prefixes two tables share', () => {
    // tasks and maintenanceCompletions both touch ['tasks'] and ['home','insight'].
    const keys = queryKeysForTables(['tasks', 'maintenanceCompletions']);
    const ids = keys.map((k) => k.join('|'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('tasks');
    expect(ids).toContain('home|insight');
  });

  it('invalidates task keys for a tasks delta and nothing unrelated', () => {
    invalidateForTables(['tasks']);
    const invalidated = mockInvalidateQueries.mock.calls.map(
      (call) => (call[0] as { queryKey: string[] }).queryKey,
    );
    expect(invalidated).toContainEqual(['tasks']);
    expect(invalidated).not.toContainEqual(['garbage']);
    expect(invalidated).not.toContainEqual(['checklists']);
    expect(invalidated.flat()).not.toContain('aihousekeeper');
    expect(invalidated.flat()).not.toContain('chat');
  });

  it('invalidates only the garbage keys for a garbage delta', () => {
    invalidateForTables(['garbageSchedules']);
    const invalidated = mockInvalidateQueries.mock.calls.map(
      (call) => (call[0] as { queryKey: string[] }).queryKey,
    );
    expect(invalidated).toEqual([['garbage']]);
  });

  it('scales with the number of tables, not with the number of query keys', () => {
    // The whole point: even a change touching every Wave-A table produces a
    // bounded, deduped set — not "invalidate everything".
    invalidateForTables(HOUSE_LEDGER_TABLE_NAMES);
    const invalidated = mockInvalidateQueries.mock.calls.map(
      (call) => (call[0] as { queryKey: string[] }).queryKey.join('|'),
    );
    expect(new Set(invalidated).size).toBe(invalidated.length);
    expect(invalidated.length).toBeLessThan(HOUSE_LEDGER_TABLE_NAMES.length);
  });
});
