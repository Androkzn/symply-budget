/**
 * `localSpacesApi` against a real in-memory session (plan §6 DoD, Wave A).
 *
 * These run the whole H1 stack — mint, op journal, per-row seal, projection —
 * because a facade that passes against a hand-built ledger proves nothing about
 * the one it will actually write to. The two assertions that are not obvious
 * round-trips are the ones the plan calls non-negotiable: the bulk path emits
 * ONE op for the whole template set, and `getPresets` answers from the client
 * table with no network in the graph.
 */
import { deterministicRowId } from '@symply/local-first';

import { PRESET_SPACE_SEEDS } from '../defaults';
import {
  getLocalHouseLedger,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnknownPropertyError } from '../errors';
import { newLocalId } from '../ids';
import { localSpacesApi } from '../localSpacesApi';

import { taskRow } from './houseLedgerTestKit';

const USER = 'user-spaces-1';

let householdId: string;

async function addTaskInSpace(spaceId: string | null): Promise<string> {
  const id = newLocalId('task');
  await mutateLocalHouseLedger(
    (ledger) => {
      ledger.tasks.push(
        taskRow(id, { household_id: householdId, space_id: spaceId }) as never,
      );
    },
    { opType: 'TASK_CREATE', entityType: 'task', entityId: id, payload: {} },
  );
  return id;
}

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Spaces test home' });
  householdId = ledger.household.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('reads', () => {
  it('lists the seeded spaces in display order', async () => {
    const { spaces } = await localSpacesApi.list(householdId);
    expect(spaces.length).toBeGreaterThan(0);
    expect(spaces.map((space) => space.display_order)).toEqual(
      [...spaces.map((space) => space.display_order)].sort((a, b) => a - b),
    );
    expect(spaces.every((space) => space.household_id === householdId)).toBe(true);
  });

  it('filters by category and floor level', async () => {
    const { spaces } = await localSpacesApi.list(householdId, { category: 'outdoor' });
    expect(spaces.length).toBeGreaterThan(0);
    expect(spaces.every((space) => space.category === 'outdoor')).toBe(true);

    const noFloor = await localSpacesApi.list(householdId, { floor_level: 3 });
    expect(noFloor.spaces).toHaveLength(0);
  });

  it('derives task counts per space instead of storing them', async () => {
    const { spaces } = await localSpacesApi.list(householdId);
    const kitchen = spaces.find((space) => space.name === 'Kitchen')!;
    await addTaskInSpace(kitchen.id);
    await addTaskInSpace(kitchen.id);
    await addTaskInSpace(null);

    const after = await localSpacesApi.get(householdId, kitchen.id);
    expect(after.space.task_count).toBe(2);
    expect(after.space.maintenance_task_count).toBe(2);
    expect(after.space.action_item_count).toBe(0);
    // The count is derived on read — the ledger row must stay free of it, or the
    // same fact gets two homes and LWW converges them to two answers.
    expect(
      getLocalHouseLedger().householdSpaces.find((row) => row.id === kitchen.id),
    ).not.toHaveProperty('task_count');
  });

  it('raises for a space that does not exist', async () => {
    await expect(localSpacesApi.get(householdId, 'spc_missing')).rejects.toThrow('Space not found');
  });

  it('refuses to answer for a property that is not the active one', async () => {
    await expect(localSpacesApi.list('hh_local_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });
});

describe('getPresets', () => {
  it('serves the client preset table rather than the network', async () => {
    const { templates } = await localSpacesApi.getPresets(householdId);
    expect(templates).toHaveLength(PRESET_SPACE_SEEDS.length);
    expect(templates.map((template) => template.name)).toEqual(
      PRESET_SPACE_SEEDS.map((seed) => seed.name),
    );
  });

  it('hands out copies so a screen cannot edit what the next household is seeded with', async () => {
    const { templates } = await localSpacesApi.getPresets(householdId);
    templates[0]!.name = 'Mutated';
    expect(PRESET_SPACE_SEEDS[0]!.name).not.toBe('Mutated');
  });
});

describe('create / update / delete', () => {
  it('round-trips a custom space', async () => {
    const before = await localSpacesApi.list(householdId);
    const { space } = await localSpacesApi.create(householdId, {
      name: 'Wine Cellar',
      space_type: 'custom',
      category: 'basement',
      description: 'Under the stairs',
    });

    expect(space.version).toBe(1);
    expect(space.display_order).toBe(before.spaces.length);
    expect(space.category).toBe('basement');

    const { space: fetched } = await localSpacesApi.get(householdId, space.id);
    expect(fetched.name).toBe('Wine Cellar');

    const { space: updated } = await localSpacesApi.update(householdId, space.id, {
      name: 'Cellar',
      area_sqft: 120,
      version: space.version,
    });
    expect(updated.name).toBe('Cellar');
    expect(updated.area_sqft).toBe(120);
    expect(updated.version).toBe(2);
    // Untouched columns survive a partial update.
    expect(updated.description).toBe('Under the stairs');

    await localSpacesApi.delete(householdId, space.id, updated.version);
    const after = await localSpacesApi.list(householdId);
    expect(after.spaces.map((row) => row.id)).not.toContain(space.id);
  });

  it('renames a colliding preset and refuses a colliding custom name', async () => {
    const { space } = await localSpacesApi.create(householdId, {
      name: 'Kitchen',
      space_type: 'preset',
      category: 'indoor',
    });
    expect(space.name).toBe('Kitchen (2)');

    await expect(
      localSpacesApi.create(householdId, { name: 'Kitchen', space_type: 'custom' }),
    ).rejects.toThrow('A space with this name already exists');
  });

  it('accepts a stale version instead of failing the write', async () => {
    const { spaces } = await localSpacesApi.list(householdId);
    const target = spaces[0]!;
    await localSpacesApi.update(householdId, target.id, { name: 'First', version: target.version });

    // The screen still holds the pre-edit version. Against the Worker this is a
    // 409; on device there is nothing to refetch from, so LWW takes it.
    const { space } = await localSpacesApi.update(householdId, target.id, {
      name: 'Second',
      version: target.version,
    });
    expect(space.name).toBe('Second');
    expect(space.version).toBe(target.version + 2);
  });

  it('unassigns tasks in the space it deletes', async () => {
    const { spaces } = await localSpacesApi.list(householdId);
    const garage = spaces.find((space) => space.name === 'Garage')!;
    const taskId = await addTaskInSpace(garage.id);

    await localSpacesApi.delete(householdId, garage.id);

    const task = getLocalHouseLedger().tasks.find((row) => row.id === taskId)!;
    expect(task.space_id).toBeNull();
  });

  it('raises when updating or deleting a space that does not exist', async () => {
    await expect(
      localSpacesApi.update(householdId, 'spc_missing', { version: 1 }),
    ).rejects.toThrow('Space not found');
    await expect(localSpacesApi.delete(householdId, 'spc_missing')).rejects.toThrow(
      'Space not found',
    );
  });
});

describe('bulkCreate', () => {
  it('creates the whole template set in ONE op, not one per row', async () => {
    const opsBefore = opCount();
    const { spaces } = await localSpacesApi.bulkCreate(householdId, 'single_family');

    expect(spaces.length).toBeGreaterThan(5);
    expect(opCount() - opsBefore).toBe(1);
  });

  it('gives the set the same rooms the Worker would', async () => {
    // The Worker filters the preset TABLE by the set's names, so a set naming
    // "Bedroom" twice still yields one bedroom.
    const { spaces } = await localSpacesApi.bulkCreate(householdId, 'small_apartment');
    expect(spaces).toHaveLength(4);
    expect(spaces.map((space) => space.display_order)).toEqual([0, 1, 2, 3]);
    // "Bathroom" becomes "Main Bathroom" through `resolveBulkDuplicateName`.
    expect(spaces.map((space) => space.name)).toContain('Main Bathroom');
  });

  it('mints ids deterministically so two offline devices merge rather than double', async () => {
    const { spaces } = await localSpacesApi.bulkCreate(householdId, 'small_apartment');
    for (const space of spaces) {
      expect(space.id).toBe(deterministicRowId('spc', [householdId, space.name]));
    }
  });

  it('falls back to a random id when a rename freed the natural key', async () => {
    // The seeded "Kitchen" already owns det(household, "Kitchen"). Rename it and
    // the name is free again — reusing the deterministic id here would overwrite
    // the member's renamed room instead of adding one.
    const { spaces } = await localSpacesApi.list(householdId);
    const kitchen = spaces.find((space) => space.name === 'Kitchen')!;
    expect(kitchen.id).toBe(deterministicRowId('spc', [householdId, 'Kitchen']));
    await localSpacesApi.update(householdId, kitchen.id, {
      name: 'Cooking Room',
      version: kitchen.version,
    });

    const created = await localSpacesApi.bulkCreate(householdId, 'small_apartment');
    const newKitchen = created.spaces.find((space) => space.name === 'Kitchen')!;
    expect(newKitchen.id).not.toBe(kitchen.id);

    const after = await localSpacesApi.list(householdId);
    expect(after.spaces.find((space) => space.id === kitchen.id)!.name).toBe('Cooking Room');
  });

  it('does not clobber existing rooms when run twice', async () => {
    const first = await localSpacesApi.bulkCreate(householdId, 'small_apartment');
    const second = await localSpacesApi.bulkCreate(householdId, 'small_apartment');

    const { spaces } = await localSpacesApi.list(householdId);
    const ids = spaces.map((space) => space.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(first.spaces.map((space) => space.id)));
    expect(ids).toEqual(expect.arrayContaining(second.spaces.map((space) => space.id)));

    const names = spaces.map((space) => space.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('rejects a template type it does not know', async () => {
    await expect(localSpacesApi.bulkCreate(householdId, 'houseboat')).rejects.toThrow(
      'Unknown space template',
    );
  });
});

describe('reorder', () => {
  it('preserves the requested order and emits one op for the whole batch', async () => {
    const { spaces } = await localSpacesApi.list(householdId);
    const reversed = [...spaces].reverse();
    const opsBefore = opCount();

    await localSpacesApi.reorder(
      householdId,
      reversed.map((space, index) => ({
        space_id: space.id,
        display_order: index,
        version: space.version,
      })),
    );

    expect(opCount() - opsBefore).toBe(1);
    const after = await localSpacesApi.list(householdId);
    expect(after.spaces.map((space) => space.id)).toEqual(reversed.map((space) => space.id));
    expect(after.spaces.map((space) => space.version)).toEqual(
      reversed.map((space) => space.version + 1),
    );
  });

  it('ignores rows that are not in the ledger', async () => {
    await expect(
      localSpacesApi.reorder(householdId, [
        { space_id: 'spc_missing', display_order: 0, version: 1 },
      ]),
    ).resolves.toBeUndefined();
  });
});
