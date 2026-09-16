/**
 * Aihousekeeper voice session endpoint — Option B bridge.
 *
 * Mints an OpenAI Realtime ephemeral token so the mobile client can establish
 * a WebRTC peer connection to `gpt-realtime`. The Realtime session is
 * configured with ONE tool (`ask_aihousekeeper`) and `tool_choice: "required"` — so
 * OpenAI is strictly the audio transport; every user turn is forced through
 * Claude via the existing /aihousekeeper/chat endpoint. This keeps one brain, one
 * memory, one tool registry.
 *
 *   POST /households/:householdId/aihousekeeper/voice-session
 *     body:    { voice?: string }
 *     returns: {
 *       client_secret: string,  // "ek_..." — short-lived (~60s to connect)
 *       expires_at: number,     // unix seconds
 *       model: string,
 *       voice: string,
 *       session_id: string | null,
 *       realtime_url: string    // SDP endpoint the client posts its offer to
 *     }
 *
 * Security:
 *   - authMiddleware required; household membership verified.
 *   - OPENAI_API_KEY never leaves the Worker.
 *   - Ephemeral token has ~1 minute validity for establishing the WebRTC
 *     connection; the session itself lives up to 30 minutes.
 *   - Rate-limited under the standard aihousekeeper:default bucket.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { rateLimitDO } from '../middleware/rate-limit';
import { resolveProviderApiKey } from '../services/ai-credential-resolver';
import { assertRealtimeVoiceEnabled } from '../services/bridge-control';
import { assertCanUseAI } from '../services/entitlement-service';
import { HouseholdService } from '../services/household-service';
import type { Env } from '../types';
import { ValidationError } from '../utils/errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENAI_CLIENT_SECRET_URL =
  'https://api.openai.com/v1/realtime/client_secrets';
/**
 * Base WebRTC SDP URL. The client appends `?model=…` and POSTs its offer
 * here. OpenAI's GA Realtime API uses `/v1/realtime/calls`; the old beta
 * path `/v1/realtime` rejects GA ephemeral tokens (`ek_…` minted from the
 * client_secrets endpoint) with a 400 "API version mismatch".
 */
const OPENAI_REALTIME_SDP_BASE = 'https://api.openai.com/v1/realtime/calls';
const DEFAULT_MODEL = 'gpt-realtime';
const DEFAULT_VOICE = 'marin';
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Allowed voice ids as of the gpt-realtime model. Constrained here so the
 * client can't pass arbitrary strings through; unknown voices would 400 at
 * the upstream anyway and cost us a roundtrip.
 */
const ALLOWED_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;

/**
 * Voice-mode persona instructions. The model is NEVER asked to reason or
 * answer on its own — the client drives each turn by:
 *
 *   1. letting the server transcribe the user's speech
 *     (turn_detection.create_response is false, so no auto-response)
 *   2. POSTing the transcript to /aihousekeeper/chat where Claude does all the work
 *   3. injecting Claude's reply as an assistant conversation item
 *   4. sending response.create to voice the injected reply
 *
 * So the model's only real job is: read the latest assistant message aloud.
 * This sidesteps the unreliable forced-tool-call path on GA WebRTC.
 */
const VOICE_INSTRUCTIONS = [
  "You are Aihousekeeper's voice — a warm, brief, natural-sounding household assistant.",
  '',
  'Your ONLY job is to read out loud the most recent assistant message in the conversation, exactly as written, with natural warmth and light prosody. Do not add greetings, do not paraphrase, do not invent information, do not ask follow-up questions. Just voice the assistant message verbatim.',
  '',
  'Style: conversational, warm, brief. No markdown, no "bullet one, bullet two", no emojis spoken aloud.',
].join('\n');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  voice: z.enum(ALLOWED_VOICES).optional(),
  /**
   * ISO-639-1 language hint for speech-to-text. Defaults to auto-detect
   * (no hint), which is fine for English-only users but causes scrambling
   * when the user mixes languages. Passing the explicit language the user
   * speaks drastically improves transcription quality.
   */
  language: z
    .string()
    .min(2)
    .max(10)
    .optional(),
});

