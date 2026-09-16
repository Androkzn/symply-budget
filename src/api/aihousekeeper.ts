import type {
  AIToolPending,
  AIToolPendingStatus,
  AssistantBriefing,
  AssistantFollowup,
  AssistantIdentity,
  AssistantIdentityPatch,
  AssistantMemory,
  AssistantTrustLedgerEntry,
  FollowupStatus,
  HomeInsight,
  ListLedgerOptions,
  ListMemoryOptions,
  UndoLedgerResult,
} from '@/types/aihousekeeper';
import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';


// Response envelopes mirror Stream E/F agent report.
interface IdentityResponse {
  identity: AssistantIdentity;
}

interface BriefingsListResponse {
  briefings: AssistantBriefing[];
}

interface BriefingResponse {
  briefing: AssistantBriefing;
}

interface HomeInsightResponse {
  insight: HomeInsight;
}

interface MemoryListResponse {
  memories: AssistantMemory[];
  via: 'fts' | 'list';
}

interface LedgerListResponse {
  entries: AssistantTrustLedgerEntry[];
}

interface FollowupsListResponse {
  followups: AssistantFollowup[];
}

interface ApprovalsListResponse {
  approvals: AIToolPending[];
}

// Chat — stateless; client holds message history.
export type AihousekeeperChatMode =
  | 'task_assistant'
  | 'report_assistant'
  | 'family_chat'
  | 'contractor_context'
  | 'morning_briefing';

export type AihousekeeperChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AihousekeeperChatMessage {
  role: 'user' | 'assistant';
  content: string | AihousekeeperChatContentBlock[];
}

/**
 * Tool result shape returned to the client.
 *
 * - `ui` (optional): a structured content block the chat screen renders as
 *   a real component (task card, list, action row). Typed as `unknown`
 *   because the zod schema lives server-side; the client runtime-validates
 *   via `isAssistantUIBlock` before rendering. See `types/aihousekeeperUiBlocks.ts`.
 *
 * - `invalidate` (optional): targets whose cached lists the client must
 *   re-fetch after a mutation (e.g. 'tasks' after a create/update/delete).
 *   Typed as `unknown[]` here; `isInvalidateTarget` narrows at runtime.
 */
export type AihousekeeperToolResult =
  | ({
      ok: true;
      ui?: unknown;
      invalidate?: readonly unknown[];
    } & Record<string, unknown>)
  | ({
      ok: false;
      error: string;
      ui?: unknown;
      invalidate?: readonly unknown[];
    } & Record<string, unknown>);

