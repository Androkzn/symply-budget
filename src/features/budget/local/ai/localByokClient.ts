import type { AIProviderId } from '@api/aiAccess';
import { drainSse, xhrStream } from '@api/xhrStream';
import { aiKeyVault } from '@services/aiKeyVault';
import { getPreferredModel, getPreferredProvider } from '@services/aiModelPreference';
import { scrubProviderSecrets } from '@utils/aiProviderSecrets';
import { toGeminiResponseSchema } from '@utils/geminiSchema';

import { redactImportText } from './redactImportText';
import { getBorrowedAiKey } from './sharedAiKeys';

const ALLOWLIST: Record<AIProviderId, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
};

/**
 * Model per provider. These are the member's OWN spend, so pick the cheapest
 * model that reads a receipt reliably rather than the top tier.
 *
 * Keep these current: a retired model id is a 404 on every call, which reaches
 * the member as a generic "could not read that receipt" and looks like a vision
 * failure rather than a config one. `claude-sonnet-4-20250514` retired on
 * 2026-06-15 and did exactly that.
 */
const DEFAULT_MODEL: Record<AIProviderId, string> = {
  openai: 'gpt-5.6-luna',
  anthropic: 'claude-sonnet-5',
  gemini: 'gemini-3.5-flash',
};

/**
 * The model the member actually picked in Settings → AI Providers, falling back
 * to the default above when they never chose one.
 *
 * Reading the DEFAULT unconditionally meant the picker was decorative for every
 * local-first scan: the card could read "Gemini 3.1 Flash-Lite" while the call
 * went to gemini-2.0-flash.
 */
async function resolveModel(provider: AIProviderId): Promise<string> {
  return (await getPreferredModel(provider)) ?? DEFAULT_MODEL[provider];
}

/** Media types Anthropic's vision API accepts. `image/jpg` is a common invalid alias. */
const ANTHROPIC_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Per-image ceiling on the Anthropic vision API (applies to the base64 payload). */
const ANTHROPIC_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Provider error bodies are for engineers, not essays — keep log lines bounded. */
const MAX_ERROR_BODY_CHARS = 400;

/**
 * Grep-friendly device-side trace of the BYOK path, mirroring the backend's
 * `[BUDGET-E2E]` tags so a scan can be followed whichever side ran it.
 * Metadata only — never a prompt, a receipt, or a model response.
 *
 *   [BUDGET-BYOK][request]     one line per provider call
 *   [BUDGET-BYOK][http-error]  non-2xx, with the scrubbed provider body
 */
export function byokLog(stage: string, data: Record<string, unknown>): void {
  let payload: string;
  try {
    payload = JSON.stringify(data);
  } catch {
    payload = '"<unserializable>"';
  }
  console.log(`[BUDGET-BYOK][${stage}] ${payload}`);
}

/** Bytes a base64 string decodes to — for size guards and log lines. */
function base64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Turn a non-2xx provider response into an error that says WHY.
 *
 * Without the body, every failure mode — retired model, invalid key, oversized
 * image, malformed schema — arrives as the same bare `HTTP 400` and there is
 * nothing to act on. The body is truncated and scrubbed, so it is safe both in
 * a log and in the message the member's alert ends up quoting.
 */
