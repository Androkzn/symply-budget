/**
 * Chat history control tools.
 *
 * Aihousekeeper chat history is stored client-side (src/stores/aihousekeeperStore.ts) — there
 * is no server-side table. These tools signal the mobile client via the tool
 * result payload; the client inspects `chat_history_cleared` / `chat_history_export`
 * and performs the action locally. Same pattern as `close_voice_mode`.
 */
import { z } from 'zod';

import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

export const clearChatHistory: AihousekeeperTool = {
  name: 'clear_chat_history',
  kind: 'LOW_WRITE',
  description:
    'Clear the on-device conversation history with Aihousekeeper/Mira when the user asks to clear, delete, reset, wipe, or start over the chat/conversation (e.g. "clear chat history", "delete our conversation", "start fresh", "reset"). Only the local chat transcript is removed — memories, tasks, and reminders are NOT touched. The client inspects this tool_result and clears its local store; do not also reply with "I cleared it" in text.',
  input: z.object({
    confirm: z
      .boolean()
      .optional()
      .describe('Set true once the user has confirmed. Omit to just acknowledge intent.'),
  }),
  async execute(_ctx: AihousekeeperToolContext, _input): Promise<ToolResult> {
    return {
      ok: true,
      chat_history_cleared: true,
      message:
        'Chat history cleared on this device. Memories, tasks, and reminders are unchanged.',
    };
  },
};

export const exportChatHistory: AihousekeeperTool = {
  name: 'export_chat_history',
  kind: 'READ',
  description:
    'Signal the client to export the on-device chat history to a share sheet / email / file. Use when the user asks to save, download, export, or share their conversation.',
  input: z.object({
    format: z.enum(['text', 'json']).optional(),
  }),
  async execute(_ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    return {
      ok: true,
      chat_history_export: true,
      format: input.format ?? 'text',
    };
  },
};

export const chatHistoryTools: readonly AihousekeeperTool[] = [
  clearChatHistory,
  exportChatHistory,
] as const;
