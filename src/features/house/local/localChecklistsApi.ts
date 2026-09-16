/**
 * Local counterpart of `src/api/checklists.ts` (8 methods) — Stage H3, Wave A.
 *
 * All four tables this module touches are Tier A, so nothing here is remote by
 * design and nothing throws `HouseLocalUnsupportedError`. The S1 rename matters
 * more here than anywhere else in Wave A: the ledger names are
 * `recurringChecklists` (physical `checklists`) and `recurringChecklistItems`
 * (physical `checklist_items`), because `schema-labor-hub.ts` declares a second
 * `checklist_items` and the registry is a flat map (plan §1.5 hazard S1). The
 * labor-hub pair is NOT in the ledger — writing to the wrong name here is a
 * silent data-loss bug, not a type error.
 *
 * WHAT IS DIFFERENT FROM A PLAIN CRUD FACADE
 * ------------------------------------------
 *  - **Two reads are also writes.** `getCurrentInstance` and `getProgress`
 *    materialize the current period's `checklist_instances` row if it does not
 *    exist yet, exactly as the server's GET handlers do. `getProgress`
 *    materializes every missing instance in ONE bulk write rather than one per
 *    checklist — `mutateLocalHouseLedger` re-captures and re-diffs the whole
 *    ledger per call (plan §3.3).
 *  - **Completion ids are deterministic.** `checklist_item_completions` carries
 *    a real `uniqueIndex(instance_id, item_id)` in D1
 *    (`backend/src/db/schema-checklists.ts:120`), so the id comes from
 *    `houseDeterministicIds.checklistItemCompletion` and never from
 *    `newLocalId`. With a random id, two members ticking the same item offline
 *    would both survive the merge and the ring would read 2/1 (plan §1.5 S3b).
 *  - **Derived collections are composed, not stored.** `LocalRecurringChecklist`
 *    is flat (types.ts:86); `Checklist.items` and
 *    `ChecklistInstanceWithDetails.completedItemIds` are joins the server did in
 *    SQL and the facade does here.
 *
 * The period/instance/progress rules themselves live in
 * `logic/checklistInstances.ts`, ported from the server and kept in sync there.
 */
import type {
  Checklist,
  ChecklistInstanceWithDetails,
  ChecklistProgress,
} from '@api/checklists';
import { deterministicRowId } from '@symply/local-first';

import { getLocalHouseMemberId } from './engine';
import { HouseLocalUnknownPropertyError } from './errors';
import { houseDeterministicIds, newLocalId } from './ids';
import {
  activeHouseholdId,
  nowIso,
  rowById,
  rowsOf,
  writeLocal,
  writeLocalBulk,
} from './localWrite';
import {
  RECENT_INSTANCE_WINDOW,
  applyInstanceProgress,
  buildChecklistInstance,
  calculateCurrentPeriod,
  checklistInstanceId,
  summarizeInstances,
} from './logic/checklistInstances';
import type {
  LocalChecklistInstance,
  LocalChecklistItemCompletion,
  LocalRecurringChecklist,
  LocalRecurringChecklistItem,
} from './types';

/** `src/api/checklists.ts:72 CreateChecklistRequest` — not exported there. */
type CreateChecklistInput = {
  name: string;
  description?: string;
  frequency: LocalRecurringChecklist['frequency'];
  icon?: string;
  color?: string;
  season?: 'spring' | 'summer' | 'fall' | 'winter';
  custom_days?: number[];
  items: Array<{ title: string; description?: string; is_required?: boolean }>;
};

/** `src/api/checklists.ts:87 CompleteItemRequest`. */
type CompleteItemInput = { notes?: string };

/**
 * Guard the property boundary explicitly.
 *
 * `localWrite`'s readers already filter by the active property, so addressing a
 * property this device has not activated would return an empty list — a screen
 * that renders "no checklists yet" for a home that is full of them. That is the
 * exact silent-empty failure mode `localApiProxy.ts` was written to prevent, so
 * the mismatch is raised instead (H5 activates through `householdStore`, which
 * is the same source the screens pass here).
 */
