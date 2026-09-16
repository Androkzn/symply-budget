/**
 * Stage B transport — the member's own provider key (plan §9, Q6/Q7, DoD H7).
 *
 * Ported from `src/features/budget/local/ai/localByokClient.ts`, which is the
 * shipped proof that a three-provider BYOK call works from the device. What is
 * kept, and what is deliberately different, is the whole point of this header.
 *
 * **Kept from Budget**
 *  - The hard URL allowlist: three providers, three exact base URLs, asserted
 *    immediately before every `fetch`. There is no code path that reaches a
 *    fourth host.
 *  - The key comes from `@services/aiKeyVault` (device Keychain), never from our
 *    backend and never from a prop.
 *  - Structured output via each provider's tool/JSON-schema mechanism, so the
 *    caller parses a typed object instead of scraping prose.
 *
 * **Changed for House, each for a stated reason**
 *
 *  1. **The request carries a `HouseAiContext`, not free text.** Budget sends a
 *     receipt the member just photographed — they chose the payload and can see
 *     it. House assembles from the encrypted ledger, which the member never
 *     reviews, so the only thing this client will serialise is the *already
 *     projected* context from `buildHouseAiContext`. There is no `text` or
 *     `ledger` parameter to smuggle rows through, and
 *     `assertHouseAiContextIsProjected` re-checks the object at the door: a
 *     hand-rolled context carrying a forbidden table or an unlisted field is
 *     refused rather than sent. The allowlist is therefore enforced twice — once
 *     where the context is built and once where it would leave.
 *
 *  2. **No `images` parameter.** Budget's client takes base64 images for receipt
 *     vision. House's locked assignment puts photo-bearing features (floor-plan
 *     regions, garden plans, schematics, garbage photo detect) at **P4 disabled**
 *     until a BYOK vision path is designed. An `images` field here would be an
 *     egress channel the allowlist does not cover — a member's photo of their
 *     hallway is not a field on any table — so the parameter simply does not
 *     exist. Adding it is a design decision, not an ergonomics tweak.
 *
 *  3. **The Gemini key travels in a header, not the query string.** Budget builds
 *     `…:generateContent?key=<apiKey>`. That works, but it puts the secret in a
 *     URL — and URLs end up in thrown error messages, in redirect `Referer`
 *     headers, and in any log that records a request line. `x-goog-api-key` is
 *     the documented header form and makes "no key in an error" a structural
 *     property rather than something we have to remember to scrub.
 *
 *  4. **No function here returns a key.** Budget's `resolveLocalByokProvider`
 *     hands the caller `{ provider, apiKey }`; every consumer then holds a secret
 *     it has no use for. Here `readKey` and `resolveHouseByokCredential` are
 *     module-private and the exported surface answers only *which* provider (or
 *     *whether* there is one). The DoD's "no API key in a thrown error, log line
 *     or returned value" is then a property of the module's shape, not of its
 *     discipline.
 *
 * **Shared with Budget again**
 *
 * A key a household member LENT this one is usable here on the same terms as in
 * Budget: last resort, after every key of the member's own, because it spends
 * their money. It is never written to the Keychain — `getBorrowedAiKey` unseals
 * it on use and holds it in memory only, which is what makes "stop sharing"
 * mean something. The member accepts the third-party disclosure once, on the
 * shared AI Providers screen; this module only consumes the result.
 *
 *  5. **Errors are scrubbed and re-clothed.** Anything a provider throws is
 *     replaced by the ladder's member-facing `provider_failed` copy, with the
 *     scrubbed original kept on `.detail` for logs. A raw provider error must
 *     never reach a member (DoD H7, "Stage C copy shown, never a raw error").
 */
import type { AIProviderId } from '@api/aiAccess';
import { aiKeyVault } from '@services/aiKeyVault';
import { getPreferredModel, getPreferredProvider } from '@services/aiModelPreference';
import { scrubProviderSecrets } from '@utils/aiProviderSecrets';
import { toGeminiResponseSchema } from '@utils/geminiSchema';

import type { HouseLedgerTableName } from '../schema';

import {
  HOUSE_AI_EGRESS_ALLOWLIST,
  isTableAllowedForEgress,
  redactForEgress,
} from './egressAllowlist';
import { getHouseAiUnavailableCopy, type HouseAiContext } from './houseAiLadder';
import { getBorrowedAiKey } from './sharedAiKeys';

/**
 * The only three hosts this app will send household context to.
 *
 * Each entry is a full base **including its path**, which is what makes
 * `startsWith` a sound check: the host cannot be swapped for
 * `api.openai.com.example.net` and still match.
 */
export const HOUSE_BYOK_ALLOWLIST: Record<AIProviderId, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
};

