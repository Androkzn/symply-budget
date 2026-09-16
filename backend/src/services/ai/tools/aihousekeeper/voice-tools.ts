/**
 * Aihousekeeper voice-control tools.
 *
 * These tools exist solely so Claude can communicate UI-level voice-session
 * intents back to the mobile client. They do NOT touch the WebRTC transport
 * themselves — the client inspects tool_results for `voice_mode_closed: true`
 * and tears down the OpenAI Realtime session. See `src/hooks/useVoiceMode.ts`.
 *
 * Without this, a user saying "close voice mode" gets a polite text reply
 * ("Voice mode is closed…") while the Listening UI stays stuck on screen,
 * because Claude has no way to signal the client to stop.
 */
import { z } from 'zod';

import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

export const closeVoiceMode: AihousekeeperTool = {
  name: 'close_voice_mode',
  kind: 'READ',
  description:
    'End the active voice-mode session when the user asks to close, exit, leave, end, stop, or turn off voice mode — or equivalent phrasings like "stop listening", "I\'m done talking", "that\'s all for voice". Call this instead of replying in text that you closed it; the client dismisses the voice UI when it sees this tool result. Only call when the user clearly wants to leave voice mode, not to stop a specific task.',
  input: z.object({}),
  async execute(_ctx: AihousekeeperToolContext, _input): Promise<ToolResult> {
    return { ok: true, voice_mode_closed: true };
  },
};

export const voiceTools: readonly AihousekeeperTool[] = [closeVoiceMode];
