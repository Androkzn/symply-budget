/**
 * Aihousekeeper chat endpoint — plan §C6 + §4.
 *
 * Surface the user's natural-language interactions with Aihousekeeper. Client holds
 * the message history and re-posts it each turn (stateless server side; no
 * `ai_chat_sessions` table required — that's v1.2 territory).
 *
 *   POST /households/:householdId/aihousekeeper/chat
 *     body:    { mode: ChatMode, messages: GenerateMessage[] }
 *     returns: {
 *       response: { role: 'assistant', content: Array<text|tool_use> },
 *       tool_results: Array<{ tool_use_id, name, result, parked? }>,
 *       model: string,
 *       stop_reason: 'end_turn' | 'tool_use' | 'max_tokens'
 *     }
 *
 * Handler flow:
 *   1. Verify household membership.
 *   2. Build memory prefix via MemoryPrefixBuilder (injects PII-redacted
 *      `<aihousekeeper_memory>` into the last user message).
 *   3. Assemble tools available to the requested chat_mode via
 *      buildToolRegistry(env).list(mode).
 *   4. Convert each tool's zod input → JSON Schema for Claude.
 *   5. Bounded tool-use loop (max 5 iterations):
 *        - Call provider.generate(...)
 *        - If stop_reason==='tool_use': execute each tool_use block via
 *          the tool's execute() method, append tool_result blocks, loop.
 *        - If stop_reason==='end_turn': return the final assistant turn.
 *   6. LOW_WRITE / READ tools execute inline; HIGH_WRITE tools park via
 *      ApprovalQueueShim — the tool_result payload includes the pending_id
 *      so the client can surface the approval card.
 *
 * Model selection: AIHOUSEKEEPER_NUDGE_MODEL (Haiku-4.5) for speed. Briefings use
 * AIHOUSEKEEPER_BRIEFING_MODEL (Sonnet-4.6) via BriefingComposer — different path.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { generateWithFallback } from '../ai/fallback';
import type {
  AIProvider,
  GenerateMessage,
  GenerateToolDef,
} from '../ai/provider';
import { createProviderAdapter } from '../ai/provider-factory';
import { authMiddleware } from '../middleware/auth';
import { rateLimitDO } from '../middleware/rate-limit';
import { MemoryPrefixBuilder } from '../services/ai/context/memory-prefix-builder';
import {
  getAssistantIdentityForChat,
  loadChatAttachments,
} from '../services/aihousekeeper/route-service';
import {
  buildToolRegistry,
  CHAT_MODES,
  type AihousekeeperTool,
  type AihousekeeperToolContext,
  type ChatMode,
  type ToolResult,
} from '../services/ai/tools';
import { zodToJsonSchema } from '../services/ai/zod-to-json-schema';
import { resolveProviderApiKey } from '../services/ai-credential-resolver';
import { usageRecorderFor } from '../services/ai-usage-service';
import { buildAihousekeeperChatToolContext } from '../services/aihousekeeper/chat-context';
import { assertCanUseAI } from '../services/entitlement-service';
import { HouseholdService } from '../services/household-service';
import type { Env } from '../types';
import { ValidationError } from '../utils/errors';

const MAX_TOOL_LOOP_ITERATIONS = 5;

const chatRequestSchema = z.object({
  mode: z.enum(CHAT_MODES as unknown as [ChatMode, ...ChatMode[]]),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.union([
        z.string(),
        z.array(
          z.union([
            z.object({ type: z.literal('text'), text: z.string() }),
            z.object({
              type: z.literal('tool_use'),
              id: z.string(),
              name: z.string(),
              input: z.unknown(),
            }),
            z.object({
              type: z.literal('tool_result'),
              tool_use_id: z.string(),
              content: z.string(),
            }),
          ])
        ),
      ]),
    })
  ),
  /**
   * Optional list of `aihousekeeper_attachments.id` values the user attached to the
   * latest turn. Server verifies ownership + status='uploaded' before
   * surfacing them to Aihousekeeper via an <attachments> block in the user message.
   */
  attachment_ids: z.array(z.string()).max(10).optional(),
});

const aihousekeeperChat = new Hono<{ Bindings: Env }>();

aihousekeeperChat.use('/*', authMiddleware());

/**
 * Format today's date in the household's IANA timezone so Claude can answer
 * "set it to today" / "what's due this week" without asking. Falls back to
 * UTC on any bad/unknown zone — Intl.DateTimeFormat throws on junk strings.
 *
 * Returns both the ISO-style date ("2026-04-24") and a human label
 * ("Friday, April 24, 2026") so the model can echo whichever fits.
 */
function formatTodayContext(timezone: string): {
  iso: string;
  human: string;
  zone: string;
} {
  const now = new Date();
  let zone = timezone || 'UTC';
  let iso: string;
  let human: string;
  try {
    // en-CA emits YYYY-MM-DD natively, which is what task/due-date inputs expect.
    iso = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    human = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now);
  } catch {
    zone = 'UTC';
    iso = now.toISOString().slice(0, 10);
    human = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now);
  }
  return { iso, human, zone };
}

