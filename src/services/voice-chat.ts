/**
 * VoiceChatService — manages one OpenAI Realtime WebRTC session.
 *
 * Option B bridge: OpenAI is the audio transport only. The Realtime session
 * is configured server-side to force an `ask_aihousekeeper` tool call on every user
 * turn; this service surfaces those tool calls as events so the host
 * application can route them through Claude (`aihousekeeperApi.chat`) and return
 * the reply via {@link sendToolResult}.
 *
 * Lifecycle:
 *   1. caller mints a session via aihousekeeperApi.createVoiceSession()
 *   2. caller calls service.start(session)
 *      - getUserMedia → mic track
 *      - RTCPeerConnection with data channel "oai-events"
 *      - POST local SDP to session.realtime_url with the ephemeral token
 *      - setRemoteDescription(answer)
 *   3. events flow via service.on(...)
 *      - 'userTranscript'       — finalized user utterance
 *      - 'assistantTranscript…' — streaming TTS transcript
 *      - 'toolCall'             — OpenAI wants to call ask_aihousekeeper
 *   4. caller responds with service.sendToolResult(callId, text)
 *   5. service.stop() tears down the peer connection and releases the mic
 */

import InCallManager from 'react-native-incall-manager';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';

import type { AihousekeeperVoiceSession } from '@api/aihousekeeper';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type VoiceChatState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface VoiceToolCall {
  callId: string;
  name: string;
  /** Raw JSON arguments string as delivered by OpenAI. */
  argumentsJson: string;
}

export interface VoiceChatEvents {
  stateChange: (state: VoiceChatState) => void;
  /** User said something; transcript finalized. */
  userTranscript: (text: string) => void;
  /** Partial assistant transcript streaming in (TTS is speaking). */
  assistantTranscriptDelta: (fullSoFar: string) => void;
  /** Assistant finished this turn. */
  assistantTranscriptDone: (fullText: string) => void;
  /** Realtime wants to call a function — bridge to Claude. */
  toolCall: (call: VoiceToolCall) => void;
  /** Unrecoverable error; caller should stop the session. */
  error: (err: Error) => void;
}

type Listener<K extends keyof VoiceChatEvents> = VoiceChatEvents[K];

// ---------------------------------------------------------------------------
// Internal types — narrow subset of OpenAI Realtime server events we read.
// ---------------------------------------------------------------------------

interface OaiServerEventBase {
  type: string;
  event_id?: string;
}

interface OaiUserTranscriptDone extends OaiServerEventBase {
  type: 'conversation.item.input_audio_transcription.completed';
  transcript: string;
}

interface OaiAssistantTranscriptDelta extends OaiServerEventBase {
  // Beta used `response.audio_transcript.delta`; GA renamed to
  // `response.output_audio_transcript.delta`. We accept either.
  type:
    | 'response.audio_transcript.delta'
    | 'response.output_audio_transcript.delta';
  delta: string;
}

interface OaiAssistantTranscriptDone extends OaiServerEventBase {
  type:
    | 'response.audio_transcript.done'
    | 'response.output_audio_transcript.done';
  transcript: string;
}

interface OaiFunctionCallArgumentsDone extends OaiServerEventBase {
  type: 'response.function_call_arguments.done';
  call_id: string;
  name: string;
  arguments: string;
}

interface OaiResponseCreated extends OaiServerEventBase {
  type: 'response.created';
  response?: { id?: string };
}

/**
 * GA `response.done` carries the full final response. Its `output` array
 * lists items including any `function_call` entries — we use this as the
 * authoritative source for tool dispatch, since the `…arguments.done`
 * event isn't always emitted on the GA path.
 */
interface OaiResponseDone extends OaiServerEventBase {
  type: 'response.done';
  response?: {
    id?: string;
    output?: Array<
      | {
          type: 'function_call';
          call_id?: string;
          name?: string;
          arguments?: string;
        }
      | { type: string; [k: string]: unknown }
    >;
    status?: string;
    status_details?: { error?: { message?: string }; reason?: string };
  };
}

interface OaiSpeechStarted extends OaiServerEventBase {
  type: 'input_audio_buffer.speech_started';
}

interface OaiSpeechStopped extends OaiServerEventBase {
  type: 'input_audio_buffer.speech_stopped';
}

interface OaiErrorEvent extends OaiServerEventBase {
  type: 'error';
  error?: { message?: string; code?: string };
}

