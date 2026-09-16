/**
 * Shared household-chat API client factory. `createChatApi(routeSegment)` binds
 * one API object to an app's backend routes (`/households/:hid/<routeSegment>`).
 * Every app builds its client from this — a change here applies to all of them;
 * only the `routeSegment` differs (data isolation lives in the backend tables).
 */
import { apiClient } from '@api/client';

import type {
  ChatMessage,
  ChatParticipants,
  ChatRoom,
  ChatSubjectType,
  OutgoingAttachment,
} from './types';

interface CreateRoomRequest {
  name: string;
  ai_enabled?: boolean;
  participant_ids?: string[];
}

/**
 * "Open the chat about this thing." Idempotent — the caller is a Chat button on
 * a project or material screen, so a second tap (or a second member tapping at
 * the same moment) must land in the same conversation, not a twin of it.
 */
export interface OpenSubjectRoomRequest {
  subject_type: ChatSubjectType | string;
  subject_id: string;
  subject_label: string;
  /** A material chat's project. Required for materials, absent for projects. */
  subject_parent_id?: string | null;
  subject_parent_label?: string | null;
  /**
   * The assistant's grounding snapshot — what this project/material IS, in the
   * client's own words, refreshed on every open. The client sends it because for
   * a local-first household the Worker has never seen the project this chat is
   * about, so this is the only route by which the AI can know the real budget,
   * the real phases and the real price per square foot.
   */
  context?: string | null;
  /** Restrict the room to the subject's own audience (e.g. a draft project's). */
  participant_ids?: string[];
  /** Room title override; defaults to the subject label. */
  name?: string;
}

interface SendMessageInput {
  body?: string;
  attachments?: OutgoingAttachment[];
  mentions?: string[];
  /** Id of the message this one replies to (renders a quoted preview). */
  reply_to_id?: string;
}

interface ListRoomsResponse {
  rooms: ChatRoom[];
}

interface RoomResponse {
  room: ChatRoom;
}

interface MessagesResponse {
  messages: ChatMessage[];
}

interface MessageResponse {
  message: ChatMessage;
}

interface ImageUploadUrlResponse {
  image_id: string;
  image_key: string;
  upload_url: string;
  content_type: string;
}

