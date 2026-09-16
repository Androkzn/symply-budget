/**
 * `localHomeFeaturesApi` against a real in-memory session (plan §6 DoD, Wave A).
 *
 * Home features are what the maintenance engine reasons over, so the assertions
 * that matter are the ones about *shape*: the Worker's coalesced defaults
 * (`quantity || 1`, `condition || 'unknown'`, `source || 'manual'`) and the
 * partial-update semantics. A feature created offline that differs from one
 * created online produces different maintenance advice for the same house.
 */
import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnknownPropertyError } from '../errors';
import { localHomeFeaturesApi } from '../localHomeFeaturesApi';

const USER = 'user-features-1';

let householdId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Features test home' });
  householdId = ledger.household.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('createFeature', () => {
  it('applies the Worker’s defaults to a bare request', async () => {
    const feature = await localHomeFeaturesApi.createFeature(householdId, {
      feature_type: 'water_heater',
    });

    expect(feature.household_id).toBe(householdId);
    expect(feature.quantity).toBe(1);
    expect(feature.condition).toBe('unknown');
    expect(feature.source).toBe('manual');
    expect(feature.source_report_id).toBeNull();
    expect(feature.extraction_confidence).toBeNull();
    expect(feature.created_at).toBe(feature.updated_at);
  });

  it('keeps every field the edit form can send', async () => {
    const feature = await localHomeFeaturesApi.createFeature(householdId, {
      feature_type: 'furnace',
      feature_subtype: 'gas',
      quantity: 2,
      location: 'Basement',
      brand: 'Lennox',
      model: 'EL296V',
      serial_number: 'SN-1',
      install_date: '2019-03-01',
      warranty_expires: '2029-03-01',
      age_years: 7,
      condition: 'good',
      notes: 'Serviced yearly',
    });

    expect(feature).toMatchObject({
      feature_subtype: 'gas',
      quantity: 2,
      serial_number: 'SN-1',
      warranty_expires: '2029-03-01',
      age_years: 7,
      condition: 'good',
    });
  });

  it('writes one op per feature', async () => {
    const before = opCount();
    await localHomeFeaturesApi.createFeature(householdId, { feature_type: 'sump_pump' });
    expect(opCount() - before).toBe(1);
  });
});

describe('reads', () => {
  it('round-trips create → read → update → delete', async () => {
    const created = await localHomeFeaturesApi.createFeature(householdId, {
      feature_type: 'pool',
      notes: 'Salt water',
    });

    const fetched = await localHomeFeaturesApi.getFeature(householdId, created.id);
    expect(fetched.id).toBe(created.id);

    const updated = await localHomeFeaturesApi.updateFeature(householdId, created.id, {
      condition: 'fair',
    });
    expect(updated.condition).toBe('fair');
    // An absent key means "leave it alone" — a spread of the request would have
    // nulled the note the member typed at create time.
    expect(updated.notes).toBe('Salt water');

    await localHomeFeaturesApi.deleteFeature(householdId, created.id);
    expect(await localHomeFeaturesApi.getFeatures(householdId)).toHaveLength(0);
  });

  it('orders by feature type, then newest first', async () => {
    await localHomeFeaturesApi.createFeature(householdId, { feature_type: 'well' });
    await localHomeFeaturesApi.createFeature(householdId, { feature_type: 'generator' });
    await localHomeFeaturesApi.createFeature(householdId, { feature_type: 'hvac' });

    const features = await localHomeFeaturesApi.getFeatures(householdId);
    expect(features.map((feature) => feature.feature_type)).toEqual([
      'generator',
      'hvac',
      'well',
    ]);
  });

  it('filters by type', async () => {
    await localHomeFeaturesApi.createFeature(householdId, { feature_type: 'fireplace' });
    await localHomeFeaturesApi.createFeature(householdId, { feature_type: 'fireplace' });
    await localHomeFeaturesApi.createFeature(householdId, { feature_type: 'septic' });

    const fireplaces = await localHomeFeaturesApi.getFeaturesByType(householdId, 'fireplace');
    expect(fireplaces).toHaveLength(2);
    expect(fireplaces.every((feature) => feature.feature_type === 'fireplace')).toBe(true);
  });

  it('raises rather than returning nothing for a missing feature', async () => {
    await expect(localHomeFeaturesApi.getFeature(householdId, 'hf_missing')).rejects.toThrow(
      'Failed to get home feature',
    );
    await expect(
      localHomeFeaturesApi.updateFeature(householdId, 'hf_missing', { condition: 'poor' }),
    ).rejects.toThrow('Failed to update home feature');
    await expect(localHomeFeaturesApi.deleteFeature(householdId, 'hf_missing')).rejects.toThrow(
      'Failed to delete home feature',
    );
  });

  it('refuses to answer for a property that is not the active one', async () => {
    await expect(localHomeFeaturesApi.getFeatures('hh_local_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
    await expect(
      localHomeFeaturesApi.createFeature('hh_local_someone_else', { feature_type: 'well' }),
    ).rejects.toThrow(HouseLocalUnknownPropertyError);
  });
});
