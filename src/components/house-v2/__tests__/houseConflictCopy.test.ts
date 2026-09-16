/**
 * BR-044 copy — the sentences a member reads when the merge discarded work.
 *
 * `src/components/house-v2/__tests__/` was an EMPTY DIRECTORY until 2026-08-15:
 * every module in `components/house-v2/` shipped with zero unit tests, and the
 * only thing exercising this copy was a two-device Maestro suite that has never
 * run. That is the wrong place for the load-bearing assertions, because the
 * value here is not "does a string render" but "does the string say the right
 * thing about whose work was lost" — a semantic question a device run is poorly
 * shaped to ask and a unit test answers in milliseconds.
 *
 * Four properties are worth locking, and each has a failure mode that is worse
 * than a crash because it is quiet and plausible:
 *
 *  1. **Say what was KEPT and what was LOST.** The raw record cannot: `winner`
 *     and `loser` are encoded HLC stamps and `table`/`field` are database
 *     identifiers. A member seeing "conflict on tasks.due_date" learns nothing
 *     about whether to act.
 *  2. **"Mine" must not be over-claimed.** `loserMemberId` is nullable — the
 *     author is unknown for a replayed parked patch. Telling someone "you lost
 *     work" when we do not know that is worse than under-claiming, because it
 *     sends them looking for something they never wrote.
 *  3. **An unknown table degrades, never throws.** `TABLE_NOUNS` is keyed
 *     loosely on purpose: Wave B and C added 42 tables to that union, and a
 *     missing key must read "an item" rather than fail the build and stop a
 *     merge from surfacing at all.
 *  4. **`edit_vs_delete` is its own sentence.** "Your change was replaced" and
 *     "the thing you changed was deleted" call for different member actions;
 *     collapsing them loses the only actionable part.
 */
import type { LedgerConflict } from '@features/house/local/projection';

import {
  describeHouseConflict,
  houseConflictFieldLabel,
  houseConflictNoun,
  houseConflictSummary,
} from '../houseConflictCopy';

const SELF = 'member-self';
const OTHER = 'member-other';
const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);

function conflict(overrides: Partial<LedgerConflict> = {}): LedgerConflict {
  return {
    id: 'cf_1',
    table: 'tasks',
    rowKey: 'task_1',
    field: 'dueDate',
    kind: 'field_lww',
    winner: 'stamp-winner',
    loser: 'stamp-loser',
    loserMemberId: OTHER,
    at: NOW - 60_000,
    ...overrides,
  } as LedgerConflict;
}

describe('houseConflictNoun — database identifiers never reach a member', () => {
  it('names the Wave A tables a member actually recognises', () => {
    expect(houseConflictNoun('tasks')).toBe('a task');
    expect(houseConflictNoun('householdSpaces')).toBe('a room');
    expect(houseConflictNoun('appliances')).toBe('an appliance');
  });

  it('degrades an unregistered table to "an item" rather than throwing', () => {
    // The map is keyed loosely BECAUSE H11 added 42 tables. A throw here would
    // stop the conflict surfacing at all — the merge would silently discard
    // work and BR-044 would report nothing, which is the exact failure the
    // whole feature exists to prevent.
    expect(houseConflictNoun('gardenPlanObjects')).toBe('an item');
    expect(houseConflictNoun('a_table_invented_next_year')).toBe('an item');
  });
});

describe('houseConflictFieldLabel — column names are not English', () => {
  it('humanises snake_case and camelCase to the same words', () => {
    expect(houseConflictFieldLabel('dueDate')).toBe('due date');
    expect(houseConflictFieldLabel('due_date')).toBe('due date');
  });

  it('falls back to "This" for a whole-row conflict with no field', () => {
    expect(houseConflictFieldLabel(null)).toBe('This');
  });

  it('never emits a raw identifier for an unknown column', () => {
    const label = houseConflictFieldLabel('some_new_column');
    expect(label).toBe('some new column');
    expect(label).not.toContain('_');
  });
});

