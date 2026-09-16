/**
 * Teaching-chat (AI tutor) API — donor `/api/v1/teaching-chat`.
 * This is the app's signature "live back-and-forth": the learner sends a turn,
 * the server runs a Gemini tool-use loop and returns the tutor's reply.
 *
 * Contract notes (see donor backend):
 *  - Session + message READ rows come back snake_case (raw D1 rows).
 *  - POST /messages response mixes camel + snake (tool_results, stop_reason,
 *    assistant_ui_blocks). Typed explicitly below.
 *  - AI turns require the server GEMINI_API_KEY (verified present via /ai/health).
 */
import { languageRequest } from './languageClient';

export type TutorActionType = 'grammar' | 'definition' | 'pronunciation' | 'rephrase' | 'example';

/** Raw session row (snake_case) as returned by POST /sessions. */
export interface TutorSessionRow {
  id: string;
  user_id: string;
  date: string;
  message_count?: number;
  summary?: string | null;
  start_time?: string;
  [key: string]: unknown;
}

/** Raw message row (snake_case) from GET /sessions/:id/messages. */
export interface TutorMessageRow {
  id: string;
  session_id: string;
  is_user: number | boolean;
  content?: string;
  text?: string;
  teacher_name?: string | null;
  created_at?: string;
  assistant_ui_blocks?: unknown[];
  tool_results?: Array<{ name: string; result: unknown }>;
  [key: string]: unknown;
}

export interface TutorPronunciation {
  pronunciationScore: number;
  breakdown: unknown;
  fluencyScore: number;
}

export interface TutorReply {
  message: string;
  sessionId: string;
  userMessageId: string;
  teacherMessageId: string;
  teacherName: string;
  tool_results: Array<{ name: string; result: unknown }>;
  stop_reason: string;
  pronunciation: TutorPronunciation | null;
  assistant_ui_blocks: unknown[];
}

function todayDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const languageTutorApi = {
  /** Create or fetch today's tutor session. */
  createSession: (date: string = todayDate(), sessionId?: string) =>
    languageRequest<{ session: TutorSessionRow }>('/teaching-chat/sessions', {
      method: 'POST',
      body: { date, sessionId },
    }).then((r) => r.session),

  /** Send a text turn and get the tutor's reply. */
  sendMessage: (input: {
    sessionId: string;
    text: string;
    teacherId?: string;
    isVoice?: boolean;
    actionType?: TutorActionType;
  }) =>
    languageRequest<TutorReply>('/teaching-chat/messages', {
      method: 'POST',
      body: input,
    }),

  getMessages: (sessionId: string) =>
    languageRequest<{ messages: TutorMessageRow[] }>(
      `/teaching-chat/sessions/${sessionId}/messages`,
    ).then((r) => r.messages),

  getHistory: () =>
    languageRequest<{
      sessions: Array<{
        id: string;
        date: string;
        message_count: number;
        summary: string | null;
        start_time: string;
      }>;
    }>('/teaching-chat/history').then((r) => r.sessions),
};

export { todayDate as tutorTodayDate };
