/**
 * `localMaintenanceSuggestionsApi` — H13 D-wave.
 *
 * Three of these tests exist for hazards that only appear once generation moves
 * on-device, and that no schema-derived guard can reach:
 *
 *  - **concurrent generation.** D1 declares NO uniqueIndex on
 *    `(household_id, home_feature_id, template_id)`; the service enforces it
 *    with a read-then-write that the Worker request serialises. Nothing
 *    serialises two offline devices, so the id has to carry the constraint.
 *  - **regeneration must not resurrect a dismissal.** The most likely way to
 *    get dedup wrong is a blind upsert, which looks correct until a member
 *    dismisses something and it comes back.
 *  - **the Tier C join must degrade, not fail.** The template catalogue is not
 *    ledgered, so a first launch offline has none — and the card still has to
 *    render from the fields copied onto the row at generation time.
 *
 * Static imports only — `await import()` throws under this Jest config (§6.2).
 */
import { openLocalHouseSession, resetLocalHouseSession, getLocalHouseLedger } from '../engine';
import { houseDeterministicIds } from '../ids';
import { localMaintenanceSuggestionsApi } from '../localMaintenanceSuggestionsApi';
import type { LocalHomeFeature, LocalMaintenanceSuggestion } from '../types';

const USER = 'user-msg-1';

/**
 * The catalogue is reached through a narrow `require('@api/templates')` inside
 * the module, so it is mocked at the module boundary rather than injected.
 */
const mockList = jest.fn();
jest.mock('@api/templates', () => ({
  templatesApi: {
    list: (...args: unknown[]) => mockList(...args),
  },
}));

/** MMKV is not available under Jest; the cache degrades to "nothing stored". */
jest.mock('@services/storage', () => ({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
}));

const template = (id: string, featureType: string, subtype: string | null = null) => ({
  id,
  title: `Service ${id}`,
  description: `Do ${id}`,
  feature_type: featureType,
  feature_subtype: subtype,
  frequency: 'yearly',
  is_active: true,
});

async function freshSession() {
  await resetLocalHouseSession();
  return openLocalHouseSession({ userId: USER, displayName: 'Suggestion home' });
}

function seedFeature(householdId: string, id: string, type: string, subtype: string | null = null) {
  const ledger = getLocalHouseLedger();
  ledger.homeFeatures.push({
    id,
    household_id: householdId,
    feature_type: type,
    feature_subtype: subtype,
    location: 'Basement',
  } as unknown as LocalHomeFeature);
}

function suggestions(): LocalMaintenanceSuggestion[] {
  return getLocalHouseLedger().maintenanceSuggestions;
}

beforeEach(() => {
  mockList.mockReset();
  mockList.mockResolvedValue({ templates: [template('t1', 'hvac'), template('t2', 'hvac')] });
});

describe('generation is idempotent across devices, not just across calls', () => {
  it('derives the row id from (household, feature, template) rather than at random', async () => {
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');

    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    // The assertion that matters: the id is a pure function of the triple, so a
    // second device computing the same suggestion computes the same id and LWW
    // merges the two rows instead of keeping both.
    const expected = houseDeterministicIds.maintenanceSuggestion(household.id, 'feat-1', 't1');
    expect(suggestions().map((r) => r.id)).toContain(expected);
  });

  it('generates nothing new on a second run', async () => {
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');

    const first = await localMaintenanceSuggestionsApi.generateSuggestions(household.id);
    const second = await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    expect(first.generated).toBe(2);
    expect(second.generated).toBe(0);
    expect(suggestions()).toHaveLength(2);
  });

  it('does NOT resurrect a dismissed suggestion when regenerating', async () => {
    // The failure a blind upsert produces, and the reason dedup skips existing
    // rows entirely rather than writing over them.
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');
    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    const target = suggestions()[0].id;
    await localMaintenanceSuggestionsApi.dismissSuggestion(household.id, target, {
      reason: 'not applicable',
    } as never);
    expect(suggestions().find((r) => r.id === target)?.status).toBe('dismissed');

    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    expect(suggestions().find((r) => r.id === target)?.status).toBe('dismissed');
    expect(suggestions().find((r) => r.id === target)?.dismissed_reason).toBe('not applicable');
  });
});