/**
 * Mode-specific system prompt. Kept short — Aihousekeeper's persona comes from
 * assistant_identity + memory prefix injected at turn time.
 */
function systemPromptForMode(
  mode: ChatMode,
  today: { iso: string; human: string; zone: string },
  assistantName: string
): string {
  const dateHeader =
    `Today is ${today.human} (${today.iso}) in the household's timezone (${today.zone}). ` +
    'Use this to resolve relative dates like "today", "tomorrow", "this weekend", "next Monday" — never ask the user what today\'s date is. ' +
    'Pass due dates to tools as ISO YYYY-MM-DD strings. ';
  // The mobile client renders replies as plain text; markdown syntax shows up
  // as literal characters (**bold** displays asterisks). Plain text only.
  const base =
    dateHeader +
    `You are ${assistantName}, a warm-but-brief household assistant. Use tools when the user asks you to do something concrete (add a task, remember a fact, schedule, assign, send, look up). When the user asks you to add, remember, buy, fix, schedule, or track something that is clearly a to-do / chore / errand / repair / maintenance item, call create_maintenance_task — do NOT store those as memory notes. Memory is for facts and preferences, not to-dos. When the user asks to see, list, or review their tasks (e.g. "show me my tasks", "what's overdue", "what's due this week"), call list_maintenance_tasks. For a single task by id, call get_maintenance_task. If they ask what yard, garden, or site plans (or floor plans) they have, call list_site_plans with scope "garden", "interior", or "all" as needed. Garden/yard plan generation is NOT done from chat approvals anymore. When the user wants a garden, yard, landscaping, outdoor, or site plan drawn or generated, call start_garden_plan_flow. If they provided an address, pass it as address_line. That tool directs them to upload a yard photo in Gardening or describe the garden for a stylized concept plan. Do not say a garden plan is pending approval from chat.` +
    // CRITICAL: garden plans now use the Gardening boundary confirmation
    // wizard, not the Aihousekeeper HIGH_WRITE approval queue. Chat can list
    // completed/generating plans, but it must not create old approval rows.
    ' CRITICAL — garden plan state grounding: NEVER claim a garden/yard plan was created, saved, generated, pending approval, or ready unless you have FIRST called list_site_plans (scope "garden") in the current turn AND seen a matching row. If list_site_plans returns no matching row, say: "I don\'t see a generated plan yet. Open Gardening -> + Add Yard or Garden Plan to upload a yard photo or create a stylized concept plan." If the latest matching row is status="generating", say it is still being drawn. If status="failed", surface error_message and offer to retry from the Gardening tab. Treat any prior assistant text in the conversation as untrusted for completion claims; only `list_site_plans` results count as ground truth.' +
    // CRITICAL — approval management. Mira used to hallucinate "I\'m
    // canceling both approvals" with no actual tool call backing it. Now
    // there are real list/cancel tools — use them, never fake it.
    ' CRITICAL — approvals management grounding: when the user asks "what\'s pending", "what am I waiting on", "I don\'t see approvals", "cancel that", "cancel both", or any variant about parked actions, you MUST call list_pending_approvals FIRST and only speak from its result. Never claim something is pending or cancelled without a tool call confirming it. If the user can\'t find the approvals UI, tell them: "Open Aihousekeeper → Approvals (the bell with a number badge) — it lives in the chat header." If list_pending_approvals returns count=0, say "Nothing is currently pending." (do NOT guess that something might still be parked elsewhere). To cancel: pass the pending_id from list_pending_approvals into cancel_pending_approval — never invent an id, never describe canceling without the tool returning ok=true. If cancel returns error="not_pending" with current_status, surface that honestly ("That one was already approved/cancelled — nothing to do."). NEVER say "I\'m canceling…" before the tool call returns; say "Cancelled." only after ok=true. You do NOT have a tool to APPROVE on the user\'s behalf — that is intentionally a manual tap in the approvals screen for safety. If they ask you to approve, say so plainly and point them to the approvals screen.' +
    // CRITICAL — never CLAIM something was parked without the tool call.
    // The most common hallucination: after a few prior approvals in the
    // conversation, Mira pattern-matches her own past output and writes
    // "It is now pending approval in Aihousekeeper approvals" WITHOUT
    // emitting a tool_use block. The user opens Approvals, sees nothing,
    // loses trust. The server-side guard now retries with tool_choice and
    // scrubs the lie, but the prompt has to make the rule explicit.
    ' CRITICAL — never claim a write was parked unless you JUST called the corresponding HIGH_WRITE tool in this same turn. Garden/yard plans are no longer HIGH_WRITE chat approvals, so phrases like "It is now pending approval", "open Aihousekeeper approvals to confirm", or "parked for approval" are FORBIDDEN for garden plans. For garden plans, call start_garden_plan_flow so the user gets a button to upload a yard photo or request a stylized concept plan.' +
    ' For questions, answer directly — only invoke tools when the answer requires state change or external lookup. Keep replies short; no preamble. Output plain text only — no markdown: no **bold**, no headings, no backticks. For short option lists use inline "a, b, or c" or plain dashes (- a). When a tool result includes a `ui` field (task_list, task_card, action_row), the client already renders it as a real UI card — DO NOT re-list every task in text. Reply with one short sentence introducing the result (e.g. "Here are your 5 active tasks.") and let the UI speak for itself.' +
    // Attachment routing — floor_plan question ladder + duplicate flow.
    ' When routing a floor_plan attachment via classify_and_save_attachment: (1) For indoor home plans, include metadata.floor_label and ask "What floor is this — main, basement, upper?". Note: yard/garden/bed outdoor plans are added separately in the Gardening tab, not via this tool — tell the user to open the Gardening tab if they send a yard photo meant as a site plan. (2) If the household already has plans under more than one building name, ask which area/building. (3) If the image shows multiple floors on one page, ask whether to file as one plan with a combined label or one per floor; if unsure, default to one combined plan. (4) if the tool returns error "duplicate_detected", use the hint and ask "attach anyway?" before retrying with metadata.allow_duplicate=true. Reference attachments by index from <attachments> only, never by internal id.' +
    // Task creation ladder — ask the minimum, never more than two in a row.
    ' When creating a maintenance task via create_maintenance_task, follow this question ladder and ASK ONLY THE MINIMUM (never more than two clarifying questions in a row): (a) frequency if ambiguous ("change filter" → ask "every month?"); (b) next_due_date if frequency is "one_time" and no date is mentioned; (c) space_id if the household has rooms defined AND the title does not obviously match one; (d) priority_severity = "high" or "urgent" ONLY if the user uses risk words (leak, spark, gas, smoke, mold); (e) assigned_to if the household has more than one member AND the request implies assignment ("remind Sarah to…"); (f) needs_contractor + contractor_category if the category is plumbing, electrical, HVAC, or roofing. Never ask about system_category (infer it), why_important or neglect_consequences (you fill them based on your own knowledge), or reminder settings (use defaults). For garden or yard work (mowing, beds, trees, hedges, mulch, plant care, most fence or lawn jobs), set system_category to "landscaping"; for sprinklers, drip, irrigation blowout, or automated watering, use "landscaping" or "irrigation" as best fit. For plant or leaf issues from a photo, give practical possibilities and what to check next, and say serious or edible-crop issues may need a local nursery, extension office, or certified arborist (you are not giving a medical diagnosis for plants).' +
    // NEVER ask the user for an internal id — they don't know them.
    ' CRITICAL: Users NEVER know internal ids (task_id, attachment_id, etc.) — never ask for one. When the user references a task by its title or a fuzzy description ("change the buy water task", "mark the roof one done", "delete grocery task"), YOU are responsible for resolving the id: first call list_maintenance_tasks to get current tasks, pick the best title match yourself, then call the mutating tool (update_maintenance_task / complete_maintenance_task / delete_maintenance_task / snooze_maintenance_task / reschedule_maintenance_task) with the found id. If multiple tasks match the reference equally well, ask the user to pick between the candidate titles, never the ids. If no task matches, say so and offer to create a new one.' +
    // Voice mode control — the client dismisses the Listening UI only when it
    // sees a close_voice_mode tool_result. Saying "voice mode is closed" in
    // text alone leaves the mic panel stuck on screen.
    ' When the user asks to close, exit, leave, end, stop, or turn off voice mode (or says "stop listening", "I\'m done talking", "that\'s all for voice"), you MUST call close_voice_mode — do not just reply in text that it\'s closed. Keep any spoken reply short (e.g. "Okay, closing voice.").' +
    // Chat history — client-side only; tool signals the mobile store to clear.
    ' When the user asks to clear, delete, reset, wipe, or start over the chat/conversation/teamchat history, call clear_chat_history — do not reply "I don\'t have a way to do that". Memories, tasks, and reminders are preserved; only the on-device transcript is wiped. When the user asks to save, download, share, or export the chat, call export_chat_history.' +
    // Notes vs memory — steer the model toward the right tool.
    ' Distinguish memory vs notes: use remember for short structured facts/preferences about people or patterns ("Sarah is allergic to pollen"); use create_household_note for free-form shared info the family wants recalled verbatim (door codes, wifi passwords, sticky reminders). List notes with list_household_notes.' +
    // Reminders, settings, spaces, members, subscription, notification prefs, reports.
    ' Other capabilities: to turn reminders on/off or adjust timing on a task, use list_task_reminders + update_task_reminder. To invite, list, or remove household members, use list_household_members, list_pending_invitations, invite_household_member (parks for approval), cancel_household_invitation, remove_household_member. For saved homes/properties: use list_household_properties to resolve which property the user means, create_household_property to add one, update_household_property to edit any saved property, get_household_details/update_household_details for the current property, and delete_household_property to remove one (parks for approval). To list or create rooms/zones, use list_spaces + create_space / update_space / delete_space. For subscription or AI access questions, use get_subscription. If the user asks to cancel, reactivate, or manage billing, use open_manage_subscription — never claim you can cancel App Store subscriptions; Apple Settings owns billing. For per-category notification toggles ("turn off weekly summary", "set quiet hours 22:00-07:00"), use get_notification_preferences + update_notification_preferences. For inspection reports on file, use list_reports + get_report.';
  const modeHint: Record<ChatMode, string> = {
    task_assistant:
      ' The current mode is task_assistant — focus on the user\'s maintenance tasks, assignments, and followups. Default to creating tasks (create_maintenance_task) rather than memory notes when the user mentions something to do, buy, fix, or schedule.',
    report_assistant:
      ' The current mode is report_assistant — help the user understand inspection report findings.',
    family_chat:
      ' The current mode is family_chat — coordinate household members, assignments, calendar.',
    contractor_context:
      ' The current mode is contractor_context — help the user communicate with contractors.',
    morning_briefing:
      ' The current mode is morning_briefing — short answers contextualizing today\'s briefing.',
  };
  return base + modeHint[mode];
}

