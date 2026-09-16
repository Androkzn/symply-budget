import { and, asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import {
  NEIGHBOUR_PERSON_ROLES,
  NEIGHBOUR_PLACE_SOURCES,
  NEIGHBOUR_RELATIONS,
  type NeighbourPersonRole,
  type NeighbourPlaceSource,
  type NeighbourRelation,
} from '../db/schema-neighbours';
import type { Database, Env } from '../types';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import { HouseholdService } from './household-service';

/**
 * Neighbours — server side.
 *
 * The House brand runs local-first, so on most installs these rows never reach
 * this service at all: `localNeighboursApi` owns them on device and the Worker
 * holds ciphertext it cannot read. This exists for the households that are NOT
 * local-first (the incident kill switch, and any brand that mounts the router)
 * and to give `src/api/neighbours.ts` a real remote counterpart to proxy —
 * `localApiProxy.ts`'s coverage rule requires one, because a method that is
 * neither local nor declared remote must fail loudly rather than return an
 * empty 200 from a server that has no rows.
 *
 * ## Membership, not ownership
 *
 * Every method authorises with `getHousehold(householdId, userId)`, which
 * throws for a non-member. Deliberately NOT the owner-only check
 * `HouseholdSpaceService` uses: spaces are the property's structure and a
 * tenant should not renumber the floors, but knowing who lives across the
 * street is exactly the kind of thing every adult in the house needs to be able
 * to add at the moment they learn it.
 *
 * ## Reads are one query per table, never one per row
 *
 * `list` fetches neighbours, then their people in a single `inArray`, then the
 * areas, and stitches them in memory. A per-neighbour people query is the
 * classic N+1 and it lands on a street with forty homes.
 */

export interface CreateNeighbourInput {
  label: string;
  relation?: NeighbourRelation;
  neighbourhood_id?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  formatted_address?: string | null;
  latitude: number;
  longitude: number;
  place_source?: NeighbourPlaceSource;
  photo_key?: string | null;
  notes?: string | null;
  is_favorite?: boolean;
  is_emergency_contact?: boolean;
  has_spare_key?: boolean;
  /** Occupants created with the home, so an import is one call rather than N+1. */
  people?: CreateNeighbourPersonInput[];
}

export type UpdateNeighbourInput = Partial<Omit<CreateNeighbourInput, 'people'>>;

export interface CreateNeighbourPersonInput {
  name: string;
  role?: NeighbourPersonRole;
  phone?: string | null;
  email?: string | null;
  photo_key?: string | null;
  notes?: string | null;
  is_primary?: boolean;
  sort_order?: number;
  device_contact_id?: string | null;
}

export type UpdateNeighbourPersonInput = Partial<CreateNeighbourPersonInput>;

export interface CreateNeighbourhoodInput {
  name: string;
  description?: string | null;
  color?: string | null;
  photo_key?: string | null;
}

export type UpdateNeighbourhoodInput = Partial<CreateNeighbourhoodInput>;

export interface ListNeighbourFilters {
  neighbourhood_id?: string;
  relation?: NeighbourRelation;
  is_favorite?: boolean;
  search?: string;
}

type NeighbourRow = typeof schema.neighbours.$inferSelect;
type NeighbourPersonRow = typeof schema.neighbourPeople.$inferSelect;
type NeighbourhoodRow = typeof schema.neighbourhoods.$inferSelect;

/**
 * Metres between two coordinates (haversine).
 *
 * Duplicated on the client (`@utils/neighbourGeo`) rather than shared through a
 * package, and the duplication is deliberate: the client computes distances for
 * rows the server has never seen (a local-first household), so the two cannot
 * be one implementation reached over HTTP. `neighbour-service.test.ts` and
 * `neighbourGeo.test.ts` assert the SAME fixtures against both, which is what
 * keeps them honest.
 */
export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const EARTH_RADIUS_M = 6_371_008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function assertCoordinates(latitude: unknown, longitude: unknown): void {
  const errors: Record<string, string[]> = {};
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    errors.latitude = ['latitude must be a number between -90 and 90'];
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    errors.longitude = ['longitude must be a number between -180 and 180'];
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
}

export class NeighbourService {
  private readonly db: Database;
  private readonly householdService: HouseholdService;

  // `env` is passed through to `HouseholdService` (which needs it for the
  // membership lookup) and is deliberately not retained: nothing in this
  // service reads a binding of its own, and holding one would invite the next
  // contributor to reach for R2 or an AI provider from a file whose whole point
  // is that these rows go nowhere.
  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema }) as unknown as Database;
    this.householdService = new HouseholdService(env, d1);
  }

  /** Throws for a non-member; returns the property so callers can use its address. */
  private async requireMembership(householdId: string, userId: string) {
    return this.householdService.getHousehold(householdId, userId);
  }

  // ---------------------------------------------------------------- neighbours

  async list(householdId: string, userId: string, filters: ListNeighbourFilters = {}) {
    const household = await this.requireMembership(householdId, userId);

    const rows = await this.db
      .select()
      .from(schema.neighbours)
      .where(eq(schema.neighbours.household_id, householdId))
      .orderBy(asc(schema.neighbours.label));

    const filtered = rows.filter((row) => matchesFilters(row, filters));
    const people = await this.peopleFor(filtered.map((row) => row.id));
    const areas = await this.areaMap(householdId);
    const origin = originOf(household);

    return filtered.map((row) =>
      toNeighbourResponse(row, people.get(row.id) ?? [], areas.get(row.neighbourhood_id ?? ''), origin)
    );
  }

  async get(householdId: string, userId: string, neighbourId: string) {
    const household = await this.requireMembership(householdId, userId);
    const row = await this.rowOrThrow(householdId, neighbourId);
    const people = await this.peopleFor([neighbourId]);
    const areas = await this.areaMap(householdId);
    return toNeighbourResponse(
      row,
      people.get(neighbourId) ?? [],
      areas.get(row.neighbourhood_id ?? ''),
      originOf(household)
    );
  }

  async create(householdId: string, userId: string, input: CreateNeighbourInput) {
    await this.requireMembership(householdId, userId);
    assertCoordinates(input.latitude, input.longitude);
    if (!input.label?.trim()) throw new ValidationError({ label: ['label is required'] });
    await this.assertAreaBelongs(householdId, input.neighbourhood_id ?? null);

    const timestamp = now();
    const id = generateId();
    await this.db.insert(schema.neighbours).values({
      id,
      household_id: householdId,
      neighbourhood_id: input.neighbourhood_id ?? null,
      label: input.label.trim(),
      relation: input.relation ?? 'nearby',
      address_line1: input.address_line1 ?? null,
      address_line2: input.address_line2 ?? null,
      city: input.city ?? null,
      state_province: input.state_province ?? null,
      postal_code: input.postal_code ?? null,
      country: input.country ?? null,
      formatted_address: input.formatted_address ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      place_source: input.place_source ?? 'manual',
      photo_key: input.photo_key ?? null,
      notes: input.notes ?? null,
      is_favorite: input.is_favorite ?? false,
      is_emergency_contact: input.is_emergency_contact ?? false,
      has_spare_key: input.has_spare_key ?? false,
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    });

    // The occupants arrive with the home so a contact import is ONE round trip.
    for (const [index, person] of (input.people ?? []).entries()) {
      await this.insertPerson(householdId, id, person, index);
    }

    return this.get(householdId, userId, id);
  }

  async update(
    householdId: string,
    userId: string,
    neighbourId: string,
    input: UpdateNeighbourInput
  ) {
    await this.requireMembership(householdId, userId);
    await this.rowOrThrow(householdId, neighbourId);
    if (input.latitude !== undefined || input.longitude !== undefined) {
      // Both or neither: half a coordinate move puts the pin in the sea.
      if (input.latitude === undefined || input.longitude === undefined) {
        throw new ValidationError({
          latitude: ['latitude and longitude must be updated together'],
        });
      }
      assertCoordinates(input.latitude, input.longitude);
    }
    if (input.neighbourhood_id !== undefined) {
      await this.assertAreaBelongs(householdId, input.neighbourhood_id);
    }

    // Field-by-field: an absent key means "leave it alone". Spreading the body
    // would null every column the edit form did not send.
    const patch: Partial<NeighbourRow> = { updated_at: now() };
    if (input.label !== undefined) patch.label = input.label.trim();
    if (input.relation !== undefined) patch.relation = input.relation;
    if (input.neighbourhood_id !== undefined) patch.neighbourhood_id = input.neighbourhood_id;
    if (input.address_line1 !== undefined) patch.address_line1 = input.address_line1;
    if (input.address_line2 !== undefined) patch.address_line2 = input.address_line2;
    if (input.city !== undefined) patch.city = input.city;
    if (input.state_province !== undefined) patch.state_province = input.state_province;
    if (input.postal_code !== undefined) patch.postal_code = input.postal_code;
    if (input.country !== undefined) patch.country = input.country;
    if (input.formatted_address !== undefined) patch.formatted_address = input.formatted_address;
    if (input.latitude !== undefined) patch.latitude = input.latitude;
    if (input.longitude !== undefined) patch.longitude = input.longitude;
    if (input.place_source !== undefined) patch.place_source = input.place_source;
    if (input.photo_key !== undefined) patch.photo_key = input.photo_key;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.is_favorite !== undefined) patch.is_favorite = input.is_favorite;
    if (input.is_emergency_contact !== undefined) {
      patch.is_emergency_contact = input.is_emergency_contact;
    }
    if (input.has_spare_key !== undefined) patch.has_spare_key = input.has_spare_key;

    await this.db
      .update(schema.neighbours)
      .set(patch)
      .where(
        and(eq(schema.neighbours.id, neighbourId), eq(schema.neighbours.household_id, householdId))
      );

    return this.get(householdId, userId, neighbourId);
  }

  /**
   * Hard delete, and the occupants go with it.
   *
   * D1 declares `ON DELETE CASCADE` on `neighbour_people.neighbour_id`, but the
   * people are removed explicitly anyway: D1 does not enforce foreign keys on
   * every path, and the device ledger has no foreign keys at all — the local
   * facade performs exactly this cascade by hand, so the two behave the same.
   */
  async remove(householdId: string, userId: string, neighbourId: string): Promise<void> {
    await this.requireMembership(householdId, userId);
    await this.rowOrThrow(householdId, neighbourId);
    await this.db
      .delete(schema.neighbourPeople)
      .where(eq(schema.neighbourPeople.neighbour_id, neighbourId));
    await this.db
      .delete(schema.neighbours)
      .where(
        and(eq(schema.neighbours.id, neighbourId), eq(schema.neighbours.household_id, householdId))
      );
  }

  // ------------------------------------------------------------------- people

  async addPerson(
    householdId: string,
    userId: string,
    neighbourId: string,
    input: CreateNeighbourPersonInput
  ) {
    await this.requireMembership(householdId, userId);
    await this.rowOrThrow(householdId, neighbourId);
    if (!input.name?.trim()) throw new ValidationError({ name: ['name is required'] });

    const existing = await this.peopleFor([neighbourId]);
    const nextOrder = (existing.get(neighbourId) ?? []).length;
    const id = await this.insertPerson(householdId, neighbourId, input, nextOrder);
    return this.personOrThrow(householdId, id);
  }

  async updatePerson(
    householdId: string,
    userId: string,
    personId: string,
    input: UpdateNeighbourPersonInput
  ) {
    await this.requireMembership(householdId, userId);
    const person = await this.personOrThrow(householdId, personId);

    const patch: Partial<NeighbourPersonRow> = { updated_at: now() };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.role !== undefined) patch.role = input.role;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.email !== undefined) patch.email = input.email;
    if (input.photo_key !== undefined) patch.photo_key = input.photo_key;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.is_primary !== undefined) patch.is_primary = input.is_primary;
    if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
    if (input.device_contact_id !== undefined) patch.device_contact_id = input.device_contact_id;

    await this.db
      .update(schema.neighbourPeople)
      .set(patch)
      .where(eq(schema.neighbourPeople.id, personId));

    // One primary per home. Demoting the others here rather than in the client
    // keeps the invariant true for any caller, including a bulk import.
    if (input.is_primary === true) {
      await this.demoteOtherPrimaries(person.neighbour_id, personId);
    }

    return this.personOrThrow(householdId, personId);
  }

  async removePerson(householdId: string, userId: string, personId: string): Promise<void> {
    await this.requireMembership(householdId, userId);
    await this.personOrThrow(householdId, personId);
    await this.db.delete(schema.neighbourPeople).where(eq(schema.neighbourPeople.id, personId));
  }

  // -------------------------------------------------------------- neighbourhoods

  async listNeighbourhoods(householdId: string, userId: string) {
    await this.requireMembership(householdId, userId);
    const rows = await this.db
      .select()
      .from(schema.neighbourhoods)
      .where(eq(schema.neighbourhoods.household_id, householdId))
      .orderBy(asc(schema.neighbourhoods.name));

    const counts = await this.db
      .select({ id: schema.neighbours.id, area: schema.neighbours.neighbourhood_id })
      .from(schema.neighbours)
      .where(eq(schema.neighbours.household_id, householdId));

    return rows.map((row) => ({
      ...toNeighbourhoodResponse(row),
      neighbour_count: counts.filter((c) => c.area === row.id).length,
    }));
  }

  async createNeighbourhood(
    householdId: string,
    userId: string,
    input: CreateNeighbourhoodInput
  ) {
    await this.requireMembership(householdId, userId);
    const name = input.name?.trim();
    if (!name) throw new ValidationError({ name: ['name is required'] });

    const clash = await this.db
      .select({ id: schema.neighbourhoods.id })
      .from(schema.neighbourhoods)
      .where(
        and(
          eq(schema.neighbourhoods.household_id, householdId),
          eq(schema.neighbourhoods.name, name)
        )
      );
    // Answered before the insert so the member gets a sentence rather than a
    // constraint violation. The unique index is still the authority.
    if (clash.length > 0) throw new ConflictError('A neighbourhood with this name already exists');

    const timestamp = now();
    const id = generateId();
    await this.db.insert(schema.neighbourhoods).values({
      id,
      household_id: householdId,
      name,
      description: input.description ?? null,
      color: input.color ?? null,
      photo_key: input.photo_key ?? null,
      created_by: userId,
      created_at: timestamp,
      updated_at: timestamp,
    });
    return { ...toNeighbourhoodResponse({ ...(await this.areaOrThrow(householdId, id)) }), neighbour_count: 0 };
  }

  async updateNeighbourhood(
    householdId: string,
    userId: string,
    neighbourhoodId: string,
    input: UpdateNeighbourhoodInput
  ) {
    await this.requireMembership(householdId, userId);
    await this.areaOrThrow(householdId, neighbourhoodId);

    const patch: Partial<NeighbourhoodRow> = { updated_at: now() };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.color !== undefined) patch.color = input.color;
    if (input.photo_key !== undefined) patch.photo_key = input.photo_key;

    await this.db
      .update(schema.neighbourhoods)
      .set(patch)
      .where(eq(schema.neighbourhoods.id, neighbourhoodId));

    const counts = await this.db
      .select({ id: schema.neighbours.id })
      .from(schema.neighbours)
      .where(eq(schema.neighbours.neighbourhood_id, neighbourhoodId));

    return {
      ...toNeighbourhoodResponse(await this.areaOrThrow(householdId, neighbourhoodId)),
      neighbour_count: counts.length,
    };
  }

  /**
   * Delete the area; the homes inside it survive, unfiled.
   *
   * `ON DELETE SET NULL` says the same thing, but it is written out here for
   * the reason the cascade above is: the device ledger has no constraints and
   * the local facade must perform this by hand, so both sides do it explicitly.
   */
  async deleteNeighbourhood(
    householdId: string,
    userId: string,
    neighbourhoodId: string
  ): Promise<void> {
    await this.requireMembership(householdId, userId);
    await this.areaOrThrow(householdId, neighbourhoodId);
    await this.db
      .update(schema.neighbours)
      .set({ neighbourhood_id: null, updated_at: now() })
      .where(eq(schema.neighbours.neighbourhood_id, neighbourhoodId));
    await this.db
      .delete(schema.neighbourhoods)
      .where(eq(schema.neighbourhoods.id, neighbourhoodId));
  }

  // ------------------------------------------------------------------ internals

  private async insertPerson(
    householdId: string,
    neighbourId: string,
    input: CreateNeighbourPersonInput,
    fallbackOrder: number
  ): Promise<string> {
    if (!NEIGHBOUR_PERSON_ROLES.includes((input.role ?? 'adult') as NeighbourPersonRole)) {
      throw new ValidationError({ role: ['invalid role'] });
    }
    const timestamp = now();
    const id = generateId();
    await this.db.insert(schema.neighbourPeople).values({
      id,
      neighbour_id: neighbourId,
      household_id: householdId,
      name: input.name.trim(),
      role: input.role ?? 'adult',
      phone: input.phone ?? null,
      email: input.email ?? null,
      photo_key: input.photo_key ?? null,
      notes: input.notes ?? null,
      // The first occupant is the primary unless told otherwise — a home with
      // people but no face on the map pin is a bug the member cannot fix.
      is_primary: input.is_primary ?? fallbackOrder === 0,
      sort_order: input.sort_order ?? fallbackOrder,
      device_contact_id: input.device_contact_id ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    });
    if (input.is_primary) await this.demoteOtherPrimaries(neighbourId, id);
    return id;
  }

  private async demoteOtherPrimaries(neighbourId: string, keepId: string): Promise<void> {
    const rows = await this.db
      .select({ id: schema.neighbourPeople.id })
      .from(schema.neighbourPeople)
      .where(eq(schema.neighbourPeople.neighbour_id, neighbourId));
    const others = rows.map((r) => r.id).filter((id) => id !== keepId);
    if (others.length === 0) return;
    await this.db
      .update(schema.neighbourPeople)
      .set({ is_primary: false })
      .where(inArray(schema.neighbourPeople.id, others));
  }

  private async peopleFor(neighbourIds: string[]): Promise<Map<string, NeighbourPersonRow[]>> {
    const byNeighbour = new Map<string, NeighbourPersonRow[]>();
    if (neighbourIds.length === 0) return byNeighbour;
    const rows = await this.db
      .select()
      .from(schema.neighbourPeople)
      .where(inArray(schema.neighbourPeople.neighbour_id, neighbourIds))
      .orderBy(asc(schema.neighbourPeople.sort_order));
    for (const row of rows) {
      const bucket = byNeighbour.get(row.neighbour_id) ?? [];
      bucket.push(row);
      byNeighbour.set(row.neighbour_id, bucket);
    }
    return byNeighbour;
  }

  private async areaMap(householdId: string): Promise<Map<string, NeighbourhoodRow>> {
    const rows = await this.db
      .select()
      .from(schema.neighbourhoods)
      .where(eq(schema.neighbourhoods.household_id, householdId));
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async rowOrThrow(householdId: string, neighbourId: string): Promise<NeighbourRow> {
    const rows = await this.db
      .select()
      .from(schema.neighbours)
      .where(
        and(eq(schema.neighbours.id, neighbourId), eq(schema.neighbours.household_id, householdId))
      );
    const row = rows[0];
    if (!row) throw new NotFoundError('Neighbour');
    return row;
  }

  private async personOrThrow(householdId: string, personId: string) {
    const rows = await this.db
      .select()
      .from(schema.neighbourPeople)
      .where(
        and(
          eq(schema.neighbourPeople.id, personId),
          eq(schema.neighbourPeople.household_id, householdId)
        )
      );
    const row = rows[0];
    if (!row) throw new NotFoundError('Neighbour person');
    return toPersonResponse(row);
  }

  private async areaOrThrow(
    householdId: string,
    neighbourhoodId: string
  ): Promise<NeighbourhoodRow> {
    const rows = await this.db
      .select()
      .from(schema.neighbourhoods)
      .where(
        and(
          eq(schema.neighbourhoods.id, neighbourhoodId),
          eq(schema.neighbourhoods.household_id, householdId)
        )
      );
    const row = rows[0];
    if (!row) throw new NotFoundError('Neighbourhood');
    return row;
  }

  /** A neighbourhood from another property must never be assignable. */
  private async assertAreaBelongs(householdId: string, areaId: string | null): Promise<void> {
    if (!areaId) return;
    await this.areaOrThrow(householdId, areaId);
  }
}

