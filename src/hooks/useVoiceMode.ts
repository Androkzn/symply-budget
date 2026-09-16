/**
 * useVoiceMode — host hook that drives the OpenAI Realtime voice bridge.
 *
 * Transcription-driven pattern (NOT forced tool calls):
 *   - Session has no tools and `create_response: false`. OpenAI transcribes
 *     the user's speech and emits an input_audio_transcription.completed
 *     event. It does NOT auto-generate a response.
 *   - On that event, we POST the transcript to /aihousekeeper/chat. Claude runs all
 *     of Aihousekeeper's tools + memory + approvals exactly like text chat does.
 *   - When Claude's reply lands, we push it to the chat screen AND inject it
 *     as an assistant conversation item via service.voiceAssistantText().
 *     OpenAI then voices the injected text verbatim.
 *
 * Knowledge-consistency: Claude is the only brain. OpenAI is purely a voice
 * codec — it never reasons, never answers from its own context.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  aihousekeeperApi,
  type AihousekeeperChatMessage,
  type AihousekeeperChatMode,
  type AihousekeeperChatResponse,
} from '@api/aihousekeeper';
import {
  VoiceChatService,
  type VoiceChatState,
} from '@services/voice-chat';

export interface UseVoiceModeArgs {
  householdId: string | null | undefined;
  mode: AihousekeeperChatMode;
  /** Snapshot-at-call-time of the chat history already on screen. */
  getMessageHistory: () => AihousekeeperChatMessage[];
  /** Host adds this user turn to the chat UI when the user finishes speaking. */
  onUserMessage: (text: string) => void;
  /** Host adds Claude's assistant reply + renders any tool_result UI blocks. */
  onAssistantMessage: (response: AihousekeeperChatResponse) => void;
  /** Optional toast/alert hook for unrecoverable errors. */
  onError?: (err: Error) => void;
  /** Optional override for the voice id (defaults to server default). */
  voice?: string;
  /**
   * ISO-639-1 language for speech-to-text ("en", "ru", "es", …). When omitted
   * the server falls back to auto-detect. Pin this for users who speak a
   * non-English language — auto-detect scrambles mixed/short utterances.
   */
  language?: string;
}

export interface UseVoiceModeApi {
  state: VoiceChatState;
  /** True whenever the session is connecting or live. */
  isActive: boolean;
  /** Start a new session. Throws on session-mint or WebRTC failures. */
  enter: () => Promise<void>;
  /** Tear the session down; safe to call multiple times. */
  exit: () => Promise<void>;
  /** Live streaming transcript of the assistant's current utterance. */
  partialAssistantTranscript: string;
}

/** Pull concatenated text from either a string or a Claude content-block array. */
function extractAssistantText(
  content: AihousekeeperChatResponse['response']['content']
): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}

/**
 * Claude calls `close_voice_mode` when the user asks to leave voice. The
 * tool is a no-op on the server; its only payload is `voice_mode_closed: true`
 * which tells us to tear down the OpenAI Realtime session client-side.
 */
function shouldCloseVoiceMode(res: AihousekeeperChatResponse): boolean {
  return res.tool_results.some(
    (r) =>
      r.result.ok &&
      (r.result as { voice_mode_closed?: unknown }).voice_mode_closed === true
  );
}

