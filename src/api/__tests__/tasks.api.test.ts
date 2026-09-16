/**
 * Task API layer — full CRUD + quick-create + personal tasks.
 *
 * Mocks the axios client so every test is pure logic — no network, no auth
 * store, no native modules. Asserts that each helper builds the right URL,
 * passes the right payload, and unwraps the response correctly.
 */

jest.mock('../client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import { apiClient } from '../client';
import { tasksApi } from '../tasks';
import type { Task } from '../tasks';

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockPatch = apiClient.patch as jest.Mock;
const mockDelete = apiClient.delete as jest.Mock;

const HID = 'hh_test_01';
const TID = 'task_test_01';
const DAY = 1000 * 60 * 60 * 24;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TID,
    system_category: null,
    title: 'Replace kitchen faucet',
    description: null,
    frequency: 'one_time',
    custom_interval_days: null,
    next_due_date: iso(7),
    last_completed_at: null,
    assigned_to: null,
    space_id: null,
    is_active: true,
    source: 'manual',
    priority_severity: 'medium',
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: true,
    created_at: iso(-1),
    updated_at: iso(-1),
    is_personal: false,
    created_by: 'u_owner',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── list ────────────────────────────────────────────────────────────────────

describe('tasksApi.list', () => {
  it('GETs /households/:id/tasks and returns tasks array', async () => {
    const tasks = [makeTask()];
    mockGet.mockResolvedValueOnce({ data: { tasks, next_cursor: undefined } });
    const result = await tasksApi.list(HID);
    expect(mockGet).toHaveBeenCalledWith(`/households/${HID}/tasks`, { params: undefined });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe('Replace kitchen faucet');
  });

  it('passes system_category filter', async () => {
    mockGet.mockResolvedValueOnce({ data: { tasks: [] } });
    await tasksApi.list(HID, { system_category: 'plumbing' });
    expect(mockGet).toHaveBeenCalledWith(`/households/${HID}/tasks`, {
      params: { system_category: 'plumbing' },
    });
  });

  it('passes is_active filter', async () => {
    mockGet.mockResolvedValueOnce({ data: { tasks: [] } });
    await tasksApi.list(HID, { is_active: false });
    expect(mockGet).toHaveBeenCalledWith(`/households/${HID}/tasks`, {
      params: { is_active: false },
    });
  });

  it('passes pagination cursor + limit', async () => {
    mockGet.mockResolvedValueOnce({ data: { tasks: [], next_cursor: 'cur_2' } });
    await tasksApi.list(HID, { cursor: 'cur_1', limit: 50 });
    expect(mockGet).toHaveBeenCalledWith(`/households/${HID}/tasks`, {
      params: { cursor: 'cur_1', limit: 50 },
    });
  });
});

// ─── create ──────────────────────────────────────────────────────────────────

describe('tasksApi.create', () => {
  it('POSTs to /households/:id/tasks and unwraps the task', async () => {
    const task = makeTask();
    mockPost.mockResolvedValueOnce({ data: { task } });
    const result = await tasksApi.create(HID, {
      title: 'Replace kitchen faucet',
      frequency: 'one_time',
    });
    expect(mockPost).toHaveBeenCalledWith(`/households/${HID}/tasks`, {
      title: 'Replace kitchen faucet',
      frequency: 'one_time',
    });
    expect(result.task.id).toBe(TID);
  });

  it('sends is_personal=true for personal tasks', async () => {
    const task = makeTask({ is_personal: true });
    mockPost.mockResolvedValueOnce({ data: { task } });
    await tasksApi.create(HID, {
      title: 'Buy birthday gift',
      frequency: 'one_time',
      is_personal: true,
    });
    expect((mockPost.mock.calls[0][1] as { is_personal: boolean }).is_personal).toBe(true);
  });

  it('includes all optional fields when provided', async () => {
    const task = makeTask({ priority_severity: 'urgent' });
    mockPost.mockResolvedValueOnce({ data: { task } });
    const dueDate = new Date(2026, 6, 10).toISOString(); // July 10
    await tasksApi.create(HID, {
      title: 'Return Amazon gift',
      frequency: 'one_time',
      next_due_date: dueDate,
      priority_severity: 'urgent',
      reminder_enabled: true,
      reminder_days_before: 2,
      reminder_time: '09:00',
      reminder_repeat: false,
      is_personal: false,
    });
    const payload = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.title).toBe('Return Amazon gift');
    expect(payload.next_due_date).toBe(dueDate);
    expect(payload.priority_severity).toBe('urgent');
    expect(payload.reminder_enabled).toBe(true);
  });

  it('sends attachment photos and cover index when provided', async () => {
    const task = makeTask({
      photos: [
        {
          id: 'p1',
          photo_key: 'maintenance-photos/h1/a.jpg',
          photo_url: 'https://api.example/files/maintenance-photos/h1/a.jpg',
          sort_order: 0,
        },
      ],
      cover_photo_id: 'p1',
      cover_photo_url: 'https://api.example/files/maintenance-photos/h1/a.jpg',
    });
    mockPost.mockResolvedValueOnce({ data: { task } });
    await tasksApi.create(HID, {
      title: 'Document leak',
      frequency: 'one_time',
      photos: [{ photo_key: 'maintenance-photos/h1/a.jpg' }],
      cover_photo_index: 0,
    });
    const payload = mockPost.mock.calls[0][1] as {
      photos: Array<{ photo_key: string }>;
      cover_photo_index: number;
    };
    expect(payload.photos).toEqual([{ photo_key: 'maintenance-photos/h1/a.jpg' }]);
    expect(payload.cover_photo_index).toBe(0);
  });
});