function requireActiveHousehold(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function checklistRows(): LocalRecurringChecklist[] {
  return rowsOf<LocalRecurringChecklist>('recurringChecklists');
}

/**
 * Row keys for the seeded defaults.
 *
 * The natural key is the seed's name inside the household — the same pair that
 * makes pressing "create defaults" twice idempotent. Kept beside the seed table
 * so the two cannot drift; a renamed default becomes a NEW row, which is the
 * correct reading of "the catalogue changed".
 */
function defaultChecklistId(householdId: string, name: string): string {
  return deterministicRowId('chk', [householdId, name]);
}

function defaultChecklistItemId(checklistId: string, title: string): string {
  return deterministicRowId('cki', [checklistId, title]);
}

function instanceRows(): LocalChecklistInstance[] {
  return rowsOf<LocalChecklistInstance>('checklistInstances');
}

function completionRows(): LocalChecklistItemCompletion[] {
  return rowsOf<LocalChecklistItemCompletion>('checklistItemCompletions');
}

/**
 * Active checklists in the server's order (`getChecklists` :130, `is_active`
 * + `order by sort_order asc`), with a tiebreak the server did not need.
 * SQLite leaves ties in an arbitrary order; on device two peers rendering the
 * same household in different orders is a visible bug, so ties fall back to
 * creation time and then to the row key, both of which every peer agrees on.
 */
function activeChecklists(): LocalRecurringChecklist[] {
  return checklistRows()
    .filter((checklist) => checklist.is_active)
    .slice()
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
}

/** Items of one checklist, `order by sort_order asc` (`getChecklists` :141). */
function itemsOf(checklistId: string): LocalRecurringChecklistItem[] {
  return rowsOf<LocalRecurringChecklistItem>('recurringChecklistItems')
    .filter((item) => item.checklist_id === checklistId)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id));
}

/** The `ChecklistWithItems` shape the server composed by joining (:144). */
function composeChecklist(checklist: LocalRecurringChecklist): Checklist {
  return { ...checklist, items: itemsOf(checklist.id) };
}

/** Newest period first — `order by period_start desc` (`getProgress` :433). */
function instancesOf(checklistId: string): LocalChecklistInstance[] {
  return instanceRows()
    .filter((instance) => instance.checklist_id === checklistId)
    .slice()
    .sort((a, b) => b.period_start.localeCompare(a.period_start));
}

/**
 * Materialize the current period for each checklist that is missing one.
 *
 * One bulk write for the whole set: opening the Checklists screen on a fresh
 * install would otherwise be one full ledger capture/diff per checklist, and
 * `createDefaults` guarantees at least four of them.
 */
async function materializeCurrentInstances(
  checklists: readonly LocalRecurringChecklist[],
  now: Date,
): Promise<void> {
  const householdId = activeHouseholdId();
  const existing = new Set(instanceRows().map((instance) => instance.id));
  const iso = now.toISOString();

  const missing: LocalChecklistInstance[] = [];
  for (const checklist of checklists) {
    const period = calculateCurrentPeriod(checklist.frequency, now);
    if (existing.has(checklistInstanceId(checklist.id, period.start))) continue;
    missing.push(
      buildChecklistInstance({
        checklistId: checklist.id,
        householdId,
        period,
        totalItems: itemsOf(checklist.id).length,
        now: iso,
      }),
    );
  }

  await writeLocalBulk(
    missing,
    (draft, chunk) => {
      draft.checklistInstances.push(...chunk);
    },
    (chunk) => ({
      opType: 'CHECKLIST_INSTANCE_MATERIALIZE',
      entityType: 'checklist_instance',
      entityId: chunk[0]!.id,
      payload: { count: chunk.length },
    }),
  );
}

/** The instance for a checklist's current period, after materialization. */
function currentInstanceOf(
  checklist: LocalRecurringChecklist,
  now: Date,
): LocalChecklistInstance | null {
  const period = calculateCurrentPeriod(checklist.frequency, now);
  const id = checklistInstanceId(checklist.id, period.start);
  return instanceRows().find((instance) => instance.id === id) ?? null;
}

/** `ChecklistInstanceWithDetails` — instance + its checklist + the ticked ids. */
function composeInstanceDetails(
  instance: LocalChecklistInstance,
  checklist: LocalRecurringChecklist,
): ChecklistInstanceWithDetails {
  return {
    ...instance,
    checklist: composeChecklist(checklist),
    completedItemIds: completionRows()
      .filter((completion) => completion.instance_id === instance.id)
      .map((completion) => completion.item_id),
  };
}

