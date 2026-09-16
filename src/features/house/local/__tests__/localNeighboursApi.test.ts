/**
 * `localNeighboursApi` against a real in-memory session (migration 0165).
 *
 * Five behaviours here are load-bearing beyond the round trip, and each one is
 * a bug that would only show up on a SECOND device:
 *
 *  - **A home and its occupants are ONE op.** `mutateLocalHouseLedger` diffs the
 *    whole ledger per call, so a home plus four people written separately is
 *    five cycles — and a peer that receives three of them has a family missing
 *    two members with nothing on screen to say so.
 *  - **Deleting a home takes its occupants with it, in one op.** The ledger has
 *    no foreign keys and a tombstone is absorbing, so an orphan is forever. The
 *    cascade list is asserted against the DRIZZLE SCHEMA rather than against the
 *    code, for the reason B2 taught on `CONTRACTOR_CASCADE_TABLES`.
 *  - **Deleting a neighbourhood UNFILES its homes rather than removing them**,
 *    also in one op. D1 says `ON DELETE SET NULL`; a ledger cannot express that,
 *    so the facade performs it, and a two-op version would leave every home in
 *    that area pointing at a tombstone.
 *  - **`neighbourhoods` is S3b.** Two members naming the same area offline must
 *    converge on ONE row. `neighbours` and `neighbourPeople` deliberately are
 *    not, and that asymmetry is asserted too — deriving an id from a label would
 *    merge two different families the first time a street repeated a surname.
 *  - **All three tables are ALWAYS-RESIDENT, at runtime.** `schema.ts` declines
 *    the window and `waveBCSchemaParity` proves the tempting entry is absent;
 *    this is the third leg — `rowBucket` on a real row. A neighbour in a colder
 *    bucket is a hole in a map, and a map has no empty row to show it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnknownPropertyError } from '../errors';
import { houseDeterministicIds } from '../ids';
import {
  NEIGHBOUR_CASCADE_TABLES,
  NEIGHBOUR_ORIGIN_SETTING_KEY,
  localNeighboursApi,
  neighbourDistanceMeters,
} from '../localNeighboursApi';
import { localSettingsApi } from '../localSettingsApi';
import * as localWrite from '../localWrite';
import { ALWAYS_RESIDENT_BUCKET, rowBucket } from '../projection';
import {
  HOUSE_DETERMINISTIC_ID_TABLES,
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_WINDOWED_DATE_FIELDS,
} from '../schema';

const USER = 'user-neighbours-1';

/** The same street fixture `neighbourGeo.test.ts` uses. See its header. */
const HOME = { latitude: 49.2827, longitude: -123.1207 };
const WILSONS = { latitude: 49.28306, longitude: -123.1207 };
const PATELS = { latitude: 49.2827, longitude: -123.12145 };

let householdId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

