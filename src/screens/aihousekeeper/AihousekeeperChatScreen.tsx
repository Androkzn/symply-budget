/**
 * AihousekeeperChatScreen — the user-facing chat surface for Aihousekeeper.
 *
 * Sends each turn to POST /households/:hid/aihousekeeper/chat via `aihousekeeperApi.chat`,
 * which wires Aihousekeeper's 14 tools to Claude's tool_use loop. LOW_WRITE / READ
 * tools execute inline server-side; HIGH_WRITE tools park for approval and
 * return a `pending_id` in the tool_result — this screen surfaces those as
 * an inline "Needs your approval" link that deep-links to AihousekeeperApprovals.
 *
 * Chat is persisted to MMKV via `useAihousekeeperStore` but retained for the
 * current local day only: on mount and on app-foreground we compare the
 * device's local date with the stored `chatDate` and wipe if they differ.
 * The overflow menu also exposes an explicit "Clear chat" action.
 */

import * as DocumentPicker from 'expo-document-picker';
// Expo SDK 54 made the top-level `readAsStringAsync` export a throw-on-call
// deprecation stub. Use the `/legacy` subpath until the app is migrated to
// the new `File`/`Directory` API.
import * as FileSystem from 'expo-file-system/legacy';
import * as KeepAwake from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useFocusEffect, useNavigation } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, type AppStateStatus, FlatList, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import type { AihousekeeperUIMessage } from '@/types/aihousekeeper';
import {
  isAssistantUIBlock,
  isInvalidateTarget,
  type AssistantUIBlock as AssistantUIBlockType,
  type InvalidateTarget,
} from '@/types/aihousekeeperUiBlocks';
import { aihousekeeperApi } from '@api/aihousekeeper';
import type {
  AihousekeeperChatContentBlock,
  AihousekeeperChatMessage,
  AihousekeeperChatMode,
  AihousekeeperChatResponse,
} from '@api/aihousekeeper';
import { AIAccessGate } from '@components/ai/AIAccessGate';
import { AssistantUIBlock, MarkdownText, PersonaAvatar } from '@components/aihousekeeper';
import { AppBackground, HeaderActionButton, SafeAreaView, ScreenHeader, SettingsGearButton } from '@components/common';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useData } from '@contexts/DataContext';
import { useI18n } from '@contexts/I18nContext';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useVoiceMode } from '@hooks/useVoiceMode';
import { getLocalChatDate, useAihousekeeperStore } from '@stores/aihousekeeperStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useMemberStore } from '@stores/memberStore';
import {
  ButtonMetrics,
  Chat as ChatTokens,
  CornerRadius,
  Header,
  Layout,
  Spacing,
  TypographyTokens,
  useAppColors,
} from '@theme';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

import { PersonaWelcomeVideo } from './PersonaWelcomeVideo';

/** A file the user has selected/uploaded but not yet sent. */
interface PendingAttachment {
  /** aihousekeeper_attachments.id once the row is created. Empty while uploading. */
  id: string;
  fileName: string;
  mimeType: string;
  /** 'uploading' → 'ready' → 'failed'. */
  status: 'uploading' | 'ready' | 'failed';
  /** 0..1 upload progress (optional; updates while uploading). */
  progress?: number;
  /** Error message when status === 'failed'. */
  error?: string;
  /** Local file URI — used to render a preview thumbnail for images. */
  localUri?: string;
}

/**
 * What the Files and Drive browsers may return here.
 *
 * Wider than the image-only surfaces: the whole point of attaching to the
 * housekeeper is to show it a report, a quote or a floor plan, and those arrive
 * as PDFs and Office documents far more often than as photographs.
 */
const AIHOUSEKEEPER_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/*',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/** Kinds offered when the user attaches a document — used as `kindHint`. */
const DOCUMENT_KINDS = ['Report', 'Floor Plan', 'Quote', 'Receipt', 'Other'] as const;
type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Bubble shape rendered in the list. Alias of the shared `AihousekeeperUIMessage`
 * type so the store can persist the same values without this screen
 * exporting private types.
 */
type UIMessage = AihousekeeperUIMessage;

/**
 * Flatten assistant content into display text + extract parked ids.
 */
function renderAssistantContent(
  content: string | AihousekeeperChatContentBlock[]
): { text: string } {
  if (typeof content === 'string') return { text: content };
  const textParts = content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text);
  return { text: textParts.join('\n').trim() };
}

function extractParked(
  res: AihousekeeperChatResponse
): Array<{ pendingId: string; toolName: string }> {
  const parked: Array<{ pendingId: string; toolName: string }> = [];
  for (const r of res.tool_results) {
    if (!r.result.ok || !('pending_id' in r.result)) continue;
    // Only HIGH_WRITE park results count as "parked for approval". Other
    // tools (cancel_pending_approval, future approval-management tools)
    // also return a pending_id but should NOT trigger the approval CTA —
    // they're acting on an existing approval, not creating one.
    const status = (r.result as { status?: unknown }).status;
    if (status !== 'parked_for_approval') continue;
    const pid = (r.result as { pending_id?: unknown }).pending_id;
    if (typeof pid === 'string') {
      parked.push({ pendingId: pid, toolName: r.name });
    }
  }
  return parked;
}

/**
 * Last-resort text detector — if an assistant message mentions an approval
 * but the structured `parked` metadata didn't make it into the bubble (older
 * cached message, backend hiccup, voice transcript that lost the tool
 * results), we still want the "Open Approvals" CTA to show. Better to
 * over-render the button than leave the user stranded with copy that says
 * "open Aihousekeeper approvals to confirm" and no obvious way to do so.
 *
 * The phrases here are anchored to the deterministic copy Mira's prompt
 * tells her to use (and the parked tool result's `message` field). Free-
 * form mentions of the word "approval" alone don't trigger; that would
 * false-positive on chat about generic approvals (e.g. permits).
 */
const APPROVAL_TEXT_RE =
  /(open\s+aihousekeeper\s+approvals|aihousekeeper\s+approvals\s+to\s+confirm|pending\s+approval|tap\s+approve|awaiting\s+(?:your\s+)?approval|parked\s+for\s+approval)/i;

function messageImpliesApproval(item: UIMessage): boolean {
  if (item.role !== 'assistant') return false;
  if (item.parked && item.parked.length > 0) return true;
  return APPROVAL_TEXT_RE.test(item.text);
}

/**
 * Pull structured UI blocks out of a turn's tool results. Tools opt in by
 * returning a `ui` field; the runtime guard drops anything unknown so a
 * backend ahead of the client just degrades to plain text rather than
 * crashing.
 */
function extractUIBlocks(res: AihousekeeperChatResponse): AssistantUIBlockType[] {
  const blocks: AssistantUIBlockType[] = [];
  for (const r of res.tool_results) {
    if (!r.result.ok) continue;
    const ui = (r.result as { ui?: unknown }).ui;
    if (isAssistantUIBlock(ui)) {
      blocks.push(ui);
    }
  }
  if (__DEV__) {
    // Diagnose missing inline cards: print every tool the backend actually
    // ran, whether it carried a ui block, and the final extract count.
    const summary = res.tool_results.map((r) => ({
      name: r.name,
      ok: r.result.ok,
      hasUi:
        r.result.ok &&
        (r.result as { ui?: unknown }).ui !== undefined,
    }));
    console.log(
      '[AihousekeeperChat] extractUIBlocks',
      JSON.stringify({ tools: summary, blocks: blocks.length })
    );
  }
  return blocks;
}

