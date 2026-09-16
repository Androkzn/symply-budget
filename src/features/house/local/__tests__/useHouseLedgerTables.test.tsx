/**
 * The bridge that makes a peer's write repaint an imperative screen.
 *
 * Three of these guard against a reload that is WORSE than no reload:
 *  - reloading while the member is editing replaces their unsaved draft;
 *  - reloading for a background property repaints the screen they are on;
 *  - reloading once per op turns a twelve-object sync into twelve reloads.
 *
 * The fourth — "it fires at all" — would be caught by hand in a minute. The
 * other three would not.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { HouseLedgerChange } from '../engine';
import type { HouseLedgerTableName } from '../schema';
import { useHouseLedgerTables } from '../useHouseLedgerTables';

// `mock`-prefixed: `babel-plugin-jest-hoist` lifts these `jest.mock` calls above
// every import above, so their factories may only reference names matching that
// prefix — and the hook import is safe to sit with the others precisely because
// of that hoisting.
let mockListeners: Array<(change: HouseLedgerChange) => void> = [];
let mockLocalFirst = true;

jest.mock('../engine', () => ({
  subscribeToHouseLedgerChanges: (fn: (change: HouseLedgerChange) => void) => {
    mockListeners.push(fn);
    return () => {
      mockListeners = mockListeners.filter((l) => l !== fn);
    };
  },
}));

jest.mock('../flag', () => ({
  isHouseLocalFirst: () => mockLocalFirst,
}));

const HOUSEHOLD = 'hh_1';

function Probe({
  tables,
  onChange,
  householdId,
  enabled,
}: {
  tables: HouseLedgerTableName[];
  onChange: () => void;
  householdId?: string | null;
  enabled?: boolean;
}) {
  useHouseLedgerTables(tables, onChange, { householdId, enabled });
  return null;
}

function render(props: React.ComponentProps<typeof Probe>): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Probe {...props} />);
  });
  return tree;
}

function rerender(tree: ReactTestRenderer, props: React.ComponentProps<typeof Probe>): void {
  act(() => {
    tree.update(<Probe {...props} />);
  });
}

function emit(tables: HouseLedgerTableName[], householdId: string | null = HOUSEHOLD): void {
  act(() => {
    for (const listener of [...mockListeners]) {
      listener({ revision: 1, tables, householdId } as HouseLedgerChange);
    }
  });
}

function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  mockListeners = [];
  mockLocalFirst = true;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useHouseLedgerTables', () => {
  it('reloads when a watched table changes', () => {
    const onChange = jest.fn();
    render({ tables: ['gardenPlans'], onChange, householdId: HOUSEHOLD });

    emit(['gardenPlans']);
    expect(onChange).not.toHaveBeenCalled(); // still coalescing
    advance(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores a table it is not watching', () => {
    const onChange = jest.fn();
    render({ tables: ['gardenPlans'], onChange, householdId: HOUSEHOLD });

    emit(['tasks'] as HouseLedgerTableName[]);
    advance(200);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('COALESCES a burst into one reload', () => {
    // A sync run merges ops one at a time, so a peer adding a zone and six
    // features emits seven changes. Seven reloads of the same screen is the bug
    // this guards.
    const onChange = jest.fn();
    render({
      tables: ['gardenPlans', 'gardenPlanObjects'],
      onChange,
      householdId: HOUSEHOLD,
    });

    for (let i = 0; i < 7; i += 1) emit(['gardenPlanObjects']);
    advance(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload while editing, and re-checks at FIRE time', () => {
    // The destructive case. `objectDraft` and the boundary editor's corners are
    // unsaved work in component state; a reload replaces them with stored rows.
    // Re-checking at fire time matters because the member can open the editor
    // during the coalescing window — scheduling then firing blindly would still
    // wipe them.
    const onChange = jest.fn();
    const base = { tables: ['gardenPlans'] as HouseLedgerTableName[], onChange, householdId: HOUSEHOLD };
    const tree = render({ ...base, enabled: true });

    emit(['gardenPlans']);
    rerender(tree, { ...base, enabled: false }); // member opens the editor mid-window
    advance(200);
    expect(onChange).not.toHaveBeenCalled();

    // Closing the editor does not replay the missed change — the screen's own
    // save/focus path covers that — but the NEXT peer write lands.
    rerender(tree, { ...base, enabled: true });
    emit(['gardenPlans']);
    advance(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores a DIFFERENT property syncing in the background', () => {
    // H5 puts several properties on one device. A background one syncing must
    // not repaint the one being looked at.
    const onChange = jest.fn();
    render({ tables: ['gardenPlans'], onChange, householdId: HOUSEHOLD });

    emit(['gardenPlans'], 'hh_other');
    advance(200);
    expect(onChange).not.toHaveBeenCalled();

    emit(['gardenPlans'], HOUSEHOLD);
    advance(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('lets an unscoped change through', () => {
    // `householdId: null` on the change means "not property-scoped".
    const onChange = jest.fn();
    render({ tables: ['gardenPlans'], onChange, householdId: HOUSEHOLD });

    emit(['gardenPlans'], null);
    advance(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('subscribes to nothing when the household is not local-first', () => {
    // A remote household has no ledger; the engine must stay out of its way.
    mockLocalFirst = false;
    render({ tables: ['gardenPlans'], onChange: jest.fn(), householdId: HOUSEHOLD });
    expect(mockListeners).toHaveLength(0);
  });

  it('unsubscribes on unmount', () => {
    const tree = render({
      tables: ['gardenPlans'],
      onChange: jest.fn(),
      householdId: HOUSEHOLD,
    });
    expect(mockListeners).toHaveLength(1);
    act(() => {
      tree.unmount();
    });
    expect(mockListeners).toHaveLength(0);
  });

  it('does not resubscribe when the caller passes a fresh array literal', () => {
    // Every call site passes an inline `['gardenPlans', …]`. Without a stable
    // key that would resubscribe on every render, dropping the coalescing timer
    // each time and firing once per render instead of once per burst.
    const onChange = jest.fn();
    const tree = render({
      tables: ['gardenPlans', 'gardenPlanObjects'],
      onChange,
      householdId: HOUSEHOLD,
    });
    rerender(tree, {
      tables: ['gardenPlans', 'gardenPlanObjects'],
      onChange,
      householdId: HOUSEHOLD,
    });
    rerender(tree, {
      tables: ['gardenPlans', 'gardenPlanObjects'],
      onChange,
      householdId: HOUSEHOLD,
    });
    expect(mockListeners).toHaveLength(1);
  });
});