async function providerHttpError(
  provider: AIProviderId,
  model: string,
  res: Response,
  apiKey: string,
): Promise<Error> {
  let body = '';
  try {
    body = (await res.text()).slice(0, MAX_ERROR_BODY_CHARS);
  } catch {
    body = '<unreadable body>';
  }
  const detail = scrubProviderSecrets(body, apiKey);
  byokLog('http-error', { provider, model, status: res.status, body: detail });
  return new Error(`${provider} HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
}

export interface ByokStructuredRequest {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  images?: Array<{ base64: string; mime: string }>;
  maxTokens?: number;
  /**
   * Opt into a STREAMED call and observe the tool JSON as the model writes it,
   * called with the accumulated (still incomplete) string. The result is
   * identical either way — this only changes how it arrives, so a long
   * extraction can report progress instead of freezing the UI on a spinner.
   *
   * Honoured by the Anthropic path only. The other providers ignore it and
   * answer buffered, so callers must treat progress as optional.
   */
  onPartialJson?: (accumulatedJson: string) => void;
}

/**
 * Which key to use. The member's chosen default wins; the fixed order is only
 * the fallback for when they never chose (or the chosen one has no key on this
 * device). Walking the fixed order unconditionally meant a member with two keys
 * who picked Gemini still had every offline scan billed to Anthropic.
 *
 * A key SHARED by another household member is the last resort, after every key
 * of the member's own. The ordering is a billing decision, not a preference
 * one: a borrowed key spends someone else's money, so it is used only when this
 * member has nothing of their own to spend. Borrowed keys are never stored on
 * this device — see `sharedAiKeys.ts` for why.
 */
export async function resolveLocalByokProvider(): Promise<{
  provider: AIProviderId;
  apiKey: string;
  /** `shared` means another member is being billed for this call. */
  source: 'own' | 'shared';
  /** Who is paying, when `source` is `shared`. */
  ownerUserId?: string;
} | null> {
  const preferred = await getPreferredProvider();
  if (preferred) {
    const apiKey = await aiKeyVault.getKey(preferred);
    if (apiKey?.trim()) return { provider: preferred, apiKey: apiKey.trim(), source: 'own' };
  }
  for (const provider of ['anthropic', 'openai', 'gemini'] as const) {
    const apiKey = await aiKeyVault.getKey(provider);
    if (apiKey?.trim()) return { provider, apiKey: apiKey.trim(), source: 'own' };
  }

  // Nothing of our own. Try a household share, preferred provider first so the
  // member's model pick still applies to a borrowed key.
  const order = preferred
    ? ([preferred, ...PROVIDER_FALLBACK_ORDER.filter((p) => p !== preferred)] as const)
    : PROVIDER_FALLBACK_ORDER;
  for (const provider of order) {
    const borrowedKey = await getBorrowedAiKey(provider);
    if (borrowedKey) {
      return {
        provider: borrowedKey.provider,
        apiKey: borrowedKey.apiKey,
        source: 'shared',
        ownerUserId: borrowedKey.ownerUserId,
      };
    }
  }
  return null;
}

const PROVIDER_FALLBACK_ORDER = ['anthropic', 'openai', 'gemini'] as const;

function assertAllowlisted(url: string, provider: AIProviderId): void {
  const base = ALLOWLIST[provider];
  if (!url.startsWith(base)) {
    throw new Error('BYOK endpoint is not allowlisted');
  }
}

async function openAiStructured<T>(
  apiKey: string,
  args: ByokStructuredRequest,
): Promise<T> {
  const url = ALLOWLIST.openai;
  assertAllowlisted(url, 'openai');
  const model = await resolveModel('openai');

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: redactImportText(args.userPrompt) }];
  for (const img of args.images ?? []) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.base64}` },
    });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'structured_output',
            description: 'Return structured import draft',
            parameters: args.schema,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'structured_output' } },
      max_completion_tokens: args.maxTokens ?? 4096,
    }),
  });
  if (!res.ok) throw await providerHttpError('openai', model, res, apiKey);
  const json = (await res.json()) as {
    choices?: Array<{
      message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
    }>;
  };
  const raw = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!raw) throw new Error('OpenAI returned no structured output');
  return JSON.parse(raw) as T;
}

/**
 * One streamed Anthropic call, assembled back into the same
 * `{ content, stop_reason }` shape the buffered call returns — so the retry and
 * extraction logic around it cannot tell the two apart.
 *
 * A tool call streams as `input_json_delta` fragments that are only valid JSON
 * once complete, so we accumulate and parse at the end. A truncated accumulator
 * (the model hit `max_tokens` mid-object) is NOT an error here: it returns
 * `stop_reason: 'max_tokens'` with no tool block, which is exactly what the
 * caller already retries on with a bigger budget.
 */
