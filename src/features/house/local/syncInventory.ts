/**
 * "1,645 synced" — what this device actually holds, and what it is made of.
 *
 * ## The question this answers
 *
 * A local-first home has no server the member can look at. When they ask "is
 * everything up to date?", the honest answer has never been available to them:
 * the sync screen could say a run finished and how many changes arrived, but
 * not what is HERE. A count they can compare against another phone — or against
 * their own sense of how much they have entered — is the only self-service
 * check that exists, and the per-category breakdown is what turns "1,645" from
 * a number into evidence.
 *
 * ## Counts are live rows, not history
 *
 * `ledger[table].length` is the number of rows that survive the merge:
 * `installRowEnvelopes` pushes a row only `if (!write.deleted)`, so a tombstoned
 * row is absent from the array rather than sitting in it with a flag. The total
 * is therefore "things you have", not "things that ever happened" — which is
 * what a member checking whether their appliances made it across is asking.
 *
 * It is deliberately NOT the op count. Ops are the history (one edit to one task
 * is many ops) and their number answers a different, engineer-shaped question.
 * A member comparing two phones wants the two totals to be equal, and only row
 * counts have that property.
 *
 * ## Why categories, and why the map is exhaustive
 *
 * The registry holds 75 tables. A list of 75 rows named `contractorIssue-
 * Resolutions` is not a thing a member can verify anything against, so tables
 * are grouped into the eleven areas the app itself is organised into.
 *
 * The grouping is a hand-written map, which is exactly the kind of thing that
 * rots when table 76 lands. `syncInventory.test.ts` asserts the map's tables
 * equal `HOUSE_LEDGER_TABLE_NAMES` exactly — no gaps, no strays — so **a new
 * table that nobody categorises fails the build** rather than quietly going
 * uncounted and making the total understate the home. That is the same trade
 * `houseLedgerExport` makes for the same reason, and it is the only thing that
 * keeps a derived total trustworthy over time.
 */

import type { HouseLedger } from './engine';
import { HOUSE_LEDGER_TABLE_NAMES } from './schema';
import type { HouseLedgerTableName } from './schema';

export interface HouseSyncCategory {
  key: string;
  /** Member-facing, and the same words the app's own navigation uses. */
  label: string;
  tables: readonly HouseLedgerTableName[];
}

/**
 * The twelve areas, in the order a member recognises them — the home itself
 * first, the machinery of the app (assistant, activity log) last.
 *
 * "Neighbours" sits second-to-last rather than beside "Home & spaces", and the
 * placement is deliberate: a member scanning this screen to answer *"what of
 * mine is on my devices"* should find the most sensitive category as its own
 * line with its own count, not folded into a row about floor plans.
 */
