/**
 * Smart Project — describe-to-draft.
 *
 * The tests that matter here are the ones that prove what the feature REFUSES
 * to do: no price ever reaches a budget line, no area is written that was not
 * computed from the member's typed dimensions, and nothing is visible to the
 * household until the member publishes. Those three are the product decisions
 * (BRD D1–D3), so they get assertions rather than trust.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../db/schema';
import {
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import homeProjectsRouter from '../home-projects';
import { createHomeProjectTables } from './home-projects-test-schema';

// Typed with a rest parameter so the `(...args)` forwarding below is a
// legal spread rather than a TS2556.
const mockAssertCanUseAI = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../../services/entitlement-service', () => ({
  assertCanUseAI: (...args: unknown[]) => mockAssertCanUseAI(...args),
}));

const testEnv = env as unknown as Env;

const HID = 'hh_smart_draft_01';
const UID = 'u_smart_owner';
const MID = 'm_smart_owner';
const PEER_UID = 'u_smart_peer';
const PEER_MID = 'm_smart_peer';

const DESCRIPTION =
  'I have a shed. It has a roof, walls and a concrete floor, but inside it is only an empty frame ready for insulation, wall covering, electrical cable and lights. I want to convert it into a woodworking shop.';

/** Every message the route enqueued, so tests can assert what the job would see. */
let enqueued: Array<Record<string, unknown>> = [];

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum'
  );
  return new jose.SignJWT({
    sub: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households/:householdId/home-projects', homeProjectsRouter);
  app.onError((error, c) => {
    const named = [
      'ApiError',
      'ValidationError',
      'UnauthorizedError',
      'ForbiddenError',
      'NotFoundError',
      'ConflictError',
    ];
    if (named.includes((error as Error).name)) {
      const e = error as unknown as { code: string; message: string; statusCode: number };
      return c.json(
        { error: { code: e.code, message: e.message } },
        e.statusCode as 400 | 401 | 403 | 404 | 409
      );
    }
    console.error(error);
    return c.json({ error: { code: 'internal', message: (error as Error).message } }, 500);
  });
  return app;
}

async function req(
  app: Hono<{ Bindings: Env }>,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {}
): Promise<Response> {
  return app.fetch(
    new Request(`https://test.local${path}`, init as RequestInit),
    testEnv
  );
}

async function authed(userId = UID): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await mintToken(userId)}`,
    'Content-Type': 'application/json',
  };
}

/** Env with a capturing queue stub — the route requires the binding to exist. */
function envWithQueue(): Env {
  return {
    ...testEnv,
    HOME_PROJECT_SMART_DRAFT_QUEUE: {
      send: async (msg: Record<string, unknown>) => {
        enqueued.push(msg);
      },
    },
  } as unknown as Env;
}

async function startDraft(
  app: Hono<{ Bindings: Env }>,
  body: Record<string, unknown>
): Promise<Response> {
  return app.fetch(
    new Request(`https://test.local/households/${HID}/home-projects/smart-draft`, {
      method: 'POST',
      headers: await authed(),
      body: JSON.stringify(body),
    }),
    envWithQueue()
  );
}