/**
 * Pull cache-invalidation hints out of a turn's tool results. Mutating tools
 * set `invalidate: ['tasks' | 'action_items' | 'action_plans']` on their
 * result so the chat screen knows the backing lists on the Tasks / Plans
 * tabs are now stale and must be refetched.
 *
 * An unknown list (wire format drift) is ignored rather than crashed on:
 * a newer backend with extra targets just won't trigger a refresh for those
 * until the client ships an update.
 */
function extractInvalidations(res: AihousekeeperChatResponse): Set<InvalidateTarget> {
  const targets = new Set<InvalidateTarget>();
  for (const r of res.tool_results) {
    if (!r.result.ok) continue;
    const list = (r.result as { invalidate?: unknown }).invalidate;
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      if (isInvalidateTarget(t)) targets.add(t);
    }
  }
  return targets;
}

function shouldClearChatHistory(res: AihousekeeperChatResponse): boolean {
  return res.tool_results.some(
    (r) =>
      r.result.ok &&
      (r.result as { chat_history_cleared?: unknown }).chat_history_cleared ===
        true
  );
}

const GARDEN_PLAN_FLOW_TEXT_RE =
  /(add yard or garden plan|confirm(?: or redraw)? the map boundary|mapbox satellite preview|garden plans now start from gardening)/i;

const GARDEN_PLAN_USER_INTENT_RE =
  /\b(garden|yard|landscap(?:e|ing)|front\s*yard|back\s*yard|site\s*plan|outdoor)\b/i;

function extractAddressLineFromGardenRequest(text: string): string | undefined {
  if (!GARDEN_PLAN_USER_INTENT_RE.test(text)) return undefined;
  const match = text.match(/\b(?:for|at)\s+(.{5,140})$/i);
  const candidate = match?.[1]
    ?.replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return candidate && /\d/.test(candidate) ? candidate : undefined;
}

function buildGardenPlanCtaBlocks(
  assistantText: string,
  userText?: string
): AssistantUIBlockType[] {
  if (!GARDEN_PLAN_FLOW_TEXT_RE.test(assistantText)) return [];
  const initialAddressLine1 = userText
    ? extractAddressLineFromGardenRequest(userText)
    : undefined;
  return [
    {
      type: 'action_row',
      actions: [
        {
          label: 'Start garden plan',
          variant: 'primary',
          action: {
            type: 'navigate',
            screen: 'GardenPlanAddress',
            params: initialAddressLine1 ? { initialAddressLine1 } : undefined,
          },
        },
      ],
    },
  ];
}

