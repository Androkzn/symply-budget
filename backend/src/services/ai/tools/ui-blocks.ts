/**
 * Generative UI content blocks — shared protocol between tools and client.
 *
 * A tool that wants the chat client to render a real React component (card,
 * list, action buttons) rather than just narrate plain text returns a `ui`
 * field on its `ToolResult`:
 *
 *   return {
 *     ok: true,
 *     summary: '5 active tasks',              // ← what the LLM sees and narrates
 *     ui: { type: 'task_list', tasks: [...] }, // ← what the client renders
 *   };
 *
 * The mobile client (`AihousekeeperChatScreen`) scans `tool_results[].result.ui` for
 * any present block and renders it inline in the assistant's bubble via the
 * `AssistantUIBlock` dispatcher component. The LLM still sees the `ui` JSON
 * in the stringified tool_result, which is harmless for small payloads.
 *
 * To add a new block type:
 *   1. Add a variant to `AssistantUIBlock` below.
 *   2. Mirror the type in `src/types/aihousekeeperUiBlocks.ts` (mobile).
 *   3. Add a case in `src/components/aihousekeeper/AssistantUIBlock.tsx` (mobile).
 *
 * Block types must be serializable (no functions, no classes) — everything
 * flows through `JSON.stringify` on the way from the tool to the client.
 */

/** Compact task summary — intentionally a subset of TaskResponse. */
export interface TaskSummary {
  id: string;
  title: string;
  description: string | null;
  system_category: string | null;
  frequency: string;
  custom_interval_days: number | null;
  next_due_date: string | null;
  is_active: boolean;
  priority_severity?: string;
  assigned_to: { id: string; display_name: string | null } | null;
}

/** Action a button on a UI block can trigger on the client. */
export type UIAction =
  | { type: 'navigate'; screen: string; params?: Record<string, unknown> }
  | { type: 'deep_link'; url: string }
  | { type: 'send_message'; text: string };

export interface UIActionButton {
  label: string;
  action: UIAction;
  /** Optional visual hint. */
  variant?: 'primary' | 'secondary' | 'destructive';
}

/** Top-level UI block the tool result can carry. */
export type AssistantUIBlock =
  | {
      type: 'task_list';
      /** Optional heading shown above the list. */
      title?: string;
      tasks: TaskSummary[];
      /** Total matches when tasks is a paginated slice. */
      total?: number;
      /** Optional row of follow-up actions (e.g. "Create a task"). */
      actions?: UIActionButton[];
    }
  | {
      type: 'task_card';
      task: TaskSummary;
      /** Optional caption shown above the card (e.g. "Updated", "Completed", "Deleted"). */
      caption?: string;
      actions?: UIActionButton[];
    }
  | {
      type: 'action_row';
      actions: UIActionButton[];
    };

/**
 * Targets the client should refresh after a mutation. Tools include this on
 * their `ToolResult` so the chat screen knows to re-fetch the affected lists
 * (e.g. after a delete, the task list on the Tasks tab must update).
 */
export type InvalidateTarget = 'tasks';
