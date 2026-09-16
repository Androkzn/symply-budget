/**
 * `localGardenPlansApi` against a real in-memory session (plan §6 DoD, H11
 * sub-wave C3).
 *
 * Seven behaviours are load-bearing beyond the round trips:
 *
 *  - **Deleting a plan takes its objects and markers with it, in ONE op** — even
 *    though D1's cascade never fires, because the server soft-deletes and the
 *    ledger cannot. C2 established that inversion; C3 repeats it, so the list is
 *    derived from the Drizzle sources rather than hand-written, which is the
 *    pair `localContractorsApi.test.ts` grew after B2 shipped a silent orphan.
 *  - **The boundary-draft window is REAL.** `HOUSE_WINDOWED_DATE_FIELDS` names
 *    `created_at`, and the DTO that table's row type is built from does not
 *    declare one. `rowBucket` reads `row['created_at']` and falls through to
 *    always-resident on `undefined`, so before C3 added the field the entry
 *    would have been configured-looking and inert — a form of §11.1.3's hazard
 *    that `waveBCSchemaParity` cannot see, because the D1 column is a perfectly
 *    good `text`. Proved here at runtime, and by `tsc` on the seeder.
 *  - **A boundary draft is scoped to a MEMBER**, not to the property. It is the
 *    only such row in the registry, and reading a peer's must 404.
 *  - **The object layer sorts on a column the DTO does not carry.** `sort_order`
 *    survives to the screen only as the JSON array's order; a ledger is an
 *    unordered row set, so losing it draws the same garden differently on two
 *    devices.
 *  - **`replaceObjects` runs the SERVER's clamp**, not the near-identical client
 *    one in `@models/garden-objects`, which keeps an object's body inside the
 *    plan rather than its centre.
 *  - **A garden marker is not a floor-plan marker.** No hit-test, no task
 *    back-fill, different defaults — porting C2's `createMarker` would add
 *    behaviour the server does not have.
 *  - **`linked_entity_type` is normalised on write**, and here that makes the
 *    method work where the server's own does not: this route has no
 *    `z.preprocess`, so the only value the client type permits is 400-rejected.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import type { GardenPlanObject } from '@models/garden-objects';

import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import {
  HouseLocalUnknownPropertyError,
  HouseLocalUnsupportedError,
} from '../errors';
import {
  GARDEN_PLAN_CHILD_TABLES,
  localGardenPlansApi,
} from '../localGardenPlansApi';
import {
  ALWAYS_RESIDENT_BUCKET,
  applyLedgerDelta,
  captureLedgerSnapshot,
  diffLedger,
  rowBucket,
} from '../projection';
import {
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_LEDGER_TABLE_NAMES,
} from '../schema';
import type {
  LocalGardenPlan,
  LocalGardenPlanBoundaryDraft,
  LocalGardenPlanMarker,
  LocalGardenPlanObject,
} from '../types';

import {
  emptyHouseLedger,
  stampAt,
  taskRow,
  TEST_HOUSEHOLD_ID,
} from './houseLedgerTestKit';

const USER = 'user-garden-plans-1';

let householdId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

/**
 * A plan row as the UPLOAD or generation flow would have written it — the shape
 * a household that used Symply before going local-first arrives with.
 *
 * Neither of those flows can mint one on device (`getUploadUrl` is an H6 throw,
 * generation is P4), which is why these tests seed directly. `createMapPlan` is
 * the exception and the one creation path that does work locally; it has its own
 * describe block below and seeds nothing.
 */