const DEFAULT_MODEL: Record<AIProviderId, string> = {
  openai: 'gpt-5.6-luna',
  anthropic: 'claude-sonnet-5',
  gemini: 'gemini-3.5-flash',
};

/**
 * The model the member picked in Settings → AI Providers, or the default above.
 * Same rule as Budget's client — the picker must mean something on the offline
 * path too, not just in the card that renders it.
 */
async function resolveModel(provider: AIProviderId): Promise<string> {
  return (await getPreferredModel(provider)) ?? DEFAULT_MODEL[provider];
}

/**
 * Which key to prefer when the member has supplied several. Same order as
 * Budget so a household using both apps does not see two different providers
 * answer the same kind of question.
 */
export const HOUSE_BYOK_PROVIDER_ORDER: readonly AIProviderId[] = [
  'anthropic',
  'openai',
  'gemini',
];

/** Ceiling on a Stage-B answer. House asks for lists, not essays. */
const DEFAULT_MAX_TOKENS = 2048;

/** One source of truth for the copy a failed provider call shows. */
const PROVIDER_FAILED = getHouseAiUnavailableCopy('provider_failed').message;

/**
 * Scrubbing for any text this module is about to attach to an error. Shared
 * with Budget's BYOK client so the two can't drift — see `@utils/aiProviderSecrets`.
 */
const scrubSecrets = scrubProviderSecrets;

/**
 * A Stage-B failure.
 *
 * `message` is member-facing and is scrubbed in the constructor, so there is no
 * way to construct one that carries a secret even by accident. `detail` is the
 * engineer's copy — scrubbed too, and never rendered.
 */
export class HouseByokError extends Error {
  readonly code = 'house_byok_failed';
  /** Engineer-facing context for logs. Never shown to a member. */
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(scrubSecrets(message));
    this.name = 'HouseByokError';
    if (detail) this.detail = scrubSecrets(detail);
  }
}

/**
 * Refuse any URL that is not one of the three allowlisted bases.
 *
 * The thrown message names no host and echoes no URL — a URL is exactly the
 * kind of string that carries a query-string secret, and this error can surface
 * through the ladder into a log.
 */
export function assertHouseByokUrl(url: string, provider: AIProviderId): void {
  const base = HOUSE_BYOK_ALLOWLIST[provider];
  if (!base || !url.startsWith(base)) {
    throw new HouseByokError(
      'The assistant tried to reach a service that is not on the approved list, so nothing was sent.',
      `blocked non-allowlisted endpoint for provider ${provider}`,
    );
  }
}

/**
 * Re-verify at the door that this context came through the egress allowlist.
 *
 * `buildHouseAiContext` is the sanctioned builder, but `HouseAiContext` is a
 * plain object type: nothing in TypeScript stops a future call site from
 * assembling `{ tables: { households: ledger.households }, … }` by hand and
 * getting a compile-time pass. That call site is the bypass the DoD's
 * fail-closed requirement is about, and it would be invisible in review.
 *
 * So the last thing before the wire re-derives the check from the same
 * allowlist: a forbidden table, or any field not named for its table, and the
 * request does not happen.
 */
export function assertHouseAiContextIsProjected(context: HouseAiContext): void {
  if (!context || typeof context !== 'object' || !context.tables) {
    throw new HouseByokError(
      getHouseAiUnavailableCopy('not_supported').message,
      'stage B called without a projected context',
    );
  }

  for (const [name, rows] of Object.entries(context.tables)) {
    const table = name as HouseLedgerTableName;
    if (!isTableAllowedForEgress(table)) {
      throw new HouseByokError(
        getHouseAiUnavailableCopy('not_supported').message,
        `context carried non-allowlisted table ${name}`,
      );
    }
    const allowed = new Set(HOUSE_AI_EGRESS_ALLOWLIST[table] ?? []);
    for (const row of rows ?? []) {
      for (const field of Object.keys(row)) {
        if (!allowed.has(field)) {
          throw new HouseByokError(
            getHouseAiUnavailableCopy('not_supported').message,
            `context carried non-allowlisted field ${name}.${field}`,
          );
        }
      }
    }
  }
}

export type HouseByokRequest = {
  /** Developer-authored instruction. Never member data. */
  systemPrompt: string;
  /** The question. Redacted before sending, like every other string. */
  userPrompt: string;
  /** JSON schema the provider must fill — House parses objects, not prose. */
  schema: Record<string, unknown>;
  /** The ONLY channel by which ledger data may reach a provider. */
  context: HouseAiContext;
  maxTokens?: number;
  /** Force a provider; otherwise the first key found in preference order wins. */
  provider?: AIProviderId | null;
};