async function createWilsons(overrides: Record<string, unknown> = {}) {
  const { neighbour } = await localNeighboursApi.create(householdId, {
    label: 'The Wilsons',
    relation: 'next_door',
    latitude: WILSONS.latitude,
    longitude: WILSONS.longitude,
    address_line1: '44 Maple St',
    city: 'Vancouver',
    people: [
      { name: 'Sarah Wilson', phone: '+16045550142', is_primary: true },
      { name: 'Tom Wilson', phone: '+16045550143' },
    ],
    ...overrides,
  });
  return neighbour;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Neighbours test home' });
  householdId = ledger.household.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('create / read / update / delete', () => {
  it('round-trips a home with its occupants', async () => {
    const created = await createWilsons();
    expect(created.household_id).toBe(householdId);
    expect(created.label).toBe('The Wilsons');
    expect(created.person_count).toBe(2);
    expect(created.people.map((person) => person.name)).toEqual(['Sarah Wilson', 'Tom Wilson']);

    const { neighbour } = await localNeighboursApi.get(householdId, created.id);
    expect(neighbour.address_line1).toBe('44 Maple St');
    expect(neighbour.people).toHaveLength(2);
  });

  it('writes the home and every occupant in a SINGLE op', async () => {
    const before = opCount();
    await createWilsons();
    // One, not three. See the header: a peer applies the whole family or none.
    expect(opCount() - before).toBe(1);
  });

  /**
   * The op payload must be COPIES of the rows, never the rows themselves.
   *
   * Found on an iPad, by `nbr-008`, as a save that silently did nothing:
   * "Could not save this neighbour", the form sitting there, and in the log
   * `You attempted to set the key 'name' with the value "Sarah Wilson" on an
   * object that is meant to be immutable and has been frozen.`
   *
   * The payload is serialised into the encrypted op, and React Native
   * deep-freezes what crosses the bridge in __DEV__. Handing it the same objects
   * that went into the ledger froze the LEDGER rows, so editing a home that had
   * occupants threw for the rest of the session. Creating worked, which is why
   * nbr-005 stayed green and only the edit path failed.
   *
   * Nothing freezes in production, so this cannot be caught by asserting an
   * update succeeds — Jest never freezes either. The invariant that actually
   * holds is object identity, so that is what is asserted. It matters in
   * production too: a stored row and a queued op sharing an object means a later
   * edit rewrites history a peer has not received yet.
   */
  it('hands the op COPIES of the rows, not the rows the ledger keeps', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const real = localWrite.writeLocal;
    const spy = jest
      .spyOn(localWrite, 'writeLocal')
      .mockImplementation(async (mutator, op) => {
        seen.push(op.payload as Record<string, unknown>);
        return real(mutator, op);
      });

    try {
      const created = await createWilsons();
      const ledger = getLocalHouseLedger();
      const storedPeople = ledger.neighbourPeople.filter(
        (row) => row.neighbour_id === created.id
      );
      const storedHome = ledger.neighbours.find((row) => row.id === created.id);
      expect(storedPeople.length).toBeGreaterThan(0);

      const payload = seen.at(-1) as {
        neighbour: unknown;
        people: unknown[];
      };
      expect(payload.neighbour).not.toBe(storedHome);
      expect(payload.neighbour).toEqual(storedHome);
      for (const person of storedPeople) {
        expect(payload.people).not.toContain(person);
      }
      // Same data, different objects — a copy, not a different row.
      expect(payload.people).toHaveLength(storedPeople.length);
      expect(payload.people).toEqual(storedPeople.map((row) => ({ ...row })));
    } finally {
      spy.mockRestore();
    }
  });

  it('applies the Worker defaults so an offline home is indistinguishable', async () => {
    const { neighbour } = await localNeighboursApi.create(householdId, {
      label: 'Corner house',
      latitude: PATELS.latitude,
      longitude: PATELS.longitude,
    });
    expect(neighbour.relation).toBe('nearby');
    expect(neighbour.place_source).toBe('manual');
    expect(neighbour.is_favorite).toBe(false);
    expect(neighbour.is_emergency_contact).toBe(false);
    expect(neighbour.has_spare_key).toBe(false);
    expect(neighbour.person_count).toBe(0);
  });

  it('refuses a home with no position, and one with an impossible one', async () => {
    // The map IS the feature — a row that cannot be drawn is a note, not a
    // neighbour. Both sides enforce the same bounds.
    await expect(
      localNeighboursApi.create(householdId, {
        label: 'Nowhere',
        latitude: Number.NaN,
        longitude: 0,
      })
    ).rejects.toThrow(/position on the map/);
    await expect(
      localNeighboursApi.create(householdId, { label: 'Off-world', latitude: 91, longitude: 0 })
    ).rejects.toThrow(/position on the map/);
  });

  it('refuses a home with no name', async () => {
    await expect(
      localNeighboursApi.create(householdId, {
        label: '   ',
        latitude: HOME.latitude,
        longitude: HOME.longitude,
      })
    ).rejects.toThrow(/needs a name/);
  });

  it('patches only the fields the caller sent', async () => {
    const created = await createWilsons();
    const { neighbour } = await localNeighboursApi.update(householdId, created.id, {
      notes: 'Feeds the cat',
    });
    // A spread of the request would have nulled the address and the relation.
    expect(neighbour.notes).toBe('Feeds the cat');
    expect(neighbour.address_line1).toBe('44 Maple St');
    expect(neighbour.relation).toBe('next_door');
    expect(neighbour.people).toHaveLength(2);
  });

  it('refuses half a coordinate move', async () => {
    const created = await createWilsons();
    await expect(
      localNeighboursApi.update(householdId, created.id, { latitude: 49.3 })
    ).rejects.toThrow(/position on the map/);
  });

  it('raises loudly on a miss rather than answering empty', async () => {
    // The remote raises through `ensureData` on a 404. A local miss is the same
    // fact and must be as loud, or the edit screen opens an empty form and saves
    // a second home over the one the member meant to change.
    await expect(localNeighboursApi.get(householdId, 'nbr_missing')).rejects.toThrow(
      /Failed to get neighbour/
    );
    await expect(
      localNeighboursApi.update(householdId, 'nbr_missing', { label: 'x' })
    ).rejects.toThrow(/Failed to update neighbour/);
    await expect(localNeighboursApi.remove(householdId, 'nbr_missing')).rejects.toThrow(
      /Failed to delete neighbour/
    );
  });

  it('refuses to serve another property out of the active ledger', async () => {
    await expect(localNeighboursApi.getAll('hh_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError
    );
  });
});

describe('the delete cascade', () => {
  it('removes the occupants with the home, in ONE op', async () => {
    const created = await createWilsons();
    const before = opCount();
    await localNeighboursApi.remove(householdId, created.id);

    expect(opCount() - before).toBe(1);
    const ledger = getLocalHouseLedger();
    expect(ledger.neighbours).toHaveLength(0);
    // The half that matters: a tombstone is absorbing, so an occupant left
    // behind can never be reunited with its home or removed by a later write.
    expect(ledger.neighbourPeople).toHaveLength(0);
  });

  it('names every table D1 cascades from `neighbours`', () => {
    // Asserted against the DRIZZLE SOURCE, not against the facade — the list is
    // written when one child exists and the next child is added by someone who
    // never reads it. B2 paid for this lesson on `CONTRACTOR_CASCADE_TABLES`.
    const source = readFileSync(
      join(__dirname, '../../../../../backend/src/db/schema-neighbours.ts'),
      'utf8'
    );
    const cascading = [...source.matchAll(/references\(\(\) => (\w+)\.id, \{ onDelete: 'cascade' \}/g)]
      .map((match) => match[1]);
    expect(cascading).toContain('neighbours');

    const ledgered = NEIGHBOUR_CASCADE_TABLES.map((table) => HOUSE_LEDGER_PHYSICAL_TABLES[table]);
    expect(ledgered).toEqual(['neighbour_people']);
  });

  it('leaves other homes untouched', async () => {
    const wilsons = await createWilsons();
    const { neighbour: patels } = await localNeighboursApi.create(householdId, {
      label: 'The Patels',
      latitude: PATELS.latitude,
      longitude: PATELS.longitude,
      people: [{ name: 'Anita Patel' }],
    });

    await localNeighboursApi.remove(householdId, wilsons.id);
    const { neighbours } = await localNeighboursApi.getAll(householdId);
    expect(neighbours.map((n) => n.id)).toEqual([patels.id]);
    expect(neighbours[0]!.people).toHaveLength(1);
  });
});

describe('occupants', () => {
  it('makes the first occupant the main contact by default', async () => {
    const { neighbour } = await localNeighboursApi.create(householdId, {
      label: 'The Patels',
      latitude: PATELS.latitude,
      longitude: PATELS.longitude,
      people: [{ name: 'Anita Patel' }, { name: 'Raj Patel' }],
    });
    // A home with people but no face on its map bubble is a gap the member
    // cannot see the cause of, let alone fix.
    expect(neighbour.people[0]!.is_primary).toBe(true);
    expect(neighbour.people[1]!.is_primary).toBe(false);
  });

  it('honours an explicit primary anywhere in the batch, and demotes the rest', async () => {
    const { neighbour } = await localNeighboursApi.create(householdId, {
      label: 'The Patels',
      latitude: PATELS.latitude,
      longitude: PATELS.longitude,
      people: [{ name: 'Anita Patel' }, { name: 'Raj Patel', is_primary: true }],
    });
    expect(neighbour.people.filter((person) => person.is_primary)).toHaveLength(1);
    expect(neighbour.people.find((person) => person.is_primary)!.name).toBe('Raj Patel');
  });

  it('demotes the previous primary in the SAME op as the promotion', async () => {
    const created = await createWilsons();
    const tom = created.people.find((person) => person.name === 'Tom Wilson')!;
    const before = opCount();
    await localNeighboursApi.updatePerson(householdId, tom.id, { is_primary: true });

    // Two ops would let a peer see a home with two primaries, and per-field LWW
    // has no way to decide which one lost.
    expect(opCount() - before).toBe(1);
    const { neighbour } = await localNeighboursApi.get(householdId, created.id);
    expect(neighbour.people.filter((person) => person.is_primary).map((p) => p.name)).toEqual([
      'Tom Wilson',
    ]);
  });

  it('adds a person to an existing home, appended in order', async () => {
    const created = await createWilsons();
    const { person } = await localNeighboursApi.addPerson(householdId, created.id, {
      name: 'Ellie Wilson',
      role: 'child',
    });
    expect(person.sort_order).toBe(2);
    expect(person.is_primary).toBe(false);

    const { neighbour } = await localNeighboursApi.get(householdId, created.id);
    expect(neighbour.person_count).toBe(3);
    expect(neighbour.people.map((p) => p.name)).toEqual([
      'Sarah Wilson',
      'Tom Wilson',
      'Ellie Wilson',
    ]);
  });

  it('removes one person without touching the home', async () => {
    const created = await createWilsons();
    await localNeighboursApi.removePerson(householdId, created.people[1]!.id);
    const { neighbour } = await localNeighboursApi.get(householdId, created.id);
    expect(neighbour.person_count).toBe(1);
    expect(neighbour.label).toBe('The Wilsons');
  });

  it('refuses to add a person to a home that is not there', async () => {
    await expect(
      localNeighboursApi.addPerson(householdId, 'nbr_missing', { name: 'Ghost' })
    ).rejects.toThrow(/Failed to add neighbour/);
  });
});

describe('neighbourhoods', () => {
  it('mints a DETERMINISTIC id from the household and the name', async () => {
    const { neighbourhood } = await localNeighboursApi.createNeighbourhood(householdId, {
      name: 'Maple Court',
    });
    expect(neighbourhood.id).toBe(houseDeterministicIds.neighbourhood(householdId, 'Maple Court'));
  });

  it('converges two offline creations of the same area onto one row', async () => {
    // The S3b failure this prevents: two members tidying their pins on the same
    // evening both reach for the obvious name, and random ids would keep both
    // rows — every home then filed under whichever one its device happened to
    // see.
    await localNeighboursApi.createNeighbourhood(householdId, { name: 'Maple Court' });
    await localNeighboursApi.createNeighbourhood(householdId, {
      name: '  maple court ',
      description: 'The cul-de-sac',
    });
    const { neighbourhoods } = await localNeighboursApi.getNeighbourhoods(householdId);
    expect(neighbourhoods).toHaveLength(1);
    // The normalisation is in the KEY only — the raw name is what the screens render.
    expect(neighbourhoods[0]!.description).toBe('The cul-de-sac');
  });

  it('registers the area as S3b and the other two as random', () => {
    // The asymmetry is the design. Deriving an id from a LABEL would merge two
    // different families the first time a street repeated a surname, which is
    // worse than a duplicate the member can see and delete.
    expect(HOUSE_DETERMINISTIC_ID_TABLES.neighbourhoods).toEqual(['household_id', 'name']);
    expect(HOUSE_DETERMINISTIC_ID_TABLES.neighbours).toBeUndefined();
    expect(HOUSE_DETERMINISTIC_ID_TABLES.neighbourPeople).toBeUndefined();
  });

  it('counts the homes filed under each area', async () => {
    const { neighbourhood } = await localNeighboursApi.createNeighbourhood(householdId, {
      name: 'Maple Court',
    });
    await createWilsons({ neighbourhood_id: neighbourhood.id });
    const { neighbourhoods } = await localNeighboursApi.getNeighbourhoods(householdId);
    expect(neighbourhoods[0]!.neighbour_count).toBe(1);
  });

  it('renames in place rather than re-minting the id', async () => {
    const { neighbourhood } = await localNeighboursApi.createNeighbourhood(householdId, {
      name: 'Maple Court',
    });
    const renamed = await localNeighboursApi.updateNeighbourhood(householdId, neighbourhood.id, {
      name: 'Maple Close',
    });
    // Re-minting would be a delete and an insert, and the tombstone is
    // absorbing: every peer would lose the area and every home under it would be
    // unfiled. The id is a merge key, not a label.
    expect(renamed.neighbourhood.id).toBe(neighbourhood.id);
    expect(renamed.neighbourhood.name).toBe('Maple Close');
  });

  it('UNFILES its homes on delete rather than removing them, in ONE op', async () => {
    const { neighbourhood } = await localNeighboursApi.createNeighbourhood(householdId, {
      name: 'Maple Court',
    });
    const home = await createWilsons({ neighbourhood_id: neighbourhood.id });

    const before = opCount();
    await localNeighboursApi.deleteNeighbourhood(householdId, neighbourhood.id);
    expect(opCount() - before).toBe(1);

    const { neighbour } = await localNeighboursApi.get(householdId, home.id);
    // The member removed a grouping, not a street.
    expect(neighbour.neighbourhood_id).toBeNull();
    expect(neighbour.neighbourhood).toBeNull();
    expect(neighbour.label).toBe('The Wilsons');
  });

  it('refuses a neighbourhood from another property', async () => {
    await expect(
      localNeighboursApi.create(householdId, {
        label: 'Somewhere',
        latitude: HOME.latitude,
        longitude: HOME.longitude,
        neighbourhood_id: 'nbh_from_another_house',
      })
    ).rejects.toThrow(/Failed to create neighbour/);
  });
});

describe('filters and ordering', () => {
  beforeEach(async () => {
    await createWilsons();
    await localNeighboursApi.create(householdId, {
      label: 'The Patels',
      relation: 'across',
      latitude: PATELS.latitude,
      longitude: PATELS.longitude,
      is_favorite: true,
      notes: 'Has our spare key',
    });
  });

  it('sorts by label, case-insensitively', async () => {
    await localNeighboursApi.create(householdId, {
      label: 'aardvark house',
      latitude: HOME.latitude,
      longitude: HOME.longitude,
    });
    const { neighbours } = await localNeighboursApi.getAll(householdId);
    expect(neighbours.map((n) => n.label)).toEqual([
      'aardvark house',
      'The Patels',
      'The Wilsons',
    ]);
  });

  it('filters by relation, favourite and free text', async () => {
    expect(
      (await localNeighboursApi.getAll(householdId, { relation: 'across' })).neighbours
    ).toHaveLength(1);
    expect(
      (await localNeighboursApi.getAll(householdId, { is_favorite: true })).neighbours
    ).toHaveLength(1);
    // Search reaches the notes and the address, not just the label — a member
    // hunting "spare key" is searching what they wrote, not what they named.
    expect(
      (await localNeighboursApi.getAll(householdId, { search: 'spare key' })).neighbours
    ).toHaveLength(1);
    expect(
      (await localNeighboursApi.getAll(householdId, { search: 'maple' })).neighbours
    ).toHaveLength(1);
  });

  it('toggles a favourite without disturbing anything else', async () => {
    const { neighbours } = await localNeighboursApi.getAll(householdId, { relation: 'next_door' });
    const wilsons = neighbours[0]!;
    const { neighbour } = await localNeighboursApi.toggleFavorite(householdId, wilsons.id, true);
    expect(neighbour.is_favorite).toBe(true);
    expect(neighbour.people).toHaveLength(2);
  });
});

describe('distance from the property', () => {
  it('is null until something has geocoded the household address', async () => {
    const created = await createWilsons();
    expect(created.distance_meters).toBeNull();
  });

  it('is measured from the cached origin once one exists', async () => {
    await localSettingsApi.update(NEIGHBOUR_ORIGIN_SETTING_KEY, HOME);
    const created = await createWilsons();
    // ~40 m — the width of a suburban lot. See `neighbourGeo.test.ts`, which
    // asserts the same fixture against the client copy of haversine.
    expect(created.distance_meters).toBeGreaterThan(30);
    expect(created.distance_meters).toBeLessThan(50);
  });

  it('survives a malformed setting rather than taking down the map', async () => {
    await localSettingsApi.update(NEIGHBOUR_ORIGIN_SETTING_KEY, 'not-a-point');
    const created = await createWilsons();
    expect(created.distance_meters).toBeNull();
  });

  it('agrees with the shared haversine fixtures', () => {
    expect(neighbourDistanceMeters(HOME, HOME)).toBe(0);
    expect(
      neighbourDistanceMeters(HOME, { latitude: 47.6062, longitude: -122.3321 }) / 1000
    ).toBeCloseTo(195.3, 1);
  });
});

describe('bulk import', () => {
  it('writes many homes in a handful of ops, not one per home', async () => {
    // The rule `localWrite.ts` exists for: a member importing thirty contacts is
    // watching a spinner, and thirty capture → diff → seal → persist cycles of
    // the whole ledger is quadratic in the size of their home.
    const entries = Array.from({ length: 30 }, (_, index) => ({
      label: `Home ${index}`,
      latitude: HOME.latitude + index * 0.0002,
      longitude: HOME.longitude,
      place_source: 'contact_import' as const,
      people: [{ name: `Person ${index}`, phone: `+1604555${String(index).padStart(4, '0')}` }],
    }));

    const before = opCount();
    const { neighbours } = await localNeighboursApi.importContacts(householdId, entries);
    const ops = opCount() - before;

    expect(neighbours).toHaveLength(30);
    expect(ops).toBeGreaterThan(0);
    expect(ops).toBeLessThan(5);

    const { neighbours: stored } = await localNeighboursApi.getAll(householdId);
    expect(stored).toHaveLength(30);
    // The occupants rode along inside their home's chunk — a chunk that landed
    // without them would be a home whose family never arrives.
    expect(stored.every((neighbour) => neighbour.person_count === 1)).toBe(true);
  });

  it('unfiles a bad area id rather than failing the whole batch', async () => {
    const { neighbours } = await localNeighboursApi.importContacts(householdId, [
      {
        label: 'Home A',
        latitude: HOME.latitude,
        longitude: HOME.longitude,
        neighbourhood_id: 'nbh_not_ours',
      },
      { label: 'Home B', latitude: PATELS.latitude, longitude: PATELS.longitude },
    ]);
    // One bad id in a thirty-row batch must not cost the member the other
    // twenty-nine.
    expect(neighbours).toHaveLength(2);
    expect(neighbours[0]!.neighbourhood_id).toBeNull();
  });

  it('writes nothing at all for an empty import', async () => {
    const before = opCount();
    const { neighbours } = await localNeighboursApi.importContacts(householdId, []);
    expect(neighbours).toEqual([]);
    expect(opCount()).toBe(before);
  });
});

describe('projection', () => {
  it('keeps all three tables ALWAYS-RESIDENT at runtime', async () => {
    const created = await createWilsons();
    const { neighbourhood } = await localNeighboursApi.createNeighbourhood(householdId, {
      name: 'Maple Court',
    });
    const ledger = getLocalHouseLedger();

    // The third leg of the argument in `schema.ts`: the window is declined, the
    // parity guard proves the tempting entry is impossible, and this proves a
    // REAL row buckets as resident. A neighbour outside a read window is a hole
    // in a map — the pins around it render, the street looks fully surveyed, and
    // there is no empty row to hint otherwise.
    // The cast is `rowBucket`'s signature, not a shortcut: it takes the shared
    // `LedgerRow` index-signature shape, and a DTO-derived row type has named
    // fields rather than one. Every other suite that reaches `rowBucket` with a
    // typed row does the same.
    const asRow = (row: unknown) => row as Record<string, unknown>;
    expect(rowBucket('neighbours', asRow(ledger.neighbours[0]))).toBe(ALWAYS_RESIDENT_BUCKET);
    expect(rowBucket('neighbourPeople', asRow(ledger.neighbourPeople[0]))).toBe(
      ALWAYS_RESIDENT_BUCKET
    );
    expect(rowBucket('neighbourhoods', asRow(ledger.neighbourhoods[0]))).toBe(
      ALWAYS_RESIDENT_BUCKET
    );
    expect(created.id).toBeTruthy();
    expect(neighbourhood.id).toBeTruthy();
  });

  it('declares no window for any of the three', () => {
    expect(HOUSE_WINDOWED_DATE_FIELDS.neighbours).toBeUndefined();
    expect(HOUSE_WINDOWED_DATE_FIELDS.neighbourPeople).toBeUndefined();
    expect(HOUSE_WINDOWED_DATE_FIELDS.neighbourhoods).toBeUndefined();
  });
});
