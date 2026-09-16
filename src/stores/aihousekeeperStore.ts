import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import type { CachedBriefingPayload, AihousekeeperUIMessage } from '@/types/aihousekeeper';
import { DEFAULT_PERSONA_ID, type PersonaId } from '@assets/aihousekeeper/personas';
import { asyncStorage } from '@services/storage';

/**
 * Local `YYYY-MM-DD` in the device's timezone — used to decide whether the
 * persisted chat is still "today's" conversation. We intentionally use local
 * date (not UTC) so the chat rolls over at the user's midnight.
 */
export function getLocalChatDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Client-only Aihousekeeper state (per plan §H6). Server-fetched resources
 * (briefings, memory, ledger, followups) live in TanStack Query cache —
 * never mirror them here.
 *
 * Store field ↔ MMKV key mapping (plan §H6 table):
 * - `hasSeenIntro`          → `aihousekeeper_has_seen_aihousekeeper_intro`
 * - `lastBriefingDate`      → `aihousekeeper_last_briefing_date`
 * - `pushPromptDismissedAt` → `aihousekeeper_push_prompt_dismissed_at`
 * - `lastBriefingPayloadByHid` → persisted inside a single blob under the
 *   store's root key below; logically equivalent to `aihousekeeper_last_briefing_<hid>`
 *   one key per household (one-blob form is strictly simpler and equivalent).
 *
 * This is the only file in the app that writes these keys.
 */

interface AihousekeeperState {
  hasSeenIntro: boolean;
  lastBriefingDate: string | null;
  pushPromptDismissedAt: string | null; // ISO8601
  lastBriefingPayloadByHid: Record<string, CachedBriefingPayload>;
  selectedPersonaId: PersonaId;
  /** User-assigned nickname that overrides `persona.displayName` in the UI. */
  customPersonaName: string | null;
  /**
   * Persisted chat history — kept for the current local day only. When the
   * device's local date rolls over, `AihousekeeperChatScreen` clears this on mount
   * or on app-foreground (see `useDailyChatClear`). The retention window is
   * intentionally short: chat is a scratchpad, not a log.
   */
  chatMessages: AihousekeeperUIMessage[];
  /** Local `YYYY-MM-DD` the messages were last written on. null = no chat yet. */
  chatDate: string | null;
  /**
   * ISO-639-1 language override for Aihousekeeper's speech-to-text, e.g. "en", "ru",
   * "es". `null` means "follow the app's locale" which is the default. Users
   * can override from chat by asking Aihousekeeper ("speak to me in Russian") or
   * from settings.
   */
  voiceLanguage: string | null;
}

interface AihousekeeperActions {
  setHasSeenIntro: (seen: boolean) => void;
  setLastBriefingDate: (date: string | null) => void;
  setPushPromptDismissedAt: (isoWhen: string | null) => void;
  cacheBriefing: (householdId: string, payload: CachedBriefingPayload) => void;
  readCachedBriefing: (householdId: string) => CachedBriefingPayload | null;
  clearCachedBriefing: (householdId: string) => void;
  setSelectedPersonaId: (id: PersonaId) => void;
  setCustomPersonaName: (name: string | null) => void;
  /** Replace the persisted chat and stamp it with today's local date. */
  setChatMessages: (messages: AihousekeeperUIMessage[]) => void;
  /** Drop all persisted chat messages (also resets `chatDate`). */
  clearChatMessages: () => void;
  /** Override the STT language. Pass null to fall back to the app locale. */
  setVoiceLanguage: (lang: string | null) => void;
  reset: () => void;
}

type AihousekeeperStore = AihousekeeperState & AihousekeeperActions;

const initialState: AihousekeeperState = {
  hasSeenIntro: false,
  lastBriefingDate: null,
  pushPromptDismissedAt: null,
  lastBriefingPayloadByHid: {},
  selectedPersonaId: DEFAULT_PERSONA_ID,
  customPersonaName: null,
  chatMessages: [],
  chatDate: null,
  voiceLanguage: null,
};

export const useAihousekeeperStore = create<AihousekeeperStore>()(
  persist(
    immer<AihousekeeperStore>((set, get) => ({
      ...initialState,

      setHasSeenIntro: (seen) =>
        set((state) => {
          state.hasSeenIntro = seen;
        }),

      setLastBriefingDate: (date) =>
        set((state) => {
          state.lastBriefingDate = date;
        }),

      setPushPromptDismissedAt: (isoWhen) =>
        set((state) => {
          state.pushPromptDismissedAt = isoWhen;
        }),

      cacheBriefing: (householdId, payload) =>
        set((state) => {
          state.lastBriefingPayloadByHid[householdId] = payload;
          state.lastBriefingDate = payload.date;
        }),

      readCachedBriefing: (householdId) => {
        const cached = get().lastBriefingPayloadByHid[householdId];
        return cached ?? null;
      },

      clearCachedBriefing: (householdId) =>
        set((state) => {
          delete state.lastBriefingPayloadByHid[householdId];
        }),

      setSelectedPersonaId: (id) =>
        set((state) => {
          state.selectedPersonaId = id;
        }),

      setCustomPersonaName: (name) =>
        set((state) => {
          // Treat empty/whitespace-only strings as "clear the override".
          const trimmed = name?.trim() ?? '';
          state.customPersonaName = trimmed.length > 0 ? trimmed : null;
        }),

      setChatMessages: (messages) =>
        set((state) => {
          state.chatMessages = messages;
          state.chatDate = messages.length > 0 ? getLocalChatDate() : null;
        }),

      clearChatMessages: () =>
        set((state) => {
          state.chatMessages = [];
          state.chatDate = null;
        }),

      setVoiceLanguage: (lang) =>
        set((state) => {
          // Accept full locales ("en-US"); persist the 2-letter prefix.
          const trimmed = lang?.split(/[-_]/)[0].toLowerCase() ?? null;
          state.voiceLanguage = trimmed && trimmed.length > 0 ? trimmed : null;
        }),

      reset: () =>
        set((state) => {
          state.hasSeenIntro = initialState.hasSeenIntro;
          state.lastBriefingDate = initialState.lastBriefingDate;
          state.pushPromptDismissedAt = initialState.pushPromptDismissedAt;
          state.lastBriefingPayloadByHid = {};
          state.selectedPersonaId = initialState.selectedPersonaId;
          state.customPersonaName = initialState.customPersonaName;
          state.chatMessages = [];
          state.chatDate = null;
          state.voiceLanguage = null;
        }),
    })),
    {
      name: 'aihousekeeper-storage',
      storage: createJSONStorage(() => asyncStorage),
      partialize: (state) => ({
        hasSeenIntro: state.hasSeenIntro,
        lastBriefingDate: state.lastBriefingDate,
        pushPromptDismissedAt: state.pushPromptDismissedAt,
        lastBriefingPayloadByHid: state.lastBriefingPayloadByHid,
        selectedPersonaId: state.selectedPersonaId,
        customPersonaName: state.customPersonaName,
        chatMessages: state.chatMessages,
        chatDate: state.chatDate,
        voiceLanguage: state.voiceLanguage,
      }),
    }
  )
);
