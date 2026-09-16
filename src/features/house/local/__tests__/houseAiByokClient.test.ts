/**
 * The Stage-B transport (plan §9, DoD H7).
 *
 * Four properties, each of which has an incident behind it somewhere:
 *
 *  1. **Three hosts, no fourth.** The URL allowlist is asserted immediately
 *     before every `fetch`, and a URL that merely *looks* like an allowlisted one
 *     is refused. A lookalike host is the whole attack.
 *  2. **The allowlist cannot be bypassed by hand-rolling a context.**
 *     `HouseAiContext` is a plain object type, so nothing in the compiler stops
 *     a future call site from assembling `{ tables: { households: … } }`
 *     directly. The client re-derives the check from the same allowlist and
 *     refuses BEFORE touching the network — the tests below assert `fetch` was
 *     never called, because "refused after sending" is not refusing.
 *  3. **No key in a thrown error, a log line or a returned value.** The suite
 *     installs console spies for the whole run and asserts at the end that not
 *     one console call carried the key, alongside per-case assertions on what is
 *     thrown and returned.
 *  4. **Redaction runs as a second layer over the caller's own prompt**, which
 *     nothing else in the pipeline touches.
 *
 * The Keychain is mocked rather than exercised: `expo-secure-store` has no
 * simulator-free behaviour worth asserting here, and the property under test is
 * what this module does with a key, not where it came from.
 *
 * Static imports only — `await import()` throws under this Jest config (§6.2).
 */
const mockGetKey = jest.fn();

jest.mock('@services/aiKeyVault', () => ({
  aiKeyVault: {
    getKey: (provider: string) => mockGetKey(provider),
    setKey: jest.fn(),
    hasKey: jest.fn(),
    deleteKey: jest.fn(),
  },
}));

/**
 * The household-sharing seam. Mocked rather than exercised for the same reason
 * as the Keychain — and because the real one would pull the whole House engine
 * into a transport suite to answer "nobody lent you anything".
 */
const mockBorrowedKey = jest.fn();
jest.mock('../ai/sharedAiKeys', () => ({
  getBorrowedAiKey: (provider: string) => mockBorrowedKey(provider),
  forgetBorrowedAiKey: jest.fn(),
  forgetBorrowedAiKeys: jest.fn(),
}));

import type { AIProviderId } from '@api/aiAccess';

import { buildHouseAiContext, type HouseAiContext } from '../ai/houseAiLadder';
import {
  assertHouseAiContextIsProjected,
  assertHouseByokUrl,
  buildHouseByokUserMessage,
  generateHouseStructuredByok,
  hasHouseProviderKey,
  resolveHouseByokProvider,
  HouseByokError,
  HOUSE_BYOK_ALLOWLIST,
  HOUSE_BYOK_PROVIDER_ORDER,
  type HouseByokRequest,
} from '../ai/houseByokClient';

/** Distinctive enough that a substring search is a complete leak test. */
const OPENAI_KEY = 'sk-proj-HOUSE-TEST-KEY-0000000000';
const ANTHROPIC_KEY = 'sk-ant-api03-HOUSE-TEST-KEY-1111111111';
const GEMINI_KEY = 'AIzaHOUSE-TEST-KEY-2222222222';
/** A key a household member lent this device — never in the Keychain. */
const SHARED_KEY = 'sk-ant-api03-HOUSE-LENT-KEY-3333333333';

const ALL_KEYS = [OPENAI_KEY, ANTHROPIC_KEY, GEMINI_KEY, SHARED_KEY];

const originalFetch = global.fetch;
const consoleSpies: jest.SpyInstance[] = [];

