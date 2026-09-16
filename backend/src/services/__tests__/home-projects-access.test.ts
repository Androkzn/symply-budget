/**
 * Drafts, per-project roles and delete — the Worker half (migration 0163).
 *
 * `packages/contracts/__tests__/homeProjectAccess.test.ts` proves the RESOLVER
 * both backends share. What that cannot prove is that this service actually
 * calls it on every path, which is the whole point of the change: a single
 * `listProjects` or `getHub` that forgot the check would leak a private plan to
 * the household, and a single write method that forgot it would let a view-only
 * member edit a renovation they are not responsible for.
 *
 * So the assertions here are about REACH rather than about logic — every read
 * hides a peer's draft, every write refuses a viewer, and the delete takes its
 * children with it.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { HomeProjectsService } from '../home-projects-service';

const testEnv = env as unknown as Env;
const HID = 'hh_hpa_1';
const ALICE = 'u_hpa_alice';
const BOB = 'u_hpa_bob';
const CAROL = 'u_hpa_carol';
const OUTSIDER = 'u_hpa_outsider';

/**
 * The home-project tables, at migration 0163.
 *
 * Written out rather than replayed from `backend/migrations/` because these
 * suites run inside workerd, whose fs proxy cannot read this repo's spaced path
 * — the same constraint `vitest.config.ts` documents for the document fixtures.
 * Only the tables this suite touches are created; the delete cascade is asserted
 * against the ones that exist.
 */
