/**
 * Shared household-chat service core.
 *
 * ONE implementation of household chat (rooms, participants, messages, image +
 * document attachments, edit/delete, unread counts, live broadcast, @mention
 * notifications, and the optional BYOK @assistant reply) that every Symply app
 * reuses. Per-app differences are expressed entirely through {@link ChatBackendConfig}:
 * the Drizzle table set, the notification namespace, the R2 key prefix, the AI
 * usage-feature tag, the assistant system prompt, and a log tag. Data stays
 * ISOLATED per app (each app passes its own physically-separate tables +
 * notification namespace) — only this code is shared.
 *
 * To add a new app: create its `<app>_chat_*` tables (copy `schema-chat.ts` with
 * the prefix), then instantiate this core with those tables + config (see
 * `chat-room-service.ts` / `budget-chat-room-service.ts` for the two-line recipe).
 *
 * The stateless `CHAT_ROOM` durable object is reused purely as a WebSocket
 * fan-out layer keyed by room id (it persists nothing), so apps never mix rooms.
 */
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import type { GenerateMessage, GenerateToolDef } from '../../ai/provider';
import { createProviderAdapter } from '../../ai/provider-factory';
import * as schema from '../../db/schema';
import type { Database, Env } from '../../types';
import { BadRequestError, ForbiddenError, NotFoundError, AIAccessError } from '../../utils/errors';
import { generateId, now } from '../../utils/id';
import { hasUsableProviderKey, resolveProviderApiKey } from '../ai-credential-resolver';
import { usageRecorderFor } from '../ai-usage-service';
import { assertCanUseAI } from '../entitlement-service';
import { HouseholdService } from '../household-service';
import { NotificationService } from '../notification-service';

/**
 * The Drizzle tables backing one app's chat. Typed against the House schema
 * shape; every app's `*_chat_*` tables are structurally identical (same columns),
 * so an app with differently-named tables passes them cast to these types.
 */
export interface ChatTables {
  rooms: typeof schema.chatRooms;
  messages: typeof schema.chatMessages;
  participants: typeof schema.chatRoomParticipants;
  reads: typeof schema.chatRoomReads;
}

/** Everything that differs between one app's chat and another's. */
export interface ChatBackendConfig {
  tables: ChatTables;
  /** Notification namespace — keeps each app's chat pings/badges isolated. */
  notif: {
    /** in-app + push type for a generic new message, e.g. `chat_message`. */
    messageType: string;
    /** in-app + push type for an @mention, e.g. `chat_mention`. */
    mentionType: string;
    /** reference_type used to clear a room's notifications on read, e.g. `chat_room`. */
    referenceType: string;
    /** client routing sentinel in notification `data.screen`, e.g. `ChatRoom`. */
    screen: string;
  };
  /** R2 key prefix for uploaded attachments, e.g. `chat-images`. */
  r2Prefix: string;
  /** AI usage-metering feature tag, e.g. `chat_assistant`. */
  usageFeature: string;
  /** System prompt used for the @assistant reply. */
  assistantPrompt: string;
  /** Short tag for console logs, e.g. `chat` or `budget-chat`. */
  logTag: string;
  /**
   * When set, the chat has ONE dedicated AI assistant room per household. It is
   * auto-created on first access, pinned to the top of the rooms list, cannot be
   * deleted or restricted, and every member message triggers an AI reply without
   * an `@assistant` mention. `name` is the room's display name (e.g. "AI Budget
   * Assistant"). Omit for apps whose assistant is opt-in via `@assistant` only.
   */
  dedicatedAssistantRoom?: { name: string };
  /**
   * When set, every household gets an auto-created, undeletable member room with
   * this name (House's "General"). Omit it for apps whose only pre-made chat is
   * the {@link dedicatedAssistantRoom} — members there still create their own
   * rooms, and every room they create can be deleted again.
   */
  defaultRoom?: { name: string };
  /**
   * Optional app-specific augmentation of the assistant turn — image-attachment
   * auto-trigger plus tools the model can call (e.g. Budget's "add this receipt
   * to my spendings"). Omitted for apps whose assistant is chat-only. See
   * {@link ChatAssistantCapability}.
   */
  assistant?: ChatAssistantCapability;
  /**
   * Subject-scoped rooms this app allows ("the chat ABOUT this thing"). Omit and
   * the subject endpoints refuse every call, which is what keeps Budget's chat
   * exactly as it was while House gains project + material conversations.
   *
   * Deliberately a plain allow-list of strings and not an enum shared with the
   * home-projects service: the subject id is opaque to chat (see the 0167
   * migration), and the moment chat imports a project type it has taken a
   * dependency on a Tier-A feature it can never actually read.
   */
  subjects?: {
    /** Accepted `subject_type` values, e.g. `['home_project', ...]`. */
    types: readonly string[];
    /**
     * Types that MUST arrive with a `subject_parent_id` (a material chat is
     * meaningless without the project it hangs off).
     */
    requireParent?: readonly string[];
  };
}

/** What a subject-scoped room is about. Null on every ordinary room. */
export interface ChatRoomSubject {
  /** App-defined kind, e.g. `home_project` | `home_project_material`. */
  type: string;
  /** Opaque id, scoped by household. No FK — see migration 0167. */
  id: string;
  /** Display text, denormalized so the list renders without the owning feature. */
  label: string;
  /** The project a material chat belongs to; null for a top-level subject. */
  parent_id: string | null;
  parent_label: string | null;
  /** True once the client has written a grounding snapshot for the assistant. */
  has_context: boolean;
}

/** The client's request to open (or create) the one room for a subject. */
export interface OpenSubjectRoomInput {
  type: string;
  id: string;
  label: string;
  parent_id?: string | null;
  parent_label?: string | null;
  /**
   * Grounding text for the assistant — what this project/material IS, in the
   * client's own words. Refreshed on every open, because the client is the only
   * party that can read a local-first project.
   */
  context?: string | null;
  /**
   * Restrict the room to these members. Pass the subject's own audience (a
   * draft project's, say) so a private project does not get a chat the whole
   * household can read. Omit to leave the room open to every member.
   */
  participant_ids?: string[];
  /** Room title override. Defaults to a name derived from the subject label. */
  name?: string;
}

/**
 * Context handed to a {@link ChatAssistantCapability.runTool} handler when the
 * model invokes one of the app's tools during an assistant reply. `env` lets the
 * handler construct app services (BudgetService, ReceiptScanService, …) and
 * reach R2; `imageAttachments` are the image(s) on the message that triggered the
 * turn — the raw material for receipt-style tools.
 */
export interface ChatAssistantToolContext {
  env: Env;
  householdId: string;
  roomId: string;
  userId: string;
  /** Image attachments on the triggering member message (may be empty). */
  imageAttachments: ChatAttachment[];
  /**
   * What this room is ABOUT, when it is a subject room — the project or the one
   * material. Null in the household's general chat and in the dedicated AI room.
   *
   * This is what lets an app decide its toolset per room rather than per app:
   * House offers `add_material` only where there is a project to add it to. The
   * ids here are the app's own opaque subject ids (see migration 0167), so a
   * handler can address a row the Worker itself has never seen.
   */
  subject: ChatAssistantSubject | null;
}

/** The subject of a room, in the shape a tool handler wants it. */
export interface ChatAssistantSubject {
  type: string;
  id: string;
  label: string;
  parentId: string | null;
  parentLabel: string | null;
}

/**
 * A rich UI element the assistant can attach to its chat reply — rendered
 * natively by the client (charts, stat cards) rather than as text. Stored on the
 * AI message's `metadata.ui`. The client mirrors this type; keep the two in sync.
 */
export interface ChatChartSpec {
  /** Visual form. `bar` for comparisons; `pie`/`donut` for share; `line` for trends. */
  type: 'bar' | 'pie' | 'donut' | 'line';
  /** Optional heading shown above the chart. */
  title?: string;
  /** How to format each datum's value in labels/tooltips. */
  valueFormat?: 'currency' | 'number' | 'percent';
  /**
   * Ordered data points. `value` is a plain number (dollars for currency).
   * Colour is never sent — the client applies brand chart tokens.
   */
  data: Array<{ label: string; value: number }>;
}

/** A labelled figure card (e.g. "Spent this month · $412"). */
export interface ChatStatSpec {
  label: string;
  value: string;
  /** Optional supporting line (e.g. "68% of your $600 budget"). */
  caption?: string;
  /** Sentiment hint the client may colour on. */
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
}

/** Compact data table for rankings / product breakdowns. */
export interface ChatTableSpec {
  title?: string;
  columns: string[];
  /** Cell strings already formatted for display (e.g. "$12.50"). */
  rows: string[][];
}

/** Short analysis narrative card. */
export interface ChatInsightSpec {
  title: string;
  body: string;
  bullets?: string[];
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
}

