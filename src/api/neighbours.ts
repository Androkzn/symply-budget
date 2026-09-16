import type { HouseBlobDescriptor } from '@features/house/local/blobs';
import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

/**
 * Neighbours — the homes around this property, and the people who live in them.
 *
 * ## The shape, and why it is three types rather than one
 *
 * A pin on a map is a **home**. The people inside it are a list, and the list is
 * the interesting part: the Wilsons are three phone numbers, one of which is the
 * one you actually call about a parcel. Collapsing home and person into one row
 * — the obvious first design — means the second occupant either overwrites the
 * first or becomes a second pin on the same roof. Both are wrong, and both show
 * up on day two of real use.
 *
 * A **neighbourhood** groups homes into a named area with a picture and a tint.
 * It is optional everywhere: a household that never creates one still gets the
 * whole feature, and deleting one leaves its homes on the map.
 *
 * ## Coordinates are required, photos are not
 *
 * `latitude` / `longitude` are non-nullable on the DTO because this feature IS
 * the map. Everything else — the address components, the photo, the notes, even
 * the people — is optional, because the fastest useful thing a member can do is
 * tap a house and type "the Wilsons".
 *
 * ## Photos travel through H6 on a local-first household
 *
 * `photo_key` holds an R2 key on a server-backed household and the synthetic
 * `lf-blob/<id>` form on a local-first one; `photo_blob` carries the descriptor
 * that makes the BYTES reach a peer. Same pair as `ApplianceDocument.blob` and
 * `TaskPhoto.blob`, and for the same reason: a row that syncs while its file
 * does not is Budget's `localWishMedia` bug, one table over.
 *
 * The import is TYPE-ONLY — the blobs barrel pulls `expo-file-system` and the
 * crypto polyfill, which must not land in the graph of every api call.
 */

export const NEIGHBOUR_RELATIONS = [
  'next_door',
  'across',
  'behind',
  'corner',
  'nearby',
  'strata',
  'other',
] as const;
export type NeighbourRelation = (typeof NEIGHBOUR_RELATIONS)[number];

/**
 * Label + icon + tint per relation.
 *
 * `icon` is an Ionicons glyph so any consumer can render `<Icon name={...} />`
 * without a second lookup table, exactly as `SPECIALTY_INFO` does for
 * contractors.
 */
export const RELATION_INFO: Record<
  NeighbourRelation,
  { label: string; short: string; icon: string; color: string }
> = {
  next_door: { label: 'Next door', short: 'Next door', icon: 'home', color: '#4CAF50' },
  across: { label: 'Across the street', short: 'Across', icon: 'swap-horizontal', color: '#2196F3' },
  behind: { label: 'Backs onto us', short: 'Behind', icon: 'arrow-up', color: '#7E57C2' },
  corner: { label: 'On the corner', short: 'Corner', icon: 'git-branch', color: '#FF9800' },
  nearby: { label: 'Nearby', short: 'Nearby', icon: 'location', color: '#00BCD4' },
  strata: { label: 'Same building', short: 'Building', icon: 'business', color: '#5D4037' },
  other: { label: 'Other', short: 'Other', icon: 'ellipsis-horizontal', color: '#9E9E9E' },
};

export const NEIGHBOUR_PLACE_SOURCES = [
  'map_tap',
  'geocoded',
  'manual',
  'contact_import',
] as const;
export type NeighbourPlaceSource = (typeof NEIGHBOUR_PLACE_SOURCES)[number];

/**
 * How a pin got where it is, in the member's words.
 *
 * Shown on the detail sheet because the two halves have opposite reliability: a
 * tapped pin is exact and its address is a guess, a geocoded pin is the reverse.
 * A member who knows which one they are looking at can fix the half that is
 * wrong instead of distrusting both.
 */
export const PLACE_SOURCE_LABELS: Record<NeighbourPlaceSource, string> = {
  map_tap: 'Placed on the map',
  geocoded: 'Found from the address',
  manual: 'Entered by hand',
  contact_import: 'From your contacts',
};

export const NEIGHBOUR_PERSON_ROLES = ['adult', 'child', 'tenant', 'owner', 'pet', 'other'] as const;
export type NeighbourPersonRole = (typeof NEIGHBOUR_PERSON_ROLES)[number];