export function createChatApi(routeSegment: string) {
  const base = (householdId: string) => `/households/${householdId}/${routeSegment}`;

  return {
    listRooms: (householdId: string) =>
      apiClient.get<ListRoomsResponse>(base(householdId)).then((res) => res.data.rooms),

    createRoom: (householdId: string, data: CreateRoomRequest) =>
      apiClient.post<RoomResponse>(base(householdId), data).then((res) => res.data.room),

    /**
     * Get-or-create the one room for a subject, refreshing its AI grounding
     * snapshot in the same call. Safe to call on every screen open.
     */
    openSubjectRoom: (householdId: string, data: OpenSubjectRoomRequest) =>
      apiClient
        .post<RoomResponse>(`${base(householdId)}/subject`, data)
        .then((res) => res.data.room),

    /**
     * Delete a subject's room and every room hanging off it — deleting a project
     * takes its material chats with it. Best-effort cleanup called AFTER the
     * subject itself is gone; there is no FK to cascade from (the project may
     * only ever have existed on-device).
     */
    deleteSubjectRooms: (
      householdId: string,
      subjectType: ChatSubjectType | string,
      subjectId: string
    ) =>
      apiClient
        .delete<{ success: boolean; deleted: number }>(
          `${base(householdId)}/subject/${encodeURIComponent(subjectType)}/${encodeURIComponent(subjectId)}`
        )
        .then((res) => res.data),

    /** Owner-only: rename a room (General included). Returns the new name. */
    renameRoom: (householdId: string, roomId: string, name: string) =>
      apiClient
        .patch<{ room: { id: string; name: string; updated_at: string } }>(
          `${base(householdId)}/${roomId}`,
          { name }
        )
        .then((res) => res.data.room),

    deleteRoom: (householdId: string, roomId: string) =>
      apiClient.delete(`${base(householdId)}/${roomId}`).then((res) => res.data),

    /** Owner-only: permanently purge every message in a room (hard delete). */
    clearHistory: (householdId: string, roomId: string) =>
      apiClient
        .delete<{ success: boolean }>(`${base(householdId)}/${roomId}/messages`)
        .then((res) => res.data),

    /** Paginated history (oldest → newest). `before` is an ISO `created_at`. */
    getMessages: (
      householdId: string,
      roomId: string,
      params?: { before?: string; limit?: number }
    ) =>
      apiClient
        .get<MessagesResponse>(`${base(householdId)}/${roomId}/messages`, { params })
        .then((res) => res.data.messages),

    sendMessage: (householdId: string, roomId: string, input: SendMessageInput) =>
      apiClient
        .post<MessageResponse>(`${base(householdId)}/${roomId}/messages`, input)
        .then((res) => res.data.message),

    /**
     * Edit a message's text and/or image set. `attachments` is the FULL desired
     * list (kept images + newly-uploaded ones); pass `[]` to strip all images.
     * Omitting `attachments` leaves the existing images untouched server-side.
     */
    editMessage: (
      householdId: string,
      roomId: string,
      messageId: string,
      input: { body?: string; attachments?: OutgoingAttachment[] }
    ) =>
      apiClient
        .patch<MessageResponse>(`${base(householdId)}/${roomId}/messages/${messageId}`, input)
        .then((res) => res.data.message),

    deleteMessage: (householdId: string, roomId: string, messageId: string) =>
      apiClient
        .delete<MessageResponse>(`${base(householdId)}/${roomId}/messages/${messageId}`)
        .then((res) => res.data.message),

    markRead: (householdId: string, roomId: string, lastReadMessageId?: string) =>
      apiClient
        .post<{ success: boolean }>(`${base(householdId)}/${roomId}/read`, {
          last_read_message_id: lastReadMessageId,
        })
        .then((res) => res.data),

    // ---- Participants ----

    getParticipants: (householdId: string, roomId: string) =>
      apiClient
        .get<ChatParticipants>(`${base(householdId)}/${roomId}/participants`)
        .then((res) => res.data),

    setParticipants: (householdId: string, roomId: string, participantIds: string[]) =>
      apiClient
        .put<{ restricted: boolean; participant_ids: string[] }>(
          `${base(householdId)}/${roomId}/participants`,
          { participant_ids: participantIds }
        )
        .then((res) => res.data),

    // ---- Image attachments (two-step: reserve a key, then PUT the bytes) ----

    getImageUploadUrl: (
      householdId: string,
      roomId: string,
      input: { filename: string; content_type: string }
    ) =>
      apiClient
        .post<ImageUploadUrlResponse>(`${base(householdId)}/${roomId}/images/upload-url`, input)
        .then((res) => res.data),

    /**
     * PUT the raw image bytes to the relative `uploadUrl` from `getImageUploadUrl`.
     * Goes through the shared apiClient so the API base URL + bearer token are
     * attached automatically — the upload endpoint is an authenticated Worker
     * route, NOT a presigned R2 URL, so a bare XHR to the relative path never
     * reaches the Worker and the upload silently fails.
     */
    uploadImageBytes: async (
      uploadUrl: string,
      body: ArrayBuffer | Blob,
      contentType: string,
      onProgress?: (fraction: number) => void
    ) => {
      const res = await apiClient.put<{ image_key: string }>(uploadUrl, body, {
        headers: { 'Content-Type': contentType },
        transformRequest: [(data) => data],
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(e.loaded / e.total);
        },
      });
      return res.data ?? { image_key: '' };
    },
  };
}

export type ChatApi = ReturnType<typeof createChatApi>;
