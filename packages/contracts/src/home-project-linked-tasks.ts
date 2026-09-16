/**
 * The link between a home project and its jobs.
 *
 * Stored as `home_projects.linked_task_ids` — a JSON array of `tasks.id`,
 * NULL when there are none (migration 0170). It replaced the `home_project_tasks`
 * join table, which carried no primary key and so could not be ledgered at all:
 * hazard S2 in the local-first plan, and the reason a local-first household
 * could not hold a project's own tasks until 0170.
 *
 * **This module is the single reader for both backends**, for the same reason
 * `home-project-access.ts` is: `home-projects-service.ts` (Worker/D1) and
 * `localHomeProjectsApi.ts` (device ledger) both go through it, so a malformed
 * column cannot mean "no tasks" on one backend and "throw" on the other.
 *
 * ## What a list on the parent costs, stated once
 *
 * Under the ledger's per-field LWW, two devices that link two DIFFERENT tasks
 * to the same project while offline converge on one device's array, and the
 * other link is lost. That is a link to re-make — the task itself is a separate,
 * keyed row and survives either way — which is the trade the plan accepted over
 * the two alternatives it rejected: a random surrogate id duplicates links
 * (S3b), and a deterministic one makes an unlinked task unlinkable forever
 * (S3a, the tombstone is absorbing).
 *
 * Sequential links union correctly, which is every link the Smart Project
 * wizard writes and every link one member makes on one device.
 */

/**
 * Capped because it is a column, not a table.
 *
 * 500 rather than the 120 a single Smart Project generation can produce: a
 * long-running renovation accumulates tasks across several drafts and by hand,
 * and the cap exists to bound the write, not to bound the project.
 */
export const HOME_PROJECT_MAX_LINKED_TASKS = 500;

/**
 * `linked_task_ids` → task ids, in stored order, deduplicated.
 *
 * Never throws and never returns null: a column that cannot be parsed is a
 * project with no linked tasks, which is what the screen rendered before the
 * column existed. Accepts the already-parsed array too, so a caller holding a
 * ledger row and a caller holding a D1 row can share it.
 */
export function parseHomeProjectLinkedTaskIds(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= HOME_PROJECT_MAX_LINKED_TASKS) break;
  }
  return out;
}

/**
 * Task ids → `linked_task_ids`. An empty list stores NULL rather than `'[]'`,
 * so a project nobody has linked a task to reads exactly as it did before this
 * column existed — the same call `serializeHomeProjectAccessGrants` makes.
 */
export function serializeHomeProjectLinkedTaskIds(
  taskIds: readonly string[],
): string | null {
  const deduped = parseHomeProjectLinkedTaskIds(taskIds);
  return deduped.length > 0 ? JSON.stringify(deduped) : null;
}

/**
 * Add one task id, preserving order and refusing a duplicate.
 *
 * **Returns the SAME array instance when there is nothing to change**, and that
 * is load-bearing rather than an optimisation: both `linkTask` implementations
 * decide whether to write at all by comparing `next !== current`. A fresh equal
 * array would turn every re-link into a D1 update or a ledger op plus a second
 * `task_linked` entry on the activity feed — which is exactly the duplicate the
 * join table's existence check used to prevent.
 *
 * `current` is expected to have come from `parseHomeProjectLinkedTaskIds`;
 * this does no re-parsing precisely so identity can hold.
 */
export function withHomeProjectLinkedTask(
  current: string[],
  taskId: string,
): string[] {
  const id = taskId.trim();
  if (!id || current.includes(id)) return current;
  if (current.length >= HOME_PROJECT_MAX_LINKED_TASKS) return current;
  return [...current, id];
}

/**
 * Drop one task id. Returns the same array instance when it was not linked,
 * for the same identity reason as `withHomeProjectLinkedTask`.
 */
export function withoutHomeProjectLinkedTask(
  current: string[],
  taskId: string,
): string[] {
  const id = taskId.trim();
  if (!id || !current.includes(id)) return current;
  return current.filter(entry => entry !== id);
}
