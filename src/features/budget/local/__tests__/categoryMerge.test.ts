/**
 * Same-name categories collapsing onto one row.
 *
 * The production shape (2026-09): a household minted on a build that numbered
 * its seeds by position (`cat_default_25`, Ionicons `paw`) met a device on the
 * build that derives ids from names (`cat_default_pets`, brand `leaf`). Sync
 * merges by id, so the picker showed "Pets" twice. These pin the survivor
 * rule, the reference moves, the idempotence that lets the pass run after every
 * change, the bootstrap deferral, and — through the real op-log path — that two
 * members merging independently converge without a recorded conflict.
 */
import '../cryptoPolyfill';

import type { BudgetCategory, Expense, SubBudget } from '@api/budget';
import {
  MemoryLocalFirstStore,
  OpLog,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  randomBytes,
  utf8Decode,
  utf8Encode,
  type Clock,
  type DeviceIdentity,
  type HouseholdKeys,
  type StoredOperation,
} from '@symply/local-first';

import { applyCategoryMerge, pickCategoryWinner, planCategoryMerge } from '../categoryDedupe';
import {
  clearHouseholdBootstrapPending,
  closeLocalBudgetSession,
  getLocalLedger,
  mutateLocalLedger,
  openLocalBudgetSessionForTests,
  requestHouseholdBackfill,
  type LocalBudgetLedger,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';
import {
  applyLedgerDelta,
  captureLedgerSnapshot,
  decodeLedgerOpPayload,
  diffLedger,
  encodeLedgerOpPayload,
} from '../projection';

import { emptyLedger } from './ledgerTestKit';

const LEGACY_PETS_ID = 'cat_default_25';
const CANONICAL_PETS_ID = 'cat_default_pets';

function category(householdId: string, overrides: Partial<BudgetCategory> & { id: string; name: string }): BudgetCategory {
  return {
    household_id: householdId,
    icon: null,
    color: null,
    sort_order: 90,
    created_at: '2026-06-01T00:00:00.000Z',
    usage_count: 0,
    is_default: false,
    hidden: false,
    ...overrides,
  };
}

/** The row the old build seeded: positional id, Ionicons glyph. */
function legacyPets(householdId: string, overrides: Partial<BudgetCategory> = {}): BudgetCategory {
  return category(householdId, {
    id: LEGACY_PETS_ID,
    name: 'Pets',
    icon: 'paw',
    color: '#8D6E63',
    sort_order: 24,
    usage_count: 3,
    is_default: true,
    ...overrides,
  });
}

function spending(householdId: string, id: string, categoryId: string | null): Expense {
  return {
    id,
    household_id: householdId,
    budget_item_id: null,
    category_id: categoryId,
    title: 'Kibble',
    description: null,
    amount: 2599,
    saved_amount: 0,
    expense_date: '2026-09-01',
    vendor: null,
    receipt_key: null,
    created_by: null,
    created_at: '2026-09-01T00:00:00.000Z',
  };
}

function cap(
  householdId: string,
  id: string,
  categoryId: string,
  month: number | null,
  createdAt = '2026-06-01T00:00:00.000Z',
): SubBudget {
  return {
    id,
    household_id: householdId,
    category_id: categoryId,
    year: 2026,
    month,
    limit_type: 'amount',
    amount_cents: 10_000,
    percent_bps: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

describe('planCategoryMerge / pickCategoryWinner', () => {
  const hh = 'hh_plan';

  it('prefers the name-derived default id whatever its age', () => {
    const canonical = category(hh, { id: CANONICAL_PETS_ID, name: 'Pets', created_at: '2026-09-10T00:00:00.000Z' });
    const legacy = legacyPets(hh);
    expect(pickCategoryWinner([legacy, canonical]).id).toBe(CANONICAL_PETS_ID);
    expect(pickCategoryWinner([canonical, legacy]).id).toBe(CANONICAL_PETS_ID);
  });

  it('falls back to the oldest row, then the smaller id — the same on every device', () => {
    const older = category(hh, { id: 'cat_zzz', name: 'Vet', created_at: '2026-02-01T00:00:00.000Z' });
    const newer = category(hh, { id: 'cat_aaa', name: 'Vet', created_at: '2026-03-01T00:00:00.000Z' });
    expect(pickCategoryWinner([newer, older]).id).toBe('cat_zzz');

    const twinA = category(hh, { id: 'cat_b', name: 'Vet' });
    const twinB = category(hh, { id: 'cat_a', name: 'Vet' });
    expect(pickCategoryWinner([twinA, twinB]).id).toBe('cat_a');
    expect(pickCategoryWinner([twinB, twinA]).id).toBe('cat_a');
  });

  it('matches names case- and whitespace-insensitively, within one household only', () => {
    const rows = [
      category(hh, { id: CANONICAL_PETS_ID, name: 'Pets' }),
      category(hh, { id: 'cat_custom', name: '  pets ' }),
      category('hh_other', { id: 'cat_elsewhere', name: 'Pets' }),
    ];
    const plan = planCategoryMerge(rows, hh);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.winner.id).toBe(CANONICAL_PETS_ID);
    expect([...plan.remap]).toEqual([['cat_custom', CANONICAL_PETS_ID]]);
  });

  it('keeps re-pointing ids a survivor absorbed earlier, and chases a survivor that loses later', () => {
    // 'cat_vet_b' absorbed 'cat_vet_x' in an earlier merge; now it meets a
    // canonical row of the same name and loses to it.
    const rows = [
      category(hh, { id: 'cat_vet_b', name: 'Vet', merged_from: ['cat_vet_x'] }),
      category(hh, { id: 'cat_vet_a', name: 'Vet', created_at: '2026-01-01T00:00:00.000Z' }),
      category(hh, { id: CANONICAL_PETS_ID, name: 'Pets', merged_from: [LEGACY_PETS_ID] }),
    ];
    const plan = planCategoryMerge(rows, hh);
    expect(plan.remap.get('cat_vet_b')).toBe('cat_vet_a');
    expect(plan.remap.get('cat_vet_x')).toBe('cat_vet_a');
    // No duplicate Pets this time — the absorbed id still maps home.
    expect(plan.remap.get(LEGACY_PETS_ID)).toBe(CANONICAL_PETS_ID);
  });
});

describe('localBudgetApi.mergeDuplicateCategories', () => {
  let householdId: string;

  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-merge-1' });
    householdId = getLocalLedger().household.id;
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  /** Rows arriving the way a peer's op would: straight into the tables. */
  async function inject(mutator: (ledger: LocalBudgetLedger) => void): Promise<void> {
    await mutateLocalLedger(mutator, {
      opType: 'TEST_INJECT',
      entityType: 'category',
      entityId: 'test',
      payload: {},
    });
  }

  function named(name: string): BudgetCategory[] {
    return getLocalLedger().categories.filter((c) => c.name.trim().toLowerCase() === name.toLowerCase());
  }

  it('leaves a household with unique names untouched and authors no op', async () => {
    const opsBefore = getLocalLedger().ops.length;
    const before = getLocalLedger().categories.map((c) => c.id);

    const outcome = await localBudgetApi.mergeDuplicateCategories(householdId);

    expect(outcome).toEqual({ merged: [], repointed: 0, droppedSubBudgets: 0 });
    expect(getLocalLedger().ops).toHaveLength(opsBefore);
    expect(getLocalLedger().categories.map((c) => c.id)).toEqual(before);
  });

  it('collapses the legacy positional-id seed onto the name-derived row, in one op', async () => {
    await inject((ledger) => {
      ledger.categories.push(legacyPets(householdId));
      ledger.expenses.push(spending(householdId, 'exp-legacy', LEGACY_PETS_ID));
      ledger.expenses.push(spending(householdId, 'exp-canonical', CANONICAL_PETS_ID));
    });
    expect(named('Pets')).toHaveLength(2);
    const opsBefore = getLocalLedger().ops.length;

    const outcome = await localBudgetApi.mergeDuplicateCategories(householdId);

    expect(outcome.merged).toEqual([
      { name: 'Pets', keptId: CANONICAL_PETS_ID, droppedIds: [LEGACY_PETS_ID] },
    ]);
    expect(outcome.repointed).toBe(1);
    expect(getLocalLedger().ops).toHaveLength(opsBefore + 1);

    const [pets] = named('Pets');
    expect(named('Pets')).toHaveLength(1);
    expect(pets).toMatchObject({
      id: CANONICAL_PETS_ID,
      // The survivor keeps its own glyph — one icon vocabulary.
      icon: 'leaf',
      is_default: true,
      hidden: false,
      usage_count: 3,
      sort_order: 24,
      merged_from: [LEGACY_PETS_ID],
    });
    const byId = new Map(getLocalLedger().expenses.map((e) => [e.id, e.category_id]));
    expect(byId.get('exp-legacy')).toBe(CANONICAL_PETS_ID);
    expect(byId.get('exp-canonical')).toBe(CANONICAL_PETS_ID);
  });

  it('keeps the category visible when either duplicate was, hidden only when both were', async () => {
    await inject((ledger) => {
      ledger.categories.push(legacyPets(householdId, { hidden: true }));
      ledger.categories.push(category(householdId, { id: 'cat_fuel_old', name: 'Fuel', hidden: true }));
      const fuel = ledger.categories.find((c) => c.id === 'cat_default_fuel')!;
      fuel.hidden = true;
    });

    await localBudgetApi.mergeDuplicateCategories(householdId);

    expect(named('Pets')[0]!.hidden).toBe(false);
    expect(named('Fuel')).toHaveLength(1);
    expect(named('Fuel')[0]!.hidden).toBe(true);
  });

  it('gives the survivor a glyph and colour when only the duplicate had them', async () => {
    await inject((ledger) => {
      ledger.categories.push(
        category(householdId, { id: 'cat_vet_a', name: 'Vet', created_at: '2026-01-01T00:00:00.000Z' }),
        category(householdId, { id: 'cat_vet_b', name: 'Vet', icon: 'health', color: '#123456' }),
      );
    });

    await localBudgetApi.mergeDuplicateCategories(householdId);

    expect(named('Vet')).toHaveLength(1);
    expect(named('Vet')[0]).toMatchObject({ id: 'cat_vet_a', icon: 'health', color: '#123456' });
  });

  it('moves the duplicate\'s sub-budget onto the survivor and drops one that would collide', async () => {
    await inject((ledger) => {
      ledger.categories.push(legacyPets(householdId));
      ledger.subBudgets.push(
        cap(householdId, 'sb-legacy-year', LEGACY_PETS_ID, null),
        cap(householdId, 'sb-legacy-sep', LEGACY_PETS_ID, 9),
        cap(householdId, 'sb-canonical-sep', CANONICAL_PETS_ID, 9, '2026-08-01T00:00:00.000Z'),
      );
    });

    const outcome = await localBudgetApi.mergeDuplicateCategories(householdId);

    expect(outcome.droppedSubBudgets).toBe(1);
    const caps = getLocalLedger().subBudgets.filter((s) => s.category_id === CANONICAL_PETS_ID);
    expect(caps.map((s) => s.id).sort()).toEqual(['sb-canonical-sep', 'sb-legacy-year']);
    expect(getLocalLedger().subBudgets.some((s) => s.category_id === LEGACY_PETS_ID)).toBe(false);
  });

  it('is idempotent — the pass after a merge authors nothing', async () => {
    await inject((ledger) => {
      ledger.categories.push(legacyPets(householdId));
    });
    await localBudgetApi.mergeDuplicateCategories(householdId);
    const opsAfterMerge = getLocalLedger().ops.length;

    const again = await localBudgetApi.mergeDuplicateCategories(householdId);

    expect(again).toEqual({ merged: [], repointed: 0, droppedSubBudgets: 0 });
    expect(getLocalLedger().ops).toHaveLength(opsAfterMerge);
  });

  /**
   * The peer that had not merged yet keeps filing spendings under the dropped
   * id until its own build catches up. The survivor remembers the id, so those
   * rows land in the right place on the next pass instead of dangling.
   */
  it('re-points a spending that arrives under an absorbed id after the merge', async () => {
    await inject((ledger) => {
      ledger.categories.push(legacyPets(householdId));
    });
    await localBudgetApi.mergeDuplicateCategories(householdId);
    await inject((ledger) => {
      ledger.expenses.push(spending(householdId, 'exp-late', LEGACY_PETS_ID));
    });
    const opsBefore = getLocalLedger().ops.length;

    const outcome = await localBudgetApi.mergeDuplicateCategories(householdId);

    expect(outcome).toEqual({ merged: [], repointed: 1, droppedSubBudgets: 0 });
    expect(getLocalLedger().ops).toHaveLength(opsBefore + 1);
    expect(getLocalLedger().expenses.find((e) => e.id === 'exp-late')!.category_id).toBe(
      CANONICAL_PETS_ID,
    );
  });

  it('defers while the household bootstrap is pending, then merges once it lands', async () => {
    await inject((ledger) => {
      ledger.categories.push(legacyPets(householdId));
    });
    await requestHouseholdBackfill(householdId);
    const opsBefore = getLocalLedger().ops.length;

    const deferred = await localBudgetApi.mergeDuplicateCategories(householdId);

    expect(deferred).toMatchObject({ merged: [], deferred: true });
    expect(named('Pets')).toHaveLength(2);
    expect(getLocalLedger().ops).toHaveLength(opsBefore);

    await clearHouseholdBootstrapPending(householdId);
    await localBudgetApi.mergeDuplicateCategories(householdId);
    expect(named('Pets')).toHaveLength(1);
  });

  it('does not seed a second row for a name the merge just settled', async () => {
    await inject((ledger) => {
      ledger.categories.push(legacyPets(householdId));
    });
    await localBudgetApi.mergeDuplicateCategories(householdId);

    const { added } = await localBudgetApi.backfillDefaultCategories(householdId);

    expect(added).toEqual([]);
    expect(named('Pets')).toHaveLength(1);
  });
});

/**
 * Two members, the real op-log path (seal, sign, HLC, LWW), transport
 * shortcut — the same harness `multiMemberSync.test.ts` uses.
 */
class ManualClock implements Clock {
  constructor(private ms: number) {}
  nowMs(): number {
    return this.ms;
  }
}

type Member = {
  memberId: string;
  identity: DeviceIdentity;
  opLog: OpLog;
  ledger: LocalBudgetLedger;
  outbox: StoredOperation[];
};

async function createMember(
  memberId: string,
  deviceId: string,
  householdKeys: HouseholdKeys,
  startMs: number,
): Promise<Member> {
  const store = new MemoryLocalFirstStore();
  await store.open(randomBytes(32));
  const identity = generateDeviceIdentity(deviceId);
  const ledger = emptyLedger(householdKeys.householdId, memberId, deviceId);
  const opLog = new OpLog({
    store,
    identity,
    householdKeys,
    clock: new ManualClock(startMs),
    projection: {
      async apply(args) {
        const delta = decodeLedgerOpPayload(JSON.parse(utf8Decode(args.plaintextPayload)));
        if (!delta) return;
        applyLedgerDelta(ledger, delta, {
          hlc: args.hlc,
          authorMemberId: args.authorMemberId,
          opId: args.opId,
        });
      },
    },
  });
  return { memberId, identity, opLog, ledger, outbox: [] };
}

/** Mirrors `mutateLocalLedger`: mutate, diff, seal the delta. */
async function commit(
  member: Member,
  mutator: (ledger: LocalBudgetLedger) => void,
  op: { opType: string; entityType: string; entityId: string },
): Promise<void> {
  const before = captureLedgerSnapshot(member.ledger);
  mutator(member.ledger);
  const delta = diffLedger(before, member.ledger);
  const stored = await member.opLog.append({
    opId: createOpId(),
    authorMemberId: member.memberId,
    parents: [],
    opType: op.opType,
    entityType: op.entityType,
    entityId: op.entityId,
    plaintextPayload: utf8Encode(JSON.stringify(encodeLedgerOpPayload({}, delta))),
  });
  member.outbox.push(stored);
}

async function deliver(from: Member, to: Member): Promise<void> {
  for (const op of from.outbox) {
    await to.opLog.applyRemote(op, from.identity.signingPublicKey);
  }
}

describe('two members merging the same duplicate independently', () => {
  it('converge on one row, one set of references, and record no conflict', async () => {
    const householdKeys = generateHouseholdKeys('hh_merge_shared', 1);
    const householdId = householdKeys.householdId;
    const alice = await createMember('member-alice', 'dev-alice', householdKeys, 1_800_000_000_000);
    const bob = await createMember('member-bob', 'dev-bob', householdKeys, 1_800_000_001_000);
    // Shared pre-history on both replicas: the legacy seed and a spending under it.
    for (const member of [alice, bob]) {
      member.ledger.categories.push(legacyPets(householdId));
      member.ledger.expenses.push(spending(householdId, 'exp-shared', LEGACY_PETS_ID));
    }

    const merge = (member: Member) =>
      commit(
        member,
        (ledger) => {
          applyCategoryMerge(ledger, planCategoryMerge(ledger.categories, householdId), householdId);
        },
        { opType: 'CATEGORY_MERGE', entityType: 'category', entityId: CANONICAL_PETS_ID },
      );
    await merge(alice);
    await merge(bob);
    await deliver(alice, bob);
    await deliver(bob, alice);

    for (const member of [alice, bob]) {
      const pets = member.ledger.categories.filter((c) => c.name === 'Pets');
      expect(pets).toHaveLength(1);
      expect(pets[0]).toMatchObject({
        id: CANONICAL_PETS_ID,
        usage_count: 3,
        merged_from: [LEGACY_PETS_ID],
      });
      expect(member.ledger.expenses[0]!.category_id).toBe(CANONICAL_PETS_ID);
      // Equal values from two authors are agreement, not a discarded intent.
      expect(member.ledger.conflicts ?? []).toEqual([]);
    }
    // Each replica seeded its own defaults a millisecond apart; everything the
    // merge touched must be byte-identical on both.
    const shape = (ledger: LocalBudgetLedger) =>
      [...ledger.categories]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(({ created_at: _createdAt, ...rest }) => rest);
    expect(shape(alice.ledger)).toEqual(shape(bob.ledger));
  });
});
