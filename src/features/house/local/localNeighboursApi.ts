/**
 * Local `neighbours` — the ledger counterpart of `src/api/neighbours.ts`
 * (migration 0165).
 *
 * All 14 remote methods, none absent: an absent key falls through to a server
 * that has no rows for this household, and the screen then renders an empty map
 * that looks exactly like a street nobody has surveyed yet
 * (`localApiProxy.ts`'s header). For this family that failure mode is worse than
 * usual — a map cannot show an empty ROW, so there is nothing on screen to hint
 * that anything is missing.
 *
 * ## This is the most private family on the ledger
 *
 * Every row describes a third party who never installed this app. That shapes
 * three decisions here rather than being a footnote:
 *
 *  - all three tables are named in `HOUSE_AI_EGRESS_FORBIDDEN_TABLES`, so no
 *    projection of them can reach a provider even by accident;
 *  - nothing in this module calls the network, at all — not for geocoding, not
 *    for photos. Address lookup happens in `@services/geocoding`, through the
 *    OS geocoder, before a row is ever built;
 *  - photos go through the H6 blob channel like every other House attachment,
 *    so a neighbour's face is sealed with the household key and is unreadable to
 *    the relay that carries it.
 *
 * ## Three derived fields, rebuilt on every read
 *
 * `people`, `person_count`, `neighbourhood` and `distance_meters` are computed
 * in `hydrate()` and are never stored. `types.ts` states the general rule; the
 * fourth is the one worth restating, because it is the one that looks storable:
 * `distance_meters` is a function of the PROPERTY's coordinates as well as the
 * neighbour's, so a member correcting their own address would strand every
 * stored copy with no write to fix them.
 *
 * ## Two cascades a ledger cannot express
 *
 * D1 declares `ON DELETE CASCADE` from `neighbours` to `neighbour_people`, and
 * `ON DELETE SET NULL` from `neighbourhoods` to `neighbours`. The ledger has no
 * foreign keys and a delete is an absorbing tombstone, so both are performed by
 * hand — and each in a SINGLE op, so a peer applies the whole change or none of
 * it. A two-op delete that half-arrives leaves occupants with no home, and an
 * orphan on a tombstoned parent is forever.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type {
  CreateNeighbourPersonRequest,
  CreateNeighbourRequest,
  CreateNeighbourhoodRequest,
  NeighbourFilters,
  NeighbourPerson,
  NeighbourWithPeople,
  NeighbourhoodWithCount,
  UpdateNeighbourPersonRequest,
  UpdateNeighbourRequest,
  UpdateNeighbourhoodRequest,
} from '@api/neighbours';
import type { Setting } from '@api/settings';

import { houseDeterministicIds, newLocalId } from './ids';
import { nowIso, requireActiveProperty, rowsOf, writeLocal, writeLocalBulk } from './localWrite';
import type { LocalNeighbour, LocalNeighbourPerson, LocalNeighbourhood } from './types';

/**
 * Where the property's own coordinates live.
 *
 * `households` carries an address and no latitude/longitude — server-side
 * geocoding was retired (`MAP_PREVIEW_REMOVED`) and adding two columns to the
 * fleet's most-migrated table to hold a value only one feature reads is not a
 * trade worth making. So the map screen geocodes the household address ONCE
 * through the OS geocoder and parks the answer in a setting, which is already
 * Tier A, already syncs, and is already the place House keeps derived
 * per-property values.
 *
 * Read defensively: the setting is absent until the member first opens the map,
 * and it is absent forever on a property whose address will not geocode. Both
 * cases produce `distance_meters: null`, which is the same answer the remote
 * gives on every read.
 */
export const NEIGHBOUR_ORIGIN_SETTING_KEY = 'house.property_coordinates';

export type NeighbourOrigin = { latitude: number; longitude: number };

/**
 * Ledger tables a neighbour delete must take with it.
 *
 * Asserted against the Drizzle schema in the test rather than trusted here, for
 * the reason B2 taught on `CONTRACTOR_CASCADE_TABLES`: this list is written when
 * one child exists and the next child is added by someone who never reads it.
 */