/**
 * `createDefaultChecklists` (:470) — content copied verbatim so a household
 * seeded offline and one seeded through the legacy API start identical.
 */
const DEFAULT_CHECKLISTS: ReadonlyArray<{
  name: string;
  frequency: LocalRecurringChecklist['frequency'];
  icon: string;
  color: string;
  items: readonly string[];
}> = [
  {
    name: 'Daily Home Check',
    frequency: 'daily',
    icon: '🏠',
    color: '#4ECDC4',
    items: [
      'Check locks on all doors',
      'Run water in unused sinks/tubs',
      'Check for water leaks',
      'Empty trash if needed',
    ],
  },
  {
    name: 'Weekly Maintenance',
    frequency: 'weekly',
    icon: '📅',
    color: '#5DADE2',
    items: [
      'Test smoke detectors',
      'Run garbage disposal',
      'Check HVAC filter',
      'Inspect fire extinguisher',
      'Clean drains',
    ],
  },
  {
    name: 'Monthly Inspection',
    frequency: 'monthly',
    icon: '🔍',
    color: '#9B59B6',
    items: [
      'Check water heater',
      'Inspect roof for damage',
      'Test garage door auto-reverse',
      'Check window/door seals',
      'Clean range hood filter',
      'Check sump pump',
    ],
  },
  {
    name: 'Seasonal Preparation',
    frequency: 'quarterly',
    icon: '🍂',
    color: '#E67E22',
    items: [
      'Change HVAC filters',
      'Clean gutters and downspouts',
      'Check weather stripping',
      'Service HVAC system',
      'Check exterior caulking',
      'Test CO detectors',
    ],
  },
];

/** One row of the `createDefaults` bulk payload — two tables, one op stream. */
type DefaultSeedRow =
  | { kind: 'checklist'; row: LocalRecurringChecklist }
  | { kind: 'item'; row: LocalRecurringChecklistItem };