export function AihousekeeperChatScreen({
  isTabRoot: isTabRootProp,
}: {
  isTabRoot?: boolean;
} = {}) {
  const colors = useAppColors();
  const navigation = useNavigation<{
    navigate: (screen: string) => void;
    goBack: () => void;
    canGoBack: () => boolean;
  }>();
  const router = useRouter();
  // When rendered as the Aihousekeeper tab root there's nothing to go back to, and
  // the floating tab bar sits over the bottom of the screen. Treat that as
  // "tab root" so we hide the back arrow and add bottom padding so the input
  // row clears the tab bar. The hosting route passes this explicitly (the `/mira`
  // tab is always a tab root; the pushed `/aihousekeeper-chat` route never is) —
  // don't rely on `canGoBack()`, which is true on the tab whenever the parent
  // stack has history, dropping the tab-bar clearance and hiding the input.
  const isTabRoot = isTabRootProp ?? !navigation.canGoBack();
  const { shouldUseSidebar, isTablet } = useDeviceType();
  const needsBottomTabClearance = isTabRoot && !shouldUseSidebar;
  const currentHousehold = useHouseholdStore((s) => s.currentHousehold);
  const hid = currentHousehold?.id ?? null;
  const { persona, name: personaName } = useAihousekeeperPersona();
  const { canUseAI, isLoading: aiEntitlementLoading, aiFeaturesEnabled } =
    useAIEntitlement();
  // Used to re-fetch household data (tasks, action items, reports) after
  // Aihousekeeper's write-tools mutate server state — otherwise the Tasks/Plans tabs
  // would show stale data until the user pulls to refresh.
  const { refreshActivePropertyData } = useData();

  const [mode] = useState<AihousekeeperChatMode>(persona.mode);

  // When no household is selected, the user may have an outstanding "request
  // to join" awaiting an owner's approval. Surface that instead of the generic
  // "pick a household" prompt so they know to wait for a notification.
  const myPendingJoinRequests = useMemberStore((s) => s.myPendingJoinRequests);
  const refreshMyJoinRequests = useMemberStore((s) => s.refreshMyJoinRequests);

  useFocusEffect(
    useCallback(() => {
      if (!hid) {
        void refreshMyJoinRequests();
      }
    }, [hid, refreshMyJoinRequests])
  );

  // Hydrate chat from MMKV, but only if the stored conversation is from
  // today (local time). If `chatDate` is null or a prior day, start fresh
  // and wipe the stored history so stale messages don't stick around.
  //
  // Read via `getState()` (not a subscription) so we don't re-render on
  // every write-through — this component owns the chat state in memory and
  // the store is just the persistence mirror.
  const persistChatMessages = useAihousekeeperStore((s) => s.setChatMessages);
  const clearStoredChat = useAihousekeeperStore((s) => s.clearChatMessages);
  // Voice-mode STT language: store override wins; fall back to the app locale
  // so Aihousekeeper doesn't try to transcribe across languages by default.
  const { locale } = useI18n();
  const voiceLangOverride = useAihousekeeperStore((s) => s.voiceLanguage);
  const voiceLanguage = voiceLangOverride ?? locale;
  const [messages, setMessages] = useState<UIMessage[]>(() => {
    const today = getLocalChatDate();
    const { chatMessages: stored, chatDate } = useAihousekeeperStore.getState();
    if (chatDate === today && stored.length > 0) return stored;
    if (stored.length > 0 || chatDate) {
      // Stale chat from a previous day — drop it.
      useAihousekeeperStore.getState().clearChatMessages();
    }
    return [];
  });

  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasParkedApprovals, setHasParkedApprovals] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  // Welcome-screen intro video plays with sound by default; user can
  // toggle it off with the overlay button. Persisted only in memory —
  // resets to "sound on" next launch.
  const [welcomeMuted, setWelcomeMuted] = useState(false);
  const listRef = useRef<FlatList<UIMessage>>(null);
  const scrollToLatestMessage = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated });
      }, 100);
    });
  }, []);

  // Write-through to MMKV whenever the in-memory chat changes so it
  // survives app restarts within the same local day.
  useEffect(() => {
    persistChatMessages(messages);
  }, [messages, persistChatMessages]);

  useEffect(() => {
    if (messages.length === 0) return;
    scrollToLatestMessage(true);
  }, [messages.length, scrollToLatestMessage]);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const onKeyboardMove = () => scrollToLatestMessage(true);
    const showSub = Keyboard.addListener(showEvent, onKeyboardMove);
    const changeSub =
      Platform.OS === 'ios'
        ? Keyboard.addListener('keyboardWillChangeFrame', onKeyboardMove)
        : null;
    return () => {
      showSub.remove();
      changeSub?.remove();
    };
  }, [scrollToLatestMessage]);

  // If the app was backgrounded overnight, wipe the chat when it returns
  // to the foreground on a new local day. Covers both date rollover and
  // explicit timezone changes.
  useEffect(() => {
    const onAppStateChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      const today = getLocalChatDate();
      const { chatDate, chatMessages } = useAihousekeeperStore.getState();
      if (chatDate && chatDate !== today && chatMessages.length > 0) {
        setMessages([]);
        clearStoredChat();
      }
    };
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, [clearStoredChat]);

  // Build the payload the server expects: role + string content. We let
  // assistant turns regenerate from scratch each time (not threading tool
  // blocks into subsequent turns), which keeps this UI simple.
  const serverMessages = useMemo<AihousekeeperChatMessage[]>(
    () =>
      messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          // Claude rejects messages with empty content. Image-only user turns
          // have empty .text (we render the preview instead of a label) —
          // stand in with a placeholder so history is well-formed.
          content:
            m.text ||
            (m.imagePreviews && m.imagePreviews.length > 0
              ? '(image attached)'
              : ''),
        })),
    [messages]
  );

  // -------------------------------------------------------------------------
  // Voice mode (OpenAI Realtime bridge — see useVoiceMode + /aihousekeeper/voice-session).
  // Every voice turn goes through the same /aihousekeeper/chat endpoint that text
  // messages use, so memory, tools, approvals, and UI blocks stay identical.
  // -------------------------------------------------------------------------

  const applyAssistantResponse = useCallback(
    (res: AihousekeeperChatResponse, idPrefix: string) => {
      const { text: replyText } = renderAssistantContent(res.response.content);
      const parked = extractParked(res);
      const uiBlocks = [
        ...extractUIBlocks(res),
        ...buildGardenPlanCtaBlocks(replyText),
      ];
      const invalidations = extractInvalidations(res);

      if (shouldClearChatHistory(res)) {
        const confirmation: UIMessage = {
          id: `${idPrefix}_cleared_${Date.now()}`,
          role: 'assistant',
          text:
            replyText ||
            'Chat history cleared on this device. Memories, tasks, and reminders are unchanged.',
        };
        setMessages([confirmation]);
        clearStoredChat();
        if (invalidations.size > 0) void refreshActivePropertyData();
        return;
      }

      const botMsg: UIMessage = {
        id: `${idPrefix}_${Date.now()}`,
        role: 'assistant',
        text:
          replyText ||
          (uiBlocks.length > 0
            ? ''
            : parked.length > 0
            ? `Queued ${parked.length} action${
                parked.length === 1 ? '' : 's'
              } awaiting your approval.`
            : '…'),
        parked: parked.length > 0 ? parked : undefined,
        uiBlocks: uiBlocks.length > 0 ? uiBlocks : undefined,
      };
      if (parked.length > 0) setHasParkedApprovals(true);
      setMessages((prev) => [...prev, botMsg]);
      if (invalidations.size > 0) void refreshActivePropertyData();
    },
    [clearStoredChat, refreshActivePropertyData]
  );

  const handleVoiceUserMessage = useCallback((text: string) => {
    const userMsg: UIMessage = {
      id: `u_voice_${Date.now()}`,
      role: 'user',
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    scrollToLatestMessage(true);
  }, [scrollToLatestMessage]);

  const handleVoiceAssistantResponse = useCallback(
    (res: AihousekeeperChatResponse) => {
      applyAssistantResponse(res, 'a_voice');
      scrollToLatestMessage(true);
    },
    [applyAssistantResponse, scrollToLatestMessage]
  );

  const handleVoiceError = useCallback(
    (err: Error) => {
      // Users see a short friendly message; the raw error (axios payload,
      // Anthropic JSON, stack trace) stays in the dev console only.
      console.error('[AihousekeeperChatScreen] voice error', err);
      const errMsg: UIMessage = {
        id: `a_voice_err_${Date.now()}`,
        role: 'assistant',
        // Keep the history alternating user→assistant so the next /aihousekeeper/chat
        // call doesn't 400 on "messages must alternate".
        text: "Sorry, I couldn't hear that clearly. Please try again.",
      };
      setMessages((prev) => [...prev, errMsg]);
      // No Alert popup — the bubble is enough and less interruptive.
    },
    []
  );

  const voice = useVoiceMode({
    householdId: hid,
    mode,
    language: voiceLanguage,
    getMessageHistory: () => serverMessages,
    onUserMessage: handleVoiceUserMessage,
    onAssistantMessage: handleVoiceAssistantResponse,
    onError: handleVoiceError,
  });

  useEffect(() => {
    if (messages.length === 0) return;
    scrollToLatestMessage(false);
  }, [
    messages.length,
    pendingAttachments.length,
    voice.isActive,
    scrollToLatestMessage,
  ]);

  const handleVoiceToggle = useCallback(async () => {
    if (voice.isActive) {
      await voice.exit();
      return;
    }
    try {
      await voice.enter();
    } catch (err) {
      // Raw error stays in dev console; user gets a short friendly message.
      console.error('[AihousekeeperChatScreen] voice.enter failed', err);
      Alert.alert(
        'Voice mode',
        "I couldn't start voice mode right now. Please try again in a moment."
      );
    }
  }, [voice]);

  // Keep the screen awake while a voice session is live — the conversation
  // can span minutes and dimming would drop the WebRTC connection.
  useEffect(() => {
    if (!voice.isActive) return;
    void KeepAwake.activateKeepAwakeAsync('aihousekeeper-voice');
    return () => {
      KeepAwake.deactivateKeepAwake('aihousekeeper-voice');
    };
  }, [voice.isActive]);

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!hid || isLoading) return;

      // Only include attachments that finished uploading. Still-uploading
      // or failed ones are left in the tray so the user can retry/remove.
      const readyAttachmentIds = pendingAttachments
        .filter((a) => a.status === 'ready' && a.id && !a.id.startsWith('tmp_'))
        .map((a) => a.id);
      if (!text && readyAttachmentIds.length === 0) return;

      const ready = pendingAttachments.filter((a) => a.status === 'ready');
      const imagePreviews = ready
        .filter((a) => a.mimeType.startsWith('image/') && !!a.localUri)
        .map((a) => a.localUri as string);
      const nonImageNames = ready
        .filter((a) => !a.mimeType.startsWith('image/'))
        .map((a) => a.fileName);

      // Drop the `📎 filename` label when we already show an inline image
      // preview — it's redundant. Keep it for non-image attachments.
      const displayText = text
        ? nonImageNames.length > 0
          ? `${text}\n\n📎 ${nonImageNames.join(', ')}`
          : text
        : nonImageNames.length > 0
        ? `📎 ${nonImageNames.join(', ')}`
        : '';

      const userMsg: UIMessage = {
        id: `u_${Date.now()}`,
        role: 'user',
        text: displayText,
        imagePreviews: imagePreviews.length > 0 ? imagePreviews : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputText('');
      // Clear only the attachments we're about to send; keep in-flight ones.
      setPendingAttachments((prev) =>
        prev.filter((a) => a.status !== 'ready')
      );
      setIsLoading(true);

      try {
        const nextHistory: AihousekeeperChatMessage[] = [
          ...serverMessages,
          { role: 'user', content: text || '(attached files)' },
        ];
        const res = await aihousekeeperApi.chat(
          hid,
          mode,
          nextHistory,
          readyAttachmentIds.length > 0 ? readyAttachmentIds : undefined
        );
        const { text: replyText } = renderAssistantContent(res.response.content);
        const parked = extractParked(res);
        const uiBlocks = [
          ...extractUIBlocks(res),
          ...buildGardenPlanCtaBlocks(replyText, text),
        ];
        const invalidations = extractInvalidations(res);
        const botMsg: UIMessage = {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text:
            replyText ||
            (uiBlocks.length > 0
              ? ''
              : parked.length > 0
              ? `Queued ${parked.length} action${parked.length === 1 ? '' : 's'} awaiting your approval.`
              : '…'),
          parked: parked.length > 0 ? parked : undefined,
          uiBlocks: uiBlocks.length > 0 ? uiBlocks : undefined,
        };
        if (parked.length > 0) setHasParkedApprovals(true);
        setMessages((prev) => [...prev, botMsg]);

        // Any mutating tool (create / update / complete / delete) tags its
        // result with `invalidate: [...]`. Kick a background refresh so the
        // Tasks / Plans tabs reflect Aihousekeeper's changes without requiring a
        // manual pull-to-refresh. Fire-and-forget: don't block the UI.
        if (invalidations.size > 0) {
          void refreshActivePropertyData();
        }
      } catch (err) {
        const errorMsg: UIMessage = {
          id: `a_err_${Date.now()}`,
          role: 'system',
          text: `Couldn’t reach ${personaName}: ${(err as Error).message}`,
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
        scrollToLatestMessage(true);
      }
    },
    [hid, isLoading, mode, pendingAttachments, personaName, serverMessages, refreshActivePropertyData, scrollToLatestMessage]
  );

  /**
   * Upload one file via the two-step aihousekeeper-attachments API. Tracks state in
   * `pendingAttachments`. Called for both image and document picks.
   */
  const uploadAttachment = useCallback(
    async (
      uri: string,
      fileName: string,
      mimeType: string,
      size: number | undefined,
      kindHint: string
    ) => {
      if (!hid) return;
      const tempId = `tmp_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      setPendingAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          fileName,
          mimeType,
          status: 'uploading',
          progress: 0,
          localUri: uri,
        },
      ]);

      // Tag each step so the user/logs can tell which part failed
      // (create-row vs. read-file vs. PUT).
      let step: 'create' | 'read' | 'put' = 'create';
      try {
        const created = await aihousekeeperApi.attachments.createUpload(hid, {
          fileName,
          mimeType,
          size,
          kindHint,
        });

        step = 'read';
        // Read file → ArrayBuffer so we can PUT the raw bytes. Works for
        // both image picker URIs and DocumentPicker cache URIs.
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: 'base64',
        });
        const bytes = base64ToArrayBuffer(base64);
        if (bytes.byteLength === 0) {
          throw new Error('read 0 bytes from local file');
        }

        step = 'put';
        await aihousekeeperApi.attachments.upload(
          created.uploadUrl,
          bytes,
          mimeType,
          (p) => {
            setPendingAttachments((prev) =>
              prev.map((a) =>
                a.id === tempId ? { ...a, progress: p } : a
              )
            );
          }
        );

        setPendingAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId
              ? {
                  ...a,
                  id: created.id,
                  status: 'ready',
                  progress: 1,
                }
              : a
          )
        );
      } catch (err) {
        const raw = (err as Error)?.message ?? 'Upload failed';
        // Axios errors carry response data with the server-side reason.
        type AxiosLike = {
          response?: { status?: number; data?: unknown };
        };
        const ax = err as AxiosLike;
        const serverMsg =
          typeof ax.response?.data === 'string'
            ? ax.response.data
            : ax.response?.data
            ? JSON.stringify(ax.response.data)
            : null;
        const statusPart = ax.response?.status
          ? ` [${ax.response.status}]`
          : '';
        const reason = serverMsg ? `${raw}${statusPart}: ${serverMsg}` : raw;
        console.warn('[aihousekeeper-attach]', step, reason);
        setPendingAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId
              ? {
                  ...a,
                  status: 'failed',
                  error: `${step}: ${reason}`,
                }
              : a
          )
        );
      }
    },
    [hid]
  );

  // When an image finishes uploading and the input is empty, auto-send it so
  // Aihousekeeper analyzes the photo without the user having to type. Guarded by a
  // ref so we only auto-send once per batch.
  const autoSendGuardRef = useRef(false);
  useEffect(() => {
    if (pendingAttachments.length === 0) {
      autoSendGuardRef.current = false;
      return;
    }
    const hasUploading = pendingAttachments.some(
      (a) => a.status === 'uploading'
    );
    const readyImages = pendingAttachments.filter(
      (a) => a.status === 'ready' && a.mimeType.startsWith('image/')
    );
    if (
      readyImages.length > 0 &&
      !hasUploading &&
      !inputText.trim() &&
      !isLoading &&
      !autoSendGuardRef.current
    ) {
      autoSendGuardRef.current = true;
      void sendMessage('');
    }
  }, [pendingAttachments, inputText, isLoading, sendMessage]);

  /**
   * Camera, Gallery and Drive, from the shared source hook.
   *
   * Two hand-rolled permission prompts and two near-identical picker calls
   * lived here, and Drive was missing — so a quote the household keeps in its
   * Drive folder could not be shown to the housekeeper at all. The Document
   * option below is the Files source; it keeps its own flow because it asks
   * what KIND of document it is before opening the picker, and that hint is
   * what the assistant reads the file as.
   */
  const { sourceHandlers, drivePicker } = useAttachmentSources({
    rememberScope: 'aihousekeeper-chat',
    mimeTypes: AIHOUSEKEEPER_ATTACHMENT_MIME_TYPES,
    pickerOptions: { compressImageQuality: 0.8, mediaType: 'photo' },
    onPicked: async ([picked], source) => {
      if (!picked) return;
      if (source === 'drive') {
        const isImage = picked.mime?.startsWith('image/') ?? false;
        await uploadAttachment(
          picked.uri,
          picked.name ?? `drive_${Date.now()}`,
          picked.mime ?? 'application/octet-stream',
          picked.size,
          isImage ? 'image' : 'Other'
        );
        return;
      }
      // Camera and gallery shots go through the vision-safe normaliser first,
      // exactly as they did before — the model rejects some originals outright.
      const safe = await toVisionSafeAttachment({
        uri: picked.uri,
        name: picked.name ?? `photo_${Date.now()}.jpg`,
        type: picked.mime ?? 'image/jpeg',
      });
      await uploadAttachment(safe.uri, safe.name, safe.type, picked.size, 'image');
    },
  });

  const pickDocument = useCallback(
    async (kind: DocumentKind) => {
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: [
            'application/pdf',
            'image/*',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (result.canceled || result.assets.length === 0) return;
        const asset = result.assets[0];
        await uploadAttachment(
          asset.uri,
          asset.name,
          asset.mimeType ?? 'application/octet-stream',
          asset.size,
          kind
        );
      } catch (err) {
        const message = (err as Error)?.message ?? 'Unknown error';
        Alert.alert("Can't pick document", message);
      }
    },
    [uploadAttachment]
  );

  /**
   * Remove the kind prompt from the transcript. Used on cancel and after
   * the user picks a kind (before opening the document picker).
   */
  const dismissDocumentKindPrompt = useCallback((promptId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== promptId));
  }, []);

  /** User tapped a kind bubble in the prompt → open picker with that kind. */
  const handleDocumentKindPick = useCallback(
    (promptId: string, kind: DocumentKind) => {
      dismissDocumentKindPrompt(promptId);
      void pickDocument(kind);
    },
    [dismissDocumentKindPrompt, pickDocument]
  );

  /**
   * Post an in-chat prompt asking the user to classify the document. Tapping
   * a kind-bubble opens the picker (see `handleDocumentKindPick`).
   */
  const askDocumentKind = useCallback(() => {
    const promptMsg: UIMessage = {
      id: `kind_${Date.now()}`,
      role: 'assistant',
      text: 'What would you like to add?',
      documentKindPrompt: true,
    };
    setMessages((prev) => [...prev, promptMsg]);
    scrollToLatestMessage(true);
  }, [scrollToLatestMessage]);

  const openAttachmentMenu = useCallback(() => {
    // The fleet-wide list: camera, gallery, file, drive. "Document" is the file
    // source under the name this screen has always used for it.
    const options = ['Take Photo', 'Photo Library', 'Document', 'Drive', 'Cancel'];
    const handle = (idx: number) => {
      if (idx === 0) sourceHandlers.onCamera();
      else if (idx === 1) sourceHandlers.onGallery();
      else if (idx === 2) askDocumentKind();
      else if (idx === 3) sourceHandlers.onDrive();
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 4 },
        handle
      );
    } else {
      Alert.alert('Attach', 'Choose a source', [
        { text: options[0], onPress: () => handle(0) },
        { text: options[1], onPress: () => handle(1) },
        { text: options[2], onPress: () => handle(2) },
        { text: options[3], onPress: () => handle(3) },
        { text: options[4], style: 'cancel' },
      ]);
    }
  }, [askDocumentKind, sourceHandlers]);

  const clearChat = useCallback(() => {
    if (messages.length === 0) return;
    const run = () => {
      setMessages([]);
      clearStoredChat();
      setHasParkedApprovals(false);
    };
    Alert.alert(
      'Clear chat?',
      `This removes all messages in your conversation with ${personaName}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: run },
      ]
    );
  }, [clearStoredChat, messages.length, personaName]);

  // Overflow menu — consolidates what used to be the Aihousekeeper hub tab:
  // Approvals, Settings, plus a destructive "Clear chat" action. Lives on the
  // right side of the header now that chat is the AI Housekeeper tab's landing.
  const openOverflowMenu = useCallback(() => {
    const options = ['Approvals', 'Settings', 'Clear chat', 'Cancel'];
    const handle = (idx: number) => {
      if (idx === 0) router.push('/aihousekeeper-approvals');
      else if (idx === 1) router.push('/aihousekeeper-settings');
      else if (idx === 2) clearChat();
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: 3,
          destructiveButtonIndex: 2,
        },
        handle
      );
    } else {
      Alert.alert(personaName, 'Where to?', [
        { text: options[0], onPress: () => handle(0) },
        { text: options[1], onPress: () => handle(1) },
        { text: options[2], onPress: () => handle(2), style: 'destructive' },
        { text: options[3], style: 'cancel' },
      ]);
    }
  }, [clearChat, personaName, router]);

  const removePendingAttachment = useCallback(
    (id: string) => {
      if (!id.startsWith('tmp_') && hid) {
        aihousekeeperApi.attachments.delete(hid, id).catch(() => {
          // Silent — row may already be gone; UI still drops it.
        });
      }
      setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
    },
    [hid]
  );

  const renderItem = useCallback(
    ({ item }: { item: UIMessage }) => {
      const isUser = item.role === 'user';
      const isSystem = item.role === 'system';
      // UI blocks (task lists, action cards) render in a separate sibling
      // row BELOW the text bubble so each surface gets the right chrome:
      // the text keeps its normal chat bubble (readable on busy backgrounds)
      // while the cards span the full row width edge-to-edge.
      const hasUIBlocks = !!item.uiBlocks && item.uiBlocks.length > 0;
      const showApprovalCta = messageImpliesApproval(item);
      const hasBubbleContent =
        !!item.text ||
        !!(item.imagePreviews && item.imagePreviews.length > 0) ||
        !!item.documentKindPrompt ||
        showApprovalCta;
      const bg = isUser
        ? colors.chatUserBubble
        : isSystem
        ? colors.warning
        : colors.chatAssistantBubble;
      const fg = colors.textPrimary;

      return (
        <View style={styles.messageWrapper}>
          {hasBubbleContent ? (
            <View
              style={[
                styles.bubbleRow,
                isUser ? styles.bubbleRowUser : styles.bubbleRowBot,
              ]}
            >
              <Card
                style={[
                  styles.bubble,
                  { backgroundColor: bg },
                  isUser ? styles.bubbleUser : styles.bubbleBot,
                  item.imagePreviews && item.imagePreviews.length > 0
                    ? styles.bubbleWithImage
                    : null,
                ]}
              >
            {item.imagePreviews && item.imagePreviews.length > 0 ? (
              <View style={styles.imagePreviewStack}>
                {item.imagePreviews.map((uri, idx) => (
                  <Image
                    key={`${item.id}_img_${idx}`}
                    source={{ uri }}
                    style={[
                      styles.messageImage,
                      { backgroundColor: colors.mediaImagePlaceholder },
                    ]}
                    resizeMode="cover"
                  />
                ))}
              </View>
            ) : null}
            {item.text ? (
              // Assistant + system bubbles render markdown (`**bold**`,
              // bullet `- ` lists, blank-line paragraphs). User bubbles
              // are plain Text — users don't write markdown.
              (isUser ? (<Typography variant="body" color={fg}>
                {item.text}
              </Typography>) : (<MarkdownText text={item.text} color={fg} />))
            ) : null}
            {item.documentKindPrompt ? (
              <View style={styles.kindBubbles}>
                {DOCUMENT_KINDS.map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => handleDocumentKindPick(item.id, k)}
                    style={({ pressed }) => [
                      styles.kindBubble,
                      {
                        backgroundColor: colors.primary,
                        opacity: pressed ? ButtonMetrics.pressOpacityCard : 1,
                      },
                    ]}
                  >
                    <Typography
                      variant="footnote"
                      weight="semibold"
                      color={colors.black}
                    >
                      {k}
                    </Typography>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => dismissDocumentKindPrompt(item.id)}
                  hitSlop={6}
                  style={styles.kindCancel}
                >
                  <Typography
                    variant="caption1"
                    color={colors.textSecondary}
                  >
                    Cancel
                  </Typography>
                </Pressable>
              </View>
            ) : null}
            {showApprovalCta ? (
              <Pressable
                onPress={() => {
                  setHasParkedApprovals(true);
                  router.push('/aihousekeeper-approvals');
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  item.parked && item.parked.length > 0
                    ? `Review ${item.parked.length} pending approval${
                        item.parked.length === 1 ? '' : 's'
                      }`
                    : 'Open Aihousekeeper approvals'
                }
                style={({ pressed }) => [
                  styles.parkedLink,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed
                      ? ButtonMetrics.pressOpacityDisabled
                      : 1,
                  },
                ]}
              >
                <Icon name="bell-ring-outline" size={16} color={colors.black} />
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.black}
                >
                  {item.parked && item.parked.length > 0
                    ? item.parked.length === 1
                      ? 'Tap to approve in Approvals'
                      : `Tap to approve ${item.parked.length} in Approvals`
                    : 'Open Approvals'}
                </Typography>
                {item.parked && item.parked.length > 0 ? (
                  <View
                    style={[
                      styles.parkedCountBadge,
                      { backgroundColor: colors.black },
                    ]}
                  >
                    <Typography
                      variant="caption2"
                      weight="bold"
                      color={colors.primary}
                    >
                      {item.parked.length}
                    </Typography>
                  </View>
                ) : (
                  <Icon
                    name="chevron-right"
                    size={18}
                    color={colors.black}
                  />
                )}
              </Pressable>
            ) : null}
              </Card>
            </View>
          ) : null}
          {hasUIBlocks ? (
            // UI blocks sit in their own full-width row beneath the text
            // bubble. They render edge-to-edge so titles aren't truncated.
            (<View
              style={[
                styles.uiBlocksRow,
                hasBubbleContent ? styles.uiBlocksRowSpacing : null,
              ]}
            >
              {item.uiBlocks!.map((block, i) => (
                <AssistantUIBlock
                  key={`${item.id}_ui_${i}`}
                  block={block}
                  onSendMessage={(text) => void sendMessage(text)}
                />
              ))}
            </View>)
          ) : null}
        </View>
      );
    },
    [
      colors,
      dismissDocumentKindPrompt,
      handleDocumentKindPick,
      router,
      sendMessage,
    ]
  );

  if (!hid) {
    const hasPendingRequest = myPendingJoinRequests.length > 0;
    const pendingHouseholdName = hasPendingRequest
      ? myPendingJoinRequests[0].household_name
      : null;

    return (
      <AppBackground opacity={0.5}>
        <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
          <ScreenHeader
            title={personaName}
            titleLeadingElement={
              <Pressable
                onPress={() => router.push('/aihousekeeper-settings')}
                hitSlop={8}
                accessibilityLabel={`Open ${personaName} settings`}
              >
                <PersonaAvatar persona={persona} size={Header.circleButtonSize} />
              </Pressable>
            }
            showBackButton={!isTabRoot}
            onBackPress={() => {
              if (navigation.canGoBack()) navigation.goBack();
            }}
            rightElement={isTabRoot ? <SettingsGearButton /> : undefined}
          />
          <View style={styles.empty}>
            {hasPendingRequest ? (
              <>
                <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                  Request pending
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.emptySubtitle}
                >
                  Your request to join
                  {pendingHouseholdName ? ` “${pendingHouseholdName}”` : ' this household'} is
                  waiting for an owner to approve it. You'll be notified once it's approved or
                  declined, and {personaName} will be ready to chat.
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                  Select a household
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.emptySubtitle}
                >
                  Pick a household from the switcher to chat with {personaName}.
                </Typography>
              </>
            )}
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  if (!aiEntitlementLoading && (!aiFeaturesEnabled || !canUseAI)) {
    return (
      <AppBackground opacity={0.5}>
        <SafeAreaView style={{ flex: 1 }} edges={['bottom']} testID="mira-chat-locked">
          <ScreenHeader
            title={personaName}
            titleLeadingElement={
              <Pressable
                onPress={() => router.push('/aihousekeeper-settings')}
                hitSlop={8}
                accessibilityLabel={`Open ${personaName} settings`}
              >
                <PersonaAvatar persona={persona} size={Header.circleButtonSize} />
              </Pressable>
            }
            showBackButton={!isTabRoot}
            onBackPress={() => {
              if (navigation.canGoBack()) navigation.goBack();
            }}
            rightElement={isTabRoot ? <SettingsGearButton /> : undefined}
          />
          <AIAccessGate title={`Unlock ${personaName}`}>
            <View />
          </AIAccessGate>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']} testID="mira-chat-screen">
        <ScreenHeader
          title={personaName}
          titleAlign="left"
          titleLeadingElement={
            <Pressable
              onPress={() => router.push('/aihousekeeper-settings')}
              hitSlop={8}
              testID="mira-chat-persona-settings"
              accessibilityLabel={`Open ${personaName} settings`}
            >
              <PersonaAvatar persona={persona} size={32} />
            </Pressable>
          }
          showBackButton={!isTabRoot}
          onBackPress={() => navigation.goBack()}
          rightElement={
            <>
              {/* Gear only while this is the Mira TAB — pushed from elsewhere
                  the header keeps its clean back+title look. The overflow menu
                  keeps the trailing slot it already had. */}
              {isTabRoot ? <SettingsGearButton /> : null}
              <HeaderActionButton
                iconOnly
                onPress={openOverflowMenu}
                testID="mira-chat-overflow-menu"
                accessibilityLabel="More options"
              >
                <Icon
                  name="dots-horizontal"
                  size={Header.actionIconSize}
                  color={colors.primary}
                />
                {hasParkedApprovals ? (
                  <View
                    style={[
                      styles.overflowDot,
                      { backgroundColor: colors.error, borderColor: colors.white },
                    ]}
                  />
                ) : null}
              </HeaderActionButton>
            </>
          }
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={[
              styles.listContent,
              messages.length === 0 && styles.listContentEmpty,
              // Ensure the last message clears the floating tab bar when this
              // chat is rendered as the tab root. Without this, scrolling to
              // the bottom can leave a message visually under the tab bar.
              needsBottomTabClearance && styles.listContentTabRoot,
            ]}
            onLayout={() => scrollToLatestMessage(false)}
            onContentSizeChange={() => scrollToLatestMessage(false)}
            ListEmptyComponent={
              <View style={[styles.welcomeCard, isTablet && styles.welcomeCardTablet]}>
                <View
                  style={[
                    styles.welcomeAvatar,
                    { backgroundColor: colors.personaVideoPlaceholder },
                  ]}
                >
                  <PersonaWelcomeVideo
                    source={persona.video ?? require('@assets/aihousekeeper/personas/Mira.mp4')}
                    style={styles.welcomeVideo}
                    muted={welcomeMuted}
                  />
                  <Pressable
                    onPress={() => setWelcomeMuted((m) => !m)}
                    hitSlop={8}
                    style={[
                      styles.welcomeMuteBtn,
                      { backgroundColor: colors.mediaOverlayScrim },
                    ]}
                    accessibilityLabel={
                      welcomeMuted ? 'Unmute intro' : 'Mute intro'
                    }
                    accessibilityRole="button"
                  >
                    <Icon
                      name={welcomeMuted ? 'volume-off' : 'volume-high'}
                      size={20}
                      color={colors.white}
                    />
                  </Pressable>
                </View>
                <Typography
                  variant="headline"
                  weight="semibold"
                  color={colors.textPrimary}
                >
                  Hi, I'm {personaName}.
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textPrimary}
                  style={styles.welcomeCopy}
                >
                  Ask me to assign a task, remember a preference, schedule a
                  followup, or draft a message to a contractor.
                </Typography>
              </View>
            }
          />
          {pendingAttachments.length > 0 ? (
            <View
              style={[
                styles.attachmentTray,
                { borderTopColor: colors.chatInputBorder },
              ]}
            >
              {pendingAttachments.map((a) => {
                const bg =
                  a.status === 'failed'
                    ? colors.warning
                    : colors.cardBackground;
                const label =
                  a.status === 'uploading'
                    ? `${a.fileName} · ${Math.round((a.progress ?? 0) * 100)}%`
                    : a.status === 'failed'
                    ? `${a.fileName} · failed`
                    : a.fileName;
                const isImage =
                  a.mimeType.startsWith('image/') && !!a.localUri;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => {
                      if (a.status === 'failed') {
                        Alert.alert(
                          'Upload failed',
                          a.error ?? 'The file could not be uploaded.'
                        );
                      }
                    }}
                    style={[
                      styles.attachmentChip,
                      {
                        backgroundColor: bg,
                        borderColor: colors.chatInputBorder,
                      },
                    ]}
                    accessibilityLabel={
                      a.status === 'failed'
                        ? `${a.fileName} failed — tap for details`
                        : a.fileName
                    }
                  >
                    {isImage ? (
                      <View
                        style={[
                          styles.chipPreviewWrap,
                          { backgroundColor: colors.mediaImagePlaceholder },
                        ]}
                      >
                        <Image
                          source={{ uri: a.localUri }}
                          style={styles.chipPreview}
                          resizeMode="cover"
                        />
                        {a.status === 'uploading' ? (
                          <View
                            style={[
                              styles.chipPreviewOverlay,
                              { backgroundColor: colors.mediaOverlayScrim },
                            ]}
                          >
                            <ActivityIndicator
                              size="small"
                              color={colors.white}
                            />
                          </View>
                        ) : a.status === 'failed' ? (
                          <View
                            style={[
                              styles.chipPreviewOverlay,
                              { backgroundColor: colors.mediaOverlayScrim },
                            ]}
                          >
                            <Typography
                              variant="caption1"
                              weight="bold"
                              color={colors.white}
                            >
                              !
                            </Typography>
                          </View>
                        ) : null}
                      </View>
                    ) : a.status === 'uploading' ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.textSecondary}
                        style={styles.chipSpinner}
                      />
                    ) : null}
                    <Typography
                      variant="caption1"
                      color={colors.textPrimary}
                      numberOfLines={1}
                      style={styles.chipLabel}
                    >
                      {label}
                    </Typography>
                    <Pressable
                      onPress={() => removePendingAttachment(a.id)}
                      hitSlop={8}
                      style={styles.chipRemove}
                    >
                      <Typography
                        variant="caption1"
                        weight="semibold"
                        color={colors.textSecondary}
                      >
                        ×
                      </Typography>
                    </Pressable>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {voice.isActive ? (
            <VoiceActiveBar
              state={voice.state}
              partial={voice.partialAssistantTranscript}
              persona={persona}
              isTabRoot={needsBottomTabClearance}
              onEnd={() => {
                void voice.exit();
              }}
            />
          ) : (
            <View
              style={[
                styles.inputRow,
                { borderTopColor: colors.chatInputBorder },
                // At the tab root, push the input above the floating tab bar.
                needsBottomTabClearance && styles.inputRowTabRoot,
                shouldUseSidebar && styles.inputRowSidebar,
              ]}
            >
              <Pressable
                onPress={openAttachmentMenu}
                disabled={isLoading}
                hitSlop={6}
                testID="mira-chat-attach"
                style={({ pressed }) => [
                  styles.attachBtn,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                    opacity: isLoading || pressed
                      ? ButtonMetrics.pressOpacityDisabled
                      : 1,
                  },
                ]}
                accessibilityLabel="Attach image or document"
              >
                <Typography variant="body" weight="semibold" color={colors.black}>
                  +
                </Typography>
              </Pressable>
              <Pressable
                onPress={handleVoiceToggle}
                disabled={isLoading || !hid}
                hitSlop={6}
                testID="mira-chat-voice-toggle"
                style={({ pressed }) => [
                  styles.voiceBtn,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                    opacity: isLoading || !hid || pressed
                      ? ButtonMetrics.pressOpacityDisabled
                      : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Start voice mode"
              >
                <Icon name="microphone" size={22} color={colors.black} />
              </Pressable>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.chatInputBackground,
                    color: colors.textPrimary,
                    borderColor: colors.chatInputBorder,
                    fontSize: TypographyTokens.label.size,
                  },
                ]}
                value={inputText}
                onChangeText={setInputText}
                placeholder={`Message ${personaName}…`}
                placeholderTextColor={colors.textSecondary}
                multiline
                editable={!isLoading}
                onSubmitEditing={() => sendMessage(inputText)}
                blurOnSubmit
                returnKeyType="send"
                testID="mira-chat-input"
              />
              <Pressable
                onPress={() => sendMessage(inputText)}
                disabled={
                  isLoading ||
                  (!inputText.trim() &&
                    !pendingAttachments.some((a) => a.status === 'ready'))
                }
                testID="mira-chat-send"
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity:
                      isLoading ||
                      pressed ||
                      (!inputText.trim() &&
                        !pendingAttachments.some((a) => a.status === 'ready'))
                        ? ButtonMetrics.pressOpacityDisabled
                        : 1,
                  },
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.black} size="small" />
                ) : (
                  <Typography
                    variant="body"
                    weight="semibold"
                    color={colors.black}
                  >
                    Send
                  </Typography>
                )}
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
      {drivePicker}
    </AppBackground>
  );
}

