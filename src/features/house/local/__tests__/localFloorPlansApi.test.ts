/**
 * `localFloorPlansApi` against a real in-memory session (plan §6 DoD, H11
 * sub-wave C2).
 *
 * Six behaviours are load-bearing beyond the round trips:
 *
 *  - **Deleting a plan takes its markers and annotations with it, in ONE op** —
 *    even though D1's cascade never fires, because the server soft-deletes and
 *    the ledger cannot. That inversion is the whole of C2's delete story, so it
 *    gets both a behavioural test and a schema-derived one, the pair
 *    `localContractorsApi.test.ts` grew after B2 shipped a silent orphan.
 *  - **`floor_plan_regions` is not on the ledger and cannot be reached.** Three
 *    methods throw rather than routing to a Worker that would answer an empty
 *    region list with a 200 for a plan it has never seen.
 *  - **A pin resolves its room by hit-test and back-fills the task.** Both are
 *    reads and writes of LIVE Wave-A tables, both are the Worker's arithmetic,
 *    and both must happen in the marker's own op.
 *  - **`linked_entity_type` is normalised on write.** The DTO says `'task'`, D1
 *    holds `'maintenance_task'`, and the route's `z.preprocess` is what bridges
 *    them — reproduced here, or a marker written offline would be invisible to
 *    every server-side query.
 *  - **The analysis is read, migrated and written locally.** A legacy row
 *    (`floors[].rooms`) renders as a plan with no rooms unless it is converted
 *    on read, and the area editor's save lands on a ledgered column.
 *  - **A read never writes.** The legacy migration happens on a copy; opening a
 *    screen must not emit an op.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import type { FloorPlanAnalysis } from '@api/floor-plans';

import { getLocalHouseLedger, openLocalHouseSession, resetLocalHouseSession } from '../engine';
import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from '../errors';
import { FLOOR_PLAN_CHILD_TABLES, localFloorPlansApi } from '../localFloorPlansApi';
import { applyLedgerDelta, captureLedgerSnapshot, diffLedger } from '../projection';
import { HOUSE_LEDGER_PHYSICAL_TABLES, HOUSE_LEDGER_TABLE_NAMES } from '../schema';
import type { LocalFloorPlan, LocalHouseholdSpace, LocalTask } from '../types';

import { emptyHouseLedger, stampAt, taskRow, TEST_HOUSEHOLD_ID } from './houseLedgerTestKit';

const USER = 'user-floor-plans-1';

let householdId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

/**
 * A plan row as the upload flow would have written it. Nothing local mints one —
 * `getUploadUrl` is an H6 throw — so every test seeds directly, which is also
 * how a household that used Symply before going local-first arrives.
 */