export const NEIGHBOUR_CASCADE_TABLES = ['neighbourPeople'] as const;

const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Metres between two coordinates (haversine).
 *
 * The same formula as `backend/src/services/neighbour-service.ts`, deliberately
 * duplicated rather than shared: this side computes distances for rows the
 * server has never seen, so the two cannot be one implementation reached over
 * HTTP. Both suites assert the SAME fixtures, which is what keeps them honest.
 */
export function neighbourDistanceMeters(from: NeighbourOrigin, to: NeighbourOrigin): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude));
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The same bounds the Worker's validator enforces, so both sides refuse the same rows. */
function assertCoordinates(latitude: unknown, longitude: unknown): void {
  const validLat =
    typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90;
  const validLon =
    typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  // One message rather than a field map: the only caller is a screen that
  // already refuses to enable Save without a pin, so this is a guard against a
  // programming error, not a form error a member will read.
  if (!validLat || !validLon) throw new Error('A neighbour needs a position on the map');
}

function neighboursOf(householdId: string): LocalNeighbour[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalNeighbour>('neighbours');
}

function peopleOf(householdId: string): LocalNeighbourPerson[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalNeighbourPerson>('neighbourPeople');
}

function areasOf(householdId: string): LocalNeighbourhood[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalNeighbourhood>('neighbourhoods');
}

/**
 * The property's coordinates, or null when nothing has geocoded them yet.
 *
 * `rowsOf` is typed for rows whose `household_id` is `string | undefined`, and a
 * `Setting` declares `string | null` — the column is nullable because a setting
 * may be user-scoped rather than property-scoped. The read is narrowed here
 * rather than loosening `rowsOf` for every caller: the filter `rowsOf` applies
 * treats a missing id as "belongs to this ledger", which is the right answer for
 * a user-scoped setting on a per-property ledger anyway.
 */
export function localNeighbourOrigin(): NeighbourOrigin | null {
  const setting = rowsOf<Setting & { household_id?: string }>('settings').find(
    (row) => row.key === NEIGHBOUR_ORIGIN_SETTING_KEY
  );
  if (!setting?.value) return null;
  try {
    const parsed = JSON.parse(setting.value) as Partial<NeighbourOrigin>;
    if (typeof parsed?.latitude !== 'number' || typeof parsed?.longitude !== 'number') return null;
    return { latitude: parsed.latitude, longitude: parsed.longitude };
  } catch {
    // A malformed setting is a stale write from an older build, not a reason to
    // take down the map. Distances simply go missing.
    return null;
  }
}

/** Server order: `sort_order` ascending, ties broken by creation so it is stable. */
function bySortOrder(a: LocalNeighbourPerson, b: LocalNeighbourPerson): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