/**
 * Compact voice-mode bar that replaces the input row while a voice session
 * is live. The chat list stays fully visible above it so the user can watch
 * their own transcripts and Aihousekeeper's replies land in real time.
 */
function VoiceActiveBar({
  state,
  partial,
  persona,
  isTabRoot,
  onEnd,
}: {
  state: import('@services/voice-chat').VoiceChatState;
  partial: string;
  persona: React.ComponentProps<typeof PersonaAvatar>['persona'];
  isTabRoot: boolean;
  onEnd: () => void;
}) {
  const colors = useAppColors();
  const stateLabel = (() => {
    switch (state) {
      case 'connecting':
        return 'Connecting…';
      case 'listening':
        return 'Listening';
      case 'thinking':
        return 'Thinking…';
      case 'speaking':
        return 'Speaking';
      case 'error':
        return 'Error — tap to end';
      default:
        return '';
    }
  })();
  const dotColor =
    state === 'speaking'
      ? colors.primary
      : state === 'thinking'
      ? colors.warning
      : state === 'error'
      ? colors.error
      : colors.primary;
  return (
    <View
      style={[
        styles.voiceBar,
        {
          backgroundColor: colors.cardBackground,
          borderTopColor: colors.chatInputBorder,
        },
        isTabRoot && styles.inputRowTabRoot,
      ]}
    >
      <PersonaAvatar persona={persona} size={36} />
      <View style={styles.voiceBarText}>
        <View style={styles.voiceBarStateRow}>
          <View style={[styles.voiceBarDot, { backgroundColor: dotColor }]} />
          <Typography
            variant="caption1"
            weight="semibold"
            color={colors.textPrimary}
          >
            {stateLabel}
          </Typography>
        </View>
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          numberOfLines={1}
        >
          {partial.length > 0 ? partial : 'Transcripts appear in chat above.'}
        </Typography>
      </View>
      <Pressable
        onPress={() => {
          console.log('[VoiceActiveBar] end pressed');
          onEnd();
        }}
        hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
        style={({ pressed }) => [
          styles.voiceBarEndBtn,
          {
            backgroundColor: colors.error,
            opacity: pressed ? 0.6 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="End voice mode"
        testID="mira-chat-voice-end"
      >
        <Icon name="close" size={22} color={colors.white} />
      </Pressable>
    </View>
  );
}

// All literal numbers below are tokenized from `@theme`. See:
//  - DesignSystem.md §3 (Spacing), §4 (CornerRadius), §8 (Chat)
//  - src/theme/designTokens.ts (canonical values)
const styles = StyleSheet.create({
  listContent: { padding: Spacing.base, paddingBottom: Spacing.xl },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  // Adds floating-tab-bar clearance to the FlatList content. Use at every
  // tab-root scrollable so the last item never sits under the tab bar.
  // See DesignSystem.md §3 (Layout) and the rule under §16 (Anti-patterns).
  listContentTabRoot: { paddingBottom: Layout.bottomTabBarClearance },
  welcomeCard: { padding: Spacing.lg, alignItems: 'center' },
  welcomeCardTablet: {
    maxWidth: Layout.readingMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  welcomeCopy: { textAlign: 'center', marginTop: Spacing.sm },
  welcomeAvatar: {
    width: ChatTokens.welcomeAvatarSize,
    height: ChatTokens.welcomeAvatarSize,
    borderRadius: ChatTokens.welcomeAvatarSize / 2,
    overflow: 'hidden',
    marginBottom: Spacing.base,
  },
  welcomeVideo: {
    width: ChatTokens.welcomeAvatarSize,
    height: ChatTokens.welcomeAvatarSize,
    borderRadius: ChatTokens.welcomeAvatarSize / 2,
  },
  welcomeMuteBtn: {
    position: 'absolute',
    right: Spacing.sm,
    bottom: Spacing.sm,
    minWidth: ButtonMetrics.iconButtonSize,
    height: ButtonMetrics.iconButtonSize,
    paddingHorizontal: Spacing.sm + Spacing.xxs,
    borderRadius: ButtonMetrics.iconButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Spacing now owned by `messageWrapper` since UI blocks may sit beneath
  // the bubble inside the same wrapper.
  bubbleRow: { flexDirection: 'row' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowBot: { justifyContent: 'flex-start' },
  bubble: {
    paddingHorizontal: ChatTokens.bubblePaddingHorizontal,
    paddingVertical: ChatTokens.bubblePaddingVertical,
    borderRadius: ChatTokens.bubbleRadius,
    maxWidth: `${ChatTokens.bubbleMaxWidthRatio * 100}%`,
  },
  bubbleUser: { borderTopRightRadius: ChatTokens.bubbleTailRadius },
  bubbleBot: { borderTopLeftRadius: ChatTokens.bubbleTailRadius },
  // When an image fills the bubble, trim padding so the photo goes edge-to-edge.
  bubbleWithImage: { paddingHorizontal: Spacing.xs, paddingVertical: Spacing.xs },
  // Widen the bubble when it carries generative UI (task cards, lists) so the
  // cards don't wrap awkwardly inside the default 85% bubble width.
  bubbleWide: { maxWidth: `${ChatTokens.bubbleWideMaxWidthRatio * 100}%` },
  // UI-only assistant turn (task list, cards, no plain text): full row width
  // with zero padding/background so each card spans edge-to-edge and titles
  // don't get truncated by the bubble chrome.
  bubbleUIOnly: {
    maxWidth: '100%',
    width: '100%',
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: 'transparent',
    borderTopRightRadius: 0,
    borderTopLeftRadius: 0,
  },
  // Wraps an entire chat message (text bubble + optional UI blocks below).
  // The two pieces stack vertically with `uiBlocksRowSpacing` between them.
  messageWrapper: {
    marginBottom: ChatTokens.bubbleRowSpacing,
  },
  // Full-width container for AssistantUIBlock cards. No padding / background;
  // the cards themselves carry their own elevation + spacing.
  uiBlocksRow: {
    width: '100%',
  },
  uiBlocksRowSpacing: {
    marginTop: Spacing.sm,
  },
  imagePreviewStack: { gap: ChatTokens.compactGap },
  messageImage: {
    width: ChatTokens.imagePreviewSize,
    height: ChatTokens.imagePreviewSize,
    borderRadius: CornerRadius.md,
  },
  parkedLink: {
    marginTop: Spacing.sm,
    paddingVertical: ChatTokens.parkedLinkPaddingVertical + Spacing.xxs,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.md,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  parkedCountBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindBubbles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: ChatTokens.bubbleRowSpacing,
  },
  kindBubble: {
    paddingHorizontal: ChatTokens.bubblePaddingHorizontal,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.xl,
  },
  kindCancel: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    alignSelf: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: ChatTokens.inputRowPadding,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: ChatTokens.inputRowGap,
  },
  inputRowTabRoot: {
    paddingBottom: Layout.bottomTabBarClearance,
  },
  inputRowSidebar: {
    maxWidth: Layout.readingMaxWidth,
    width: '100%',
    alignSelf: 'center',
    borderTopWidth: 0,
    paddingBottom: Spacing.base,
  },
  overflowDot: {
    position: 'absolute',
    top: Spacing.xxs,
    right: Spacing.xxs,
    width: Spacing.sm,
    height: Spacing.sm,
    borderRadius: CornerRadius.xs,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: ChatTokens.inputMinHeight,
    maxHeight: ChatTokens.inputMaxHeight,
    paddingHorizontal: ChatTokens.inputRowPadding,
    paddingVertical: ChatTokens.bubblePaddingVertical,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  sendBtn: {
    minWidth: ChatTokens.sendButtonMinWidth,
    height: ChatTokens.actionButtonSize,
    borderRadius: ChatTokens.actionButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBtn: {
    width: ChatTokens.actionButtonSize,
    height: ChatTokens.actionButtonSize,
    borderRadius: ChatTokens.actionButtonSize / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtn: {
    width: ChatTokens.actionButtonSize,
    height: ChatTokens.actionButtonSize,
    borderRadius: ChatTokens.actionButtonSize / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: ChatTokens.inputRowPadding,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  voiceBarText: {
    flex: 1,
    minWidth: 0,
  },
  voiceBarStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ChatTokens.compactGap,
    marginBottom: ChatTokens.metaSpacingTight,
  },
  voiceBarDot: {
    width: Spacing.sm,
    height: Spacing.sm,
    borderRadius: Spacing.xs,
  },
  voiceBarEndBtn: {
    width: ChatTokens.actionButtonSize,
    height: ChatTokens.actionButtonSize,
    borderRadius: ChatTokens.actionButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentTray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ChatTokens.compactGap,
    paddingHorizontal: ChatTokens.inputRowPadding,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm + Spacing.xxs,
    paddingVertical: ChatTokens.parkedLinkPaddingVertical,
    borderRadius: CornerRadius.sm + Spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  chipSpinner: { marginRight: ChatTokens.compactGap },
  chipPreviewWrap: {
    width: ChatTokens.chipPreviewSize,
    height: ChatTokens.chipPreviewSize,
    borderRadius: CornerRadius.sm + Spacing.xxs,
    overflow: 'hidden',
    marginRight: Spacing.sm + Spacing.xxs,
  },
  chipPreview: {
    width: '100%',
    height: '100%',
  },
  chipPreviewOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: { maxWidth: ChatTokens.chipLabelMaxWidth, marginRight: Spacing.sm },
  chipRemove: {
    width: ChatTokens.chipRemoveHitSize,
    height: ChatTokens.chipRemoveHitSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  emptySubtitle: { marginTop: Spacing.sm, textAlign: 'center' },
});

/** Lightweight base64 → ArrayBuffer for the attachment PUT body. */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decoder = (globalThis as any).atob as (s: string) => string;
  const binary = decoder(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export default AihousekeeperChatScreen;