describe('describeHouseConflict — whose work was lost', () => {
  it('tells the member their own change was replaced, and what to do', () => {
    const copy = describeHouseConflict(conflict({ loserMemberId: SELF }), SELF, NOW);
    expect(copy.mine).toBe(true);
    // The actionable half: it must invite them to check, not merely report.
    expect(copy.body).toMatch(/yours was replaced|set it again|have a look/i);
  });

  it('does NOT claim the loss was theirs when someone else wrote it', () => {
    const copy = describeHouseConflict(conflict({ loserMemberId: OTHER }), SELF, NOW);
    expect(copy.mine).toBe(false);
    expect(copy.body).not.toMatch(/\byours\b/i);
  });

  it('treats an UNKNOWN author as not-mine — under-claim, never over-claim', () => {
    // `loserMemberId` is null for a replayed parked patch. Saying "you lost
    // work" on a guess sends a member hunting for something they never wrote.
    const copy = describeHouseConflict(conflict({ loserMemberId: null }), SELF, NOW);
    expect(copy.mine).toBe(false);
  });

  it('is not-mine when the reader is unidentified', () => {
    const copy = describeHouseConflict(conflict({ loserMemberId: SELF }), null, NOW);
    expect(copy.mine).toBe(false);
  });

  it('gives edit_vs_delete its own sentence, because the action differs', () => {
    const mine = describeHouseConflict(
      conflict({ kind: 'edit_vs_delete', loserMemberId: SELF }),
      SELF,
      NOW,
    );
    expect(mine.title).toMatch(/deleted/i);
    expect(mine.body).toMatch(/deletion was kept/i);
    // "Add it again" is the only thing a member can actually do here.
    expect(mine.body).toMatch(/add it again/i);

    const theirs = describeHouseConflict(
      conflict({ kind: 'edit_vs_delete', loserMemberId: OTHER }),
      SELF,
      NOW,
    );
    expect(theirs.body).not.toMatch(/add it again/i);
  });

  it('never leaks a stamp, a table name or a column name into the copy', () => {
    // The whole reason this module exists. `winner`/`loser` are HLC stamps and
    // `table` is a D1 identifier; either one on screen is the same class of
    // defect as the P4 method identifiers guarded in p4ScreensRenderCopy.
    const copy = describeHouseConflict(conflict(), SELF, NOW);
    const rendered = `${copy.title} ${copy.body}`;
    for (const leak of ['stamp-winner', 'stamp-loser', 'tasks', 'dueDate', 'task_1', 'cf_1']) {
      expect(rendered).not.toContain(leak);
    }
  });

  it('renders a coarse relative time rather than a timestamp', () => {
    const copy = describeHouseConflict(conflict({ at: NOW - 12 * 60_000 }), SELF, NOW);
    expect(copy.when).toBeTruthy();
    expect(copy.when).not.toContain('2026');
  });
});

describe('houseConflictSummary — the count a member scans for', () => {
  it('says nothing was replaced when nothing was', () => {
    expect(houseConflictSummary(0)).toMatch(/no changes were replaced/i);
    expect(houseConflictSummary(-1)).toMatch(/no changes were replaced/i);
  });

  it('agrees in number', () => {
    expect(houseConflictSummary(1)).toMatch(/^1 change was replaced/);
    expect(houseConflictSummary(4)).toMatch(/^4 changes were replaced/);
  });

  it('refuses Budget’s engine vocabulary', () => {
    // House deliberately rejects "merge conflict" as member-facing language
    // (HouseSyncStatusCard.tsx:5-11). The two-device runner was changed to
    // assert the `house-sync-conflicts` ELEMENT instead of grepping for that
    // phrase, precisely so this copy could stay in plain English. If someone
    // reintroduces the phrase, that runner assertion silently becomes a
    // text-match again — so the ban is locked here.
    for (const n of [0, 1, 5]) {
      expect(houseConflictSummary(n)).not.toMatch(/merge conflict/i);
    }
  });
});