async function anthropicStreamedCall(params: {
  url: string;
  headers: Record<string, string>;
  body: string;
  apiKey: string;
  model: string;
  onPartialJson: (accumulatedJson: string) => void;
}): Promise<{ content?: Array<{ type: string; input?: unknown }>; stop_reason?: string }> {
  const { url, headers, body, apiKey, model, onPartialJson } = params;
  let toolJson = '';
  let stopReason: string | undefined;
  let cursor = 0;

  const consume = (text: string): void => {
    cursor = drainSse(text, cursor, (data) => {
      let event: {
        type?: string;
        delta?: { type?: string; partial_json?: string; stop_reason?: string };
      };
      try {
        event = JSON.parse(data) as typeof event;
      } catch {
        return;
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        toolJson += event.delta.partial_json ?? '';
        onPartialJson(toolJson);
      } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
    });
  };

  const res = await xhrStream({
    url,
    headers: { ...headers, Accept: 'text/event-stream' },
    body,
    onText: consume,
    networkErrorMessage: 'Could not reach the AI provider. Check your connection.',
    timeoutMessage: 'The AI provider timed out. Please try again.',
  });

  if (res.status < 200 || res.status >= 300) {
    // Mirror the buffered path's error, which reads the body for the REASON —
    // a retired model and a bad key are otherwise the same bare status.
    const detail = scrubProviderSecrets(res.text.slice(0, MAX_ERROR_BODY_CHARS), apiKey);
    byokLog('http-error', { provider: 'anthropic', model, status: res.status, body: detail });
    throw new Error(`anthropic HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  // Whatever the progress events missed (coalesced chunks) is still in the body.
  consume(res.text);

  if (!toolJson.trim()) return { content: [], stop_reason: stopReason };
  try {
    return {
      content: [{ type: 'tool_use', input: JSON.parse(toolJson) as unknown }],
      stop_reason: stopReason,
    };
  } catch {
    byokLog('stream-unparseable', {
      provider: 'anthropic',
      model,
      chars: toolJson.length,
      stopReason: stopReason ?? null,
    });
    return { content: [], stop_reason: stopReason ?? 'max_tokens' };
  }
}

async function anthropicStructured<T>(
  apiKey: string,
  args: ByokStructuredRequest,
): Promise<T> {
  const url = ALLOWLIST.anthropic;
  assertAllowlisted(url, 'anthropic');
  const model = await resolveModel('anthropic');

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  > = [];
  for (const img of args.images ?? []) {
    // `image/jpg` comes back from some pickers and is NOT a media type the API
    // accepts — passing it through is a 400 that reads like a bad photo.
    const mediaType = img.mime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : img.mime.toLowerCase();
    if (!ANTHROPIC_IMAGE_MIMES.has(mediaType)) {
      throw new Error(`Unsupported image type ${img.mime} — use JPEG, PNG, WebP, or GIF`);
    }
    const bytes = base64Bytes(img.base64);
    if (bytes > ANTHROPIC_MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is ${(bytes / 1024 / 1024).toFixed(1)}MB; the 5MB limit means it must be retaken or downscaled`,
      );
    }
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: img.base64 },
    });
  }
  content.push({ type: 'text', text: redactImportText(args.userPrompt) });

  byokLog('request', {
    provider: 'anthropic',
    model,
    imageCount: args.images?.length ?? 0,
    imageBytes: (args.images ?? []).map((i) => base64Bytes(i.base64)),
    promptChars: args.userPrompt.length,
  });

  const requestBody = (maxTokens: number, stream: boolean): string =>
    JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: args.systemPrompt,
      messages: [{ role: 'user', content }],
      tools: [
        {
          name: 'structured_output',
          description: 'Return structured import draft',
          input_schema: args.schema,
        },
      ],
      tool_choice: { type: 'tool', name: 'structured_output' },
      ...(stream ? { stream: true } : {}),
    });

  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };

  const call = async (maxTokens: number) => {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: requestBody(maxTokens, false),
    });
    if (!res.ok) throw await providerHttpError('anthropic', model, res, apiKey);
    return (await res.json()) as {
      content?: Array<{ type: string; input?: unknown }>;
      stop_reason?: string;
    };
  };

  // Streamed only when the caller wants progress; otherwise the original
  // single-shot request is left exactly as it was.
  const callStreaming = async (maxTokens: number) =>
    anthropicStreamedCall({
      url,
      headers,
      body: requestBody(maxTokens, true),
      apiKey,
      model,
      onPartialJson: args.onPartialJson!,
    });

  const run = args.onPartialJson ? callStreaming : call;

  const maxTokens = args.maxTokens ?? 8192;
  let json = await run(maxTokens);
  if (json.stop_reason === 'max_tokens') {
    byokLog('retry', { provider: 'anthropic', reason: 'max_tokens', maxTokens: 16384 });
    json = await run(16384);
  }
  const block = json.content?.find((b) => b.type === 'tool_use');
  if (!block?.input) {
    byokLog('no-structured-output', {
      provider: 'anthropic',
      stopReason: json.stop_reason ?? null,
      blockTypes: (json.content ?? []).map((b) => b.type),
    });
    throw new Error('Anthropic returned no structured output');
  }
  return block.input as T;
}