/**
 * Build the full AihousekeeperToolContext needed by tool.execute().
 */
async function buildToolContext(
  c: { env: Env },
  householdId: string,
  userId: string,
  householdService: HouseholdService
): Promise<AihousekeeperToolContext> {
  return buildAihousekeeperChatToolContext(c.env, householdId, userId, householdService);
}

function toolsToAnthropicFormat(tools: readonly AihousekeeperTool[]): GenerateToolDef[] {
  return tools.map((t) => {
    const schema = zodToJsonSchema(t.input) as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    // Defensive: Anthropic's tool input_schema MUST have `type: "object"` at
    // the top level. Any zod shape that our minimal converter doesn't
    // recognize (e.g. a future `.pipe()` or `.brand()`) would fall through
    // to `{ type: "string" }` and make the whole /aihousekeeper/chat request 400
    // with "tools.N.custom.input_schema.type: Input should be 'object'".
    // Wrap the non-conforming tool in an empty object schema so one bad
    // tool can never break the whole chat; the tool just won't receive
    // arguments until its schema is fixed. Also logs for ops visibility.
    const input_schema =
      schema.type === 'object'
        ? schema
        : (() => {
            console.warn(
              '[aihousekeeper-chat] tool input_schema is not type:object — wrapping',
              { tool: t.name, actualType: schema.type }
            );
            return { type: 'object', properties: {} };
          })();
    return {
      name: t.name,
      description: t.description,
      input_schema,
    };
  });
}

