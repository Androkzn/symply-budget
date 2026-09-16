/**
 * home-projects routes — MVP smoke:
 *   - create from template → hub
 *   - selection optimistic lock → 409
 *   - archive
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import {
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import homeProjectsRouter from '../home-projects';
import { createHomeProjectTables } from './home-projects-test-schema';

const testEnv = env as unknown as Env;

const HID = 'hh_hp_routes_01';
const UID = 'u_hp_routes_owner';
const MID = 'm_hp_routes_owner';

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

// Re-exported for the suites that already import it from here. New callers
// should import `./home-projects-test-schema` directly — importing a *test*
// file to get at a helper registers this file's describe blocks into theirs.
export { createHomeProjectTables };

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households/:householdId/home-projects', homeProjectsRouter);
  app.onError((error, c) => {
    const apiErrorNames = [
      'ApiError',
      'ValidationError',
      'UnauthorizedError',
      'ForbiddenError',
      'NotFoundError',
      'ConflictError',
      'RateLimitError',
    ];
    const errorName = (error as Error).name;
    if (apiErrorNames.includes(errorName)) {
      const apiError = error as unknown as {
        code: string;
        message: string;
        statusCode: number;
      };
      return c.json(
        { error: { code: apiError.code, message: apiError.message } },
        apiError.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500
      );
    }
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });
  return app;
}

async function req(
  app: Hono<{ Bindings: Env }>,
  path: string,
  init: RequestInit & { headers?: Record<string, string> }
): Promise<Response> {
  return app.request(path, init, testEnv);
}

async function seedHousehold(): Promise<void> {
  const db = drizzle(testEnv.DB);
  const now = new Date().toISOString();
  await db.insert(schema.users).values({
    id: UID,
    email: `${UID}@example.com`,
    email_verified: true,
  });
  await db.insert(schema.households).values({
    id: HID,
    name: 'HP House',
  });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: now,
  });
}

describe('home-projects routes', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createHomeProjectTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await seedHousehold();
  });

  it('creates from template and returns hub', async () => {
    const app = mkApp();
    const token = await mintToken(UID);
    const createRes = await req(app, `/households/${HID}/home-projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateKey: 'bathroom_reno',
        title: 'Master bath',
        targetBudgetCents: 1200000,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { project: { id: string; title: string } };
    expect(created.project.title).toBe('Master bath');

    const hubRes = await req(app, `/households/${HID}/home-projects/${created.project.id}/hub`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(hubRes.status).toBe(200);
    const hub = (await hubRes.json()) as {
      project: { id: string };
      phases: unknown[];
      rollups: { budget_health: string };
    };
    expect(hub.project.id).toBe(created.project.id);
    expect(hub.phases.length).toBeGreaterThan(0);
    expect(hub.rollups.budget_health).toBeTruthy();
  });

  it('returns 409 on stale selection version', async () => {
    const app = mkApp();
    const token = await mintToken(UID);
    const createRes = await req(app, `/households/${HID}/home-projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ templateKey: 'blank', title: 'Conflict test' }),
    });
    const { project } = (await createRes.json()) as { project: { id: string } };

    const selRes = await req(app, `/households/${HID}/home-projects/${project.id}/selections`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Tile', unitPriceCents: 5000 }),
    });
    expect(selRes.status).toBe(201);
    const { selection } = (await selRes.json()) as {
      selection: { id: string; version: number };
    };

    const patchOk = await req(
      app,
      `/households/${HID}/home-projects/${project.id}/selections/${selection.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Tile v2', version: selection.version }),
      }
    );
    expect(patchOk.status).toBe(200);

    const patchStale = await req(
      app,
      `/households/${HID}/home-projects/${project.id}/selections/${selection.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Tile stale', version: selection.version }),
      }
    );
    expect(patchStale.status).toBe(409);
  });

  /**
   * The materials list PREPENDS. It is the one hub list that is not a plan —
   * a member adds to it for years — so the row they just added has to be the
   * one they land on, not the eighth item down an AI-seeded shopping list.
   *
   * Both halves are asserted here because they are one rule: an add with no
   * stated position goes on top, and an add that STATES one is a caller
   * writing a plan row by row and keeps the order it asked for. Without the
   * second, a Smart Project's materials arrive reversed.
   */
  it('puts a new material on top, and keeps a stated order as stated', async () => {
    const app = mkApp();
    const token = await mintToken(UID);
    const auth = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const createRes = await req(app, `/households/${HID}/home-projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ templateKey: 'blank', title: 'Shed conversion' }),
    });
    const { project } = (await createRes.json()) as { project: { id: string } };

    const addMaterial = async (name: string, sortOrder?: number) => {
      const res = await req(
        app,
        `/households/${HID}/home-projects/${project.id}/selections`,
        {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ name, ...(sortOrder == null ? {} : { sortOrder }) }),
        }
      );
      expect(res.status).toBe(201);
    };
    const materialNames = async () => {
      const hubRes = await req(
        app,
        `/households/${HID}/home-projects/${project.id}/hub`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const hub = (await hubRes.json()) as { selections: { name: string }[] };
      return hub.selections.map((s) => s.name);
    };

    // A plan seeded row by row, each naming its index — the wizard's write.
    await addMaterial('OSB panels', 0);
    await addMaterial('Screws', 1);
    await addMaterial('Primer', 2);
    expect(await materialNames()).toEqual(['OSB panels', 'Screws', 'Primer']);

    // Then the member adds two of their own. Newest first, above the plan.
    await addMaterial('Mold control');
    await addMaterial('Shop light');
    expect(await materialNames()).toEqual([
      'Shop light',
      'Mold control',
      'OSB panels',
      'Screws',
      'Primer',
    ]);
  });

  it('archives a project', async () => {
    const app = mkApp();
    const token = await mintToken(UID);
    const createRes = await req(app, `/households/${HID}/home-projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ templateKey: 'blank', title: 'Archive me' }),
    });
    const { project } = (await createRes.json()) as { project: { id: string } };

    const archiveRes = await req(app, `/households/${HID}/home-projects/${project.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(archiveRes.status).toBe(200);
    const archived = (await archiveRes.json()) as { project: { status: string } };
    expect(archived.project.status).toBe('archived');

    const listRes = await req(app, `/households/${HID}/home-projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()) as { projects: { id: string }[] };
    expect(list.projects.find((p) => p.id === project.id)).toBeUndefined();
  });

  /**
   * The Timeline and Blockers tabs, end to end: add, edit, reorder, delete.
   *
   * Reorder is the reason the rest of this exists — `sort_order` was a column
   * both tables carried and nothing wrote, so every hand-added row sat on 0 and
   * `ORDER BY sort_order` was free to return them in any order at all.
   */
  describe('phases and blockers', () => {
    async function blankProject(
      app: Hono<{ Bindings: Env }>,
      auth: Record<string, string>
    ): Promise<string> {
      const res = await req(app, `/households/${HID}/home-projects`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ templateKey: 'blank', title: 'Shed' }),
      });
      const { project } = (await res.json()) as { project: { id: string } };
      return project.id;
    }

    async function hub(
      app: Hono<{ Bindings: Env }>,
      token: string,
      projectId: string
    ) {
      const res = await req(
        app,
        `/households/${HID}/home-projects/${projectId}/hub`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return (await res.json()) as {
        phases: { id: string; title: string; status: string; sort_order: number }[];
        blockers: {
          id: string;
          title: string;
          severity: string;
          status: string;
          notes: string | null;
          sort_order: number;
        }[];
      };
    }

    it('appends each new phase rather than piling them all on sort_order 0', async () => {
      const app = mkApp();
      const token = await mintToken(UID);
      const auth = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const projectId = await blankProject(app, auth);

      for (const title of ['Strip out', 'Insulate', 'Paint']) {
        const res = await req(
          app,
          `/households/${HID}/home-projects/${projectId}/phases`,
          { method: 'POST', headers: auth, body: JSON.stringify({ title }) }
        );
        expect(res.status).toBe(201);
      }

      const { phases } = await hub(app, token, projectId);
      expect(phases.map((p) => p.title)).toEqual([
        'Strip out',
        'Insulate',
        'Paint',
      ]);
      // Distinct, and in the order they were typed — the whole point.
      expect(phases.map((p) => p.sort_order)).toEqual([0, 1, 2]);
    });

    it('edits a phase, reorders the list and deletes one', async () => {
      const app = mkApp();
      const token = await mintToken(UID);
      const auth = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const projectId = await blankProject(app, auth);

      for (const title of ['One', 'Two', 'Three']) {
        await req(
          app,
          `/households/${HID}/home-projects/${projectId}/phases`,
          { method: 'POST', headers: auth, body: JSON.stringify({ title }) }
        );
      }
      const before = (await hub(app, token, projectId)).phases;

      const patchRes = await req(
        app,
        `/households/${HID}/home-projects/${projectId}/phases/${before[1].id}`,
        {
          method: 'PATCH',
          headers: auth,
          body: JSON.stringify({ title: 'Two (revised)', status: 'done' }),
        }
      );
      expect(patchRes.status).toBe(200);

      // Reversed, and deliberately naming only TWO of the three: the third
      // keeps its place at the end rather than the drop being refused.
      const reorderRes = await req(
        app,
        `/households/${HID}/home-projects/${projectId}/phases/reorder`,
        {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ phaseIds: [before[2].id, before[1].id] }),
        }
      );
      expect(reorderRes.status).toBe(200);

      const afterReorder = (await hub(app, token, projectId)).phases;
      expect(afterReorder.map((p) => p.title)).toEqual([
        'Three',
        'Two (revised)',
        'One',
      ]);
      expect(afterReorder[1].status).toBe('done');

      const deleteRes = await req(
        app,
        `/households/${HID}/home-projects/${projectId}/phases/${before[0].id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );
      expect(deleteRes.status).toBe(204);
      expect(
        (await hub(app, token, projectId)).phases.map((p) => p.title)
      ).toEqual(['Three', 'Two (revised)']);
    });

    it('refuses to reorder using an id from another project', async () => {
      const app = mkApp();
      const token = await mintToken(UID);
      const auth = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const mine = await blankProject(app, auth);
      const theirs = await blankProject(app, auth);
      await req(app, `/households/${HID}/home-projects/${theirs}/phases`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ title: 'Not yours' }),
      });
      const stranger = (await hub(app, token, theirs)).phases[0].id;

      const res = await req(
        app,
        `/households/${HID}/home-projects/${mine}/phases/reorder`,
        {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ phaseIds: [stranger] }),
        }
      );
      expect(res.status).toBe(400);
    });

    it('edits, resolves, reorders and deletes a blocker', async () => {
      const app = mkApp();
      const token = await mintToken(UID);
      const auth = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const projectId = await blankProject(app, auth);

      for (const title of ['Permits', 'Damp', 'Power']) {
        const res = await req(
          app,
          `/households/${HID}/home-projects/${projectId}/blockers`,
          { method: 'POST', headers: auth, body: JSON.stringify({ title }) }
        );
        expect(res.status).toBe(201);
      }
      const before = (await hub(app, token, projectId)).blockers;
      expect(before.map((b) => b.title)).toEqual(['Permits', 'Damp', 'Power']);

      const patchRes = await req(
        app,
        `/households/${HID}/home-projects/${projectId}/blockers/${before[0].id}`,
        {
          method: 'PATCH',
          headers: auth,
          body: JSON.stringify({
            severity: 'critical',
            status: 'resolved',
            notes: 'Council confirmed a permit is needed',
          }),
        }
      );
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as {
        blocker: { severity: string; status: string; resolved_at: string | null };
      };
      expect(patched.blocker.severity).toBe('critical');
      expect(patched.blocker.status).toBe('resolved');
      // Deliberately left alone: no reader, and the local-first row type does
      // not carry it. See `updateBlocker`.
      expect(patched.blocker.resolved_at).toBeNull();

      await req(
        app,
        `/households/${HID}/home-projects/${projectId}/blockers/reorder`,
        {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({
            blockerIds: [before[2].id, before[0].id, before[1].id],
          }),
        }
      );
      expect(
        (await hub(app, token, projectId)).blockers.map((b) => b.title)
      ).toEqual(['Power', 'Permits', 'Damp']);

      const deleteRes = await req(
        app,
        `/households/${HID}/home-projects/${projectId}/blockers/${before[1].id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );
      expect(deleteRes.status).toBe(204);
      expect(
        (await hub(app, token, projectId)).blockers.map((b) => b.title)
      ).toEqual(['Power', 'Permits']);
    });

    it('rejects a phase status outside the three the Timeline offers', async () => {
      const app = mkApp();
      const token = await mintToken(UID);
      const auth = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const projectId = await blankProject(app, auth);
      await req(app, `/households/${HID}/home-projects/${projectId}/phases`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ title: 'Only phase' }),
      });
      const phaseId = (await hub(app, token, projectId)).phases[0].id;

      const res = await req(
        app,
        `/households/${HID}/home-projects/${projectId}/phases/${phaseId}`,
        {
          method: 'PATCH',
          headers: auth,
          body: JSON.stringify({ status: 'whenever' }),
        }
      );
      expect(res.status).toBe(400);
    });
  });

  it('sets a cover and resolves it to a url on list', async () => {
    const app = mkApp();
    const token = await mintToken(UID);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const createRes = await req(app, `/households/${HID}/home-projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ templateKey: 'blank', title: 'Ensuite' }),
    });
    const { project } = (await createRes.json()) as { project: { id: string } };

    // The attachment is written straight to D1: minting one through the route
    // needs an R2 round-trip, and what is under test is the cover pointer.
    const db = drizzle(testEnv.DB);
    await db.insert(schema.homeProjectAttachments).values({
      id: 'hpa_cover_1',
      project_id: project.id,
      kind: 'photo',
      url: 'https://example.test/cover.jpg',
      status: 'ready',
    });

    const patchRes = await req(app, `/households/${HID}/home-projects/${project.id}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ coverAttachmentId: 'hpa_cover_1' }),
    });
    expect(patchRes.status).toBe(200);

    const listRes = await req(app, `/households/${HID}/home-projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()) as {
      projects: { id: string; cover_attachment_id: string | null; cover_url: string | null }[];
    };
    const row = list.projects.find((p) => p.id === project.id);
    expect(row?.cover_attachment_id).toBe('hpa_cover_1');
    expect(row?.cover_url).toBe('https://example.test/cover.jpg');
  });

  it('refuses a cover belonging to another project', async () => {
    const app = mkApp();
    const token = await mintToken(UID);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const mk = async (title: string) => {
      const res = await req(app, `/households/${HID}/home-projects`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ templateKey: 'blank', title }),
      });
      return ((await res.json()) as { project: { id: string } }).project.id;
    };
    const mine = await mk('Ensuite');
    const theirs = await mk('Garage');

    const db = drizzle(testEnv.DB);
    await db.insert(schema.homeProjectAttachments).values({
      id: 'hpa_cover_2',
      project_id: theirs,
      kind: 'photo',
      url: 'https://example.test/other.jpg',
      status: 'ready',
    });

    // `cover_attachment_id` has no foreign key, so without the service's check
    // this would succeed and the list would hand one project another's photo.
    const patchRes = await req(app, `/households/${HID}/home-projects/${mine}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ coverAttachmentId: 'hpa_cover_2' }),
    });
    expect(patchRes.status).toBe(404);
  });

  it('reports no cover when the upload never reached ready', async () => {
    const app = mkApp();
    const token = await mintToken(UID);
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const createRes = await req(app, `/households/${HID}/home-projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ templateKey: 'blank', title: 'Half-uploaded' }),
    });
    const { project } = (await createRes.json()) as { project: { id: string } };

    const db = drizzle(testEnv.DB);
    await db.insert(schema.homeProjectAttachments).values({
      id: 'hpa_cover_3',
      project_id: project.id,
      kind: 'photo',
      url: null,
      status: 'pending_upload',
    });
    await req(app, `/households/${HID}/home-projects/${project.id}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ coverAttachmentId: 'hpa_cover_3' }),
    });

    const listRes = await req(app, `/households/${HID}/home-projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()) as { projects: { id: string; cover_url: string | null }[] };
    // The card falls back to its placeholder rather than rendering a broken tile.
    expect(list.projects.find((p) => p.id === project.id)?.cover_url).toBeNull();
  });
});

/**
 * The project's own jobs — migration 0170.
 *
 * The link used to be `home_project_tasks`, a join with no primary key, which
 * is why a local-first household could not hold it at all and why the Smart
 * Project wizard shipped its "Tasks" tick-box disabled. It is now a JSON array
 * on the project row, so these tests assert the COLUMN as well as the response:
 * a route that answered correctly while writing nowhere would look identical
 * from the outside.
 */
describe('linked tasks', () => {
  async function project(token: string, title: string): Promise<string> {
    const res = await req(mkApp(), `/households/${HID}/home-projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ templateKey: 'blank', title }),
    });
    const { project: created } = (await res.json()) as { project: { id: string } };
    return created.id;
  }

  async function storedIds(projectId: string): Promise<string[]> {
    const row = await testEnv.DB.prepare(
      'SELECT linked_task_ids AS ids FROM home_projects WHERE id = ?'
    )
      .bind(projectId)
      .first<{ ids: string | null }>();
    return JSON.parse(row?.ids ?? '[]') as string[];
  }

  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createHomeProjectTables(testEnv.DB);
    // `createTaskFromProject` goes through `TaskService.createTask`, which reads
    // the new task back through `getTask` — and that composes its subtasks. The
    // shared helper does not build this table because nothing else in this file
    // reaches `TaskService` at all.
    await testEnv.DB.prepare(
      `CREATE TABLE IF NOT EXISTS maintenance_subtasks (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
        is_completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, completed_by TEXT,
        reminder_enabled INTEGER DEFAULT 0, reminder_days_before INTEGER DEFAULT 1,
        reminder_time TEXT DEFAULT '09:00', reminder_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by TEXT, deleted_at TEXT
      )`
    ).run();
    await resetAllTables(testEnv.DB);
    await seedHousehold();
  });

  it('creates a job from inside the project and stores the link on the row', async () => {
    const token = await mintToken(UID);
    const projectId = await project(token, 'Shed');

    const res = await req(mkApp(), `/households/${HID}/home-projects/${projectId}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Confirm shed circuit capacity' }),
    });
    expect(res.status).toBe(201);
    const { link } = (await res.json()) as {
      link: { project_id: string; task_id: string; title: string };
    };
    expect(link.title).toBe('Confirm shed circuit capacity');
    expect(await storedIds(projectId)).toEqual([link.task_id]);

    const listRes = await req(
      mkApp(),
      `/households/${HID}/home-projects/${projectId}/tasks`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { tasks } = (await listRes.json()) as {
      tasks: { task_id: string; title: string }[];
    };
    expect(tasks).toEqual([
      expect.objectContaining({ task_id: link.task_id, title: link.title }),
    ]);
  });

  it('attaches an existing job once, however many times it is asked', async () => {
    const token = await mintToken(UID);
    const projectId = await project(token, 'Loft');
    await testEnv.DB.prepare(
      'INSERT INTO tasks (id, household_id, title, frequency) VALUES (?, ?, ?, ?)'
    )
      .bind('task_loft_hatch', HID, 'Clear the loft hatch', 'one_time')
      .run();

    const link = async () =>
      req(mkApp(), `/households/${HID}/home-projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskId: 'task_loft_hatch' }),
      });
    expect((await link()).status).toBe(201);
    expect((await link()).status).toBe(201);

    // Idempotent through the column, not through a UNIQUE constraint — the row
    // is rewritten only when the array actually changes.
    expect(await storedIds(projectId)).toEqual(['task_loft_hatch']);
  });

  it('refuses a job from another household', async () => {
    const token = await mintToken(UID);
    const projectId = await project(token, 'Garage');
    await testEnv.DB.prepare(
      'INSERT INTO tasks (id, household_id, title, frequency) VALUES (?, ?, ?, ?)'
    )
      .bind('task_elsewhere', 'hh_someone_else', 'Not yours', 'one_time')
      .run();

    const res = await req(mkApp(), `/households/${HID}/home-projects/${projectId}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskId: 'task_elsewhere' }),
    });
    expect(res.status).toBe(404);
    expect(await storedIds(projectId)).toEqual([]);
  });

  it('skips a job the household has since deleted rather than reporting a blank row', async () => {
    const token = await mintToken(UID);
    const projectId = await project(token, 'Deck');
    for (const [id, title] of [
      ['task_boards', 'Order the boards'],
      ['task_sander', 'Hire the sander'],
    ]) {
      await testEnv.DB.prepare(
        'INSERT INTO tasks (id, household_id, title, frequency) VALUES (?, ?, ?, ?)'
      )
        .bind(id, HID, title, 'one_time')
        .run();
      await req(mkApp(), `/households/${HID}/home-projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskId: id }),
      });
    }
    await testEnv.DB.prepare('DELETE FROM tasks WHERE id = ?').bind('task_sander').run();

    const listRes = await req(
      mkApp(),
      `/households/${HID}/home-projects/${projectId}/tasks`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { tasks } = (await listRes.json()) as { tasks: { task_id: string }[] };
    expect(tasks.map((t) => t.task_id)).toEqual(['task_boards']);
    // The link stays: the member deleted a job, not a decision about which
    // project it belonged to.
    expect(await storedIds(projectId)).toHaveLength(2);
  });
});