function seedPlan(
  id: string,
  overrides: Partial<LocalGardenPlan> = {},
): LocalGardenPlan {
  const plan: LocalGardenPlan = {
    id,
    household_id: householdId,
    plan_type: 'back_yard',
    original_file_key: `garden-plans/${householdId}/${id}/yard.png`,
    display_image_key: `garden-plans/${householdId}/${id}/yard.png`,
    thumbnail_key: `garden-plans/${householdId}/${id}/yard.png`,
    filename: 'yard.png',
    file_size: 240_000,
    content_type: 'image/png',
    label: 'Back lawn',
    width_px: 1600,
    height_px: 1200,
    status: 'completed',
    error_message: null,
    reference_image_source: null,
    boundary_draft_id: null,
    boundary_source: null,
    boundary_geojson: null,
    geocode_place_name: null,
    created_by: USER,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
  getLocalHouseLedger().gardenPlans.push(plan);
  return plan;
}

function seedObject(
  id: string,
  gardenPlanId: string,
  overrides: Partial<LocalGardenPlanObject> = {},
): LocalGardenPlanObject {
  const object: LocalGardenPlanObject = {
    id,
    household_id: householdId,
    garden_plan_id: gardenPlanId,
    type: 'tree',
    x: 0.5,
    y: 0.5,
    width: 0.12,
    height: 0.12,
    rotation: 0,
    label: 'Tree',
    color: '#2F855A',
    metadata: null,
    sort_order: 0,
    ...overrides,
  };
  getLocalHouseLedger().gardenPlanObjects.push(object);
  return object;
}

function seedMarker(
  id: string,
  gardenPlanId: string,
  overrides: Partial<LocalGardenPlanMarker> = {},
): LocalGardenPlanMarker {
  const marker: LocalGardenPlanMarker = {
    id,
    household_id: householdId,
    garden_plan_id: gardenPlanId,
    x_percent: 10,
    y_percent: 10,
    linked_entity_type: 'task',
    linked_entity_id: 'task-1',
    marker_color: '#4CAF50',
    marker_icon: '🌿',
    label: null,
    show_label: true,
    space_id: null,
    created_by: USER,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
  getLocalHouseLedger().gardenPlanMarkers.push(marker);
  return marker;
}

/**
 * A boundary draft as the retired satellite flow would have written it.
 *
 * The literal is typed, which is half of the window guard: `created_at` and
 * `updated_at` are on the ROW TYPE and not on the DTO, so removing either from
 * `LocalGardenPlanBoundaryDraft` makes `tsc` reject this object rather than
 * letting the window quietly stop working.
 */
function seedDraft(
  id: string,
  overrides: Partial<LocalGardenPlanBoundaryDraft> = {},
): LocalGardenPlanBoundaryDraft {
  const draft: LocalGardenPlanBoundaryDraft = {
    id,
    household_id: householdId,
    user_id: USER,
    status: 'draft',
    address: {
      address_line1: '12 Elm Street',
      city: 'Victoria',
      country: 'CA',
    },
    formatted_address: '12 Elm Street, Victoria, CA',
    geocode: { lat: 48.42, lon: -123.36, place_name: 'Victoria' },
    parcel: null,
    confirmed_boundary: null,
    boundary_source: null,
    preview_image_key: null,
    reference_image_key: null,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
  getLocalHouseLedger().gardenPlanBoundaryDrafts.push(draft);
  return draft;
}

/** A garden object exactly as the editor hands one to `replaceObjects`. */
function objectInput(
  overrides: Partial<GardenPlanObject> = {},
): GardenPlanObject {
  return {
    id: 'client-minted-id',
    type: 'shrub',
    x: 0.5,
    y: 0.5,
    width: 0.09,
    height: 0.09,
    rotation: 0,
    label: 'Shrub',
    color: '#68A357',
    metadata: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({
    userId: USER,
    displayName: 'Garden plans test home',
  });
  householdId = ledger.household.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('garden plans — the yard plan itself', () => {
  it('lists newest first', async () => {
    seedPlan('gp_old', { created_at: '2026-01-01T09:00:00.000Z' });
    seedPlan('gp_new', { created_at: '2026-06-01T09:00:00.000Z' });

    const all = await localGardenPlansApi.list(householdId);
    expect(all.garden_plans.map(row => row.id)).toEqual(['gp_new', 'gp_old']);
    expect(all.next_cursor).toBeUndefined();
  });

  it('caps the page at the limit and reports a cursor, exactly as the Worker does', async () => {
    for (let i = 0; i < 4; i += 1) {
      seedPlan(`gp_${i}`, { created_at: `2026-0${i + 1}-01T09:00:00.000Z` });
    }
    const page = await localGardenPlansApi.list(householdId, { limit: 2 });
    expect(page.garden_plans).toHaveLength(2);
    // The cursor is the last kept row's id — and the Worker never consumes it on
    // the way back in, which is reproduced rather than fixed.
    expect(page.next_cursor).toBe(page.garden_plans[1]!.id);
    // …which is exactly what "reproduced" means: page two is page one.
    const second = await localGardenPlansApi.list(householdId, {
      limit: 2,
      cursor: page.next_cursor,
    });
    expect(second.garden_plans.map(r => r.id)).toEqual(
      page.garden_plans.map(r => r.id),
    );
  });

  it('updates metadata and leaves an untouched field alone', async () => {
    const plan = seedPlan('gp_1');
    const updated = await localGardenPlansApi.update(householdId, plan.id, {
      plan_type: 'garden',
      label: '',
    });
    expect(updated.garden_plan.plan_type).toBe('garden');
    // An EMPTY STRING is stored as one — the Worker spreads `data` with no
    // `|| null`, so clearing a label offline and online must agree.
    expect(updated.garden_plan.label).toBe('');
    expect(updated.garden_plan.updated_at > plan.created_at).toBe(true);
  });

  it('raises for a plan that does not exist, and for another property', async () => {
    await expect(
      localGardenPlansApi.get(householdId, 'gp_missing'),
    ).rejects.toThrow('Garden plan not found');
    await expect(localGardenPlansApi.list('hh_other')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });

  it('stores an edited boundary as the JSON STRING the editor parses back', async () => {
    seedPlan('gp_1');
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    const result = await localGardenPlansApi.updateBoundary(
      householdId,
      'gp_1',
      {
        boundary_geojson: geometry,
        boundary_source: 'user_drawn',
      },
    );

    // The OPPOSITE call to C2's `svg_data` and B3's `linked_report_ids`: here the
    // DTO agrees with D1 that this column is a string, `useBoundaryEditor` calls
    // `JSON.parse` on it, and storing the object would break every read.
    expect(typeof result.garden_plan.boundary_geojson).toBe('string');
    expect(JSON.parse(result.garden_plan.boundary_geojson!)).toEqual(geometry);
    expect(result.garden_plan.boundary_source).toBe('user_drawn');
  });
});

describe('createMapPlan — the only creation path a local-first home has', () => {
  const LOT = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-79.38, 43.651],
        [-79.3787, 43.651],
        [-79.3787, 43.65],
        [-79.38, 43.65],
        [-79.38, 43.651],
      ],
    ],
  };

  it('creates a viewable plan with no bytes at all', async () => {
    const { garden_plan: plan } = await localGardenPlansApi.createMapPlan(householdId, {
      plan_type: 'back_yard',
      label: 'Back lawn',
      boundary_geojson: LOT,
    });

    // The three properties that make this legal where `getUploadUrl` is not:
    // no R2 key, no bytes, and an honest content type.
    expect(plan.original_file_key).toBe('');
    expect(plan.file_size).toBe(0);
    expect(plan.content_type).toBe('application/geo+json');
    expect(plan.display_image_key).toBeNull();

    // `completed` is the truth rather than optimism — nothing is queued.
    expect(plan.status).toBe('completed');
    expect(plan.boundary_source).toBe('user_drawn');

    const fetched = await localGardenPlansApi.get(householdId, plan.id);
    expect(fetched.garden_plan.id).toBe(plan.id);
  });

  it('stores the boundary as the JSON STRING every viewer parses back', async () => {
    const { garden_plan: plan } = await localGardenPlansApi.createMapPlan(householdId, {
      plan_type: 'garden',
      boundary_geojson: LOT,
    });
    expect(typeof plan.boundary_geojson).toBe('string');
    expect(JSON.parse(plan.boundary_geojson as string)).toEqual(LOT);
  });

  it('writes the plan AND its objects in ONE op', async () => {
    // Between a plan op and an objects op, a peer would hold a traced lot with
    // no areas in it and no signal that more was coming.
    const before = opCount();
    await localGardenPlansApi.createMapPlan(householdId, {
      plan_type: 'back_yard',
      boundary_geojson: LOT,
      objects: [
        {
          id: 'zone-1',
          type: 'zone',
          x: 0.5,
          y: 0.5,
          width: 0.9,
          height: 0.9,
          rotation: 0,
          label: 'Back yard',
          color: '#15803D',
          metadata: { zone: { kind: 'back_yard', polygon: [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95]] } },
        },
        {
          id: 'tree-1',
          type: 'tree',
          x: 0.3,
          y: 0.3,
          width: 0.1,
          height: 0.1,
          rotation: 0,
          label: 'Maple',
          color: '#2F855A',
          metadata: null,
        },
      ] as GardenPlanObject[],
    });
    expect(opCount()).toBe(before + 1);
  });

  it('keeps array order as z-order, so zones sit under the things on them', async () => {
    const { garden_plan: plan } = await localGardenPlansApi.createMapPlan(householdId, {
      plan_type: 'back_yard',
      boundary_geojson: LOT,
      objects: [
        {
          id: 'z',
          type: 'zone',
          x: 0.5,
          y: 0.5,
          width: 0.8,
          height: 0.8,
          rotation: 0,
          label: 'Back yard',
          color: '#15803D',
          metadata: { zone: { kind: 'back_yard', polygon: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]] } },
        },
        {
          id: 't',
          type: 'tree',
          x: 0.4,
          y: 0.4,
          width: 0.1,
          height: 0.1,
          rotation: 0,
          label: 'Maple',
          color: '#2F855A',
          metadata: null,
        },
      ] as GardenPlanObject[],
    });

    const { objects } = await localGardenPlansApi.listObjects(householdId, plan.id);
    expect(objects.map((o) => o.type)).toEqual(['zone', 'tree']);
  });

  it('lets a ZONE span the whole lot where an element may not', async () => {
    // The clamp is type-aware on both backends: 0.03..0.8 for an element,
    // 0.01..1 for a zone. A back yard spanning the full width of the lot is the
    // normal case, and clamping it to 0.8 would shrink what the member traced.
    const { garden_plan: plan } = await localGardenPlansApi.createMapPlan(householdId, {
      plan_type: 'back_yard',
      boundary_geojson: LOT,
      objects: [
        {
          id: 'z',
          type: 'zone',
          x: 0.5,
          y: 0.5,
          width: 1,
          height: 1,
          rotation: 0,
          label: 'Back yard',
          color: '#15803D',
          metadata: { zone: { kind: 'back_yard', polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] } },
        },
        {
          id: 'p',
          type: 'patio',
          x: 0.5,
          y: 0.5,
          width: 1,
          height: 1,
          rotation: 0,
          label: 'Patio',
          color: '#64748B',
          metadata: null,
        },
      ] as GardenPlanObject[],
    });

    const { objects } = await localGardenPlansApi.listObjects(householdId, plan.id);
    const zone = objects.find((o) => o.type === 'zone');
    const patio = objects.find((o) => o.type === 'patio');
    expect(zone?.width).toBe(1);
    expect(patio?.width).toBe(0.8);
  });

  it('carries the zone ring through metadata untouched', async () => {
    const ring = [
      [0.05, 0.05],
      [0.95, 0.05],
      [0.95, 0.95],
      [0.05, 0.95],
    ];
    const { garden_plan: plan } = await localGardenPlansApi.createMapPlan(householdId, {
      plan_type: 'back_yard',
      boundary_geojson: LOT,
      objects: [
        {
          id: 'z',
          type: 'zone',
          x: 0.5,
          y: 0.5,
          width: 0.9,
          height: 0.9,
          rotation: 0,
          label: 'Back yard',
          color: '#15803D',
          metadata: { zone: { kind: 'back_yard', polygon: ring } },
        },
      ] as GardenPlanObject[],
    });

    const { objects } = await localGardenPlansApi.listObjects(householdId, plan.id);
    expect(objects[0].metadata).toEqual({ zone: { kind: 'back_yard', polygon: ring } });
  });

  it('refuses a property that is not the open one', async () => {
    await expect(
      localGardenPlansApi.createMapPlan('some-other-household', {
        plan_type: 'garden',
        boundary_geojson: LOT,
      }),
    ).rejects.toBeInstanceOf(HouseLocalUnknownPropertyError);
  });

  it('shows up in the list beside plans that arrived by upload', async () => {
    seedPlan('gp_uploaded', { created_at: '2026-01-01T09:00:00.000Z' });
    await localGardenPlansApi.createMapPlan(householdId, {
      plan_type: 'front_yard',
      boundary_geojson: LOT,
    });

    const { garden_plans } = await localGardenPlansApi.list(householdId);
    expect(garden_plans).toHaveLength(2);
    expect(garden_plans.some((p) => p.content_type === 'application/geo+json')).toBe(true);
  });
});

