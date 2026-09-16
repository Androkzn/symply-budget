/**
 * `localAppliancesApi` against a real in-memory session (plan §6 DoD, Wave A).
 *
 * Four behaviours here are load-bearing beyond the round trip:
 *
 *  - **`getDocuments` / `addDocument` must WORK.** They threw until 2026-08-15,
 *    on a header that said the H6 blob channel was "not built". H6 had shipped;
 *    what was missing was a REGISTRY entry for `appliance_documents`, which
 *    `registryCompleteness.test.ts` found (`schema.ts`). The old cases asserted
 *    the throw and its member-facing copy; they are replaced rather than deleted,
 *    because "this method answers instead of throwing" is the behaviour that
 *    now needs locking.
 *  - **Deleting an appliance takes BOTH of its cascading tables with it, in ONE
 *    op.** The Worker soft-deletes, so D1's foreign keys never fire there and a
 *    cascade pre-audit reads "none"; the ledger has no `deleted_at` on this DTO,
 *    so a local delete is an absorbing tombstone and an orphan is forever. The
 *    list is asserted against the DRIZZLE SCHEMA rather than against the code,
 *    for the reason B2 taught on `CONTRACTOR_CASCADE_TABLES`: the delete was
 *    written when one child was live and a second was registered later.
 *  - **`applianceDocuments` is ALWAYS-RESIDENT, at runtime.** `schema.ts`
 *    declines the window and `waveBCSchemaParity` proves the tempting entry is
 *    impossible; this is the third leg — `rowBucket` on a real row. C3 and C4
 *    used the same pair of checks to prove a window was NOT inert; this pair
 *    proves the absence is a decision.
 *  - the running maintenance total must accumulate in cents. Dollars-as-floats
 *    is the same trap `appliance-service.ts:387` records paying for once.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { BLOB_KEY_PREFIX } from '../blobs';
import { HouseLocalUnknownPropertyError } from '../errors';
import {
  APPLIANCE_CASCADE_TABLES,
  HOUSE_BLOB_KEY_PREFIX,
  localAppliancesApi,
} from '../localAppliancesApi';
import { ALWAYS_RESIDENT_BUCKET, rowBucket } from '../projection';
import {
  HOUSE_LEDGER_PHYSICAL_TABLES,
  HOUSE_LEDGER_TABLE_NAMES,
  HOUSE_WINDOWED_DATE_FIELDS,
} from '../schema';
import type { LocalApplianceDocument } from '../types';
import { HOUSE_UNSUPPORTED_COPY } from '../unsupportedCopy';

const USER = 'user-appliances-1';

let householdId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

async function createFurnace() {
  const { appliance } = await localAppliancesApi.create(householdId, {
    name: 'Furnace',
    category: 'hvac',
    type: 'Furnace',
    brand: 'Lennox',
    purchase_cost: 4200,
  });
  return appliance;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Appliance test home' });
  householdId = ledger.household.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('create / read / update / delete', () => {
  it('round-trips an appliance', async () => {
    const created = await createFurnace();
    expect(created.household_id).toBe(householdId);
    expect(created.total_maintenance_cost).toBe(0);

    const { appliance } = await localAppliancesApi.get(householdId, created.id);
    expect(appliance.name).toBe('Furnace');

    const { appliance: updated } = await localAppliancesApi.update(householdId, created.id, {
      location: 'Basement',
      brand: '',
    });
    expect(updated.location).toBe('Basement');
    // The DTO clears with `undefined`, not with an empty string — the screens
    // render `brand ?? '—'` and would otherwise show a blank chip.
    expect(updated.brand).toBeUndefined();
    expect(updated.type).toBe('Furnace');

    await localAppliancesApi.delete(householdId, created.id);
    const { appliances } = await localAppliancesApi.list(householdId);
    expect(appliances).toHaveLength(0);
  });

  it('lists newest first and filters by category and space', async () => {
    const { appliance: hvac } = await localAppliancesApi.create(householdId, {
      name: 'Heat pump',
      category: 'hvac',
      type: 'Heat Pump',
      space_id: 'spc_utility',
    });
    const { appliance: kitchen } = await localAppliancesApi.create(householdId, {
      name: 'Dishwasher',
      category: 'kitchen',
      type: 'Dishwasher',
    });

    const all = await localAppliancesApi.list(householdId);
    expect(all.appliances.map((row) => row.id)).toEqual(
      [...all.appliances]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((row) => row.id),
    );
    expect(all.appliances).toHaveLength(2);

    const byCategory = await localAppliancesApi.list(householdId, { category: 'kitchen' });
    expect(byCategory.appliances.map((row) => row.id)).toEqual([kitchen.id]);

    const bySpace = await localAppliancesApi.list(householdId, { space_id: 'spc_utility' });
    expect(bySpace.appliances.map((row) => row.id)).toEqual([hvac.id]);
  });

  it('raises for an appliance that does not exist', async () => {
    await expect(localAppliancesApi.get(householdId, 'app_missing')).rejects.toThrow(
      'Appliance not found',
    );
    await expect(
      localAppliancesApi.update(householdId, 'app_missing', { name: 'x' }),
    ).rejects.toThrow('Appliance not found');
    await expect(localAppliancesApi.delete(householdId, 'app_missing')).rejects.toThrow(
      'Appliance not found',
    );
  });

  it('refuses to answer for a property that is not the active one', async () => {
    await expect(localAppliancesApi.list('hh_local_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });
});

describe('service history', () => {
  it('adds an entry and moves the running total in ONE op', async () => {
    const appliance = await createFurnace();
    const before = opCount();

    const { entry } = await localAppliancesApi.addServiceHistory(householdId, appliance.id, {
      service_date: '2026-03-14',
      description: 'Annual service',
      cost: 189.5,
    });

    expect(entry.appliance_id).toBe(appliance.id);
    expect(entry.cost).toBe(189.5);
    expect(opCount() - before).toBe(1);

    const { appliance: after } = await localAppliancesApi.get(householdId, appliance.id);
    expect(after.total_maintenance_cost).toBe(189.5);
  });

  it('accumulates in cents so the total does not drift', async () => {
    const appliance = await createFurnace();
    // Sequential on purpose: each entry reads the total the previous one wrote.
    for (const cost of [0.1, 0.2, 10.05]) {
      await localAppliancesApi.addServiceHistory(householdId, appliance.id, {
        service_date: '2026-01-01',
        description: 'Filter',
        cost,
      });
    }
    const { appliance: after } = await localAppliancesApi.get(householdId, appliance.id);
    expect(after.total_maintenance_cost).toBe(10.35);
  });

  it('returns history newest first and drops it with the appliance', async () => {
    const appliance = await createFurnace();
    await localAppliancesApi.addServiceHistory(householdId, appliance.id, {
      service_date: '2025-06-01',
      description: 'Older',
    });
    await localAppliancesApi.addServiceHistory(householdId, appliance.id, {
      service_date: '2026-06-01',
      description: 'Newer',
    });

    const { history } = await localAppliancesApi.getServiceHistory(householdId, appliance.id);
    expect(history.map((row) => row.description)).toEqual(['Newer', 'Older']);

    await localAppliancesApi.delete(householdId, appliance.id);
    // Orphaned children would sync to every peer forever and never be read.
    expect(getLocalHouseLedger().applianceServiceHistory).toHaveLength(0);
  });

  it('cascades exactly the tables D1 cascades — checked against the schema, not the code', () => {
    // The regression this exists for, stated plainly: this delete was written
    // when `applianceServiceHistory` was the only live child. `appliance_documents`
    // cascades from `appliances` in D1 too and was registered on 2026-08-15 — and
    // had the list not been widened in the same edit, every document would have
    // outlived its appliance, on every peer, forever. That is precisely what B2
    // shipped against `CONTRACTOR_CASCADE_TABLES`, and nothing failed there
    // either: an orphan has no foreign key to complain to.
    //
    // So the list is asserted against the DRIZZLE SCHEMA rather than against a
    // hand-written expectation. The schema was always right; the code is the
    // thing that falls behind.
    const schemaDir = join(__dirname, '../../../../../backend/src/db');
    const sources = readdirSync(schemaDir)
      .filter((f) => f.startsWith('schema') && f.endsWith('.ts'))
      .map((f) => readFileSync(join(schemaDir, f), 'utf8'))
      .join('\n');

    // `sqliteTable('physical_name'` … up to the next `sqliteTable(`, so a
    // cascade is attributed to the table it is declared inside.
    const blocks = sources.split(/export const \w+ = sqliteTable\(\s*'/).slice(1);
    const cascading = new Set<string>();
    for (const block of blocks) {
      const physical = block.slice(0, block.indexOf("'"));
      if (/references\(\(\)\s*=>\s*appliances\.id,\s*\{\s*onDelete:\s*'cascade'/.test(block)) {
        cascading.add(physical);
      }
    }

    // Non-vacuity: if the parse breaks, `cascading` empties and the assertion
    // below passes for the wrong reason. Exactly three physical tables cascade
    // from `appliances`, and naming the third is the useful half of this check —
    // `ai_maintenance_predictions` is the AI Housekeeper's own forecast table,
    // outside House's domain schema files entirely, and it drops out of the live
    // filter by construction rather than by being remembered in the facade.
    expect([...cascading].sort()).toEqual([
      'ai_maintenance_predictions',
      'appliance_documents',
      'appliance_service_history',
    ]);

    const live = HOUSE_LEDGER_TABLE_NAMES.filter((t) =>
      cascading.has(HOUSE_LEDGER_PHYSICAL_TABLES[t]),
    );
    expect([...APPLIANCE_CASCADE_TABLES].sort()).toEqual([...live].sort());
  });

  it('actually empties both cascading tables, in ONE op', async () => {
    const appliance = await createFurnace();
    await localAppliancesApi.addServiceHistory(householdId, appliance.id, {
      service_date: '2026-03-14',
      description: 'Annual service',
    });
    await localAppliancesApi.addDocument(householdId, appliance.id, {
      type: 'receipt',
      r2_key: 'r1',
    });

    // A second appliance's rows must SURVIVE — a cascade that drops everything
    // passes an emptiness check just as well as a correct one does.
    const { appliance: other } = await localAppliancesApi.create(householdId, {
      name: 'Dishwasher',
      category: 'kitchen',
      type: 'Dishwasher',
    });
    await localAppliancesApi.addDocument(householdId, other.id, {
      type: 'manual',
      r2_key: 'r2',
    });

    const before = opCount();
    await localAppliancesApi.delete(householdId, appliance.id);
    // One op, not three. A peer that received the appliance delete without the
    // document delete would hold a warranty scan filed against an appliance it
    // no longer has — the orphan moved onto the network instead of into the code.
    expect(opCount() - before).toBe(1);

    const after = getLocalHouseLedger();
    expect(after.appliances.map((row) => row.id)).toEqual([other.id]);
    expect(after.applianceServiceHistory).toHaveLength(0);
    expect(after.applianceDocuments.map((row) => row.appliance_id)).toEqual([other.id]);
  });

  it('raises for history on an appliance that does not exist', async () => {
    await expect(
      localAppliancesApi.getServiceHistory(householdId, 'app_missing'),
    ).rejects.toThrow('Appliance not found');
    await expect(
      localAppliancesApi.addServiceHistory(householdId, 'app_missing', {
        service_date: '2026-01-01',
        description: 'x',
      }),
    ).rejects.toThrow('Appliance not found');
  });
});

const DESCRIPTOR = {
  blobId: 'blb_furnace_receipt',
  mime: 'application/pdf',
  bytes: 51_200,
  sha256: 'a'.repeat(64),
  chunkCount: 1,
  keyEpoch: 1,
};

describe('documents — the H6 metadata row', () => {
  it('round-trips a document and stores the DESCRIPTOR, not a device path', async () => {
    const appliance = await createFurnace();
    const before = opCount();

    const { document } = await localAppliancesApi.addDocument(householdId, appliance.id, {
      type: 'receipt',
      r2_key: 'ignored-when-a-descriptor-is-supplied',
      blob: DESCRIPTOR,
    });

    expect(opCount() - before).toBe(1);
    expect(document.appliance_id).toBe(appliance.id);
    expect(document.household_id).toBe(householdId);
    expect(document.type).toBe('receipt');
    // The whole point of the table. A descriptor is content-derived and
    // device-independent; a device path (Budget's `localWishMedia.ts` bug) or a
    // caller's R2 key (an object no peer's Worker ever wrote) would sync a row
    // describing a file that, from the other phone, does not exist.
    expect(document.blob).toEqual(DESCRIPTOR);
    expect(document.r2_key).toBe(`${HOUSE_BLOB_KEY_PREFIX}${DESCRIPTOR.blobId}`);
    // Declared by the DTO, never populated by either path — see `types.ts`.
    expect(document.url).toBeUndefined();

    const { documents } = await localAppliancesApi.getDocuments(householdId, appliance.id);
    expect(documents.map((row) => row.id)).toEqual([document.id]);
  });

  it('keeps the caller’s r2_key when there is no descriptor — the legacy path', async () => {
    // A household that is not local-first still has bytes on R2 and no blob at
    // all. Overwriting its key with a synthetic one would strand the file.
    const appliance = await createFurnace();
    const { document } = await localAppliancesApi.addDocument(householdId, appliance.id, {
      type: 'manual',
      r2_key: 'manuals/lennox-el296v.pdf',
    });
    expect(document.r2_key).toBe('manuals/lennox-el296v.pdf');
    expect(document.blob).toBeUndefined();
    expect(document.r2_key.startsWith(HOUSE_BLOB_KEY_PREFIX)).toBe(false);
  });

  it('lists newest first, scoped to ONE appliance', async () => {
    const furnace = await createFurnace();
    const { appliance: heatPump } = await localAppliancesApi.create(householdId, {
      name: 'Heat pump',
      category: 'hvac',
      type: 'Heat Pump',
    });

    const first = await localAppliancesApi.addDocument(householdId, furnace.id, {
      type: 'receipt',
      r2_key: 'r1',
    });
    const second = await localAppliancesApi.addDocument(householdId, furnace.id, {
      type: 'warranty',
      r2_key: 'r2',
    });
    await localAppliancesApi.addDocument(householdId, heatPump.id, {
      type: 'manual',
      r2_key: 'r3',
    });

    // `nowIso()` can return the same instant twice inside one test, so the
    // assertion is on the SET and on the scope rather than on a tie-break the
    // implementation does not promise.
    const { documents } = await localAppliancesApi.getDocuments(householdId, furnace.id);
    expect(documents.map((row) => row.id).sort()).toEqual(
      [first.document.id, second.document.id].sort(),
    );
    // The other appliance's manual must not appear here — `listDocuments` on the
    // Worker filters by `appliance_id` and so must this.
    expect(documents.every((row) => row.appliance_id === furnace.id)).toBe(true);
    expect(documents).toHaveLength(2);
  });

  it('raises for documents on an appliance that does not exist', async () => {
    // An empty list and a missing appliance must not look alike: `listDocuments`
    // starts with `getAppliance` on the Worker and 404s.
    await expect(localAppliancesApi.getDocuments(householdId, 'app_missing')).rejects.toThrow(
      'Appliance not found',
    );
    await expect(
      localAppliancesApi.addDocument(householdId, 'app_missing', {
        type: 'receipt',
        r2_key: 'r1',
      }),
    ).rejects.toThrow('Appliance not found');
  });

  it('refuses to answer for a property that is not the active one', async () => {
    await expect(localAppliancesApi.getDocuments('hh_local_elsewhere', 'app_1')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });

  it('no longer throws, and carries no dead unsupported copy', async () => {
    // The regression this file used to assert the OTHER way round. Both methods
    // threw `HouseLocalUnsupportedError` until 2026-08-15 and both had entries in
    // `HOUSE_UNSUPPORTED_COPY` telling the member that appliance manuals were
    // "not on this build yet". Dead copy is drift between the map and the code:
    // `unsupportedCopy.test.ts` fails on an entry whose method no longer throws,
    // and this is the same claim stated where a reader of the facade will see it.
    expect(HOUSE_UNSUPPORTED_COPY['appliancesApi.getDocuments']).toBeUndefined();
    expect(HOUSE_UNSUPPORTED_COPY['appliancesApi.addDocument']).toBeUndefined();

    const appliance = await createFurnace();
    await expect(
      localAppliancesApi.getDocuments(householdId, appliance.id),
    ).resolves.toEqual({ documents: [] });
  });

  it('mints its synthetic key in the SAME namespace every other attachment uses', () => {
    // One namespace for the whole app, so a reader who has met `lf-blob/` once
    // recognises it anywhere and never mistakes it for an R2 object path.
    //
    // This used to READ THE SOURCE of `@utils/taskPhotoSave` and regex out its
    // literal, because that module owned the only definition and importing it
    // here would pull the image picker and the legacy uploader into a ledger
    // suite. The definition now lives in the blobs barrel beside the descriptor
    // it is built from, so both names resolve to one constant and there is
    // nothing left to drift — the assertion is identity rather than a scrape.
    expect(HOUSE_BLOB_KEY_PREFIX).toBe(BLOB_KEY_PREFIX);
    expect(HOUSE_BLOB_KEY_PREFIX).toBe('lf-blob/');
  });

  it('has no deleteDocument, because the remote module has none', () => {
    // Parity, not a gap. `backend/src/routes/appliances.ts` exposes exactly two
    // document routes and `appliance-service.ts` has no delete method, so a local
    // `deleteDocument` would fail `apiParity.test.ts`'s `extraLocally` direction
    // — and a screen calling it would work on a local-first build and 404
    // everywhere else. A document leaves the ledger with its appliance.
    expect('deleteDocument' in localAppliancesApi).toBe(false);
  });
});

describe('documents — always-resident, and proved at runtime', () => {
  it('buckets a real document row to ALWAYS_RESIDENT, not to a month', async () => {
    // The third leg of the §11.1.4b guard, pointed the other way. `schema.ts`
    // DECLINES a window here and `waveBCSchemaParity` proves the tempting entry
    // (`uploaded_at`) names no D1 column at all; this asserts the consequence on
    // a row the facade actually wrote, so a future entry added to
    // `HOUSE_WINDOWED_DATE_FIELDS` fails here rather than silently doing nothing.
    const appliance = await createFurnace();
    const { document } = await localAppliancesApi.addDocument(householdId, appliance.id, {
      type: 'warranty',
      r2_key: 'w1',
      blob: DESCRIPTOR,
    });

    expect(HOUSE_WINDOWED_DATE_FIELDS.applianceDocuments).toBeUndefined();
    expect(rowBucket('applianceDocuments', document as unknown as Record<string, unknown>)).toBe(
      ALWAYS_RESIDENT_BUCKET,
    );
    // Non-vacuity: `rowBucket` is capable of returning a month, so the assertion
    // above is about THIS table rather than about a broken helper.
    expect(
      rowBucket('applianceServiceHistory', { service_date: '2026-03-14' }),
    ).toBe('2026-03');
  });

  it('the ROW TYPE is what a window would have to read — a tsc-checked seeder', () => {
    // The type half. This literal is checked by `tsc` against
    // `LocalApplianceDocument`, so the row's fields are not a guess: `uploaded_at`
    // is the only date it has, and any window someone adds must be readable off
    // an object of exactly this shape. C3 and C4 learned that a window can name a
    // real D1 column and still read `undefined` off the row.
    const seeded: LocalApplianceDocument = {
      id: 'adc_seed',
      household_id: householdId,
      appliance_id: 'app_seed',
      type: 'manual',
      r2_key: `${HOUSE_BLOB_KEY_PREFIX}${DESCRIPTOR.blobId}`,
      uploaded_at: '2026-03-14T10:00:00.000Z',
      blob: DESCRIPTOR,
    };
    const asRow = seeded as unknown as Record<string, unknown>;
    expect(asRow.created_at).toBeUndefined();
    expect(asRow.upload_date).toBeUndefined();
    expect(rowBucket('applianceDocuments', asRow)).toBe(ALWAYS_RESIDENT_BUCKET);
  });
});