/** Simple money-flow diagram (nodes + directed edges). */
export interface ChatDiagramSpec {
  title?: string;
  nodes: Array<{ id: string; label: string; value?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

/** A UI block attached to an assistant chat message. Discriminated by `kind`. */
export type ChatUiBlock =
  | { kind: 'chart'; chart: ChatChartSpec }
  | { kind: 'stats'; stats: ChatStatSpec[] }
  | { kind: 'table'; table: ChatTableSpec }
  | { kind: 'insight'; insight: ChatInsightSpec }
  | { kind: 'diagram'; diagram: ChatDiagramSpec };

/**
 * Receipt scan draft attached to an AI message so the client can open the
 * confirm screen. Same shape as {@link import('../budget-analysis').ReceiptScanResult}.
 */
export type ChatReceiptDraft = import('../budget-analysis').ReceiptScanResult;

/**
 * What a tool handler returns. Either a plain string (fed back to the model as
 * the `tool_result` text) or a structured result that ALSO attaches UI block(s)
 * and/or a receipt draft to the assistant's final chat message.
 */
export type ChatAssistantToolReturn =
  | string
  | {
      result: string;
      ui?: ChatUiBlock[];
      /** Scan-only draft — client opens confirm; does NOT imply budgetMutated. */
      receiptDraft?: ChatReceiptDraft;
      /** When true, clients should refetch budget/savings screens. */
      budgetMutated?: boolean;
      /**
       * Writes the assistant decided on that the CLIENT must perform, carried
       * out to the device on `metadata.actions`.
       *
       * This is how an assistant acts on data the Worker cannot reach. A House
       * home project is Tier A — on a local-first household its rows exist only
       * in the on-device ledger — so a tool that "adds a material" cannot insert
       * one here. It describes the write instead, and the device runs it down
       * the same `homeProjectsApi` path the member's own tap uses. See
       * {@link ./house-assistant-actions} for the full argument.
       *
       * Opaque to the core on purpose: it stores and forwards these, and never
       * looks inside. The shape is the owning app's contract with its own client.
       */
      actions?: unknown[];
    };

/**
 * App-specific assistant capability. Everything here is optional so House keeps
 * a chat-only assistant while Budget adds a full budget-adviser toolset — the
 * shared core stays identical.
 */
export interface ChatAssistantCapability {
  /**
   * When true, a member message that carries image attachment(s) pulls in the
   * assistant even without an explicit `@assistant` mention. This is what lets a
   * user just drop a receipt photo with "add to my spendings" and get a reply.
   */
  triggerOnImageAttachment?: boolean;
  /**
   * Tool schemas offered to the assistant for this app's reply turns.
   *
   * A function when the set depends on the room — House offers its home-project
   * write tools only in a room that HAS a project, so the model is never given
   * a verb whose only possible outcome is "there is nothing here to do that to".
   * Budget's toolset is the same everywhere, so it passes a plain array.
   */
  tools?: GenerateToolDef[] | ((ctx: ChatAssistantToolContext) => GenerateToolDef[]);
  /**
   * Optional per-turn context injected into the assistant's first user message,
   * so it is aware of live app state (e.g. the household's current budget) without
   * needing a tool round-trip. Returns a compact string, or null to inject nothing.
   */
  buildContext?(ctx: ChatAssistantToolContext): Promise<string | null>;
  /**
   * Execute a tool the model requested. Returns a short human-readable result
   * (optionally with UI blocks) fed back as the `tool_result` so the model can
   * confirm the outcome. Must never throw for expected failures — return an
   * explanatory string instead so the assistant can relay it gracefully.
   */
  runTool?(
    ctx: ChatAssistantToolContext,
    call: { name: string; input: Record<string, unknown> }
  ): Promise<ChatAssistantToolReturn>;
}

/** An image or document attachment on a chat message. */
export interface ChatAttachment {
  /** R2 storage key under `<r2Prefix>/<householdId>/<roomId>/...`. */
  key: string;
  /** Absolute URL the client renders (served publicly-by-key from R2). */
  url: string;
  mimeType?: string;
  /** Original filename, shown as the label for non-image (document) attachments. */
  name?: string;
  width?: number;
  height?: number;
}

/** A chat message serialized for API responses and live broadcast events. */
/** A denormalized snapshot of the message a reply is quoting. */
export interface ChatReplyPreview {
  id: string;
  sender_type: 'user' | 'ai' | 'system';
  /** 'Assistant' for the AI; display name for members; null when unknown. */
  sender_name: string | null;
  /** Short body/attachment preview shown in the quoted block. */
  preview: string;
}

export interface ChatMessageResponse {
  id: string;
  room_id: string;
  sender_type: 'user' | 'ai' | 'system';
  sender_user_id: string | null;
  sender_name: string | null;
  body: string;
  attachments: ChatAttachment[] | null;
  /** user_ids tagged in this message (drives highlight + who was notified). */
  mentions: string[] | null;
  /** Set when this message replies to another; a quoted snapshot for rendering. */
  reply_to: ChatReplyPreview | null;
  metadata: Record<string, unknown> | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface ChatRoomResponse {
  id: string;
  name: string;
  ai_enabled: boolean;
  is_default: boolean;
  /** True for the dedicated 1:1 AI assistant room (pinned, undeletable, mention-free). */
  is_assistant: boolean;
  /** True when the room is limited to an explicit participant set. */
  restricted: boolean;
  /** The entity this conversation is about, or null for an ordinary room. */
  subject: ChatRoomSubject | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_message: ChatMessageResponse | null;
  unread_count: number;
}

/** Stored attachment shape (before the serving URL is attached). */
interface StoredAttachment {
  key: string;
  mimeType?: string;
  name?: string;
  width?: number;
  height?: number;
}

// How many recent messages to feed the assistant as conversation context.
const AI_CONTEXT_MESSAGE_LIMIT = 20;
/**
 * Mention trigger that pulls the assistant into a room. Case-insensitive.
 *
 * `@ai` is accepted alongside `@assistant` because that is what members
 * actually type, and a mention the app silently ignores reads as a broken
 * assistant rather than as the wrong handle. Both are kept: `@assistant` is
 * already in shipped conversations, help copy and E2E flows.
 */
const ASSISTANT_MENTION = /@(?:assistant|ai)\b/i;
/** Cap on the client-supplied grounding snapshot fed to the assistant. */
const MAX_SUBJECT_CONTEXT_CHARS = 6000;
// Cap attachments per message to keep payloads + push previews sane.
const MAX_ATTACHMENTS = 10;
// Vision image types the model accepts. Anything else (PDFs, unknown) is skipped
// for the vision input — receipt-style tools re-read the original bytes anyway.
const VISION_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type VisionImageMime = (typeof VISION_IMAGE_MIMES)[number];
/** Assistant tools that change budget/savings data clients must refetch. */
const BUDGET_MUTATING_TOOLS = new Set([
  'add_expense',
  'edit_expense',
  'delete_expense',
  'set_monthly_budget',
  'create_category',
  'create_planned_spending',
]);
/** Receipt scan tool — draft only; not a mutation until the member confirms in-app. */
const RECEIPT_SCAN_TOOL = 'scan_receipt_for_review';

// Cap how many images we feed the model per turn (payload + latency guard).
const MAX_VISION_IMAGES = 4;
// Downsample vision payloads so waitUntil turns don't OOM / exceed CPU on large
// phone photos (mirrors savings-import limits).
const VISION_MAX_DIMENSION = 1568;
const VISION_MAX_PIXELS = 1_150_000;
/** Skip feeding the model any single image larger than this after downsample. */
const VISION_MAX_BASE64_CHARS = 3_500_000;
// Safety bound on the assistant tool-use loop so a misbehaving model can't spin.
const MAX_ASSISTANT_TOOL_ITERATIONS = 6;
/** Body hints that the member wants a shared receipt logged as spending. */
const RECEIPT_INTENT =
  /\b(add|log|record|save|analyze|scan).{0,40}\b(spend|spending|expense|receipt|grocer)/i;

/** One block of structured `generate` message content (image/text/tool_*). */
type ContentBlock = Exclude<GenerateMessage['content'], string>[number];
/** A base64 image block fed to the vision model. */
type ImageBlock = Extract<ContentBlock, { type: 'image' }>;
/** A tool_result block returned to the model after running a tool. */
type ToolResultBlock = Extract<ContentBlock, { type: 'tool_result' }>;

/** True when a mime type is an image (any subtype), i.e. renders as a photo. */
function isImageMime(mimeType: string | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.startsWith('image/');
}

/** Map an attachment mime to a vision-supported type, or null when unsupported. */
function toVisionMime(mimeType: string | undefined): VisionImageMime | null {
  if (mimeType === 'image/jpg') return 'image/jpeg';
  return VISION_IMAGE_MIMES.includes(mimeType as VisionImageMime)
    ? (mimeType as VisionImageMime)
    : null;
}

export class ChatRoomServiceCore {
  protected db: Database;
  protected env: Env;
  protected householdService: HouseholdService;
  protected config: ChatBackendConfig;

  constructor(env: Env, d1: D1Database, config: ChatBackendConfig) {
    this.db = drizzle(d1, { schema });
    this.env = env;
    this.householdService = new HouseholdService(env, d1);
    this.config = config;
  }

  // ============ ROOMS ============

  /**
   * List a household's active rooms the caller can access, each with its last
   * message + the caller's unread count. Auto-creates the app's pre-made rooms
   * on first access ({@link ChatBackendConfig.defaultRoom} and/or the dedicated
   * assistant room) so the chat is never empty. Restricted rooms the caller
   * isn't a participant of are hidden.
   */
  async listRooms(householdId: string, userId: string): Promise<ChatRoomResponse[]> {
    const { rooms, messages } = this.config.tables;
    await this.householdService.verifyAccess(householdId, userId);
    if (this.config.defaultRoom) await this.ensureDefaultRoom(householdId, userId);
    await this.ensureAssistantRoom(householdId, userId);

    const roomRows = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.household_id, householdId), isNull(rooms.archived_at)))
      // The dedicated AI assistant room is always pinned first, then the default
      // "General" room, then the rest by recency.
      .orderBy(desc(rooms.is_assistant), desc(rooms.is_default), desc(rooms.updated_at))
      .all();

    const names = await this.memberNameMap(householdId);

    const visible: ChatRoomResponse[] = [];
    for (const room of roomRows) {
      const participantIds = await this.getParticipantIds(room.id);
      const restricted = this.isRestricted(room, participantIds);
      if (restricted && !participantIds.has(userId)) continue;

      const lastRow = await this.db
        .select()
        .from(messages)
        .where(eq(messages.room_id, room.id))
        .orderBy(desc(messages.created_at))
        .limit(1)
        .get();

      const unread = await this.unreadCount(room.id, userId);
      visible.push(
        this.serializeRoom(room, restricted, lastRow ? this.serializeMessage(lastRow, names) : null, unread)
      );
    }
    return visible;
  }

