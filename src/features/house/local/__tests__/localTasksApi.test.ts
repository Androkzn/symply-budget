/**
 * `localTasksApi` against a REAL in-memory session (plan §6, DoD H3).
 *
 * Everything here runs through `openLocalHouseSession` — the same engine, op
 * journal, per-row AEAD and projection replay the app uses; under Jest the store
 * falls back to `MemoryLocalFirstStore` and the DEK to a module variable, so no
 * native module is involved and nothing is stubbed. Testing the facade against a
 * mocked ledger would certify a ledger nobody ships.
 *
 * Static imports only: `await import()` throws under this Jest config without
 * `--experimental-vm-modules` (plan §6.2).
 */
import {
  getLocalHouseLedger,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnsupportedError } from '../errors';
import { newLocalId } from '../ids';
import { localTasksApi } from '../localTasksApi';
import type { LocalTask } from '../types';
import { getHouseUnsupportedCopy } from '../unsupportedCopy';

const USER = 'user-house-tasks';
let HID = '';

/** A fresh property with an empty task table before every test. */
async function freshSession(): Promise<string> {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Task test home' });
  return ledger.household.id;
}

const opCount = () => getLocalHouseLedger().ops.length;

/** Create a task with the fields a test cares about, defaults for the rest. */
async function makeTask(overrides: Partial<Parameters<typeof localTasksApi.create>[1]> = {}) {
  const result = await localTasksApi.create(HID, {
    title: 'Clean the gutters',
    frequency: 'monthly',
    ...overrides,
  });
  return result.task;
}

/**
 * Push a raw row straight into the ledger. Used only where the facade cannot
 * produce the state under test — a row authored by ANOTHER member, which is
 * what a synced peer's write looks like on this device.
 */
async function seedTaskRow(row: Partial<LocalTask> & { id: string }): Promise<void> {
  await mutateLocalHouseLedger(
    (ledger) => {
      ledger.tasks.push({
        household_id: HID,
        system_category: null,
        title: 'Seeded',
        description: null,
        frequency: 'one_time',
        custom_interval_days: null,
        next_due_date: null,
        last_completed_at: null,
        assigned_to: null,
        space_id: null,
        is_active: true,
        source: 'manual',
        priority_severity: 'nice_to_have',
        reminder_enabled: true,
        reminder_days_before: 1,
        reminder_time: '09:00',
        reminder_repeat: true,
        created_by: USER,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...row,
      } as LocalTask);
    },
    { opType: 'TEST_SEED', entityType: 'task', entityId: row.id, payload: {} },
  );
}

beforeEach(async () => {
  HID = await freshSession();
});

afterAll(async () => {
  await resetLocalHouseSession();
});

// ---------------------------------------------------------------------------

// Method parity against `tasksApi` is enforced once, for all ten Wave-A
// modules, in `apiParity.test.ts` — including the declared remote-only escape
// hatch this suite has no business duplicating.

describe('create / get', () => {
  it('round-trips a task through the ledger', async () => {
    const created = await makeTask({ title: 'Change furnace filter', frequency: 'quarterly' });
    const { task } = await localTasksApi.get(HID, created.id);

    expect(task.title).toBe('Change furnace filter');
    expect(task.frequency).toBe('quarterly');
    expect(task.is_active).toBe(true);
    expect(task.created_by).toBe(USER);
    // The row is the DTO — no `household_id` leaks into what a screen renders.
    expect(task).not.toHaveProperty('household_id');
  });

  it('applies the server defaults field for field', async () => {
    const task = await makeTask();
    expect(task.priority_severity).toBe('nice_to_have');
    expect(task.source).toBe('manual');
    expect(task.reminder_enabled).toBe(true);
    expect(task.reminder_days_before).toBe(1);
    expect(task.reminder_time).toBe('09:00');
    expect(task.reminder_repeat).toBe(true);
    expect(task.is_personal).toBe(false);
    expect(task.enrichment_status).toBeNull();
  });

  it('writes exactly one op per create', async () => {
    const before = opCount();
    await makeTask();
    expect(opCount()).toBe(before + 1);
  });

  it('resolves an assignee to the {id, display_name} object screens expect', async () => {
    await mutateLocalHouseLedger(
      (ledger) => {
        ledger.householdMembers.push({
          id: 'hm_1',
          household_id: HID,
          user_id: 'partner-1',
          display_name: 'Mira',
          avatar_url: null,
          email: 'mira@example.com',
          role: 'member',
          joined_at: '2026-01-01T00:00:00.000Z',
        });
      },
      { opType: 'TEST_MEMBER', entityType: 'member', entityId: 'hm_1', payload: {} },
    );

    const task = await makeTask({ assigned_to: 'partner-1' });
    expect(task.assigned_to).toEqual({ id: 'partner-1', display_name: 'Mira' });
  });

  it('keeps an assignment whose member row has not synced yet', async () => {
    // The server LEFT JOINs `users` and drops the whole object when absent.
    // Locally the id IS ledger data, so it degrades to nameless, not unassigned.
    const task = await makeTask({ assigned_to: 'not-synced-yet' });
    expect(task.assigned_to).toEqual({ id: 'not-synced-yet', display_name: null });
  });

  it('throws for a task in another property or a missing one', async () => {
    const task = await makeTask();
    await expect(localTasksApi.get('hh_other', task.id)).rejects.toThrow(
      'Maintenance task not found',
    );
    await expect(localTasksApi.get(HID, 'task_nope')).rejects.toThrow('Maintenance task not found');
  });
});