export interface AihousekeeperChatResponse {
  response: { role: 'assistant'; content: string | AihousekeeperChatContentBlock[] };
  tool_results: Array<{
    tool_use_id: string;
    name: string;
    result: AihousekeeperToolResult;
  }>;
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

/**
 * Voice session response — server mints a short-lived OpenAI Realtime
 * ephemeral token. The client uses it exactly once to POST its WebRTC SDP
 * offer to `realtime_url`. See backend/src/routes/aihousekeeper-voice.ts.
 */
export interface AihousekeeperVoiceSession {
  /** Ephemeral `ek_…` token. Valid ~60s to establish the connection. */
  client_secret: string;
  /** Unix seconds until the ephemeral token expires. */
  expires_at: number;
  /** Realtime model id negotiated by the server (e.g. `gpt-realtime`). */
  model: string;
  /** Voice id configured on the session (e.g. `marin`). */
  voice: string;
  /** OpenAI session id for observability. */
  session_id: string | null;
  /** URL the client POSTs its SDP offer to. */
  realtime_url: string;
}

interface ApprovalResponse {
  approval: AIToolPending;
  /**
   * Present on `approve` responses only. Mirrors the backend executor
   * outcome — `ok:true` with a `result` on success, `ok:false` with an
   * `error` string on a run-time failure (e.g. contractor opted out
   * between park and approve, Twilio FROM number not set, etc.).
   *
   * `queued: true` indicates execution was deferred to a Cloudflare Queue
   * (currently only `create_garden_site_plan`). The approval row stays in
   * 'approved' status until the async job finishes; the user is notified
   * via push when the result is ready.
   */
  execution?:
    | { ok: true; queued?: boolean; result: Record<string, unknown> }
    | { ok: false; error: string };
}

interface OkResponse {
  ok: true;
}

// Attachments — v3.1 chat attachment flow. See
// backend/src/routes/aihousekeeper-attachments.ts for endpoint details.
export type AihousekeeperAttachmentStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'classified'
  | 'routed'
  | 'failed';

export type AihousekeeperAttachmentKind =
  | 'photo'
  | 'report'
  | 'floor_plan'
  | 'receipt'
  | 'quote'
  | 'note';

export interface AihousekeeperAttachment {
  id: string;
  household_id: string;
  user_id: string;
  r2_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  status: AihousekeeperAttachmentStatus;
  kind: AihousekeeperAttachmentKind | null;
  kind_hint: string | null;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAttachmentUploadRequest {
  fileName: string;
  mimeType: string;
  size?: number;
  /** Free-form hint from the picker ('image' | 'document'). */
  kindHint?: string;
}

export interface CreateAttachmentUploadResponse {
  id: string;
  /** Relative path — caller must prefix with apiClient baseURL. */
  uploadUrl: string;
  r2Key: string;
  maxSizeBytes: number;
}

export interface AttachmentUploadedResponse {
  id: string;
  status: 'uploaded';
  sizeBytes: number;
}

const remoteAihousekeeperApi = {
  // Identity
  getIdentity: (householdId: string) =>
    apiClient
      .get<IdentityResponse>(`/households/${householdId}/aihousekeeper/identity`)
      .then((res) => res.data),

  updateIdentity: (householdId: string, patch: AssistantIdentityPatch) =>
    apiClient
      .patch<IdentityResponse>(`/households/${householdId}/aihousekeeper/identity`, patch)
      .then((res) => res.data),

  // Home hero insight — the single most important, actionable thing right now.
  // `tz` is the device IANA zone so the greeting + "days until due" counter are
  // computed in the household's local day.
  getHomeInsight: (householdId: string, tz?: string) =>
    apiClient
      .get<HomeInsightResponse>(`/households/${householdId}/aihousekeeper/home-insight`, {
        params: tz ? { tz } : undefined,
      })
      .then((res) => res.data.insight),

  // Briefings
  listBriefings: (householdId: string) =>
    apiClient
      .get<BriefingsListResponse>(`/households/${householdId}/aihousekeeper/briefings`)
      .then((res) => res.data),

  getBriefing: (householdId: string, date: string) =>
    apiClient
      .get<BriefingResponse>(`/households/${householdId}/aihousekeeper/briefings/${date}`)
      .then((res) => res.data),

  markBriefingRead: (householdId: string, date: string) =>
    apiClient
      .post<OkResponse>(`/households/${householdId}/aihousekeeper/briefings/${date}/read`)
      .then((res) => res.data),

  // Memory
  listMemory: (householdId: string, opts?: ListMemoryOptions) =>
    apiClient
      .get<MemoryListResponse>(`/households/${householdId}/aihousekeeper/memory`, {
        params: opts,
      })
      .then((res) => res.data),

  forgetMemory: (householdId: string, memoryId: string) =>
    apiClient
      .delete<OkResponse>(`/households/${householdId}/aihousekeeper/memory/${memoryId}`)
      .then((res) => res.data),

  // Trust ledger
  listTrustLedger: (householdId: string, opts?: ListLedgerOptions) =>
    apiClient
      .get<LedgerListResponse>(`/households/${householdId}/aihousekeeper/trust-ledger`, {
        params: opts,
      })
      .then((res) => res.data),

  dismissLedgerEntry: (householdId: string, entryId: string) =>
    apiClient
      .post<OkResponse>(
        `/households/${householdId}/aihousekeeper/trust-ledger/${entryId}/dismiss`
      )
      .then((res) => res.data),

  undoLedgerEntry: (householdId: string, entryId: string) =>
    apiClient
      .post<UndoLedgerResult>(
        `/households/${householdId}/aihousekeeper/trust-ledger/${entryId}/undo`
      )
      .then((res) => res.data),

  // Followups
  listFollowups: (householdId: string, status?: FollowupStatus) =>
    apiClient
      .get<FollowupsListResponse>(`/households/${householdId}/aihousekeeper/followups`, {
        params: status ? { status } : undefined,
      })
      .then((res) => res.data),

  cancelFollowup: (householdId: string, followupId: string) =>
    apiClient
      .post<OkResponse>(
        `/households/${householdId}/aihousekeeper/followups/${followupId}/cancel`
      )
      .then((res) => res.data),

  // Approvals (HIGH_WRITE parking — v1.2 ADR-32)
  listApprovals: (
    householdId: string,
    opts?: { status?: AIToolPendingStatus; limit?: number }
  ) =>
    apiClient
      .get<ApprovalsListResponse>(
        `/households/${householdId}/aihousekeeper/approvals`,
        { params: opts }
      )
      .then((res) => res.data),

  approveApproval: (householdId: string, approvalId: string) =>
    apiClient
      .post<ApprovalResponse>(
        `/households/${householdId}/aihousekeeper/approvals/${approvalId}/approve`
      )
      .then((res) => res.data),

  cancelApproval: (householdId: string, approvalId: string) =>
    apiClient
      .post<ApprovalResponse>(
        `/households/${householdId}/aihousekeeper/approvals/${approvalId}/cancel`
      )
      .then((res) => res.data),

  /**
   * Aihousekeeper chat — stateless. Client passes the full message history each
   * turn; server routes through the tool registry, executes inline tools,
   * parks HIGH_WRITE tools, and returns the assistant's response plus any
   * tool results (including pending approval ids).
   *
   * `attachmentIds` are ids returned from `aihousekeeperApi.attachments.createUpload`
   * + uploaded via `attachments.upload`. Server verifies ownership and
   * appends an <attachments> block to the last user message before calling
   * Claude, so Aihousekeeper knows what the user attached and can ask a clarifying
   * question before invoking `classify_and_save_attachment`.
   */
  chat: (
    householdId: string,
    mode: AihousekeeperChatMode,
    messages: AihousekeeperChatMessage[],
    attachmentIds?: string[]
  ) =>
    apiClient
      .post<AihousekeeperChatResponse>(
        `/households/${householdId}/aihousekeeper/chat`,
        {
          mode,
          messages,
          ...(attachmentIds && attachmentIds.length > 0
            ? { attachment_ids: attachmentIds }
            : {}),
        }
      )
      .then((res) => res.data),

  /**
   * Mint an OpenAI Realtime ephemeral token for voice mode.
   *
   * The client uses the returned `client_secret` to POST its WebRTC SDP
   * offer to `realtime_url`. All reasoning happens in Claude via the
   * existing /aihousekeeper/chat endpoint; OpenAI is a pure voice codec.
   *
   * `language` anchors speech-to-text to the user's preferred language
   * so mixed / short utterances aren't garbled ("poetry moral y urgency"
   * ↔ "поэтому мораль и urgency"). ISO-639-1 code or a full locale like
   * "en-US" (the server trims to the 2-letter prefix).
   */
  createVoiceSession: (
    householdId: string,
    opts?: { voice?: string; language?: string }
  ) =>
    apiClient
      .post<AihousekeeperVoiceSession>(
        `/households/${householdId}/aihousekeeper/voice-session`,
        {
          ...(opts?.voice ? { voice: opts.voice } : {}),
          ...(opts?.language ? { language: opts.language } : {}),
        }
      )
      .then((res) => res.data),

  /**
   * Attachments — two-step upload (create row, then PUT bytes). The server
   * enforces a 25MB max and an mime allowlist; see
   * backend/src/routes/aihousekeeper-attachments.ts.
   */
  attachments: {
    /**
     * Create an attachment row in `aihousekeeper_attachments` and get a relative
     * `uploadUrl` to PUT the file bytes to. `kindHint` is optional free-form
     * ('image' | 'document') — the final kind is set by Aihousekeeper via the
     * `classify_and_save_attachment` tool, not by the client.
     */
    createUpload: (
      householdId: string,
      input: CreateAttachmentUploadRequest
    ) =>
      apiClient
        .post<CreateAttachmentUploadResponse>(
          `/households/${householdId}/aihousekeeper/attachments/upload-url`,
          input
        )
        .then((res) => res.data),

    /**
     * PUT the raw file bytes to the relative `uploadUrl` returned by
     * `createUpload`. `contentType` should match the mime passed to
     * `createUpload`. Uses the shared apiClient so the auth token is
     * attached automatically.
     */
    upload: (
      uploadUrl: string,
      body: ArrayBuffer | Blob,
      contentType: string,
      onProgress?: (fraction: number) => void
    ) =>
      apiClient
        .put<AttachmentUploadedResponse>(uploadUrl, body, {
          headers: { 'Content-Type': contentType },
          transformRequest: [(data) => data],
          onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(e.loaded / e.total);
          },
        })
        .then((res) => res.data),

    delete: (householdId: string, attachmentId: string) =>
      apiClient
        .delete<{ id: string; deleted: true }>(
          `/households/${householdId}/aihousekeeper/attachments/${attachmentId}`
        )
        .then((res) => res.data),
  },
};

/**
 * House V2 facade — the assistant's RECORDS come from the ledger; the surfaces
 * that run a model stay on the Worker.
 *
 * `strict: false` with an explicit `remoteMethods` list, which is the shape
 * `garbage-collection` and `visit-checklists` already use: this module's surface
 * is genuinely part local, part model, and listing the twelve remote ones makes
 * the split auditable instead of accidental.
 */
export const aihousekeeperApi: typeof remoteAihousekeeperApi = createHouseLocalProxy(
  remoteAihousekeeperApi,
  {
    moduleName: 'aihousekeeper',
    strict: false,
    remoteMethods: [
      ...(require('@features/house/local/localAihousekeeperApi')
        .HOUSE_LOCAL_AIHOUSEKEEPER_REMOTE_METHODS as readonly (keyof typeof remoteAihousekeeperApi)[]),
    ],
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    resolveLocal: () =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@features/house/local/localAihousekeeperApi').localAihousekeeperApi,
  },
);

export type { AssistantIdentity, AssistantBriefing, AssistantMemory, AssistantTrustLedgerEntry, AssistantFollowup };