// ─── quickCreate ─────────────────────────────────────────────────────────────

describe('tasksApi.quickCreate', () => {
  const AMAZON_PROMPT =
    'I need to return to Amazon gift that I bought for our friends due date is July 10 assigned this task to me. This is a time sensitive task and need to be done before these due date set up a reminder.';

  it('POSTs raw text to /households/:id/tasks/quick', async () => {
    const task = makeTask({
      title: 'Return Amazon gift',
      enrichment_status: 'pending',
      next_due_date: '2026-07-10T00:00:00.000Z',
      priority_severity: 'urgent',
      reminder_enabled: true,
      source: 'ai_generated',
    });
    mockPost.mockResolvedValueOnce({ data: { task } });
    const result = await tasksApi.quickCreate(HID, { text: AMAZON_PROMPT });
    expect(mockPost).toHaveBeenCalledWith(`/households/${HID}/tasks/quick`, {
      text: AMAZON_PROMPT,
    });
    expect(result.task.enrichment_status).toBe('pending');
  });

  it('sends is_personal flag to quick create', async () => {
    const task = makeTask({ is_personal: true, enrichment_status: 'pending' });
    mockPost.mockResolvedValueOnce({ data: { task } });
    await tasksApi.quickCreate(HID, { text: 'Fix my personal laptop', is_personal: true });
    const payload = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.is_personal).toBe(true);
    expect(payload.text).toBe('Fix my personal laptop');
  });

  it('returns a task with enrichment_status=pending immediately', async () => {
    const task = makeTask({ enrichment_status: 'pending', source: 'ai_generated' });
    mockPost.mockResolvedValueOnce({ data: { task } });
    const result = await tasksApi.quickCreate(HID, { text: 'Any quick task' });
    expect(result.task.enrichment_status).toBe('pending');
    expect(result.task.source).toBe('ai_generated');
  });

  it('passes assigned_to and space_id when provided', async () => {
    const task = makeTask({ assigned_to: { id: 'u1', display_name: 'Alice' } });
    mockPost.mockResolvedValueOnce({ data: { task } });
    await tasksApi.quickCreate(HID, { text: 'Fix the sink', assigned_to: 'u1', space_id: 's1' });
    const payload = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.assigned_to).toBe('u1');
    expect(payload.space_id).toBe('s1');
  });
});

// ─── get ─────────────────────────────────────────────────────────────────────