describe('garden plans — the delete, and the cascade D1 declares but never fires', () => {
  /**
   * The regression this exists for is B2's, three sub-waves later, with C2's
   * twist: the SCHEMA says "cascade" and the SERVER never triggers it, so a
   * reader checking either half alone reaches the wrong answer. The list is
   * therefore derived from the Drizzle sources rather than hand-written — a
   * third ledgered table pointing at `garden_plans` with `onDelete: 'cascade'`
   * fails in milliseconds instead of leaking rows to every peer forever.
   */
  it('drops exactly the ledgered tables D1 declares — checked against the schema', () => {
    const schemaDir = join(__dirname, '../../../../../backend/src/db');
    const sources = readdirSync(schemaDir)
      .filter(f => f.startsWith('schema') && f.endsWith('.ts'))
      .map(f => readFileSync(join(schemaDir, f), 'utf8'))
      .join('\n');

    const blocks = sources
      .split(/export const \w+ = sqliteTable\(\s*'/)
      .slice(1);
    const cascading = new Set<string>();
    for (const block of blocks) {
      const physical = block.slice(0, block.indexOf("'"));
      if (
        /references\(\(\)\s*=>\s*gardenPlans\.id,\s*\{\s*onDelete:\s*'cascade'/.test(
          block,
        )
      ) {
        cascading.add(physical);
      }
    }

    // Non-vacuity: if the parse breaks, `cascading` empties and the comparison
    // below passes for the wrong reason. EXACTLY two tables declare this foreign
    // key, and naming both is the point.
    expect([...cascading].sort()).toEqual([
      'garden_plan_markers',
      'garden_plan_objects',
    ]);

    const live = HOUSE_LEDGER_TABLE_NAMES.filter(t =>
      cascading.has(HOUSE_LEDGER_PHYSICAL_TABLES[t]),
    );
    expect([...GARDEN_PLAN_CHILD_TABLES].sort()).toEqual([...live].sort());
  });

  it('does not treat the boundary draft as a child, because D1 does not', () => {
    // `garden_plans.boundary_draft_id` points AT a draft rather than the other
    // way round, and it carries no `references()` at all — so a draft is not a
    // child of a plan by any mechanism. Proved against the schema rather than
    // asserted in a comment: this is the one exclusion in the block that a reader
    // might "fix" by adding a third entry to the cascade list.
    const source = readFileSync(
      join(__dirname, '../../../../../backend/src/db/schema-garden-plans.ts'),
      'utf8',
    );
    expect(source).toContain("boundary_draft_id: text('boundary_draft_id')");
    expect(source).not.toMatch(
      /boundary_draft_id: text\('boundary_draft_id'\)[\s\S]{0,120}references\(/,
    );
    expect([...GARDEN_PLAN_CHILD_TABLES]).not.toContain(
      'gardenPlanBoundaryDrafts',
    );
  });

  it('takes the objects and the markers with it, in ONE op', async () => {
    const plan = seedPlan('gp_1');
    const other = seedPlan('gp_2');
    seedObject('gpo_1', plan.id);
    seedObject('gpo_2', plan.id, { sort_order: 1 });
    seedMarker('gpm_1', plan.id);
    // A second plan's children must survive — a filter on the wrong column would
    // empty both and every assertion below would still pass.
    const keptObject = seedObject('gpo_kept', other.id);
    const keptMarker = seedMarker('gpm_kept', other.id);

    const before = opCount();
    await localGardenPlansApi.delete(householdId, plan.id);
    expect(opCount() - before).toBe(1);

    const after = getLocalHouseLedger();
    expect(after.gardenPlans.map(row => row.id)).toEqual([other.id]);
    expect(after.gardenPlanObjects.map(row => row.id)).toEqual([keptObject.id]);
    expect(after.gardenPlanMarkers.map(row => row.id)).toEqual([keptMarker.id]);
  });

  it('leaves the boundary draft it was generated from alone', async () => {
    // A member who generated three plans from one traced lot must not lose the
    // tracing by deleting one of them — and the server does not touch it either.
    const draft = seedDraft('gpd_1', { status: 'generated' });
    const plan = seedPlan('gp_1', { boundary_draft_id: draft.id });

    await localGardenPlansApi.delete(householdId, plan.id);
    expect(
      getLocalHouseLedger().gardenPlanBoundaryDrafts.map(r => r.id),
    ).toEqual([draft.id]);
  });

  it('leaves the linked task alone', async () => {
    // The pin recorded where the job is; removing the drawing is not a claim
    // that the job moved. `GardenPlanService.delete` touches no task either.
    const plan = seedPlan('gp_1');
    getLocalHouseLedger().tasks.push(
      taskRow('task-1', { household_id: householdId }) as never,
    );
    seedMarker('gpm_1', plan.id, { linked_entity_id: 'task-1' });

    await localGardenPlansApi.delete(householdId, plan.id);
    expect(getLocalHouseLedger().tasks.map(row => row.id)).toEqual(['task-1']);
  });

  it('raises for a plan that does not exist', async () => {
    await expect(
      localGardenPlansApi.delete(householdId, 'gp_missing'),
    ).rejects.toThrow('Garden plan not found');
  });
});

/**
 * The child removal, proved through the MERGE rather than through the local
 * ledger.
 *
 * The failure mode only appears on a second device: a peer that received the
 * plan tombstone but not the objects' would hold up to eighty rows for a drawing
 * it no longer has — invisible, because nothing reads an object without its plan,
 * and permanent, because a tombstone is absorbing.
 */
describe('garden plans — the delete converges on a peer', () => {
  const STAMP_A = stampAt(10, 'member-a', 'op-a');
  const STAMP_B = stampAt(20, 'member-b', 'op-b');

  it('carries the plan and both children in one delta', () => {
    const deviceA = emptyHouseLedger();
    const peer = emptyHouseLedger();

    const plan = { id: 'gp_1', household_id: TEST_HOUSEHOLD_ID } as never;
    const object = {
      id: 'gpo_1',
      garden_plan_id: 'gp_1',
      household_id: TEST_HOUSEHOLD_ID,
    } as never;
    const marker = {
      id: 'gpm_1',
      garden_plan_id: 'gp_1',
      household_id: TEST_HOUSEHOLD_ID,
    } as never;

    const beforeCreate = captureLedgerSnapshot(deviceA);
    deviceA.gardenPlans.push(plan);
    deviceA.gardenPlanObjects.push(object);
    deviceA.gardenPlanMarkers.push(marker);
    applyLedgerDelta(peer, diffLedger(beforeCreate, deviceA)!, STAMP_A);

    expect(peer.gardenPlans).toHaveLength(1);
    expect(peer.gardenPlanObjects).toHaveLength(1);
    expect(peer.gardenPlanMarkers).toHaveLength(1);

    // One mutation across three tables — the shape `delete` produces.
    const beforeDelete = captureLedgerSnapshot(deviceA);
    deviceA.gardenPlans = [];
    deviceA.gardenPlanObjects = [];
    deviceA.gardenPlanMarkers = [];
    applyLedgerDelta(peer, diffLedger(beforeDelete, deviceA)!, STAMP_B);

    expect(peer.gardenPlans).toHaveLength(0);
    expect(peer.gardenPlanObjects).toHaveLength(0);
    expect(peer.gardenPlanMarkers).toHaveLength(0);
  });
});

describe("a map-drawn plan reaches the member's OTHER device", () => {
  const STAMP_A = stampAt(10, 'device-iphone', 'op-a');
  const STAMP_B = stampAt(20, 'device-ipad', 'op-b');
  const STAMP_C = stampAt(30, 'device-iphone', 'op-c');

  const LOT = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-79.38, 43.651],
        [-79.3787, 43.651],
        [-79.3787, 43.65],
        [-79.38, 43.65],
        [-79.38, 43.651],
      ],
    ],
  };

  /** The L-shaped ring, in the object's own frame, as `buildZoneMetadata` stores it. */
  const ZONE_RING = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0],
    [0, 0],
    [0, 0.5],
    [-0.5, 0.5],
  ];

  function mapPlanRows(planId: string) {
    return {
      plan: {
        id: planId,
        household_id: TEST_HOUSEHOLD_ID,
        plan_type: 'back_yard',
        original_file_key: '',
        display_image_key: null,
        thumbnail_key: null,
        filename: 'Back lawn.geojson',
        file_size: 0,
        content_type: 'application/geo+json',
        label: 'Back lawn',
        status: 'completed',
        boundary_source: 'user_drawn',
        boundary_geojson: JSON.stringify(LOT),
        created_by: 'member-1',
        created_at: '2026-09-04T10:00:00.000Z',
        updated_at: '2026-09-04T10:00:00.000Z',
      } as never,
      zone: {
        id: 'gpo_zone',
        household_id: TEST_HOUSEHOLD_ID,
        garden_plan_id: planId,
        type: 'zone',
        x: 0.5,
        y: 0.5,
        width: 0.9,
        height: 0.9,
        rotation: 0,
        label: 'Back yard',
        color: '#15803D',
        metadata: { zone: { kind: 'back_yard', polygon: ZONE_RING }, shape: 'rectangle' },
        sort_order: 0,
      } as never,
      element: {
        id: 'gpo_shed',
        household_id: TEST_HOUSEHOLD_ID,
        garden_plan_id: planId,
        type: 'patio',
        x: 0.3,
        y: 0.3,
        width: 0.1,
        height: 0.1,
        rotation: 0,
        label: 'Shed',
        color: '#92400E',
        metadata: { presetId: 'shed', iconKey: 'shed', shape: 'square' },
        sort_order: 1,
      } as never,
    };
  }

  it('carries the boundary, the zone RING and the elements in one delta', () => {
    // The whole plan is written in ONE op (`createMapPlan`), so this is the
    // delta the iPad actually receives — not a sequence the test invented.
    const iphone = emptyHouseLedger();
    const ipad = emptyHouseLedger();
    const { plan, zone, element } = mapPlanRows('gp_map_1');

    const before = captureLedgerSnapshot(iphone);
    iphone.gardenPlans.push(plan);
    iphone.gardenPlanObjects.push(zone, element);
    applyLedgerDelta(ipad, diffLedger(before, iphone)!, STAMP_A);

    expect(ipad.gardenPlans).toHaveLength(1);
    expect(ipad.gardenPlanObjects).toHaveLength(2);

    // A map plan is defined by what it does NOT carry as much as by what it
    // does: no bytes, no R2 key, and a content type that says so. If any of
    // these arrived wrong the iPad would try to fetch an image that was never
    // uploaded.
    const arrived = ipad.gardenPlans[0] as unknown as Record<string, unknown>;
    expect(arrived.content_type).toBe('application/geo+json');
    expect(arrived.original_file_key).toBe('');
    expect(arrived.display_image_key).toBeNull();

    // The boundary is the coordinate frame every object is stored against, so a
    // truncated or re-encoded string here silently moves every zone and feature
    // on the other device.
    expect(JSON.parse(arrived.boundary_geojson as string)).toEqual(LOT);
  });

  it('preserves the zone ring EXACTLY — a nested array inside metadata', () => {
    // This is the assertion that earns the file. `metadata` is the only field in
    // the whole feature holding a nested array, and the ledger diff compares
    // non-scalars by `JSON.stringify` rather than by reference — so a projection
    // that flattened, stringified or dropped it would still sync a zone, just a
    // rectangular one. The member would see their traced L-shaped back yard
    // arrive on the iPad as a box, with nothing on screen suggesting loss.
    const iphone = emptyHouseLedger();
    const ipad = emptyHouseLedger();
    const { plan, zone, element } = mapPlanRows('gp_map_2');

    const before = captureLedgerSnapshot(iphone);
    iphone.gardenPlans.push(plan);
    iphone.gardenPlanObjects.push(zone, element);
    applyLedgerDelta(ipad, diffLedger(before, iphone)!, STAMP_A);

    const arrivedZone = ipad.gardenPlanObjects.find(
      (row) => (row as unknown as Record<string, unknown>).type === 'zone',
    ) as unknown as Record<string, unknown>;
    expect(arrivedZone.metadata).toEqual({
      zone: { kind: 'back_yard', polygon: ZONE_RING },
      shape: 'rectangle',
    });
    // Six corners, not four: the concave notch is the part a bbox would lose.
    expect(
      ((arrivedZone.metadata as Record<string, never>).zone as unknown as {
        polygon: number[][];
      }).polygon,
    ).toHaveLength(6);
  });

  it('keeps z-order, so zones stay UNDER the features on both devices', () => {
    // `sort_order` is the only thing carrying z-order — the array order is lost
    // the moment rows land in a ledger, which is an unordered set. A zone that
    // sorts above its features covers them.
    const iphone = emptyHouseLedger();
    const ipad = emptyHouseLedger();
    const { plan, zone, element } = mapPlanRows('gp_map_3');

    const before = captureLedgerSnapshot(iphone);
    iphone.gardenPlans.push(plan);
    // Pushed in the WRONG order deliberately: if the assertion below read
    // insertion order instead of `sort_order` it would fail here.
    iphone.gardenPlanObjects.push(element, zone);
    applyLedgerDelta(ipad, diffLedger(before, iphone)!, STAMP_A);

    const ordered = [...ipad.gardenPlanObjects].sort(
      (a, b) =>
        ((a as unknown as Record<string, number>).sort_order ?? 0) -
        ((b as unknown as Record<string, number>).sort_order ?? 0),
    );
    expect(ordered.map((r) => (r as unknown as Record<string, string>).type)).toEqual([
      'zone',
      'patio',
    ]);
  });

  it('merges an iPad boundary edit with an iPhone feature edit, losing neither', () => {
    // The real two-device case: the plan is made on the phone, then both
    // devices touch it before either syncs. They edit DIFFERENT tables, and the
    // ledger merges per row and per field — so this must converge to both
    // changes rather than to whichever arrived second.
    const iphone = emptyHouseLedger();
    const ipad = emptyHouseLedger();
    const { plan, zone, element } = mapPlanRows('gp_map_4');

    const seeded = captureLedgerSnapshot(iphone);
    iphone.gardenPlans.push(plan);
    iphone.gardenPlanObjects.push(zone, element);
    const seedDelta = diffLedger(seeded, iphone)!;
    applyLedgerDelta(ipad, seedDelta, STAMP_A);

    // iPad: drags the lot boundary.
    const ipadBefore = captureLedgerSnapshot(ipad);
    (ipad.gardenPlans[0] as unknown as Record<string, unknown>).boundary_geojson =
      JSON.stringify({ ...LOT, coordinates: [[[-79.381, 43.652]]] });
    (ipad.gardenPlans[0] as unknown as Record<string, unknown>).boundary_source =
      'user_adjusted';
    const ipadDelta = diffLedger(ipadBefore, ipad)!;

    // iPhone: renames the shed, at a LATER stamp.
    const phoneBefore = captureLedgerSnapshot(iphone);
    const shed = iphone.gardenPlanObjects.find(
      (row) => (row as unknown as Record<string, unknown>).id === 'gpo_shed',
    ) as unknown as Record<string, unknown>;
    shed.label = 'Tool shed';
    const phoneDelta = diffLedger(phoneBefore, iphone)!;

    // Exchange both ways.
    applyLedgerDelta(iphone, ipadDelta, STAMP_B);
    applyLedgerDelta(ipad, phoneDelta, STAMP_C);

    for (const [name, side] of [
      ['iphone', iphone],
      ['ipad', ipad],
    ] as const) {
      const p = side.gardenPlans[0] as unknown as Record<string, unknown>;
      const s = side.gardenPlanObjects.find(
        (row) => (row as unknown as Record<string, unknown>).id === 'gpo_shed',
      ) as unknown as Record<string, unknown>;
      expect(`${name}:${p.boundary_source}`).toBe(`${name}:user_adjusted`);
      expect(`${name}:${s.label}`).toBe(`${name}:Tool shed`);
      // And the untouched zone ring is still intact on both.
      const z = side.gardenPlanObjects.find(
        (row) => (row as unknown as Record<string, unknown>).type === 'zone',
      ) as unknown as Record<string, unknown>;
      expect((z.metadata as { zone: { polygon: number[][] } }).zone.polygon).toHaveLength(6);
    }
  });

  it('propagates a DELETE of a map plan to the other device', () => {
    // A plan removed on the phone must not linger on the iPad. The ledger has no
    // foreign keys, so the delete has to carry the children explicitly — the
    // same one-op shape `deleteGardenPlan` produces.
    const iphone = emptyHouseLedger();
    const ipad = emptyHouseLedger();
    const { plan, zone, element } = mapPlanRows('gp_map_5');

    const before = captureLedgerSnapshot(iphone);
    iphone.gardenPlans.push(plan);
    iphone.gardenPlanObjects.push(zone, element);
    applyLedgerDelta(ipad, diffLedger(before, iphone)!, STAMP_A);
    expect(ipad.gardenPlanObjects).toHaveLength(2);

    const beforeDelete = captureLedgerSnapshot(iphone);
    iphone.gardenPlans = [];
    iphone.gardenPlanObjects = [];
    applyLedgerDelta(ipad, diffLedger(beforeDelete, iphone)!, STAMP_B);

    expect(ipad.gardenPlans).toHaveLength(0);
    expect(ipad.gardenPlanObjects).toHaveLength(0);
  });
});

