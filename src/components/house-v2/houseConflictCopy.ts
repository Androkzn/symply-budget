/**
 * BR-044 — plain-language copy for an auto-merge that discarded someone's edit.
 *
 * The merge engine resolves a concurrent write by last-writer-wins and records
 * what it threw away on `ledger.conflicts`. That list is the *only* trace the
 * losing edit ever existed: nothing is queued, nothing is retried, and the
 * member who typed it sees their value silently replaced by someone else's on
 * the next render. BR-044 exists because a silent overwrite in a shared home is
 * indistinguishable from data loss.
 *
 * So the copy has one job, and it is not "report a conflict": say **what was
 * kept** and **what was lost**, in a sentence that tells the member whether they
 * need to do anything. The raw record cannot do that — `winner` and `loser` are
 * encoded HLC stamps, and `table`/`field` are database identifiers.
 */
import type { LedgerConflict } from '@features/house/local/projection';

import { formatSyncTime } from './houseSyncCopy';

export type HouseConflictCopy = {
  /** Short enough for a row heading. */
  title: string;
  /** What was kept, what was lost, and what (if anything) to do about it. */
  body: string;
  /** True when the discarded edit was this member's own. */
  mine: boolean;
  /** "12 minutes ago" — coarse on purpose. */
  when: string;
};

/**
 * Ledger table → the noun a member would use, with its article.
 *
 * Keyed loosely (`Record<string, string>`) rather than exhaustively over
 * `HouseLedgerTableName`: Wave B and C add tables to that union, and a missing
 * key must degrade to "an item" rather than fail the build and block a merge
 * from surfacing at all.
 */
const TABLE_NOUNS: Record<string, string> = {
  households: 'this home',
  householdMembers: 'a member',
  householdSpaces: 'a room',
  tasks: 'a task',
  maintenanceCompletions: 'a completed task',
  maintenanceSubtasks: 'a sub-task',
  maintenanceTaskNotes: 'a note on a task',
  homeFeatures: 'a home feature',
  appliances: 'an appliance',
  applianceServiceHistory: 'a service record',
  garbageSchedules: 'a garbage schedule',
  seasonalChecklists: 'a seasonal checklist',
  seasonalChecklistItems: 'a seasonal checklist item',
  recurringChecklists: 'a checklist',
  recurringChecklistItems: 'a checklist item',
  checklistInstances: 'a checklist run',
  checklistItemCompletions: 'a checked-off item',
  householdNotes: 'a note',
  settings: 'a setting',
  recurringReminders: 'a reminder',
  taskDrafts: 'a task draft',
};

export function houseConflictNoun(table: string): string {
  return TABLE_NOUNS[table] ?? 'an item';
}

/** A handful of column names whose humanized form would read badly. */
const FIELD_LABELS: Record<string, string> = {
  id: 'identifier',
  dueDate: 'due date',
  due_date: 'due date',
  isCompleted: 'completed',
  is_completed: 'completed',
  assignedTo: 'assignee',
  assigned_to: 'assignee',
  notes: 'notes',
  title: 'title',
  name: 'name',
};

/** `dueDate` / `due_date` → "due date". Unknown columns degrade, never throw. */
export function houseConflictFieldLabel(field: string | null): string {
  if (!field) return 'This';
  const known = FIELD_LABELS[field];
  const words =
    known ??
    field
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .trim()
      .toLowerCase();
  return words.length > 0 ? words : 'This';
}

function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0].toUpperCase()}${text.slice(1)}`;
}

/**
 * Turn one merge record into two sentences a member can read.
 *
 * `selfMemberId` decides between "your change was replaced" and "someone's
 * change was replaced" — a distinction that matters, because only the first one
 * asks the reader to do something. `loserMemberId` is nullable (the author is
 * unknown for a replayed parked patch), and an unknown author is treated as
 * *not* mine: over-claiming "you lost work" when we do not know that would be
 * worse than under-claiming.
 */
export function describeHouseConflict(
  conflict: LedgerConflict,
  selfMemberId: string | null,
  now = Date.now(),
): HouseConflictCopy {
  const noun = houseConflictNoun(conflict.table);
  const mine = selfMemberId != null && conflict.loserMemberId === selfMemberId;
  const when = formatSyncTime(conflict.at, now);

  if (conflict.kind === 'edit_vs_delete') {
    return {
      mine,
      when,
      title: mine
        ? `${capitalize(noun)} you changed was deleted`
        : `${capitalize(noun)} was changed and deleted at once`,
      body: mine
        ? 'You changed this while someone else deleted it. The deletion was kept, so your change is gone. Add it again if you still need it.'
        : 'Someone changed this while someone else deleted it. The deletion was kept, so that change is gone.',
    };
  }

  const label = houseConflictFieldLabel(conflict.field);
  return {
    mine,
    when,
    title: `${capitalize(label)} on ${noun}`,
    body: mine
      ? 'You and someone else changed this at the same time. Their version was kept and yours was replaced. Have a look — if yours was right, set it again.'
      : 'Two people changed this at the same time. The later change was kept and the earlier one was replaced.',
  };
}

/** Header line for the list — the count is the part a member scans for. */
export function houseConflictSummary(count: number): string {
  if (count <= 0) return 'No changes were replaced.';
  return count === 1
    ? '1 change was replaced when your home synced'
    : `${count} changes were replaced when your home synced`;
}