/**
 * The exact user-visible-to-the-provider text.
 *
 * Exported so tests can assert on what would go over the wire without
 * intercepting `fetch`, and so a reviewer can see the whole payload in one
 * place. It returns no key and takes no key — asserting "no secret in the
 * payload" is therefore a single call.
 *
 * Redaction runs here as the **second** layer (plan §9: the allowlist is the
 * control, redaction is belt and braces). The context is already redacted by
 * `buildHouseAiContext`; re-running it over the serialised form also covers the
 * caller's own `userPrompt`, which nothing else has touched.
 */
export function buildHouseByokUserMessage(request: HouseByokRequest): string {
  assertHouseAiContextIsProjected(request.context);
  const payload = JSON.stringify({
    rows: request.context.rowCount,
    tables: request.context.tables,
  });
  return redactForEgress(
    `${request.userPrompt}\n\nHOUSEHOLD CONTEXT (JSON, minimised on device):\n${payload}`,
  );
}

/**
 * Read a key, treating an unreadable Keychain as "no key".
 *
 * **Module-private on purpose** — see header note 4. A build without the
 * Keychain entitlement throws here; the honest answer for the ladder is "no
 * key", which lands the member on Stage C copy instead of a crash.
 */
async function readKey(provider: AIProviderId): Promise<string | null> {
  try {
    const key = await aiKeyVault.getKey(provider);
    const trimmed = key?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * The credential one Stage-B call will run on.
 *
 * **Module-private, like `readKey`** — see header note 4. The exported surface
 * below still answers only *which* provider, so "no key in a returned value"
 * stays a property of this module's shape.
 */
type HouseByokCredential = {
  provider: AIProviderId;
  apiKey: string;
  /** `shared` means another household member's provider account is billed. */
  source: 'own' | 'shared';
};

/**
 * Preference order, deduplicated: the caller's forced provider, then the
 * member's chosen default (which the fixed order would otherwise ignore
 * entirely), then the fixed order.
 */
async function providerSearchOrder(
  preferred?: AIProviderId | null,
): Promise<AIProviderId[]> {
  const chosen = await getPreferredProvider();
  return [preferred, chosen, ...HOUSE_BYOK_PROVIDER_ORDER].filter(
    (provider, index, all): provider is AIProviderId =>
      !!provider && all.indexOf(provider) === index,
  );
}

/**
 * Which key will answer, or `null` when there is none to use.
 *
 * A key LENT by a household member is the last resort, after every key of the
 * member's own — the same rule Budget's ladder follows, and it is a BILLING
 * decision rather than a preference one: a borrowed key spends someone else's
 * money, so it is used only when this member has nothing of their own to spend.
 * Borrowed keys are never written to this device's Keychain; `getBorrowedAiKey`
 * fetches and unseals on use and caches in memory only, which is what makes
 * "stop sharing" take effect. See `@services/aiKeyShare`.
 */
async function resolveHouseByokCredential(
  preferred?: AIProviderId | null,
): Promise<HouseByokCredential | null> {
  const order = await providerSearchOrder(preferred);

  for (const provider of order) {
    const apiKey = await readKey(provider);
    if (apiKey) return { provider, apiKey, source: 'own' };
  }

  for (const provider of order) {
    // Never throws — a lent key is a convenience on top of the member's own, so
    // a network blip degrades to "no key" (Stage C copy) rather than an error.
    const borrowed = await getBorrowedAiKey(provider);
    if (borrowed) {
      return { provider: borrowed.provider, apiKey: borrowed.apiKey, source: 'shared' };
    }
  }

  return null;
}

/** Which provider will answer, or `null` when there is no usable key. */
export async function resolveHouseByokProvider(
  preferred?: AIProviderId | null,
): Promise<AIProviderId | null> {
  return (await resolveHouseByokCredential(preferred))?.provider ?? null;
}

/** `hasProviderKey` for the ladder — the whole question a Stage-A caller has. */
export async function hasHouseProviderKey(preferred?: AIProviderId | null): Promise<boolean> {
  return (await resolveHouseByokProvider(preferred)) !== null;
}

async function callOpenAi<T>(apiKey: string, request: HouseByokRequest): Promise<T> {
  const url = HOUSE_BYOK_ALLOWLIST.openai;
  assertHouseByokUrl(url, 'openai');
  const model = await resolveModel('openai');

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: buildHouseByokUserMessage(request) },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'structured_output',
            description: 'Return the structured answer',
            parameters: request.schema,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'structured_output' } },
      max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    }),
  });
  if (!res.ok) throw new HouseByokError(PROVIDER_FAILED, `openai http ${res.status}`);

  const json = (await res.json()) as {
    choices?: Array<{
      message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
    }>;
  };
  const raw = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!raw) throw new HouseByokError(PROVIDER_FAILED, 'openai returned no structured output');
  return JSON.parse(raw) as T;
}