export const PERSON_ROLE_INFO: Record<NeighbourPersonRole, { label: string; icon: string }> = {
  adult: { label: 'Adult', icon: 'person' },
  child: { label: 'Child', icon: 'happy' },
  tenant: { label: 'Tenant', icon: 'key' },
  owner: { label: 'Owner', icon: 'home' },
  pet: { label: 'Pet', icon: 'paw' },
  other: { label: 'Other', icon: 'person-circle' },
};

export interface NeighbourPerson {
  id: string;
  neighbour_id: string;
  household_id: string;
  name: string;
  role: NeighbourPersonRole;
  phone: string | null;
  email: string | null;
  photo_key: string | null;
  /** H6 descriptor. Local-first only; absent on a server-backed household. */
  photo_blob?: HouseBlobDescriptor;
  notes: string | null;
  /** The face shown on the map bubble when the home has no photo of its own. */
  is_primary: boolean;
  sort_order: number;
  /** The OS address-book id this person came from, so a re-import updates. */
  device_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Neighbourhood {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  color: string | null;
  photo_key: string | null;
  photo_blob?: HouseBlobDescriptor;
  created_at: string;
  updated_at: string;
}

export interface NeighbourhoodWithCount extends Neighbourhood {
  neighbour_count: number;
}

export interface Neighbour {
  id: string;
  household_id: string;
  neighbourhood_id: string | null;
  label: string;
  relation: NeighbourRelation;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
  /** Exactly what the geocoder returned. Never re-joined from the components. */
  formatted_address: string | null;
  latitude: number;
  longitude: number;
  place_source: NeighbourPlaceSource;
  photo_key: string | null;
  photo_blob?: HouseBlobDescriptor;
  notes: string | null;
  is_favorite: boolean;
  is_emergency_contact: boolean;
  has_spare_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface NeighbourWithPeople extends Neighbour {
  people: NeighbourPerson[];
  person_count: number;
  neighbourhood: Neighbourhood | null;
  /**
   * Metres from this property, or `null` when the property's own coordinates
   * are unknown. Computed on device — the Worker has no lat/lon for a household
   * (server-side geocoding was retired), so this is `null` on every remote read
   * and a real number on a local-first one.
   */
  distance_meters: number | null;
}

export interface CreateNeighbourPersonRequest {
  name: string;
  role?: NeighbourPersonRole;
  phone?: string | null;
  email?: string | null;
  photo_key?: string | null;
  photo_blob?: HouseBlobDescriptor;
  notes?: string | null;
  is_primary?: boolean;
  sort_order?: number;
  device_contact_id?: string | null;
}

export type UpdateNeighbourPersonRequest = Partial<CreateNeighbourPersonRequest>;

export interface CreateNeighbourRequest {
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
  photo_blob?: HouseBlobDescriptor;
  notes?: string | null;
  is_favorite?: boolean;
  is_emergency_contact?: boolean;
  has_spare_key?: boolean;
  /** Occupants created with the home — one call, not N+1. */
  people?: CreateNeighbourPersonRequest[];
}

export type UpdateNeighbourRequest = Partial<Omit<CreateNeighbourRequest, 'people'>>;

export interface CreateNeighbourhoodRequest {
  name: string;
  description?: string | null;
  color?: string | null;
  photo_key?: string | null;
  photo_blob?: HouseBlobDescriptor;
}

export type UpdateNeighbourhoodRequest = Partial<CreateNeighbourhoodRequest>;

export interface NeighbourFilters {
  neighbourhood_id?: string;
  relation?: NeighbourRelation;
  is_favorite?: boolean;
  search?: string;
}

export interface NeighboursResponse {
  neighbours: NeighbourWithPeople[];
}
export interface NeighbourResponse {
  neighbour: NeighbourWithPeople;
}
export interface NeighbourPersonResponse {
  person: NeighbourPerson;
}
export interface NeighbourhoodsResponse {
  neighbourhoods: NeighbourhoodWithCount[];
}
export interface NeighbourhoodResponse {
  neighbourhood: NeighbourhoodWithCount;
}

const base = (householdId: string) => `/households/${householdId}/neighbours`;

const remoteNeighboursApi = {
  getAll: (householdId: string, filters?: NeighbourFilters) => {
    const params = new URLSearchParams();
    if (filters?.neighbourhood_id) params.set('neighbourhood_id', filters.neighbourhood_id);
    if (filters?.relation) params.set('relation', filters.relation);
    if (filters?.is_favorite !== undefined) params.set('is_favorite', String(filters.is_favorite));
    if (filters?.search) params.set('search', filters.search);
    const query = params.toString();
    return apiClient
      .get<NeighboursResponse>(`${base(householdId)}${query ? `?${query}` : ''}`)
      .then((res) => res.data);
  },

  get: (householdId: string, neighbourId: string) =>
    apiClient
      .get<NeighbourResponse>(`${base(householdId)}/${neighbourId}`)
      .then((res) => res.data),

  create: (householdId: string, data: CreateNeighbourRequest) =>
    apiClient.post<NeighbourResponse>(base(householdId), data).then((res) => res.data),

  update: (householdId: string, neighbourId: string, data: UpdateNeighbourRequest) =>
    apiClient
      .patch<NeighbourResponse>(`${base(householdId)}/${neighbourId}`, data)
      .then((res) => res.data),

  remove: (householdId: string, neighbourId: string) =>
    apiClient.delete(`${base(householdId)}/${neighbourId}`).then(() => undefined),

  /**
   * A one-field update with its own method, because the star is tapped from a
   * list row that holds no other draft state — sending the whole neighbour back
   * from a card would race an edit screen open on the same row.
   */
  toggleFavorite: (householdId: string, neighbourId: string, isFavorite: boolean) =>
    apiClient
      .patch<NeighbourResponse>(`${base(householdId)}/${neighbourId}`, {
        is_favorite: isFavorite,
      })
      .then((res) => res.data),

  addPerson: (householdId: string, neighbourId: string, data: CreateNeighbourPersonRequest) =>
    apiClient
      .post<NeighbourPersonResponse>(`${base(householdId)}/${neighbourId}/people`, data)
      .then((res) => res.data),

  updatePerson: (householdId: string, personId: string, data: UpdateNeighbourPersonRequest) =>
    apiClient
      .patch<NeighbourPersonResponse>(`${base(householdId)}/people/${personId}`, data)
      .then((res) => res.data),

  removePerson: (householdId: string, personId: string) =>
    apiClient.delete(`${base(householdId)}/people/${personId}`).then(() => undefined),

  getNeighbourhoods: (householdId: string) =>
    apiClient
      .get<NeighbourhoodsResponse>(`${base(householdId)}/neighbourhoods`)
      .then((res) => res.data),

  createNeighbourhood: (householdId: string, data: CreateNeighbourhoodRequest) =>
    apiClient
      .post<NeighbourhoodResponse>(`${base(householdId)}/neighbourhoods`, data)
      .then((res) => res.data),

  updateNeighbourhood: (
    householdId: string,
    neighbourhoodId: string,
    data: UpdateNeighbourhoodRequest
  ) =>
    apiClient
      .patch<NeighbourhoodResponse>(
        `${base(householdId)}/neighbourhoods/${neighbourhoodId}`,
        data
      )
      .then((res) => res.data),

  deleteNeighbourhood: (householdId: string, neighbourhoodId: string) =>
    apiClient
      .delete(`${base(householdId)}/neighbourhoods/${neighbourhoodId}`)
      .then(() => undefined),

  /**
   * Bulk create from the device address book.
   *
   * A separate method rather than a loop over `create`, because the local
   * facade must write ONE ledger op per chunk: `mutateLocalHouseLedger` diffs
   * the whole ledger per call, so importing thirty contacts one at a time is
   * quadratic while the member watches. The remote form is a plain sequence —
   * the server has no such cost — and the shapes agree so the caller cannot
   * tell which one it reached.
   */
  importContacts: async (householdId: string, entries: CreateNeighbourRequest[]) => {
    const created: NeighbourWithPeople[] = [];
    for (const entry of entries) {
      const { neighbour } = await remoteNeighboursApi.create(householdId, entry);
      created.push(neighbour);
    }
    return { neighbours: created };
  },
};

/**
 * House V2 facade — the ledger on a local-first household, the Worker
 * otherwise. Screens call `neighboursApi` and cannot tell which one answered.
 *
 * `remoteMethods` is empty and `strict` is on (the default): every method has a
 * local counterpart, because neighbours are entirely device-owned data. There
 * is nothing here an AI provider or a server needs to see, which is the whole
 * reason the family was designed Tier A rather than split.
 */
export const neighboursApi: typeof remoteNeighboursApi = createHouseLocalProxy(
  remoteNeighboursApi,
  {
    moduleName: 'neighbours',
    // Narrow require — the barrel would pull the sync orchestrator and the
    // status store into every api call from every screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveLocal: () => require('@features/house/local/localNeighboursApi').localNeighboursApi,
  }
);