/** Server order: label ascending, case-insensitively — a list a member scans. */
function byLabel(a: { label: string }, b: { label: string }): number {
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

function hydrate(
  row: LocalNeighbour,
  people: LocalNeighbourPerson[],
  areas: LocalNeighbourhood[],
  origin: NeighbourOrigin | null
): NeighbourWithPeople {
  const occupants = people.filter((person) => person.neighbour_id === row.id).sort(bySortOrder);
  const area = areas.find((candidate) => candidate.id === row.neighbourhood_id) ?? null;
  return {
    ...row,
    people: occupants,
    person_count: occupants.length,
    neighbourhood: area,
    distance_meters: origin ? Math.round(neighbourDistanceMeters(origin, row)) : null,
  };
}

function matchesFilters(row: LocalNeighbour, filters: NeighbourFilters | undefined): boolean {
  if (!filters) return true;
  if (filters.neighbourhood_id && row.neighbourhood_id !== filters.neighbourhood_id) return false;
  if (filters.relation && row.relation !== filters.relation) return false;
  if (filters.is_favorite !== undefined && row.is_favorite !== filters.is_favorite) return false;
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = [row.label, row.formatted_address, row.address_line1, row.notes]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * Build a neighbour row from a create request.
 *
 * Defaults are the WORKER's, not the caller's, so a home added offline is
 * indistinguishable from one added online: `relation || 'nearby'`,
 * `place_source || 'manual'`, and three booleans that default false.
 */
function buildNeighbourRow(
  householdId: string,
  data: CreateNeighbourRequest,
  timestamp: string
): LocalNeighbour {
  assertCoordinates(data.latitude, data.longitude);
  const label = data.label?.trim();
  if (!label) throw new Error('A neighbour needs a name');
  return {
    id: newLocalId('nbr'),
    household_id: householdId,
    neighbourhood_id: data.neighbourhood_id ?? null,
    label,
    relation: data.relation ?? 'nearby',
    address_line1: data.address_line1 ?? null,
    address_line2: data.address_line2 ?? null,
    city: data.city ?? null,
    state_province: data.state_province ?? null,
    postal_code: data.postal_code ?? null,
    country: data.country ?? null,
    formatted_address: data.formatted_address ?? null,
    latitude: data.latitude,
    longitude: data.longitude,
    place_source: data.place_source ?? 'manual',
    photo_key: data.photo_key ?? null,
    ...(data.photo_blob ? { photo_blob: data.photo_blob } : {}),
    notes: data.notes ?? null,
    is_favorite: data.is_favorite ?? false,
    is_emergency_contact: data.is_emergency_contact ?? false,
    has_spare_key: data.has_spare_key ?? false,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function buildPersonRow(
  householdId: string,
  neighbourId: string,
  data: CreateNeighbourPersonRequest,
  fallbackOrder: number,
  timestamp: string
): LocalNeighbourPerson {
  const name = data.name?.trim();
  if (!name) throw new Error('A neighbour needs a name');
  return {
    id: newLocalId('nbp'),
    neighbour_id: neighbourId,
    household_id: householdId,
    name,
    role: data.role ?? 'adult',
    phone: data.phone ?? null,
    email: data.email ?? null,
    photo_key: data.photo_key ?? null,
    ...(data.photo_blob ? { photo_blob: data.photo_blob } : {}),
    notes: data.notes ?? null,
    // The first occupant is the primary unless told otherwise. A home with
    // people but no face on its map bubble is a gap the member cannot see the
    // cause of, let alone fix.
    is_primary: data.is_primary ?? fallbackOrder === 0,
    sort_order: data.sort_order ?? fallbackOrder,
    device_contact_id: data.device_contact_id ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/** One primary per home, enforced inside whichever op is already open. */
function demoteOtherPrimaries(
  rows: LocalNeighbourPerson[],
  neighbourId: string,
  keepId: string
): void {
  for (const person of rows) {
    if (person.neighbour_id === neighbourId && person.id !== keepId && person.is_primary) {
      person.is_primary = false;
    }
  }
}

export const localNeighboursApi = {
  getAll: async (householdId: string, filters?: NeighbourFilters) => {
    const rows = neighboursOf(householdId).filter((row) => matchesFilters(row, filters));
    const people = peopleOf(householdId);
    const areas = areasOf(householdId);
    const origin = localNeighbourOrigin();
    return {
      neighbours: rows
        .slice()
        .sort(byLabel)
        .map((row) => hydrate(row, people, areas, origin)),
    };
  },

  get: async (householdId: string, neighbourId: string) => {
    const row = neighboursOf(householdId).find((candidate) => candidate.id === neighbourId);
    // The remote raises through `ensureData` on a 404; a local miss is the same
    // fact and must be as loud, or the edit screen opens an empty form and saves
    // a second home on top of the one the member meant to change.
    if (!row) throw new Error('Failed to get neighbour');
    return {
      neighbour: hydrate(row, peopleOf(householdId), areasOf(householdId), localNeighbourOrigin()),
    };
  },

  /**
   * Create the home and its occupants in ONE op.
   *
   * The remote accepts `people` on the create body for latency; here it is a
   * correctness requirement. `mutateLocalHouseLedger` captures and diffs the
   * whole ledger per call, so a home plus four occupants written one at a time
   * is five full cycles — and, worse, a peer that receives three of the five has
   * a home with a partial family and no way to know it.
   */
  create: async (householdId: string, data: CreateNeighbourRequest) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    const neighbour = buildNeighbourRow(householdId, data, timestamp);
    const people = (data.people ?? []).map((person, index) =>
      buildPersonRow(householdId, neighbour.id, person, index, timestamp)
    );
    // An explicit `is_primary` anywhere in the batch wins over the
    // first-occupant default, and only one of them may keep it.
    const explicitIndex = (data.people ?? []).findIndex((person) => person.is_primary);
    const explicitPrimary = explicitIndex >= 0 ? people[explicitIndex] : undefined;
    if (explicitPrimary) demoteOtherPrimaries(people, neighbour.id, explicitPrimary.id);

    if (neighbour.neighbourhood_id) {
      const known = areasOf(householdId).some((area) => area.id === neighbour.neighbourhood_id);
      // A neighbourhood from another property must never be assignable — the
      // remote proves it with a lookup, and so does this.
      if (!known) throw new Error('Failed to create neighbour');
    }

    await writeLocal(
      (draft) => {
        draft.neighbours.push(neighbour);
        draft.neighbourPeople.push(...people);
      },
      {
        opType: 'NEIGHBOUR_CREATE',
        entityType: 'neighbour',
        entityId: neighbour.id,
        // COPIES, not the rows themselves. The payload is serialised into the
        // encrypted op, and React Native deep-freezes what crosses the bridge in
        // __DEV__ — so handing over the same objects froze the LEDGER rows too,
        // and every later edit of this home threw "you attempted to set the key
        // `name` … on an object that is meant to be immutable". It reproduced as
        // a save that did nothing: the toast said it failed, the form stayed put.
        //
        // Nothing freezes in production, but the aliasing is wrong there as
        // well: mutating a stored row would rewrite an op already queued for a
        // peer, so what shipped would not be what was recorded.
        payload: {
          neighbour: { ...neighbour },
          people: people.map((row) => ({ ...row })),
        },
      }
    );

    return localNeighboursApi.get(householdId, neighbour.id);
  },

  update: async (householdId: string, neighbourId: string, data: UpdateNeighbourRequest) => {
    requireActiveProperty(householdId);
    if (data.latitude !== undefined || data.longitude !== undefined) {
      // Both or neither. Half a coordinate move puts the pin in the sea, and per
      // field LWW would happily carry that half to every peer.
      if (data.latitude === undefined || data.longitude === undefined) {
        throw new Error('A neighbour needs a position on the map');
      }
      assertCoordinates(data.latitude, data.longitude);
    }
    if (data.neighbourhood_id) {
      const known = areasOf(householdId).some((area) => area.id === data.neighbourhood_id);
      if (!known) throw new Error('Failed to update neighbour');
    }

    await writeLocal(
      (draft) => {
        const row = draft.neighbours.find(
          (candidate) => candidate.id === neighbourId && candidate.household_id === householdId
        );
        if (!row) throw new Error('Failed to update neighbour');
        // Field-by-field rather than a spread: an absent key means "leave it
        // alone", and a spread of the request would null out everything the edit
        // form did not send.
        if (data.label !== undefined) row.label = data.label.trim();
        if (data.relation !== undefined) row.relation = data.relation;
        if (data.neighbourhood_id !== undefined) row.neighbourhood_id = data.neighbourhood_id;
        if (data.address_line1 !== undefined) row.address_line1 = data.address_line1 ?? null;
        if (data.address_line2 !== undefined) row.address_line2 = data.address_line2 ?? null;
        if (data.city !== undefined) row.city = data.city ?? null;
        if (data.state_province !== undefined) row.state_province = data.state_province ?? null;
        if (data.postal_code !== undefined) row.postal_code = data.postal_code ?? null;
        if (data.country !== undefined) row.country = data.country ?? null;
        if (data.formatted_address !== undefined) {
          row.formatted_address = data.formatted_address ?? null;
        }
        if (data.latitude !== undefined) row.latitude = data.latitude;
        if (data.longitude !== undefined) row.longitude = data.longitude;
        if (data.place_source !== undefined) row.place_source = data.place_source;
        if (data.photo_key !== undefined) row.photo_key = data.photo_key ?? null;
        if (data.photo_blob !== undefined) row.photo_blob = data.photo_blob;
        if (data.notes !== undefined) row.notes = data.notes ?? null;
        if (data.is_favorite !== undefined) row.is_favorite = data.is_favorite;
        if (data.is_emergency_contact !== undefined) {
          row.is_emergency_contact = data.is_emergency_contact;
        }
        if (data.has_spare_key !== undefined) row.has_spare_key = data.has_spare_key;
        row.updated_at = nowIso();
      },
      {
        opType: 'NEIGHBOUR_UPDATE',
        entityType: 'neighbour',
        entityId: neighbourId,
        payload: data,
      }
    );

    return localNeighboursApi.get(householdId, neighbourId);
  },

  /**
   * Delete the home, and its occupants with it, in ONE op.
   *
   * D1's cascade is real here AND fires (this parent hard-deletes, unlike most
   * of the ledger's parents). That makes no difference to the local obligation:
   * a tombstone is absorbing, so an occupant left behind can never be reunited
   * with its home or removed by any later write.
   */
  remove: async (householdId: string, neighbourId: string): Promise<void> => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.neighbours.some(
          (row) => row.id === neighbourId && row.household_id === householdId
        );
        if (!exists) throw new Error('Failed to delete neighbour');
        draft.neighbours = draft.neighbours.filter((row) => row.id !== neighbourId);
        draft.neighbourPeople = draft.neighbourPeople.filter(
          (row) => row.neighbour_id !== neighbourId
        );
      },
      {
        opType: 'NEIGHBOUR_DELETE',
        entityType: 'neighbour',
        entityId: neighbourId,
        payload: { id: neighbourId },
      }
    );
  },

  toggleFavorite: async (householdId: string, neighbourId: string, isFavorite: boolean) =>
    localNeighboursApi.update(householdId, neighbourId, { is_favorite: isFavorite }),

  // ------------------------------------------------------------------- people

  addPerson: async (
    householdId: string,
    neighbourId: string,
    data: CreateNeighbourPersonRequest
  ) => {
    requireActiveProperty(householdId);
    const home = neighboursOf(householdId).find((row) => row.id === neighbourId);
    if (!home) throw new Error('Failed to add neighbour');
    const existing = peopleOf(householdId).filter((row) => row.neighbour_id === neighbourId);
    const person = buildPersonRow(
      householdId,
      neighbourId,
      data,
      existing.length,
      nowIso()
    );

    await writeLocal(
      (draft) => {
        draft.neighbourPeople.push(person);
        if (person.is_primary) demoteOtherPrimaries(draft.neighbourPeople, neighbourId, person.id);
      },
      {
        opType: 'NEIGHBOUR_PERSON_CREATE',
        entityType: 'neighbour_person',
        entityId: person.id,
        // A copy — see NEIGHBOUR_CREATE above. Sharing this object with the
        // ledger row is what made an occupant un-editable after adding them.
        payload: { ...person },
      }
    );

    return { person: person as NeighbourPerson };
  },

  updatePerson: async (
    householdId: string,
    personId: string,
    data: UpdateNeighbourPersonRequest
  ) => {
    requireActiveProperty(householdId);
    let updated: LocalNeighbourPerson | undefined;
    await writeLocal(
      (draft) => {
        const person = draft.neighbourPeople.find(
          (row) => row.id === personId && row.household_id === householdId
        );
        if (!person) throw new Error('Failed to update neighbour');
        if (data.name !== undefined) person.name = data.name.trim();
        if (data.role !== undefined) person.role = data.role;
        if (data.phone !== undefined) person.phone = data.phone ?? null;
        if (data.email !== undefined) person.email = data.email ?? null;
        if (data.photo_key !== undefined) person.photo_key = data.photo_key ?? null;
        if (data.photo_blob !== undefined) person.photo_blob = data.photo_blob;
        if (data.notes !== undefined) person.notes = data.notes ?? null;
        if (data.is_primary !== undefined) person.is_primary = data.is_primary;
        if (data.sort_order !== undefined) person.sort_order = data.sort_order;
        if (data.device_contact_id !== undefined) {
          person.device_contact_id = data.device_contact_id ?? null;
        }
        person.updated_at = nowIso();
        // Promotion demotes the rest INSIDE the same op — two ops would let a
        // peer see a home with two primaries, and per-field LWW has no way to
        // decide which one lost.
        if (data.is_primary === true) {
          demoteOtherPrimaries(draft.neighbourPeople, person.neighbour_id, person.id);
        }
        updated = person;
      },
      {
        opType: 'NEIGHBOUR_PERSON_UPDATE',
        entityType: 'neighbour_person',
        entityId: personId,
        payload: data,
      }
    );
    return { person: updated! as NeighbourPerson };
  },

  removePerson: async (householdId: string, personId: string): Promise<void> => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.neighbourPeople.some(
          (row) => row.id === personId && row.household_id === householdId
        );
        if (!exists) throw new Error('Failed to delete neighbour');
        draft.neighbourPeople = draft.neighbourPeople.filter((row) => row.id !== personId);
      },
      {
        opType: 'NEIGHBOUR_PERSON_DELETE',
        entityType: 'neighbour_person',
        entityId: personId,
        payload: { id: personId },
      }
    );
  },

  // ------------------------------------------------------------ neighbourhoods

  getNeighbourhoods: async (householdId: string) => {
    const homes = neighboursOf(householdId);
    const neighbourhoods: NeighbourhoodWithCount[] = areasOf(householdId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((area) => ({
        ...area,
        neighbour_count: homes.filter((home) => home.neighbourhood_id === area.id).length,
      }));
    return { neighbourhoods };
  },

  /**
   * Create an area under its DETERMINISTIC id (S3b).
   *
   * `(household_id, name)` is a real D1 `uniqueIndex`, and the offline
   * double-create is an ordinary event rather than a race: two members tidying
   * their pins on the same evening both reach for "Maple Court". Random ids
   * would keep both rows and every home would then be filed under whichever one
   * its own device happened to see.
   *
   * An existing area is UPDATED rather than rejected, which is where this
   * diverges from the Worker's 409. The id is already the same row, so an insert
   * and an update are the same write — and answering "that name is taken" for a
   * row the member is about to be shown anyway is a dialog with no action behind
   * it.
   */
  createNeighbourhood: async (householdId: string, data: CreateNeighbourhoodRequest) => {
    requireActiveProperty(householdId);
    const name = data.name?.trim();
    if (!name) throw new Error('A neighbourhood needs a name');
    const id = houseDeterministicIds.neighbourhood(householdId, name);
    const timestamp = nowIso();

    await writeLocal(
      (draft) => {
        const existing = draft.neighbourhoods.find((row) => row.id === id);
        if (existing) {
          existing.name = name;
          if (data.description !== undefined) existing.description = data.description ?? null;
          if (data.color !== undefined) existing.color = data.color ?? null;
          if (data.photo_key !== undefined) existing.photo_key = data.photo_key ?? null;
          if (data.photo_blob !== undefined) existing.photo_blob = data.photo_blob;
          existing.updated_at = timestamp;
          return;
        }
        draft.neighbourhoods.push({
          id,
          household_id: householdId,
          name,
          description: data.description ?? null,
          color: data.color ?? null,
          photo_key: data.photo_key ?? null,
          ...(data.photo_blob ? { photo_blob: data.photo_blob } : {}),
          created_at: timestamp,
          updated_at: timestamp,
        });
      },
      {
        opType: 'NEIGHBOURHOOD_UPSERT',
        entityType: 'neighbourhood',
        entityId: id,
        payload: { id, name },
      }
    );

    const { neighbourhoods } = await localNeighboursApi.getNeighbourhoods(householdId);
    return { neighbourhood: neighbourhoods.find((row) => row.id === id)! };
  },

  updateNeighbourhood: async (
    householdId: string,
    neighbourhoodId: string,
    data: UpdateNeighbourhoodRequest
  ) => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const row = draft.neighbourhoods.find(
          (candidate) =>
            candidate.id === neighbourhoodId && candidate.household_id === householdId
        );
        if (!row) throw new Error('Failed to update neighbourhood');
        // The NAME is deliberately mutable in place even though the id was
        // derived from it. Re-minting the id on a rename would be a delete and
        // an insert, and the tombstone is absorbing: every peer would lose the
        // area and every home filed under it would be unfiled. The id is a
        // merge key, not a label, and this is the one place the difference
        // matters.
        if (data.name !== undefined) row.name = data.name.trim();
        if (data.description !== undefined) row.description = data.description ?? null;
        if (data.color !== undefined) row.color = data.color ?? null;
        if (data.photo_key !== undefined) row.photo_key = data.photo_key ?? null;
        if (data.photo_blob !== undefined) row.photo_blob = data.photo_blob;
        row.updated_at = nowIso();
      },
      {
        opType: 'NEIGHBOURHOOD_UPDATE',
        entityType: 'neighbourhood',
        entityId: neighbourhoodId,
        payload: data,
      }
    );
    const { neighbourhoods } = await localNeighboursApi.getNeighbourhoods(householdId);
    return { neighbourhood: neighbourhoods.find((row) => row.id === neighbourhoodId)! };
  },

  /**
   * Delete the area and UNFILE its homes, in ONE op.
   *
   * D1 says `ON DELETE SET NULL`; a ledger cannot express that either, so the
   * re-parenting is done by hand. Splitting it across two ops would let a peer
   * apply the delete without the unfiling, and every home in that area would
   * then point at a tombstone — rendering as "in a neighbourhood" with no
   * neighbourhood to name.
   */
  deleteNeighbourhood: async (householdId: string, neighbourhoodId: string): Promise<void> => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.neighbourhoods.some(
          (row) => row.id === neighbourhoodId && row.household_id === householdId
        );
        if (!exists) throw new Error('Failed to delete neighbourhood');
        const timestamp = nowIso();
        for (const home of draft.neighbours) {
          if (home.neighbourhood_id === neighbourhoodId) {
            home.neighbourhood_id = null;
            home.updated_at = timestamp;
          }
        }
        draft.neighbourhoods = draft.neighbourhoods.filter((row) => row.id !== neighbourhoodId);
      },
      {
        opType: 'NEIGHBOURHOOD_DELETE',
        entityType: 'neighbourhood',
        entityId: neighbourhoodId,
        payload: { id: neighbourhoodId },
      }
    );
  },

  /**
   * Bulk create from the device address book — ONE op per chunk, never per row.
   *
   * This is the method the bulk-write rule in `localWrite.ts` exists for. A
   * member importing thirty contacts is watching a spinner, and thirty
   * capture → diff → seal → persist cycles of the whole ledger is quadratic in
   * the size of their home. `chunkRowsForOp` packs by bytes AND row count, so a
   * thirty-home import is one or two ops.
   *
   * The occupants ride along inside the same chunk as their home for the reason
   * `create` gives: a chunk that lands without its people is a home with a
   * family that never arrives.
   */
  importContacts: async (householdId: string, entries: CreateNeighbourRequest[]) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    const known = new Set(areasOf(householdId).map((area) => area.id));

    const prepared = entries.map((entry) => {
      const neighbour = buildNeighbourRow(householdId, entry, timestamp);
      if (neighbour.neighbourhood_id && !known.has(neighbour.neighbourhood_id)) {
        // Silently unfile rather than failing the whole import: one bad area id
        // in a thirty-row batch must not cost the member the other twenty-nine.
        neighbour.neighbourhood_id = null;
      }
      const people = (entry.people ?? []).map((person, index) =>
        buildPersonRow(householdId, neighbour.id, person, index, timestamp)
      );
      return { neighbour, people };
    });

    await writeLocalBulk(
      prepared,
      (draft, chunk) => {
        for (const item of chunk) {
          draft.neighbours.push(item.neighbour);
          draft.neighbourPeople.push(...item.people);
        }
      },
      (chunk, index) => ({
        opType: 'NEIGHBOUR_IMPORT',
        entityType: 'neighbour',
        entityId: `${chunk[0]?.neighbour.id ?? 'empty'}#${index}`,
        payload: { count: chunk.length },
      })
    );

    const people = peopleOf(householdId);
    const areas = areasOf(householdId);
    const origin = localNeighbourOrigin();
    return {
      neighbours: prepared.map((item) => hydrate(item.neighbour, people, areas, origin)),
    };
  },
};
