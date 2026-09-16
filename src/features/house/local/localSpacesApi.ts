/**
 * Local `household-spaces` — the ledger counterpart of `src/api/household-spaces.ts`
 * (plan §6, Wave A). All 8 remote methods, none missing: a missing key routes
 * silently to a server that holds no rows for a local-first household, which is
 * the failure mode `localApiProxy.ts` exists to make impossible.
 *
 * Three House-specific decisions live here:
 *
 *  1. **`getPresets` never touches the network.** The preset table is Tier C
 *     reference data (plan §1.2) and `defaults.ts` already carries the client
 *     copy the offline seeder uses, so the local facade reads that same table.
 *     One table, one answer — an offline mint and a legacy-API mint agree.
 *  2. **`bulkCreate` and `reorder` go through `writeLocalBulk`.** One op per
 *     chunk, never one per row: `mutateLocalHouseLedger` captures and diffs the
 *     WHOLE ledger per call, and both of these run during onboarding while the
 *     member is watching (plan §3.3, "non-negotiable").
 *  3. **`version` stops being an optimistic lock.** The server rejects a stale
 *     `version` with 409 and the screen refetches; on device there is nothing to
 *     refetch from — the ledger IS the source — and the merge rule for concurrent
 *     edits is LWW with conflict surfacing (BR-044). So the column is kept
 *     monotonic for wire compatibility, and a stale caller value is not an error.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type { HouseholdSpace, PresetSpaceTemplate } from '@api/household-spaces';
import { deterministicRowId } from '@symply/local-first';

import { PRESET_SPACE_SEEDS, type PresetSpaceSeed } from './defaults';
import { HouseLocalUnknownPropertyError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal, writeLocalBulk } from './localWrite';
import type { LocalHouseholdSpace, LocalTask } from './types';

/** Mirror of the module-private `CreateSpaceRequest` in `@api/household-spaces`. */
export type CreateLocalSpaceInput = {
  name: string;
  space_type: 'preset' | 'custom';
  category?: NonNullable<HouseholdSpace['category']>;
  floor_level?: number;
  icon_emoji?: string;
  icon_color?: string;
  custom_image_key?: string;
  description?: string;
  area_sqft?: number;
  display_order?: number;
  floor_plan_id?: string;
  plan_x_percent?: number;
  plan_y_percent?: number;
  plan_width_percent?: number;
  plan_height_percent?: number;
};

export type UpdateLocalSpaceInput = Partial<CreateLocalSpaceInput> & { version: number };

export type ReorderLocalSpaceEntry = {
  space_id: string;
  display_order: number;
  version: number;
};

// ---------------------------------------------------------------------------
// Ported from `backend/src/utils/space-names.ts` and the naming branches of
// `backend/src/services/household-space-service.ts` — keep in sync. Offline
// onboarding has to produce the same room names the Worker would have, or a
// household created on a plane and one created online read as different homes.
// ---------------------------------------------------------------------------

function normalizeSpaceName(name: string): string {
  return name.trim().toLowerCase();
}

function hasDuplicateName(names: Set<string>, name: string): boolean {
  return names.has(normalizeSpaceName(name));
}

/** `disambiguatePresetName` — floor-aware prefix first, numeric suffix after. */
function disambiguatePresetName(
  name: string,
  input: { category?: CreateLocalSpaceInput['category']; floor_level?: number },
  existingNames: Set<string>,
): string {
  const prefixCandidates: string[] = [];
  if (input.category === 'basement' || input.floor_level === -1) {
    prefixCandidates.push(`Basement ${name}`);
  } else if (input.floor_level !== undefined && input.floor_level >= 2) {
    prefixCandidates.push(`Upstairs ${name}`);
  } else if (input.floor_level === 1) {
    prefixCandidates.push(`Main ${name}`);
  }

  for (const candidate of prefixCandidates) {
    if (!hasDuplicateName(existingNames, candidate)) return candidate;
  }

  let counter = 2;
  while (counter <= 99) {
    const candidate = `${name} (${counter})`;
    if (!hasDuplicateName(existingNames, candidate)) return candidate;
    counter += 1;
  }
  return `${name} (${counter})`;
}