async function callAnthropic<T>(apiKey: string, request: HouseByokRequest): Promise<T> {
  const url = HOUSE_BYOK_ALLOWLIST.anthropic;
  assertHouseByokUrl(url, 'anthropic');
  const model = await resolveModel('anthropic');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: buildHouseByokUserMessage(request) }],
      tools: [
        {
          name: 'structured_output',
          description: 'Return the structured answer',
          input_schema: request.schema,
        },
      ],
      tool_choice: { type: 'tool', name: 'structured_output' },
    }),
  });
  if (!res.ok) throw new HouseByokError(PROVIDER_FAILED, `anthropic http ${res.status}`);

  const json = (await res.json()) as { content?: Array<{ type: string; input?: unknown }> };
  const block = json.content?.find((b) => b.type === 'tool_use');
  if (!block?.input) {
    throw new HouseByokError(PROVIDER_FAILED, 'anthropic returned no structured output');
  }
  return block.input as T;
}

async function callGemini<T>(apiKey: string, request: HouseByokRequest): Promise<T> {
  // Header auth, not `?key=` — see header note 3.
  const model = await resolveModel('gemini');
  const url = `${HOUSE_BYOK_ALLOWLIST.gemini}/${model}:generateContent`;
  assertHouseByokUrl(url, 'gemini');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: buildHouseByokUserMessage(request) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        // OpenAPI subset, not JSON Schema — translate before it leaves.
        responseSchema: toGeminiResponseSchema(request.schema),
      },
    }),
  });
  if (!res.ok) throw new HouseByokError(PROVIDER_FAILED, `gemini http ${res.status}`);

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new HouseByokError(PROVIDER_FAILED, 'gemini returned no structured output');
  return JSON.parse(text) as T;
}

/**
 * Re-clothe anything thrown below this point.
 *
 * Two jobs: strip the key (targeted scrub, which the constructor's pattern
 * scrub cannot do on its own), and make sure the surfaced `message` is copy a
 * member could read. A `TypeError: Network request failed` or a provider's JSON
 * error body is engineering detail, and it goes on `.detail`.
 */
function toScrubbedByokError(error: unknown, apiKey: string): HouseByokError {
  if (error instanceof HouseByokError) {
    return new HouseByokError(
      scrubSecrets(error.message, apiKey),
      error.detail ? scrubSecrets(error.detail, apiKey) : undefined,
    );
  }
  const raw = error instanceof Error ? error.message : String(error);
  return new HouseByokError(PROVIDER_FAILED, scrubSecrets(raw, apiKey));
}

/**
 * Run one Stage-B call.
 *
 * Throws `HouseByokError` for every failure, including "no key" — the ladder
 * turns that into Stage C. It never returns a partial answer and never returns
 * the key it used.
 */
export async function generateHouseStructuredByok<T>(request: HouseByokRequest): Promise<T> {
  // Before resolving a key, before touching the network: is this payload legal?
  assertHouseAiContextIsProjected(request.context);

  // Resolve ONCE and spend what came back. Re-reading the Keychain for the key
  // after resolving a provider closed a race, but it cannot serve a BORROWED
  // key — that one is in memory only, by design — so it would turn every
  // shared-key call into "no key on this device" after the member had been told
  // the lent key was ready. One read has no window to race, either.
  const credential = await resolveHouseByokCredential(request.provider);
  if (!credential) {
    throw new HouseByokError(
      getHouseAiUnavailableCopy('no_key').message,
      'no byok key on this device',
    );
  }
  const { provider, apiKey } = credential;

  try {
    switch (provider) {
      case 'openai':
        return await callOpenAi<T>(apiKey, request);
      case 'anthropic':
        return await callAnthropic<T>(apiKey, request);
      case 'gemini':
        return await callGemini<T>(apiKey, request);
      default:
        throw new HouseByokError(
          getHouseAiUnavailableCopy('not_supported').message,
          `unknown provider ${String(provider)}`,
        );
    }
  } catch (error) {
    throw toScrubbedByokError(error, apiKey);
  }
}

/**
 * The seam every consumer depends on instead of the module.
 *
 * Consumers take a `HouseByokPort`; production passes `houseByokPort`, tests
 * pass a fake. That keeps consumer suites off `fetch` and the Keychain entirely,
 * so a Stage-A test can prove "no network, no key" by simply not providing
 * either — which is the DoD's offline checkbox, tested rather than asserted.
 */
export type HouseByokPort = {
  hasKey: () => Promise<boolean>;
  generate: <T>(request: HouseByokRequest) => Promise<T>;
};

export const houseByokPort: HouseByokPort = {
  hasKey: hasHouseProviderKey,
  generate: generateHouseStructuredByok,
};
