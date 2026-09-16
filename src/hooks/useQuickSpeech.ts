/**
 * useQuickSpeech — fast, on-device speech-to-text for quick task capture.
 *
 * Wraps `expo-speech-recognition` (jamsch) for the "speak a task" path of the
 * Smart Task Assistant. This is the LOW-LATENCY capture lane: on-device STT with
 * interim results so a user can dictate "buy net for pool debris" and have it
 * become a task in seconds. The richer back-and-forth conversational lane lives
 * in the OpenAI Realtime bridge (see useVoiceMode), not here.
 *
 * Resilience: the native module may not be linked yet (the dep is added to
 * package.json but requires a dev-client rebuild). We require it defensively so
 * the JS bundle never crashes — `isAvailable` is false until the rebuild, and
 * the typed-text capture path keeps working in the meantime.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal surface of the native module we actually call. Kept local so the
 * defensive `require` doesn't drag the whole package's types in (and so the hook
 * compiles even before the package is installed / native side is rebuilt).
 */
interface SpeechRecognitionListener {
  remove: () => void;
}
interface SpeechRecognitionModuleLike {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (opts: { lang?: string; interimResults?: boolean; continuous?: boolean }) => void;
  stop: () => Promise<void>;
  addListener: (
    event: string,
    handler: (ev: { results?: Array<{ transcript?: string }>; error?: string; message?: string }) => void
  ) => SpeechRecognitionListener;
}

// Defensive require: resolves once the package is installed; native calls still
// no-op/throw (guarded below) until a dev-client rebuild links the module.
let SpeechModule: SpeechRecognitionModuleLike | null = null;
try {
   
  SpeechModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch {
  SpeechModule = null;
}

export interface UseQuickSpeechResult {
  /** True only when the native module is linked and usable on this build. */
  isAvailable: boolean;
  /** Mic is open and actively transcribing. */
  isListening: boolean;
  /** Best transcript so far (interim while listening, final after stop). */
  transcript: string;
  /** Last error message, if any. */
  error: string | null;
  /** Request permission + open the mic. Returns false if it couldn't start. */
  start: () => Promise<boolean>;
  /** Close the mic; the final transcript settles into `transcript`. */
  stop: () => Promise<void>;
  /** Clear transcript + error (call after consuming a result). */
  reset: () => void;
}

interface UseQuickSpeechOptions {
  /** BCP-47 language tag. Defaults to device locale handling by the OS. */
  lang?: string;
}

export function useQuickSpeech(options?: UseQuickSpeechOptions): UseQuickSpeechResult {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const subsRef = useRef<Array<{ remove: () => void }>>([]);

  const isAvailable = !!SpeechModule;

  const clearSubs = useCallback(() => {
    subsRef.current.forEach((s) => {
      try {
        s.remove();
      } catch {
        /* noop */
      }
    });
    subsRef.current = [];
  }, []);

  useEffect(() => clearSubs, [clearSubs]);

  const reset = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  const stop = useCallback(async () => {
    if (!SpeechModule) return;
    console.log('[QuickSpeech] stop() requested');
    try {
      await SpeechModule.stop();
    } catch {
      /* stopping a stopped recognizer is fine */
    }
    setIsListening(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    console.log('[QuickSpeech] start() requested', { isAvailable: !!SpeechModule, lang: options?.lang });
    if (!SpeechModule) {
      setError('Voice input needs an app update to enable.');
      console.warn('[QuickSpeech] native module NOT linked — cannot record');
      return false;
    }
    setError(null);
    setTranscript('');

    try {
      const perm = await SpeechModule.requestPermissionsAsync();
      console.log('[QuickSpeech] permission result', { granted: perm?.granted });
      if (!perm?.granted) {
        setError('Microphone & speech permission denied.');
        return false;
      }
    } catch (e) {
      setError((e as Error)?.message ?? 'Permission check failed.');
      console.warn('[QuickSpeech] permission check failed', (e as Error)?.message);
      return false;
    }

    clearSubs();
    subsRef.current.push(
      SpeechModule.addListener('result', (ev) => {
        const text = ev?.results?.[0]?.transcript;
        if (typeof text === 'string') {
          console.log('[QuickSpeech] interim transcript', { len: text.length, text });
          setTranscript(text);
        }
      }),
      SpeechModule.addListener('error', (ev) => {
        console.warn('[QuickSpeech] recognition error event', { error: ev?.error, message: ev?.message });
        // "no-speech" / "aborted" are benign end-of-session signals.
        if (ev?.error && ev.error !== 'no-speech' && ev.error !== 'aborted') {
          setError(ev?.message ?? String(ev.error));
        }
        setIsListening(false);
      }),
      SpeechModule.addListener('end', () => {
        console.log('[QuickSpeech] recognition ended');
        setIsListening(false);
      })
    );

    try {
      SpeechModule.start({
        lang: options?.lang,
        interimResults: true,
        continuous: true,
      });
      console.log('[QuickSpeech] recognizer started (listening)');
      setIsListening(true);
      return true;
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not start voice input.');
      console.warn('[QuickSpeech] start threw', (e as Error)?.message);
      setIsListening(false);
      clearSubs();
      return false;
    }
  }, [clearSubs, options?.lang]);

  return { isAvailable, isListening, transcript, error, start, stop, reset };
}