function matchesFilters(row: NeighbourRow, filters: ListNeighbourFilters): boolean {
  if (filters.neighbourhood_id && row.neighbourhood_id !== filters.neighbourhood_id) return false;
  if (filters.relation && row.relation !== filters.relation) return false;
  if (filters.is_favorite !== undefined && Boolean(row.is_favorite) !== filters.is_favorite) {
    return false;
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = [row.label, row.formatted_address, row.address_line1, row.notes]
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * The property's own coordinates, when it has any.
 *
 * `households` carries an address and no lat/lon — geocoding was removed from
 * the Worker (`MAP_PREVIEW_REMOVED`) — so `distance_meters` is `null` on the
 * server today and is computed on device, where the OS geocoder is. The hook is
 * here so the DTO does not change shape if a household ever gains coordinates.
 */
function originOf(_household: unknown): { latitude: number; longitude: number } | null {
  return null;
}

export function toPersonResponse(row: NeighbourPersonRow) {
  return {
    id: row.id,
    neighbour_id: row.neighbour_id,
    household_id: row.household_id,
    name: row.name,
    role: row.role as NeighbourPersonRole,
    phone: row.phone,
    email: row.email,
    photo_key: row.photo_key,
    notes: row.notes,
    is_primary: Boolean(row.is_primary),
    sort_order: row.sort_order,
    device_contact_id: row.device_contact_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toNeighbourhoodResponse(row: NeighbourhoodRow) {
  return {
    id: row.id,
    household_id: row.household_id,
    name: row.name,
    description: row.description,
    color: row.color,
    photo_key: row.photo_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toNeighbourResponse(
  row: NeighbourRow,
  people: NeighbourPersonRow[],
  area: NeighbourhoodRow | undefined,
  origin: { latitude: number; longitude: number } | null
) {
  return {
    id: row.id,
    household_id: row.household_id,
    neighbourhood_id: row.neighbourhood_id,
    label: row.label,
    relation: row.relation as NeighbourRelation,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    state_province: row.state_province,
    postal_code: row.postal_code,
    country: row.country,
    formatted_address: row.formatted_address,
    latitude: row.latitude,
    longitude: row.longitude,
    place_source: row.place_source as NeighbourPlaceSource,
    photo_key: row.photo_key,
    notes: row.notes,
    is_favorite: Boolean(row.is_favorite),
    is_emergency_contact: Boolean(row.is_emergency_contact),
    has_spare_key: Boolean(row.has_spare_key),
    created_at: row.created_at,
    updated_at: row.updated_at,
    people: people.map(toPersonResponse),
    person_count: people.length,
    neighbourhood: area ? toNeighbourhoodResponse(area) : null,
    distance_meters: origin ? Math.round(distanceMeters(origin, row)) : null,
  };
}

export const NEIGHBOUR_ENUMS = {
  relations: NEIGHBOUR_RELATIONS,
  placeSources: NEIGHBOUR_PLACE_SOURCES,
  personRoles: NEIGHBOUR_PERSON_ROLES,
} as const;
