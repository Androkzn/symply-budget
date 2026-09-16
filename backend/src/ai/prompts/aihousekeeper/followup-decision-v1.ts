/**
 * Aihousekeeper followup decision prompt — v1.
 *
 * When a scheduled followup fires (B7), Aihousekeeper decides whether to notify the
 * user or silently close the followup (e.g., context has since resolved).
 * Model: env.AIHOUSEKEEPER_NUDGE_MODEL (Haiku).
 *
 * Forced two-tool choice via `tool_choice: { type: 'any' }`. Retry-once on
 * malformed; default to silent_close(reason='malformed_decision') on second
 * failure.
 */

import type { GenerateToolDef } from '../../provider';

export const FOLLOWUP_DECISION_PROMPT_VERSION = 'aihousekeeper-followup-v1';

export const FOLLOWUP_SYSTEM_PROMPT = `You are Aihousekeeper deciding whether to follow up on a previously-scheduled reminder.

You will receive:
- The original followup prompt (what to remind about).
- Context recalled from household memory (facts, history, open questions).
- Recent relevant events since the followup was scheduled.

Decide ONE of:
- \`notify_user\` — send a short, warm push notification to the household. Use only when a nudge is genuinely useful right now.
- \`silent_close\` — close the followup without notifying. Use when the underlying need has resolved, become stale, or doesn't warrant an interruption.

Bias toward silent_close when in doubt; Aihousekeeper should not interrupt without purpose.`;

export const FOLLOWUP_TOOLS: GenerateToolDef[] = [
  {
    name: 'notify_user',
    description: 'Send a warm, brief push notification to the household.',
    input_schema: {
      type: 'object',
      required: ['message', 'rationale'],
      properties: {
        message: {
          type: 'string',
          description:
            'Push body. One short sentence in warm_brief tone. No greeting; no trailing questions.',
          maxLength: 160,
        },
        rationale: {
          type: 'string',
          description:
            'Short internal rationale for the trust ledger (e.g. "overdue task still unassigned").',
        },
      },
    },
  },
  {
    name: 'silent_close',
    description: 'Close the followup without notifying the household.',
    input_schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'string',
          description:
            'Short internal reason (e.g. "task_completed", "no_longer_relevant", "malformed_decision").',
        },
      },
    },
  },
];