describe('tasksApi.get', () => {
  it('GETs /households/:hid/tasks/:tid and unwraps task', async () => {
    const task = makeTask();
    mockGet.mockResolvedValueOnce({ data: { task } });
    const result = await tasksApi.get(HID, TID);
    expect(mockGet).toHaveBeenCalledWith(`/households/${HID}/tasks/${TID}`);
    expect(result.task.id).toBe(TID);
  });

  it('exposes is_personal and created_by from response', async () => {
    const task = makeTask({ is_personal: true, created_by: 'u_alice' });
    mockGet.mockResolvedValueOnce({ data: { task } });
    const result = await tasksApi.get(HID, TID);
    expect(result.task.is_personal).toBe(true);
    expect(result.task.created_by).toBe('u_alice');
  });
});

// ─── update ──────────────────────────────────────────────────────────────────

describe('tasksApi.update', () => {
  it('PATCHes the task and returns updated data', async () => {
    const task = makeTask({ title: 'Updated title', priority_severity: 'high' });
    mockPatch.mockResolvedValueOnce({ data: { task } });
    const result = await tasksApi.update(HID, TID, { title: 'Updated title', priority_severity: 'high' });
    expect(mockPatch).toHaveBeenCalledWith(
      `/households/${HID}/tasks/${TID}`,
      { title: 'Updated title', priority_severity: 'high' }
    );
    expect(result.task.title).toBe('Updated title');
  });

  it('can set assigned_to to null (unassign)', async () => {
    const task = makeTask({ assigned_to: null });
    mockPatch.mockResolvedValueOnce({ data: { task } });
    await tasksApi.update(HID, TID, { assigned_to: null });
    const payload = mockPatch.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.assigned_to).toBeNull();
  });

  it('can deactivate a task', async () => {
    const task = makeTask({ is_active: false });
    mockPatch.mockResolvedValueOnce({ data: { task } });
    await tasksApi.update(HID, TID, { is_active: false });
    expect((mockPatch.mock.calls[0][1] as { is_active: boolean }).is_active).toBe(false);
  });

  it('can snooze a task', async () => {
    const task = makeTask({ snooze_until: iso(3) });
    mockPatch.mockResolvedValueOnce({ data: { task } });
    const snoozeDate = iso(3);
    await tasksApi.update(HID, TID, { snooze_until: snoozeDate });
    expect((mockPatch.mock.calls[0][1] as { snooze_until: string }).snooze_until).toBe(snoozeDate);
  });

  it('can update due date (return Amazon gift scenario — July 10)', async () => {
    const july10 = '2026-07-10T00:00:00.000Z';
    const task = makeTask({ next_due_date: july10, title: 'Return Amazon gift' });
    mockPatch.mockResolvedValueOnce({ data: { task } });
    const result = await tasksApi.update(HID, TID, { next_due_date: july10 });
    expect(result.task.next_due_date).toBe(july10);
  });

  it('can replace attachment photos and cover index', async () => {
    const task = makeTask({
      photos: [],
      cover_photo_id: null,
      cover_photo_url: null,
    });
    mockPatch.mockResolvedValueOnce({ data: { task } });
    await tasksApi.update(HID, TID, {
      photos: [],
      cover_photo_index: 0,
    });
    const payload = mockPatch.mock.calls[0][1] as {
      photos: unknown[];
      cover_photo_index: number;
    };
    expect(payload.photos).toEqual([]);
    expect(payload.cover_photo_index).toBe(0);
  });
});

// ─── delete ──────────────────────────────────────────────────────────────────

describe('tasksApi.delete', () => {
  it('DELETEs the task at the correct URL', async () => {
    mockDelete.mockResolvedValueOnce({});
    await tasksApi.delete(HID, TID);
    expect(mockDelete).toHaveBeenCalledWith(`/households/${HID}/tasks/${TID}`);
  });
});

// ─── complete ────────────────────────────────────────────────────────────────

