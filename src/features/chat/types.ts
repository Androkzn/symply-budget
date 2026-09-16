/**
 * Shared household-chat data types. ONE definition reused by every app's chat
 * (House, Budget, and future apps) — see `src/features/chat/`. Per-app values
 * (route segment, store, notification namespace) live in {@link ChatConfig}.
 */
import type { HouseholdMember } from '@api/households';

export type ChatSenderType = 'user' | 'ai' | 'system';

/** An image or document attachment on a chat message (served publicly-by-key from R2). */
export interface ChatAttachment {
  key: string;
  url: string;
  mimeType?: string;
  /** Original filename — the label shown for non-image (document) attachments. */
  name?: string;
  width?: number;
  height?: number;
}

/** A denormalized snapshot of the message a reply is quoting. */
export interface ChatReplyPreview {
  id: string;
  sender_type: ChatSenderType;
  /** 'Assistant' for the AI; display name for members; null when unknown. */
  sender_name: string | null;
  /** Short body/attachment preview shown in the quoted block. */
  preview: string;
}

/**
 * Rich UI the assistant can attach to a reply (charts / tables / insights),
 * rendered natively. Mirrors `backend/src/services/chat/chat-room-service-core.ts`
 * — keep the two in sync. Lives on an AI message's `metadata.ui`.
 * Styling is client-only (brand `useAppColors`); payloads are semantic.
 */
export interface ChatChartSpec {
  type: 'bar' | 'pie' | 'donut' | 'line';
  title?: string;
  valueFormat?: 'currency' | 'number' | 'percent';
  data: Array<{ label: string; value: number }>;
}

export interface ChatStatSpec {
  label: string;
  value: string;
  caption?: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
}

export interface ChatTableSpec {
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface ChatInsightSpec {
  title: string;
  body: string;
  bullets?: string[];
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
}

export interface ChatDiagramSpec {
  title?: string;
  nodes: Array<{ id: string; label: string; value?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export type ChatUiBlock =
  | { kind: 'chart'; chart: ChatChartSpec }
  | { kind: 'stats'; stats: ChatStatSpec[] }
  | { kind: 'table'; table: ChatTableSpec }
  | { kind: 'insight'; insight: ChatInsightSpec }
  | { kind: 'diagram'; diagram: ChatDiagramSpec };

const UI_KINDS = new Set(['chart', 'stats', 'table', 'insight', 'diagram']);

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_type: ChatSenderType;
  sender_user_id: string | null;
  sender_name: string | null;
  body: string;
  attachments: ChatAttachment[] | null;
  /** user_ids tagged in this message. */
  mentions: string[] | null;
  /** Set when this message replies to another; a quoted snapshot for rendering. */
  reply_to: ChatReplyPreview | null;
  metadata: Record<string, unknown> | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

/** Read an AI message's attached UI blocks from its metadata (safe/lenient). */
export function chatMessageUiBlocks(message: ChatMessage): ChatUiBlock[] {
  const ui = message.metadata?.ui;
  if (!Array.isArray(ui)) return [];
  return ui.filter(
    (b): b is ChatUiBlock =>
      !!b && typeof b === 'object' && UI_KINDS.has((b as ChatUiBlock).kind)
  );
}

/**
 * The kinds of thing a chat can be attached to. Mirrors the backend allow-list
 * in `services/chat/configs.ts`.
 */
export const CHAT_SUBJECT_PROJECT = 'home_project';
export const CHAT_SUBJECT_MATERIAL = 'home_project_material';

export type ChatSubjectType =
  | typeof CHAT_SUBJECT_PROJECT
  | typeof CHAT_SUBJECT_MATERIAL;

/**
 * What a subject-scoped room is ABOUT — the project or material the
 * conversation belongs to. Null on every ordinary household room.
 *
 * `id` is the project's / selection's own id, and it carries NO foreign key
 * server-side: a House V2 project is Tier A (on-device), chat is Tier B
 * (server), so the Worker frequently cannot resolve this id at all. That is why
 * `label` is denormalized onto the room — it is the only title the rooms list
 * can render for a local-first household.
 */
export interface ChatRoomSubject {
  type: ChatSubjectType | string;
  id: string;
  label: string;
  /** The project a material chat belongs to; null for a project chat. */
  parent_id: string | null;
  parent_label: string | null;
  /** True once a client has written a grounding snapshot for the assistant. */
  has_context: boolean;
}

export interface ChatRoom {
  id: string;
  name: string;
  ai_enabled: boolean;
  is_default: boolean;
  /** True for the dedicated 1:1 AI assistant room (pinned, undeletable, mention-free). */
  is_assistant: boolean;
  /** True when the room is limited to an explicit participant set. */
  restricted: boolean;
  /**
   * Set when this room belongs to something (a project, a material). Optional
   * rather than nullable because a Worker predating migration 0167 omits it
   * entirely, and every reader must treat "absent" as "ordinary room".
   */
  subject?: ChatRoomSubject | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_message: ChatMessage | null;
  unread_count: number;
}

/** An attachment the client sends up with a new message (key from the upload flow). */
export interface OutgoingAttachment {
  key: string;
  mimeType?: string;
  name?: string;
  width?: number;
  height?: number;
}

export interface ChatParticipants {
  restricted: boolean;
  participant_ids: string[];
  members: HouseholdMember[];
}

/** The nav stack shared by every app's chat (rooms list → room → settings). */
export type ChatStackParamList = {
  ChatRoomsList: undefined;
  ChatRoom: { roomId: string; roomName: string; aiEnabled?: boolean };
  ChatRoomSettings: { roomId: string; roomName: string; canManage: boolean };
};