describe('the Tier C template join degrades instead of failing', () => {
  it('still returns a renderable suggestion when the catalogue cannot be fetched', async () => {
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');
    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    // First launch offline: nothing cached, and the network is gone.
    mockList.mockRejectedValue(new Error('offline'));

    const rows = await localMaintenanceSuggestionsApi.getSuggestions(household.id);

    expect(rows).toHaveLength(2);
    // `template` is empty — but the card's own copy of the text is intact,
    // which is exactly why those fields are copied at generation time.
    expect(rows[0].template).toEqual({});
    expect(rows[0].title).toBe('Service t1');
    expect(rows[0].frequency).toBe('yearly');
  });

  it('never throws for want of a network', async () => {
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');
    mockList.mockRejectedValue(new Error('offline'));

    await expect(
      localMaintenanceSuggestionsApi.getSuggestions(household.id),
    ).resolves.toEqual([]);
  });
});

describe('the DTO / D1 column rename is reversed at the boundary', () => {
  it('stores `home_feature_id` but hands screens `feature_id`', async () => {
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');
    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    // The ledger follows D1, because the ledger table IS the D1 table…
    expect(suggestions()[0].home_feature_id).toBe('feat-1');
    expect((suggestions()[0] as unknown as Record<string, unknown>).feature_id).toBeUndefined();

    // …and the facade hands back the DTO's name, so no screen changed.
    const [row] = await localMaintenanceSuggestionsApi.getSuggestions(household.id);
    expect(row.feature_id).toBe('feat-1');
  });
});

describe('template matching follows the server rule', () => {
  it('takes null-subtype templates for a feature with no subtype, and not typed ones', async () => {
    // A template with no subtype applies to every subtype of its type; a
    // feature with no subtype takes ONLY those. Collapsing the two would
    // suggest gas-furnace work for a heat pump.
    mockList.mockResolvedValue({
      templates: [template('generic', 'hvac', null), template('gas', 'hvac', 'gas_furnace')],
    });
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac', null);

    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    expect(suggestions().map((r) => r.template_id)).toEqual(['generic']);
  });

  it('takes both the generic and the matching subtype for a subtyped feature', async () => {
    mockList.mockResolvedValue({
      templates: [
        template('generic', 'hvac', null),
        template('gas', 'hvac', 'gas_furnace'),
        template('heatpump', 'hvac', 'heat_pump'),
      ],
    });
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac', 'gas_furnace');

    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    expect(suggestions().map((r) => r.template_id).sort()).toEqual(['gas', 'generic']);
  });

  it('ignores a template for a different feature type', async () => {
    mockList.mockResolvedValue({
      templates: [template('roof', 'roof'), template('hvac', 'hvac')],
    });
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');

    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    expect(suggestions().map((r) => r.template_id)).toEqual(['hvac']);
  });
});

describe('applying a suggestion materialises a task, in one op', () => {
  it('accepts the suggestion and creates the task in a SINGLE op', async () => {
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');
    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    const before = getLocalHouseLedger().ops.length;
    const ids = suggestions().map((r) => r.id);

    const result = await localMaintenanceSuggestionsApi.applySuggestions(household.id, {
      suggestion_ids: ids,
    } as never);

    expect(result.applied).toBe(2);
    expect(result.task_ids).toHaveLength(2);
    // Two suggestions and two tasks across two tables — but ONE op. A loop of
    // single writes would diff the whole ledger per row.
    expect(getLocalHouseLedger().ops.length).toBe(before + 1);
    expect(suggestions().every((r) => r.status === 'accepted')).toBe(true);
    expect(suggestions()[0].applied_task_id).toBe(result.task_ids[0]);
  });

  it('ignores an already-accepted suggestion rather than double-creating a task', async () => {
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');
    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);
    const ids = suggestions().map((r) => r.id);

    await localMaintenanceSuggestionsApi.applySuggestions(household.id, {
      suggestion_ids: ids,
    } as never);
    const again = await localMaintenanceSuggestionsApi.applySuggestions(household.id, {
      suggestion_ids: ids,
    } as never);

    expect(again.applied).toBe(0);
    expect(getLocalHouseLedger().tasks).toHaveLength(2);
  });
});

describe('snooze and pending filtering', () => {
  it('drops a snoozed suggestion out of the pending list', async () => {
    const { household } = await freshSession();
    seedFeature(household.id, 'feat-1', 'hvac');
    await localMaintenanceSuggestionsApi.generateSuggestions(household.id);

    await localMaintenanceSuggestionsApi.snoozeSuggestion(household.id, suggestions()[0].id, {
      snooze_until: '2027-01-01',
    } as never);

    const pending = await localMaintenanceSuggestionsApi.getPendingSuggestions(household.id);
    expect(pending).toHaveLength(1);
    expect(suggestions()[0].snooze_until).toBe('2027-01-01');
  });
});