function findTool(
  tools: readonly AihousekeeperTool[],
  name: string
): AihousekeeperTool | undefined {
  return tools.find((t) => t.name === name);
}

interface ExecutedToolRecord {
  tool_use_id: string;
  name: string;
  result: ToolResult;
}

aihousekeeperChat.post(
  '/',
  rateLimitDO('aihousekeeper:default'),
  zValidator('json', chatRequestSchema),
  async (c) => {
    const householdId = c.req.param('householdId');
    if (!householdId) {
      throw new ValidationError({ householdId: ['missing householdId'] });
    }
    const userId = c.get('userId');
    await assertCanUseAI(userId, c.env);
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.getHousehold(householdId, userId);

    const {
      mode,
      messages: clientMessages,
      attachment_ids: attachmentIds,
    } = c.req.valid('json');

    const registry = buildToolRegistry(c.env);
    const tools = registry.list(mode);
    const toolDefs = toolsToAnthropicFormat(tools);
    const ctx = await buildToolContext(c, householdId, userId, householdService);

    // Resolve attachments — only include those owned by this household + user
    // and already uploaded. Anything else is silently dropped (bad id, wrong
    // household, still pending upload).
    let attachmentBlock = '';
    // For image attachments we also pass the raw bytes to Claude as image
    // content blocks so it can actually SEE the photo (not just the filename).
    // Non-vision mimes (HEIC) are skipped — caller should have converted.
    const imageBlocks: Array<{
      type: 'image';
      source: {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      };
    }> = [];
    if (attachmentIds && attachmentIds.length > 0) {
      const rows = await loadChatAttachments(c.env.DB, householdId, userId, attachmentIds);
      const uploaded = rows.filter(
        (r) => r.status === 'uploaded' || r.status === 'classified' || r.status === 'routed'
      );
      if (uploaded.length > 0) {
        // Positional index only — never expose the real UUID to the model.
        // Tools receive `attachment_index: number` and resolve it via
        // ctx.attachmentOrder (set below). Any tool-failure retry the model
        // does will re-use the index, not parrot an internal UUID back at
        // the user.
        ctx.attachmentOrder = uploaded.map((r) => r.id);
        const lines = uploaded.map(
          (r, idx) =>
            `  <attachment index="${idx}" file="${r.file_name}" mime="${r.mime_type}"${
              r.kind_hint ? ` hint="${r.kind_hint}"` : ''
            }${r.kind ? ` kind="${r.kind}"` : ''} />`
        );

        // Claude vision supports jpeg/png/gif/webp. HEIC/HEIF + generic image/*
        // that isn't in the list are skipped — the metadata line still goes
        // through so Aihousekeeper knows the file exists.
        const VISION_MIMES = new Set([
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
        ]);
        const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // keep well under 5MB API cap

        for (const r of uploaded) {
          if (!VISION_MIMES.has(r.mime_type)) continue;
          try {
            const obj = await c.env.REPORTS_BUCKET.get(r.r2_key);
            if (!obj) continue;
            const bytes = await obj.arrayBuffer();
            if (bytes.byteLength > MAX_IMAGE_BYTES) {
              console.warn('[aihousekeeper-chat] skipping image — too large for vision', {
                id: r.id,
                bytes: bytes.byteLength,
              });
              continue;
            }
            // Base64-encode for the Anthropic API.
            let binary = '';
            const view = new Uint8Array(bytes);
            for (let i = 0; i < view.length; i++) {
              binary += String.fromCharCode(view[i]);
            }
            const data = btoa(binary);
            imageBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type:
                  r.mime_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data,
              },
            });
          } catch (err) {
            console.warn('[aihousekeeper-chat] failed to load image bytes', {
              id: r.id,
              error: (err as Error).message,
            });
          }
        }

        const imageGuidance =
          imageBlocks.length > 0
            ? ' In one short sentence, say what you see in the attached image(s), ' +
              'then ask what they would like to do (e.g. file as a receipt, add to a ' +
              'task, identify a home issue, or discuss plants or yard). If it looks like ' +
              'plants, leaves, grass, or outdoor damage, you may offer brief non-diagnostic ' +
              'care ideas and when to call a pro. Keep it friendly and under ~45 words.'
            : '';
        attachmentBlock =
          `\n<attachments>\n${lines.join('\n')}\n</attachments>\n` +
          'The user attached the above files. If they appear to be a report, ' +
          'floor plan, receipt, or quote, ask a brief clarifying question so ' +
          'you can route them to the correct place.' +
          imageGuidance;
      }
    }

    // Inject memory prefix into the last user message — PII-redacted by
    // MemoryPrefixBuilder. Skip if the last message is not from the user.
    const { apiKey: anthropicKey } = await resolveProviderApiKey(c.env, userId, 'anthropic');
    const provider = createProviderAdapter({
      provider: 'anthropic',
      apiKey: anthropicKey,
      options: {
      onUsage: usageRecorderFor(c.env, {
        feature: 'aihousekeeper_chat',
        householdId,
        userId,
      }),
    },
    });
    const prefixBuilder = new MemoryPrefixBuilder(
      ctx.memory,
      provider,
      c.env
    );
    // Defensive: Anthropic 400s if any user/assistant turn has empty content.
    // Older client builds can send image-only user turns with content: '' —
    // sanitize before hand-off so the whole conversation doesn't fail.
    const sanitized: GenerateMessage[] = clientMessages.map((m) => {
      let content = m.content;
      if (typeof content === 'string') {
        if (content.trim().length === 0) {
          content = m.role === 'user' ? '(image attached)' : '(no reply)';
        }
      } else if (Array.isArray(content) && content.length === 0) {
        content =
          m.role === 'user' ? '(image attached)' : '(no reply)';
      }
      return {
        role: m.role,
        content,
      } as GenerateMessage;
    });

    // Anthropic rejects Messages API requests with consecutive same-role
    // turns ("messages must alternate between user and assistant"). This
    // happens whenever a prior turn failed and the client retried without a
    // placeholder assistant bubble — e.g. voice mode where a bridge error
    // doesn't add an assistant reply. Collapse runs of the same role into a
    // single turn with a text-block array so history stays valid regardless
    // of client state.
    const messages: GenerateMessage[] = [];
    for (const msg of sanitized) {
      const prev = messages[messages.length - 1];
      if (prev && prev.role === msg.role) {
        const prevBlocks = Array.isArray(prev.content)
          ? prev.content
          : [{ type: 'text' as const, text: String(prev.content) }];
        const newBlocks = Array.isArray(msg.content)
          ? msg.content
          : [{ type: 'text' as const, text: String(msg.content) }];
        prev.content = [...prevBlocks, ...newBlocks] as GenerateMessage['content'];
      } else {
        messages.push({ ...msg });
      }
    }
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') {
      // Source text for memory prefix seeding — use the last text block if
      // content has been collapsed to an array (happens when upstream
      // clients send consecutive user turns, e.g. voice mode after a failed
      // bridge).
      const lastUserText =
        typeof last.content === 'string'
          ? last.content
          : last.content
              .filter(
                (b): b is { type: 'text'; text: string } => b.type === 'text'
              )
              .map((b) => b.text)
              .join('\n');

      try {
        const { region3 } = await prefixBuilder.build(
          householdId,
          lastUserText
        );
        const wrapped = `${region3}\n\n<user_message>${lastUserText}</user_message>${attachmentBlock}`;
        if (typeof last.content === 'string') {
          last.content = wrapped;
        } else {
          // Strip existing text blocks and replace with the wrapped prefix;
          // keep any image blocks so vision still works.
          const nonText = last.content.filter((b) => b.type !== 'text');
          last.content = [
            ...nonText,
            { type: 'text', text: wrapped },
          ] as GenerateMessage['content'];
        }
      } catch (err) {
        // Prefix failure is non-fatal — just log and proceed without it.
        console.warn('[aihousekeeper-chat] memory prefix build failed', {
          error: (err as Error).message,
        });
        if (attachmentBlock) {
          if (typeof last.content === 'string') {
            last.content = `${last.content}${attachmentBlock}`;
          } else if (Array.isArray(last.content)) {
            last.content = [
              ...last.content,
              { type: 'text', text: attachmentBlock },
            ];
          }
        }
      }
    }

    // Promote the last user message to block form so the image content blocks
    // sit alongside the text. Claude vision requires image blocks in the same
    // user turn as the question/instructions.
    if (last && last.role === 'user' && imageBlocks.length > 0) {
      const textContent =
        typeof last.content === 'string'
          ? last.content
          : last.content
              .filter(
                (b): b is { type: 'text'; text: string } => b.type === 'text'
              )
              .map((b) => b.text)
              .join('\n');
      last.content = [
        ...imageBlocks,
        { type: 'text', text: textContent || '(see attached image)' },
      ];
    }

    // Household timezone drives relative-date resolution ("today", "tomorrow").
    // Seeded on createHousehold with a default of UTC; users can change it in
    // Aihousekeeper settings. Query is cheap (PK lookup on a tiny table).
    const identityRow = await getAssistantIdentityForChat(c.env.DB, householdId);
    const today = formatTodayContext(identityRow?.timezone ?? 'UTC');
    // "Aihousekeeper" is the legacy DB default + an internal code name — the
    // product persona shown in the app is "Mira". Use the household's custom
    // name if they set one, else fall back to Mira so the assistant never
    // introduces itself as "Aihousekeeper".
    const assistantName =
      identityRow?.name && identityRow.name !== 'Aihousekeeper'
        ? identityRow.name
        : 'Mira';
    const systemPrompt = systemPromptForMode(mode, today, assistantName);
    const executed: ExecutedToolRecord[] = [];
    let iteration = 0;
    let finalStopReason: string = 'end_turn';
    let finalContent: GenerateMessage['content'] = '';
    let finalModel = c.env.AIHOUSEKEEPER_NUDGE_MODEL;

    console.log('[aihousekeeper-chat] request', {
      householdId,
      userId,
      mode,
      messageCount: messages.length,
      toolCount: toolDefs.length,
      hasAnthropicKey: !!c.env.ANTHROPIC_API_KEY,
      model: c.env.AIHOUSEKEEPER_NUDGE_MODEL,
    });

    while (iteration < MAX_TOOL_LOOP_ITERATIONS) {
      iteration += 1;
      let result;
      try {
        result = await generateWithFallback(
          provider,
          c.env.AIHOUSEKEEPER_NUDGE_MODEL,
          c.env.AIHOUSEKEEPER_FALLBACK_MODEL,
          {
            systemPrompt,
            messages,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            toolChoice: toolDefs.length > 0 ? { type: 'auto' } : undefined,
            maxTokens: 1024,
          }
        );
      } catch (genErr) {
        // Dump EVERYTHING about the failure so we can see the real cause
        // in wrangler tail. Propagate so the route returns 500 as before.
        const e = genErr as {
          message?: string;
          status?: number;
          type?: string;
          error?: unknown;
          stack?: string;
          name?: string;
        };
        console.error('[aihousekeeper-chat] generate FAILED', {
          iteration,
          name: e.name,
          status: e.status,
          type: e.type,
          message: e.message,
          errorField: e.error,
          stackHead: e.stack?.split('\n').slice(0, 3).join(' | '),
          model: c.env.AIHOUSEKEEPER_NUDGE_MODEL,
          messageShapes: messages.map((m) => ({
            role: m.role,
            contentType: typeof m.content === 'string' ? 'string' : 'array',
            len: typeof m.content === 'string' ? m.content.length : m.content.length,
          })),
          toolNames: toolDefs.map((t) => t.name),
        });
        throw genErr;
      }

      finalStopReason = result.stopReason;
      finalContent = result.content;
      finalModel = result.model;

      if (result.stopReason !== 'tool_use') {
        break;
      }

      // Append the assistant turn to the transcript.
      messages.push({ role: 'assistant', content: result.content });

      // Execute each tool_use block and collect the tool_result blocks to
      // feed back to the model.
      const toolResults: Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: string;
      }> = [];
      for (const block of result.content) {
        if (block.type !== 'tool_use') continue;
        const tool = findTool(tools, block.name);
        if (!tool) {
          const err: ToolResult = {
            ok: false,
            error: `unknown_tool:${block.name}`,
          };
          executed.push({ tool_use_id: block.id, name: block.name, result: err });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(err),
          });
          continue;
        }
        let parsedInput: unknown;
        try {
          parsedInput = tool.input.parse(block.input);
        } catch (err) {
          const shaped: ToolResult = {
            ok: false,
            error: `invalid_tool_input:${(err as Error).message}`,
          };
          executed.push({
            tool_use_id: block.id,
            name: block.name,
            result: shaped,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(shaped),
          });
          continue;
        }
        let toolResult: ToolResult;
        try {
          toolResult = await tool.execute(ctx, parsedInput);
        } catch (err) {
          toolResult = {
            ok: false,
            error: (err as Error).message ?? 'tool_execution_failed',
          };
        }
        executed.push({
          tool_use_id: block.id,
          name: block.name,
          result: toolResult,
        });
        // Stringify guards — JSON.stringify(undefined) returns undefined,
        // which would be sent as an empty tool_result and Anthropic 400s
        // with "user messages must have non-empty content".
        const stringified = JSON.stringify(toolResult) ?? '{"ok":false}';
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: stringified.length > 0 ? stringified : '{"ok":false}',
        });
      }

      // Feed tool_results back to the model as a user turn. If for some
      // reason there are no tool_use blocks in a tool_use stop (very rare),
      // bail out instead of pushing an empty user turn that would 400.
      if (toolResults.length === 0) {
        console.warn('[aihousekeeper-chat] tool_use stop with zero tool_use blocks', {
          iteration,
          contentTypes: Array.isArray(result.content)
            ? result.content.map((b) => b.type)
            : typeof result.content,
        });
        break;
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // ---------------------------------------------------------------------
    // Hallucination guard — fix for the "Plan is now pending approval"
    // bug where Claude generates the canned approval-confirmation text
    // WITHOUT actually calling a HIGH_WRITE tool. For garden plans, the old
    // chat approval path has been removed in favor of the Gardening boundary
    // confirmation flow, so those claims are scrubbed immediately. For other
    // approval-backed tools, the guard can still force one more tool call.
    // ---------------------------------------------------------------------
    const guardOutcome = await enforceParkClaimsAreReal({
      finalContent,
      executed,
      messages,
      tools,
      toolDefs,
      provider,
      ctx,
      env: c.env,
    });
    if (guardOutcome.kind === 'forced-park-succeeded') {
      finalContent = guardOutcome.content;
      finalStopReason = guardOutcome.stopReason;
      finalModel = guardOutcome.model;
    } else if (guardOutcome.kind === 'scrubbed-text') {
      finalContent = guardOutcome.content;
    }

    return c.json({
      response: {
        role: 'assistant' as const,
        content: finalContent,
      },
      tool_results: executed,
      model: finalModel,
      stop_reason: finalStopReason,
    });
  }
);

