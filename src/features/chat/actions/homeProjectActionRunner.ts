/**
 * Where the assistant's writes actually happen.
 *
 * ## The whole point of this file is that it is boring
 *
 * Every branch below is one `homeProjectsApi` call — the same call the project
 * hub makes when a member taps the same thing. There is no second validation
 * layer, no chat-specific endpoint, no "AI adds a material" service. That is
 * the design, not an omission:
 *
 *  - `homeProjectsApi` is a `createHouseLocalProxy`. It routes to the on-device
 *    encrypted ledger for a local-first household and to the Worker for a
 *    server-backed one. Going through it is the only way an assistant write
 *    works for BOTH, and the Worker could not have done it for the first.
 *  - Everything downstream — budget-line derivation from a priced selection,
 *    the rollups the hub header shows, the activity feed entry, the sync
 *    envelope — hangs off these methods. A material added here is
 *    indistinguishable from a material added by hand, because it IS one.
 *
 * So the interesting code here is not the writes. It is {@link resolveRow}.
 *
 * ## Resolving what the model was pointing at
 *
 * The grounding brief gives the model a short `ref` per addressable row (the
 * first six characters of its id — see `projectChatContext`). The model hands
 * one back. This resolves it against the hub, and falls back to a name match
 * when the model paraphrased instead of quoting.
 *
 * It refuses on ambiguity rather than guessing. Two materials whose names both
 * contain "oak" is a question for the member, and picking the first one is how
 * an assistant quietly edits the wrong row — the failure mode with no error
 * message and no obvious moment of discovery.
 */
import { homeProjectsApi } from '@api/home-projects';
import type { HomeProjectHub } from '@api/home-projects';

import type { ChatAction, ChatActionTarget } from './types';

/** A row addressable by ref or name. */
interface Addressable {
  id: string;
  label: string;
}

/** Raised for anything the member should be told about in plain words. */
export class ChatActionError extends Error {}

/**
 * Find the row an action targets.
 *
 * Ref first (exact prefix), then an exact name match, then a unique
 * case-insensitive substring. Anything ambiguous or absent throws with a
 * sentence the card can show.
 */
export function resolveRow(
  rows: Addressable[],
  target: ChatActionTarget | undefined,
  noun: string
): Addressable {
  if (!target) throw new ChatActionError(`I could not tell which ${noun} that meant.`);

  if (target.ref) {
    const byRef = rows.filter((r) => r.id.startsWith(target.ref!));
    if (byRef.length === 1) return byRef[0];
    // A ref that matches nothing usually means the row was deleted or renamed
    // since the brief was written; fall through to the name so a stale ref with
    // a good name still lands.
    if (byRef.length > 1) {
      throw new ChatActionError(`More than one ${noun} matches that reference.`);
    }
  }

  const name = target.name?.trim().toLowerCase();
  if (!name) {
    throw new ChatActionError(
      `I could not find that ${noun} any more — it may have been changed or removed.`
    );
  }

  const exact = rows.filter((r) => r.label.trim().toLowerCase() === name);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new ChatActionError(`There is more than one ${noun} called “${target.name}”.`);
  }

  const partial = rows.filter((r) => r.label.toLowerCase().includes(name));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new ChatActionError(
      `“${target.name}” matches ${partial.length} ${noun}s — say which one.`
    );
  }

  throw new ChatActionError(`There is no ${noun} called “${target.name}” on this project.`);
}

/**
 * The hub, fetched at most once per apply pass.
 *
 * Only the kinds that address an existing row need it, so a lone `add_material`
 * — much the commonest case — costs no extra read. The thunk is shared across
 * every action in one message so a reply carrying three updates fetches once.
 */
function hubLoader(householdId: string, projectId: string): () => Promise<HomeProjectHub> {
  let pending: Promise<HomeProjectHub> | null = null;
  return () => {
    pending ??= homeProjectsApi.getHub(householdId, projectId);
    return pending;
  };
}