/** `resolveBulkDuplicateName` — the human names a template set is expected to produce. */
function resolveBulkDuplicateName(
  baseName: string,
  occurrence: number,
  category: PresetSpaceSeed['category'],
): string {
  if (baseName === 'Bathroom') {
    if (occurrence === 1) return 'Main Bathroom';
    if (occurrence === 2) return 'Guest Bathroom';
    return `Bathroom (${occurrence})`;
  }
  if (baseName === 'Bedroom') {
    if (occurrence === 1) return 'Bedroom';
    if (occurrence === 2) return 'Guest Bedroom';
    return `Bedroom (${occurrence})`;
  }
  if (category === 'basement') return occurrence === 1 ? baseName : `Basement ${baseName}`;
  if (category === 'attic') return occurrence === 1 ? baseName : `Attic ${baseName}`;
  return occurrence === 1 ? baseName : `${baseName} (${occurrence})`;
}

function categoryToFloorLevel(category: PresetSpaceSeed['category']): number | undefined {
  if (category === 'basement') return -1;
  if (category === 'attic') return 2;
  return undefined;
}

/**
 * Ported from `backend/src/data/preset-spaces.ts` (`SPACE_SET_TEMPLATES`) — keep
 * in sync. `defaults.ts` carries the preset *rooms* because the seeder needs
 * them; the *sets* only ever mattered to `bulkCreateFromTemplate`, which is this
 * facade's job now.
 */
const SPACE_SET_TEMPLATES: Record<string, readonly string[]> = {
  small_apartment: ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'],
  apartment: [
    'Living Room',
    'Kitchen',
    'Dining Room',
    'Master Bedroom',
    'Bedroom',
    'Bathroom',
    'Bathroom',
  ],
  single_family: [
    'Living Room',
    'Kitchen',
    'Dining Room',
    'Master Bedroom',
    'Bedroom',
    'Bedroom',
    'Bathroom',
    'Bathroom',
    'Garage',
    'Backyard',
    'Front Yard',
  ],
  large_house: [
    'Living Room',
    'Kitchen',
    'Dining Room',
    'Master Bedroom',
    'Bedroom',
    'Bedroom',
    'Bedroom',
    'Bathroom',
    'Bathroom',
    'Bathroom',
    'Home Office',
    'Laundry Room',
    'Garage',
    'Basement',
    'Backyard',
    'Front Yard',
  ],
};

// ---------------------------------------------------------------------------

/**
 * Every method below addresses the ACTIVE property. `engine.ts` holds one ledger
 * per property and `mutateLocalHouseLedger` writes to whichever is active (H5,
 * plan §7), so answering a different `householdId` out of the active ledger
 * would show one home's rooms under another home's name. Loud beats silent —
 * the known offender is the per-household loop in `DataContext` (plan §6.1).
 */
function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function spacesOf(householdId: string): LocalHouseholdSpace[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHouseholdSpace>('householdSpaces');
}

/**
 * One pass over `tasks`, not one scan per space.
 *
 * `household-space-service.ts:getSpaceStats` runs a COUNT per space (N+1); a
 * query planner absorbs that, a Hermes loop over ten years of rows does not.
 */