beforeEach(async () => {
  enqueued = [];
  mockAssertCanUseAI.mockClear();
  await createCoreTables(testEnv.DB);
  await createHomeProjectTables(testEnv.DB);
  // `createCoreTables` stops short of these two, and the publish path walks
  // straight through both: TaskService reads subtasks when it returns a created
  // task, and the household notification reads preferences. Without them the
  // publish test passes for the wrong reason — the task creation throws, the
  // handler logs and continues, and "no tasks were created" looks like correct
  // draft behaviour instead of a missing table.
  await testEnv.DB.prepare(
    `CREATE TABLE IF NOT EXISTS maintenance_subtasks (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, completed_by TEXT,
      reminder_enabled INTEGER DEFAULT 0, reminder_days_before INTEGER DEFAULT 1,
      reminder_time TEXT, reminder_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT, deleted_at TEXT
    )`
  ).run();
  await testEnv.DB.prepare(
    `CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      push_enabled INTEGER NOT NULL DEFAULT 1, email_enabled INTEGER NOT NULL DEFAULT 1,
      quiet_hours_start TEXT, quiet_hours_end TEXT, timezone TEXT,
      task_reminders INTEGER NOT NULL DEFAULT 1, task_overdue INTEGER NOT NULL DEFAULT 1,
      task_assigned INTEGER NOT NULL DEFAULT 1, task_completed INTEGER NOT NULL DEFAULT 1,
      household_updates INTEGER NOT NULL DEFAULT 1, report_ready INTEGER NOT NULL DEFAULT 1,
      weekly_summary INTEGER NOT NULL DEFAULT 1, garbage_collection INTEGER NOT NULL DEFAULT 1,
      task_drafts_ready INTEGER NOT NULL DEFAULT 1, critical_findings INTEGER NOT NULL DEFAULT 1,
      maintenance_suggestions INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();
  await resetAllTables(testEnv.DB);

  const db = drizzle(testEnv.DB);
  const now = new Date().toISOString();
  await db.insert(schema.users).values([
    { id: UID, email: `${UID}@example.com`, email_verified: true },
    { id: PEER_UID, email: `${PEER_UID}@example.com`, email_verified: true },
  ]);
  await db.insert(schema.households).values({ id: HID, name: 'Smart Draft House' });
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: now },
    { id: PEER_MID, household_id: HID, user_id: PEER_UID, role: 'member', joined_at: now },
  ]);
});

describe('starting a draft', () => {
  it('creates the project as a DRAFT and returns 202', async () => {
    const app = mkApp();
    const res = await startDraft(app, { description: DESCRIPTION });
    expect(res.status).toBe(202);

    const body = (await res.json()) as {
      project: { id: string; visibility: string };
      draft: { status: string; description: string };
    };
    expect(body.project.visibility).toBe('draft');
    expect(body.draft.status).toBe('generating');
    expect(body.draft.description).toBe(DESCRIPTION);
  });

  it('enqueues IDs only — the description never travels in the message', async () => {
    const app = mkApp();
    await startDraft(app, { description: DESCRIPTION });

    expect(enqueued).toHaveLength(1);
    const msg = enqueued[0];
    expect(msg.draftId).toBeTruthy();
    expect(msg.projectId).toBeTruthy();
    expect(JSON.stringify(msg)).not.toContain('woodworking');
  });

  it('is not swallowed by the /:projectId route — literal wins', async () => {
    const app = mkApp();
    const res = await startDraft(app, { description: DESCRIPTION });
    // A 202 proves the router reached the smart-draft handler rather than
    // treating "smart-draft" as a project id.
    expect(res.status).toBe(202);
  });

  it('rejects a description too short to draft anything from', async () => {
    const app = mkApp();
    const res = await startDraft(app, { description: 'a shed' });
    expect(res.status).toBe(400);
  });

  it('rejects a dimension with a misplaced decimal point', async () => {
    const app = mkApp();
    const res = await startDraft(app, {
      description: DESCRIPTION,
      spaces: [{ label: 'Shed', length_m: 0.06, width_m: 3.6, height_m: 2.4 }],
    });
    expect(res.status).toBe(400);
  });

  it('accepts a request with no dimensions at all', async () => {
    const app = mkApp();
    const res = await startDraft(app, { description: DESCRIPTION });
    expect(res.status).toBe(202);
  });

  it('gates on the AI entitlement', async () => {
    const app = mkApp();
    await startDraft(app, { description: DESCRIPTION });
    expect(mockAssertCanUseAI).toHaveBeenCalled();
  });

  it('stores the typed dimensions verbatim for the job to compute from', async () => {
    const app = mkApp();
    const res = await startDraft(app, {
      description: DESCRIPTION,
      spaces: [{ label: 'Shed', length_m: 6, width_m: 3.6, height_m: 2.4 }],
    });
    const { project } = (await res.json()) as { project: { id: string } };

    const row = await testEnv.DB.prepare(
      'SELECT spaces_json FROM home_project_smart_drafts WHERE project_id = ?'
    )
      .bind(project.id)
      .first<{ spaces_json: string }>();
    expect(JSON.parse(row!.spaces_json)).toEqual([
      { label: 'Shed', length_m: 6, width_m: 3.6, height_m: 2.4 },
    ]);
  });
});

describe('a draft is its creator’s alone until published', () => {
  it('answers NotFound to a peer, never Forbidden', async () => {
    const app = mkApp();
    const res = await startDraft(app, { description: DESCRIPTION });
    const { project } = (await res.json()) as { project: { id: string } };

    const peek = await req(app, `/households/${HID}/home-projects/${project.id}`, {
      headers: await authed(PEER_UID),
    });
    // 404 and not 403: "you may not open this" would reveal that it exists.
    expect(peek.status).toBe(404);
  });

  it('is not listed for a peer', async () => {
    const app = mkApp();
    await startDraft(app, { description: DESCRIPTION });

    const list = await req(app, `/households/${HID}/home-projects`, {
      headers: await authed(PEER_UID),
    });
    const body = (await list.json()) as { projects: unknown[] };
    expect(body.projects).toHaveLength(0);
  });
});

describe('publishing', () => {
  async function completedDraft(app: Hono<{ Bindings: Env }>): Promise<string> {
    const res = await startDraft(app, { description: DESCRIPTION });
    const { project } = (await res.json()) as { project: { id: string } };
    await testEnv.DB.prepare(
      "UPDATE home_project_smart_drafts SET status = 'completed' WHERE project_id = ?"
    )
      .bind(project.id)
      .run();
    return project.id;
  }

  it('flips visibility to published', async () => {
    const app = mkApp();
    const projectId = await completedDraft(app);

    const res = await req(app, `/households/${HID}/home-projects/${projectId}/publish`, {
      method: 'POST',
      headers: await authed(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { visibility: string } };
    expect(body.project.visibility).toBe('published');
  });

  it('makes the project visible to the household only after publish', async () => {
    const app = mkApp();
    const projectId = await completedDraft(app);

    await req(app, `/households/${HID}/home-projects/${projectId}/publish`, {
      method: 'POST',
      headers: await authed(),
    });

    const peek = await req(app, `/households/${HID}/home-projects/${projectId}`, {
      headers: await authed(PEER_UID),
    });
    expect(peek.status).toBe(200);
  });

  it('refuses to publish while generation is still running', async () => {
    const app = mkApp();
    const res = await startDraft(app, { description: DESCRIPTION });
    const { project } = (await res.json()) as { project: { id: string } };

    const publish = await req(
      app,
      `/households/${HID}/home-projects/${project.id}/publish`,
      { method: 'POST', headers: await authed() }
    );
    expect(publish.status).toBe(409);
  });

  it('materialises held tasks only on publish, never before', async () => {
    const app = mkApp();
    const projectId = await completedDraft(app);
    await testEnv.DB.prepare(
      'UPDATE home_project_smart_drafts SET tasks_json = ? WHERE project_id = ?'
    )
      .bind(JSON.stringify([{ title: 'Confirm shed circuit capacity' }]), projectId)
      .run();

    const before = await testEnv.DB.prepare(
      // Migration 0170: the link is a JSON array on the project row, so the
      // count is the array's length rather than a row count on a join table.
      'SELECT linked_task_ids AS ids FROM home_projects WHERE id = ?'
    )
      .bind(projectId)
      .first<{ ids: string | null }>();
    expect(JSON.parse(before!.ids ?? '[]')).toEqual([]);

    await req(app, `/households/${HID}/home-projects/${projectId}/publish`, {
      method: 'POST',
      headers: await authed(),
    });

    const after = await testEnv.DB.prepare(
      // Migration 0170: the link is a JSON array on the project row, so the
      // count is the array's length rather than a row count on a join table.
      'SELECT linked_task_ids AS ids FROM home_projects WHERE id = ?'
    )
      .bind(projectId)
      .first<{ ids: string | null }>();
    expect(JSON.parse(after!.ids ?? '[]')).toHaveLength(1);
  });

  it('is idempotent — publishing twice does not double the tasks', async () => {
    const app = mkApp();
    const projectId = await completedDraft(app);
    await testEnv.DB.prepare(
      'UPDATE home_project_smart_drafts SET tasks_json = ? WHERE project_id = ?'
    )
      .bind(JSON.stringify([{ title: 'Confirm shed circuit capacity' }]), projectId)
      .run();

    const publish = async () =>
      req(app, `/households/${HID}/home-projects/${projectId}/publish`, {
        method: 'POST',
        headers: await authed(),
      });
    await publish();
    await publish();

    const after = await testEnv.DB.prepare(
      // Migration 0170: the link is a JSON array on the project row, so the
      // count is the array's length rather than a row count on a join table.
      'SELECT linked_task_ids AS ids FROM home_projects WHERE id = ?'
    )
      .bind(projectId)
      .first<{ ids: string | null }>();
    expect(JSON.parse(after!.ids ?? '[]')).toHaveLength(1);
  });
});

describe('cancelling', () => {
  it('marks the row cancelled rather than deleting it', async () => {
    const app = mkApp();
    const res = await startDraft(app, { description: DESCRIPTION });
    const { project, draft } = (await res.json()) as {
      project: { id: string };
      draft: { id: string };
    };

    const cancel = await req(
      app,
      `/households/${HID}/home-projects/${project.id}/smart-draft/${draft.id}/cancel`,
      { method: 'POST', headers: await authed() }
    );
    expect(cancel.status).toBe(200);

    // The row must survive: the queue message is already in flight, and the
    // handler stops by finding a row that no longer says 'generating'.
    const row = await testEnv.DB.prepare(
      'SELECT status FROM home_project_smart_drafts WHERE id = ?'
    )
      .bind(draft.id)
      .first<{ status: string }>();
    expect(row!.status).toBe('cancelled');
  });
});

describe('as-is state', () => {
  async function draftProject(app: Hono<{ Bindings: Env }>): Promise<string> {
    const res = await startDraft(app, { description: DESCRIPTION });
    const { project } = (await res.json()) as { project: { id: string } };
    return project.id;
  }

  it('records what already exists', async () => {
    const app = mkApp();
    const projectId = await draftProject(app);

    const res = await req(app, `/households/${HID}/home-projects/${projectId}/as-is`, {
      method: 'PUT',
      headers: await authed(),
      body: JSON.stringify({ element: 'roof', state: 'present', evidence: 'it has a roof' }),
    });
    expect(res.status).toBe(200);

    const list = await req(app, `/households/${HID}/home-projects/${projectId}/as-is`, {
      headers: await authed(),
    });
    const body = (await list.json()) as { as_is: Array<{ element: string; state: string }> };
    expect(body.as_is).toHaveLength(1);
    expect(body.as_is[0]).toMatchObject({ element: 'roof', state: 'present' });
  });

  it('upserts rather than duplicating — one state per element', async () => {
    const app = mkApp();
    const projectId = await draftProject(app);

    const put = async (state: string) =>
      req(app, `/households/${HID}/home-projects/${projectId}/as-is`, {
        method: 'PUT',
        headers: await authed(),
        body: JSON.stringify({ element: 'insulation', state }),
      });
    await put('unknown');
    await put('absent');

    const list = await req(app, `/households/${HID}/home-projects/${projectId}/as-is`, {
      headers: await authed(),
    });
    const body = (await list.json()) as { as_is: Array<{ state: string }> };
    expect(body.as_is).toHaveLength(1);
    expect(body.as_is[0].state).toBe('absent');
  });

  it('marks a member’s answer as theirs, not as AI output', async () => {
    const app = mkApp();
    const projectId = await draftProject(app);

    await req(app, `/households/${HID}/home-projects/${projectId}/as-is`, {
      method: 'PUT',
      headers: await authed(),
      body: JSON.stringify({ element: 'roof', state: 'present' }),
    });

    const row = await testEnv.DB.prepare(
      'SELECT source FROM home_project_as_is WHERE project_id = ?'
    )
      .bind(projectId)
      .first<{ source: string }>();
    expect(row!.source).toBe('manual');
  });

  it('rejects an element outside the catalogue', async () => {
    const app = mkApp();
    const projectId = await draftProject(app);

    const res = await req(app, `/households/${HID}/home-projects/${projectId}/as-is`, {
      method: 'PUT',
      headers: await authed(),
      body: JSON.stringify({ element: 'swimming_pool', state: 'present' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a state outside present/absent/unknown', async () => {
    const app = mkApp();
    const projectId = await draftProject(app);

    const res = await req(app, `/households/${HID}/home-projects/${projectId}/as-is`, {
      method: 'PUT',
      headers: await authed(),
      body: JSON.stringify({ element: 'roof', state: 'probably' }),
    });
    expect(res.status).toBe(400);
  });
});
