/**
 * `maintenance-suggestions`, on the ledger (H13 D-wave).
 *
 * Ported from `backend/src/services/maintenance-suggestion-service.ts`. Every
 * method on `maintenanceSuggestionsApi` has a counterpart here — the parity gate
 * in `apiParity.test.ts` requires it — and nothing in this module is
 * remote-by-design.
 *
 * ## The three things that are not a straight transcription
 *
 * **1. The row is ledgered; the template it joins is NOT.**
 * `SuggestionWithTemplate` is a suggestion plus a slice of
 * `maintenance_templates`, which is Tier C: global reference data with no
 * `household_id`, which cannot go in a per-household ledger and which the
 * Worker must stay able to update. So the suggestion comes from the ledger and
 * the template from `catalogCache` — cached on device, so this read works
 * offline, and refreshed opportunistically so a new template still arrives.
 * A suggestion whose template is not in the cache still renders: it carries its
 * own `title`, `description` and `frequency`, copied at generation time
 * precisely so the join is an enrichment rather than a dependency.
 *
 * **2. `feature_id` vs `home_feature_id`.**
 * The client DTO says `feature_id`; D1 says `home_feature_id`. The ledger table
 * is the D1 table, so rows are stored under D1's name and mapped at this
 * boundary — see `toDto` / the note on `LocalMaintenanceSuggestion`. Screens
 * keep reading `feature_id` and none of them changed.
 *
 * **3. Generation is now concurrent, and D1 never had to care.**
 * The service deduplicates by reading for an existing
 * `(household_id, home_feature_id, template_id)` before inserting. That read is
 * serialised by the Worker request; on device nothing serialises it, and two
 * members' phones generating offline would each mint a row. The id is therefore
 * derived from that triple rather than random, so the two rows ARE one row and
 * LWW merges them. This is the hazard that moving work on-device creates and
 * that no schema-derived guard can see, because D1 declares no uniqueIndex for
 * it.
 */
// Polyfill before the engine / @symply/local-first graph loads (@noble captures
// globalThis.crypto at module load) — plan §6.1.
import './cryptoPolyfill';

import type {
  ApplySuggestionsRequest,
  DismissSuggestionRequest,
  MaintenanceSuggestion,
  MaintenanceTemplate,
  SnoozeSuggestionRequest,
  SuggestionWithTemplate,
} from '@api/maintenance-suggestions';

import { loadCatalog } from './catalogCache';
import { houseDeterministicIds, isoNow, newLocalId } from './ids';
import {
  activeHouseholdId,
  ledger,
  nowIso,
  requireActiveProperty,
  rowsOf,
  writeLocal,
} from './localWrite';
import type { LocalHomeFeature, LocalMaintenanceSuggestion, LocalTask } from './types';

/** Tier C catalogue namespace — see `catalogCache.KNOWN_CATALOGS`. */
const TEMPLATE_CATALOG = 'maintenance_templates';

/**
 * Fetch the template catalogue. Kept as a narrow lazy require rather than a
 * top-level import: `@api/templates` pulls the http client, and this module is
 * reached from screens that render offline.
 */
async function fetchTemplates(): Promise<MaintenanceTemplate[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { templatesApi } = require('@api/templates') as typeof import('@api/templates');
  const result = await templatesApi.list();
  return (result?.templates ?? []) as unknown as MaintenanceTemplate[];
}

/** Ledger row → the shape screens expect. Reverses the `home_feature_id` rename. */
function toDto(row: LocalMaintenanceSuggestion): MaintenanceSuggestion {
  const { home_feature_id, ...rest } = row;
  return { ...rest, feature_id: home_feature_id } as MaintenanceSuggestion;
}

/**
 * Attach the template slice. A missing template is NOT an error: the row's own
 * copied fields are what the card renders, and the catalogue is an enrichment.
 */
