/**
 * `HOUSE_CHAT_ASSISTANT` — the House chat's {@link ChatAssistantCapability}.
 *
 * House shipped without one. `HOUSE_CHAT_CONFIG` had an `assistantPrompt` and
 * nothing else, so the model was handed a transcript and no verbs: every
 * request to DO something ("add the oak flooring", "find me someone for the
 * mold") could only come back as a question, because answering was the only
 * move available to it. This file is the missing half.
 *
 * It composes two modules that are deliberately kept apart, because they run in
 * different places for different reasons:
 *
 * | Half | Where it runs | Why |
 * |---|---|---|
 * | {@link ./house-assistant-actions} — the writes | **On the client**, through `homeProjectsApi` | A home project is Tier A. The Worker cannot read a local-first household's rows, so it must not pretend to write them. The tool returns an envelope; the device performs the same call the member's own tap performs |
 * | {@link ./house-assistant-research} — web + local pros | **On the Worker** | Nothing here touches a household row, and the API keys live here |
 *
 * ## Which tools a room gets
 *
 * Only a project-scoped room gets the write tools, resolved from the room's
 * subject. The household's general chat and the dedicated AI room have no
 * project to write to; offering `add_material` there would teach the model to
 * call a tool whose only possible reply is "there is nothing to add this to".
 * The research tools are offered everywhere — "what does a permit cost here" is
 * a fair question in any room.
 */
import type { GenerateToolDef } from '../../ai/provider';

import type {
  ChatAssistantCapability,
  ChatAssistantToolContext,
  ChatAssistantToolReturn,
} from './chat-room-service-core';
import {
  buildHouseAction,
  houseActionTools,
  isHouseActionTool,
  resolveActionSubject,
} from './house-assistant-actions';
import { RESEARCH_TOOLS, isResearchTool, runResearchTool } from './house-assistant-research';

/**
 * A per-turn counter for action ids.
 *
 * The id only has to be unique WITHIN one AI message (it is the client's dedupe
 * key, scoped by message id), and a reply is built in one pass, so a counter
 * keyed on the room is enough and needs no storage. It is reset each turn by
 * `tools()` being called first — see the assignment in `runTool`.
 */
const seqByRoom = new Map<string, number>();

function nextSeq(roomId: string): number {
  const next = (seqByRoom.get(roomId) ?? 0) + 1;
  seqByRoom.set(roomId, next);
  // A Worker isolate is short-lived, but a hot one serving a busy household
  // should not grow this map without bound.
  if (seqByRoom.size > 200) seqByRoom.clear();
  return next;
}

export const HOUSE_CHAT_ASSISTANT: ChatAssistantCapability = {
  /**
   * A photo dropped in a project chat is nearly always a question about the
   * project — the wet patch behind the shed wall, the shelf tag of the flooring
   * they are standing in front of. Making the member also type "@assistant"
   * before it is looked at is the wrong default here for the same reason it was
   * wrong in Budget.
   */
  triggerOnImageAttachment: true,

  tools(ctx: ChatAssistantToolContext): GenerateToolDef[] {
    return [...houseActionTools(resolveActionSubject(ctx.subject)), ...RESEARCH_TOOLS];
  },

  async runTool(
    ctx: ChatAssistantToolContext,
    call: { name: string; input: Record<string, unknown> }
  ): Promise<ChatAssistantToolReturn> {
    if (isResearchTool(call.name)) return runResearchTool(ctx, call);

    if (isHouseActionTool(call.name)) {
      const { result, action } = buildHouseAction(
        resolveActionSubject(ctx.subject),
        call,
        nextSeq(ctx.roomId)
      );
      return action ? { result, actions: [action] } : result;
    }

    return `Unknown action “${call.name}”.`;
  },
};