function seedPlan(id: string, overrides: Partial<LocalFloorPlan> = {}): LocalFloorPlan {
  const plan: LocalFloorPlan = {
    id,
    household_id: householdId,
    original_file_key: `floor-plans/${householdId}/${id}/plan.png`,
    display_image_key: `floor-plans/${householdId}/${id}/plan.png`,
    thumbnail_key: `floor-plans/${householdId}/${id}/plan.png`,
    filename: 'plan.png',
    file_size: 120_000,
    content_type: 'image/png',
    building_name: 'Main Building',
    floor_number: 1,
    floor_label: 'Ground',
    width_px: 2000,
    height_px: 1400,
    scale_pixels_per_foot: null,
    scale_pixels_per_meter: null,
    scale_unit: 'feet',
    scale_calibration_method: 'none',
    ocr_status: 'pending',
    ocr_detected_dimensions: null,
    status: 'completed',
    processing_stage: null,
    error_message: null,
    ai_analysis_status: 'pending',
    ai_analysis_data: null,
    ai_property_address: null,
    ai_total_area_sqft: null,
    ai_floor_count: null,
    ai_analyzed_at: null,
    vector_semantic_key: null,
    vector_trace_key: null,
    vectorization_status: 'pending',
    vectorization_error: null,
    vectorized_at: null,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
  getLocalHouseLedger().floorPlans.push(plan);
  return plan;
}

function seedSpace(id: string, overrides: Partial<LocalHouseholdSpace> = {}): LocalHouseholdSpace {
  const space: LocalHouseholdSpace = {
    id,
    household_id: householdId,
    name: 'Utility room',
    space_type: 'custom',
    category: 'indoor',
    floor_level: 0,
    icon_emoji: null,
    icon_color: null,
    custom_image_key: null,
    custom_image_url: null,
    description: null,
    area_sqft: null,
    display_order: 0,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
    version: 1,
    ...overrides,
  };
  getLocalHouseLedger().householdSpaces.push(space);
  return space;
}

function seedTask(id: string, overrides: Record<string, unknown> = {}): LocalTask {
  const task = taskRow(id, {
    household_id: householdId,
    ...overrides,
  }) as unknown as LocalTask;
  getLocalHouseLedger().tasks.push(task);
  return task;
}

/** The shape the OLD analysis prompt produced — `floors[].rooms`, flat features. */
function legacyAnalysis(): Record<string, unknown> {
  return {
    property_address: '12 Elm Street',
    total_area: { value: 1800, unit: 'sq_ft' },
    floors: [
      {
        name: 'Main Floor',
        level: 0,
        area: { value: 1200, unit: 'sq_ft' },
        rooms: [
          {
            name: 'Kitchen',
            type: 'kitchen',
            dimensions: { width: 12, length: 14, unit: 'ft' },
            area: { value: 168, unit: 'sq_ft' },
            position: { description: 'north-east' },
          },
          {
            name: 'Back Deck',
            type: 'deck',
            dimensions: { width: 10, length: 20, unit: 'ft' },
            area: { value: 200, unit: 'sq_ft' },
            position: { description: 'rear' },
          },
        ],
      },
    ],
    features: [
      { name: 'Garden Shed', type: 'shed', area: { value: 80, unit: 'sq_ft' } },
      { name: 'Carport', type: 'carport', area: { value: 200, unit: 'sq_ft' } },
      { name: 'Front Porch', type: 'porch', area: { value: 60, unit: 'sq_ft' }, location: 'front' },
      // Already a space on the main floor by NAME — the Worker skips it, and
      // dropping that guard would double-count the deck.
      { name: 'back deck', type: 'deck', area: { value: 200, unit: 'sq_ft' } },
    ],
    excluded_areas: { total: { value: 260, unit: 'sq_ft' }, items: ['Garage', 'Crawlspace'] },
    metadata: { room_labels_present: true, has_garage: true, confidence: 'high' },
  };
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({
    userId: USER,
    displayName: 'Floor plans test home',
  });
  householdId = ledger.household.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('floor plans — the drawing itself', () => {
  it('lists newest first and filters by building', async () => {
    seedPlan('fp_old', { created_at: '2026-01-01T09:00:00.000Z' });
    seedPlan('fp_new', { created_at: '2026-06-01T09:00:00.000Z' });
    seedPlan('fp_cottage', { building_name: 'Cottage' });

    const all = await localFloorPlansApi.list(householdId);
    expect(all.floor_plans.map((row) => row.id)).toEqual(['fp_cottage', 'fp_new', 'fp_old']);
    expect(all.next_cursor).toBeUndefined();

    const cottage = await localFloorPlansApi.list(householdId, { building_name: 'Cottage' });
    expect(cottage.floor_plans.map((row) => row.id)).toEqual(['fp_cottage']);
  });

  it('caps the page at the limit and reports a cursor, exactly as the Worker does', async () => {
    for (let i = 0; i < 4; i += 1) {
      seedPlan(`fp_${i}`, { created_at: `2026-0${i + 1}-01T09:00:00.000Z` });
    }
    const page = await localFloorPlansApi.list(householdId, { limit: 2 });
    expect(page.floor_plans).toHaveLength(2);
    // The cursor is the last kept row's id — and the Worker never consumes it
    // on the way back in, which is reproduced rather than fixed.
    expect(page.next_cursor).toBe(page.floor_plans[1]!.id);
  });

  it('updates metadata and leaves an untouched field alone', async () => {
    const plan = seedPlan('fp_1');
    const updated = await localFloorPlansApi.update(householdId, plan.id, {
      building_name: 'Coach House',
      floor_label: '',
    });
    expect(updated.floor_plan.building_name).toBe('Coach House');
    // An EMPTY STRING is stored as one — `updateFloorPlan` spreads `data` with
    // no `|| null`, so clearing a label offline and online must agree.
    expect(updated.floor_plan.floor_label).toBe('');
    expect(updated.floor_plan.floor_number).toBe(1);
    expect(updated.floor_plan.updated_at > plan.created_at).toBe(true);
  });

  it('reports processing status off the row rather than polling anything', async () => {
    seedPlan('fp_1', {
      status: 'processing',
      processing_stage: 'layout_detect',
      error_message: null,
      ocr_status: 'completed',
    });
    expect(await localFloorPlansApi.getProcessingStatus(householdId, 'fp_1')).toEqual({
      status: 'processing',
      processing_stage: 'layout_detect',
      error_message: null,
      ocr_status: 'completed',
    });
  });

  it('raises for a plan that does not exist, and for another property', async () => {
    await expect(localFloorPlansApi.get(householdId, 'fp_missing')).rejects.toThrow(
      'Floor plan not found',
    );
    await expect(localFloorPlansApi.list('hh_other')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });

  it('calibrates the scale by division, and writes NOTHING for inches', async () => {
    seedPlan('fp_1');

    const feet = await localFloorPlansApi.calibrateScale(householdId, 'fp_1', {
      pixel_distance: 240,
      actual_distance: 20,
      unit: 'feet',
    });
    expect(feet.floor_plan.scale_pixels_per_foot).toBe(12);
    expect(feet.floor_plan.scale_pixels_per_meter).toBeNull();
    expect(feet.floor_plan.scale_calibration_method).toBe('manual');

    const inches = await localFloorPlansApi.calibrateScale(householdId, 'fp_1', {
      pixel_distance: 240,
      actual_distance: 20,
      unit: 'inches',
    });
    // The Worker's branch is `feet`/`meters` only, so an inch calibration
    // records the unit and the method and no ratio at all. The foot ratio from
    // the previous call survives, which is what the server would leave behind.
    expect(inches.floor_plan.scale_unit).toBe('inches');
    expect(inches.floor_plan.scale_pixels_per_foot).toBe(12);
    expect(inches.floor_plan.scale_pixels_per_meter).toBeNull();
  });
});

describe('floor plans — the delete, and the cascade D1 declares but never fires', () => {
  /**
   * The regression this exists for is B2's, two waves later, with an extra
   * twist: here the SCHEMA says "cascade" and the SERVER never triggers it, so
   * a reader checking either half alone reaches the wrong answer. The list is
   * therefore derived from the Drizzle sources rather than hand-written — a
   * fourth ledgered table pointing at `floor_plans` with `onDelete: 'cascade'`
   * fails in milliseconds instead of leaking rows to every peer forever.
   */
  it('drops exactly the ledgered tables D1 declares — checked against the schema', () => {
    const schemaDir = join(__dirname, '../../../../../backend/src/db');
    const sources = readdirSync(schemaDir)
      .filter((f) => f.startsWith('schema') && f.endsWith('.ts'))
      .map((f) => readFileSync(join(schemaDir, f), 'utf8'))
      .join('\n');

    const blocks = sources.split(/export const \w+ = sqliteTable\(\s*'/).slice(1);
    const cascading = new Set<string>();
    for (const block of blocks) {
      const physical = block.slice(0, block.indexOf("'"));
      if (/references\(\(\)\s*=>\s*floorPlans\.id,\s*\{\s*onDelete:\s*'cascade'/.test(block)) {
        cascading.add(physical);
      }
    }

    // Non-vacuity: if the parse breaks, `cascading` empties and the comparison
    // below passes for the wrong reason. THREE tables declare this foreign key,
    // and naming all three is the point — the third is the one that must not be
    // ledgered.
    expect([...cascading].sort()).toEqual([
      'floor_plan_annotations',
      'floor_plan_markers',
      'floor_plan_regions',
    ]);

    const live = HOUSE_LEDGER_TABLE_NAMES.filter((t) =>
      cascading.has(HOUSE_LEDGER_PHYSICAL_TABLES[t]),
    );
    expect([...FLOOR_PLAN_CHILD_TABLES].sort()).toEqual([...live].sort());
    // …and the third IS the registry's now: the H13 D-wave ledgered
    // `floor_plan_regions`, so the reason it used to be absent — "the registry
    // does not hold it at all" — has expired. What replaces it is the stronger
    // statement in the other direction: the list is derived from the Drizzle
    // cascade and filtered to the live registry, so a region cannot be in one
    // and not the other.
    expect(live.map((t) => HOUSE_LEDGER_PHYSICAL_TABLES[t])).toContain('floor_plan_regions');
  });

  it('takes the markers and the annotations with it, in ONE op', async () => {
    const plan = seedPlan('fp_1');
    const other = seedPlan('fp_2');
    seedTask('task-1');
    seedTask('task-2');

    await localFloorPlansApi.createMarker(householdId, plan.id, {
      x_percent: 10,
      y_percent: 10,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
    });
    await localFloorPlansApi.createAnnotation(householdId, plan.id, {
      annotation_type: 'line',
      svg_data: { x1: 0, y1: 0, x2: 10, y2: 10 },
    });
    // A second plan's children must survive — a filter on the wrong column
    // would empty both and every assertion below would still pass.
    const keptMarker = await localFloorPlansApi.createMarker(householdId, other.id, {
      x_percent: 20,
      y_percent: 20,
      linked_entity_type: 'task',
      linked_entity_id: 'task-2',
    });
    const keptAnnotation = await localFloorPlansApi.createAnnotation(householdId, other.id, {
      annotation_type: 'circle',
      svg_data: { cx: 5, cy: 5, r: 2 },
    });

    const before = opCount();
    await localFloorPlansApi.delete(householdId, plan.id);
    expect(opCount() - before).toBe(1);

    const after = getLocalHouseLedger();
    expect(after.floorPlans.map((row) => row.id)).toEqual([other.id]);
    expect(after.floorPlanMarkers.map((row) => row.id)).toEqual([keptMarker.marker.id]);
    expect(after.floorPlanAnnotations.map((row) => row.id)).toEqual([
      keptAnnotation.annotation.id,
    ]);
  });

  it('leaves the linked task and its room alone', async () => {
    // The pin recorded where the job is and the task now says the same thing.
    // Removing the drawing is not a claim that the boiler moved.
    const plan = seedPlan('fp_1');
    const space = seedSpace('sp_1', {
      floor_plan_id: 'fp_1',
      plan_x_percent: 0,
      plan_y_percent: 0,
      plan_width_percent: 50,
      plan_height_percent: 50,
    });
    seedTask('task-1');

    await localFloorPlansApi.createMarker(householdId, plan.id, {
      x_percent: 10,
      y_percent: 10,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
    });
    await localFloorPlansApi.delete(householdId, plan.id);

    const task = getLocalHouseLedger().tasks.find((row) => row.id === 'task-1');
    expect(task?.space_id).toBe(space.id);
  });

  it('raises for a plan that does not exist', async () => {
    await expect(localFloorPlansApi.delete(householdId, 'fp_missing')).rejects.toThrow(
      'Floor plan not found',
    );
  });
});

/**
 * The child removal, proved through the MERGE rather than through the local
 * ledger.
 *
 * The failure mode only appears on a second device: a peer that received the
 * plan tombstone but not the markers' would hold pins for a drawing it no longer
 * has — invisible, because nothing reads a marker without its plan, and
 * permanent, because a tombstone is absorbing.
 */
describe('floor plans — the delete converges on a peer', () => {
  const STAMP_A = stampAt(10, 'member-a', 'op-a');
  const STAMP_B = stampAt(20, 'member-b', 'op-b');

  it('carries the plan and both children in one delta', () => {
    const deviceA = emptyHouseLedger();
    const peer = emptyHouseLedger();

    const plan = { id: 'fp_1', household_id: TEST_HOUSEHOLD_ID } as never;
    const marker = { id: 'fpm_1', floor_plan_id: 'fp_1', household_id: TEST_HOUSEHOLD_ID } as never;
    const annotation = {
      id: 'fpa_1',
      floor_plan_id: 'fp_1',
      household_id: TEST_HOUSEHOLD_ID,
    } as never;

    const beforeCreate = captureLedgerSnapshot(deviceA);
    deviceA.floorPlans.push(plan);
    deviceA.floorPlanMarkers.push(marker);
    deviceA.floorPlanAnnotations.push(annotation);
    applyLedgerDelta(peer, diffLedger(beforeCreate, deviceA)!, STAMP_A);

    expect(peer.floorPlans).toHaveLength(1);
    expect(peer.floorPlanMarkers).toHaveLength(1);
    expect(peer.floorPlanAnnotations).toHaveLength(1);

    // One mutation across three tables — the shape `delete` produces. A peer
    // that received the plan tombstone WITHOUT the children's would hold pins
    // for a drawing it no longer has: invisible, because nothing reads a marker
    // without its plan, and permanent, because a tombstone is absorbing.
    const beforeDelete = captureLedgerSnapshot(deviceA);
    deviceA.floorPlans = [];
    deviceA.floorPlanMarkers = [];
    deviceA.floorPlanAnnotations = [];
    applyLedgerDelta(peer, diffLedger(beforeDelete, deviceA)!, STAMP_B);

    expect(peer.floorPlans).toHaveLength(0);
    expect(peer.floorPlanMarkers).toHaveLength(0);
    expect(peer.floorPlanAnnotations).toHaveLength(0);
  });
});

describe('markers — the pin, its room and the task it moves', () => {
  it('normalises the entity type the way the route does', async () => {
    seedPlan('fp_1');
    seedTask('task-1');
    const { marker } = await localFloorPlansApi.createMarker(householdId, 'fp_1', {
      x_percent: 10,
      y_percent: 10,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
    });
    // The DTO says `'task'`; every stored row says `'maintenance_task'`, because
    // the create route rewrites it before the service sees it. A marker written
    // with the raw client value would be invisible to every server-side query.
    expect(marker.linked_entity_type as string).toBe('maintenance_task');
    expect(marker.marker_type).toBe('pin');
    expect(marker.marker_color).toBe('#FF6B6B');
    expect(marker.show_label).toBe(true);
    expect(marker.household_id).toBe(householdId);
  });

  it('finds a pin by its entity despite the read side of that translation missing', async () => {
    seedPlan('fp_1');
    seedTask('task-1');
    await localFloorPlansApi.createMarker(householdId, 'fp_1', {
      x_percent: 10,
      y_percent: 10,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
    });

    // The Worker reads this query parameter raw and compares it to the stored
    // column, so `'task'` matches nothing on the server, ever. Reproducing that
    // would be a 200 with an empty list for a member who can see the pin.
    const found = await localFloorPlansApi.getMarkersForEntity(householdId, 'task', 'task-1');
    expect(found.markers).toHaveLength(1);
    expect(
      (await localFloorPlansApi.getMarkersForEntity(householdId, 'task', 'task-2')).markers,
    ).toEqual([]);
  });

  it('hit-tests the room when the caller supplies none, and back-fills the task', async () => {
    seedPlan('fp_1');
    seedSpace('sp_kitchen', {
      name: 'Kitchen',
      floor_plan_id: 'fp_1',
      plan_x_percent: 0,
      plan_y_percent: 0,
      plan_width_percent: 40,
      plan_height_percent: 40,
    });
    seedSpace('sp_other_plan', {
      name: 'Cottage kitchen',
      floor_plan_id: 'fp_other',
      plan_x_percent: 0,
      plan_y_percent: 0,
      plan_width_percent: 100,
      plan_height_percent: 100,
    });
    seedTask('task-1', { space_id: null });

    const before = opCount();
    const { marker } = await localFloorPlansApi.createMarker(householdId, 'fp_1', {
      x_percent: 20,
      y_percent: 20,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
    });
    // A space placed on ANOTHER plan must not win, even though its box covers
    // the whole drawing.
    expect(marker.space_id).toBe('sp_kitchen');
    // The insert and the task write are ONE op: a peer that saw only the first
    // would hold a pin whose task has not moved.
    expect(opCount() - before).toBe(1);
    expect(getLocalHouseLedger().tasks.find((row) => row.id === 'task-1')?.space_id).toBe(
      'sp_kitchen',
    );
  });

  it('never moves a task that already has a room', async () => {
    seedPlan('fp_1');
    seedSpace('sp_kitchen', {
      floor_plan_id: 'fp_1',
      plan_x_percent: 0,
      plan_y_percent: 0,
      plan_width_percent: 100,
      plan_height_percent: 100,
    });
    seedTask('task-1', { space_id: 'sp_garage' });

    await localFloorPlansApi.createMarker(householdId, 'fp_1', {
      x_percent: 50,
      y_percent: 50,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
    });
    expect(getLocalHouseLedger().tasks.find((row) => row.id === 'task-1')?.space_id).toBe(
      'sp_garage',
    );
  });

  it('leaves the space null when the pin lands outside every box', async () => {
    seedPlan('fp_1');
    seedSpace('sp_kitchen', {
      floor_plan_id: 'fp_1',
      plan_x_percent: 0,
      plan_y_percent: 0,
      plan_width_percent: 10,
      plan_height_percent: 10,
    });
    // A space linked to the plan but never PLACED on it has null coordinates and
    // must be skipped rather than treated as covering the origin.
    seedSpace('sp_unplaced', { floor_plan_id: 'fp_1' });
    seedTask('task-1', { space_id: null });

    const { marker } = await localFloorPlansApi.createMarker(householdId, 'fp_1', {
      x_percent: 90,
      y_percent: 90,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
    });
    expect(marker.space_id).toBeNull();
    expect(getLocalHouseLedger().tasks.find((row) => row.id === 'task-1')?.space_id).toBeNull();
  });

  it('honours an explicit space and skips the hit-test entirely', async () => {
    seedPlan('fp_1');
    seedSpace('sp_kitchen', {
      floor_plan_id: 'fp_1',
      plan_x_percent: 0,
      plan_y_percent: 0,
      plan_width_percent: 100,
      plan_height_percent: 100,
    });
    seedTask('task-1', { space_id: null });

    const { marker } = await localFloorPlansApi.createMarker(householdId, 'fp_1', {
      x_percent: 50,
      y_percent: 50,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
      space_id: 'sp_explicit',
    });
    expect(marker.space_id).toBe('sp_explicit');
  });

  it('lists a plan\'s markers newest first, updates and deletes one', async () => {
    seedPlan('fp_1');
    seedTask('task-1');
    const { marker } = await localFloorPlansApi.createMarker(householdId, 'fp_1', {
      x_percent: 10,
      y_percent: 10,
      linked_entity_type: 'task',
      linked_entity_id: 'task-1',
      label: 'Boiler',
    });

    expect((await localFloorPlansApi.listMarkers(householdId, 'fp_1')).markers).toHaveLength(1);

    const updated = await localFloorPlansApi.updateMarker(householdId, marker.id, {
      x_percent: 55,
      label: 'Boiler (annual service)',
      show_label: false,
    });
    expect(updated.marker.x_percent).toBe(55);
    expect(updated.marker.show_label).toBe(false);
    // The Worker does NOT re-run the hit-test on update, so a dragged pin keeps
    // the room it was dropped in. Reproduced rather than improved.
    expect(updated.marker.space_id).toBeNull();

    await localFloorPlansApi.deleteMarker(householdId, marker.id);
    expect((await localFloorPlansApi.listMarkers(householdId, 'fp_1')).markers).toEqual([]);
    await expect(localFloorPlansApi.deleteMarker(householdId, marker.id)).rejects.toThrow(
      'Marker not found',
    );
  });
});

describe('annotations — the layer nothing writes yet', () => {
  it('stores the drawing defaults the service writes, quirks included', async () => {
    seedPlan('fp_1');
    const { annotation } = await localFloorPlansApi.createAnnotation(householdId, 'fp_1', {
      annotation_type: 'measurement',
      svg_data: { x1: 0, y1: 0, x2: 100, y2: 0 },
      // `|| 2`, `|| 1` and `|| 14` in the service, not `??`: a zero-width line
      // is stored as 2 and a fully transparent one as opaque, on BOTH backends.
      stroke_width: 0,
      opacity: 0,
      font_size: 0,
      measurement_value: 24.5,
      measurement_unit: 'ft',
    });
    expect(annotation.stroke_width).toBe(2);
    expect(annotation.opacity).toBe(1);
    expect(annotation.font_size).toBe(14);
    expect(annotation.stroke_color).toBe('#000000');
    expect(annotation.fill_color).toBeNull();
    expect(annotation.household_id).toBe(householdId);
  });

  it('stores svg_data as an object and defaults it to an empty one', async () => {
    seedPlan('fp_1');
    const { annotation } = await localFloorPlansApi.createAnnotation(householdId, 'fp_1', {
      annotation_type: 'polygon',
    });
    // The DTO declares an object and D1 stores JSON text; the ledger satisfies
    // the DTO. The Worker would stringify `undefined` into the literal string
    // `"undefined"` here, which then throws on every read — the one defect this
    // facade declines to reproduce.
    expect(annotation.svg_data).toEqual({});
  });

  it('requires an annotation type, listing and deleting otherwise', async () => {
    seedPlan('fp_1');
    await expect(
      localFloorPlansApi.createAnnotation(householdId, 'fp_1', { text_content: 'x' }),
    ).rejects.toThrow('annotation_type is required');

    const { annotation } = await localFloorPlansApi.createAnnotation(householdId, 'fp_1', {
      annotation_type: 'text',
      text_content: 'damp patch',
    });
    expect((await localFloorPlansApi.listAnnotations(householdId, 'fp_1')).annotations).toEqual([
      annotation,
    ]);
    await localFloorPlansApi.deleteAnnotation(householdId, annotation.id);
    expect((await localFloorPlansApi.listAnnotations(householdId, 'fp_1')).annotations).toEqual(
      [],
    );
  });
});

describe('the analysis — read, migrated and edited on device', () => {
  it('answers pending with a message when nothing has been analysed', async () => {
    seedPlan('fp_1');
    expect(await localFloorPlansApi.getAnalysis(householdId, 'fp_1')).toEqual({
      status: 'pending',
      analysis: null,
      message: 'No analysis available yet',
    });
  });

  it('surfaces the failure message rather than the generic one', async () => {
    seedPlan('fp_1', { ai_analysis_status: 'failed', error_message: 'Image too small' });
    const result = await localFloorPlansApi.getAnalysis(householdId, 'fp_1');
    expect(result).toEqual({ status: 'failed', analysis: null, message: 'Image too small' });
  });

  it('migrates a legacy analysis on read, without writing anything', async () => {
    // Where a legacy row comes from: a household that used Symply BEFORE going
    // local-first. `FloorPlanViewer` renders `spaces`, so an unmigrated row
    // draws a plan with no rooms on it — complete-looking and wrong.
    seedPlan('fp_1', {
      ai_analysis_data: legacyAnalysis() as unknown as FloorPlanAnalysis,
      ai_analyzed_at: '2026-02-01T09:00:00.000Z',
    });

    const before = opCount();
    const result = await localFloorPlansApi.getAnalysis(householdId, 'fp_1');
    expect(opCount()).toBe(before);

    expect(result.status).toBe('completed');
    const analysis = result.analysis!;
    expect(analysis.floors[0]!.spaces.map((s) => s.name)).toEqual([
      'Kitchen',
      'Back Deck',
      'Front Porch',
    ]);
    // `deck` is in the outdoor list, so the converted space is marked outdoor.
    expect(analysis.floors[0]!.spaces[1]!.is_outdoor).toBe(true);
    // The duplicate `back deck` feature is skipped by NAME, case-insensitively.
    expect(analysis.floors[0]!.spaces.filter((s) => s.type === 'deck')).toHaveLength(1);
    // A shed and a carport are detached structures; a porch is attached.
    expect(analysis.detached_areas.map((d) => d.name)).toEqual(['Garden Shed', 'Carport']);
    expect(analysis.excluded_from_living_area.items.map((i) => i.name)).toEqual([
      'Garage',
      'Crawlspace',
    ]);
    // The old `room_labels_present` flag maps onto the new name.
    expect(analysis.metadata.space_labels_present).toBe(true);
    expect(analysis.metadata.detached_area_count).toBe(2);
    expect(analysis.metadata.total_space_count).toBe(5);
    // No `detached_garage` and no `garage` space, so `none` — even though the
    // legacy `has_garage` is true. That disagreement is the Worker's own.
    expect(analysis.metadata.garage_type).toBe('none');
    expect(analysis.metadata.has_garage).toBe(true);
    expect(analysis.metadata.has_outdoor_spaces).toBe(true);

    // The stored row is untouched: the Worker converts on read and never writes
    // back, so a screen open must not emit an op or mutate the ledger.
    const stored = getLocalHouseLedger().floorPlans[0]!.ai_analysis_data as unknown as {
      floors: { rooms?: unknown }[];
    };
    expect(stored.floors[0]!.rooms).toBeDefined();
  });

  it('leaves a modern analysis alone, including one with no floors', async () => {
    const modern = {
      property_address: null,
      total_area: { value: null, unit: null },
      floors: [],
      detached_areas: [{ name: 'Shed', type: 'shed', area: { value: 80, unit: 'sq_ft' } }],
      excluded_from_living_area: { total: { value: null, unit: null }, items: [] },
      metadata: { confidence: 'high' },
    };
    seedPlan('fp_1', { ai_analysis_data: modern as unknown as FloorPlanAnalysis });
    const result = await localFloorPlansApi.getAnalysis(householdId, 'fp_1');
    // The legacy test is `rooms && !spaces`, not `!spaces` — an empty `floors`
    // array must NOT trigger a conversion, which would replace the populated
    // `detached_areas` with an empty one.
    expect(result.analysis!.detached_areas).toHaveLength(1);
  });

  it('applies an area edit by INDEX, keeping the rooms with the renamed floor', async () => {
    seedPlan('fp_1', {
      ai_analysis_data: {
        property_address: null,
        total_area: { value: null, unit: null },
        floors: [
          {
            name: 'Floor 1',
            level: 0,
            area: { value: 900, unit: 'sq_ft' },
            bounding_box: { x1: 0, y1: 0, x2: 1, y2: 0.5 },
            spaces: [
              {
                name: 'Kitchen',
                type: 'kitchen',
                is_outdoor: false,
                dimensions: { width: null, length: null, unit: null },
                area: { value: null, unit: null },
                position: { description: '' },
              },
            ],
          },
        ],
        detached_areas: [],
        excluded_from_living_area: { total: { value: null, unit: null }, items: [] },
        metadata: {
          scale_bar_detected: false,
          dimensions_labeled: false,
          space_labels_present: true,
          multiple_floors: false,
          floor_count: 1,
          detached_area_count: 0,
          total_space_count: 1,
          has_outdoor_spaces: false,
          has_garage: false,
          garage_type: 'none',
          confidence: 'high',
        },
      } as FloorPlanAnalysis,
    });

    const result = await localFloorPlansApi.updateAnalysis(householdId, 'fp_1', {
      floors: [
        { name: 'Upstairs', bounding_box: { x1: 0, y1: 0, x2: 1, y2: 0.4 } },
        { name: 'Loft', bounding_box: { x1: 0, y1: 0.4, x2: 1, y2: 1 } },
      ],
    });

    expect(result.status).toBe('completed');
    // A rename keeps the rooms and the measured area; the new second floor
    // inherits its index as its level and starts empty.
    expect(result.analysis.floors[0]!.name).toBe('Upstairs');
    expect(result.analysis.floors[0]!.spaces).toHaveLength(1);
    expect(result.analysis.floors[0]!.area).toEqual({ value: 900, unit: 'sq_ft' });
    expect(result.analysis.floors[0]!.bounding_box).toEqual({ x1: 0, y1: 0, x2: 1, y2: 0.4 });
    expect(result.analysis.floors[1]!.level).toBe(1);
    expect(result.analysis.floors[1]!.spaces).toEqual([]);
    expect(result.analysis.metadata.floor_count).toBe(2);
    expect(result.analysis.metadata.multiple_floors).toBe(true);
    // The edit changed no SPACE, so the space count must not move — the Worker
    // recomputes the other three counters and not this one.
    expect(result.analysis.metadata.total_space_count).toBe(1);

    // …and it landed on the ledgered row, which is why this method is local.
    const stored = getLocalHouseLedger().floorPlans[0]!;
    expect(stored.ai_floor_count).toBe(2);
    expect(stored.ai_analysis_status).toBe('completed');
    expect((stored.ai_analysis_data as FloorPlanAnalysis).floors[0]!.name).toBe('Upstairs');
  });

  it('starts from an empty analysis when the plan has never been analysed', async () => {
    seedPlan('fp_1');
    const result = await localFloorPlansApi.updateAnalysis(householdId, 'fp_1', {
      detached_areas: [{ name: 'Workshop', bounding_box: { x1: 0, y1: 0, x2: 0.2, y2: 0.2 } }],
    });
    expect(result.analysis.detached_areas[0]!.type).toBe('other');
    expect(result.analysis.metadata.detached_area_count).toBe(1);
    expect(result.analysis.floors).toEqual([]);
    // The Worker stamps `analyzed_at` with `now()` for a plan that was never
    // analysed, so a hand-named plan reads as analysed everywhere downstream.
    expect(result.analyzed_at).toBeTruthy();
  });

  it('leaves the untouched half of the edit alone', async () => {
    seedPlan('fp_1');
    await localFloorPlansApi.updateAnalysis(householdId, 'fp_1', {
      detached_areas: [{ name: 'Shed', bounding_box: { x1: 0, y1: 0, x2: 0.1, y2: 0.1 } }],
    });
    const result = await localFloorPlansApi.updateAnalysis(householdId, 'fp_1', {
      floors: [{ name: 'Ground', bounding_box: { x1: 0, y1: 0, x2: 1, y2: 1 } }],
    });
    // A missing `detached_areas` means "leave that list alone", not "empty it".
    expect(result.analysis.detached_areas.map((d) => d.name)).toEqual(['Shed']);
    expect(result.analysis.floors.map((f) => f.name)).toEqual(['Ground']);
  });
});

describe('the vector layer, which is six columns and a template', () => {
  it('answers the shape the viewer expects, with nulls, rather than 404ing', async () => {
    seedPlan('fp_1');
    expect(await localFloorPlansApi.getVectorAssets(householdId, 'fp_1')).toEqual({
      status: 'pending',
      vector_semantic_key: null,
      vector_semantic_url: null,
      vector_trace_key: null,
      vector_trace_url: null,
      vectorized_at: null,
      error: null,
    });
  });

  it('builds the file URL from a stored key', async () => {
    seedPlan('fp_1', {
      vectorization_status: 'completed',
      vector_semantic_key: 'floor-plans/hh/fp_1/vector-semantic.svg',
      vectorized_at: '2026-03-01T09:00:00.000Z',
    });
    const assets = await localFloorPlansApi.getVectorAssets(householdId, 'fp_1');
    expect(assets.status).toBe('completed');
    expect(assets.vector_semantic_url).toBe('/files/floor-plans/hh/fp_1/vector-semantic.svg');
    expect(assets.vector_trace_url).toBeNull();
  });
});

describe('the seven gaps are throws, not silence', () => {
  const thrown: [string, () => Promise<unknown>][] = [
    ['getUploadUrl', () => localFloorPlansApi.getUploadUrl()],
    ['uploadFile', () => localFloorPlansApi.uploadFile()],
    ['confirmUpload', () => localFloorPlansApi.confirmUpload()],
    ['triggerAnalysis', () => localFloorPlansApi.triggerAnalysis()],
    ['triggerVectorization', () => localFloorPlansApi.triggerVectorization()],
    // `listRegions` left this list in the H13 D-wave: `floor_plan_regions` is
    // ledgered, so it is a real local read now. The two below stay, and the
    // REASON they stay changed — it is no longer "there is nowhere to put a
    // region" but "the segmentation model does not run here, and the plan image
    // is sealed in the blob channel where the Worker cannot see it either".
    ['processPendingRegions', () => localFloorPlansApi.processPendingRegions()],
    ['retryRegion', () => localFloorPlansApi.retryRegion()],
  ];

  it.each(thrown)('%s raises rather than resolving empty', async (_name, call) => {
    // Resolving `{ regions: [] }` or `{ floor_plan_id: '' }` is the §6 failure
    // the Proxy exists to prevent: the screen renders empty AND correct.
    await expect(call()).rejects.toThrow(HouseLocalUnsupportedError);
  });

  it('carries member-facing copy rather than the identifier', async () => {
    await expect(localFloorPlansApi.processPendingRegions()).rejects.toThrow(
      /floors and outbuildings|floor/i,
    );
    await localFloorPlansApi
      .processPendingRegions()
      .catch((error: HouseLocalUnsupportedError) => {
        expect(error.message).not.toContain('floorPlansApi');
        expect(error.method).toBe('floorPlansApi.processPendingRegions');
      });
  });
});