function taskCountsBySpace(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of rowsOf<LocalTask>('tasks')) {
    if (!task.space_id || !task.is_active) continue;
    counts.set(task.space_id, (counts.get(task.space_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * `task_count` / `maintenance_task_count` / `action_item_count` are not columns —
 * the server composes them per request by joining `tasks` (`getSpaceStats`).
 * Storing them would give one fact two homes in the ledger and let LWW converge
 * them to different answers (`types.ts`, derived-collection rule), so the read
 * recomputes them. This is the one place a space is rebuilt rather than handed
 * back live; every other read returns the ledger row itself.
 */
function withStats(space: LocalHouseholdSpace, counts: Map<string, number>): HouseholdSpace {
  const taskCount = counts.get(space.id) ?? 0;
  return {
    ...space,
    task_count: taskCount,
    maintenance_task_count: taskCount,
    action_item_count: 0,
  };
}

/** Server order: `display_order` then `created_at` (`listSpaces`). */
function byDisplayOrder(a: LocalHouseholdSpace, b: LocalHouseholdSpace): number {
  return a.display_order - b.display_order || a.created_at.localeCompare(b.created_at);
}

function nextDisplayOrder(spaces: LocalHouseholdSpace[]): number {
  return spaces.reduce((max, space) => Math.max(max, space.display_order), -1) + 1;
}

/** `name` and `display_order` are resolved by the caller — both are contested. */
function buildSpaceRow(
  id: string,
  householdId: string,
  name: string,
  displayOrder: number,
  input: Omit<CreateLocalSpaceInput, 'name'>,
): LocalHouseholdSpace {
  const timestamp = nowIso();
  return {
    id,
    household_id: householdId,
    name,
    space_type: input.space_type,
    category: input.category ?? null,
    floor_level: input.floor_level ?? null,
    icon_emoji: input.icon_emoji ?? null,
    icon_color: input.icon_color ?? null,
    custom_image_key: input.custom_image_key ?? null,
    // The server returns a freshly signed R2 URL here. Blobs are H6, so a local
    // household has a key and no URL until that channel lands.
    custom_image_url: null,
    description: input.description ?? null,
    area_sqft: input.area_sqft ?? null,
    display_order: displayOrder,
    floor_plan_id: input.floor_plan_id ?? null,
    plan_x_percent: input.plan_x_percent ?? null,
    plan_y_percent: input.plan_y_percent ?? null,
    plan_width_percent: input.plan_width_percent ?? null,
    plan_height_percent: input.plan_height_percent ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    version: 1,
  };
}

export const localSpacesApi = {
  list: async (householdId: string, filters?: { category?: string; floor_level?: number }) => {
    const counts = taskCountsBySpace();
    const spaces = spacesOf(householdId)
      .filter((space) => (filters?.category ? space.category === filters.category : true))
      .filter((space) =>
        filters?.floor_level !== undefined ? space.floor_level === filters.floor_level : true,
      )
      .sort(byDisplayOrder)
      .map((space) => withStats(space, counts));
    return { spaces };
  },

  /**
   * Tier C, served from the client table rather than `/spaces/presets`.
   *
   * The rows are copied because `PRESET_SPACE_SEEDS` is a module constant shared
   * with the offline seeder — a screen that edits what it was handed must not be
   * able to change what the next household gets minted with.
   */
  getPresets: async (_householdId: string) => {
    const templates: PresetSpaceTemplate[] = PRESET_SPACE_SEEDS.map((seed) => ({ ...seed }));
    return { templates };
  },

  create: async (householdId: string, data: CreateLocalSpaceInput) => {
    const existing = spacesOf(householdId);
    const existingNames = new Set(existing.map((space) => normalizeSpaceName(space.name)));

    // `insertSpace` renames a colliding PRESET and rejects a colliding CUSTOM
    // name — a preset is a suggestion the member tapped, a custom name is one
    // they typed and expect to be honoured or refused.
    let name = data.name;
    if (hasDuplicateName(existingNames, name)) {
      if (data.space_type === 'preset') {
        name = disambiguatePresetName(name, data, existingNames);
      } else {
        throw new Error('A space with this name already exists');
      }
    }

    const space = buildSpaceRow(
      newLocalId('spc'),
      householdId,
      name,
      data.display_order ?? nextDisplayOrder(existing),
      data,
    );
    await writeLocal(
      (draft) => {
        draft.householdSpaces.push(space);
      },
      { opType: 'SPACE_CREATE', entityType: 'space', entityId: space.id, payload: space },
    );
    return { space: withStats(space, taskCountsBySpace()) };
  },

  /**
   * Onboarding's "what kind of home is this?" tap — a dozen rows in ONE op.
   *
   * Ids are deterministic on the resolved name, the same rule `defaults.ts` uses
   * for the seed (S3b, plan §1.5): two devices that both run onboarding offline
   * must merge into one set of rooms rather than 32. The random fallback covers
   * the one case where the natural key lies — a member renamed the seeded
   * "Kitchen", so the deterministic id is already taken by a row that no longer
   * answers to that name, and reusing it would overwrite their rename.
   */
  bulkCreate: async (householdId: string, templateType: string) => {
    const spaceNames = SPACE_SET_TEMPLATES[templateType];
    if (!spaceNames) throw new Error(`Unknown space template "${templateType}"`);

    const existing = spacesOf(householdId);
    const existingNames = new Set(existing.map((space) => normalizeSpaceName(space.name)));
    const existingIds = new Set(existing.map((space) => space.id));

    // The server filters the preset TABLE by the set's names rather than mapping
    // the list, so a set that names "Bedroom" twice yields one bedroom. Mirrored
    // so an offline home has the same rooms as a legacy-API one.
    const templates = PRESET_SPACE_SEEDS.filter((seed) => spaceNames.includes(seed.name));

    const occurrences = new Map<string, number>();
    const rows: LocalHouseholdSpace[] = [];
    templates.forEach((template, index) => {
      const occurrence = (occurrences.get(template.name) ?? 0) + 1;
      occurrences.set(template.name, occurrence);

      let name = resolveBulkDuplicateName(template.name, occurrence, template.category);
      if (hasDuplicateName(existingNames, name)) {
        name = disambiguatePresetName(
          name,
          { category: template.category, floor_level: categoryToFloorLevel(template.category) },
          existingNames,
        );
      }
      existingNames.add(normalizeSpaceName(name));

      const deterministicId = deterministicRowId('spc', [householdId, name]);
      const id = existingIds.has(deterministicId) ? newLocalId('spc') : deterministicId;
      existingIds.add(id);

      rows.push(
        buildSpaceRow(id, householdId, name, index, {
          space_type: 'preset',
          category: template.category,
          floor_level: categoryToFloorLevel(template.category),
          icon_emoji: template.emoji,
          icon_color: template.color,
        }),
      );
    });

    await writeLocalBulk(
      rows,
      (draft, chunk) => {
        draft.householdSpaces.push(...chunk);
      },
      (chunk, index) => ({
        opType: 'SPACE_CREATE_BULK',
        entityType: 'space',
        entityId: chunk[0]!.id,
        // The rows already travel in the delta; repeating them in the intent
        // doubles the sealed op for nothing.
        payload: { count: chunk.length, chunk: index, household_id: householdId },
      }),
    );

    const counts = taskCountsBySpace();
    return { spaces: rows.map((space) => withStats(space, counts)) };
  },

  get: async (householdId: string, spaceId: string) => {
    const space = spacesOf(householdId).find((row) => row.id === spaceId);
    if (!space) throw new Error('Space not found');
    return { space: withStats(space, taskCountsBySpace()) };
  },

  /**
   * `data.version` is accepted and ignored as a lock — see the header. The row's
   * own version is bumped so screens that render it (and the wire shape when
   * this household is later read through the server) stay coherent.
   *
   * The server's `updateSpace` runs no duplicate-name check, so neither does
   * this: renaming a room to an existing name is the member's business.
   */
  update: async (householdId: string, spaceId: string, data: UpdateLocalSpaceInput) => {
    requireActiveProperty(householdId);
    let updated: LocalHouseholdSpace | undefined;
    await writeLocal(
      (draft) => {
        const space = draft.householdSpaces.find(
          (row) => row.id === spaceId && row.household_id === householdId,
        );
        if (!space) throw new Error('Space not found');
        if (data.name !== undefined) space.name = data.name;
        if (data.space_type !== undefined) space.space_type = data.space_type;
        if (data.category !== undefined) space.category = data.category ?? null;
        if (data.floor_level !== undefined) space.floor_level = data.floor_level ?? null;
        if (data.icon_emoji !== undefined) space.icon_emoji = data.icon_emoji ?? null;
        if (data.icon_color !== undefined) space.icon_color = data.icon_color ?? null;
        if (data.custom_image_key !== undefined) {
          space.custom_image_key = data.custom_image_key ?? null;
        }
        if (data.description !== undefined) space.description = data.description ?? null;
        if (data.area_sqft !== undefined) space.area_sqft = data.area_sqft ?? null;
        if (data.display_order !== undefined) space.display_order = data.display_order;
        if (data.floor_plan_id !== undefined) space.floor_plan_id = data.floor_plan_id ?? null;
        if (data.plan_x_percent !== undefined) space.plan_x_percent = data.plan_x_percent ?? null;
        if (data.plan_y_percent !== undefined) space.plan_y_percent = data.plan_y_percent ?? null;
        if (data.plan_width_percent !== undefined) {
          space.plan_width_percent = data.plan_width_percent ?? null;
        }
        if (data.plan_height_percent !== undefined) {
          space.plan_height_percent = data.plan_height_percent ?? null;
        }
        space.version += 1;
        space.updated_at = nowIso();
        updated = space;
      },
      { opType: 'SPACE_UPDATE', entityType: 'space', entityId: spaceId, payload: data },
    );
    return { space: withStats(updated!, taskCountsBySpace()) };
  },

  /**
   * `version` is part of the remote signature and ignored for the same reason
   * `update` ignores it. Tasks in the space are unassigned in the SAME op, as
   * `deleteSpace` does in its own transaction — split across two ops, a peer
   * that received only the first would hold tasks pointing at a room that no
   * longer exists.
   */
  delete: async (householdId: string, spaceId: string, _version?: number) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.householdSpaces.some(
          (row) => row.id === spaceId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Space not found');
        draft.householdSpaces = draft.householdSpaces.filter((row) => row.id !== spaceId);
        for (const task of draft.tasks) {
          if (task.space_id === spaceId) task.space_id = null;
        }
      },
      { opType: 'SPACE_DELETE', entityType: 'space', entityId: spaceId, payload: { id: spaceId } },
    );
  },

  /**
   * Drag-to-reorder: N rows, ONE op per chunk. The screen sends only the rows
   * that moved, so this is small in practice — but it is a bulk path by shape,
   * and the rule is about the shape, not today's N.
   */
  reorder: async (householdId: string, spaceOrders: ReorderLocalSpaceEntry[]) => {
    requireActiveProperty(householdId);
    await writeLocalBulk(
      spaceOrders,
      (draft, chunk) => {
        const byId = new Map(chunk.map((entry) => [entry.space_id, entry]));
        const timestamp = nowIso();
        for (const space of draft.householdSpaces) {
          const entry = byId.get(space.id);
          if (!entry || space.household_id !== householdId) continue;
          space.display_order = entry.display_order;
          // Bump off the LIVE version, not the caller's: a peer's edit may have
          // landed since the screen read the row, and rewinding the counter
          // would make two different rows claim the same version.
          space.version += 1;
          space.updated_at = timestamp;
        }
      },
      (chunk, index) => ({
        opType: 'SPACE_REORDER',
        entityType: 'space',
        entityId: chunk[0]!.space_id,
        payload: { count: chunk.length, chunk: index, household_id: householdId },
      }),
    );
  },
};
