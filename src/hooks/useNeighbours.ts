import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Household } from '@api/households';
import type {
  CreateNeighbourPersonRequest,
  CreateNeighbourRequest,
  CreateNeighbourhoodRequest,
  NeighbourFilters,
  NeighbourWithPeople,
  NeighbourhoodWithCount,
  UpdateNeighbourPersonRequest,
  UpdateNeighbourRequest,
  UpdateNeighbourhoodRequest,
} from '@api/neighbours';
import { neighboursApi } from '@api/neighbours';
import { settingsApi } from '@api/settings';
import { NEIGHBOUR_ORIGIN_SETTING_KEY } from '@features/house/local/localNeighboursApi';
import { geocodeAddress } from '@services/geocoding';
import type { LatLng } from '@utils/neighbourGeo';

/**
 * Server cache for the Neighbours family.
 *
 * ## Plain `useQuery`, deliberately NOT `usePersistedQuery`
 *
 * Almost every list in this app uses `usePersistedQuery`, which mirrors the
 * result into MMKV so the screen paints instantly on a cold start. That is the
 * right trade for tasks and appliances and the wrong one here: MMKV is a
 * **second, unencrypted copy** of the data, and this data is the names, phone
 * numbers and front-door coordinates of people who never installed this app.
 *
 * The cost of declining it is close to zero, because on a local-first household
 * the "fetch" is a synchronous read of an already-open ledger — there is no
 * spinner to skip. Paying a real privacy cost to optimise away a cost that is
 * already nil would be a bad trade even if it were invisible.
 *
 * ## The query keys match the ledger refresh bridge
 *
 * `['neighbours', householdId]` and `[…, 'neighbourhoods']` are exactly what
 * `HOUSE_TABLE_QUERY_KEYS` invalidates when a neighbour row changes on this
 * device or arrives from a peer. Minting a different key here would leave the
 * bridge invalidating a key nothing holds — the map would then only update on
 * the device that made the edit, which is the one place the bug is invisible to
 * whoever wrote it.
 */

export const neighboursQueryKey = (householdId: string, filters?: NeighbourFilters) =>
  filters && Object.keys(filters).length > 0
    ? (['neighbours', householdId, filters] as const)
    : (['neighbours', householdId] as const);

export const neighbourhoodsQueryKey = (householdId: string) =>
  ['neighbours', householdId, 'neighbourhoods'] as const;

export function useNeighbours(householdId?: string, filters?: NeighbourFilters) {
  return useQuery<NeighbourWithPeople[]>({
    queryKey: neighboursQueryKey(householdId ?? '', filters),
    enabled: Boolean(householdId),
    // A ledger read is free and always current; the network path is a list that
    // changes when a member edits it. Neither wants aggressive refetching.
    staleTime: 30_000,
    queryFn: async () => {
      const { neighbours } = await neighboursApi.getAll(householdId!, filters);
      return neighbours;
    },
  });
}

export function useNeighbourhoods(householdId?: string) {
  return useQuery<NeighbourhoodWithCount[]>({
    queryKey: neighbourhoodsQueryKey(householdId ?? ''),
    enabled: Boolean(householdId),
    staleTime: 60_000,
    queryFn: async () => {
      const { neighbourhoods } = await neighboursApi.getNeighbourhoods(householdId!);
      return neighbourhoods;
    },
  });
}

/**
 * Every write, in one hook.
 *
 * Grouped rather than split into eight hooks because every screen in this
 * feature performs more than one of them — the edit screen creates a home AND
 * adds people AND may create an area — and eight `useMutation` calls per screen
 * is eight invalidation callbacks to keep in step. One invalidator, called by
 * all of them, cannot drift.
 */