export const localChecklistsApi = {
  getAll: async (householdId: string) => {
    requireActiveHousehold(householdId);
    return { checklists: activeChecklists().map(composeChecklist) };
  },

  /**
   * `createChecklist` (:61). Ids are RANDOM here on purpose: a custom checklist
   * has no natural key, so two members who each add "Spring prep" have added
   * two checklists — collapsing them would be the S3b rule misapplied
   * (`deterministic-id.ts:16`).
   */
  create: async (householdId: string, data: CreateChecklistInput) => {
    requireActiveHousehold(householdId);
    const now = nowIso();
    const checklist: LocalRecurringChecklist = {
      id: newLocalId('chk'),
      household_id: householdId,
      name: data.name,
      description: data.description ?? null,
      frequency: data.frequency,
      // The server's defaults, not the schema's — `icon`/`color` are nullable in
      // D1 but `createChecklist` :87 always fills them.
      icon: data.icon ?? '✅',
      color: data.color ?? '#4ECDC4',
      is_active: true,
      season: data.season ?? null,
      custom_days: data.custom_days ? JSON.stringify(data.custom_days) : null,
      sort_order: 0,
      created_by: getLocalHouseMemberId(),
      created_at: now,
      updated_at: now,
    };
    const items: LocalRecurringChecklistItem[] = data.items.map((item, index) => ({
      id: newLocalId('cki'),
      household_id: householdId,
      checklist_id: checklist.id,
      title: item.title,
      description: item.description ?? null,
      sort_order: index,
      // `isRequired !== false` on the server (:112) — absent means required.
      is_required: item.is_required !== false,
      linked_task_id: null,
      created_at: now,
    }));

    await writeLocal(
      (draft) => {
        draft.recurringChecklists.push(checklist);
        draft.recurringChecklistItems.push(...items);
      },
      {
        opType: 'CHECKLIST_CREATE',
        entityType: 'checklist',
        entityId: checklist.id,
        payload: { name: checklist.name, frequency: checklist.frequency, items: items.length },
      },
    );

    return { checklist: { ...checklist, items } };
  },

  /**
   * `deleteChecklist` (:150) is a SOFT delete — `is_active = false`. Ported as
   * such deliberately: a tombstone is absorbing in the ledger, so hard-deleting
   * here would discard the instances and completion history the progress view
   * still reads, and no peer could ever bring the checklist back.
   *
   * Returns nothing; the remote returns a raw `AxiosResponse` no caller reads.
   */
  delete: async (householdId: string, checklistId: string) => {
    requireActiveHousehold(householdId);
    await writeLocal(
      (draft) => {
        const checklist = draft.recurringChecklists.find((row) => row.id === checklistId);
        if (!checklist) throw new Error('Checklist not found');
        checklist.is_active = false;
        checklist.updated_at = nowIso();
      },
      {
        opType: 'CHECKLIST_DELETE',
        entityType: 'checklist',
        entityId: checklistId,
        payload: {},
      },
    );
  },

  /** `getProgress` (:419). Materializes every missing current period first. */
  getProgress: async (householdId: string) => {
    requireActiveHousehold(householdId);
    const now = new Date();
    const checklists = activeChecklists();
    await materializeCurrentInstances(checklists, now);

    const progress: ChecklistProgress[] = checklists.map((checklist) => {
      const recent = instancesOf(checklist.id).slice(0, RECENT_INSTANCE_WINDOW);
      const current = currentInstanceOf(checklist, now);
      return {
        checklist: composeChecklist(checklist),
        currentInstance: current ? composeInstanceDetails(current, checklist) : null,
        recentInstances: recent,
        ...summarizeInstances(recent),
      };
    });

    return { progress };
  },

  /** `getCurrentInstance` (:161) — find-or-create for the current period. */
  getCurrentInstance: async (householdId: string, checklistId: string) => {
    requireActiveHousehold(householdId);
    const checklist = rowById<LocalRecurringChecklist>('recurringChecklists', checklistId);
    // The server raises `NotFoundError` here (:175); the facade keeps the same
    // shape of failure so the screen's catch behaves identically.
    if (!checklist) throw new Error('Checklist not found');

    const now = new Date();
    await materializeCurrentInstances([checklist], now);
    const instance = currentInstanceOf(checklist, now);

    return { instance: instance ? composeInstanceDetails(instance, checklist) : null };
  },

  /**
   * `completeItem` (:308), with the count recomputed instead of incremented —
   * see `logic/checklistInstances.ts` deviation 2. Re-completing an item is a
   * no-op on the count here; on the server it is a unique-index violation.
   */
  completeItem: async (
    householdId: string,
    instanceId: string,
    itemId: string,
    data?: CompleteItemInput,
  ) => {
    requireActiveHousehold(householdId);
    const now = nowIso();
    const actorId = getLocalHouseMemberId();

    const completion: LocalChecklistItemCompletion = {
      // S3b: the id IS the natural key, so two devices ticking the same item
      // offline write the same row instead of two.
      id: houseDeterministicIds.checklistItemCompletion(instanceId, itemId),
      household_id: householdId,
      instance_id: instanceId,
      item_id: itemId,
      completed_by: actorId,
      completed_at: now,
      notes: data?.notes ?? null,
    };

    let updated: LocalChecklistInstance | undefined;
    await writeLocal(
      (draft) => {
        const instance = draft.checklistInstances.find((row) => row.id === instanceId);
        if (!instance) throw new Error('Checklist instance not found');

        const existingIndex = draft.checklistItemCompletions.findIndex(
          (row) => row.id === completion.id,
        );
        if (existingIndex >= 0) {
          // Keep the first completion's author and timestamp: whoever actually
          // did the job did it then, and re-ticking is not a second event.
          const previous = draft.checklistItemCompletions[existingIndex]!;
          previous.notes = completion.notes ?? previous.notes;
        } else {
          draft.checklistItemCompletions.push(completion);
        }

        applyInstanceProgress(instance, {
          completedItems: draft.checklistItemCompletions.filter(
            (row) => row.instance_id === instanceId,
          ).length,
          totalItems: draft.recurringChecklistItems.filter(
            (row) => row.checklist_id === instance.checklist_id,
          ).length,
          actorId,
          now,
        });
        updated = { ...instance };
      },
      {
        opType: 'CHECKLIST_ITEM_COMPLETE',
        entityType: 'checklist_item_completion',
        entityId: completion.id,
        payload: { instance_id: instanceId, item_id: itemId },
      },
    );

    return { instance: updated!, completion };
  },

  /** `uncompleteItem` (:367). Returns nothing, as the remote does. */
  uncompleteItem: async (householdId: string, instanceId: string, itemId: string) => {
    requireActiveHousehold(householdId);
    const completionId = houseDeterministicIds.checklistItemCompletion(instanceId, itemId);
    const now = nowIso();
    const actorId = getLocalHouseMemberId();

    await writeLocal(
      (draft) => {
        const instance = draft.checklistInstances.find((row) => row.id === instanceId);
        if (!instance) throw new Error('Checklist instance not found');

        draft.checklistItemCompletions = draft.checklistItemCompletions.filter(
          (row) => row.id !== completionId,
        );
        applyInstanceProgress(instance, {
          completedItems: draft.checklistItemCompletions.filter(
            (row) => row.instance_id === instanceId,
          ).length,
          totalItems: draft.recurringChecklistItems.filter(
            (row) => row.checklist_id === instance.checklist_id,
          ).length,
          actorId,
          now,
        });
      },
      {
        opType: 'CHECKLIST_ITEM_UNCOMPLETE',
        entityType: 'checklist_item_completion',
        entityId: completionId,
        payload: { instance_id: instanceId, item_id: itemId },
      },
    );
  },

  /**
   * `createDefaultChecklists` (:467). A bulk path, so `writeLocalBulk`: 4
   * checklists and 21 items is 25 rows and one op, not 25 ops (plan §3.3).
   *
   * Ids are deterministic per household — the button is offered whenever the
   * list looks empty, so two members can both press it, and the server's
   * `crypto.randomUUID()` would give that household eight default checklists.
   * An existing default is REACTIVATED rather than rewritten: a member who
   * renamed "Weekly Maintenance" keeps the rename, and a member who deleted it
   * gets it back, which is what pressing the button means.
   */
  createDefaults: async (householdId: string) => {
    requireActiveHousehold(householdId);
    const now = nowIso();

    const rows: DefaultSeedRow[] = [];
    DEFAULT_CHECKLISTS.forEach((seed, order) => {
      const checklistId = defaultChecklistId(householdId, seed.name);
      rows.push({
        kind: 'checklist',
        row: {
          id: checklistId,
          household_id: householdId,
          name: seed.name,
          description: null,
          frequency: seed.frequency,
          icon: seed.icon,
          color: seed.color,
          is_active: true,
          season: null,
          custom_days: null,
          // The server writes 0 for all four (`createChecklist` :92), which
          // leaves their order up to SQLite. The seed index is stable and every
          // device computes the same one.
          sort_order: order,
          // Deliberately unattributed, unlike `create`. These rows are minted
          // identically on every device; stamping the member who pressed the
          // button would give two devices two different values for a row they
          // agree on in every other field, and LWW would flap between them.
          created_by: null,
          created_at: now,
          updated_at: now,
        },
      });
      seed.items.forEach((title, index) => {
        rows.push({
          kind: 'item',
          row: {
            id: defaultChecklistItemId(checklistId, title),
            household_id: householdId,
            checklist_id: checklistId,
            title,
            description: null,
            sort_order: index,
            is_required: true,
            linked_task_id: null,
            created_at: now,
          },
        });
      });
    });

    await writeLocalBulk(
      rows,
      (draft, chunk) => {
        for (const entry of chunk) {
          if (entry.kind === 'checklist') {
            const existing = draft.recurringChecklists.find((row) => row.id === entry.row.id);
            if (existing) {
              existing.is_active = true;
              existing.updated_at = now;
            } else {
              draft.recurringChecklists.push(entry.row);
            }
          } else if (!draft.recurringChecklistItems.some((row) => row.id === entry.row.id)) {
            draft.recurringChecklistItems.push(entry.row);
          }
        }
      },
      (chunk, index) => ({
        opType: 'CHECKLIST_DEFAULTS_SEED',
        entityType: 'checklist',
        entityId: chunk[0]!.row.id,
        payload: { chunk: index, count: chunk.length },
      }),
    );
  },
};