describe('the vector object layer', () => {
  it('reads in sort_order, not in insertion order', async () => {
    // `sort_order` survives to the screen only as the JSON array's order, so the
    // column had to be added to the row type. Seeded deliberately out of order:
    // without the sort this returns the ledger's order and passes for the wrong
    // reason on a two-row fixture only if they happen to align.
    seedPlan('gp_1');
    seedObject('gpo_c', 'gp_1', { sort_order: 2, label: 'Third' });
    seedObject('gpo_a', 'gp_1', { sort_order: 0, label: 'First' });
    seedObject('gpo_b', 'gp_1', { sort_order: 1, label: 'Second' });
    // Another plan's objects must not leak in.
    seedPlan('gp_2');
    seedObject('gpo_other', 'gp_2', { sort_order: 0, label: 'Elsewhere' });

    const { objects } = await localGardenPlansApi.listObjects(
      householdId,
      'gp_1',
    );
    expect(objects.map(o => o.label)).toEqual(['First', 'Second', 'Third']);
    // The projection drops the three columns the DTO does not declare, rather
    // than spreading the row and handing a screen keys it should not learn.
    expect(Object.keys(objects[0]!).sort()).toEqual(
      [
        'color',
        'height',
        'id',
        'label',
        'metadata',
        'rotation',
        'type',
        'width',
        'x',
        'y',
      ].sort(),
    );
  });

  it('replaces the whole layer in ONE op, with fresh ids and index order', async () => {
    seedPlan('gp_1');
    seedObject('gpo_stale', 'gp_1');
    seedPlan('gp_2');
    seedObject('gpo_other', 'gp_2');

    const before = opCount();
    const { objects } = await localGardenPlansApi.replaceObjects(
      householdId,
      'gp_1',
      [
        objectInput({ id: 'client-a', label: 'Bed' }),
        objectInput({ id: 'client-b', type: 'path', label: 'Path' }),
      ],
    );
    expect(opCount() - before).toBe(1);

    // The caller's ids are DISCARDED — `replaceObjects` mints its own even
    // though its input type carries one. Reproduced, because that is what a
    // round trip through the Worker already does.
    expect(objects.map(o => o.id)).not.toContain('client-a');
    expect(objects.every(o => o.id.startsWith('gpo_'))).toBe(true);

    const rows = getLocalHouseLedger().gardenPlanObjects;
    expect(
      rows.filter(r => r.garden_plan_id === 'gp_1').map(r => r.sort_order),
    ).toEqual([0, 1]);
    // The stale layer is gone and the OTHER plan's is untouched.
    expect(rows.map(r => r.id)).not.toContain('gpo_stale');
    expect(rows.map(r => r.id)).toContain('gpo_other');
  });

  it('runs the SERVER clamp, not the client one', async () => {
    seedPlan('gp_1');
    const { objects } = await localGardenPlansApi.replaceObjects(
      householdId,
      'gp_1',
      [objectInput({ x: -3, y: 4, width: 0.001, height: 5, rotation: -90 })],
    );
    const object = objects[0]!;
    // Position clamps to the plan bounds — the object's CENTRE, so x is 0 and
    // not `width / 2`. `@models/garden-objects.normalizeGardenObject` would have
    // returned 0.015 here, and storing that would draw the same garden
    // differently on the two backends.
    expect(object.x).toBe(0);
    expect(object.y).toBe(1);
    expect(object.width).toBe(0.03);
    expect(object.height).toBe(0.8);
    expect(object.rotation).toBe(270);
  });

  it('sanitises text the way the service does, and survives a NaN size', async () => {
    seedPlan('gp_1');
    const { objects } = await localGardenPlansApi.replaceObjects(
      householdId,
      'gp_1',
      [
        objectInput({
          label: '   ',
          color: `#${'a'.repeat(40)}`,
          width: Number.NaN,
        }),
      ],
    );
    const object = objects[0]!;
    // Whitespace-only becomes null rather than an empty string.
    expect(object.label).toBeNull();
    expect(object.color).toHaveLength(24);
    // `clamp` returns MIN on a non-finite value, so a NaN width is the smallest
    // legal object rather than an invisible one.
    expect(object.width).toBe(0.03);
  });

  it('drops the excess at eighty, silently, on both backends', async () => {
    seedPlan('gp_1');
    const many = Array.from({ length: 90 }, (_, i) =>
      objectInput({ label: `Object ${i}` }),
    );
    const { objects } = await localGardenPlansApi.replaceObjects(
      householdId,
      'gp_1',
      many,
    );
    expect(objects).toHaveLength(80);
    expect(objects[79]!.label).toBe('Object 79');
  });

  it('treats an empty array as a legal save that clears the layer', async () => {
    seedPlan('gp_1');
    seedObject('gpo_1', 'gp_1');
    const { objects } = await localGardenPlansApi.replaceObjects(
      householdId,
      'gp_1',
      [],
    );
    expect(objects).toEqual([]);
    expect(getLocalHouseLedger().gardenPlanObjects).toEqual([]);
  });

  it('raises for a plan that does not exist', async () => {
    await expect(
      localGardenPlansApi.listObjects(householdId, 'gp_missing'),
    ).rejects.toThrow('Garden plan not found');
    await expect(
      localGardenPlansApi.replaceObjects(householdId, 'gp_missing', []),
    ).rejects.toThrow('Garden plan not found');
  });
});