// Shape of the OpenAI ephemeral response we care about. The full response
// includes the entire session echoed back; we keep only the fields the
// client needs to connect.
interface OpenAIEphemeralResponse {
  value: string;
  expires_at: number;
  session?: {
    id?: string;
    model?: string;
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const aihousekeeperVoice = new Hono<{ Bindings: Env }>();

aihousekeeperVoice.use('/*', authMiddleware());

aihousekeeperVoice.post(
  '/',
  rateLimitDO('aihousekeeper:default'),
  zValidator('json', bodySchema),
  async (c) => {
    // Legacy OpenAI ephemeral Realtime path — hard-deny until House D1
    // realtimeVoiceEnabled + AuthorizedRealtimeSessionDO (Data Bridge §6).
    await assertRealtimeVoiceEnabled(c.env);

    const householdId = c.req.param('householdId');
    if (!householdId) {
      throw new ValidationError({ householdId: ['missing householdId'] });
    }
    const userId = c.get('userId');

    // Household membership — throws NotFoundError/ForbiddenError if not.
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.getHousehold(householdId, userId);
    await assertCanUseAI(userId, c.env);

    // Realtime voice transport runs on the user's own OpenAI key when they've
    // connected one (BYOK), else the SimpleHouse-managed key. Non-OpenAI BYOK
    // users fall back to managed, so voice keeps working for everyone entitled.
    const { apiKey: openaiKey } = await resolveProviderApiKey(c.env, userId, 'openai');

    // A key is optional in the Env (may be unset in local dev).
    if (!openaiKey) {
      console.error('[aihousekeeper-voice] OPENAI_API_KEY not configured', {
        environment: c.env.ENVIRONMENT,
      });
      return c.json(
        {
          error: {
            code: 'voice_unavailable',
            message: 'Voice mode is not configured on this environment.',
          },
        },
        503
      );
    }

    const { voice, language } = c.req.valid('json');
    const model = c.env.AIHOUSEKEEPER_REALTIME_MODEL || DEFAULT_MODEL;
    const chosenVoice =
      voice ?? c.env.AIHOUSEKEEPER_REALTIME_VOICE ?? DEFAULT_VOICE;
    // Normalize language hint to the 2-letter ISO code OpenAI expects
    // (en, es, fr, de, ru, ja, zh, …). Locales like "en-US" get trimmed.
    const languageHint = language
      ? language.split(/[-_]/)[0].toLowerCase()
      : undefined;

    // Session config for the transcription-driven bridge pattern:
    //   - No tools, no tool_choice. OpenAI only transcribes user audio and
    //     voices assistant text messages that the client injects.
    //   - `create_response: false` so the server does NOT auto-trigger a
    //     response after user speech. The client drives response.create
    //     AFTER Claude has returned the reply (see
    //     useVoiceMode.runTranscriptionBridge on the client).
    const sessionConfig = {
      type: 'realtime',
      model,
      instructions: VOICE_INSTRUCTIONS,
      output_modalities: ['audio'],
      audio: {
        input: {
          transcription: {
            model: 'gpt-4o-transcribe',
            // When present, anchors STT to the user's chosen language so
            // short or mixed-language utterances aren't garbled.
            ...(languageHint ? { language: languageHint } : {}),
          },
          noise_reduction: { type: 'near_field' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.65,
            prefix_padding_ms: 300,
            silence_duration_ms: 900,
            // Client-driven: we wait for Claude's reply before triggering
            // the voice response. Setting this to true would cause OpenAI
            // to answer from its own empty context before our bridge runs.
            create_response: false,
            // VAD still interrupts an in-flight voicing if the user speaks
            // again — that's correct barge-in behavior.
            interrupt_response: true,
          },
        },
        output: {
          voice: chosenVoice,
        },
      },
    };

    // Mint ephemeral token with a hard timeout — we never want a hung
    // upstream to block the Worker.
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      UPSTREAM_TIMEOUT_MS
    );
    let upstream: Response;
    try {
      upstream = await fetch(OPENAI_CLIENT_SECRET_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session: sessionConfig }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const message = (err as Error).message ?? 'unknown';
      console.error('[aihousekeeper-voice] upstream mint failed', {
        householdId,
        userId,
        error: message,
      });
      return c.json(
        {
          error: {
            code: 'upstream_failed',
            message: 'Voice service temporarily unavailable',
          },
        },
        502
      );
    }
    clearTimeout(timeoutId);

    if (!upstream.ok) {
      const bodyText = await upstream.text().catch(() => '');
      console.error('[aihousekeeper-voice] upstream non-2xx', {
        householdId,
        userId,
        status: upstream.status,
        body: bodyText.slice(0, 500),
      });
      return c.json(
        {
          error: {
            code: 'upstream_failed',
            message: 'Voice service rejected session request',
          },
        },
        502
      );
    }

    const data = (await upstream.json()) as OpenAIEphemeralResponse;

    // Defense against unexpected upstream shape — fail loudly but don't
    // surface raw payload to the client.
    if (!data?.value || typeof data.value !== 'string') {
      console.error('[aihousekeeper-voice] upstream returned no client secret', {
        householdId,
        userId,
        keys: Object.keys(data ?? {}),
      });
      return c.json(
        {
          error: {
            code: 'upstream_malformed',
            message: 'Voice service returned an unexpected response',
          },
        },
        502
      );
    }

    console.log('[aihousekeeper-voice] ephemeral minted', {
      householdId,
      userId,
      sessionId: data.session?.id ?? null,
      expiresAt: data.expires_at,
      model,
      voice: chosenVoice,
    });

    return c.json({
      client_secret: data.value,
      expires_at: data.expires_at,
      model,
      voice: chosenVoice,
      session_id: data.session?.id ?? null,
      realtime_url: `${OPENAI_REALTIME_SDP_BASE}?model=${encodeURIComponent(
        model
      )}`,
    });
  }
);

export default aihousekeeperVoice;
