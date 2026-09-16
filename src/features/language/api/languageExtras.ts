/**
 * Remaining donor domains — dialogues, games, voice practice, speaking practice,
 * and Drive. Kept in one module since each is small. All hit `/api/v1/*`.
 */
import { languageRequest } from './languageClient';

// ── Dialogues (/api/v1/dialogues) — AI-generated immersive scenarios ──────────
export type DialogueScenario = 'restaurant' | 'doctor' | 'workplace' | 'airport' | 'hotel';

export interface GeneratedDialogue {
  scenario: string;
  context: string;
  exchanges: Array<{ speaker: 'user' | 'other'; text: string; translation: string }>;
  vocabulary: string[];
  tips: string[];
}

export const languageDialoguesApi = {
  generate: (scenario: DialogueScenario, level?: number, domain?: string) =>
    languageRequest<GeneratedDialogue>('/dialogues/generate', {
      method: 'POST',
      body: { scenario, level, domain },
    }),
};

// ── Games (/api/v1/games) ─────────────────────────────────────────────────────
export interface GameWord {
  id: string;
  word: string;
  translation: string;
  context?: string;
  domain?: string;
}

export const languageGamesApi = {
  vocabulary: () =>
    languageRequest<{ words: GameWord[]; count: number }>('/games/vocabulary', { method: 'POST' }),
};

// ── Voice practice (/api/v1/voice) — request/response, NOT realtime ────────────
export interface VoiceTurnResult {
  transcription?: string;
  correction?: string;
  fluentRephrasing?: string;
  feedback?: string;
  similarExamples?: string[];
  pronunciation?: unknown;
  sessionId?: string;
  speakingHabits?: unknown;
  [key: string]: unknown;
}

export interface SpeakingHabits {
  series: Array<{ date: string; fillerRatePer100: number; habitScore: number }>;
  topWords: Array<{ word: string; count: number }>;
  latestHabitScore: number;
  verdict: 'improving' | 'regressing' | 'steady';
  tips: string[];
}

export const languageVoiceApi = {
  /** Text-input voice-practice turn (audio path handled separately via FormData). */
  turn: (input: { userInput: string; teacherId?: string; context?: Record<string, unknown> }) =>
    languageRequest<VoiceTurnResult>('/voice/stream', { method: 'POST', body: input }),

  speakingHabits: (days = 30) =>
    languageRequest<SpeakingHabits>(`/voice/speaking-habits?days=${days}`),
};

// ── Speaking-mistake practice (/api/v1/practice) ──────────────────────────────
export interface PracticeMistake {
  id: string;
  type: string;
  text: string;
  correction: string;
  explanation?: string;
  status: string;
  statusLabel?: string;
  nextReviewAt?: string;
  [key: string]: unknown;
}

export const languagePracticeApi = {
  backlog: (limit = 20) =>
    languageRequest<{ due: PracticeMistake[]; dueCount: number; scheduledCount: number }>(
      `/practice/backlog?limit=${limit}`,
    ),
  mistakes: (status?: string) =>
    languageRequest<{ mistakes: PracticeMistake[]; countsByStatus: Record<string, number> }>(
      `/practice/mistakes${status ? `?status=${status}` : ''}`,
    ),
  stats: () =>
    languageRequest<{
      dueCount: number;
      mastered: number;
      activeBacklog: number;
      streakDays: number;
      practicedToday: boolean;
      dailyGoal: number;
    }>('/practice/stats'),
  dismiss: (id: string) =>
    languageRequest<{ success: boolean }>(`/practice/mistakes/${id}/dismiss`, { method: 'POST' }),
};

// ── Google Drive (/api/v1/drive) ──────────────────────────────────────────────
export const languageDriveApi = {
  status: () =>
    languageRequest<{ connected: boolean; email?: string; scopes?: string[]; connectedAt?: string }>(
      '/drive/status',
    ),
  connect: (serverAuthCode: string) =>
    languageRequest<{ connected: boolean; email: string; scopes: string[] }>('/drive/connect', {
      method: 'POST',
      body: { serverAuthCode },
    }),
  disconnect: () =>
    languageRequest<{ connected: boolean }>('/drive/disconnect', { method: 'DELETE' }),
  listFiles: (q?: string) =>
    languageRequest<{ files: Array<Record<string, unknown>>; nextPageToken?: string }>(
      `/drive/files${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),
};
