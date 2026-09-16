/**
 * H7-lite — App Group widget/watch projection (plan §9, N4).
 *
 * The widget extension holds no DEK and cannot be unit-tested from here, so the
 * thing worth testing is precisely what crosses the boundary out of the
 * encrypted ledger: **which fields**, in **what order**, **when**, and that it
 * is **wiped**. The field allowlist is asserted as an exact key set rather than
 * with `not.toHaveProperty` spot checks — a future column added to the 58-column
 * `tasks` row must fail this test rather than quietly land in plaintext.
 *
 * Static imports throughout (plan §6.2: `await import()` throws under this Jest
 * config).
 */
import { watchSyncService } from '@services/watch-sync';
import { widgetSync } from '@services/widget-sync';

import type { HouseLedger, HouseLedgerChange } from '../engine';
import {
  HOUSE_WIDGET_TASK_FIELDS,
  HOUSE_WIDGET_TASK_LIMIT,
  clearHouseWidgetProjection,
  flushHouseWidgetProjection,
  getHouseWidgetProjectionCopy,
  projectHouseWidgetTasks,
  publishHouseWidgetProjection,
  startHouseWidgetProjection,
  stopHouseWidgetProjection,
} from '../reminders/widgetProjection';
import type { LocalTask } from '../types';

jest.mock('@services/widget-sync', () => ({
  widgetSync: { setTasks: jest.fn(), isAvailable: jest.fn(() => true), clear: jest.fn() },
}));

jest.mock('@services/watch-sync', () => ({
  watchSyncService: { syncTasks: jest.fn().mockResolvedValue(undefined) },
}));

// --- engine stand-in --------------------------------------------------------

const HOUSEHOLD = 'hh_1';
let mockSessionOpen = true;
let mockActiveHouseholdId: string | null = HOUSEHOLD;
let mockCurrentLedger: Pick<HouseLedger, 'household' | 'tasks'>;
let mockListener: ((change: HouseLedgerChange) => void) | null = null;

jest.mock('../flag', () => ({ isHouseLocalFirst: () => true }));

jest.mock('../engine', () => ({
  isLocalHouseSessionOpen: () => mockSessionOpen,
  getLocalHouseLedger: () => mockCurrentLedger,
  getActiveHouseholdId: () => mockActiveHouseholdId,
  subscribeToHouseLedgerChanges: (fn: (change: HouseLedgerChange) => void) => {
    mockListener = fn;
    return () => {
      mockListener = null;
    };
  },
}));

const setTasks = widgetSync.setTasks as jest.Mock;
const syncTasks = watchSyncService.syncTasks as jest.Mock;
const isAvailable = widgetSync.isAvailable as jest.Mock;

// --- fixtures ---------------------------------------------------------------

const NOW = new Date('2026-08-13T12:00:00.000Z');

