/**
 * Generative UI content blocks — client mirror of the backend's `ui-blocks.ts`.
 *
 * When a Aihousekeeper tool returns a `ui` field on its result, the chat client
 * renders the corresponding React component inline in the assistant's
 * bubble via `AssistantUIBlock`. Keep this file structurally in sync with
 * `backend/src/services/ai/tools/ui-blocks.ts`.
 */

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

export type UIAction =
  | { type: 'navigate'; screen: string; params?: Record<string, unknown> }
  | { type: 'deep_link'; url: string }
  | { type: 'send_message'; text: string };

export interface UIActionButton {
  label: string;
  action: UIAction;
  variant?: 'primary' | 'secondary' | 'destructive';
}

export type AssistantUIBlock =
  | {
      type: 'task_list';
      title?: string;
      tasks: TaskSummary[];
      total?: number;
      actions?: UIActionButton[];
    }
  | {
      type: 'task_card';
      task: TaskSummary;
      caption?: string;
      actions?: UIActionButton[];
    }
  | {
      type: 'action_row';
      actions: UIActionButton[];
    };

export type InvalidateTarget = 'tasks';

/**
 * Runtime guard — verifies an arbitrary value is a valid UI block. The
 * `ui` field on a tool result comes over the wire as `unknown`, so we
 * sanity-check it before passing to the renderer.
 */
export function isAssistantUIBlock(value: unknown): value is AssistantUIBlock {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { type?: unknown }).type;
  if (t === 'task_list') {
    const tasks = (value as { tasks?: unknown }).tasks;
    return Array.isArray(tasks);
  }
  if (t === 'task_card') {
    const task = (value as { task?: unknown }).task;
    return !!task && typeof task === 'object';
  }
  if (t === 'action_row') {
    const actions = (value as { actions?: unknown }).actions;
    return Array.isArray(actions);
  }
  return false;
}

export function isInvalidateTarget(value: unknown): value is InvalidateTarget {
  return value === 'tasks';
}