function keysFor(map: Partial<Record<AIProviderId, string | null>>) {
  mockGetKey.mockImplementation(async (provider: string) => map[provider as AIProviderId] ?? null);
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function fetchMock(): jest.Mock {
  return global.fetch as unknown as jest.Mock;
}

function urlOf(call = 0): string {
  return String(fetchMock().mock.calls[call]![0]);
}

function initOf(call = 0): RequestInit {
  return fetchMock().mock.calls[call]![1] as RequestInit;
}

/** A legal, already-projected context built the sanctioned way. */
function projectedContext(): HouseAiContext {
  return buildHouseAiContext(
    {
      tasks: [
        {
          id: 't1',
          household_id: 'hh-1',
          title: 'Service the furnace',
          description: 'Gate code 4792',
          next_due_date: '2026-09-01',
          assigned_to: { id: 'user-9', display_name: 'Sam Delgado' },
        },
      ],
    },
    ['tasks'],
  );
}

function request(overrides: Partial<HouseByokRequest> = {}): HouseByokRequest {
  return {
    systemPrompt: 'You are a home maintenance assistant.',
    userPrompt: 'What needs doing?',
    schema: { type: 'object', properties: {} },
    context: projectedContext(),
    ...overrides,
  };
}

beforeEach(() => {
  mockGetKey.mockReset();
  keysFor({});
  mockBorrowedKey.mockReset();
  mockBorrowedKey.mockResolvedValue(null);
  global.fetch = jest.fn() as unknown as typeof fetch;
});

beforeAll(() => {
  for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterAll(() => {
  global.fetch = originalFetch;
  for (const spy of consoleSpies) spy.mockRestore();
});

describe('the URL allowlist admits exactly three hosts', () => {
  it('has three providers and no more', () => {
    expect(Object.keys(HOUSE_BYOK_ALLOWLIST).sort()).toEqual(['anthropic', 'gemini', 'openai']);
    expect([...HOUSE_BYOK_PROVIDER_ORDER].sort()).toEqual(['anthropic', 'gemini', 'openai']);
  });

  it('every base is https and carries a path, which is what pins the host', () => {
    for (const base of Object.values(HOUSE_BYOK_ALLOWLIST)) {
      expect(base.startsWith('https://')).toBe(true);
      // A bare origin would let `startsWith` accept `https://api.openai.com.evil`
      // — the path segment is load-bearing, not decoration.
      expect(base.slice('https://'.length)).toContain('/');
    }
  });

  it.each(Object.entries(HOUSE_BYOK_ALLOWLIST))('accepts the %s base', (provider, base) => {
    expect(() => assertHouseByokUrl(base, provider as AIProviderId)).not.toThrow();
  });

  it('refuses an entirely different host', () => {
    expect(() => assertHouseByokUrl('https://evil.test/v1/chat/completions', 'openai')).toThrow(
      HouseByokError,
    );
  });

  it('refuses a lookalike host that merely starts the same way', () => {
    // The classic: `api.openai.com.attacker.test` is a subdomain of the
    // attacker's domain, and a naive origin check on "starts with api.openai.com"
    // waves it through.
    expect(() =>
      assertHouseByokUrl('https://api.openai.com.attacker.test/v1/chat/completions', 'openai'),
    ).toThrow(HouseByokError);
  });

  it('refuses a plaintext downgrade', () => {
    expect(() => assertHouseByokUrl('http://api.openai.com/v1/chat/completions', 'openai')).toThrow(
      HouseByokError,
    );
  });

  it("refuses one provider's URL under another provider", () => {
    expect(() => assertHouseByokUrl(HOUSE_BYOK_ALLOWLIST.openai, 'anthropic')).toThrow(
      HouseByokError,
    );
  });

  it('echoes no URL in the refusal, because a URL can carry a secret', () => {
    let thrown: HouseByokError | null = null;
    try {
      assertHouseByokUrl(`https://evil.test/v1?key=${OPENAI_KEY}`, 'openai');
    } catch (error) {
      thrown = error as HouseByokError;
    }
    expect(thrown).toBeInstanceOf(HouseByokError);
    expect(thrown!.message).not.toContain('evil.test');
    expect(thrown!.message).not.toContain(OPENAI_KEY);
    expect(`${thrown!.message} ${thrown!.detail}`).not.toContain(OPENAI_KEY);
  });
});

describe('the egress allowlist cannot be bypassed by hand-rolling a context', () => {
  beforeEach(() => keysFor({ anthropic: ANTHROPIC_KEY }));

  it('refuses a context carrying a FORBIDDEN table, before any network call', async () => {
    const smuggled: HouseAiContext = {
      tables: {
        // Type-checks. Would have shipped the property address.
        households: [{ id: 'hh-1', address_line1: '14 Alder Street' }],
      },
      excludedTables: [],
      rowCount: 1,
    };

    await expect(generateHouseStructuredByok(request({ context: smuggled }))).rejects.toBeInstanceOf(
      HouseByokError,
    );
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('refuses a context carrying an UNLISTED field on an allowed table', async () => {
    const smuggled: HouseAiContext = {
      tables: {
        // `tasks` is allowed; `description` is not. One field is enough.
        tasks: [{ id: 't1', title: 'Service furnace', description: 'Gate code 4792' }],
      },
      excludedTables: [],
      rowCount: 1,
    };

    await expect(generateHouseStructuredByok(request({ context: smuggled }))).rejects.toBeInstanceOf(
      HouseByokError,
    );
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('refuses a NEW field added to an allowed table', async () => {
    // The realistic version: a migration adds a column, some call site spreads
    // the whole row, and the client is the last thing standing.
    const smuggled: HouseAiContext = {
      tables: { tasks: [{ id: 't1', title: 'Service furnace', gate_code: '4792' }] },
      excludedTables: [],
      rowCount: 1,
    };
    await expect(generateHouseStructuredByok(request({ context: smuggled }))).rejects.toThrow();
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('refuses a context that is not a context at all', async () => {
    const notAContext = { tables: undefined } as unknown as HouseAiContext;
    await expect(
      generateHouseStructuredByok(request({ context: notAContext })),
    ).rejects.toBeInstanceOf(HouseByokError);
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('accepts a context that came through `buildHouseAiContext`', () => {
    expect(() => assertHouseAiContextIsProjected(projectedContext())).not.toThrow();
  });

  it('keeps the offending field name off the member-facing message', () => {
    const smuggled: HouseAiContext = {
      tables: { tasks: [{ id: 't1', gate_code: '4792' }] },
      excludedTables: [],
      rowCount: 1,
    };
    let thrown: HouseByokError | null = null;
    try {
      assertHouseAiContextIsProjected(smuggled);
    } catch (error) {
      thrown = error as HouseByokError;
    }
    expect(thrown!.message).not.toContain('gate_code');
    expect(thrown!.message).not.toContain('tasks');
    // …but an engineer can still find it.
    expect(thrown!.detail).toContain('tasks.gate_code');
  });
});

describe('provider resolution never hands a key to a caller', () => {
  it('returns only the provider id', async () => {
    keysFor({ anthropic: ANTHROPIC_KEY });
    const resolved = await resolveHouseByokProvider();
    expect(resolved).toBe('anthropic');
    // The Budget client returns `{ provider, apiKey }`; every consumer then
    // holds a secret it has no use for. This one cannot.
    expect(JSON.stringify(resolved)).not.toContain(ANTHROPIC_KEY);
  });

  it('prefers anthropic, then openai, then gemini', async () => {
    keysFor({ openai: OPENAI_KEY, gemini: GEMINI_KEY });
    expect(await resolveHouseByokProvider()).toBe('openai');
    keysFor({ gemini: GEMINI_KEY });
    expect(await resolveHouseByokProvider()).toBe('gemini');
  });

  it('honours an explicit preference when that key exists', async () => {
    keysFor({ anthropic: ANTHROPIC_KEY, gemini: GEMINI_KEY });
    expect(await resolveHouseByokProvider('gemini')).toBe('gemini');
  });

  it('ignores a preference with no key rather than failing', async () => {
    keysFor({ anthropic: ANTHROPIC_KEY });
    expect(await resolveHouseByokProvider('gemini')).toBe('anthropic');
  });

  it('treats a blank key as no key', async () => {
    keysFor({ anthropic: '   ' });
    expect(await resolveHouseByokProvider()).toBeNull();
    expect(await hasHouseProviderKey()).toBe(false);
  });

  it('treats an unreadable Keychain as no key rather than crashing', async () => {
    // A signed build missing the entitlement throws here. The right answer for
    // the ladder is "no key" → Stage C copy, not a crash on a maintenance screen.
    mockGetKey.mockRejectedValue(new Error('A required entitlement is not present'));
    expect(await hasHouseProviderKey()).toBe(false);
  });

  it('answers the only question the ladder asks', async () => {
    keysFor({});
    expect(await hasHouseProviderKey()).toBe(false);
    keysFor({ openai: OPENAI_KEY });
    expect(await hasHouseProviderKey()).toBe(true);
  });
});

describe('a key lent by a household member', () => {
  const lent = async (provider: string) =>
    provider === 'anthropic'
      ? { provider: 'anthropic', apiKey: SHARED_KEY, ownerUserId: 'u-ann' }
      : null;

  it('answers when the member has no key of their own', async () => {
    keysFor({});
    mockBorrowedKey.mockImplementation(lent);

    const resolved = await resolveHouseByokProvider();
    expect(resolved).toBe('anthropic');
    expect(await hasHouseProviderKey()).toBe(true);
    // Same guarantee as an own key: the caller learns WHICH provider, not the key.
    expect(JSON.stringify(resolved)).not.toContain(SHARED_KEY);
  });

  it('never outranks a key of the member’s own', async () => {
    // A billing decision, not a preference one — a lent key spends someone
    // else's money, so it is the last resort rather than a peer.
    keysFor({ gemini: GEMINI_KEY });
    mockBorrowedKey.mockImplementation(lent);

    expect(await resolveHouseByokProvider()).toBe('gemini');
    expect(mockBorrowedKey).not.toHaveBeenCalled();
  });

  it('is what the actual provider call is made with', async () => {
    // The trap this covers: resolving a provider and then re-reading the
    // Keychain for its key. A lent key is in memory only, so that read finds
    // nothing and the call dies as "no key" after the member was told it was
    // ready — which is exactly what Budget's client did.
    keysFor({});
    mockBorrowedKey.mockImplementation(lent);
    fetchMock().mockResolvedValue(
      okJson({ content: [{ type: 'tool_use', input: { answer: 'ok' } }] }),
    );

    await generateHouseStructuredByok(request());

    expect(urlOf()).toBe(HOUSE_BYOK_ALLOWLIST.anthropic);
    expect((initOf().headers as Record<string, string>)['x-api-key']).toBe(SHARED_KEY);
  });

  it('falls back to Stage C when the share has been revoked', async () => {
    // `getBorrowedAiKey` answers null once the share stops resolving — that is
    // how revocation takes effect — and the ladder must land on "no key" copy
    // rather than an error.
    keysFor({});
    mockBorrowedKey.mockResolvedValue(null);

    await expect(generateHouseStructuredByok(request())).rejects.toBeInstanceOf(HouseByokError);
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});

describe('each provider is called on its own allowlisted URL', () => {
  it('openai: bearer header, allowlisted URL, structured tool call', async () => {
    keysFor({ openai: OPENAI_KEY });
    fetchMock().mockResolvedValue(
      okJson({
        choices: [
          { message: { tool_calls: [{ function: { arguments: '{"answer":"filter"}' } }] } },
        ],
      }),
    );

    const result = await generateHouseStructuredByok<{ answer: string }>(request());
    expect(result).toEqual({ answer: 'filter' });
    expect(urlOf()).toBe(HOUSE_BYOK_ALLOWLIST.openai);
    expect((initOf().headers as Record<string, string>).Authorization).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it('anthropic: x-api-key header, allowlisted URL, tool_use block', async () => {
    keysFor({ anthropic: ANTHROPIC_KEY });
    fetchMock().mockResolvedValue(
      okJson({ content: [{ type: 'tool_use', input: { answer: 'gutters' } }] }),
    );

    const result = await generateHouseStructuredByok<{ answer: string }>(request());
    expect(result).toEqual({ answer: 'gutters' });
    expect(urlOf()).toBe(HOUSE_BYOK_ALLOWLIST.anthropic);
    expect((initOf().headers as Record<string, string>)['x-api-key']).toBe(ANTHROPIC_KEY);
  });

  it('gemini: key travels in a HEADER, never in the query string', async () => {
    keysFor({ gemini: GEMINI_KEY });
    fetchMock().mockResolvedValue(
      okJson({ candidates: [{ content: { parts: [{ text: '{"answer":"roof"}' }] } }] }),
    );

    const result = await generateHouseStructuredByok<{ answer: string }>(request());
    expect(result).toEqual({ answer: 'roof' });
    // The regression this pins: Budget builds `…:generateContent?key=<apiKey>`,
    // which puts the secret somewhere every error message and access log can
    // pick it up.
    // Model-agnostic on purpose: pinning the literal default made this security
    // assertion fail every time the catalog moved (it still said
    // `gemini-2.0-flash` after that id was retired). What must hold is the host
    // and the absence of the key, not which model is current.
    expect(urlOf()).toMatch(
      new RegExp(`^${HOUSE_BYOK_ALLOWLIST.gemini}/[\\w.-]+:generateContent$`),
    );
    expect(urlOf()).not.toContain('key=');
    expect(urlOf()).not.toContain(GEMINI_KEY);
    expect((initOf().headers as Record<string, string>)['x-goog-api-key']).toBe(GEMINI_KEY);
  });

  it.each(['openai', 'anthropic', 'gemini'] as const)(
    '%s sends no key in the URL',
    async (provider) => {
      const key = { openai: OPENAI_KEY, anthropic: ANTHROPIC_KEY, gemini: GEMINI_KEY }[provider];
      keysFor({ [provider]: key });
      fetchMock().mockResolvedValue(
        okJson({
          choices: [{ message: { tool_calls: [{ function: { arguments: '{}' } }] } }],
          content: [{ type: 'tool_use', input: {} }],
          candidates: [{ content: { parts: [{ text: '{}' }] } }],
        }),
      );
      await generateHouseStructuredByok(request());
      expect(urlOf()).not.toContain(key);
      expect(urlOf().startsWith(HOUSE_BYOK_ALLOWLIST[provider])).toBe(true);
    },
  );
});

describe('what actually goes over the wire', () => {
  beforeEach(() => {
    keysFor({ anthropic: ANTHROPIC_KEY });
    fetchMock().mockResolvedValue(
      okJson({ content: [{ type: 'tool_use', input: { ok: true } }] }),
    );
  });

  it('carries the projected rows and none of the excluded ones', async () => {
    await generateHouseStructuredByok(request());
    const body = String(initOf().body);
    expect(body).toContain('Service the furnace');
    expect(body).toContain('2026-09-01');
    expect(body).not.toContain('Gate code 4792');
    expect(body).not.toContain('Sam Delgado');
    expect(body).not.toContain('user-9');
    expect(body).not.toContain('hh-1');
  });

  it('redacts the caller’s own prompt — the second layer nothing else covers', async () => {
    // `buildHouseAiContext` redacts the ledger side. The `userPrompt` is written
    // by a call site and can interpolate anything; this is the only pass over it.
    await generateHouseStructuredByok(
      request({ userPrompt: 'Ask sam@example.com or call 604-555-0142 about the furnace' }),
    );
    const body = String(initOf().body);
    expect(body).not.toContain('sam@example.com');
    expect(body).not.toContain('604-555-0142');
    expect(body).toContain('[redacted]');
  });

  it('builds the same message the request would send, with no key in it', () => {
    const message = buildHouseByokUserMessage(request());
    expect(message).toContain('What needs doing?');
    expect(message).toContain('Service the furnace');
    for (const key of ALL_KEYS) expect(message).not.toContain(key);
  });

  it('has no way to attach an image', () => {
    // Photo-bearing features are P4-disabled in the locked assignment until a
    // BYOK vision path is designed. An `images` field would be an egress channel
    // the allowlist does not cover, so the type does not have one.
    const withImages = {
      ...request(),
      images: [{ base64: 'AAAA', mime: 'image/jpeg' }],
    } as HouseByokRequest & { images: unknown };
    expect(Object.keys(request())).not.toContain('images');
    // Even when a caller forces it on, nothing reads it.
    return generateHouseStructuredByok(withImages).then(() => {
      expect(String(initOf().body)).not.toContain('AAAA');
    });
  });
});

describe('no API key in a thrown error, a log line or a returned value', () => {
  it('scrubs the key out of a network error that quotes it', async () => {
    keysFor({ anthropic: ANTHROPIC_KEY });
    fetchMock().mockRejectedValue(
      new Error(`Network request failed for x-api-key ${ANTHROPIC_KEY}`),
    );

    let thrown: HouseByokError | null = null;
    try {
      await generateHouseStructuredByok(request());
    } catch (error) {
      thrown = error as HouseByokError;
    }

    expect(thrown).toBeInstanceOf(HouseByokError);
    expect(`${thrown!.message} ${thrown!.detail}`).not.toContain(ANTHROPIC_KEY);
    expect(thrown!.detail).toContain('[redacted-key]');
  });

  it('scrubs a key-shaped string it has never seen', async () => {
    // A provider echoing somebody else's key back in an error body. The targeted
    // scrub cannot know that string; the shape patterns can.
    keysFor({ anthropic: ANTHROPIC_KEY });
    fetchMock().mockRejectedValue(new Error('invalid key sk-ant-api03-SOMEONE-ELSES-000000'));
    await expect(generateHouseStructuredByok(request())).rejects.toMatchObject({
      detail: expect.stringContaining('[redacted-key]'),
    });
  });

  it('scrubs a secret smuggled through a query string', async () => {
    keysFor({ gemini: GEMINI_KEY });
    fetchMock().mockRejectedValue(new Error(`502 from https://x.test/v1?key=${GEMINI_KEY}&a=b`));
    let thrown: HouseByokError | null = null;
    try {
      await generateHouseStructuredByok(request());
    } catch (error) {
      thrown = error as HouseByokError;
    }
    expect(thrown!.detail).not.toContain(GEMINI_KEY);
    // The prefix survives on purpose: an engineer needs to see that a key WAS
    // sent in a URL, just not which one.
    expect(thrown!.detail).toContain('key=[redacted-key]');
  });

  it('shows member-facing copy and keeps the status code for logs', async () => {
    keysFor({ openai: OPENAI_KEY });
    fetchMock().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    let thrown: HouseByokError | null = null;
    try {
      await generateHouseStructuredByok(request());
    } catch (error) {
      thrown = error as HouseByokError;
    }
    expect(thrown!.message).not.toContain('429');
    expect(thrown!.message).not.toContain('http');
    expect(thrown!.message.length).toBeGreaterThan(80);
    expect(thrown!.detail).toContain('429');
  });

  it('throws member-facing `no key` copy without naming a provider', async () => {
    keysFor({});
    let thrown: HouseByokError | null = null;
    try {
      await generateHouseStructuredByok(request());
    } catch (error) {
      thrown = error as HouseByokError;
    }
    expect(thrown).toBeInstanceOf(HouseByokError);
    expect(thrown!.message).not.toMatch(/openai|anthropic|gemini/i);
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('never returns a key from any exported function', async () => {
    keysFor({ anthropic: ANTHROPIC_KEY, openai: OPENAI_KEY, gemini: GEMINI_KEY });
    fetchMock().mockResolvedValue(
      okJson({ content: [{ type: 'tool_use', input: { answer: 'ok' } }] }),
    );

    const returned = [
      await resolveHouseByokProvider(),
      await hasHouseProviderKey(),
      buildHouseByokUserMessage(request()),
      await generateHouseStructuredByok(request()),
    ];
    const serialized = JSON.stringify(returned);
    for (const key of ALL_KEYS) expect(serialized).not.toContain(key);
  });

  it('logged nothing containing a key, across this whole suite', () => {
    // The "log line" half of the DoD checkbox. The spies are installed for the
    // whole file, so this assertion covers every case above it.
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        const line = call.map((a: unknown) => String(a)).join(' ');
        for (const key of ALL_KEYS) expect(line).not.toContain(key);
      }
    }
  });
});

describe('malformed provider answers fail loudly rather than half-succeeding', () => {
  it('openai with no tool call', async () => {
    keysFor({ openai: OPENAI_KEY });
    fetchMock().mockResolvedValue(okJson({ choices: [{ message: {} }] }));
    await expect(generateHouseStructuredByok(request())).rejects.toBeInstanceOf(HouseByokError);
  });

  it('anthropic with no tool_use block', async () => {
    keysFor({ anthropic: ANTHROPIC_KEY });
    fetchMock().mockResolvedValue(okJson({ content: [{ type: 'text' }] }));
    await expect(generateHouseStructuredByok(request())).rejects.toBeInstanceOf(HouseByokError);
  });

  it('gemini with unparseable JSON', async () => {
    keysFor({ gemini: GEMINI_KEY });
    fetchMock().mockResolvedValue(
      okJson({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }),
    );
    await expect(generateHouseStructuredByok(request())).rejects.toBeInstanceOf(HouseByokError);
  });
});