async function geminiStructured<T>(
  apiKey: string,
  args: ByokStructuredRequest,
): Promise<T> {
  const model = await resolveModel('gemini');
  const url = `${ALLOWLIST.gemini}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  assertAllowlisted(url, 'gemini');

  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
  for (const img of args.images ?? []) {
    const mime = img.mime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : img.mime;
    parts.push({ inline_data: { mime_type: mime, data: img.base64 } });
  }
  parts.push({ text: `${args.systemPrompt}\n\n${redactImportText(args.userPrompt)}` });
  byokLog('request', {
    provider: 'gemini',
    model,
    imageCount: args.images?.length ?? 0,
    imageBytes: (args.images ?? []).map((img) => Math.round((img.base64.length * 3) / 4)),
    promptChars: (args.systemPrompt.length + args.userPrompt.length),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        // Gemini's responseSchema is an OpenAPI subset, NOT JSON Schema — the
        // strict schema shared with OpenAI/Anthropic is a hard 400 here.
        responseSchema: toGeminiResponseSchema(args.schema),
      },
    }),
  });
  if (!res.ok) throw await providerHttpError('gemini', model, res, apiKey);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no structured output');
  const parsed = JSON.parse(text) as T;
  const draft = parsed as { vendor?: unknown; items?: unknown[] };
  byokLog('gemini-parsed', {
    vendor: typeof draft.vendor === 'string' ? draft.vendor : null,
    rawItems: Array.isArray(draft.items) ? draft.items.length : 0,
  });
  return parsed;
}

export async function generateStructuredByok<T>(
  args: ByokStructuredRequest,
  preferred?: AIProviderId | null,
): Promise<T> {
  const resolved = await resolveLocalByokProvider();
  if (!resolved) throw new Error('No BYOK provider key on device');

  // Spend the key the resolver already chose rather than re-reading the vault
  // for it. A BORROWED key is never in the vault — it lives in memory only, by
  // design — so re-reading turned every shared-key call into
  // `Cannot read property 'trim' of null` before it reached the provider: the
  // member accepted a lent key, saw it listed as ready, and every scan failed.
  //
  // A caller's `preferred` still wins, but only when this device really holds
  // that key; otherwise it is not a provider we can call at all.
  const preferredKey = preferred ? (await aiKeyVault.getKey(preferred))?.trim() : null;
  const provider = preferredKey ? (preferred as AIProviderId) : resolved.provider;
  const apiKey = preferredKey ?? resolved.apiKey;

  switch (provider) {
    case 'openai':
      return openAiStructured<T>(apiKey, args);
    case 'anthropic':
      return anthropicStructured<T>(apiKey, args);
    case 'gemini':
      return geminiStructured<T>(apiKey, args);
    default:
      throw new Error('Unsupported BYOK provider');
  }
}

export { ALLOWLIST as BYOK_ALLOWLIST };