/** Selections/blockers/budget-lines reduced to the shape {@link resolveRow} wants. */
function addressable<T extends { id: string }>(rows: T[], label: (row: T) => string): Addressable[] {
  return rows.map((row) => ({ id: row.id, label: label(row) }));
}

/**
 * Perform one action.
 *
 * Throws {@link ChatActionError} for anything the member caused (a row that no
 * longer exists, an ambiguous name) and lets a transport error through as
 * itself — the caller renders the first verbatim and the second as "couldn't
 * reach the server".
 */
async function runOne(
  householdId: string,
  action: ChatAction,
  loadHub: () => Promise<HomeProjectHub>
): Promise<void> {
  const projectId = action.project_id;
  const args = action.args;

  switch (action.kind) {
    case 'add_material':
      await homeProjectsApi.createSelection(householdId, projectId, args as never);
      return;

    case 'update_material': {
      const hub = await loadHub();
      const row = resolveRow(
        addressable(hub.selections, (s) => s.name),
        action.target,
        'material'
      );
      await homeProjectsApi.updateSelection(householdId, projectId, row.id, args as never);
      return;
    }

    case 'remove_material': {
      const hub = await loadHub();
      const row = resolveRow(
        addressable(hub.selections, (s) => s.name),
        action.target,
        'material'
      );
      await homeProjectsApi.deleteSelection(householdId, projectId, row.id);
      return;
    }

    case 'add_budget_line':
      await homeProjectsApi.createBudgetLine(householdId, projectId, args as never);
      return;

    case 'update_budget_line': {
      const hub = await loadHub();
      const row = resolveRow(
        addressable(hub.budget_lines, (l) => l.label),
        action.target,
        'budget line'
      );
      await homeProjectsApi.updateBudgetLine(householdId, projectId, row.id, args as never);
      return;
    }

    case 'add_phase':
      await homeProjectsApi.createPhase(householdId, projectId, args as never);
      return;

    case 'add_blocker':
      await homeProjectsApi.createBlocker(householdId, projectId, args as never);
      return;

    case 'resolve_blocker': {
      const hub = await loadHub();
      const row = resolveRow(
        addressable(hub.blockers, (b) => b.title),
        action.target,
        'blocker'
      );
      await homeProjectsApi.updateBlocker(householdId, projectId, row.id, args as never);
      return;
    }

    case 'add_task':
      await homeProjectsApi.createTask(householdId, projectId, args as never);
      return;

    case 'update_project':
      await homeProjectsApi.update(householdId, projectId, args as never);
      return;
  }
}

/** What one action did, for the card and for the note posted back into the chat. */
export interface ChatActionResult {
  id: string;
  ok: boolean;
  /** Set when `ok` is false — already phrased for a member to read. */
  error?: string;
}

/**
 * Run a message's actions in order.
 *
 * Sequential rather than parallel, and deliberately so: two writes to the same
 * project race on the ledger's version counters, and a member reading the
 * activity feed afterwards should see them in the order the assistant said
 * them. A failure does not stop the rest — three materials asked for in one
 * sentence should not all be lost because the second has a bad price.
 */
export async function runChatActions(
  householdId: string,
  actions: ChatAction[]
): Promise<ChatActionResult[]> {
  const results: ChatActionResult[] = [];
  // One loader per project touched — a reply's actions are nearly always all
  // for the same project, but a Map costs nothing and keeps the guarantee.
  const loaders = new Map<string, () => Promise<HomeProjectHub>>();

  for (const action of actions) {
    let loader = loaders.get(action.project_id);
    if (!loader) {
      loader = hubLoader(householdId, action.project_id);
      loaders.set(action.project_id, loader);
    }

    try {
      await runOne(householdId, action, loader);
      results.push({ id: action.id, ok: true });
    } catch (error) {
      console.error(`[chat-actions] ${action.kind} failed:`, error);
      results.push({
        id: action.id,
        ok: false,
        error:
          error instanceof ChatActionError
            ? error.message
            : "That didn't save — check your connection and try again.",
      });
    }
  }

  return results;
}
