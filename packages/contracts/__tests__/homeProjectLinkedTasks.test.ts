/**
 * The link between a home project and its jobs, as both backends read it.
 *
 * Same argument as `homeProjectAccess.test.ts`: the Worker and the device
 * ledger agree about which tasks belong to a project because both call THESE
 * functions, not because two implementations happen to match. So the contract
 * is what is asserted — the never-throw parse of a column neither of them
 * wrote, the identity return that makes both `linkTask` implementations
 * idempotent without a second read, and the null-not-`'[]'` rule that keeps a
 * project nobody has linked a task to reading exactly as it did before
 * migration 0170.
 */
import { describe, expect, it } from 'vitest';

import {
  HOME_PROJECT_MAX_LINKED_TASKS,
  parseHomeProjectLinkedTaskIds,
  serializeHomeProjectLinkedTaskIds,
  withHomeProjectLinkedTask,
  withoutHomeProjectLinkedTask,
} from '../src/home-project-linked-tasks';

describe('reading the column', () => {
  it('reads stored JSON as the ids it holds, in order', () => {
    expect(parseHomeProjectLinkedTaskIds('["task_a","task_b"]')).toEqual([
      'task_a',
      'task_b',
    ]);
  });

  it('reads an already-parsed array too, so both row shapes share one reader', () => {
    // The D1 row hands this a string; the ledger row hands it whatever the last
    // writer put there. A reader that only accepted one would push a
    // `typeof` check into every call site.
    expect(parseHomeProjectLinkedTaskIds(['task_a'])).toEqual(['task_a']);
  });

  it('reads a project with no linked tasks as none, however that is stored', () => {
    expect(parseHomeProjectLinkedTaskIds(null)).toEqual([]);
    expect(parseHomeProjectLinkedTaskIds(undefined)).toEqual([]);
    expect(parseHomeProjectLinkedTaskIds('')).toEqual([]);
    expect(parseHomeProjectLinkedTaskIds('[]')).toEqual([]);
  });

  /**
   * The hub loads this on every project open. A throw here would blank a whole
   * renovation over a column that only decides which jobs are listed beside it.
   */
  it('never throws on a value it did not write', () => {
    expect(parseHomeProjectLinkedTaskIds('not json')).toEqual([]);
    expect(parseHomeProjectLinkedTaskIds('{"not":"an array"}')).toEqual([]);
    expect(parseHomeProjectLinkedTaskIds(42)).toEqual([]);
    // Non-strings inside the array are dropped rather than poisoning the list —
    // one bad entry from a future writer must not lose the good ones beside it.
    expect(parseHomeProjectLinkedTaskIds('["task_a",7,null,"task_b"]')).toEqual([
      'task_a',
      'task_b',
    ]);
  });

  it('deduplicates, because a link is a set and LWW can merge two writers', () => {
    expect(parseHomeProjectLinkedTaskIds('["task_a","task_a"]')).toEqual(['task_a']);
  });

  it('bounds what a single column can carry', () => {
    const many = Array.from(
      { length: HOME_PROJECT_MAX_LINKED_TASKS + 25 },
      (_, i) => `task_${i}`,
    );
    expect(parseHomeProjectLinkedTaskIds(many)).toHaveLength(
      HOME_PROJECT_MAX_LINKED_TASKS,
    );
    // Above what one Smart Project generation can produce (120), so the cap is
    // a guard on the write rather than a limit on the project.
    expect(HOME_PROJECT_MAX_LINKED_TASKS).toBeGreaterThan(120);
  });
});

describe('writing the column', () => {
  it('stores NULL rather than an empty array', () => {
    // So a project nobody has linked a task to reads exactly as every project
    // did before 0170 — the same rule `serializeHomeProjectAccessGrants` follows.
    expect(serializeHomeProjectLinkedTaskIds([])).toBeNull();
    expect(serializeHomeProjectLinkedTaskIds(['task_a'])).toBe('["task_a"]');
  });

  it('round-trips through the parser', () => {
    const ids = ['task_a', 'task_b'];
    expect(
      parseHomeProjectLinkedTaskIds(serializeHomeProjectLinkedTaskIds(ids)),
    ).toEqual(ids);
  });
});

describe('adding and removing one link', () => {
  it('appends, keeping the order links were made in', () => {
    expect(withHomeProjectLinkedTask(['task_a'], 'task_b')).toEqual([
      'task_a',
      'task_b',
    ]);
  });

  /**
   * The identity contract, and it is load-bearing rather than an optimisation:
   * both `linkTask` implementations compare `next !== current` to decide whether
   * to write at all. Returning a fresh equal array would make every re-link a
   * ledger op and a second `task_linked` entry on the activity feed.
   */
  it('returns the SAME array when there is nothing to add', () => {
    const current = ['task_a'];
    expect(withHomeProjectLinkedTask(current, 'task_a')).toBe(current);
    expect(withHomeProjectLinkedTask(current, '   ')).toBe(current);
  });

  it('refuses to grow past the cap instead of silently trimming the head', () => {
    const full = Array.from(
      { length: HOME_PROJECT_MAX_LINKED_TASKS },
      (_, i) => `task_${i}`,
    );
    const after = withHomeProjectLinkedTask(full, 'task_one_too_many');
    expect(after).toHaveLength(HOME_PROJECT_MAX_LINKED_TASKS);
    expect(after).not.toContain('task_one_too_many');
  });

  it('removes a link, and returns the same array when there was none', () => {
    expect(withoutHomeProjectLinkedTask(['task_a', 'task_b'], 'task_a')).toEqual([
      'task_b',
    ]);
    const current = ['task_a'];
    expect(withoutHomeProjectLinkedTask(current, 'task_zzz')).toBe(current);
  });
});