function withTemplate(
  row: LocalMaintenanceSuggestion,
  templates: Map<string, MaintenanceTemplate>,
  features: Map<string, LocalHomeFeature>,
): SuggestionWithTemplate {
  const feature = features.get(row.home_feature_id);
  return {
    ...toDto(row),
    template: templates.get(row.template_id) ?? {},
    ...(feature
      ? {
          feature: {
            id: feature.id,
            feature_type: feature.feature_type,
            feature_subtype: feature.feature_subtype ?? null,
            location: feature.location ?? null,
          },
        }
      : {}),
  } as SuggestionWithTemplate;
}

/** Suggestions for the active property, newest first. */
function suggestionRows(householdId: string): LocalMaintenanceSuggestion[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalMaintenanceSuggestion>('maintenanceSuggestions');
}

async function hydrate(rows: LocalMaintenanceSuggestion[]): Promise<SuggestionWithTemplate[]> {
  const templates = await loadCatalog<MaintenanceTemplate>(TEMPLATE_CATALOG, fetchTemplates);
  const byId = new Map(templates.map((t) => [t.id, t]));
  const features = new Map(rowsOf<LocalHomeFeature>('homeFeatures').map((f) => [f.id, f]));
  return rows.map((row) => withTemplate(row, byId, features));
}

/**
 * The server's matching rule, ported verbatim
 * (`getTemplatesForFeature`): same `feature_type`, active only, and a subtype
 * that either matches or is null. The null arm is not an "any" wildcard — a
 * template with no subtype applies to every subtype of its type, and a feature
 * with no subtype takes ONLY those. Collapsing the two would suggest
 * gas-furnace maintenance for a heat pump.
 */
function templatesForFeature(
  all: MaintenanceTemplate[],
  featureType: string,
  featureSubtype: string | null | undefined,
): MaintenanceTemplate[] {
  return all
    .filter((t) => t.feature_type === featureType)
    .filter((t) => (t as { is_active?: boolean }).is_active !== false)
    .filter((t) =>
      featureSubtype ? t.feature_subtype === null || t.feature_subtype === featureSubtype : t.feature_subtype === null,
    )
    .sort((a, b) => (a.frequency ?? '').localeCompare(b.frequency ?? '') || (a.title ?? '').localeCompare(b.title ?? ''));
}