async function createHomeProjectTables(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS home_projects (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'renovation',
      template_key TEXT,
      status TEXT NOT NULL DEFAULT 'planning',
      visibility TEXT NOT NULL DEFAULT 'published',
      default_role TEXT NOT NULL DEFAULT 'owner',
      access_json TEXT,
      summary TEXT,
      goals TEXT,
      constraints TEXT,
      target_budget_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      contingency_pct INTEGER NOT NULL DEFAULT 15,
      target_start_at TEXT,
      target_end_at TEXT,
      cover_attachment_id TEXT,
      -- Migration 0166.
      target_use TEXT,
      -- Migration 0170: the project own jobs, replacing home_project_tasks.
      linked_task_ids TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_spaces (
      project_id TEXT NOT NULL, space_id TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_budget_lines (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other', label TEXT NOT NULL,
      estimate_cents INTEGER NOT NULL DEFAULT 0, actual_cents INTEGER NOT NULL DEFAULT 0,
      selection_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_option_groups (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'finish', area_value REAL, area_unit TEXT,
      area_source TEXT NOT NULL DEFAULT 'manual',
      waste_factor_pct INTEGER NOT NULL DEFAULT 10, preferred_selection_id TEXT,
      -- Migration 0166 provenance.
      draft_source TEXT NOT NULL DEFAULT 'manual', draft_confidence TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_selections (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      -- Migration 0105's CHECK, mirrored for the reason spelled out in
      -- home-projects.test.ts: a laxer test schema hid a 500 in production.
      status TEXT NOT NULL DEFAULT 'idea'
        CHECK (status IN ('idea','shortlisted','approved','rejected','ordered','installed')),
      qty INTEGER NOT NULL DEFAULT 1, unit TEXT, unit_price_cents INTEGER,
      vendor TEXT, product_url TEXT, surface_ref TEXT, notes TEXT,
      assignee_user_id TEXT, option_group_id TEXT, brand TEXT, sku TEXT,
      image_url TEXT, coverage_per_unit REAL, coverage_unit TEXT, specs_json TEXT,
      extraction_source TEXT NOT NULL DEFAULT 'manual', extraction_confidence TEXT,
      -- Appearance + sale pricing (migration 0164), mirrored from the migration's
      -- nullable ALTERs. This is the second hand-written copy of this table's
      -- shape; see the note in routes/__tests__/home-projects.test.ts.
      color_hex TEXT, grout_color_hex TEXT, unit_w_mm REAL, unit_h_mm REAL,
      list_price_cents INTEGER, sale_price_cents INTEGER,
      discount_pct INTEGER, sale_ends_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_phases (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', starts_on TEXT, ends_on TEXT,
      draft_source TEXT NOT NULL DEFAULT 'manual', draft_confidence TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_milestones (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, phase_id TEXT,
      title TEXT NOT NULL, due_on TEXT, done_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_blockers (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open',
      notes TEXT, resolved_at TEXT,
      draft_source TEXT NOT NULL DEFAULT 'manual', draft_confidence TEXT,
      -- Migration 0171. getHub orders blockers on this, so a copy of the table
      -- without it fails every read in this file — the hazard the note on the
      -- selections table above is about, hit for the second time.
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_attachments (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, selection_id TEXT,
      kind TEXT NOT NULL DEFAULT 'photo', r2_key TEXT, url TEXT, filename TEXT,
      content_type TEXT, file_size INTEGER, caption TEXT, tags TEXT,
      status TEXT NOT NULL DEFAULT 'pending_upload', created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_plan_links (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, floor_plan_id TEXT NOT NULL,
      zone_payload TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_geometry (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'completed',
      schema_version INTEGER NOT NULL DEFAULT 1, payload_json TEXT,
      confidence TEXT, disclaimer TEXT, error_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_comments (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, selection_id TEXT,
      user_id TEXT NOT NULL, body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_activity (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_user_id TEXT,
      action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, meta_json TEXT,
      idempotency_key TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_contractors (
      project_id TEXT NOT NULL, contractor_id TEXT NOT NULL, quote_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const sql of statements) await db.prepare(sql).run();
}

const HOME_PROJECT_TABLES = [
  'home_projects',
  'home_project_spaces',
  'home_project_budget_lines',
  'home_project_option_groups',
  'home_project_selections',
  'home_project_phases',
  'home_project_milestones',
  'home_project_blockers',
  'home_project_attachments',
  'home_project_plan_links',
  'home_project_geometry',
  'home_project_comments',
  'home_project_activity',
  'home_project_contractors',
];

function svc(): HomeProjectsService {
  return new HomeProjectsService(testEnv, testEnv.DB);
}

beforeEach(async () => {
  await createCoreTables(testEnv.DB);
  await createHomeProjectTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  for (const table of HOME_PROJECT_TABLES) {
    await testEnv.DB.prepare(`DELETE FROM ${table}`).run();
  }

  const db = drizzle(testEnv.DB, { schema });
  const now = new Date().toISOString();
  for (const [id, email] of [
    [ALICE, 'alice@example.com'],
    [BOB, 'bob@example.com'],
    [CAROL, 'carol@example.com'],
    [OUTSIDER, 'outsider@example.com'],
  ]) {
    await db
      .insert(schema.users)
      .values({ id, email, display_name: id, created_at: now, updated_at: now } as never)
      .run();
  }
  await db
    .insert(schema.households)
    .values({ id: HID, name: 'Test home', created_at: now, updated_at: now } as never)
    .run();
  // OUTSIDER is deliberately NOT a member — the household gate is the outermost
  // of the three checks and must still be the first thing that fires.
  for (const [mid, uid, role] of [
    ['m_alice', ALICE, 'owner'],
    ['m_bob', BOB, 'member'],
    ['m_carol', CAROL, 'member'],
  ]) {
    await db
      .insert(schema.householdMembers)
      .values({
        id: mid,
        household_id: HID,
        user_id: uid,
        role,
        joined_at: now,
        created_at: now,
        updated_at: now,
      } as never)
      .run();
  }
});

describe('a draft is private to its creator', () => {
  it('defaults a new project to published, so nothing existing changes', async () => {
    const project = await svc().createProject(HID, ALICE, { title: 'Ensuite' });
    expect(project.visibility).toBe('published');
    expect(project.default_role).toBe('owner');
  });

  it('keeps a draft out of every other member’s list', async () => {
    const draft = await svc().createProject(HID, ALICE, {
      title: 'Quiet plan',
      visibility: 'draft',
    });
    await svc().createProject(HID, ALICE, { title: 'Shared plan' });

    const alices = await svc().listProjects(HID, ALICE);
    const bobs = await svc().listProjects(HID, BOB);

    expect(alices.map((p) => p.id)).toContain(draft.id);
    expect(bobs.map((p) => p.id)).not.toContain(draft.id);
    expect(bobs.map((p) => p.title)).toEqual(['Shared plan']);
  });

  it('answers "not found" for a peer opening a draft, never "forbidden"', async () => {
    // "You may not open this" would tell Bob the project exists, which is
    // exactly what a draft must not reveal — and it is already the answer for a
    // project id from another household, so the two are indistinguishable.
    const draft = await svc().createProject(HID, ALICE, {
      title: 'Quiet plan',
      visibility: 'draft',
    });
    await expect(svc().getHub(HID, BOB, draft.id)).rejects.toThrow(/not found/i);
    await expect(svc().listActivity(HID, BOB, draft.id)).rejects.toThrow(/not found/i);
    await expect(
      svc().createSelection(HID, BOB, draft.id, { name: 'Tile' })
    ).rejects.toThrow(/not found/i);
  });

  it('shares it the moment it is published, and records that as its own event', async () => {
    const draft = await svc().createProject(HID, ALICE, {
      title: 'Quiet plan',
      visibility: 'draft',
    });
    await svc().updateProject(HID, ALICE, draft.id, { visibility: 'published' });

    const bobs = await svc().listProjects(HID, BOB);
    expect(bobs.map((p) => p.id)).toContain(draft.id);

    const { items } = await svc().listActivity(HID, ALICE, draft.id);
    expect(items.map((i) => i.action)).toContain('project_published');
  });

  it('lets only an owner publish', async () => {
    const project = await svc().createProject(HID, ALICE, { title: 'Shared' });
    await svc().setProjectAccess(HID, ALICE, project.id, {
      defaultRole: 'viewer',
      grants: [],
    });
    await expect(
      svc().updateProject(HID, BOB, project.id, { visibility: 'draft' })
    ).rejects.toThrow(/only a project owner/i);
  });
});

describe('per-project roles', () => {
  it('gives every member owner by default, which is the pre-0163 behaviour', async () => {
    const project = await svc().createProject(HID, ALICE, { title: 'Shared' });
    const hub = await svc().getHub(HID, BOB, project.id);
    expect(hub.my_role).toBe('owner');
    await expect(
      svc().createSelection(HID, BOB, project.id, { name: 'Tile' })
    ).resolves.toBeTruthy();
  });

  it('refuses a viewer every write while allowing every read', async () => {
    const project = await svc().createProject(HID, ALICE, { title: 'Shared' });
    await svc().setProjectAccess(HID, ALICE, project.id, {
      defaultRole: 'viewer',
      grants: [],
    });

    const hub = await svc().getHub(HID, BOB, project.id);
    expect(hub.my_role).toBe('viewer');
    await expect(svc().listActivity(HID, BOB, project.id)).resolves.toBeTruthy();

    for (const write of [
      () => svc().updateProject(HID, BOB, project.id, { title: 'Renamed' }),
      () => svc().createSelection(HID, BOB, project.id, { name: 'Tile' }),
      () => svc().createPhase(HID, BOB, project.id, { title: 'Demo' }),
      () => svc().createBlocker(HID, BOB, project.id, { title: 'Permit' }),
      () => svc().createBudgetLine(HID, BOB, project.id, { category: 'labor', label: 'Labor' }),
      () => svc().addComment(HID, BOB, project.id, { body: 'Nice' }),
      () => svc().archiveProject(HID, BOB, project.id),
      () => svc().deleteProject(HID, BOB, project.id),
    ]) {
      await expect(write()).rejects.toThrow(/view-only|only a project owner/i);
    }

    // Nothing landed.
    const after = await svc().getHub(HID, ALICE, project.id);
    expect(after.project.title).toBe('Shared');
    expect(after.selections).toHaveLength(0);
    expect(after.project.status).toBe('planning');
  });

  it('lets an explicit grant beat a restrictive default', async () => {
    const project = await svc().createProject(HID, ALICE, { title: 'Shared' });
    await svc().setProjectAccess(HID, ALICE, project.id, {
      defaultRole: 'viewer',
      grants: [{ user_id: BOB, role: 'owner' }],
    });

    expect((await svc().getHub(HID, BOB, project.id)).my_role).toBe('owner');
    expect((await svc().getHub(HID, CAROL, project.id)).my_role).toBe('viewer');
    await expect(
      svc().createSelection(HID, BOB, project.id, { name: 'Tile' })
    ).resolves.toBeTruthy();
  });

  it('keeps the creator an owner against a viewer default and a viewer grant', async () => {
    // The lockout guard: without it, "everyone view only" produces a project
    // nobody in the household can ever edit again.
    const project = await svc().createProject(HID, ALICE, { title: 'Shared' });
    await svc().setProjectAccess(HID, ALICE, project.id, {
      defaultRole: 'viewer',
      grants: [{ user_id: ALICE, role: 'viewer' }],
    });

    const access = await svc().getProjectAccess(HID, ALICE, project.id);
    expect(access.my_role).toBe('owner');
    expect(access.members.find((m) => m.user_id === ALICE)?.source).toBe('creator');
    // …and the pointless self-grant was dropped rather than stored.
    const row = await svc().getHub(HID, ALICE, project.id);
    expect(row.project.access_json).toBeNull();
  });

  it('lists every household member with the reason for their role', async () => {
    const project = await svc().createProject(HID, ALICE, { title: 'Shared' });
    await svc().setProjectAccess(HID, ALICE, project.id, {
      defaultRole: 'viewer',
      grants: [{ user_id: BOB, role: 'owner' }],
    });

    const access = await svc().getProjectAccess(HID, ALICE, project.id);
    const bySource = Object.fromEntries(access.members.map((m) => [m.user_id, m]));
    expect(Object.keys(bySource).sort()).toEqual([ALICE, BOB, CAROL].sort());
    expect(bySource[ALICE].source).toBe('creator');
    expect(bySource[BOB]).toMatchObject({ role: 'owner', source: 'grant' });
    expect(bySource[CAROL]).toMatchObject({ role: 'viewer', source: 'default' });
  });

  it('drops a grant for someone who is not in the household', async () => {
    // A member removed while the sheet was open must not make every later save
    // fail with an error about a person who is not on screen.
    const project = await svc().createProject(HID, ALICE, { title: 'Shared' });
    const access = await svc().setProjectAccess(HID, ALICE, project.id, {
      defaultRole: 'owner',
      grants: [
        { user_id: BOB, role: 'viewer' },
        { user_id: OUTSIDER, role: 'owner' },
      ],
    });
    expect(access.members.map((m) => m.user_id)).not.toContain(OUTSIDER);
    const hub = await svc().getHub(HID, ALICE, project.id);
    expect(JSON.parse(hub.project.access_json!)).toEqual([{ user_id: BOB, role: 'viewer' }]);
  });

  it('still refuses a non-member outright, before any role is considered', async () => {
    const project = await svc().createProject(HID, ALICE, { title: 'Shared' });
    await expect(svc().getHub(HID, OUTSIDER, project.id)).rejects.toThrow(
      /do not have access to this household/i
    );
  });
});

describe('deleteProject', () => {
  it('removes the project and every child row', async () => {
    const project = await svc().createProject(HID, ALICE, {
      title: 'Bathroom',
      templateKey: 'bathroom_reno',
    });
    await svc().createSelection(HID, ALICE, project.id, {
      name: 'Vanity',
      unitPriceCents: 80_000,
    });
    await svc().createBlocker(HID, ALICE, project.id, { title: 'Permit' });
    await svc().addComment(HID, ALICE, project.id, { body: 'Start in May' });
    const survivor = await svc().createProject(HID, ALICE, { title: 'Ensuite' });
    await svc().createSelection(HID, ALICE, survivor.id, { name: 'Paint' });

    await svc().deleteProject(HID, ALICE, project.id);

    await expect(svc().getHub(HID, ALICE, project.id)).rejects.toThrow(/not found/i);
    for (const table of HOME_PROJECT_TABLES.filter((t) => t !== 'home_projects')) {
      const row = await testEnv.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`
      )
        .bind(project.id)
        .first<{ n: number }>();
      expect({ table, n: row?.n }).toEqual({ table, n: 0 });
    }

    // Scoped to one project, not to the tables.
    const remaining = await svc().getHub(HID, ALICE, survivor.id);
    expect(remaining.selections).toHaveLength(1);
  });

  it('is reachable only by a project owner', async () => {
    const project = await svc().createProject(HID, ALICE, { title: 'Shared' });
    await svc().setProjectAccess(HID, ALICE, project.id, {
      defaultRole: 'viewer',
      grants: [],
    });
    await expect(svc().deleteProject(HID, BOB, project.id)).rejects.toThrow(
      /only a project owner/i
    );
    await expect(svc().getHub(HID, ALICE, project.id)).resolves.toBeTruthy();
  });

  it('answers "not found" rather than deleting a peer’s draft', async () => {
    const draft = await svc().createProject(HID, ALICE, {
      title: 'Quiet plan',
      visibility: 'draft',
    });
    await expect(svc().deleteProject(HID, BOB, draft.id)).rejects.toThrow(/not found/i);
    await expect(svc().getHub(HID, ALICE, draft.id)).resolves.toBeTruthy();
  });
});