describe('tasksApi.complete', () => {
  it('POSTs to /complete and returns task + completion', async () => {
    const task = makeTask({ last_completed_at: iso(0) });
    const completion = { id: 'c1', completed_at: iso(0), notes: null };
    mockPost.mockResolvedValueOnce({ data: { task, completion } });
    const result = await tasksApi.complete(HID, TID, { notes: 'All done' });
    expect(mockPost).toHaveBeenCalledWith(
      `/households/${HID}/tasks/${TID}/complete`,
      { notes: 'All done' }
    );
    expect(result.task.last_completed_at).toBeTruthy();
    expect(result.completion.id).toBe('c1');
  });

  it('sends photo_keys when provided', async () => {
    const task = makeTask();
    mockPost.mockResolvedValueOnce({ data: { task, completion: { id: 'c2', completed_at: iso(0), notes: null } } });
    await tasksApi.complete(HID, TID, { photo_keys: ['photo1.jpg', 'photo2.jpg'] });
    const payload = mockPost.mock.calls[0][1] as { photo_keys: string[] };
    expect(payload.photo_keys).toEqual(['photo1.jpg', 'photo2.jpg']);
  });
});

// ─── blockers ────────────────────────────────────────────────────────────────

describe('tasksApi.reportBlocker / resolveBlocker', () => {
  it('reportBlocker POSTs to /block with the reason', async () => {
    const task = makeTask({ blocked: true, blocker_reason: 'Waiting for part' });
    mockPost.mockResolvedValueOnce({ data: { task } });
    const result = await tasksApi.reportBlocker(HID, TID, 'Waiting for part');
    expect(mockPost).toHaveBeenCalledWith(
      `/households/${HID}/tasks/${TID}/block`,
      { reason: 'Waiting for part' }
    );
    expect(result.task.blocked).toBe(true);
  });

  it('resolveBlocker POSTs to /unblock', async () => {
    const task = makeTask({ blocked: false });
    mockPost.mockResolvedValueOnce({ data: { task } });
    await tasksApi.resolveBlocker(HID, TID, 'Fixed it');
    expect(mockPost).toHaveBeenCalledWith(
      `/households/${HID}/tasks/${TID}/unblock`,
      { note: 'Fixed it' }
    );
  });

  it('resolveBlocker sends empty body when no note', async () => {
    const task = makeTask();
    mockPost.mockResolvedValueOnce({ data: { task } });
    await tasksApi.resolveBlocker(HID, TID);
    expect(mockPost).toHaveBeenCalledWith(
      `/households/${HID}/tasks/${TID}/unblock`,
      {}
    );
  });
});

// ─── notes ───────────────────────────────────────────────────────────────────

describe('tasksApi.listNotes / addNote', () => {
  it('listNotes GETs the activity feed', async () => {
    mockGet.mockResolvedValueOnce({ data: { notes: [] } });
    const notes = await tasksApi.listNotes(HID, TID);
    expect(mockGet).toHaveBeenCalledWith(`/households/${HID}/tasks/${TID}/notes`);
    expect(notes).toEqual([]);
  });

  it('addNote POSTs body text and returns the new note', async () => {
    mockPost.mockResolvedValueOnce({ data: { note: { id: 'n1', created_at: iso(0) } } });
    const note = await tasksApi.addNote(HID, TID, 'Work started');
    expect(mockPost).toHaveBeenCalledWith(
      `/households/${HID}/tasks/${TID}/notes`,
      { body: 'Work started' }
    );
    expect(note.id).toBe('n1');
  });
});

// ─── upcoming ────────────────────────────────────────────────────────────────

describe('tasksApi.getUpcoming', () => {
  it('GETs /upcoming with default 7-day window', async () => {
    mockGet.mockResolvedValueOnce({ data: { tasks: [] } });
    await tasksApi.getUpcoming(HID);
    expect(mockGet).toHaveBeenCalledWith(`/households/${HID}/tasks/upcoming`, { params: { days: 7 } });
  });

  it('respects a custom days parameter', async () => {
    mockGet.mockResolvedValueOnce({ data: { tasks: [] } });
    await tasksApi.getUpcoming(HID, 14);
    expect(mockGet).toHaveBeenCalledWith(`/households/${HID}/tasks/upcoming`, { params: { days: 14 } });
  });
});