export const HOUSE_SYNC_CATEGORIES: readonly HouseSyncCategory[] = [
  {
    key: 'home',
    label: 'Home & spaces',
    tables: [
      'households',
      'householdMembers',
      'householdSpaces',
      'homeFeatures',
      'settings',
      'householdNotes',
    ],
  },
  {
    key: 'tasks',
    label: 'Tasks & reminders',
    tables: [
      'tasks',
      'maintenanceCompletions',
      'maintenanceSubtasks',
      'maintenanceTaskNotes',
      'recurringReminders',
      'taskDrafts',
      'maintenanceSuggestions',
    ],
  },
  {
    key: 'appliances',
    label: 'Appliances',
    tables: ['appliances', 'applianceServiceHistory', 'applianceDocuments'],
  },
  {
    key: 'checklists',
    label: 'Checklists',
    tables: [
      'seasonalChecklists',
      'seasonalChecklistItems',
      'recurringChecklists',
      'recurringChecklistItems',
      'checklistInstances',
      'checklistItemCompletions',
      'checklistItemPhotos',
      'visitChecklists',
      'visitChecklistItems',
    ],
  },
  {
    key: 'contractors',
    label: 'Contractors & quotes',
    tables: [
      'contractors',
      'contractorVisits',
      'contractorRepresentatives',
      'contractorDocuments',
      'appointments',
      'quotes',
      'contractorQuotes',
      'quoteRequests',
      'visitNotes',
      'contractorMessages',
      'contractorJobRatings',
      'contractorIssueResolutions',
      'contractorRecommendations',
    ],
  },
  {
    key: 'jobs',
    label: 'Jobs',
    tables: [
      'projects',
      'projectMilestones',
      'projectPayments',
      'projectProgressPhotos',
    ],
  },
  {
    key: 'bills',
    label: 'Bills & utilities',
    tables: [
      'utilityAccounts',
      'utilityBills',
      'utilityReminders',
      'utilityTrends',
      'propertyTaxes',
      'bcAssessmentData',
      'garbageSchedules',
    ],
  },
  {
    key: 'plans',
    label: 'Floor plans & garden',
    tables: [
      'floorPlans',
      'floorPlanMarkers',
      'floorPlanAnnotations',
      'floorPlanRegions',
      'gardenPlans',
      'gardenPlanObjects',
      'gardenPlanMarkers',
      'gardenPlanBoundaryDrafts',
    ],
  },
  {
    key: 'homeProjects',
    label: 'Home projects',
    tables: [
      'homeProjects',
      'homeProjectBudgetLines',
      'homeProjectSelections',
      'homeProjectOptionGroups',
      'homeProjectPhases',
      'homeProjectMilestones',
      'homeProjectBlockers',
      'homeProjectAttachments',
      'homeProjectPlanLinks',
      'homeProjectComments',
      'homeProjectActivity',
      'homeProjectGeometry',
    ],
  },
  {
    key: 'assistant',
    label: 'AI housekeeper',
    tables: [
      'assistantBriefings',
      'assistantOutboundLog',
      'assistantTrustLedger',
      'assistantIdentity',
      'aihousekeeperAttachments',
    ],
  },
  {
    key: 'neighbours',
    label: 'Neighbours',
    tables: ['neighbours', 'neighbourPeople', 'neighbourhoods'],
  },
  {
    key: 'activity',
    label: 'Activity log',
    tables: ['auditLog'],
  },
];

/** One line on the detail screen. */
export interface HouseSyncCategoryCount {
  key: string;
  label: string;
  count: number;
  /** Per-table counts, for the member who wants to see where a number came from. */
  tables: Array<{ table: HouseLedgerTableName; count: number }>;
}

export interface HouseSyncInventory {
  /** Every live row this device holds, across every ledgered table. */
  total: number;
  categories: HouseSyncCategoryCount[];
}

/** Rows in one table, tolerating a ledger that predates it. */
function rowsIn(ledger: HouseLedger, table: HouseLedgerTableName): number {
  const rows = (ledger as unknown as Record<string, unknown>)[table];
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * What this device holds, by category.
 *
 * Pure: takes the ledger and returns numbers, so the screen can render it and a
 * test can assert it without opening a session. Empty categories are KEPT
 * rather than filtered — "Appliances 0" is the answer for a member checking
 * whether their appliances arrived, and hiding the row turns a useful negative
 * into a missing one.
 */
export function describeHouseSyncInventory(
  ledger: HouseLedger,
): HouseSyncInventory {
  const categories = HOUSE_SYNC_CATEGORIES.map(category => {
    const tables = category.tables.map(table => ({
      table,
      count: rowsIn(ledger, table),
    }));
    return {
      key: category.key,
      label: category.label,
      count: tables.reduce((sum, t) => sum + t.count, 0),
      tables,
    };
  });
  return {
    total: categories.reduce((sum, c) => sum + c.count, 0),
    categories,
  };
}

/**
 * Every table the category map names, flattened.
 *
 * Exported for the test that compares it against the registry — see the header.
 * It is the guard that makes the total mean "everything", and it lives beside
 * the map so the next person to add a category can see what will check it.
 */
export function categorisedTableNames(): HouseLedgerTableName[] {
  return HOUSE_SYNC_CATEGORIES.flatMap(c => [...c.tables]);
}

/** The registry, re-exported so the test states both sides from one import. */
export { HOUSE_LEDGER_TABLE_NAMES };
