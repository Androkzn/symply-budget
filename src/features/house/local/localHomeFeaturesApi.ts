/**
 * Local `home-features` — the ledger counterpart of `src/api/home-features.ts`
 * (plan §6, Wave A). All 6 remote methods; none may be absent, because an absent
 * key falls through to a server with no rows for this household
 * (`localApiProxy.ts` header).
 *
 * Home features are the input the maintenance engine reasons over — "you own a
 * gas water heater, so flush it yearly" — which is why they are Tier A and the
 * *suggestions* derived from them are not. `createHomeFeature` on the Worker
 * calls `generateSuggestionsForHousehold` straight after the insert; that
 * regeneration is Tier D (plan §1.2, "re-derived on device (H7) or the feature
 * is disabled"), so it is deliberately absent here rather than quietly
 * round-tripped to a server that cannot see the feature.
 *
 * Unlike spaces and appliances, this module's remote methods return bare rows
 * and arrays rather than `{ feature }` / `{ features }` envelopes — the remote
 * unwraps `ensureData(...)` before returning. The local shapes match that, not
 * the HTTP body.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type {
  CreateHomeFeatureRequest,
  HomeFeature,
  UpdateHomeFeatureRequest,
} from '@api/home-features';

import { HouseLocalUnknownPropertyError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import type { LocalHomeFeature } from './types';

/**
 * Reads and writes address the ACTIVE property — `engine.ts` holds one ledger
 * per property and `mutateLocalHouseLedger` writes to whichever is active (H5,
 * plan §7). Serving another property's id out of the active ledger would file a
 * furnace under the wrong house, so the mismatch is raised, not absorbed.
 */
function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function featuresOf(householdId: string): LocalHomeFeature[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalHomeFeature>('homeFeatures');
}

/** Server order: `feature_type` ascending, then newest first (`getHomeFeatures`). */
function byTypeThenNewest(a: LocalHomeFeature, b: LocalHomeFeature): number {
  return a.feature_type.localeCompare(b.feature_type) || b.created_at.localeCompare(a.created_at);
}

export const localHomeFeaturesApi = {
  getFeatures: async (householdId: string): Promise<HomeFeature[]> =>
    featuresOf(householdId).slice().sort(byTypeThenNewest),

  getFeature: async (householdId: string, featureId: string): Promise<HomeFeature> => {
    const feature = featuresOf(householdId).find((row) => row.id === featureId);
    // The remote raises through `ensureData` on a 404; a local miss is the same
    // fact and must be as loud, or the edit screen renders an empty form and
    // saves a second row.
    if (!feature) throw new Error('Failed to get home feature');
    return feature;
  },

  /**
   * Defaults are the Worker's, not the caller's: `createHomeFeature` coalesces
   * `feature_type || 'other'`, `quantity || 1`, `condition || 'unknown'` and
   * `source || 'manual'`. A feature created offline must be indistinguishable
   * from one created online, because the maintenance rules key on exactly these
   * fields.
   */
  createFeature: async (
    householdId: string,
    data: CreateHomeFeatureRequest,
  ): Promise<HomeFeature> => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    const feature: LocalHomeFeature = {
      id: newLocalId('hf'),
      household_id: householdId,
      feature_type: data.feature_type || 'other',
      feature_subtype: data.feature_subtype ?? null,
      quantity: data.quantity ?? 1,
      location: data.location ?? null,
      brand: data.brand ?? null,
      model: data.model ?? null,
      serial_number: data.serial_number ?? null,
      install_date: data.install_date ?? null,
      warranty_expires: data.warranty_expires ?? null,
      age_years: data.age_years ?? null,
      condition: data.condition ?? 'unknown',
      notes: data.notes ?? null,
      // Only report extraction and the AI paths set anything else, and both are
      // server-side (Tier B) — a feature a member typed is always manual.
      source: 'manual',
      source_report_id: null,
      extraction_confidence: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await writeLocal(
      (draft) => {
        draft.homeFeatures.push(feature);
      },
      {
        opType: 'HOME_FEATURE_CREATE',
        entityType: 'home_feature',
        entityId: feature.id,
        payload: feature,
      },
    );
    return feature;
  },

  updateFeature: async (
    householdId: string,
    featureId: string,
    data: UpdateHomeFeatureRequest,
  ): Promise<HomeFeature> => {
    requireActiveProperty(householdId);
    let updated: LocalHomeFeature | undefined;
    await writeLocal(
      (draft) => {
        const feature = draft.homeFeatures.find(
          (row) => row.id === featureId && row.household_id === householdId,
        );
        if (!feature) throw new Error('Failed to update home feature');
        // Field-by-field rather than a spread: an absent key means "leave it
        // alone", and a spread of the request would null out everything the
        // edit form did not send.
        if (data.feature_type !== undefined) feature.feature_type = data.feature_type;
        if (data.feature_subtype !== undefined) {
          feature.feature_subtype = data.feature_subtype ?? null;
        }
        if (data.quantity !== undefined) feature.quantity = data.quantity;
        if (data.location !== undefined) feature.location = data.location ?? null;
        if (data.brand !== undefined) feature.brand = data.brand ?? null;
        if (data.model !== undefined) feature.model = data.model ?? null;
        if (data.serial_number !== undefined) feature.serial_number = data.serial_number ?? null;
        if (data.install_date !== undefined) feature.install_date = data.install_date ?? null;
        if (data.warranty_expires !== undefined) {
          feature.warranty_expires = data.warranty_expires ?? null;
        }
        if (data.age_years !== undefined) feature.age_years = data.age_years ?? null;
        if (data.condition !== undefined) feature.condition = data.condition;
        if (data.notes !== undefined) feature.notes = data.notes ?? null;
        feature.updated_at = nowIso();
        updated = feature;
      },
      {
        opType: 'HOME_FEATURE_UPDATE',
        entityType: 'home_feature',
        entityId: featureId,
        payload: data,
      },
    );
    return updated!;
  },

  deleteFeature: async (householdId: string, featureId: string): Promise<void> => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const exists = draft.homeFeatures.some(
          (row) => row.id === featureId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Failed to delete home feature');
        draft.homeFeatures = draft.homeFeatures.filter((row) => row.id !== featureId);
      },
      {
        opType: 'HOME_FEATURE_DELETE',
        entityType: 'home_feature',
        entityId: featureId,
        payload: { id: featureId },
      },
    );
  },

  /**
   * The remote sends `?type=` and lets D1 filter; the same predicate over the
   * ledger keeps the ordering contract of `getFeatures` for callers that treat
   * the two as interchangeable (`MaintenanceSetupScreen` does).
   */
  getFeaturesByType: async (householdId: string, featureType: string): Promise<HomeFeature[]> =>
    featuresOf(householdId)
      .filter((feature) => feature.feature_type === featureType)
      .sort(byTypeThenNewest),
};