/**
 * Phrases Mira uses (per system prompt) when she thinks she's parked an
 * approval. Anchored to the deterministic copy so generic chat about
 * "approvals" (e.g. building permits) doesn't false-positive.
 */
const PARK_CLAIM_RE =
  /(pending\s+approval|open\s+aihousekeeper\s+approvals|aihousekeeper\s+approvals\s+to\s+confirm|parked\s+for\s+approval|awaiting\s+(?:your\s+)?approval|tap\s+approve)/i;

/**
 * Words / phrases in the user's last message that indicate they want a
 * garden / yard site plan generated. Used to pick which HIGH_WRITE tool
 * to force when we detect a hallucinated park.
 */
const GARDEN_INTENT_RE =
  /\b(garden|yard|landsca[pe]+|lawn|front\s*yard|back\s*yard|site\s*plan|outdoor)\b/i;

function flattenAssistantText(content: GenerateMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function flattenLastUserText(messages: readonly GenerateMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const text = m.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (text.trim().length > 0) return text;
  }
  return '';
}

type GuardOutcome =
  | { kind: 'no-action' }
  | {
      kind: 'forced-park-succeeded';
      content: GenerateMessage['content'];
      stopReason: string;
      model: string;
    }
  | { kind: 'scrubbed-text'; content: GenerateMessage['content'] };