function task(id: string, overrides: Partial<LocalTask> = {}): LocalTask {
  return {
    id,
    household_id: HOUSEHOLD,
    system_category: 'hvac',
    title: `Task ${id}`,
    description: 'Sensitive free text the widget must never see',
    frequency: 'monthly',
    custom_interval_days: null,
    next_due_date: '2026-09-01',
    last_completed_at: null,
    assigned_to: { id: 'u1', display_name: 'Alex' },
    space_id: 'space-1',
    is_active: true,
    source: 'manual',
    priority_severity: 'medium',
    ai_rationale: 'Also sensitive',
    reminder_enabled: true,
    reminder_days_before: 3,
    reminder_time: '09:00',
    reminder_repeat: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Only `household.id` and `tasks` are read, so the rest of the row is not built. */
function ledgerOf(tasks: LocalTask[]): Pick<HouseLedger, 'household' | 'tasks'> {
  return { household: { id: HOUSEHOLD } as HouseLedger['household'], tasks };
}

function change(overrides: Partial<HouseLedgerChange> = {}): HouseLedgerChange {
  return { revision: 1, tables: ['tasks'], householdId: HOUSEHOLD, ...overrides };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  isAvailable.mockReturnValue(true);
  mockSessionOpen = true;
  mockActiveHouseholdId = HOUSEHOLD;
  mockCurrentLedger = ledgerOf([task('t1')]);
  mockListener = null;
  // The module dedupes against the last payload it wrote; reset that so each
  // test starts from "nothing has been published".
  clearHouseWidgetProjection();
  jest.clearAllMocks();
});

afterEach(() => {
  stopHouseWidgetProjection();
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('projectHouseWidgetTasks — the plaintext that leaves the ledger', () => {
  it('projects exactly the allowlisted fields and nothing else', () => {
    const [projected] = projectHouseWidgetTasks(ledgerOf([task('t1')]), NOW);

    expect(Object.keys(projected).sort()).toEqual([...HOUSE_WIDGET_TASK_FIELDS].sort());
    // Named explicitly because these are the fields a leak would actually hurt.
    expect(JSON.stringify(projected)).not.toContain('Sensitive free text');
    expect(JSON.stringify(projected)).not.toContain('Also sensitive');
    expect(JSON.stringify(projected)).not.toContain('Alex');
  });

  it('drops inactive tasks so they cannot occupy a slot', () => {
    const projected = projectHouseWidgetTasks(
      ledgerOf([task('t1', { is_active: false }), task('t2')]),
      NOW,
    );
    expect(projected.map((entry) => entry.id)).toEqual(['t2']);
  });

  it('puts overdue first, then soonest due, then priority, then id', () => {
    const projected = projectHouseWidgetTasks(
      ledgerOf([
        task('soon', { next_due_date: '2026-08-20' }),
        task('overdue-recent', { next_due_date: '2026-08-10' }),
        task('overdue-old', { next_due_date: '2026-01-02' }),
        task('same-day-low', { next_due_date: '2026-08-20', priority_severity: 'low' }),
        task('same-day-critical', { next_due_date: '2026-08-20', priority_severity: 'critical' }),
      ]),
      NOW,
    );

    expect(projected.map((entry) => entry.id)).toEqual([
      'overdue-old',
      'overdue-recent',
      'same-day-critical',
      'soon',
      'same-day-low',
    ]);
  });

  it('sorts undated tasks last rather than treating null as the epoch', () => {
    const projected = projectHouseWidgetTasks(
      ledgerOf([task('undated', { next_due_date: null }), task('dated')]),
      NOW,
    );
    expect(projected.map((entry) => entry.id)).toEqual(['dated', 'undated']);
  });

  it('caps the slice at the widget limit', () => {
    const tasks = Array.from({ length: 60 }, (_, i) =>
      task(`t${String(i).padStart(2, '0')}`, { next_due_date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    expect(projectHouseWidgetTasks(ledgerOf(tasks), NOW)).toHaveLength(HOUSE_WIDGET_TASK_LIMIT);
  });
});

describe('publishHouseWidgetProjection — two channels, one slice', () => {
  it('writes the same payload to the App Group and over WatchConnectivity', () => {
    const published = publishHouseWidgetProjection(NOW);

    expect(published).not.toBeNull();
    expect(setTasks).toHaveBeenCalledTimes(1);
    expect(syncTasks).toHaveBeenCalledTimes(1);
    expect(setTasks.mock.calls[0][0]).toEqual(syncTasks.mock.calls[0][0]);
    expect(setTasks.mock.calls[0][0][0].id).toBe('t1');
  });

  it('does not re-write an unchanged slice — a catch-up is ~98 ledger bumps', () => {
    publishHouseWidgetProjection(NOW);
    publishHouseWidgetProjection(NOW);

    expect(setTasks).toHaveBeenCalledTimes(1);
    expect(syncTasks).toHaveBeenCalledTimes(1);
  });

  it('publishes again once the slice actually changes', () => {
    publishHouseWidgetProjection(NOW);
    mockCurrentLedger = ledgerOf([task('t1'), task('t2')]);
    publishHouseWidgetProjection(NOW);

    expect(setTasks).toHaveBeenCalledTimes(2);
    expect(setTasks.mock.calls[1][0]).toHaveLength(2);
  });

  it('writes nothing when no local session is open', () => {
    mockSessionOpen = false;
    expect(publishHouseWidgetProjection(NOW)).toBeNull();
    expect(setTasks).not.toHaveBeenCalled();
    expect(syncTasks).not.toHaveBeenCalled();
  });
});

describe('clearHouseWidgetProjection — wipe on logout', () => {
  it('empties both surfaces and forgets the dedupe cache', () => {
    publishHouseWidgetProjection(NOW);
    setTasks.mockClear();
    syncTasks.mockClear();

    clearHouseWidgetProjection();

    expect(setTasks).toHaveBeenCalledWith([]);
    expect(syncTasks).toHaveBeenCalledWith([]);

    // Re-publishing the identical ledger must write again: if the dedupe cache
    // survived the wipe, a sign-in on the same device would leave the widget
    // empty until something in the ledger happened to change.
    publishHouseWidgetProjection(NOW);
    expect(setTasks).toHaveBeenCalledTimes(2);
  });
});

describe('startHouseWidgetProjection — following the ledger', () => {
  it('publishes immediately so a cold, never-opened launch is already correct', () => {
    startHouseWidgetProjection();
    expect(setTasks).toHaveBeenCalledTimes(1);
  });

  it('republishes on a debounced tasks change', () => {
    startHouseWidgetProjection();
    setTasks.mockClear();

    mockCurrentLedger = ledgerOf([task('t1'), task('t2')]);
    mockListener?.(change());
    mockListener?.(change({ revision: 2 }));
    expect(setTasks).not.toHaveBeenCalled();

    jest.advanceTimersByTime(600);
    expect(setTasks).toHaveBeenCalledTimes(1);
  });

  it('ignores changes that did not touch tasks', () => {
    startHouseWidgetProjection();
    setTasks.mockClear();

    mockCurrentLedger = ledgerOf([task('t1'), task('t2')]);
    mockListener?.(change({ tables: ['appliances', 'settings'] }));
    jest.advanceTimersByTime(600);

    expect(setTasks).not.toHaveBeenCalled();
  });

  it('ignores a background property syncing — the widget shows the active home', () => {
    startHouseWidgetProjection();
    setTasks.mockClear();

    mockCurrentLedger = ledgerOf([task('t1'), task('t2')]);
    mockListener?.(change({ householdId: 'hh_other' }));
    jest.advanceTimersByTime(600);

    expect(setTasks).not.toHaveBeenCalled();
  });

  it('treats a session-level bump (no tables) as a reason to republish', () => {
    startHouseWidgetProjection();
    setTasks.mockClear();

    mockCurrentLedger = ledgerOf([task('t1'), task('t2')]);
    mockListener?.(change({ tables: [] }));
    jest.advanceTimersByTime(600);

    expect(setTasks).toHaveBeenCalledTimes(1);
  });

  it('flush skips the debounce and stop detaches the mockListener', () => {
    startHouseWidgetProjection();
    setTasks.mockClear();

    mockCurrentLedger = ledgerOf([task('t1'), task('t2')]);
    mockListener?.(change());
    flushHouseWidgetProjection();
    expect(setTasks).toHaveBeenCalledTimes(1);

    // The debounce must not fire a second time after the flush consumed it.
    jest.advanceTimersByTime(600);
    expect(setTasks).toHaveBeenCalledTimes(1);

    stopHouseWidgetProjection();
    expect(mockListener).toBeNull();
  });
});

describe('member-facing copy', () => {
  it('discloses the projection when the widget is present', () => {
    isAvailable.mockReturnValue(true);
    const copy = getHouseWidgetProjectionCopy();
    expect(copy.message).toMatch(/never on our servers/i);
  });

  it('states the widget is dark rather than showing an unexplained empty', () => {
    isAvailable.mockReturnValue(false);
    const copy = getHouseWidgetProjectionCopy();
    expect(copy.title).toMatch(/off on this build/i);
  });
});