  async createRoom(
    householdId: string,
    userId: string,
    input: { name: string; ai_enabled?: boolean; participant_ids?: string[] }
  ): Promise<ChatRoomResponse> {
    const { rooms } = this.config.tables;
    await this.householdService.verifyAccess(householdId, userId);

    const timestamp = now();
    const room: schema.NewChatRoom = {
      id: generateId(),
      household_id: householdId,
      name: input.name.trim(),
      created_by: userId,
      ai_enabled: input.ai_enabled ?? true,
      is_default: false,
      is_assistant: false,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await this.db.insert(rooms).values(room);

    // A restricted room must always include its creator so they don't lock
    // themselves out. An empty/omitted list leaves the room open to everyone.
    let restricted = false;
    if (input.participant_ids && input.participant_ids.length > 0) {
      const memberIds = new Set((await this.memberNameMap(householdId)).keys());
      const set = new Set(input.participant_ids.filter((id) => memberIds.has(id)));
      set.add(userId);
      await this.writeParticipants(room.id as string, set, userId);
      restricted = true;
    }

    return this.serializeRoom(room as schema.ChatRoom, restricted, null, 0);
  }

  // ============ SUBJECT-SCOPED ROOMS ============

  /**
   * Open the ONE room for a subject, creating it on first use.
   *
   * This is the whole entry point for "chat about this project / this material".
   * It is idempotent by design — the caller is a button on a screen, not a
   * creation flow, and a member tapping it twice (or two members tapping it at
   * once) must land in the same conversation. The unique index does the
   * arbitration; the loser of the race re-reads instead of creating a twin room
   * nobody would ever find again.
   *
   * Every call also REFRESHES the assistant's grounding snapshot, because this
   * runs when a screen that has the live project data in hand opens the chat.
   * That is the only moment the server can learn what a local-first project is
   * about, so it is the moment we take it.
   */
  async getOrCreateSubjectRoom(
    householdId: string,
    userId: string,
    input: OpenSubjectRoomInput
  ): Promise<ChatRoomResponse> {
    const { rooms, messages } = this.config.tables;
    await this.householdService.verifyAccess(householdId, userId);

    const subject = this.assertSubjectSupported(input);
    const context = this.sanitizeSubjectContext(input.context);
    const label = subject.label;

    const existing = await this.findSubjectRoom(householdId, subject.type, subject.id);
    if (existing) {
      // Keep the denormalized display text and the grounding snapshot current:
      // a renamed project must not leave its chat titled with the old name, and
      // a plan that has moved on must not brief the assistant with last week's.
      const patch: Partial<schema.ChatRoom> = {};
      if (label && existing.subject_label !== label) {
        patch.subject_label = label;
        // Follow the rename into the room's own title, but ONLY while nobody has
        // given it one of their own. A subject room is titled after its subject,
        // so a project renamed to "Kitchen Reno v2" whose chat still says
        // "Kitchen Reno" is just wrong — while an owner who deliberately renamed
        // the room to "Tile arguments" must not have it silently undone the next
        // time someone opens the project.
        if (existing.name === existing.subject_label) patch.name = label;
      }
      if (subject.parent_label && existing.subject_parent_label !== subject.parent_label) {
        patch.subject_parent_label = subject.parent_label;
      }
      if (context) patch.subject_context_json = context;
      if (Object.keys(patch).length > 0) {
        await this.db.update(rooms).set(patch).where(eq(rooms.id, existing.id));
        Object.assign(existing, patch);
      }

      const participantIds = await this.getParticipantIds(existing.id);
      const restricted = this.isRestricted(existing, participantIds);
      if (restricted && !participantIds.has(userId)) {
        throw new NotFoundError('Chat room');
      }
      const names = await this.memberNameMap(householdId);
      const lastRow = await this.db
        .select()
        .from(messages)
        .where(eq(messages.room_id, existing.id))
        .orderBy(desc(messages.created_at))
        .limit(1)
        .get();
      return this.serializeRoom(
        existing,
        restricted,
        lastRow ? this.serializeMessage(lastRow, names) : null,
        await this.unreadCount(existing.id, userId)
      );
    }

    const timestamp = now();
    const room: schema.NewChatRoom = {
      id: generateId(),
      household_id: householdId,
      name: (input.name?.trim() || label).slice(0, 80),
      created_by: userId,
      ai_enabled: true,
      is_default: false,
      is_assistant: false,
      subject_type: subject.type,
      subject_id: subject.id,
      subject_parent_id: subject.parent_id,
      subject_label: label,
      subject_parent_label: subject.parent_label,
      subject_context_json: context,
      created_at: timestamp,
      updated_at: timestamp,
    };

    try {
      await this.db.insert(rooms).values(room);
    } catch (error) {
      // Lost the race with another device — the unique index did its job.
      const raced = await this.findSubjectRoom(householdId, subject.type, subject.id);
      if (!raced) throw error;
      const racedParticipants = await this.getParticipantIds(raced.id);
      return this.serializeRoom(
        raced,
        this.isRestricted(raced, racedParticipants),
        null,
        await this.unreadCount(raced.id, userId)
      );
    }

    // A private project must not get a chat the whole household can read, so the
    // caller passes the subject's own audience and the existing participant
    // machinery enforces it from there.
    let restricted = false;
    if (input.participant_ids && input.participant_ids.length > 0) {
      const memberIds = new Set((await this.memberNameMap(householdId)).keys());
      const set = new Set(input.participant_ids.filter((id) => memberIds.has(id)));
      set.add(userId);
      await this.writeParticipants(room.id as string, set, userId);
      restricted = true;
    }

    return this.serializeRoom(room as schema.ChatRoom, restricted, null, 0);
  }

  /**
   * Delete the room for a subject AND every room hanging off it — deleting a
   * project takes its material chats with it.
   *
   * Called best-effort from a delete path that has ALREADY removed the subject,
   * so it is cleanup rather than moderation. Permitted to the household owner or
   * to the room's creator: requiring household-owner would strand a chat every
   * time a non-owner deleted their own project, and there is no FK to cascade
   * from (migration 0167 explains why there cannot be one).
   *
   * Returns how many rooms went, so a caller can log a no-op honestly.
   */
  async deleteSubjectRooms(
    householdId: string,
    userId: string,
    subjectType: string,
    subjectId: string
  ): Promise<{ deleted: number }> {
    const { rooms } = this.config.tables;
    await this.householdService.verifyAccess(householdId, userId);

    const own = await this.findSubjectRoom(householdId, subjectType, subjectId);
    const children = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.household_id, householdId), eq(rooms.subject_parent_id, subjectId)))
      .all();

    const targets = [...(own ? [own] : []), ...children].filter(
      (room, index, all) => all.findIndex((r) => r.id === room.id) === index
    );
    if (targets.length === 0) return { deleted: 0 };

    const isOwner = await this.isHouseholdOwner(householdId, userId);
    for (const room of targets) {
      if (!isOwner && room.created_by !== userId) {
        throw new ForbiddenError(
          'Only a household owner or the member who started this chat can delete it.'
        );
      }
    }

    for (const room of targets) {
      // Messages, participants and reads cascade via FK ON DELETE CASCADE.
      await this.db.delete(rooms).where(eq(rooms.id, room.id));
      await this.deleteRoomImages(householdId, room.id);
      await this.broadcast(room.id, { type: 'room_deleted', roomId: room.id });
    }
    return { deleted: targets.length };
  }

  private async findSubjectRoom(
    householdId: string,
    subjectType: string,
    subjectId: string
  ): Promise<schema.ChatRoom | undefined> {
    const { rooms } = this.config.tables;
    return this.db
      .select()
      .from(rooms)
      .where(
        and(
          eq(rooms.household_id, householdId),
          eq(rooms.subject_type, subjectType),
          eq(rooms.subject_id, subjectId)
        )
      )
      .get();
  }

  /**
   * Validate a subject against the app's allow-list and normalize it. An app
   * that declares no `subjects` has no subject rooms at all — the endpoint is
   * closed rather than permissive, so Budget's chat cannot grow project rooms by
   * accident.
   */
  private assertSubjectSupported(input: OpenSubjectRoomInput): {
    type: string;
    id: string;
    label: string;
    parent_id: string | null;
    parent_label: string | null;
  } {
    const declared = this.config.subjects;
    if (!declared || !declared.types.includes(input.type)) {
      throw new BadRequestError('This chat does not support conversations about that.');
    }
    const id = input.id?.trim();
    if (!id) throw new BadRequestError('A subject chat needs the id of what it is about.');

    const parentId = input.parent_id?.trim() || null;
    if ((declared.requireParent ?? []).includes(input.type) && !parentId) {
      throw new BadRequestError('This conversation needs the project it belongs to.');
    }

    const label = (input.label ?? '').trim().slice(0, 80) || 'Untitled';
    return {
      type: input.type,
      id,
      label,
      parent_id: parentId,
      parent_label: input.parent_label?.trim().slice(0, 80) || null,
    };
  }

  /** Wrap the client's grounding text in its stored envelope, or null. */
  private sanitizeSubjectContext(context: string | null | undefined): string | null {
    const text = (context ?? '').trim();
    if (!text) return null;
    return JSON.stringify({
      text: text.slice(0, MAX_SUBJECT_CONTEXT_CHARS),
      updated_at: now(),
    });
  }

  /** Read a room's stored grounding text back out (empty when absent/malformed). */
  private readSubjectContext(room: schema.ChatRoom): string {
    if (!room.subject_context_json) return '';
    try {
      const parsed = JSON.parse(room.subject_context_json) as { text?: unknown };
      return typeof parsed.text === 'string' ? parsed.text : '';
    } catch {
      return '';
    }
  }

  /** Owner-only: permanently delete a non-default room and all its messages. */
  async deleteRoom(householdId: string, userId: string, roomId: string): Promise<void> {
    const { rooms } = this.config.tables;
    await this.householdService.verifyAccess(householdId, userId);
    await this.requireHouseholdOwner(householdId, userId);
    const room = await this.getRoomOrThrow(householdId, roomId);
    if (room.is_assistant) {
      throw new BadRequestError('The AI assistant chat can’t be deleted.');
    }
    if (room.is_default) {
      throw new BadRequestError('The General room can’t be deleted.');
    }
    // Messages, participants, and reads cascade via FK ON DELETE CASCADE.
    await this.db.delete(rooms).where(eq(rooms.id, roomId));
    // Purge the room's uploaded images from R2 (rows are already gone via cascade).
    await this.deleteRoomImages(householdId, roomId);
    await this.broadcast(roomId, { type: 'room_deleted', roomId });
  }

  /**
   * Owner-only: rename a room. The default "General" room may be renamed too —
   * only its deletion/restriction are blocked. Broadcasts `room_renamed` so
   * connected clients update the header live.
   */
  async renameRoom(
    householdId: string,
    userId: string,
    roomId: string,
    name: string
  ): Promise<{ id: string; name: string; updated_at: string }> {
    const { rooms } = this.config.tables;
    await this.householdService.verifyAccess(householdId, userId);
    await this.requireHouseholdOwner(householdId, userId);
    const room = await this.getRoomOrThrow(householdId, roomId);

    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestError('Room name can’t be empty.');
    }

    const timestamp = now();
    await this.db.update(rooms).set({ name: trimmed, updated_at: timestamp }).where(eq(rooms.id, roomId));

    await this.broadcast(roomId, { type: 'room_renamed', roomId, name: trimmed });
    return { id: room.id, name: trimmed, updated_at: timestamp };
  }

  /**
   * Owner-only: permanently purge every message in a room (plus its uploaded
   * images from R2). The room itself stays. Hard delete — messages are gone for
   * everyone and are not recoverable. Broadcasts `history_cleared`.
   */
  async clearHistory(householdId: string, userId: string, roomId: string): Promise<void> {
    const { messages, reads } = this.config.tables;
    await this.householdService.verifyAccess(householdId, userId);
    await this.requireHouseholdOwner(householdId, userId);
    await this.getRoomOrThrow(householdId, roomId);

    // Best-effort purge of the room's uploaded images before the rows go.
    await this.deleteRoomImages(householdId, roomId);
    await this.db.delete(messages).where(eq(messages.room_id, roomId));
    // Reset read cursors so unread counts start clean against an empty room.
    await this.db.delete(reads).where(eq(reads.room_id, roomId));

    await this.broadcast(roomId, { type: 'history_cleared', roomId });
  }

  /** Best-effort delete of all R2 image objects stored under a room's prefix. */
  private async deleteRoomImages(householdId: string, roomId: string): Promise<void> {
    const prefix = `${this.config.r2Prefix}/${householdId}/${roomId}/`;
    try {
      let cursor: string | undefined;
      do {
        const listed = await this.env.REPORTS_BUCKET.list({ prefix, cursor });
        if (listed.objects.length > 0) {
          await this.env.REPORTS_BUCKET.delete(listed.objects.map((o) => o.key));
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    } catch (error) {
      console.error(`[${this.config.logTag}] clearing room images failed:`, error);
    }
  }

  /**
   * Create the household's auto-created member room ({@link
   * ChatBackendConfig.defaultRoom}, e.g. House's "General") if it doesn't exist
   * yet. Only called for apps that opt into one.
   */
  private async ensureDefaultRoom(householdId: string, userId: string): Promise<void> {
    const { rooms } = this.config.tables;
    const defaultRoom = this.config.defaultRoom;
    if (!defaultRoom) return;
    const existing = await this.db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.household_id, householdId), eq(rooms.is_default, true)))
      .get();
    if (existing) return;

    const timestamp = now();
    await this.db.insert(rooms).values({
      id: generateId(),
      household_id: householdId,
      name: defaultRoom.name,
      created_by: userId,
      ai_enabled: true,
      is_default: true,
      is_assistant: false,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  /**
   * Create the household's dedicated AI assistant room if the app opts into one
   * ({@link ChatBackendConfig.dedicatedAssistantRoom}) and it doesn't exist yet.
   * Flagged `is_assistant` so the shared core pins it on top, blocks deletion and
   * participant edits, and answers every message without an `@assistant` mention.
   */
  private async ensureAssistantRoom(householdId: string, userId: string): Promise<void> {
    const dedicated = this.config.dedicatedAssistantRoom;
    if (!dedicated) return;

    const { rooms } = this.config.tables;
    const existing = await this.db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.household_id, householdId), eq(rooms.is_assistant, true)))
      .get();
    if (existing) return;

    const timestamp = now();
    await this.db.insert(rooms).values({
      id: generateId(),
      household_id: householdId,
      name: dedicated.name,
      created_by: userId,
      ai_enabled: true,
      is_default: false,
      is_assistant: true,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  // ============ PARTICIPANTS ============

  /**
   * List the household's members alongside which are participants of the room.
   * `restricted=false` means the room is open to everyone (participant_ids is
   * informational only). Any member who can see the room may read this.
   */
  async getParticipants(
    householdId: string,
    userId: string,
    roomId: string
  ): Promise<{
    restricted: boolean;
    participant_ids: string[];
    members: Awaited<ReturnType<HouseholdService['getMembers']>>;
  }> {
    await this.verifyRoomAccess(householdId, userId, roomId);
    const room = await this.getRoomOrThrow(householdId, roomId);
    const participantIds = await this.getParticipantIds(roomId);
    const members = await this.householdService.getMembers(householdId, userId);
    return {
      restricted: this.isRestricted(room, participantIds),
      participant_ids: [...participantIds],
      members,
    };
  }

  /**
   * Owner-only: set the exact participant set for a non-default room. An empty
   * set re-opens the room to every household member. The acting owner is always
   * retained so they keep access.
   */
  async setParticipants(
    householdId: string,
    userId: string,
    roomId: string,
    participantUserIds: string[]
  ): Promise<{ restricted: boolean; participant_ids: string[] }> {
    const { participants } = this.config.tables;
    await this.householdService.verifyAccess(householdId, userId);
    await this.requireHouseholdOwner(householdId, userId);
    const room = await this.getRoomOrThrow(householdId, roomId);
    if (room.is_assistant) {
      throw new BadRequestError('The AI assistant chat is dedicated to you and the assistant — participants can’t be changed.');
    }
    if (room.is_default) {
      throw new BadRequestError('The General room is open to everyone and can’t be restricted.');
    }

    const memberIds = new Set((await this.memberNameMap(householdId)).keys());
    const set = new Set(participantUserIds.filter((id) => memberIds.has(id)));

    await this.db.delete(participants).where(eq(participants.room_id, roomId));

    if (set.size === 0) {
      return { restricted: false, participant_ids: [] };
    }

    set.add(userId); // never lock the acting owner out
    await this.writeParticipants(roomId, set, userId);
    return { restricted: true, participant_ids: [...set] };
  }

  private async writeParticipants(roomId: string, userIds: Set<string>, addedBy: string): Promise<void> {
    const { participants } = this.config.tables;
    const timestamp = now();
    const rows: schema.NewChatRoomParticipant[] = [...userIds].map((uid) => ({
      room_id: roomId,
      user_id: uid,
      added_by: addedBy,
      added_at: timestamp,
    }));
    if (rows.length > 0) {
      await this.db.insert(participants).values(rows);
    }
  }

  private async getParticipantIds(roomId: string): Promise<Set<string>> {
    const { participants } = this.config.tables;
    const rows = await this.db
      .select({ user_id: participants.user_id })
      .from(participants)
      .where(eq(participants.room_id, roomId))
      .all();
    return new Set(rows.map((r) => r.user_id));
  }

  /** A room is restricted when it's non-default AND has an explicit participant set. */
  private isRestricted(room: schema.ChatRoom, participantIds: Set<string>): boolean {
    return !room.is_default && participantIds.size > 0;
  }

  // ============ MESSAGES ============

  async getMessages(
    householdId: string,
    userId: string,
    roomId: string,
    opts: { before?: string; limit?: number } = {}
  ): Promise<ChatMessageResponse[]> {
    const { messages } = this.config.tables;
    await this.verifyRoomAccess(householdId, userId, roomId);

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const names = await this.memberNameMap(householdId);

    // Keyset pagination on created_at (descending), then reverse to ascending
    // so the client renders oldest → newest. `before` is an ISO created_at.
    const conditions = [eq(messages.room_id, roomId)];
    if (opts.before) {
      conditions.push(lt(messages.created_at, opts.before));
    }

    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.created_at))
      .limit(limit)
      .all();

    return rows.reverse().map((row) => this.serializeMessage(row, names));
  }

  /**
   * Persist a member's message (text and/or image attachments), broadcast it to
   * connected clients, notify tagged members (always) + offline members in the
   * room's audience, and — if the body @mentions the assistant in an AI-enabled
   * room — schedule an AI reply on the execution context.
   */
  async postMessage(
    householdId: string,
    userId: string,
    roomId: string,
    input: { body: string; attachments?: StoredAttachment[]; mentions?: string[]; replyToId?: string },
    waitUntil: (p: Promise<unknown>) => void
  ): Promise<ChatMessageResponse> {
    await this.verifyRoomAccess(householdId, userId, roomId);
    const room = await this.getRoomOrThrow(householdId, roomId);

    const body = input.body.trim();
    const attachments = this.sanitizeAttachments(input.attachments, householdId, roomId);
    if (!body && attachments.length === 0) {
      throw new BadRequestError('A message must have text or an image.');
    }

    // The audience = who can see this room. Mentions are intersected with it so
    // you can only tag people who are actually in the room.
    const audience = await this.roomAudience(householdId, room, roomId);
    const mentionIds = [
      ...new Set((input.mentions ?? []).filter((id) => id !== userId && audience.has(id))),
    ];

    const mentionsAssistant = ASSISTANT_MENTION.test(body);
    // Apps with a receipt-style assistant (Budget) opt into auto-answering an
    // image drop, so a user can post a receipt photo with "add to my spendings"
    // and get a reply without having to remember the @assistant tag.
    const hasImageAttachment = attachments.some((a) => isImageMime(a.mimeType));
    const triggerOnImage =
      !!this.config.assistant?.triggerOnImageAttachment && hasImageAttachment;
    // The dedicated AI assistant room is a 1:1 chat with the assistant — every
    // member message gets a reply, no `@assistant` mention required.
    const triggerAssistant =
      (room.is_assistant || mentionsAssistant || triggerOnImage) && room.ai_enabled;
    const metadata: Record<string, unknown> = {};
    if (mentionsAssistant) metadata.mentionsAssistant = true;
    if (mentionIds.length > 0) metadata.mentions = mentionIds;
    // Snapshot the quoted message so the reply preview survives even if the
    // original is later edited or deleted (and needs no read-time join).
    if (input.replyToId) {
      const replyTo = await this.buildReplySnapshot(householdId, roomId, input.replyToId);
      if (replyTo) metadata.replyTo = replyTo;
    }

    const message = await this.insertMessage({
      roomId,
      householdId,
      senderType: 'user',
      senderUserId: userId,
      body,
      attachments,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    });

    // Live fan-out + presence, then notify whoever wasn't connected. The
    // dedicated AI assistant room is a 1:1 chat with the assistant, so member
    // messages there never notify other household members (only the AI replies,
    // and AI replies don't notify).
    const connected = await this.broadcast(roomId, { type: 'message', message });
    const notifyAudience = room.is_assistant ? new Set<string>() : audience;
    waitUntil(
      this.notifyAudience(householdId, roomId, room.name, userId, notifyAudience, connected, message, mentionIds)
    );

    // Pull in the assistant if mentioned (or an image was dropped in an
    // image-triggered app) and the room allows it.
    if (triggerAssistant) {
      try {
        await assertCanUseAI(userId, this.env);
      } catch (err) {
        if (err instanceof AIAccessError || (err as Error).name === 'AIAccessError') {
          console.warn(`[${this.config.logTag}] entitlement denied; skipping assistant reply`, {
            householdId: householdId.slice(0, 8),
            code: (err as AIAccessError).code,
          });
          // Don't leave the member staring at silence — surface the gate.
          waitUntil(
            this.insertAssistantNotice(
              householdId,
              roomId,
              "I can't reply right now — AI access isn't available on this account. Check your plan or try again later."
            )
          );
          return message;
        }
        throw err;
      }
      await this.broadcast(roomId, { type: 'typing', sender: 'ai' });
      // Bill the assistant reply to the mentioning member's own key (BYOK) when
      // connected; their entitlement was just asserted above. The triggering
      // message's own attachments are handed through so the assistant can see
      // any receipt/photo (vision) and feed it to receipt-style tools.
      waitUntil(
        this.generateAssistantReply(
          householdId,
          roomId,
          userId,
          message.attachments ?? [],
          body,
          room
        )
      );
    }

    return message;
  }

  /**
   * Edit the caller's OWN message. AI/system/other-member messages are rejected.
   * Editing can change the text AND the image set: callers send the full desired
   * attachment list (drop removed images, include kept + newly-uploaded ones).
   * When `attachments` is omitted the existing images are left untouched; when it
   * is an empty array all images are removed.
   *
   * An edit that ADDS an `@assistant` mention pulls the assistant in, exactly as
   * posting it that way would have. Forgetting the handle and fixing it in place
   * is the obvious repair — without this the edit saved, the mention rendered,
   * and nothing ever answered. Only the transition counts: re-editing a message
   * that already mentioned the assistant does not ask it again.
   */
  async editMessage(
    householdId: string,
    userId: string,
    roomId: string,
    messageId: string,
    input: { body?: string; attachments?: StoredAttachment[] },
    waitUntil?: (p: Promise<unknown>) => void
  ): Promise<ChatMessageResponse> {
    const { messages } = this.config.tables;
    await this.verifyRoomAccess(householdId, userId, roomId);
    const row = await this.getMessageOrThrow(roomId, messageId);
    if (row.sender_type !== 'user' || row.sender_user_id !== userId) {
      throw new ForbiddenError('You can only edit your own messages.');
    }
    if (row.deleted_at) {
      throw new BadRequestError('This message was deleted.');
    }
    const trimmed = (input.body ?? '').trim();
    // Omitted `attachments` = keep the current images; an explicit array replaces them.
    const attachments =
      input.attachments === undefined
        ? this.parseStoredAttachments(row.attachments_json)
        : this.sanitizeAttachments(input.attachments, householdId, roomId);
    if (!trimmed && attachments.length === 0) {
      throw new BadRequestError('Message can’t be empty.');
    }

    const attachmentsJson = attachments.length > 0 ? JSON.stringify(attachments) : null;
    const timestamp = now();
    await this.db
      .update(messages)
      .set({ body: trimmed, attachments_json: attachmentsJson, edited_at: timestamp })
      .where(eq(messages.id, messageId));

    const names = await this.memberNameMap(householdId);
    const updated = this.serializeMessage(
      { ...row, body: trimmed, attachments_json: attachmentsJson, edited_at: timestamp },
      names
    );
    await this.broadcast(roomId, { type: 'message_updated', message: updated });

    // The mention was just added (not already there, not the assistant's own
    // room where every message is answered anyway) → answer it.
    const mentionAdded =
      ASSISTANT_MENTION.test(trimmed) && !ASSISTANT_MENTION.test(row.body ?? '');
    if (mentionAdded && waitUntil) {
      const room = await this.getRoomOrThrow(householdId, roomId);
      if (room.ai_enabled && !room.is_assistant) {
        try {
          await assertCanUseAI(userId, this.env);
          await this.broadcast(roomId, { type: 'typing', sender: 'ai' });
          waitUntil(
            this.generateAssistantReply(
              householdId,
              roomId,
              userId,
              updated.attachments ?? [],
              trimmed,
              room
            )
          );
        } catch (err) {
          if (err instanceof AIAccessError || (err as Error).name === 'AIAccessError') {
            console.warn(`[${this.config.logTag}] entitlement denied; skipping assistant reply`, {
              householdId: householdId.slice(0, 8),
              code: (err as AIAccessError).code,
            });
            waitUntil(
              this.insertAssistantNotice(
                householdId,
                roomId,
                "I can't reply right now — AI access isn't available on this account. Check your plan or try again later."
              )
            );
          } else {
            throw err;
          }
        }
      }
    }

    return updated;
  }

  /**
   * Delete a message. The author can always delete their own; a household owner
   * may delete any member's message (moderation). Soft-delete keeps the row so
   * pagination stays stable; the bubble renders a "message deleted" tombstone.
   */
  async deleteMessage(
    householdId: string,
    userId: string,
    roomId: string,
    messageId: string
  ): Promise<ChatMessageResponse> {
    const { messages } = this.config.tables;
    await this.verifyRoomAccess(householdId, userId, roomId);
    const row = await this.getMessageOrThrow(roomId, messageId);
    const isAuthor = row.sender_type === 'user' && row.sender_user_id === userId;
    if (!isAuthor) {
      // Only fall back to the (more expensive) owner check for non-authors.
      const isOwner = await this.isHouseholdOwner(householdId, userId);
      if (!isOwner) {
        throw new ForbiddenError('You can only delete your own messages.');
      }
    }

    const timestamp = now();
    await this.db
      .update(messages)
      .set({ deleted_at: timestamp, body: '', attachments_json: null, metadata_json: null })
      .where(eq(messages.id, messageId));

    const names = await this.memberNameMap(householdId);
    const deleted = this.serializeMessage(
      { ...row, body: '', attachments_json: null, metadata_json: null, deleted_at: timestamp },
      names
    );
    await this.broadcast(roomId, { type: 'message_deleted', message: deleted });
    return deleted;
  }

  async markRead(
    householdId: string,
    userId: string,
    roomId: string,
    lastReadMessageId?: string
  ): Promise<void> {
    const { reads } = this.config.tables;
    await this.verifyRoomAccess(householdId, userId, roomId);

    const timestamp = now();
    await this.db
      .insert(reads)
      .values({
        room_id: roomId,
        user_id: userId,
        last_read_message_id: lastReadMessageId ?? null,
        last_read_at: timestamp,
      })
      .onConflictDoUpdate({
        target: [reads.room_id, reads.user_id],
        set: { last_read_message_id: lastReadMessageId ?? null, last_read_at: timestamp },
      });

    // Opening/reading the room also clears its unread message notifications so
    // the in-app notification counter + OS badge don't keep counting messages
    // the user has now seen (both @mentions and generic new-message pings
    // reference the room via reference_type). Best-effort.
    try {
      const notifications = new NotificationService(this.env, this.env.DB);
      await notifications.markReferenceRead(userId, this.config.notif.referenceType, roomId);
    } catch (error) {
      console.error(`[${this.config.logTag}] clearing room notifications on read failed:`, error);
    }
  }

  // ============ AI ASSISTANT ============

  private async generateAssistantReply(
    householdId: string,
    roomId: string,
    userId: string,
    triggerAttachments: ChatAttachment[] = [],
    triggerBody = '',
    room?: schema.ChatRoom
  ): Promise<void> {
    const { messages } = this.config.tables;
    // The member's own connected key is as good as the managed one here; asking
    // only about the managed key would silence the assistant for BYOK accounts.
    if (!(await hasUsableProviderKey(this.env, userId, 'anthropic'))) {
      console.error(`[${this.config.logTag}] no usable AI key for this user; skipping assistant reply`);
      await this.insertAssistantNotice(
        householdId,
        roomId,
        "I couldn't reply — the AI service isn't configured. Please try again later."
      );
      return;
    }

    try {
      const names = await this.memberNameMap(householdId);
      const recent = await this.db
        .select()
        .from(messages)
        .where(eq(messages.room_id, roomId))
        .orderBy(desc(messages.created_at))
        .limit(AI_CONTEXT_MESSAGE_LIMIT)
        .all();

      const history = recent.reverse().filter((m) => !m.deleted_at);
      const transcript = history
        .map((m) => {
          const who =
            m.sender_type === 'ai'
              ? 'Assistant'
              : (m.sender_user_id && names.get(m.sender_user_id)) || 'Member';
          const attachmentNote =
            m.attachments_json && this.parseStoredAttachments(m.attachments_json).length > 0
              ? ' [shared an attachment]'
              : '';
          return `${who}: ${m.body}${attachmentNote}`;
        })
        .join('\n');

      // Image attachments on the triggering message become vision input so the
      // assistant can actually read a receipt/photo (not just its filename).
      const imageAttachments = triggerAttachments.filter((a) => isImageMime(a.mimeType));
      const imageBlocks = await this.loadVisionImageBlocks(imageAttachments);

      const toolCtx: ChatAssistantToolContext = {
        env: this.env,
        householdId,
        roomId,
        userId,
        imageAttachments,
        subject: room?.subject_type
          ? {
              type: room.subject_type,
              id: room.subject_id ?? '',
              label: room.subject_label ?? room.name,
              parentId: room.subject_parent_id ?? null,
              parentLabel: room.subject_parent_label ?? null,
            }
          : null,
      };
      const configured = this.config.assistant?.tools;
      const tools = typeof configured === 'function' ? configured(toolCtx) : configured;

      // Fast-path: receipt photo + scan/log intent. Run scan_receipt_for_review
      // up front so extraction doesn't depend on the vision model surviving a
      // large PNG payload in waitUntil (that was silently dropping replies).
      let receiptPrefetch = '';
      let receiptDraft: ChatReceiptDraft | undefined;
      let budgetMutated = false;
      const wantsReceipt =
        imageAttachments.length > 0 &&
        RECEIPT_INTENT.test(triggerBody) &&
        !!this.config.assistant?.runTool &&
        (tools ?? []).some((t) => t.name === RECEIPT_SCAN_TOOL);
      if (wantsReceipt && this.config.assistant?.runTool) {
        try {
          const ret = await this.config.assistant.runTool(toolCtx, {
            name: RECEIPT_SCAN_TOOL,
            input: {},
          });
          if (typeof ret === 'string') {
            receiptPrefetch = ret;
          } else {
            receiptPrefetch = ret.result;
            if (ret.receiptDraft) receiptDraft = ret.receiptDraft;
            if (ret.budgetMutated) budgetMutated = true;
          }
          console.log(`[${this.config.logTag}] receipt fast-path:`, receiptPrefetch.slice(0, 120));
        } catch (error) {
          console.error(`[${this.config.logTag}] receipt fast-path failed:`, error);
          receiptPrefetch =
            error instanceof Error
              ? `Receipt scan failed: ${error.message}`
              : 'Receipt scan failed unexpectedly.';
        }
      }

      const { apiKey } = await resolveProviderApiKey(this.env, userId, 'anthropic');
      const provider = createProviderAdapter({
        provider: 'anthropic',
        apiKey,
        options: {
          onUsage: usageRecorderFor(this.env, { feature: this.config.usageFeature, householdId, userId }),
        },
      });
      // Prefer a stronger vision model only when we actually attached image
      // blocks; after a successful receipt fast-path, Haiku is enough to narrate.
      const model =
        imageBlocks.length > 0 && !receiptPrefetch
          ? this.env.AIHOUSEKEEPER_BRIEFING_MODEL ||
            this.env.AIHOUSEKEEPER_NUDGE_MODEL ||
            'claude-haiku-4-5-20251001'
          : this.env.AIHOUSEKEEPER_NUDGE_MODEL || 'claude-haiku-4-5-20251001';

      const instruction = receiptPrefetch
        ? `Reply to the latest message. A receipt was already scanned with this result — relay it naturally and briefly. Remind them to review & confirm in the app. Do NOT call ${RECEIPT_SCAN_TOOL} again:\n${receiptPrefetch}`
        : imageBlocks.length > 0
          ? `Reply to the latest message. The member attached the image(s) above — read them and respond to what they asked. If they want a receipt logged, call ${RECEIPT_SCAN_TOOL}. Keep it concise and helpful.`
          : imageAttachments.length > 0
            ? `Reply to the latest message. The member shared image attachment(s) but they could not be loaded for vision — if they asked to log a receipt, call ${RECEIPT_SCAN_TOOL} (it reads the original file). Keep it concise.`
            : `Reply to the latest message. Keep it concise and helpful.`;

      // What this conversation is ABOUT, when the room has a subject. The
      // snapshot came from the client (the only party that can read a
      // local-first project), so it is stated as the household's own records
      // rather than as a retrieved document — the assistant must prefer it over
      // its priors about kitchens in general, and must not treat a gap in it as
      // permission to invent the missing number.
      const subjectBlock = this.buildSubjectBlock(room);

      // Live app-state awareness (e.g. the household's current budget), injected
      // up front so the assistant answers from real numbers without a round-trip.
      let contextBlock = '';
      if (this.config.assistant?.buildContext) {
        try {
          const built = await this.config.assistant.buildContext(toolCtx);
          if (built) contextBlock = `\n\n${built}`;
        } catch (error) {
          console.error(`[${this.config.logTag}] assistant buildContext failed:`, error);
        }
      }

      // After a successful receipt fast-path, skip re-sending heavy image bytes
      // to the model — the tool already read the file from R2.
      const visionForModel = receiptPrefetch ? [] : imageBlocks;

      // Running message list for the (possibly multi-turn) tool loop.
      const convo: GenerateMessage[] = [
        {
          role: 'user',
          content: [
            ...visionForModel,
            {
              type: 'text',
              text:
                `${subjectBlock}Here is the recent conversation in this household chat room:\n\n${transcript}` +
                `${contextBlock}\n\n${instruction}`,
            },
          ],
        },
      ];

      let text = '';
      const uiBlocks: ChatUiBlock[] = [];
      /** Client-executed writes accumulated across the tool loop. */
      const actions: unknown[] = [];
      for (let iteration = 0; iteration < MAX_ASSISTANT_TOOL_ITERATIONS; iteration++) {
        const result = await provider.generate({
          model,
          systemPrompt: this.config.assistantPrompt,
          messages: convo,
          tools: tools && tools.length > 0 ? tools : undefined,
          maxTokens: 900,
        });

        const toolUses = result.content.filter(
          (b): b is { type: 'tool_use'; id: string; name: string; input: unknown } =>
            b.type === 'tool_use'
        );
        text = result.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();

        // No tool requested (or none configured / handler missing) → this is the
        // model's final answer.
        if (
          result.stopReason !== 'tool_use' ||
          toolUses.length === 0 ||
          !this.config.assistant?.runTool
        ) {
          break;
        }

        // Echo the assistant's turn (text + tool_use blocks) back, then append a
        // tool_result for each requested call, and loop for the model's summary.
        convo.push({ role: 'assistant', content: result.content });
        const runTool = this.config.assistant.runTool;
        const toolResults: ToolResultBlock[] = [];
        for (const call of toolUses) {
          let output: string;
          try {
            const ret = await runTool(toolCtx, {
              name: call.name,
              input: (call.input as Record<string, unknown>) ?? {},
            });
            if (typeof ret === 'string') {
              output = ret;
            } else {
              output = ret.result;
              if (ret.ui) uiBlocks.push(...ret.ui);
              if (ret.receiptDraft) receiptDraft = ret.receiptDraft;
              if (ret.budgetMutated) budgetMutated = true;
              if (ret.actions?.length) actions.push(...ret.actions);
            }
            if (
              BUDGET_MUTATING_TOOLS.has(call.name) &&
              !/^.*(failed|couldn't|needs|Unknown)/i.test(output)
            ) {
              budgetMutated = true;
            }
          } catch (err) {
            console.error(`[${this.config.logTag}] assistant tool '${call.name}' failed:`, err);
            output =
              err instanceof Error
                ? `The action failed: ${err.message}`
                : 'The action failed unexpectedly.';
          }
          toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: output });
        }
        convo.push({ role: 'user', content: toolResults });
      }

      // If the model returned nothing but we already logged a receipt, surface that.
      if (!text && receiptPrefetch) {
        text = receiptPrefetch;
      }

      // A reply with a rendered chart/card but no prose still ships (the visual
      // is the answer) — and so does one carrying an action, because the write
      // is the answer and dropping the message would strand it. A turn with
      // none of the three is dropped.
      if (!text && uiBlocks.length === 0 && actions.length === 0) {
        await this.insertAssistantNotice(
          householdId,
          roomId,
          "I wasn't able to produce a reply. Please try again."
        );
        return;
      }

      const metadata: Record<string, unknown> = { model };
      if (uiBlocks.length > 0) metadata.ui = uiBlocks;
      if (receiptPrefetch) metadata.receiptFastPath = true;
      // Scan-only draft for the confirm screen — not a mutation until save.
      if (receiptDraft) metadata.receiptDraft = receiptDraft;
      // Clients use this to refetch dashboard / spendings / savings without
      // waiting for the next manual pull-to-refresh.
      if (budgetMutated) metadata.budgetMutated = true;
      if (actions.length > 0) {
        metadata.actions = actions;
        /**
         * Which member's message produced these, and therefore whose device
         * applies them.
         *
         * Every member of the room receives this message over the socket. If
         * each applied the actions, one "add the oak flooring" would add it
         * three times — the write is idempotent nowhere. So exactly one device
         * runs it: the one belonging to the member who asked. Everyone else
         * renders the same card as a record of what happened.
         *
         * The client pairs this with the message id as a dedupe key, which is
         * what covers the other direction: the same device seeing the same
         * message twice (a reconnect, a re-render, a scroll back).
         */
        metadata.actor_user_id = userId;
      }
      const aiMessage = await this.insertMessage({
        roomId,
        householdId,
        senderType: 'ai',
        senderUserId: null,
        body: text,
        attachments: [],
        metadata,
      });
      await this.broadcast(roomId, { type: 'message', message: aiMessage });
    } catch (error) {
      console.error(`[${this.config.logTag}] assistant reply failed:`, error);
      try {
        await this.insertAssistantNotice(
          householdId,
          roomId,
          "Sorry — I hit an error processing that message. Please try again (for receipts, resend the photo with “scan receipt” or “add to my spendings”)."
        );
      } catch (noticeErr) {
        console.error(`[${this.config.logTag}] failed to post assistant error notice:`, noticeErr);
      }
    }
  }

  /**
   * The "what this chat is about" preamble for a subject-scoped room.
   *
   * Returns '' for an ordinary room, and for a subject room whose client has not
   * written a snapshot yet — a bare title with no facts under it is worse than
   * nothing, because it invites the model to fill the gap from its priors.
   */
  private buildSubjectBlock(room: schema.ChatRoom | undefined): string {
    if (!room?.subject_type) return '';
    const text = this.readSubjectContext(room);
    if (!text) return '';

    const what = room.subject_label || room.name;
    const within = room.subject_parent_label ? `, part of the project “${room.subject_parent_label}”` : '';
    return (
      `This conversation is about “${what}”${within}. The following is the household's OWN record of it, ` +
      `taken from their app moments ago. Treat it as fact and prefer it over any general assumption. ` +
      `If it does not answer something, say so and ask — do not fill the gap with a plausible number.\n\n` +
      `${text}\n\n`
    );
  }

  /** Insert a short AI message + broadcast so the member isn't left without a reply. */
  private async insertAssistantNotice(
    householdId: string,
    roomId: string,
    body: string
  ): Promise<void> {
    const aiMessage = await this.insertMessage({
      roomId,
      householdId,
      senderType: 'ai',
      senderUserId: null,
      body,
      attachments: [],
      metadata: { notice: true },
    });
    await this.broadcast(roomId, { type: 'message', message: aiMessage });
  }

  /**
   * Fetch the given image attachments from R2 and turn them into base64 vision
   * blocks for the model. Best-effort: unreadable objects or unsupported types
   * are skipped (the assistant can still reply to the text). Capped at
   * {@link MAX_VISION_IMAGES}. Large photos are downsampled to keep waitUntil
   * turns under Worker CPU/memory limits.
   */
  private async loadVisionImageBlocks(attachments: ChatAttachment[]): Promise<ImageBlock[]> {
    const blocks: ImageBlock[] = [];
    for (const attachment of attachments.slice(0, MAX_VISION_IMAGES)) {
      const mediaType = toVisionMime(attachment.mimeType);
      if (!mediaType) continue;
      try {
        const object = await this.env.REPORTS_BUCKET.get(attachment.key);
        if (!object) {
          console.warn(`[${this.config.logTag}] vision image missing in R2:`, attachment.key.slice(0, 48));
          continue;
        }
        const raw = await object.arrayBuffer();
        const down = await this.downsampleVisionImage(raw, mediaType);
        if (down.data.length > VISION_MAX_BASE64_CHARS) {
          console.warn(`[${this.config.logTag}] vision image still too large after downsample; skipping`);
          continue;
        }
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: down.mediaType, data: down.data },
        });
      } catch (error) {
        console.error(`[${this.config.logTag}] loading vision image failed:`, error);
      }
    }
    return blocks;
  }

  /**
   * Downsample to ≤1568px / ≤1.15MP when OffscreenCanvas is available (Workers).
   * Falls back to the original bytes otherwise.
   */
  private async downsampleVisionImage(
    data: ArrayBuffer,
    mediaType: VisionImageMime
  ): Promise<{ data: string; mediaType: VisionImageMime }> {
    const g = globalThis as unknown as {
      createImageBitmap?: (b: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
      OffscreenCanvas?: new (
        w: number,
        h: number
      ) => {
        getContext: (t: '2d') => {
          drawImage: (img: unknown, x: number, y: number, w: number, h: number) => void;
        } | null;
        convertToBlob: (opts?: { type?: string; quality?: number }) => Promise<Blob>;
      };
    };

    if (!g.createImageBitmap || !g.OffscreenCanvas) {
      return { data: this.arrayBufferToBase64(data), mediaType };
    }

    try {
      const blob = new Blob([data], { type: mediaType });
      const bitmap = await g.createImageBitmap(blob);
      const { width, height } = bitmap;
      let scale = 1;
      const longest = Math.max(width, height);
      if (longest > VISION_MAX_DIMENSION) scale = VISION_MAX_DIMENSION / longest;
      const pixels = width * height * scale * scale;
      if (pixels > VISION_MAX_PIXELS) {
        scale *= Math.sqrt(VISION_MAX_PIXELS / pixels);
      }
      if (scale >= 0.98) {
        bitmap.close?.();
        return { data: this.arrayBufferToBase64(data), mediaType };
      }
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));
      const canvas = new g.OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close?.();
        return { data: this.arrayBufferToBase64(data), mediaType };
      }
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      bitmap.close?.();
      // Prefer JPEG for vision payloads — much smaller than PNG for photos.
      const outType: VisionImageMime = 'image/jpeg';
      const outBlob = await canvas.convertToBlob({ type: outType, quality: 0.82 });
      return { data: this.arrayBufferToBase64(await outBlob.arrayBuffer()), mediaType: outType };
    } catch {
      return { data: this.arrayBufferToBase64(data), mediaType };
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.byteLength; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  // ============ HELPERS ============

  private async insertMessage(args: {
    roomId: string;
    householdId: string;
    senderType: 'user' | 'ai' | 'system';
    senderUserId: string | null;
    body: string;
    attachments: StoredAttachment[];
    metadata: Record<string, unknown> | null;
  }): Promise<ChatMessageResponse> {
    const { messages, rooms } = this.config.tables;
    const timestamp = now();
    const id = generateId();
    await this.db.insert(messages).values({
      id,
      room_id: args.roomId,
      household_id: args.householdId,
      sender_type: args.senderType,
      sender_user_id: args.senderUserId,
      body: args.body,
      attachments_json: args.attachments.length > 0 ? JSON.stringify(args.attachments) : null,
      metadata_json: args.metadata ? JSON.stringify(args.metadata) : null,
      created_at: timestamp,
    });
    // Bump the room so list ordering reflects recent activity.
    await this.db.update(rooms).set({ updated_at: timestamp }).where(eq(rooms.id, args.roomId));

    let senderName: string | null = null;
    if (args.senderUserId) {
      const names = await this.memberNameMap(args.householdId);
      senderName = names.get(args.senderUserId) ?? null;
    }

    return {
      id,
      room_id: args.roomId,
      sender_type: args.senderType,
      sender_user_id: args.senderUserId,
      sender_name: senderName,
      body: args.body,
      attachments: args.attachments.length > 0 ? args.attachments.map((a) => this.withUrl(a)) : null,
      mentions:
        args.metadata && Array.isArray(args.metadata.mentions)
          ? (args.metadata.mentions as string[])
          : null,
      reply_to:
        args.metadata && args.metadata.replyTo
          ? (args.metadata.replyTo as ChatReplyPreview)
          : null,
      metadata: args.metadata,
      edited_at: null,
      deleted_at: null,
      created_at: timestamp,
    };
  }

  /** Parse a row's stored `attachments_json` back into the internal shape (empty on null/malformed). */
  private parseStoredAttachments(attachmentsJson: string | null): StoredAttachment[] {
    if (!attachmentsJson) return [];
    try {
      const parsed = JSON.parse(attachmentsJson) as StoredAttachment[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Validate + normalize incoming attachments; only keys under this room's R2 prefix are accepted. */
  private sanitizeAttachments(
    attachments: StoredAttachment[] | undefined,
    householdId: string,
    roomId: string
  ): StoredAttachment[] {
    if (!attachments || attachments.length === 0) return [];
    const prefix = `${this.config.r2Prefix}/${householdId}/${roomId}/`;
    const clean = attachments
      .filter((a) => a && typeof a.key === 'string' && a.key.startsWith(prefix))
      .slice(0, MAX_ATTACHMENTS)
      .map((a) => ({
        key: a.key,
        mimeType: typeof a.mimeType === 'string' ? a.mimeType : undefined,
        name: typeof a.name === 'string' ? a.name.slice(0, 200) : undefined,
        width: typeof a.width === 'number' ? a.width : undefined,
        height: typeof a.height === 'number' ? a.height : undefined,
      }));
    return clean;
  }

  private withUrl(a: StoredAttachment): ChatAttachment {
    return { ...a, url: `${this.env.API_URL}/files/${encodeURIComponent(a.key)}` };
  }

  /**
   * Push an event to the room's ChatRoomDO. Returns the set of userIds with a
   * live socket so the caller can skip notifying members who are live.
   */
  private async broadcast(roomId: string, event: unknown): Promise<Set<string>> {
    try {
      const stub = this.env.CHAT_ROOM.get(this.env.CHAT_ROOM.idFromName(roomId));
      const res = await stub.fetch('https://chat-room/broadcast', {
        method: 'POST',
        body: JSON.stringify(event),
      });
      const data = (await res.json()) as { connectedUserIds?: string[] };
      return new Set(data.connectedUserIds ?? []);
    } catch (error) {
      console.error(`[${this.config.logTag}] broadcast failed:`, error);
      return new Set();
    }
  }

  /**
   * Notify members about a new message. Tagged members ALWAYS get a "mentioned
   * you" notification (even if a socket is open — mentions are high-signal).
   * Everyone else in the room's audience who isn't connected gets the generic
   * new-message notification. The sender and already-mentioned users are skipped
   * so nobody is double-notified.
   */
  private async notifyAudience(
    householdId: string,
    roomId: string,
    roomName: string,
    senderUserId: string,
    audience: Set<string>,
    connectedUserIds: Set<string>,
    message: ChatMessageResponse,
    mentionIds: string[]
  ): Promise<void> {
    const { notif, logTag } = this.config;
    try {
      const names = await this.memberNameMap(householdId);
      const senderName = names.get(senderUserId) || 'Someone';
      const notifications = new NotificationService(this.env, this.env.DB);
      const preview = this.previewOf(message);
      const mentioned = new Set(mentionIds);

      const sends: Promise<void>[] = [];

      // High-signal @mentions — always notified.
      for (const uid of mentionIds) {
        sends.push(
          notifications
            .sendNotification({
              userId: uid,
              type: notif.mentionType,
              title: `${senderName} mentioned you`,
              body: `${roomName}: ${preview}`,
              data: { type: notif.mentionType, roomId, roomName, householdId, screen: notif.screen },
              referenceType: notif.referenceType,
              referenceId: roomId,
            })
            .catch((e) => console.error(`[${logTag}] mention push failed:`, e))
        );
      }

      // Everyone else in the audience who isn't live gets the generic ping.
      for (const uid of audience) {
        if (uid === senderUserId || mentioned.has(uid) || connectedUserIds.has(uid)) continue;
        sends.push(
          notifications
            .sendNotification({
              userId: uid,
              type: notif.messageType,
              title: `${senderName} · ${roomName}`,
              body: preview,
              data: { type: notif.messageType, roomId, roomName, householdId, screen: notif.screen },
              referenceType: notif.referenceType,
              referenceId: roomId,
            })
            .catch((e) => console.error(`[${logTag}] push failed:`, e))
        );
      }

      await Promise.all(sends);
    } catch (error) {
      console.error(`[${logTag}] notifyAudience failed:`, error);
    }
  }

  /**
   * Build the quoted-reply snapshot for `replyToId` within this room. Returns
   * null if the target doesn't exist or was deleted (nothing to quote).
   */
  private async buildReplySnapshot(
    householdId: string,
    roomId: string,
    replyToId: string
  ): Promise<ChatReplyPreview | null> {
    const { messages } = this.config.tables;
    const row = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, replyToId), eq(messages.room_id, roomId)))
      .get();
    if (!row || row.deleted_at) return null;

    const names = await this.memberNameMap(householdId);
    const senderName =
      row.sender_type === 'ai'
        ? 'Assistant'
        : row.sender_user_id
          ? names.get(row.sender_user_id) ?? null
          : null;

    let preview = '';
    if (row.body) {
      preview = row.body.length > 140 ? `${row.body.slice(0, 137)}...` : row.body;
    } else {
      const count = this.parseStoredAttachments(row.attachments_json).length;
      if (count > 0) preview = count === 1 ? '📷 Photo' : `📷 ${count} photos`;
    }

    return {
      id: row.id,
      sender_type: row.sender_type as ChatReplyPreview['sender_type'],
      sender_name: senderName,
      preview,
    };
  }

  /** Short notification/preview text for a message (photo-only → "📷 Photo"). */
  private previewOf(message: ChatMessageResponse): string {
    if (message.body) {
      return message.body.length > 140 ? `${message.body.slice(0, 137)}...` : message.body;
    }
    const count = message.attachments?.length ?? 0;
    if (count > 0) return count === 1 ? '📷 Photo' : `📷 ${count} photos`;
    return '';
  }

  /**
   * The set of user_ids who can see a room: every household member for open /
   * default rooms, or the explicit participant set for restricted rooms.
   */
  private async roomAudience(
    householdId: string,
    room: schema.ChatRoom,
    roomId: string
  ): Promise<Set<string>> {
    const participantIds = await this.getParticipantIds(roomId);
    if (this.isRestricted(room, participantIds)) return participantIds;
    return new Set((await this.memberNameMap(householdId)).keys());
  }

  /** Verify household membership AND that the caller can see this specific room. */
  private async verifyRoomAccess(
    householdId: string,
    userId: string,
    roomId: string
  ): Promise<schema.ChatRoom> {
    await this.householdService.verifyAccess(householdId, userId);
    const room = await this.getRoomOrThrow(householdId, roomId);
    const participantIds = await this.getParticipantIds(roomId);
    if (this.isRestricted(room, participantIds) && !participantIds.has(userId)) {
      // Don't leak existence of a room the caller isn't in.
      throw new NotFoundError('Chat room');
    }
    return room;
  }

  private async getRoomOrThrow(householdId: string, roomId: string): Promise<schema.ChatRoom> {
    const { rooms } = this.config.tables;
    const room = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.household_id, householdId)))
      .get();
    if (!room) {
      throw new NotFoundError('Chat room');
    }
    return room;
  }

  private async getMessageOrThrow(roomId: string, messageId: string): Promise<schema.ChatMessage> {
    const { messages } = this.config.tables;
    const row = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.room_id, roomId)))
      .get();
    if (!row) {
      throw new NotFoundError('Message');
    }
    return row;
  }

  private async isHouseholdOwner(householdId: string, userId: string): Promise<boolean> {
    const row = await this.db
      .select({ role: schema.householdMembers.role })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          eq(schema.householdMembers.user_id, userId),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .get();
    return row?.role === 'owner';
  }

  private async requireHouseholdOwner(householdId: string, userId: string): Promise<void> {
    if (!(await this.isHouseholdOwner(householdId, userId))) {
      throw new ForbiddenError('Only a household owner can do that.');
    }
  }

  private async unreadCount(roomId: string, userId: string): Promise<number> {
    const { messages, reads } = this.config.tables;
    const read = await this.db
      .select({ last_read_at: reads.last_read_at })
      .from(reads)
      .where(and(eq(reads.room_id, roomId), eq(reads.user_id, userId)))
      .get();

    const conditions = [eq(messages.room_id, roomId)];
    if (read?.last_read_at) {
      conditions.push(gt(messages.created_at, read.last_read_at));
    }

    const row = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(and(...conditions))
      .get();

    return row?.count ?? 0;
  }

  /** Map of userId → display name (falling back to email) for a household. */
  private async memberNameMap(householdId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({
        user_id: schema.householdMembers.user_id,
        display_name: schema.users.display_name,
        email: schema.users.email,
      })
      .from(schema.householdMembers)
      .innerJoin(schema.users, eq(schema.householdMembers.user_id, schema.users.id))
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .all();

    return new Map(rows.map((r) => [r.user_id, r.display_name || r.email]));
  }

  private serializeMessage(row: schema.ChatMessage, names: Map<string, string>): ChatMessageResponse {
    let metadata: Record<string, unknown> | null = null;
    if (row.metadata_json) {
      try {
        metadata = JSON.parse(row.metadata_json);
      } catch {
        metadata = null;
      }
    }

    let attachments: ChatAttachment[] | null = null;
    if (row.attachments_json) {
      try {
        const parsed = JSON.parse(row.attachments_json) as StoredAttachment[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          attachments = parsed.map((a) => this.withUrl(a));
        }
      } catch {
        attachments = null;
      }
    }

    const mentions =
      metadata && Array.isArray(metadata.mentions) ? (metadata.mentions as string[]) : null;
    const replyTo =
      metadata && metadata.replyTo ? (metadata.replyTo as ChatReplyPreview) : null;

    return {
      id: row.id,
      room_id: row.room_id,
      sender_type: row.sender_type as ChatMessageResponse['sender_type'],
      sender_user_id: row.sender_user_id,
      sender_name: row.sender_user_id ? names.get(row.sender_user_id) ?? null : null,
      body: row.body,
      attachments,
      mentions,
      reply_to: replyTo,
      metadata,
      edited_at: row.edited_at ?? null,
      deleted_at: row.deleted_at ?? null,
      created_at: row.created_at,
    };
  }

  private serializeRoom(
    room: schema.ChatRoom,
    restricted: boolean,
    lastMessage: ChatMessageResponse | null,
    unread: number
  ): ChatRoomResponse {
    return {
      id: room.id,
      name: room.name,
      ai_enabled: room.ai_enabled,
      is_default: room.is_default,
      is_assistant: room.is_assistant,
      restricted,
      subject: this.serializeSubject(room),
      created_by: room.created_by,
      created_at: room.created_at,
      updated_at: room.updated_at,
      last_message: lastMessage,
      unread_count: unread,
    };
  }

  /** The subject block for a room, or null when it is an ordinary room. */
  private serializeSubject(room: schema.ChatRoom): ChatRoomSubject | null {
    if (!room.subject_type || !room.subject_id) return null;
    return {
      type: room.subject_type,
      id: room.subject_id,
      label: room.subject_label ?? room.name,
      parent_id: room.subject_parent_id ?? null,
      parent_label: room.subject_parent_label ?? null,
      has_context: !!room.subject_context_json,
    };
  }
}