describe('quickCreate', () => {
  it('captures the raw text instantly, trimmed and collapsed', async () => {
    const { task } = await localTasksApi.quickCreate(HID, {
      text: '  the   deck  needs staining  ',
    });
    expect(task.title).toBe('the deck needs staining');
    expect(task.source).toBe('ai_generated');
    expect(task.frequency).toBe('one_time');
    expect(task.priority_severity).toBe('medium');
  });

  it("marks enrichment 'failed', reusing the server's own no-queue fallback", async () => {
    // Never 'pending': the task cards poll on pending/enriching and there is no
    // enrichment worker offline, so the card would spin forever.
    const { task } = await localTasksApi.quickCreate(HID, { text: 'fix the fence' });
    expect(task.enrichment_status).toBe('failed');
  });

  it('falls back to a title when the capture is empty', async () => {
    const { task } = await localTasksApi.quickCreate(HID, { text: '   ' });
    expect(task.title).toBe('New task');
  });
});

describe('list', () => {
  it('sorts by next_due_date DESC with undated tasks last, as SQLite does', async () => {
    await makeTask({ title: 'early', next_due_date: '2026-02-01' });
    await makeTask({ title: 'late', next_due_date: '2026-09-01' });
    await makeTask({ title: 'undated' });

    const { tasks } = await localTasksApi.list(HID);
    expect(tasks.map((t) => t.title)).toEqual(['late', 'early', 'undated']);
  });

  it('caps the default page at 20 and hands back a cursor', async () => {
    for (let i = 0; i < 25; i += 1) {
       
      await seedTaskRow({ id: `task_${i}`, created_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` });
    }
    const page = await localTasksApi.list(HID);
    expect(page.tasks).toHaveLength(20);
    expect(page.next_cursor).toBeDefined();

    // The cursor compares created_at while the sort is next_due_date — the
    // server's own incoherence, reproduced so page boundaries match it.
    const second = await localTasksApi.list(HID, { cursor: '2026-01-06T00:00:00.000Z' });
    expect(second.tasks).toHaveLength(5);
    expect(second.next_cursor).toBeUndefined();
  });

  it('filters by system_category and is_active', async () => {
    await makeTask({ title: 'hvac', system_category: 'hvac' });
    await makeTask({ title: 'plumbing', system_category: 'plumbing' });
    const inactive = await makeTask({ title: 'retired' });
    await localTasksApi.update(HID, inactive.id, { is_active: false });

    expect((await localTasksApi.list(HID, { system_category: 'hvac' })).tasks).toHaveLength(1);
    expect((await localTasksApi.list(HID, { is_active: false })).tasks.map((t) => t.title)).toEqual([
      'retired',
    ]);
  });

  it('hides another member’s personal task', async () => {
    await seedTaskRow({ id: 'task_mine', title: 'mine', is_personal: true, created_by: USER });
    await seedTaskRow({
      id: 'task_theirs',
      title: 'theirs',
      is_personal: true,
      created_by: 'partner-1',
    });

    const { tasks } = await localTasksApi.list(HID);
    expect(tasks.map((t) => t.title)).toEqual(['mine']);
    // …and it is not reachable by id either.
    await expect(localTasksApi.get(HID, 'task_theirs')).rejects.toThrow(
      'Maintenance task not found',
    );
  });

  it('does not compose subtasks into the list DTO', async () => {
    const task = await makeTask();
    await localTasksApi.createSubtask(HID, task.id, { title: 'step 1' });
    const { tasks } = await localTasksApi.list(HID);
    expect(tasks[0]!.subtasks).toBeUndefined();
    expect(tasks[0]!.subtask_progress).toBeUndefined();
  });
});

describe('getUpcoming', () => {
  const isoDaysFromNow = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().split('T')[0]!;

  it('includes overdue, excludes beyond the horizon and undated', async () => {
    await makeTask({ title: 'overdue', next_due_date: isoDaysFromNow(-10) });
    await makeTask({ title: 'soon', next_due_date: isoDaysFromNow(3) });
    await makeTask({ title: 'far', next_due_date: isoDaysFromNow(40) });
    await makeTask({ title: 'undated' });

    const { tasks } = await localTasksApi.getUpcoming(HID, 7);
    expect(tasks.map((t) => t.title)).toEqual(['overdue', 'soon']);
  });

  it('excludes inactive tasks', async () => {
    const task = await makeTask({ next_due_date: isoDaysFromNow(1) });
    await localTasksApi.update(HID, task.id, { is_active: false });
    expect((await localTasksApi.getUpcoming(HID, 7)).tasks).toHaveLength(0);
  });

  it('widens with the days argument', async () => {
    await makeTask({ title: 'far', next_due_date: isoDaysFromNow(20) });
    expect((await localTasksApi.getUpcoming(HID, 7)).tasks).toHaveLength(0);
    expect((await localTasksApi.getUpcoming(HID, 30)).tasks).toHaveLength(1);
  });
});

describe('update', () => {
  it('writes only the keys the caller sent', async () => {
    const created = await makeTask({ description: 'ladder required', next_due_date: '2026-05-01' });
    await localTasksApi.update(HID, created.id, { title: 'Clean gutters (front)' });

    const { task } = await localTasksApi.get(HID, created.id);
    expect(task.title).toBe('Clean gutters (front)');
    // Untouched fields survive — LWW is per field, so a blanket write would beat
    // a peer's concurrent edit with a value this edit never meant to set.
    expect(task.description).toBe('ladder required');
    expect(task.next_due_date).toBe('2026-05-01');
  });

  it('unassigns when assigned_to is explicitly null', async () => {
    const created = await makeTask({ assigned_to: 'partner-1' });
    await localTasksApi.update(HID, created.id, { assigned_to: null });
    expect((await localTasksApi.get(HID, created.id)).task.assigned_to).toBeNull();
  });

  it('bumps updated_at', async () => {
    const created = await makeTask();
    await localTasksApi.update(HID, created.id, { title: 'renamed' });
    const { task } = await localTasksApi.get(HID, created.id);
    expect(task.updated_at >= created.updated_at).toBe(true);
  });
});

describe('delete', () => {
  it('tombstones the task and leaves its children alone', async () => {
    const task = await makeTask();
    await localTasksApi.createSubtask(HID, task.id, { title: 'step 1' });
    await localTasksApi.delete(HID, task.id);

    expect((await localTasksApi.list(HID)).tasks).toHaveLength(0);
    expect(getLocalHouseLedger().lww?.tasks?.[task.id]?.del).toBeDefined();
    // The server soft-deletes only the task row; orphaned children are the
    // state it ships, so the two implementations agree on what a restore sees.
    expect(getLocalHouseLedger().maintenanceSubtasks).toHaveLength(1);
  });
});

describe('complete', () => {
  it('rolls a recurring task forward and records the completion', async () => {
    const task = await makeTask({ frequency: 'monthly', next_due_date: '2026-05-01' });
    const result = await localTasksApi.complete(HID, task.id, { notes: 'took 20 minutes' });

    expect(result.completion.notes).toBe('took 20 minutes');
    expect(result.task.last_completed_at).toBe(result.completion.completed_at);
    // 30 days from NOW, not one calendar month from the old due date — see
    // logic/recurrence.ts on why the completion path uses fixed intervals.
    const rolled = new Date(result.task.next_due_date!).getTime();
    expect(Math.round((rolled - Date.now()) / 86_400_000)).toBe(30);
  });

  it('clears next_due_date for a one-time task instead of throwing', async () => {
    const task = await makeTask({ frequency: 'one_time', next_due_date: '2026-05-01' });
    const result = await localTasksApi.complete(HID, task.id, {});
    expect(result.task.next_due_date).toBeNull();
  });

  it('reopens every subtask when a recurring task starts its next cycle', async () => {
    const task = await makeTask({ frequency: 'weekly' });
    const a = await localTasksApi.createSubtask(HID, task.id, { title: 'a' });
    const b = await localTasksApi.createSubtask(HID, task.id, { title: 'b' });
    await localTasksApi.completeSubtask(HID, task.id, a.id);

    await localTasksApi.complete(HID, task.id, {});
    const subtasks = await localTasksApi.listSubtasks(HID, task.id);
    expect(subtasks.map((s) => s.is_completed)).toEqual([false, false]);
    expect(subtasks.find((s) => s.id === b.id)!.completed_at).toBeNull();
  });

  it('leaves subtasks completed for a one-time task', async () => {
    const task = await makeTask({ frequency: 'one_time' });
    const sub = await localTasksApi.createSubtask(HID, task.id, { title: 'a' });
    await localTasksApi.completeSubtask(HID, task.id, sub.id);

    await localTasksApi.complete(HID, task.id, {});
    expect((await localTasksApi.listSubtasks(HID, task.id))[0]!.is_completed).toBe(true);
  });

  it('writes the completion, the roll and the reset as ONE op', async () => {
    const task = await makeTask({ frequency: 'weekly' });
    await localTasksApi.createSubtask(HID, task.id, { title: 'a' });
    const before = opCount();
    await localTasksApi.complete(HID, task.id, {});
    expect(opCount()).toBe(before + 1);
  });

  it('carries photo keys onto the completion row', async () => {
    const task = await makeTask();
    const result = await localTasksApi.complete(HID, task.id, { photo_keys: ['k1', 'k2'] });
    const history = await localTasksApi.getHistory(HID, task.id);
    expect(history.completions[0]!.photo_keys).toEqual(['k1', 'k2']);
    expect(history.completions[0]!.id).toBe(result.completion.id);
  });
});

describe('getHistory', () => {
  it('returns completions newest-first and paginates on completed_at', async () => {
    const task = await makeTask({ frequency: 'daily' });
    await mutateLocalHouseLedger(
      (ledger) => {
        for (let i = 0; i < 3; i += 1) {
          ledger.maintenanceCompletions.push({
            id: `mc_${i}`,
            household_id: HID,
            task_id: task.id,
            completed_by: { id: USER, display_name: null },
            completed_at: `2026-0${i + 1}-01T00:00:00.000Z`,
            notes: `run ${i}`,
            photo_keys: [],
          });
        }
      },
      { opType: 'TEST_SEED', entityType: 'completion', entityId: 'mc_bulk', payload: {} },
    );

    const all = await localTasksApi.getHistory(HID, task.id);
    expect(all.completions.map((c) => c.notes)).toEqual(['run 2', 'run 1', 'run 0']);

    const paged = await localTasksApi.getHistory(HID, task.id, { limit: 2 });
    expect(paged.completions).toHaveLength(2);
    expect(paged.next_cursor).toBe('2026-02-01T00:00:00.000Z');

    const next = await localTasksApi.getHistory(HID, task.id, { cursor: paged.next_cursor });
    expect(next.completions.map((c) => c.notes)).toEqual(['run 0']);
  });

  it('404s before the history query when the task is gone', async () => {
    await expect(localTasksApi.getHistory(HID, 'task_nope')).rejects.toThrow(
      'Maintenance task not found',
    );
  });
});

describe('blockers and the activity feed', () => {
  it('blocks a task and files the reason in the same op', async () => {
    const task = await makeTask();
    const before = opCount();
    const result = await localTasksApi.reportBlocker(HID, task.id, 'waiting on the part');

    expect(opCount()).toBe(before + 1);
    expect(result.task.blocked).toBe(true);
    expect(result.task.blocker_reason).toBe('waiting on the part');
    expect(result.task.blocked_by).toEqual({ id: USER, display_name: null });

    const notes = await localTasksApi.listNotes(HID, task.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'blocker', body: 'waiting on the part' });
  });

  it('unblocks with the server’s default resolution copy', async () => {
    const task = await makeTask();
    await localTasksApi.reportBlocker(HID, task.id, 'waiting');
    const result = await localTasksApi.resolveBlocker(HID, task.id);

    expect(result.task.blocked).toBe(false);
    expect(result.task.blocker_reason).toBeNull();
    expect(result.task.blocked_at).toBeNull();
    expect((await localTasksApi.listNotes(HID, task.id))[0]).toMatchObject({
      kind: 'resolution',
      body: 'Blocker resolved',
    });
  });

  it('truncates a blocker reason at the column width', async () => {
    const task = await makeTask();
    const result = await localTasksApi.reportBlocker(HID, task.id, 'x'.repeat(1500));
    expect(result.task.blocker_reason).toHaveLength(1000);
  });

  it('lists notes newest first and refuses an empty body', async () => {
    const task = await makeTask();
    await localTasksApi.addNote(HID, task.id, 'first');
    await localTasksApi.addNote(HID, task.id, 'second');

    const notes = await localTasksApi.listNotes(HID, task.id);
    expect(notes.map((n) => n.body)).toEqual(['second', 'first']);
    expect(notes[0]!.author).toEqual({ id: USER, display_name: null });
    expect(notes[0]).not.toHaveProperty('task_id');

    await expect(localTasksApi.addNote(HID, task.id, '   ')).rejects.toThrow(
      'Note body is required',
    );
  });
});

describe('purchase suggestion', () => {
  it('clears the chip on dismiss', async () => {
    const id = newLocalId('task');
    await seedTaskRow({
      id,
      purchase_suggestion: {
        state: 'actionable',
        title: 'Looks like a purchase',
        subtitle: null,
        amount_label: null,
        action_label: 'Add',
      },
    });
    const result = await localTasksApi.dismissPurchaseSuggestion(HID, id);
    expect(result.task.purchase_suggestion).toBeNull();
  });
});

describe('workflow stage', () => {
  it('records a selected quote and its stage together', async () => {
    const task = await makeTask();
    const result = await localTasksApi.selectTaskQuote(HID, task.id, { quote_id: 'q_1' });
    expect(result.task.selected_quote_id).toBe('q_1');
    expect(result.task.workflow_stage).toBe('quote_selected');
  });

  it('sets a stage the union allows', async () => {
    const task = await makeTask();
    const result = await localTasksApi.updateWorkflowStage(HID, task.id, {
      workflow_stage: 'in_progress',
    });
    expect(result.task.workflow_stage).toBe('in_progress');
  });

  it('refuses a stage outside the union', async () => {
    // Stricter than the server on purpose — a bad stage in the ledger is an
    // LWW-merged row on every device, with no operator and no UPDATE to fix it.
    const task = await makeTask();
    await expect(
      localTasksApi.updateWorkflowStage(HID, task.id, { workflow_stage: 'almost_done' }),
    ).rejects.toThrow('Unknown task workflow stage: almost_done');
  });

  it('allows any ordering, because the server enforces none', async () => {
    const task = await makeTask();
    await localTasksApi.updateWorkflowStage(HID, task.id, { workflow_stage: 'completed' });
    const result = await localTasksApi.updateWorkflowStage(HID, task.id, {
      workflow_stage: 'planning',
    });
    expect(result.task.workflow_stage).toBe('planning');
  });

  it('schedules work, leaving times the caller omitted untouched', async () => {
    const task = await makeTask();
    await localTasksApi.scheduleTaskWork(HID, task.id, {
      scheduled_date: '2026-06-01',
      scheduled_time_start: '08:00',
      scheduled_time_end: '12:00',
    });
    const partial = await localTasksApi.scheduleTaskWork(HID, task.id, {
      scheduled_date: '2026-06-02',
    });

    expect(partial.task.scheduled_work_date).toBe('2026-06-02');
    expect(partial.task.workflow_stage).toBe('scheduled');
    // The server passes `undefined` straight through to Drizzle, which leaves
    // the column alone — clearing it would drop a time the member had picked.
    expect(partial.task.scheduled_work_time_start).toBe('08:00');
    expect(partial.task.scheduled_work_time_end).toBe('12:00');
  });
});

describe('subtasks', () => {
  it('appends to the end of the list', async () => {
    const task = await makeTask();
    const a = await localTasksApi.createSubtask(HID, task.id, { title: 'first' });
    const b = await localTasksApi.createSubtask(HID, task.id, { title: 'second' });
    expect([a.sort_order, b.sort_order]).toEqual([0, 1]);
  });

  it('re-derives an EXPLICIT sort_order of 0, as the server does', async () => {
    const task = await makeTask();
    await localTasksApi.createSubtask(HID, task.id, { title: 'first' });
    const b = await localTasksApi.createSubtask(HID, task.id, { title: 'second', sort_order: 0 });
    // Not 0 — `sort_order === 0 || undefined` both take the max+1 branch, so no
    // caller can currently insert at the front.
    expect(b.sort_order).toBe(1);
  });

  it('honours a non-zero explicit sort_order', async () => {
    const task = await makeTask();
    const sub = await localTasksApi.createSubtask(HID, task.id, { title: 'x', sort_order: 7 });
    expect(sub.sort_order).toBe(7);
  });

  it('anchors a reminder to the parent due date', async () => {
    const task = await makeTask({ next_due_date: '2026-05-10T00:00:00.000Z' });
    const sub = await localTasksApi.createSubtask(HID, task.id, {
      title: 'x',
      reminder_enabled: true,
      reminder_days_before: 3,
    });
    expect(sub.reminder_date).toBe('2026-05-07T00:00:00.000Z');
  });

  it('validates title, description and reminder settings', async () => {
    const task = await makeTask();
    await expect(localTasksApi.createSubtask(HID, task.id, { title: '  ' })).rejects.toThrow(
      'Subtask title is required',
    );
    await expect(
      localTasksApi.createSubtask(HID, task.id, { title: 'x'.repeat(501) }),
    ).rejects.toThrow('cannot exceed 500 characters');
    await expect(
      localTasksApi.createSubtask(HID, task.id, { title: 'x', description: 'y'.repeat(2001) }),
    ).rejects.toThrow('cannot exceed 2000 characters');
    await expect(
      localTasksApi.createSubtask(HID, task.id, { title: 'x', reminder_days_before: 400 }),
    ).rejects.toThrow('between 0 and 365');
    await expect(
      localTasksApi.createSubtask(HID, task.id, { title: 'x', reminder_time: '25:00' }),
    ).rejects.toThrow('HH:MM format');
  });

  it('recomputes reminder_date only when the reminder settings moved', async () => {
    const task = await makeTask({ next_due_date: '2026-05-10T00:00:00.000Z' });
    const sub = await localTasksApi.createSubtask(HID, task.id, {
      title: 'x',
      reminder_enabled: true,
      reminder_days_before: 3,
    });

    const renamed = await localTasksApi.updateSubtask(HID, task.id, sub.id, { title: 'y' });
    expect(renamed.reminder_date).toBe('2026-05-07T00:00:00.000Z');

    const rescheduled = await localTasksApi.updateSubtask(HID, task.id, sub.id, {
      reminder_days_before: 1,
    });
    expect(rescheduled.reminder_date).toBe('2026-05-09T00:00:00.000Z');

    const off = await localTasksApi.updateSubtask(HID, task.id, sub.id, {
      reminder_enabled: false,
    });
    expect(off.reminder_date).toBeNull();
  });

  it('completes and uncompletes, refusing the redundant call', async () => {
    const task = await makeTask();
    const sub = await localTasksApi.createSubtask(HID, task.id, { title: 'x' });

    const done = await localTasksApi.completeSubtask(HID, task.id, sub.id);
    expect(done.subtask.is_completed).toBe(true);
    expect(done.subtask.completed_by).toEqual({ id: USER, display_name: null });
    expect(done.task.subtask_progress).toEqual({ completed: 1, total: 1, percentage: 100 });

    await expect(localTasksApi.completeSubtask(HID, task.id, sub.id)).rejects.toThrow(
      'already completed',
    );

    const undone = await localTasksApi.uncompleteSubtask(HID, task.id, sub.id);
    expect(undone.subtask.is_completed).toBe(false);
    expect(undone.subtask.completed_at).toBeNull();
    await expect(localTasksApi.uncompleteSubtask(HID, task.id, sub.id)).rejects.toThrow(
      'is not completed',
    );
  });

  it('reports progress on the detail DTO', async () => {
    const task = await makeTask();
    const a = await localTasksApi.createSubtask(HID, task.id, { title: 'a' });
    await localTasksApi.createSubtask(HID, task.id, { title: 'b' });
    await localTasksApi.createSubtask(HID, task.id, { title: 'c' });
    await localTasksApi.completeSubtask(HID, task.id, a.id);

    const { task: detail } = await localTasksApi.get(HID, task.id);
    expect(detail.subtask_progress).toEqual({ completed: 1, total: 3, percentage: 33 });
    expect(detail.subtasks).toHaveLength(3);
  });

  it('deletes a subtask', async () => {
    const task = await makeTask();
    const sub = await localTasksApi.createSubtask(HID, task.id, { title: 'x' });
    await localTasksApi.deleteSubtask(HID, task.id, sub.id);
    expect(await localTasksApi.listSubtasks(HID, task.id)).toHaveLength(0);
    await expect(localTasksApi.getSubtask(HID, task.id, sub.id)).rejects.toThrow(
      'Subtask not found',
    );
  });

  it('reorders the whole list in a single op', async () => {
    const task = await makeTask();
    const a = await localTasksApi.createSubtask(HID, task.id, { title: 'a' });
    const b = await localTasksApi.createSubtask(HID, task.id, { title: 'b' });
    const c = await localTasksApi.createSubtask(HID, task.id, { title: 'c' });

    const before = opCount();
    const reordered = await localTasksApi.reorderSubtasks(HID, task.id, [c.id, a.id, b.id]);

    // §3.3's non-negotiable rule: one op per CHUNK, never one per row.
    expect(opCount()).toBe(before + 1);
    expect(reordered.map((s) => s.title)).toEqual(['c', 'a', 'b']);
    expect(reordered.map((s) => s.sort_order)).toEqual([0, 1, 2]);
  });

  it('refuses a partial reorder, which cannot produce a total order', async () => {
    const task = await makeTask();
    const a = await localTasksApi.createSubtask(HID, task.id, { title: 'a' });
    await localTasksApi.createSubtask(HID, task.id, { title: 'b' });

    await expect(localTasksApi.reorderSubtasks(HID, task.id, [])).rejects.toThrow(
      'cannot be empty',
    );
    await expect(localTasksApi.reorderSubtasks(HID, task.id, [a.id])).rejects.toThrow(
      'Expected 2 subtask IDs, but received 1',
    );
    await expect(
      localTasksApi.reorderSubtasks(HID, task.id, [a.id, 'sub_alien']),
    ).rejects.toThrow("not found or doesn't belong to this task");
  });
});

describe('planner (getPlan / getReport)', () => {
  const dueIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  it('packs the highest-scoring tasks into the budget', async () => {
    await makeTask({ title: 'overdue critical', next_due_date: dueIn(-3), time_effort: 'quick' });
    await makeTask({ title: 'someday', time_effort: 'all_day' });

    const plan = await localTasksApi.getPlan(HID, 30);
    expect(plan.budget_minutes).toBe(30);
    expect(plan.selected.map((s) => s.title)).toEqual(['overdue critical']);
    expect(plan.used_minutes).toBe(15);
    expect(plan.skipped[0]).toMatchObject({ title: 'someday', reason: 'too_long' });
    expect(plan.selected[0]!.reason).toContain('overdue');
  });

  it('schedules a prefix of subtasks when the whole task will not fit', async () => {
    const task = await makeTask({ title: 'big job', time_effort: 'half_day' });
    for (const title of ['a', 'b', 'c', 'd']) {
       
      await localTasksApi.createSubtask(HID, task.id, { title });
    }
    const plan = await localTasksApi.getPlan(HID, 120);
    expect(plan.selected[0]!.partial).toBe(true);
    expect(plan.selected[0]!.subtask_ids).toHaveLength(2);
    expect(plan.selected[0]!.reason).toContain('start 2 of 4 steps');
  });

  it('leaves blocked tasks out of the plan entirely', async () => {
    const task = await makeTask({ title: 'blocked', time_effort: 'quick' });
    await localTasksApi.reportBlocker(HID, task.id, 'waiting on a part');
    const plan = await localTasksApi.getPlan(HID, 120);
    expect(plan.selected).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
  });

  it('rejects a non-positive budget, as the route does', async () => {
    await expect(localTasksApi.getPlan(HID, 0)).rejects.toThrow('minutes must be a positive number');
  });

  it('buckets tasks by urgency in the report', async () => {
    await makeTask({ title: 'overdue', next_due_date: dueIn(-2) });
    await makeTask({ title: 'today', next_due_date: dueIn(0) });
    await makeTask({ title: 'this week', next_due_date: dueIn(4) });
    await makeTask({ title: 'later', next_due_date: dueIn(60) });
    await makeTask({ title: 'undated' });

    const report = await localTasksApi.getReport(HID);
    expect(report.total_active).toBe(5);
    expect(report.overdue).toBe(1);
    expect(report.due_today).toBe(1);
    expect(report.due_this_week).toBe(1);
    expect(report.later).toBe(1);
    expect(report.no_due_date).toBe(1);
    // Overdue carries the biggest urgency boost, so it tops the list.
    expect(report.top_tasks[0]!.title).toBe('overdue');
    expect(report.top_tasks[0]!.days_until_due).toBeLessThan(0);
  });

  it('ignores inactive tasks', async () => {
    const task = await makeTask();
    await localTasksApi.update(HID, task.id, { is_active: false });
    expect((await localTasksApi.getReport(HID)).total_active).toBe(0);
  });
});

describe('Tier B methods throw rather than render an empty screen', () => {
  it.each([
    ['getTaskQuotes', () => localTasksApi.getTaskQuotes()],
    ['requestTaskQuotes', () => localTasksApi.requestTaskQuotes()],
    ['compareTaskQuotesWithAI', () => localTasksApi.compareTaskQuotesWithAI()],
    ['createBudgetItemFromTask', () => localTasksApi.createBudgetItemFromTask()],
  ])('%s raises HouseLocalUnsupportedError', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(HouseLocalUnsupportedError);
  });

  it('carries member-facing copy, not a stack trace', async () => {
    const error = await localTasksApi.getTaskQuotes().catch((e) => e);
    expect(error.message).toBe(getHouseUnsupportedCopy('tasks.getTaskQuotes').message);
    expect(error.message).not.toContain('tasks.getTaskQuotes');
  });
});

describe('durability', () => {
  it('survives a close and reopen of the session', async () => {
    const task = await makeTask({ title: 'Bleed the radiators', frequency: 'yearly' });
    await localTasksApi.createSubtask(HID, task.id, { title: 'open the valve' });
    await localTasksApi.addNote(HID, task.id, 'started');

    // Reopening replays the op journal through the projection — the same path a
    // cold app start takes.
    const reopened = await openLocalHouseSession({ userId: USER });
    expect(reopened.household.id).toBe(HID);

    const { task: after } = await localTasksApi.get(HID, task.id);
    expect(after.title).toBe('Bleed the radiators');
    expect(after.subtasks).toHaveLength(1);
    expect(await localTasksApi.listNotes(HID, task.id)).toHaveLength(1);
  });
});

/**
 * H6 attachment bytes on the ledger row (plan §8).
 *
 * The photo array always synced — `LocalTask` is `Omit<Task, …> & Owned` — but
 * what it carried was a `photo_key` naming an R2 object a local-first household
 * never wrote. These assertions are the ones that fail if the descriptor stops
 * riding along: a peer would get the row and no way to reach the bytes.
 */
describe('photo bytes — the H6 descriptor on the row', () => {
  const DESCRIPTOR = {
    blobId: 'blob_abc123',
    mime: 'image/jpeg',
    bytes: 204_800,
    sha256: 'a'.repeat(64),
    chunkCount: 1,
    keyEpoch: 3,
  };

  it('carries the descriptor onto the created row', async () => {
    const task = await makeTask({
      photos: [{ photo_key: 'lf-blob/blob_abc123', blob: DESCRIPTOR }],
      cover_photo_index: 0,
    });

    expect(task.photos).toHaveLength(1);
    expect(task.photos![0]!.blob).toEqual(DESCRIPTOR);
    expect(task.photos![0]!.photo_key).toBe('lf-blob/blob_abc123');
  });

  it('leaves photo_url EMPTY for a blob-backed photo rather than fabricating one', async () => {
    // `${API}/files/lf-blob/blob_abc123` would be a URL that resolves to
    // nothing. Empty is falsy at every <Image> call site, so the cover degrades
    // to "no image" instead of a broken request.
    const task = await makeTask({
      photos: [{ photo_key: 'lf-blob/blob_abc123', blob: DESCRIPTOR }],
      cover_photo_index: 0,
    });

    expect(task.photos![0]!.photo_url).toBe('');
    expect(task.cover_photo_url).toBe('');
    expect(task.cover_photo_id).toBe(task.photos![0]!.id);
  });

  it('leaves a legacy photo row exactly as it was — four fields, real url', async () => {
    const task = await makeTask({
      photos: [{ photo_key: 'maintenance-photos/h1/a.jpg' }],
      cover_photo_index: 0,
    });

    const row = task.photos![0]!;
    expect(row.photo_url).toContain('/files/maintenance-photos/h1/a.jpg');
    // No `blob` key at all — not `blob: null`. Whole-row comparisons elsewhere
    // depend on legacy rows keeping their original shape.
    expect(Object.keys(row).sort()).toEqual(['id', 'photo_key', 'photo_url', 'sort_order']);
  });

  it('mixes blob and legacy photos and keeps the cover pointing at the right one', async () => {
    const task = await makeTask({
      photos: [
        { photo_key: 'maintenance-photos/h1/a.jpg' },
        { photo_key: 'lf-blob/blob_abc123', blob: DESCRIPTOR },
      ],
      cover_photo_index: 1,
    });

    expect(task.photos![0]!.blob).toBeUndefined();
    expect(task.photos![1]!.blob).toEqual(DESCRIPTOR);
    expect(task.cover_photo_id).toBe(task.photos![1]!.id);
    expect(task.cover_photo_url).toBe('');
  });

  it('survives an update and a session reopen — the projection replays it', async () => {
    const task = await makeTask();
    await localTasksApi.update(HID, task.id, {
      photos: [{ photo_key: 'lf-blob/blob_abc123', blob: DESCRIPTOR }],
      cover_photo_index: 0,
    });

    // Reopening replays the op journal, which is the path a synced peer's
    // device takes when it applies the same op.
    await openLocalHouseSession({ userId: USER });

    const { task: after } = await localTasksApi.get(HID, task.id);
    expect(after.photos![0]!.blob).toEqual(DESCRIPTOR);
  });
});