describe('markers — the pin, and every way it is NOT a floor-plan pin', () => {
  it('normalises the entity type the route refuses to', async () => {
    seedPlan('gp_1');
    const { marker } = await localGardenPlansApi.createMarker(
      householdId,
      'gp_1',
      {
        x_percent: 10,
        y_percent: 10,
        linked_entity_type: 'task',
        linked_entity_id: 'task-1',
      },
    );
    // The DTO says `'task'`; D1 admits only `'maintenance_task'` and
    // `'action_item'`. Floor plans have a `z.preprocess` bridging the two and
    // this route does not, so the only value `CreateMarkerRequest` permits is
    // 400-rejected — creating a garden pin has never worked against the server.
    expect(marker.linked_entity_type as string).toBe('maintenance_task');
    // The garden defaults, which differ from the floor plan's `#FF6B6B` / `📍`.
    expect(marker.marker_color).toBe('#4CAF50');
    expect(marker.marker_icon).toBe('🌿');
    expect(marker.show_label).toBe(true);
    expect(marker.household_id).toBe(householdId);
    // And there is no `marker_type` on this table at all.
    expect(marker as unknown as Record<string, unknown>).not.toHaveProperty(
      'marker_type',
    );
  });

  it('runs NO space hit-test and back-fills NO task', async () => {
    // The anti-C2 assertion, and the reason it is worth a test rather than a
    // comment: `localFloorPlansApi.createMarker` does both, the two modules read
    // almost identically, and porting the hit-test here would file a task into a
    // room because a member dropped a pin on a photo of the lawn.
    seedPlan('gp_1');
    getLocalHouseLedger().householdSpaces.push({
      id: 'sp_lawn',
      household_id: householdId,
      name: 'Lawn',
      plan_x_percent: 0,
      plan_y_percent: 0,
      plan_width_percent: 100,
      plan_height_percent: 100,
    } as never);
    getLocalHouseLedger().tasks.push(
      taskRow('task-1', { household_id: householdId, space_id: null }) as never,
    );

    const { marker } = await localGardenPlansApi.createMarker(
      householdId,
      'gp_1',
      {
        x_percent: 50,
        y_percent: 50,
        linked_entity_type: 'task',
        linked_entity_id: 'task-1',
      },
    );
    expect(marker.space_id).toBeNull();
    expect(
      getLocalHouseLedger().tasks.find(r => r.id === 'task-1')?.space_id,
    ).toBeNull();
  });

  it('honours an explicit space, because that is all the caller can supply', async () => {
    seedPlan('gp_1');
    const { marker } = await localGardenPlansApi.createMarker(
      householdId,
      'gp_1',
      {
        x_percent: 50,
        y_percent: 50,
        linked_entity_type: 'task',
        linked_entity_id: 'task-1',
        space_id: 'sp_explicit',
      },
    );
    expect(marker.space_id).toBe('sp_explicit');
  });

  it('finds a pin by its entity despite the read side of that translation missing', async () => {
    seedPlan('gp_1');
    await localGardenPlansApi.createMarker(householdId, 'gp_1', {
      x_percent: 10,
      y_percent: 10,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
    });

    // The route reads the path parameter raw and compares it to the stored
    // column, so `'task'` matches nothing on the server, ever. Reproducing that
    // would be a 200 with an empty list for a member who can see the pin.
    const found = await localGardenPlansApi.getMarkersForEntity(
      householdId,
      'task',
      'task-1',
    );
    expect(found.markers).toHaveLength(1);
    expect(
      (
        await localGardenPlansApi.getMarkersForEntity(
          householdId,
          'task',
          'task-2',
        )
      ).markers,
    ).toEqual([]);
  });

  it("lists a plan's markers newest first, updates and deletes one", async () => {
    seedPlan('gp_1');
    const { marker } = await localGardenPlansApi.createMarker(
      householdId,
      'gp_1',
      {
        x_percent: 10,
        y_percent: 10,
        linked_entity_type: 'task',
        linked_entity_id: 'task-1',
        label: 'Prune',
      },
    );

    expect(
      (await localGardenPlansApi.listMarkers(householdId, 'gp_1')).markers,
    ).toHaveLength(1);

    const updated = await localGardenPlansApi.updateMarker(
      householdId,
      marker.id,
      {
        x_percent: 55,
        label: 'Prune the hedge',
        show_label: false,
      },
    );
    expect(updated.marker.x_percent).toBe(55);
    expect(updated.marker.show_label).toBe(false);

    await localGardenPlansApi.deleteMarker(householdId, marker.id);
    expect(
      (await localGardenPlansApi.listMarkers(householdId, 'gp_1')).markers,
    ).toEqual([]);
    await expect(
      localGardenPlansApi.deleteMarker(householdId, marker.id),
    ).rejects.toThrow('Marker not found');
  });
});