export function useVoiceMode(args: UseVoiceModeArgs): UseVoiceModeApi {
  const {
    householdId,
    mode,
    getMessageHistory,
    onUserMessage,
    onAssistantMessage,
    onError,
    voice,
    language,
  } = args;

  // Stable refs to the latest callbacks so the effect that subscribes to the
  // service doesn't need to resubscribe every render.
  const getHistoryRef = useRef(getMessageHistory);
  const onUserMessageRef = useRef(onUserMessage);
  const onAssistantMessageRef = useRef(onAssistantMessage);
  const onErrorRef = useRef(onError);
  getHistoryRef.current = getMessageHistory;
  onUserMessageRef.current = onUserMessage;
  onAssistantMessageRef.current = onAssistantMessage;
  onErrorRef.current = onError;

  const serviceRef = useRef<VoiceChatService | null>(null);
  const [state, setState] = useState<VoiceChatState>('idle');
  const [partial, setPartial] = useState('');

  // Remember the last user turn we forwarded to Claude so the same transcript
  // event (GA can fire twice in some cases) doesn't produce duplicate bridge
  // calls. Keyed on text — Realtime doesn't expose a turn id at this layer.
  const lastForwardedTextRef = useRef<string>('');
  // Ref wrapper around the bridge so we can call the latest captured closure
  // from inside the mount-once useEffect without re-subscribing.
  const bridgeRef = useRef<((text: string) => void) | null>(null);

  // Lazy-init the service + attach listeners once.
  useEffect(() => {
    const svc = new VoiceChatService();
    serviceRef.current = svc;

    const offState = svc.on('stateChange', (s) => {
      setState(s);
      if (s === 'listening' || s === 'idle') setPartial('');
    });

    const offUser = svc.on('userTranscript', (text) => {
      // 1. Show the user bubble.
      onUserMessageRef.current(text);
      // 2. Kick the transcription-driven bridge.
      bridgeRef.current?.(text);
    });

    const offAssistantDelta = svc.on('assistantTranscriptDelta', (full) => {
      setPartial(full);
    });

    const offAssistantDone = svc.on('assistantTranscriptDone', () => {
      setPartial('');
    });

    const offError = svc.on('error', (err) => {
      onErrorRef.current?.(err);
    });

    return () => {
      offState();
      offUser();
      offAssistantDelta();
      offAssistantDone();
      offError();
      // Best-effort teardown on unmount — no await to keep cleanup sync.
      void svc.stop();
      serviceRef.current = null;
    };
     
  }, []);

  /**
   * Transcription-driven bridge. Called whenever OpenAI finishes
   * transcribing a user utterance. POSTs the transcript through Claude
   * via /aihousekeeper/chat, then voices the reply back through Realtime.
   */
  const runTranscriptionBridge = useCallback(
    async (userText: string) => {
      const svc = serviceRef.current;
      if (!svc) return;

      const text = (userText ?? '').trim();
      if (!text) return;
      if (text === lastForwardedTextRef.current) return; // dedup
      lastForwardedTextRef.current = text;

      if (!householdId) {
        svc.voiceAssistantText(
          "I'm not attached to a household right now. Please exit voice mode and try again."
        );
        return;
      }

      // History snapshot + the new user turn. The host already rendered the
      // user bubble via onUserMessage from the userTranscript event.
      const history = getHistoryRef.current();
      const messages: AihousekeeperChatMessage[] = [
        ...history,
        { role: 'user', content: text },
      ];

      setState('thinking');

      try {
        const response = await aihousekeeperApi.chat(householdId, mode, messages);
        // Push Claude's full response to chat (with any tool_result UI blocks).
        onAssistantMessageRef.current(response);

        // Claude asked us to close voice mode — flip state to idle and stop
        // the WebRTC session. Skip voicing the reply; the user wants the mic
        // off now, not a spoken confirmation they'd have to wait through.
        if (shouldCloseVoiceMode(response)) {
          setState('idle');
          setPartial('');
          try {
            await svc.stop();
          } catch (stopErr) {
            console.warn(
              '[useVoiceMode] stop after close_voice_mode threw',
              stopErr
            );
          }
          return;
        }

        // Voice just the text portion.
        const reply = extractAssistantText(response.response.content);
        const voiced =
          reply.length > 0 ? reply : "I've taken care of that.";
        svc.voiceAssistantText(voiced);
      } catch (err) {
        const axiosErr = err as {
          response?: {
            status?: number;
            data?: { error?: { code?: string; message?: string } };
          };
          message?: string;
        };
        const serverMsg = axiosErr.response?.data?.error?.message;
        const serverCode = axiosErr.response?.data?.error?.code;
        const status = axiosErr.response?.status;
        const display =
          serverMsg && serverCode
            ? `${serverCode}: ${serverMsg}`
            : serverMsg ||
              axiosErr.message ||
              'chat request failed';
        console.error(
          '[useVoiceMode] transcription bridge failed',
          JSON.stringify({
            status,
            serverCode,
            serverMsg,
            historyTurns: messages.length,
            mode,
          })
        );
        svc.voiceAssistantText(
          'Something went wrong on my end. Please try again in a moment.'
        );
        onErrorRef.current?.(new Error(display));
      }
    },
    [householdId, mode]
  );

  // Keep bridgeRef pointing at the latest closure.
  useEffect(() => {
    bridgeRef.current = (t: string) => {
      void runTranscriptionBridge(t);
    };
  }, [runTranscriptionBridge]);

  const enter = useCallback(async () => {
    const svc = serviceRef.current;
    if (!svc) throw new Error('voice service not initialized');
    if (!householdId) throw new Error('no active household');
    if (svc.getState() !== 'idle' && svc.getState() !== 'error') return;

    lastForwardedTextRef.current = '';
    const session = await aihousekeeperApi.createVoiceSession(householdId, {
      voice,
      language,
    });
    await svc.start(session);
  }, [householdId, voice, language]);

  const exit = useCallback(async () => {
    // Optimistically flip UI state to `idle` first — if the service is
    // wedged its own stateChange emit might not arrive promptly.
    setState('idle');
    setPartial('');
    const svc = serviceRef.current;
    if (!svc) return;
    try {
      await svc.stop();
    } catch (err) {
      console.warn('[useVoiceMode] exit: svc.stop threw', err);
    }
  }, []);

  const isActive = state !== 'idle' && state !== 'error';

  return { state, isActive, enter, exit, partialAssistantTranscript: partial };
}
