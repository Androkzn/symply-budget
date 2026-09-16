/**
 * BR-044's list — and the two ways it can be quietly useless.
 *
 * The engine resolves a concurrent write by last-writer-wins and records what
 * it threw away on `ledger.conflicts`. That record is the ONLY trace the losing
 * edit ever existed: nothing is queued, nothing is retried, and the member who
 * typed it sees their value replaced on the next render. BR-044 exists because
 * a silent overwrite in a shared home is indistinguishable from data loss.
 *
 * So this component has two failure modes that are worse than a crash, because
 * both look like "no conflicts" — which is also what a healthy home looks like:
 *
 *  1. **Frozen at first render.** The conflict log is ENGINE state, not React
 *     state. Without a subscription the list shows whatever existed when the
 *     card mounted and never updates — so a conflict that arrives on the next
 *     sync is never shown to anyone. `useHouseLedgerRevision` exists for this,
 *     and the component's own header calls it out as "exactly the failure
 *     BR-044 is about".
 *  2. **Crashing to empty.** Every engine accessor throws when no session is
 *     open, and a card rendering before `ensureHouseLocalSession` finishes is
 *     the NORMAL case, not an edge one. Throwing there would take the sync card
 *     down with it; returning an empty list is the honest answer.
 *
 * Both are asserted below against a fake engine, because reproducing "a peer's
 * conflict arrives 30 seconds later" on a device needs two phones and a relay.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { LedgerConflict } from '@features/house/local/projection';

/** Mutable fake engine — the tests drive it like the real one drives the UI. */
let mockConflicts: LedgerConflict[] = [];
let mockRevision = 0;
let mockThrowOnRead = false;
const mockListeners = new Set<() => void>();

function mockBumpLedger(next: LedgerConflict[]) {
  mockConflicts = next;
  mockRevision += 1;
  mockListeners.forEach((l) => l());
}

jest.mock('@features/house/local/engine', () => ({
  __esModule: true,
  getLocalHouseLedger: () => {
    if (mockThrowOnRead) throw new Error('session not open');
    return { conflicts: mockConflicts };
  },
  getLocalHouseConflictsFor: () => {
    if (mockThrowOnRead) throw new Error('session not open');
    return mockConflicts;
  },
  getLocalHouseMemberId: () => {
    if (mockThrowOnRead) throw new Error('session not open');
    return 'member-self';
  },
  clearLocalHouseConflicts: jest.fn(),
  getHouseLedgerRevision: () => mockRevision,
  subscribeToHouseLedgerChanges: (cb: () => void) => {
    mockListeners.add(cb);
    return () => mockListeners.delete(cb);
  },
}));

import { HouseConflictList } from '../HouseConflictList';

function conflict(id: string, over: Partial<LedgerConflict> = {}): LedgerConflict {
  return {
    id,
    table: 'tasks',
    rowKey: `row_${id}`,
    field: 'title',
    kind: 'field_lww',
    winner: 'w',
    loser: 'l',
    loserMemberId: 'member-self',
    at: Date.now() - 60_000,
    ...over,
  } as LedgerConflict;
}

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<HouseConflictList />);
  });
  return tree;
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON() ?? {});
}

beforeEach(() => {
  mockConflicts = [];
  mockRevision = 0;
  mockThrowOnRead = false;
  mockListeners.clear();
});

describe('HouseConflictList — nothing to report', () => {
  it('renders nothing when no edit was discarded', () => {
    const tree = render();
    // A healthy home must not carry an empty "conflicts" heading around; the
    // presence of this list is itself the signal.
    expect(tree.toJSON()).toBeNull();
  });

  it('renders nothing — and does not throw — when the session is not open yet', () => {
    // The card mounts before `ensureHouseLocalSession` resolves on every cold
    // open. An exception here would take the whole Device sync card down.
    mockThrowOnRead = true;
    expect(() => render()).not.toThrow();
    expect(render().toJSON()).toBeNull();
  });
});

describe('HouseConflictList — reporting a discarded edit', () => {
  it('names what was replaced instead of counting silently', () => {
    mockConflicts = [conflict('c1')];
    const rendered = textOf(render());
    // The count alone tells a member something went wrong without telling them
    // what — the whole reason this list exists beside the count.
    expect(rendered).toMatch(/replaced/i);
    expect(rendered).toMatch(/task/i);
  });

  it('never renders a stamp, a table id or a row key', () => {
    mockConflicts = [conflict('c1')];
    const rendered = textOf(render());
    for (const leak of ['row_c1', '"tasks"', 'winner', 'loser']) {
      expect(rendered).not.toContain(leak);
    }
  });
});

describe('HouseConflictList — the frozen-list failure BR-044 is about', () => {
  it('picks up a conflict that arrives AFTER mount', () => {
    // This is the assertion that matters. Mount clean, then let a peer's
    // conflict land the way it does on a real sync. A component reading engine
    // state without `useHouseLedgerRevision` renders null forever here and no
    // member is ever told their edit was overwritten.
    const tree = render();
    expect(tree.toJSON()).toBeNull();

    act(() => {
      mockBumpLedger([conflict('late-1')]);
    });

    expect(tree.toJSON()).not.toBeNull();
    expect(textOf(tree)).toMatch(/replaced/i);
  });

  it('stops reporting once the log is cleared', () => {
    mockConflicts = [conflict('c1')];
    const tree = render();
    expect(tree.toJSON()).not.toBeNull();

    act(() => {
      mockBumpLedger([]);
    });
    expect(tree.toJSON()).toBeNull();
  });

  it('unsubscribes on unmount rather than leaking a listener per mount', () => {
    const tree = render();
    expect(mockListeners.size).toBeGreaterThan(0);
    act(() => {
      tree.unmount();
    });
    expect(mockListeners.size).toBe(0);
  });
});