describe('boundary drafts — the only per-member rows in the ledger', () => {
  it('hides a draft another member started, even though the row synced', async () => {
    seedDraft('gpd_mine');
    seedDraft('gpd_theirs', { user_id: 'user-someone-else' });

    const { boundary_drafts } = await localGardenPlansApi.listBoundaryDrafts(
      householdId,
    );
    expect(boundary_drafts.map(d => d.id)).toEqual(['gpd_mine']);
    // `getInternal` matches on `(id, household_id, user_id)` and 404s otherwise.
    await expect(
      localGardenPlansApi.getBoundaryDraft(householdId, 'gpd_theirs'),
    ).rejects.toThrow('Garden plan boundary draft not found');
  });

  it('applies all five of the pending list decisions', async () => {
    seedDraft('gpd_draft', { updated_at: '2026-08-02T09:00:00.000Z' });
    seedDraft('gpd_confirmed', {
      status: 'confirmed',
      updated_at: '2026-08-03T09:00:00.000Z',
    });
    // The three statuses the list refuses. `generated` is the important one: its
    // plan is what the member sees now.
    seedDraft('gpd_generated', { status: 'generated' });
    seedDraft('gpd_generating', { status: 'generating' });
    seedDraft('gpd_expired_status', { status: 'expired' });
    // …and one that is still `draft` but past its expiry.
    seedDraft('gpd_stale', { expires_at: '2020-01-01T00:00:00.000Z' });

    const { boundary_drafts } = await localGardenPlansApi.listBoundaryDrafts(
      householdId,
    );
    // Ordered by `updated_at` descending, both statuses kept, the rest dropped.
    expect(boundary_drafts.map(d => d.id)).toEqual([
      'gpd_confirmed',
      'gpd_draft',
    ]);
  });

  it('caps the pending list at ten, as the Worker does', async () => {
    for (let i = 0; i < 14; i += 1) {
      seedDraft(`gpd_${i}`, {
        updated_at: `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`,
      });
    }
    const { boundary_drafts } = await localGardenPlansApi.listBoundaryDrafts(
      householdId,
    );
    expect(boundary_drafts).toHaveLength(10);
    // Newest first, so the cap drops the OLDEST four rather than an arbitrary
    // ten — which only holds because the sort runs before the slice.
    expect(boundary_drafts[0]!.id).toBe('gpd_13');
  });

  it('rebuilds the preview URL from the key rather than storing one', async () => {
    seedDraft('gpd_1', {
      preview_image_key: 'garden-plans/hh/gpd_1/preview.png',
    });
    const { boundary_draft } = await localGardenPlansApi.getBoundaryDraft(
      householdId,
      'gpd_1',
    );
    // The row deliberately omits `preview_image_url` — a stored URL is
    // per-viewer and goes stale, and per-field LWW would carry one member's dead
    // link to every peer (`LedgeredHousehold.photo_url`, Wave A).
    expect(boundary_draft.preview_image_url).toBe(
      '/files/garden-plans/hh/gpd_1/preview.png',
    );
    expect(
      getLocalHouseLedger().gardenPlanBoundaryDrafts[0] as unknown as Record<
        string,
        unknown
      >,
    ).not.toHaveProperty('preview_image_url');
    // `parcel` is the literal null on the DTO; D1's five parcel columns have
    // never been reachable from a client.
    expect(boundary_draft.parcel).toBeNull();
  });

  it('answers a null preview URL rather than a broken one', async () => {
    seedDraft('gpd_1');
    const { boundary_draft } = await localGardenPlansApi.getBoundaryDraft(
      householdId,
      'gpd_1',
    );
    expect(boundary_draft.preview_image_url).toBeNull();
  });

  it('hard-deletes a pending draft and refuses a generated one', async () => {
    seedDraft('gpd_1');
    seedDraft('gpd_done', { status: 'generated' });

    await localGardenPlansApi.deleteBoundaryDraft(householdId, 'gpd_1');
    expect(
      getLocalHouseLedger().gardenPlanBoundaryDrafts.map(d => d.id),
    ).toEqual(['gpd_done']);

    // The Worker's own status guard: a draft whose plan has been built is not
    // the member's to discard, so it 404s rather than being removed.
    await expect(
      localGardenPlansApi.deleteBoundaryDraft(householdId, 'gpd_done'),
    ).rejects.toThrow('Garden plan boundary draft not found');
  });

  it('leaves a plan pointing at the draft it deleted, exactly as D1 does', async () => {
    // A dangling pointer on BOTH backends: the column carries no `references()`,
    // so D1 does not clear it either, and the one reader already tolerates a
    // missing draft. Repairing it locally would make a plan's provenance differ
    // between a household on the server and one on the ledger.
    seedDraft('gpd_1');
    seedPlan('gp_1', { boundary_draft_id: 'gpd_1' });
    await localGardenPlansApi.deleteBoundaryDraft(householdId, 'gpd_1');
    expect(getLocalHouseLedger().gardenPlans[0]!.boundary_draft_id).toBe(
      'gpd_1',
    );
  });
});

