/**
 * The guard that makes "1,645 synced" mean everything.
 *
 * The first test is the one that matters and it is not about arithmetic: it
 * asserts the category map covers the ledger registry EXACTLY. A total derived
 * from a hand-written map is trustworthy only for as long as the map is
 * complete, and the failure mode is silent — table 76 lands, nobody categorises
 * it, and the screen goes on confidently reporting a number that is short by
 * however much the member put in it. This turns that into a red build.
 */
import { emptyHouseTables, type HouseLedger } from '../engine';
import {
  HOUSE_LEDGER_TABLE_NAMES,
  HOUSE_SYNC_CATEGORIES,
  categorisedTableNames,
  describeHouseSyncInventory,
} from '../syncInventory';

/** A ledger with every table present and empty, plus whatever a test seeds. */
function ledgerWith(seed: Partial<Record<string, unknown[]>> = {}): HouseLedger {
  return {
    version: 1,
    household: { id: 'hh_1' },
    memberId: 'm_1',
    deviceId: 'd_1',
    ...emptyHouseTables(),
    ...seed,
  } as unknown as HouseLedger;
}

describe('the category map and the ledger registry', () => {
  it('covers every ledgered table, with no strays', () => {
    const categorised = [...categorisedTableNames()].sort();
    const registered = [...HOUSE_LEDGER_TABLE_NAMES].sort();
    // Two assertions rather than one, because the two failures need different
    // fixes: a missing table means the total understates the home, a stray one
    // means the map names something that no longer exists.
    expect(categorised.filter(t => !registered.includes(t))).toEqual([]);
    expect(registered.filter(t => !categorised.includes(t))).toEqual([]);
    expect(categorised).toEqual(registered);
  });

  it('names each table exactly once', () => {
    const seen = categorisedTableNames();
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('gives every category a distinct key and a label', () => {
    const keys = HOUSE_SYNC_CATEGORIES.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const category of HOUSE_SYNC_CATEGORIES) {
      expect(category.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('what the screen shows', () => {
  it('is zero everywhere on a device that holds nothing', () => {
    const inventory = describeHouseSyncInventory(ledgerWith());
    expect(inventory.total).toBe(0);
    // Empty categories are kept: "Appliances 0" is the answer for a member
    // checking whether their appliances arrived.
    expect(inventory.categories).toHaveLength(HOUSE_SYNC_CATEGORIES.length);
  });

  it('totals the rows a device actually holds', () => {
    const inventory = describeHouseSyncInventory(
      ledgerWith({
        tasks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
        appliances: [{ id: 'a1' }],
        applianceServiceHistory: [{ id: 'h1' }, { id: 'h2' }],
        homeProjectSelections: [{ id: 's1' }],
      }),
    );

    expect(inventory.total).toBe(7);
    const byKey = new Map(inventory.categories.map(c => [c.key, c]));
    expect(byKey.get('tasks')!.count).toBe(3);
    // Two tables, one category — the grouping is the whole point.
    expect(byKey.get('appliances')!.count).toBe(3);
    expect(byKey.get('homeProjects')!.count).toBe(1);
    expect(byKey.get('contractors')!.count).toBe(0);
  });

  it('breaks a category down to the tables it came from', () => {
    const inventory = describeHouseSyncInventory(
      ledgerWith({ appliances: [{ id: 'a1' }], applianceDocuments: [{ id: 'd1' }] }),
    );
    const appliances = inventory.categories.find(c => c.key === 'appliances')!;
    expect(
      appliances.tables.find(t => t.table === 'appliances')!.count,
    ).toBe(1);
    expect(
      appliances.tables.find(t => t.table === 'applianceServiceHistory')!.count,
    ).toBe(0);
  });

  it('survives a ledger written before a table existed', () => {
    // A device that has not hydrated a newer table has no array there at all.
    // Counting must degrade to 0 rather than throw and take the screen down.
    const ledger = ledgerWith();
    delete (ledger as unknown as Record<string, unknown>).homeProjectGeometry;
    expect(() => describeHouseSyncInventory(ledger)).not.toThrow();
    expect(describeHouseSyncInventory(ledger).total).toBe(0);
  });

  it('the total is the sum of the categories, always', () => {
    const inventory = describeHouseSyncInventory(
      ledgerWith({ tasks: [{ id: 't' }], auditLog: [{ id: 'l' }] }),
    );
    expect(inventory.total).toBe(
      inventory.categories.reduce((sum, c) => sum + c.count, 0),
    );
  });
});
