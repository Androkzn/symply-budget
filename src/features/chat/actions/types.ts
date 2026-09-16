/**
 * The assistant's writes, as they arrive on the wire.
 *
 * Mirror of `backend/src/services/chat/house-assistant-actions.ts` — keep the
 * two in sync. The Worker composes these; this side parses and performs them.
 *
 * ## Parse leniently, refuse loudly
 *
 * Everything here comes off `metadata.actions` on an AI message, which is a
 * `Record<string, unknown>` the server never validated on the way out (the chat
 * core forwards the owning app's envelope opaquely — see `ChatAssistantToolReturn`).
 * So this module's job is to turn "some JSON" into "an action this app can
 * perform, or nothing at all".
 *
 * The asymmetry is deliberate: an action we cannot fully understand is DROPPED
 * rather than half-run. A partially-applied write to a household's project is
 * worse than a message that says something happened and did not — the member
 * can see the second and act on it, and cannot see the first.
 */

/** Every write the assistant can perform. Unknown kinds are dropped on parse. */
export const CHAT_ACTION_KINDS = [
  'add_material',
  'update_material',
  'remove_material',
  'add_budget_line',
  'update_budget_line',
  'add_phase',
  'add_blocker',
  'resolve_blocker',
  'add_task',
  'update_project',
] as const;

export type ChatActionKind = (typeof CHAT_ACTION_KINDS)[number];

/** Which existing row an update/remove targets. */
export interface ChatActionTarget {
  /** Short id prefix, as printed in the grounding brief. Preferred. */
  ref?: string;
  /** The row's name, when the model had no ref. Resolved case-insensitively. */
  name?: string;
}

export interface ChatAction {
  /** Unique within one message; paired with the message id as the dedupe key. */
  id: string;
  kind: ChatActionKind;
  project_id: string;
  /** Already in `homeProjectsApi`'s own input shape — passed through unchanged. */
  args: Record<string, unknown>;
  target?: ChatActionTarget;
  /** One line for the card: "Add 12 boxes of Herringbone Oak — $1,068". */
  summary: string;
  /** True when the member must tap before it runs. */
  confirm: boolean;
}

/** How one action ended up. Rendered on the card and, on failure, said out loud. */
export type ChatActionStatus = 'pending' | 'running' | 'applied' | 'failed' | 'declined';

export interface ChatActionOutcome {
  id: string;
  status: ChatActionStatus;
  /** Member-facing reason, set when `status` is `failed`. */
  error?: string;
}

const KINDS = new Set<string>(CHAT_ACTION_KINDS);

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** One raw entry → an action, or null when it is not one we can run. */
function parseAction(raw: unknown, index: number): ChatAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const kind = str(o.kind);
  if (!kind || !KINDS.has(kind)) return null;

  const projectId = str(o.project_id);
  if (!projectId) return null;

  const args = o.args && typeof o.args === 'object' ? (o.args as Record<string, unknown>) : {};

  let target: ChatActionTarget | undefined;
  if (o.target && typeof o.target === 'object') {
    const t = o.target as Record<string, unknown>;
    const ref = str(t.ref);
    const name = str(t.name);
    if (ref || name) target = { ...(ref ? { ref } : {}), ...(name ? { name } : {}) };
  }

  return {
    // Fall back to the index so an envelope missing its id is still dedupable
    // within its message rather than being dropped for a cosmetic field.
    id: str(o.id) ?? `action-${index}`,
    kind: kind as ChatActionKind,
    project_id: projectId,
    args,
    target,
    summary: str(o.summary) ?? kind.replace(/_/g, ' '),
    // Anything not explicitly false is treated as needing a tap. A malformed
    // envelope should stall, not auto-write.
    confirm: o.confirm !== false,
  };
}

/**
 * Read the actions off an AI message's metadata.
 *
 * Takes the metadata bag rather than the message so the chat feature does not
 * have to import its own `ChatMessage` type into a module House also uses from
 * a project screen.
 */
export function parseChatActions(metadata: Record<string, unknown> | null | undefined): ChatAction[] {
  const raw = metadata?.actions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, i) => parseAction(entry, i))
    .filter((a): a is ChatAction => a !== null);
}

/**
 * Whose device runs these. See `metadata.actor_user_id` on the server: every
 * member of the room receives the message, and exactly one of them applies it.
 */
export function chatActionActor(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  return str(metadata?.actor_user_id) ?? null;
}