/**
 * The window guard — §11.1.3's hazard in the form `waveBCSchemaParity` cannot
 * see.
 *
 * That suite checks the window names a `text` column in D1, and `created_at`
 * genuinely is one. What it cannot check is whether the ROW carries the field:
 * `GardenPlanBoundaryDraft` does not declare it, and a ledger row IS the DTO, so
 * before C3 added it to `LocalGardenPlanBoundaryDraft` this window would have
 * read `undefined`, yielded no `YYYY-MM`, and bucketed every draft
 * always-resident while looking configured.
 *
 * Both halves are proved: `tsc` rejects `seedDraft`'s typed literal if the field
 * leaves the row type, and the assertion below fails at runtime if the registry
 * entry leaves `HOUSE_WINDOWED_DATE_FIELDS`.
 */
describe('the boundary-draft window actually buckets', () => {
  it('buckets a draft by the month it was created', () => {
    const draft = {
      id: 'gpd_1',
      created_at: '2026-03-14T09:00:00.000Z',
    } as unknown as Record<string, unknown>;
    expect(rowBucket('gardenPlanBoundaryDrafts', draft)).toBe('2026-03');
    // Non-vacuity: the same row through a table with no window falls to
    // always-resident, which is what a dead window would have produced here.
    expect(rowBucket('gardenPlans', draft)).toBe(ALWAYS_RESIDENT_BUCKET);
  });

  it('keeps the three drawing tables always-resident', () => {
    // A dated row through each: if a window were added to any of them, this is
    // what would notice. An object or marker in a colder bucket renders a garden
    // that looks complete and is missing the tree.
    const row = {
      id: 'x',
      created_at: '2026-03-14T09:00:00.000Z',
    } as unknown as Record<string, unknown>;
    for (const table of [
      'gardenPlans',
      'gardenPlanObjects',
      'gardenPlanMarkers',
    ] as const) {
      expect(rowBucket(table, row)).toBe(ALWAYS_RESIDENT_BUCKET);
    }
  });
});

