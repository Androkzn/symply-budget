/**
 * Material options — the shop-several-then-pick-one surface (migration 0162).
 *
 * The behaviour under test is mostly about MONEY, because that is where the
 * feature can quietly go wrong:
 *
 *  - five candidates must cost the project nothing until one is picked;
 *  - picking must produce exactly one budget line, and switching must MOVE that
 *    line rather than add a second;
 *  - editing the winner, or the area, must move the number with it;
 *  - a selection outside a group must behave exactly as it did before, because
 *    every project that already exists is made of those.
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

import { createHomeProjectTables } from './home-projects.test';

const testEnv = env as unknown as Env;

const HID = 'hh_hp_opts_01';
const UID = 'u_hp_opts_owner';
const MID = 'm_hp_opts_owner';

type BudgetLine = {
  id: string;
  label: string;
  category: string;
  estimate_cents: number;
  actual_cents: number;
  selection_id: string | null;
};
type Selection = {
  id: string;
  name: string;
  status: string;
  option_group_id: string | null;
  unit_price_cents: number | null;
  coverage_per_unit: number | null;
  coverage_unit: string | null;
  specs_json: string | null;
  extraction_source: string;
};
type OptionGroup = {
  id: string;
  name: string;
  area_value: number | null;
  area_unit: string | null;
  area_source: string;
  waste_factor_pct: number;
  preferred_selection_id: string | null;
  version: number;
};
type Hub = {
  selections: Selection[];
  option_groups: OptionGroup[];
  budget_lines: BudgetLine[];
  rollups: { estimate_total: number };
};

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
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });
  return app;
}

async function seedHousehold(): Promise<void> {
  const db = drizzle(testEnv.DB);
  await db.insert(schema.users).values({
    id: UID,
    email: `${UID}@example.com`,
    email_verified: true,
  });
  await db.insert(schema.households).values({ id: HID, name: 'Options House' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: new Date().toISOString(),
  });
}

describe('home project material options', () => {
  let app: Hono<{ Bindings: Env }>;
  let token: string;
  let projectId: string;

  async function call(path: string, init?: RequestInit): Promise<Response> {
    return app.request(
      `/households/${HID}/home-projects${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init?.headers as Record<string, string> | undefined),
        },
      },
      testEnv
    );
  }

  async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  async function hub(): Promise<Hub> {
    return json<Hub>(await call(`/${projectId}/hub`));
  }

  /** A group with an area, plus `count` priced tile options in it. */
  async function seedGroupWithOptions(
    count: number,
    overrides: Array<Partial<{ name: string; unitPriceCents: number; coveragePerUnit: number }>> = []
  ): Promise<{ groupId: string; optionIds: string[] }> {
    const groupRes = await call(`/${projectId}/option-groups`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Kitchen floor',
        areaValue: 24,
        areaUnit: 'm2',
        wasteFactorPct: 10,
      }),
    });
    const { option_group } = await json<{ option_group: OptionGroup }>(groupRes);

    const optionIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const o = overrides[i] ?? {};
      const res = await call(`/${projectId}/selections`, {
        method: 'POST',
        body: JSON.stringify({
          name: o.name ?? `Tile option ${i + 1}`,
          optionGroupId: option_group.id,
          unitPriceCents: o.unitPriceCents ?? 4599,
          coveragePerUnit: o.coveragePerUnit ?? 2.2,
          coverageUnit: 'm2',
        }),
      });
      expect(res.status).toBe(201);
      const { selection } = await json<{ selection: Selection }>(res);
      optionIds.push(selection.id);
    }
    return { groupId: option_group.id, optionIds };
  }

  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createHomeProjectTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await seedHousehold();
    app = mkApp();
    token = await mintToken(UID);
    const res = await call('', {
      method: 'POST',
      body: JSON.stringify({ templateKey: 'blank', title: 'Options project' }),
    });
    ({
      project: { id: projectId },
    } = await json<{ project: { id: string } }>(res));
  });

  it('costs the project nothing until an option is picked', async () => {
    await seedGroupWithOptions(5);
    const before = await hub();

    expect(before.selections).toHaveLength(5);
    // The whole point: five priced candidates, zero material lines.
    expect(before.budget_lines.filter((l) => l.category === 'materials')).toHaveLength(0);
  });

  it('picking one writes exactly one budget line, priced for the whole area', async () => {
    const { groupId, optionIds } = await seedGroupWithOptions(3);

    const res = await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[1] }),
    });
    expect(res.status).toBe(200);

    const after = await hub();
    const lines = after.budget_lines.filter((l) => l.category === 'materials');
    expect(lines).toHaveLength(1);
    // 24 m² + 10% = 26.4 m²; 2.2 m² a box → 12 boxes × $45.99.
    expect(lines[0]!.estimate_cents).toBe(55188);
    expect(lines[0]!.selection_id).toBe(optionIds[1]);
    expect(lines[0]!.label).toContain('Kitchen floor');
  });

  it('switching the pick moves the line instead of adding another', async () => {
    const { groupId, optionIds } = await seedGroupWithOptions(3, [
      { unitPriceCents: 4599 },
      { unitPriceCents: 6900 },
      { unitPriceCents: 3200 },
    ]);

    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[0] }),
    });
    const first = await hub();
    const firstLines = first.budget_lines.filter((l) => l.category === 'materials');
    expect(firstLines).toHaveLength(1);

    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[1] }),
    });
    const second = await hub();
    const secondLines = second.budget_lines.filter((l) => l.category === 'materials');

    expect(secondLines).toHaveLength(1);
    expect(secondLines[0]!.id).toBe(firstLines[0]!.id); // same row, re-pointed
    expect(secondLines[0]!.selection_id).toBe(optionIds[1]);
    expect(secondLines[0]!.estimate_cents).toBe(12 * 6900);
  });

  it('keeps actual_cents across a switch', async () => {
    const { groupId, optionIds } = await seedGroupWithOptions(2);
    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[0] }),
    });
    const lineId = (await hub()).budget_lines.find((l) => l.category === 'materials')!.id;

    // A deposit has been paid against this surface.
    await call(`/${projectId}/budget-lines/${lineId}`, {
      method: 'PATCH',
      body: JSON.stringify({ actualCents: 25000 }),
    });

    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[1] }),
    });

    const line = (await hub()).budget_lines.find((l) => l.category === 'materials')!;
    // Delete-and-recreate would silently zero this, and the member would be out
    // $250 on screen because they compared two tiles.
    expect(line.actual_cents).toBe(25000);
  });

  it('marks the winner approved and demotes the previous winner', async () => {
    const { groupId, optionIds } = await seedGroupWithOptions(3);

    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[0] }),
    });
    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[2] }),
    });

    const after = await hub();
    const byId = new Map(after.selections.map((s) => [s.id, s]));
    expect(byId.get(optionIds[2]!)!.status).toBe('approved');
    expect(byId.get(optionIds[0]!)!.status).not.toBe('approved');
    expect(after.option_groups[0]!.preferred_selection_id).toBe(optionIds[2]);
    // Exactly one winner, always.
    expect(after.selections.filter((s) => s.status === 'approved')).toHaveLength(1);
  });

  it('un-picking takes the money back out', async () => {
    const { groupId, optionIds } = await seedGroupWithOptions(2);
    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[0] }),
    });
    expect((await hub()).budget_lines.filter((l) => l.category === 'materials')).toHaveLength(1);

    const res = await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: null }),
    });
    expect(res.status).toBe(200);

    const after = await hub();
    expect(after.budget_lines.filter((l) => l.category === 'materials')).toHaveLength(0);
    expect(after.option_groups[0]!.preferred_selection_id).toBeNull();
  });

  it('re-prices the winner when the area changes', async () => {
    const { groupId, optionIds } = await seedGroupWithOptions(2);
    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[0] }),
    });

    await call(`/${projectId}/option-groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ areaValue: 48 }),
    });

    const line = (await hub()).budget_lines.find((l) => l.category === 'materials')!;
    // 48 m² + 10% = 52.8 → 24 boxes. The estimate must describe the new room.
    expect(line.estimate_cents).toBe(24 * 4599);
  });

  it('re-prices the winner when its own price is edited', async () => {
    const { groupId, optionIds } = await seedGroupWithOptions(2);
    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[0] }),
    });

    await call(`/${projectId}/selections/${optionIds[0]}`, {
      method: 'PATCH',
      body: JSON.stringify({ unitPriceCents: 5000 }),
    });

    const line = (await hub()).budget_lines.find((l) => l.category === 'materials')!;
    expect(line.estimate_cents).toBe(12 * 5000);
  });

  it('does not re-price the budget when a losing option is edited', async () => {
    const { groupId, optionIds } = await seedGroupWithOptions(2);
    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[0] }),
    });

    await call(`/${projectId}/selections/${optionIds[1]}`, {
      method: 'PATCH',
      body: JSON.stringify({ unitPriceCents: 999999 }),
    });

    const lines = (await hub()).budget_lines.filter((l) => l.category === 'materials');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.estimate_cents).toBe(12 * 4599);
  });

  it('typing an area marks it as the member’s own, not the floor plan’s', async () => {
    const res = await call(`/${projectId}/option-groups`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Bath tile', areaValue: 6, areaUnit: 'm2' }),
    });
    const { option_group } = await json<{ option_group: OptionGroup }>(res);
    expect(option_group.area_source).toBe('manual');
    expect(option_group.area_value).toBe(6);
  });

  it('prefills area from the project floor plan when the member gives none', async () => {
    // Both the v1 payload and the v2 Room Surface Model carry `floor.area_m2`
    // (v2 emits it as a legacy mirror), so one read serves both.
    await call(`/${projectId}/geometry/manual`, {
      method: 'PUT',
      body: JSON.stringify({ floor: { area_m2: 18.5 }, walls: [] }),
    });

    const res = await call(`/${projectId}/option-groups`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Kitchen floor' }),
    });
    const { option_group } = await json<{ option_group: OptionGroup }>(res);
    expect(option_group.area_value).toBe(18.5);
    expect(option_group.area_unit).toBe('m2');
    expect(option_group.area_source).toBe('geometry');
  });

  it('stops claiming plan provenance once the member overwrites the area', async () => {
    await call(`/${projectId}/geometry/manual`, {
      method: 'PUT',
      body: JSON.stringify({ floor: { area_m2: 18.5 }, walls: [] }),
    });
    const { option_group } = await json<{ option_group: OptionGroup }>(
      await call(`/${projectId}/option-groups`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Kitchen floor' }),
      })
    );
    expect(option_group.area_source).toBe('geometry');

    const patched = await json<{ option_group: OptionGroup }>(
      await call(`/${projectId}/option-groups/${option_group.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ areaValue: 21 }),
      })
    );
    expect(patched.option_group.area_value).toBe(21);
    expect(patched.option_group.area_source).toBe('manual');
  });

  it('leaves ungrouped selections behaving exactly as before', async () => {
    const res = await call(`/${projectId}/selections`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Vanity', unitPriceCents: 80000 }),
    });
    const { selection } = await json<{ selection: Selection }>(res);

    const after = await hub();
    const line = after.budget_lines.find((l) => l.selection_id === selection.id);
    // A standalone priced selection still writes its own line on create.
    expect(line).toBeDefined();
    expect(line!.estimate_cents).toBe(80000);
    expect(selection.option_group_id).toBeNull();
    expect(selection.extraction_source).toBe('manual');
  });

  it('deleting the winner clears the pick and its money', async () => {
    const { groupId, optionIds } = await seedGroupWithOptions(2);
    await call(`/${projectId}/option-groups/${groupId}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[0] }),
    });

    const res = await call(`/${projectId}/selections/${optionIds[0]}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const after = await hub();
    expect(after.option_groups[0]!.preferred_selection_id).toBeNull();
    expect(after.budget_lines.filter((l) => l.category === 'materials')).toHaveLength(0);
  });

  it('deleting a group keeps the researched options as loose ideas', async () => {
    const { groupId } = await seedGroupWithOptions(3);

    const res = await call(`/${projectId}/option-groups/${groupId}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const after = await hub();
    expect(after.option_groups).toHaveLength(0);
    // "We are not deciding this here" must not mean "throw away the research".
    expect(after.selections).toHaveLength(3);
    expect(after.selections.every((s) => s.option_group_id === null)).toBe(true);
  });

  it('refuses to pick an option that belongs to a different group', async () => {
    const { optionIds } = await seedGroupWithOptions(1);
    const other = await json<{ option_group: OptionGroup }>(
      await call(`/${projectId}/option-groups`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Bath tile', areaValue: 6, areaUnit: 'm2' }),
      })
    );

    const res = await call(`/${projectId}/option-groups/${other.option_group.id}/preferred`, {
      method: 'POST',
      body: JSON.stringify({ selectionId: optionIds[0] }),
    });
    expect(res.status).toBe(400);
  });

  it('refuses a group id from another project', async () => {
    const { project } = await json<{ project: { id: string } }>(
      await call('', {
        method: 'POST',
        body: JSON.stringify({ templateKey: 'blank', title: 'Someone else' }),
      })
    );
    const foreign = await json<{ option_group: OptionGroup }>(
      await call(`/${project.id}/option-groups`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Their floor' }),
      })
    );

    const res = await call(`/${projectId}/selections`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Tile', optionGroupId: foreign.option_group.id }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 on a stale option group version', async () => {
    const { groupId } = await seedGroupWithOptions(0);
    const res = await call(`/${projectId}/option-groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed', version: 99 }),
    });
    expect(res.status).toBe(409);
  });

  it('round-trips specs through the card', async () => {
    const { groupId } = await seedGroupWithOptions(0);
    const res = await call(`/${projectId}/selections`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Carrara 12x24',
        optionGroupId: groupId,
        unitPriceCents: 8900,
        specs: [
          { label: 'PEI rating', value: '4' },
          { label: 'Finish', value: 'Polished' },
        ],
      }),
    });
    const { selection } = await json<{ selection: Selection }>(res);
    expect(JSON.parse(selection.specs_json!)).toEqual([
      { label: 'PEI rating', value: '4' },
      { label: 'Finish', value: 'Polished' },
    ]);
  });
});