type OaiServerEvent =
  | OaiUserTranscriptDone
  | OaiAssistantTranscriptDelta
  | OaiAssistantTranscriptDone
  | OaiFunctionCallArgumentsDone
  | OaiResponseCreated
  | OaiResponseDone
  | OaiSpeechStarted
  | OaiSpeechStopped
  | OaiErrorEvent
  | OaiServerEventBase;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class VoiceChatService {
  private pc: RTCPeerConnection | null = null;
  private dc: ReturnType<RTCPeerConnection['createDataChannel']> | null = null;
  private micStream: MediaStream | null = null;
  private state: VoiceChatState = 'idle';
  private assistantBuffer = '';
  /** Tool call_ids we've already dispatched — dedup between the
   *  `…arguments.done` and `response.done` backup paths so we never
   *  fire ask_aihousekeeper twice for the same turn. */
  private dispatchedCallIds = new Set<string>();
  /** Event-type names we've logged once per session (debug-only). */
  private seenUnhandledTypes = new Set<string>();
  /**
   * Tracks the OpenAI Realtime response currently being generated.
   *
   * The Realtime API rejects `response.create` while a response is in
   * progress with: "Conversation already has an active response in
   * progress: resp_xxx. Wait until the response is finished before
   * creating a new one."
   *
   * We hit this whenever Aihousekeeper's bridge wants to inject a Claude reply
   * (`voiceAssistantText`) while OpenAI is still mid-auto-response from
   * the user's voice. Tracked here so `voiceAssistantText` can issue a
   * `response.cancel` first — WebRTC data channels preserve message
   * order, so the cancel processes server-side before our new create.
   */
  private activeResponseId: string | null = null;
  // Listener registry. Kept loosely typed because TS can't narrow a
  // per-key bucket through a mapped-type field; the public on()/emit()
  // signatures preserve full type safety at the API surface.
  private listeners = new Map<keyof VoiceChatEvents, Array<(...args: unknown[]) => void>>();

  getState(): VoiceChatState {
    return this.state;
  }

  on<K extends keyof VoiceChatEvents>(
    event: K,
    fn: Listener<K>
  ): () => void {
    const wrapped = fn as unknown as (...args: unknown[]) => void;
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(wrapped);
    this.listeners.set(event, bucket);
    return () => {
      const next = (this.listeners.get(event) ?? []).filter(
        (l) => l !== wrapped
      );
      if (next.length === 0) this.listeners.delete(event);
      else this.listeners.set(event, next);
    };
  }

  private emit<K extends keyof VoiceChatEvents>(
    event: K,
    ...args: Parameters<Listener<K>>
  ): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const fn of bucket) {
      try {
        fn(...(args as unknown[]));
      } catch (err) {
        // Swallow listener errors — they shouldn't take down the session.
        console.warn('[VoiceChatService] listener threw', err);
      }
    }
  }

  private setState(next: VoiceChatState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('stateChange', next);
  }

  // -------------------------------------------------------------------------
  // Start / Stop
  // -------------------------------------------------------------------------

  async start(session: AihousekeeperVoiceSession): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'error') {
      throw new Error(`VoiceChatService.start(): busy in state ${this.state}`);
    }
    this.setState('connecting');
    this.assistantBuffer = '';
    this.dispatchedCallIds.clear();
    this.seenUnhandledTypes.clear();

    try {
      // Set up the audio session for a two-way voice call BEFORE grabbing the
      // mic. react-native-webrtc's default iOS route is the earpiece (as if
      // you were holding the phone like a call); InCallManager switches to
      // the speaker so the assistant's voice is audible at arm's length.
      try {
        InCallManager.start({ media: 'audio', auto: false });
        InCallManager.setForceSpeakerphoneOn(true);
        InCallManager.setSpeakerphoneOn(true);
        InCallManager.setKeepScreenOn(true);
      } catch (err) {
        // Non-fatal: audio may still play via the earpiece.
        console.warn('[VoiceChatService] InCallManager setup failed', err);
      }

      // 1. Peer connection.
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      this.pc = pc;

      // 2. Remote audio auto-plays via the library's default audio routing.
      //    Nothing to wire up — keep a handler for diagnostics.
      (pc as unknown as { ontrack: (e: unknown) => void }).ontrack = () => {
        // noop: react-native-webrtc pipes remote audio to the output device.
      };

      // 3. Data channel — must be created BEFORE the offer so the remote
      //    description includes the channel in the answer.
      const dc = pc.createDataChannel('oai-events');
      this.dc = dc;
      (dc as unknown as { onmessage: (e: { data: string }) => void }).onmessage = (
        e
      ) => this.handleServerEvent(e.data);
      (dc as unknown as { onopen: () => void }).onopen = () => {
        // Once the data channel is open the session is ready for turns.
        this.setState('listening');
      };
      (dc as unknown as { onclose: () => void }).onclose = () => {
        // If the channel drops while we're live, surface an error so the UI
        // can tear down. Ignored if we closed it on purpose via stop().
        if (this.state !== 'idle') {
          this.emit('error', new Error('data channel closed unexpectedly'));
          this.setState('error');
        }
      };

      // 4. Microphone. Must be added as a track so the remote picks it up.
      const stream = (await mediaDevices.getUserMedia({
        audio: true,
      })) as unknown as MediaStream;
      this.micStream = stream;
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // 5. SDP offer → POST to OpenAI with the ephemeral token.
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(session.realtime_url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.client_secret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp ?? '',
      });

      if (!sdpResponse.ok) {
        const text = await sdpResponse.text().catch(() => '');
        throw new Error(
          `SDP exchange failed: ${sdpResponse.status} ${text.slice(0, 200)}`
        );
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: answerSdp })
      );
      // Data channel `onopen` flips state to 'listening'.
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[VoiceChatService] start failed', error);
      this.emit('error', error);
      this.setState('error');
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      this.dc?.close();
    } catch {
      // ignore
    }
    this.dc = null;

    try {
      this.micStream?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    this.micStream = null;

    try {
      this.pc?.close();
    } catch {
      // ignore
    }
    this.pc = null;

    // Restore the audio session. Safe to call even if start() never succeeded.
    try {
      InCallManager.setKeepScreenOn(false);
      InCallManager.setForceSpeakerphoneOn(false);
      InCallManager.stop();
    } catch {
      // ignore
    }

    this.setState('idle');
  }

  // -------------------------------------------------------------------------
  // Bridge API — caller pushes the ask_aihousekeeper reply back to Realtime
  // -------------------------------------------------------------------------

  /**
   * Inject an assistant text message into the Realtime conversation and
   * trigger a response to voice it. This is the bridge contract for the
   * transcription-driven flow: the client calls this with Claude's reply.
   *
   * We pass the reply as a user message with explicit instructions so the
   * model has a clear "say exactly this" directive; putting it on the
   * `assistant` role works too but some builds of gpt-realtime try to
   * paraphrase. The "user" + override-instructions combination consistently
   * produces a verbatim read-out with natural prosody.
   */
  voiceAssistantText(text: string): void {
    if (!this.dc) {
      console.warn('[VoiceChatService] voiceAssistantText: no data channel');
      return;
    }
    if (!text || !text.trim()) return;
    // If the Realtime API is still finishing its own auto-response from the
    // user's voice, our `response.create` below will be rejected with
    // "Conversation already has an active response in progress: …". Send a
    // `response.cancel` first so the server tears that down. Data-channel
    // ordering guarantees the cancel processes before our new create.
    if (this.activeResponseId) {
      this.sendEvent({ type: 'response.cancel' });
      this.activeResponseId = null;
    }
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        // GA requires `output_text` for assistant message content — the
        // beta value `text` is rejected with "Invalid value: 'text'. Value
        // must be 'output_text'.". (User messages use `input_text` / input_audio.)
        content: [{ type: 'output_text', text }],
      },
    });
    // Don't override modalities/output_modalities here — the session was
    // minted with `output_modalities: ["audio"]` on the backend and the
    // response inherits that. Sending either field name on response.create
    // is unreliable: the GA path rejects `modalities` (beta name) with
    // "Unknown parameter: 'response.modalities'"; some builds also reject
    // `output_modalities` depending on server version. Inheriting is safe.
    this.sendEvent({
      type: 'response.create',
      response: {
        instructions: `Read the most recent assistant message aloud, exactly as written, with warm natural prosody. Do not paraphrase, do not add a greeting, do not ask follow-up questions.`,
      },
    });
    this.setState('speaking');
  }

  /**
   * Cancel the model's current response (barge-in). Safe to call from the
   * UI when the user wants to interrupt without leaving voice mode.
   */
  interrupt(): void {
    if (!this.dc) return;
    this.sendEvent({ type: 'response.cancel' });
    this.activeResponseId = null;
    this.setState('listening');
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private sendEvent(event: Record<string, unknown>): void {
    if (!this.dc) return;
    try {
      this.dc.send(JSON.stringify(event));
    } catch (err) {
      console.warn('[VoiceChatService] send failed', err);
    }
  }

  private handleServerEvent(raw: string): void {
    let evt: OaiServerEvent;
    try {
      evt = JSON.parse(raw) as OaiServerEvent;
    } catch (err) {
      console.warn('[VoiceChatService] bad server event JSON', err);
      return;
    }

    // Log every event type at info level so we can diagnose forced-tool /
    // dispatch failures without having to redeploy the service. Single line
    // per event keeps the console readable.
    console.log('[VoiceChatService] evt', evt.type);

    switch (evt.type) {
      case 'response.created': {
        // Track the active response id so `voiceAssistantText` can cancel
        // it before injecting a Claude reply (otherwise the Realtime API
        // rejects the new `response.create` with "Conversation already
        // has an active response in progress: …").
        const id = (evt as OaiResponseCreated).response?.id ?? null;
        this.activeResponseId = id;
        return;
      }

      case 'input_audio_buffer.speech_started':
        // User started speaking — if the model is mid-response, server VAD
        // handles interruption automatically.
        this.setState('listening');
        return;

      case 'input_audio_buffer.speech_stopped':
        // User finished their utterance; transcription + tool call next.
        this.setState('thinking');
        return;

      case 'conversation.item.input_audio_transcription.delta':
        // GA streams the user transcription incrementally before the
        // `.completed` event. We don't surface interim user transcript
        // right now (the user bubble appears once, from `.completed`).
        // Handled here only to keep it out of the unhandled-event log.
        return;

      case 'conversation.item.input_audio_transcription.completed': {
        const text = (evt as OaiUserTranscriptDone).transcript ?? '';
        if (text.trim().length > 0) {
          this.emit('userTranscript', text);
        }
        return;
      }

      case 'response.function_call_arguments.done': {
        const call = evt as OaiFunctionCallArgumentsDone;
        this.setState('thinking');
        if (
          call.call_id &&
          call.name &&
          !this.dispatchedCallIds.has(call.call_id)
        ) {
          this.dispatchedCallIds.add(call.call_id);
          this.emit('toolCall', {
            callId: call.call_id,
            name: call.name,
            argumentsJson: call.arguments ?? '{}',
          });
        }
        return;
      }

      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta': {
        const delta = (evt as OaiAssistantTranscriptDelta).delta ?? '';
        if (delta) {
          this.assistantBuffer += delta;
          this.emit('assistantTranscriptDelta', this.assistantBuffer);
          if (this.state !== 'speaking') this.setState('speaking');
        }
        return;
      }

      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done': {
        const full =
          (evt as OaiAssistantTranscriptDone).transcript ??
          this.assistantBuffer;
        this.emit('assistantTranscriptDone', full);
        this.assistantBuffer = '';
        return;
      }

      case 'response.done': {
        // Authoritative end-of-response event. On the GA path, function
        // calls are most reliably retrieved from `response.output[]` here —
        // the standalone `response.function_call_arguments.done` event does
        // not always fire. Dispatch any tool calls we haven't already seen.
        const done = evt as OaiResponseDone;
        const output = done.response?.output ?? [];
        console.log(
          '[VoiceChatService] response.done',
          JSON.stringify({
            status: done.response?.status,
            outputTypes: output.map((o) => (o as { type?: string }).type),
            statusDetails: done.response?.status_details,
          })
        );
        for (const item of output) {
          if (
            item &&
            (item as { type?: string }).type === 'function_call'
          ) {
            const fc = item as {
              call_id?: string;
              name?: string;
              arguments?: string;
            };
            if (
              fc.call_id &&
              fc.name &&
              !this.dispatchedCallIds.has(fc.call_id)
            ) {
              this.dispatchedCallIds.add(fc.call_id);
              this.emit('toolCall', {
                callId: fc.call_id,
                name: fc.name,
                argumentsJson: fc.arguments ?? '{}',
              });
            }
          }
        }
        // `cancelled` is a normal lifecycle event on GA — it fires any time
        // server VAD interrupts a response (user starts speaking again),
        // any time a response is superseded, or when we explicitly send
        // `response.cancel`. Do NOT emit an error for it — we'd be
        // surfacing expected interruption as a user-facing failure.
        // Only `failed` is an actual problem.
        const status = done.response?.status;
        if (status === 'failed') {
          const errMsg =
            done.response?.status_details?.error?.message ??
            'response failed';
          this.emit('error', new Error(errMsg));
        }
        // Clear the active-response tracker so the next `voiceAssistantText`
        // / user turn can create a new response without an unnecessary cancel.
        this.activeResponseId = null;
        this.setState('listening');
        return;
      }

      case 'error': {
        const errEvt = evt as OaiErrorEvent;
        const msg = errEvt.error?.message ?? 'realtime error';
        this.emit('error', new Error(msg));
        return;
      }

      default:
        // Log unhandled event types once per session per type so we notice
        // schema drift without flooding the console.
        if (!this.seenUnhandledTypes.has(evt.type)) {
          this.seenUnhandledTypes.add(evt.type);
          console.log('[VoiceChatService] unhandled event', evt.type);
        }
        return;
    }
  }
}
