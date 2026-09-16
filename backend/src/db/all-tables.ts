/**
 * EVERY Drizzle table in the fleet, for code that must not miss one.
 *
 * ## Why this exists beside `schema.ts`
 *
 * `src/db/schema.ts` re-exports only 14 of the 36 `schema-*.ts` files, and that
 * is DELIBERATE. `drizzle.config.ts` points at it, and widening what drizzle-kit
 * can see is the documented catastrophe `scripts/db-generate-guard.mjs` is named
 * for: there are 156 migrations and one journal entry, so the next `generate`
 * would diff every schema file against migration 0000's snapshot and emit a
 * single migration that recreates the whole database. The partial barrel is the
 * safe state for MIGRATION DIFFING.
 *
 * It is the wrong state for anything that must reason about all data. Account
 * deletion inherited the partial view and silently skipped 22 schema files —
 * floor plans, contractors, savings, mortgage, health, calendar, notifications
 * and more — while reporting success. A sweep that cannot see a table cannot
 * fail on it either, which is what made the gap invisible.
 *
 * So the two needs are separated rather than compromised: drizzle-kit keeps its
 * deliberately partial view, and runtime code that needs completeness reads
 * THIS. Nothing here changes what drizzle-kit sees.
 *
 * ## Never point drizzle-kit at this file
 *
 * `drizzle.config.ts` must keep `schema: './src/db/schema.ts'`. Pointing it here
 * arms exactly the migration this repo has spent 156 hand-written migrations
 * avoiding. `all-tables.guard.test.ts` asserts that, because the tidy-minded
 * change of "why are there two schema entry points" is otherwise a very easy
 * mistake to make.
 *
 * ## Namespace imports, not `export *`
 *
 * Seven symbols collide across these files — `checklistItems` (checklists and
 * labor-hub), `QUOTE_STATUSES` (contractors and labor-hub),
 * `municipalityConfigs` (maintenance and utilities), plus their types. A barrel
 * of `export *` cannot merge those without renaming exports and every importer.
 * Namespace imports sidestep the collision entirely: two tables may share a
 * symbol NAME and still be distinct objects here.
 */
import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';

import * as aiChat from './schema-ai-chat';
import * as aiCredentials from './schema-ai-credentials';
import * as aiHousekeeper from './schema-ai-housekeeper';
import * as aiUsage from './schema-ai-usage';
import * as aihousekeeper from './schema-aihousekeeper';
import * as budget from './schema-budget';
import * as budgetChat from './schema-budget-chat';
import * as budgetLoans from './schema-budget-loans';
import * as budgetRenewals from './schema-budget-renewals';
import * as calendar from './schema-calendar';
import * as chat from './schema-chat';
import * as checklists from './schema-checklists';
import * as contractors from './schema-contractors';
import * as floorPlans from './schema-floor-plans';
import * as gardenPlans from './schema-garden-plans';
import * as homeProjects from './schema-home-projects';
import * as householdNotes from './schema-household-notes';
import * as healthAi from './schema-health-ai';
import * as healthChallenges from './schema-health-challenges';
import * as healthExercises from './schema-health-exercises';
import * as healthP2 from './schema-health-p2';
import * as healthReminders from './schema-health-reminders';
import * as healthSocial from './schema-health-social';
import * as health from './schema-health';
import * as laborHub from './schema-labor-hub';
import * as maintenance from './schema-maintenance';
import * as mortgage from './schema-mortgage';
import * as neighbours from './schema-neighbours';
import * as notifications from './schema-notifications';
import * as queueOps from './schema-queue-ops';
import * as recurringReminders from './schema-recurring-reminders';
import * as savings from './schema-savings';
import * as settings from './schema-settings';
import * as utilities from './schema-utilities';
import * as wishes from './schema-wishes';
import * as core from './schema';

/**
 * Every module above, so a new `schema-*.ts` is one import line away from being
 * covered. `all-tables.guard.test.ts` fails if a file on disk is missing here —
 * a forgotten import is otherwise a silent hole in account deletion.
 */
const MODULES: Array<Record<string, unknown>> = [
  core,
  aiChat,
  aiCredentials,
  aiHousekeeper,
  aiUsage,
  aihousekeeper,
  budget,
  budgetChat,
  budgetLoans,
  budgetRenewals,
  calendar,
  chat,
  checklists,
  contractors,
  floorPlans,
  gardenPlans,
  homeProjects,
  householdNotes,
  health,
  healthAi,
  healthChallenges,
  healthExercises,
  healthP2,
  healthReminders,
  healthSocial,
  laborHub,
  maintenance,
  mortgage,
  neighbours,
  notifications,
  queueOps,
  recurringReminders,
  savings,
  settings,
  utilities,
  wishes,
];

/**
 * Every distinct table, de-duplicated by SQL table name.
 *
 * De-duplication is by the name the DATABASE knows, not by object identity: the
 * same table can be reachable through both `schema.ts` and its own file, and
 * deleting from it twice would double-count every row in the summary.
 */
export function allTables(): SQLiteTable[] {
  const byName = new Map<string, SQLiteTable>();
  for (const module of MODULES) {
    for (const value of Object.values(module)) {
      if (!is(value, SQLiteTable)) continue;
      const name = getTableName(value);
      if (!byName.has(name)) byName.set(name, value);
    }
  }
  return [...byName.values()];
}