describe('the eight gaps are throws, not silence', () => {
  const thrown: [string, () => Promise<unknown>][] = [
    ['getUploadUrl', () => localGardenPlansApi.getUploadUrl()],
    ['uploadFile', () => localGardenPlansApi.uploadFile()],
    ['confirmUpload', () => localGardenPlansApi.confirmUpload()],
    ['createBoundaryDraft', () => localGardenPlansApi.createBoundaryDraft()],
    ['confirmBoundaryDraft', () => localGardenPlansApi.confirmBoundaryDraft()],
    [
      'generateFromBoundaryDraft',
      () => localGardenPlansApi.generateFromBoundaryDraft(),
    ],
    ['cancelGeneration', () => localGardenPlansApi.cancelGeneration()],
    ['retryGeneration', () => localGardenPlansApi.retryGeneration()],
  ];

  it.each(thrown)(
    '%s raises rather than resolving empty',
    async (_name, call) => {
      // Resolving `{ boundary_drafts: [] }` or `{ garden_plan_id: '' }` is the §6
      // failure the Proxy exists to prevent: the screen renders empty AND correct.
      await expect(call()).rejects.toThrow(HouseLocalUnsupportedError);
    },
  );

  it('carries member-facing copy rather than the identifier', async () => {
    await localGardenPlansApi
      .createBoundaryDraft()
      .catch((error: HouseLocalUnsupportedError) => {
        expect(error.message).not.toContain('gardenPlansApi');
        expect(error.method).toBe('gardenPlansApi.createBoundaryDraft');
      });
  });

  it('tells the truth about the retired flow rather than blaming private mode', async () => {
    // The two boundary-draft throws are not a local-first limitation: their
    // routes are 410 for every household. Copy that blamed private mode would be
    // a lie a member could disprove by switching it off.
    for (const method of [
      'createBoundaryDraft',
      'confirmBoundaryDraft',
    ] as const) {
      const error = await localGardenPlansApi[method]().catch(
        (e: HouseLocalUnsupportedError) => e,
      );
      expect(error.title.toLowerCase()).toContain('retired');
      expect(error.title.toLowerCase()).not.toContain('private mode');
    }
    // …and neither offers a way to turn it back on, because there is none.
    for (const method of [
      'createBoundaryDraft',
      'confirmBoundaryDraft',
    ] as const) {
      const error = await localGardenPlansApi[method]().catch(
        (e: HouseLocalUnsupportedError) => e,
      );
      expect(error.needsAiProvider).toBe(false);
    }
    // …while the model run, which a provider key genuinely DOES turn on, says
    // so and routes there. The distinction is the whole point of writing two
    // sets of copy: one names a fix the member can act on, the other does not
    // pretend there is one.
    const generate = await localGardenPlansApi
      .generateFromBoundaryDraft()
      .catch((e: HouseLocalUnsupportedError) => e);
    expect(generate.title.toLowerCase()).toContain('ai provider');
    expect(generate.needsAiProvider).toBe(true);
  });
});