export const localMaintenanceSuggestionsApi = {
  async getSuggestions(householdId: string): Promise<SuggestionWithTemplate[]> {
    return hydrate(suggestionRows(householdId));
  },

  async getPendingSuggestions(householdId: string): Promise<SuggestionWithTemplate[]> {
    return hydrate(suggestionRows(householdId).filter((row) => row.status === 'pending'));
  },

  async getSuggestion(householdId: string, suggestionId: string): Promise<SuggestionWithTemplate> {
    const row = suggestionRows(householdId).find((r) => r.id === suggestionId);
    if (!row) throw new Error('Suggestion not found');
    return (await hydrate([row]))[0];
  },

  /**
   * Accept suggestions and materialise a task for each.
   *
   * Written as ONE op covering both tables rather than one op per suggestion:
   * `writeLocal` diffs the whole ledger per call, so a member accepting twelve
   * suggestions would otherwise pay twelve full diffs while watching.
   */
  async applySuggestions(
    householdId: string,
    data: ApplySuggestionsRequest,
  ): Promise<{ applied: number; task_ids: string[] }> {
    const target = requireActiveProperty(householdId);
    const ids = new Set((data as { suggestion_ids?: string[] }).suggestion_ids ?? []);
    const now = nowIso();
    const taskIds: string[] = [];

    await writeLocal(
      (draft) => {
        for (const row of draft.maintenanceSuggestions) {
          if (!ids.has(row.id) || row.status !== 'pending') continue;
          const taskId = newLocalId('task');
          taskIds.push(taskId);
          draft.tasks.push({
            id: taskId,
            household_id: target,
            title: row.title,
            description: row.description ?? null,
            // The suggestion carries the cadence; the task is what recurs.
            recurrence: row.frequency,
            due_date: row.suggested_start_date ?? null,
            status: 'pending',
            created_at: now,
            updated_at: now,
          } as unknown as LocalTask);
          row.status = 'accepted';
          row.accepted_at = now;
          row.applied_task_id = taskId;
          row.updated_at = now;
        }
      },
      {
        opType: 'apply',
        entityType: 'maintenanceSuggestions',
        entityId: target,
        payload: { suggestion_ids: [...ids] },
      },
    );

    return { applied: taskIds.length, task_ids: taskIds };
  },

  async dismissSuggestion(
    householdId: string,
    suggestionId: string,
    data?: DismissSuggestionRequest,
  ): Promise<void> {
    requireActiveProperty(householdId);
    const now = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.maintenanceSuggestions.find((r) => r.id === suggestionId);
        if (!row) return;
        row.status = 'dismissed';
        row.dismissed_at = now;
        row.dismissed_reason = (data as { reason?: string } | undefined)?.reason ?? null;
        row.updated_at = now;
      },
      { opType: 'dismiss', entityType: 'maintenanceSuggestions', entityId: suggestionId },
    );
  },

  async snoozeSuggestion(
    householdId: string,
    suggestionId: string,
    data: SnoozeSuggestionRequest,
  ): Promise<void> {
    requireActiveProperty(householdId);
    const now = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.maintenanceSuggestions.find((r) => r.id === suggestionId);
        if (!row) return;
        row.status = 'snoozed';
        row.snooze_until = (data as { snooze_until?: string }).snooze_until ?? null;
        row.updated_at = now;
      },
      { opType: 'snooze', entityType: 'maintenanceSuggestions', entityId: suggestionId },
    );
  },

  /**
   * Generate suggestions for every home feature.
   *
   * Deduplication is by DETERMINISTIC ID rather than by the service's
   * read-then-write: see the header. A row that already exists is left exactly
   * as it is — regenerating must never resurrect a suggestion the member
   * dismissed, which a blind upsert would do.
   */
  async generateSuggestions(householdId: string): Promise<{ generated: number }> {
    const target = requireActiveProperty(householdId);
    const all = await loadCatalog<MaintenanceTemplate>(TEMPLATE_CATALOG, fetchTemplates);
    const features = rowsOf<LocalHomeFeature>('homeFeatures');
    const existing = new Set(
      rowsOf<LocalMaintenanceSuggestion>('maintenanceSuggestions').map((r) => r.id),
    );
    const now = nowIso();

    const fresh: LocalMaintenanceSuggestion[] = [];
    for (const feature of features) {
      for (const template of templatesForFeature(all, feature.feature_type, feature.feature_subtype)) {
        const id = houseDeterministicIds.maintenanceSuggestion(target, feature.id, template.id);
        if (existing.has(id)) continue;
        existing.add(id);
        fresh.push({
          id,
          household_id: target,
          home_feature_id: feature.id,
          template_id: template.id,
          // Copied, not referenced: this is what makes the Tier C join an
          // enrichment rather than a dependency, so a card still renders when
          // the catalogue has never been fetched on this install.
          title: template.title,
          description: template.description ?? null,
          frequency: template.frequency,
          suggested_start_date: null,
          status: 'pending',
          applied_task_id: null,
          accepted_at: null,
          dismissed_at: null,
          dismissed_reason: null,
          snooze_until: null,
          created_at: now,
          updated_at: now,
        } as LocalMaintenanceSuggestion);
      }
    }

    if (fresh.length > 0) {
      await writeLocal(
        (draft) => {
          draft.maintenanceSuggestions.push(...fresh);
        },
        {
          opType: 'generate',
          entityType: 'maintenanceSuggestions',
          entityId: target,
          payload: { generated: fresh.length },
        },
      );
    }

    return { generated: fresh.length };
  },
};

export type LocalMaintenanceSuggestionsApi = typeof localMaintenanceSuggestionsApi;

/** Re-exported for the ledger-refresh bridge and tests. */
export { TEMPLATE_CATALOG, isoNow, activeHouseholdId, ledger };