export function useNeighbourMutations(householdId?: string) {
  const queryClient = useQueryClient();

  const invalidate = useCallback(async () => {
    if (!householdId) return;
    // The PREFIX, not the exact key: `useNeighbours` may hold several filtered
    // variants at once (the list screen's search, the map's unfiltered set) and
    // a write moves all of them.
    await queryClient.invalidateQueries({ queryKey: ['neighbours', householdId] });
  }, [queryClient, householdId]);

  const create = useMutation({
    mutationFn: (data: CreateNeighbourRequest) => neighboursApi.create(householdId!, data),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateNeighbourRequest }) =>
      neighboursApi.update(householdId!, id, data),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => neighboursApi.remove(householdId!, id),
    onSuccess: invalidate,
  });

  const toggleFavorite = useMutation({
    mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
      neighboursApi.toggleFavorite(householdId!, id, isFavorite),
    onSuccess: invalidate,
  });

  const addPerson = useMutation({
    mutationFn: ({
      neighbourId,
      data,
    }: {
      neighbourId: string;
      data: CreateNeighbourPersonRequest;
    }) => neighboursApi.addPerson(householdId!, neighbourId, data),
    onSuccess: invalidate,
  });

  const updatePerson = useMutation({
    mutationFn: ({ personId, data }: { personId: string; data: UpdateNeighbourPersonRequest }) =>
      neighboursApi.updatePerson(householdId!, personId, data),
    onSuccess: invalidate,
  });

  const removePerson = useMutation({
    mutationFn: (personId: string) => neighboursApi.removePerson(householdId!, personId),
    onSuccess: invalidate,
  });

  const createNeighbourhood = useMutation({
    mutationFn: (data: CreateNeighbourhoodRequest) =>
      neighboursApi.createNeighbourhood(householdId!, data),
    onSuccess: invalidate,
  });

  const updateNeighbourhood = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateNeighbourhoodRequest }) =>
      neighboursApi.updateNeighbourhood(householdId!, id, data),
    onSuccess: invalidate,
  });

  const deleteNeighbourhood = useMutation({
    mutationFn: (id: string) => neighboursApi.deleteNeighbourhood(householdId!, id),
    onSuccess: invalidate,
  });

  const importContacts = useMutation({
    mutationFn: (entries: CreateNeighbourRequest[]) =>
      neighboursApi.importContacts(householdId!, entries),
    onSuccess: invalidate,
  });

  return {
    create,
    update,
    remove,
    toggleFavorite,
    addPerson,
    updatePerson,
    removePerson,
    createNeighbourhood,
    updateNeighbourhood,
    deleteNeighbourhood,
    importContacts,
    invalidate,
  };
}

export type NeighbourOriginState = {
  origin: LatLng | null;
  /** True while the address is being geocoded for the first time. */
  resolving: boolean;
  /** The address exists but the geocoder could not place it. */
  unresolvable: boolean;
};

/**
 * The property's own coordinates — what the map opens on, and what every
 * distance is measured from.
 *
 * ## Why this is a hook and not a column
 *
 * `households` stores an address and no latitude/longitude; the Worker's
 * geocoder was retired, and adding two columns to the fleet's most-migrated
 * table for one feature is not a trade worth making. So the address is geocoded
 * ONCE, on device, through the OS geocoder, and the answer is parked in a
 * setting — which already syncs to the member's other devices, so the second
 * device does no work.
 *
 * ## Three states, not two
 *
 * `unresolvable` is separate from "still resolving" because they need different
 * screens. A property whose address will not geocode (a new subdivision, a rural
 * route) still gets the whole feature — the member drops pins by hand and the
 * map opens on their device's position instead — and telling them that once is
 * better than a spinner that never resolves.
 *
 * The geocode is attempted at most once per mount. A retry loop against a
 * provider that has already said "no such address" is a battery drain that
 * cannot succeed.
 */
export function useNeighbourOrigin(household: Household | null | undefined): NeighbourOriginState {
  const [state, setState] = useState<NeighbourOriginState>({
    origin: null,
    resolving: false,
    unresolvable: false,
  });
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!household?.id) return;
    if (attempted.current === household.id) return;
    attempted.current = household.id;

    let cancelled = false;

    const run = async () => {
      // 1. The cached answer. On a local-first household this is a synchronous
      //    ledger read, so the map opens on the right street with no flicker.
      try {
        const { settings } = await settingsApi.fetchAll();
        const cached = settings?.find((row) => row.key === NEIGHBOUR_ORIGIN_SETTING_KEY);
        const parsed = parseOrigin(cached?.value);
        if (parsed) {
          if (!cancelled) setState({ origin: parsed, resolving: false, unresolvable: false });
          return;
        }
      } catch {
        // A settings read that fails is not a reason to skip the geocode.
      }

      const query = [
        household.address_line1,
        household.city,
        household.state_province,
        household.postal_code,
        household.country,
      ]
        .filter((part) => !!part?.trim())
        .join(', ');

      if (!query) {
        if (!cancelled) setState({ origin: null, resolving: false, unresolvable: true });
        return;
      }

      if (!cancelled) setState((prev) => ({ ...prev, resolving: true }));
      const point = await geocodeAddress(query);
      if (cancelled) return;

      if (!point) {
        setState({ origin: null, resolving: false, unresolvable: true });
        return;
      }

      setState({ origin: point, resolving: false, unresolvable: false });
      try {
        await settingsApi.update(NEIGHBOUR_ORIGIN_SETTING_KEY, point);
      } catch {
        // Caching is an optimisation. Failing to cache costs one geocode next
        // launch and nothing else, so it must not surface as an error.
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [household?.id, household?.address_line1, household?.city, household?.state_province, household?.postal_code, household?.country]);

  return state;
}

function parseOrigin(value: unknown): LatLng | null {
  if (!value) return null;
  const raw = typeof value === 'string' ? safeParse(value) : value;
  const candidate = raw as Partial<LatLng> | null;
  if (typeof candidate?.latitude !== 'number' || typeof candidate?.longitude !== 'number') {
    return null;
  }
  return { latitude: candidate.latitude, longitude: candidate.longitude };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