interface GuardArgs {
  finalContent: GenerateMessage['content'];
  executed: ExecutedToolRecord[];
  messages: GenerateMessage[];
  tools: readonly AihousekeeperTool[];
  toolDefs: GenerateToolDef[];
  provider: AIProvider;
  ctx: AihousekeeperToolContext;
  env: Env;
}

const HALLUCINATED_PARK_FALLBACK =
  "I tried to park that for approval but the request didn't go through. " +
  'Please try again, or open the Gardening tab and use + Add Yard or Garden Plan to add it manually.';

const GARDEN_PLAN_CHAT_DISABLED_FALLBACK =
  'Garden plans now start from Gardening -> + Add Yard or Garden Plan. Upload a yard photo or ask Mira for a stylized concept plan.';

async function enforceParkClaimsAreReal(args: GuardArgs): Promise<GuardOutcome> {
  const { finalContent, executed, messages, tools, toolDefs, provider, ctx, env } =
    args;

  const text = flattenAssistantText(finalContent).trim();
  if (!text) return { kind: 'no-action' };
  if (!PARK_CLAIM_RE.test(text)) return { kind: 'no-action' };

  const reallyParked = executed.some(
    (e) =>
      e.result.ok &&
      (e.result as { status?: unknown }).status === 'parked_for_approval'
  );
  if (reallyParked) return { kind: 'no-action' };

  // Hallucination confirmed. Pick the most-likely intended HIGH_WRITE tool
  // from the user's wording. Today the only one that consistently triggers
  // this pattern is `create_garden_site_plan`; expand the map as new
  // tools start showing the same failure mode.
  const userText = flattenLastUserText(messages);
  const gardenIntent = GARDEN_INTENT_RE.test(userText) || GARDEN_INTENT_RE.test(text);
  const intendedToolName = gardenIntent ? 'create_garden_site_plan' : null;

  console.warn('[aihousekeeper-chat] hallucinated park detected', {
    textPreview: text.slice(0, 200),
    userPreview: userText.slice(0, 200),
    executedToolNames: executed.map((e) => e.name),
    intendedToolName,
  });

  if (gardenIntent) {
    return {
      kind: 'scrubbed-text',
      content: [
        {
          type: 'text',
          text: GARDEN_PLAN_CHAT_DISABLED_FALLBACK,
        },
      ] as GenerateMessage['content'],
    };
  }

  if (!intendedToolName || !tools.some((t) => t.name === intendedToolName)) {
    // Can't safely force a retry — at least don't lie to the user.
    return {
      kind: 'scrubbed-text',
      content: HALLUCINATED_PARK_FALLBACK,
    };
  }

  // Force the model to actually emit the tool call this time.
  const forcedMessages: GenerateMessage[] = [
    ...messages,
    { role: 'assistant', content: finalContent },
    {
      role: 'user',
      content:
        "STOP. You said the request is pending approval, but you did not call the " +
        intendedToolName +
        ' tool — there is no actual parked row in the database. Call ' +
        intendedToolName +
        ' now with the correct arguments inferred from the conversation. ' +
        'Do not produce text — only the tool call.',
    },
  ];

  let forcedResult;
  try {
    forcedResult = await generateWithFallback(
      provider,
      env.AIHOUSEKEEPER_NUDGE_MODEL,
      env.AIHOUSEKEEPER_FALLBACK_MODEL,
      {
        systemPrompt:
          'You are calling a tool that you previously claimed to have called but did not. ' +
          'Emit ONLY the tool call. No commentary text.',
        messages: forcedMessages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        toolChoice: { type: 'tool', name: intendedToolName },
        maxTokens: 1024,
      }
    );
  } catch (err) {
    console.error('[aihousekeeper-chat] forced retry FAILED', {
      intendedToolName,
      error: (err as Error).message,
    });
    return {
      kind: 'scrubbed-text',
      content: HALLUCINATED_PARK_FALLBACK,
    };
  }

  // Execute the forced tool call(s) and harvest the park result.
  const tool = tools.find((t) => t.name === intendedToolName);
  if (!tool) {
    return {
      kind: 'scrubbed-text',
      content: HALLUCINATED_PARK_FALLBACK,
    };
  }

  let parkSucceeded = false;
  for (const block of forcedResult.content) {
    if (block.type !== 'tool_use' || block.name !== intendedToolName) continue;
    let parsed: unknown;
    try {
      parsed = tool.input.parse(block.input);
    } catch (err) {
      executed.push({
        tool_use_id: block.id,
        name: block.name,
        result: {
          ok: false,
          error: `invalid_tool_input:${(err as Error).message}`,
        },
      });
      continue;
    }
    let result: ToolResult;
    try {
      result = await tool.execute(ctx, parsed);
    } catch (err) {
      result = {
        ok: false,
        error: (err as Error).message ?? 'tool_execution_failed',
      };
    }
    executed.push({ tool_use_id: block.id, name: block.name, result });
    if (
      result.ok &&
      (result as { status?: unknown }).status === 'parked_for_approval'
    ) {
      parkSucceeded = true;
    }
  }

  if (parkSucceeded) {
    // Replace the misleading text with a confirmed, deterministic message.
    // The mobile bubble will also render the "Open Approvals" CTA via the
    // existing `parked` extraction.
    return {
      kind: 'forced-park-succeeded',
      content: [
        {
          type: 'text',
          text:
            'Parked your request — open Approvals to review and confirm, then I\'ll generate it (15–30 s).',
        },
      ] as GenerateMessage['content'],
      stopReason: 'end_turn',
      model: forcedResult.model,
    };
  }

  // Forced retry didn't actually park (tool returned ok:false, e.g. rate
  // limited or missing required input). Surface the truthful error.
  let lastFailure: ExecutedToolRecord | undefined;
  for (let i = executed.length - 1; i >= 0; i--) {
    if (executed[i].name === intendedToolName) {
      lastFailure = executed[i];
      break;
    }
  }
  const reason =
    lastFailure && !lastFailure.result.ok
      ? (lastFailure.result as { error?: unknown }).error
      : null;
  return {
    kind: 'scrubbed-text',
    content: [
      {
        type: 'text',
        text:
          typeof reason === 'string' && reason.length > 0
            ? `I couldn't park that for approval (${reason}). You can also add a plan from the Gardening tab.`
            : HALLUCINATED_PARK_FALLBACK,
      },
    ] as GenerateMessage['content'],
  };
}

export default aihousekeeperChat;
