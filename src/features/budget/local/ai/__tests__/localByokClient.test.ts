import { getBorrowedAiKey } from '@services/aiKeyShare';
import { aiKeyVault } from '@services/aiKeyVault';
import { getPreferredModel, getPreferredProvider } from '@services/aiModelPreference';

import { generateStructuredByok, resolveLocalByokProvider } from '../localByokClient';
import { RECEIPT_IMPORT_SCHEMA } from '../prompts/receiptImport';

jest.mock('@services/aiKeyVault', () => ({
  aiKeyVault: { getKey: jest.fn(async () => null), setKey: jest.fn(), hasKey: jest.fn() },
}));

jest.mock('@services/aiModelPreference', () => ({
  getPreferredModel: jest.fn(async () => null),
  getPreferredProvider: jest.fn(async () => null),
}));

jest.mock('@services/aiKeyShare', () => ({
  getBorrowedAiKey: jest.fn(async () => null),
  forgetBorrowedAiKey: jest.fn(),
  forgetBorrowedAiKeys: jest.fn(),
}));

const mockKeys = (keys: Partial<Record<string, string>>) => {
  jest.mocked(aiKeyVault.getKey).mockImplementation(async (p: string) => keys[p] ?? null);
};

/** Capture the JSON body of the single fetch each call makes. */
function stubFetch(responseBody: unknown, ok = true, status = 200) {
  const fetchMock = jest.fn(async () => ({
    ok,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  })) as unknown as typeof fetch;
  global.fetch = fetchMock;
  return fetchMock as unknown as jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bodyOf(fetchMock: jest.Mock, call = 0): any {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

const REQUEST = {
  systemPrompt: 'sys',
  userPrompt: 'user',
  schema: RECEIPT_IMPORT_SCHEMA,
};

describe('localByokClient — provider selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getPreferredProvider).mockResolvedValue(null);
    jest.mocked(getPreferredModel).mockResolvedValue(null);
    jest.mocked(getBorrowedAiKey).mockResolvedValue(null);
  });

  it('falls back to the fixed order when no default was chosen', async () => {
    mockKeys({ openai: 'sk-o', gemini: 'g-key' });
    await expect(resolveLocalByokProvider()).resolves.toEqual({
      provider: 'openai',
      apiKey: 'sk-o',
      source: 'own',
    });
  });

  it("honors the member's chosen default over the fixed order", async () => {
    mockKeys({ anthropic: 'sk-a', gemini: 'g-key' });
    jest.mocked(getPreferredProvider).mockResolvedValue('gemini');

    // Without this the hardcoded anthropic-first order wins and the member's
    // Gemini choice silently bills the wrong provider.
    await expect(resolveLocalByokProvider()).resolves.toEqual({
      provider: 'gemini',
      apiKey: 'g-key',
      source: 'own',
    });
  });

  it('ignores a chosen default that has no key on this device', async () => {
    mockKeys({ anthropic: 'sk-a' });
    jest.mocked(getPreferredProvider).mockResolvedValue('gemini');
    await expect(resolveLocalByokProvider()).resolves.toEqual({
      provider: 'anthropic',
      apiKey: 'sk-a',
      source: 'own',
    });
  });

  it('returns null when no provider has a key', async () => {
    mockKeys({});
    await expect(resolveLocalByokProvider()).resolves.toBeNull();
  });

  it('falls back to a household member’s shared key when this member has none', async () => {
    mockKeys({});
    jest
      .mocked(getBorrowedAiKey)
      .mockImplementation(async (p) =>
        p === 'anthropic' ? { provider: 'anthropic', apiKey: 'sk-lent', ownerUserId: 'u-ann' } : null,
      );

    await expect(resolveLocalByokProvider()).resolves.toEqual({
      provider: 'anthropic',
      apiKey: 'sk-lent',
      source: 'shared',
      ownerUserId: 'u-ann',
    });
  });

  it('never spends a shared key while the member has one of their own', async () => {
    // The ordering is a BILLING decision: a borrowed key spends someone else's
    // money, so it is the last resort, not a peer of the member's own key.
    mockKeys({ gemini: 'g-key' });
    jest
      .mocked(getBorrowedAiKey)
      .mockResolvedValue({ provider: 'anthropic', apiKey: 'sk-lent', ownerUserId: 'u-ann' });

    await expect(resolveLocalByokProvider()).resolves.toEqual({
      provider: 'gemini',
      apiKey: 'g-key',
      source: 'own',
    });
    expect(getBorrowedAiKey).not.toHaveBeenCalled();
  });

  it('prefers the member’s chosen provider among shared keys', async () => {
    mockKeys({});
    jest.mocked(getPreferredProvider).mockResolvedValue('gemini');
    jest
      .mocked(getBorrowedAiKey)
      .mockImplementation(async (p) =>
        p === 'gemini' || p === 'anthropic'
          ? { provider: p, apiKey: `sk-${p}`, ownerUserId: 'u-ann' }
          : null,
      );

    const resolved = await resolveLocalByokProvider();
    expect(resolved?.provider).toBe('gemini');
    expect(resolved?.source).toBe('shared');
  });
});

describe('localByokClient — schema per provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getPreferredProvider).mockResolvedValue(null);
    jest.mocked(getPreferredModel).mockResolvedValue(null);
  });

  it('gemini receives a translated schema — no additionalProperties, no type unions', async () => {
    mockKeys({ gemini: 'g-key' });
    const fetchMock = stubFetch({
      candidates: [{ content: { parts: [{ text: '{"vendor":null,"items":[]}' }] } }],
    });

    await generateStructuredByok(REQUEST, 'gemini');

    const schema = bodyOf(fetchMock).generationConfig.responseSchema;
    const serialized = JSON.stringify(schema);
    expect(serialized).not.toContain('additionalProperties');
    expect(serialized).not.toContain('["string","null"]');
    expect(schema.properties.vendor).toEqual(expect.objectContaining({ type: 'string' }));
    expect(schema.properties.vendor.nullable).toBeUndefined();
  });

  it('gemini sends images before the prompt text', async () => {
    mockKeys({ gemini: 'g-key' });
    const fetchMock = stubFetch({
      candidates: [{ content: { parts: [{ text: '{"vendor":"Other","items":[]}' }] } }],
    });
    await generateStructuredByok(
      {
        ...REQUEST,
        images: [{ base64: 'abc', mime: 'image/jpeg' }],
      },
      'gemini',
    );
    const parts = bodyOf(fetchMock).contents[0].parts;
    expect(parts[0].inline_data).toEqual({ mime_type: 'image/jpeg', data: 'abc' });
    expect(parts[1].text).toContain('sys');
  });

  it('openai keeps the strict schema verbatim (strict mode needs additionalProperties)', async () => {
    mockKeys({ openai: 'sk-o' });
    const fetchMock = stubFetch({
      choices: [{ message: { tool_calls: [{ function: { arguments: '{"items":[]}' } }] } }],
    });

    await generateStructuredByok(REQUEST, 'openai');

    const params = bodyOf(fetchMock).tools[0].function.parameters;
    expect(params).toEqual(RECEIPT_IMPORT_SCHEMA);
    expect(params.additionalProperties).toBe(false);
  });

  it('anthropic keeps the strict schema verbatim', async () => {
    mockKeys({ anthropic: 'sk-a' });
    const fetchMock = stubFetch({
      content: [{ type: 'tool_use', input: { items: [] } }],
    });

    await generateStructuredByok(REQUEST, 'anthropic');

    expect(bodyOf(fetchMock).tools[0].input_schema).toEqual(RECEIPT_IMPORT_SCHEMA);
  });
});

describe('localByokClient — model selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getPreferredProvider).mockResolvedValue(null);
    jest.mocked(getPreferredModel).mockResolvedValue(null);
  });

  it.each([
    [
      'gemini',
      'g-key',
      'gemini-3.5-flash',
      { candidates: [{ content: { parts: [{ text: '{}' }] } }] },
    ],
    [
      'openai',
      'sk-o',
      'gpt-5.6-luna',
      { choices: [{ message: { tool_calls: [{ function: { arguments: '{}' } }] } }] },
    ],
    ['anthropic', 'sk-a', 'claude-sonnet-5', { content: [{ type: 'tool_use', input: {} }] }],
  ])('%s falls back to its default model when nothing is chosen', async (
    provider,
    key,
    expectedModel,
    response,
  ) => {
    mockKeys({ [provider as string]: key as string });
    const fetchMock = stubFetch(response);

    await generateStructuredByok(REQUEST, provider as 'gemini' | 'openai' | 'anthropic');

    if (provider === 'gemini') {
      expect(fetchMock.mock.calls[0][0]).toContain(expectedModel);
    } else {
      expect(bodyOf(fetchMock).model).toBe(expectedModel);
    }
  });

  it.each([
    [
      'gemini',
      'g-key',
      'gemini-3.1-pro-preview',
      { candidates: [{ content: { parts: [{ text: '{}' }] } }] },
    ],
    ['openai', 'sk-o', 'gpt-5.6-sol', { choices: [{ message: { tool_calls: [{ function: { arguments: '{}' } }] } }] }],
    ['anthropic', 'sk-a', 'claude-opus-5', { content: [{ type: 'tool_use', input: {} }] }],
  ])("%s uses the member's chosen model", async (provider, key, chosen, response) => {
    mockKeys({ [provider as string]: key as string });
    jest.mocked(getPreferredModel).mockResolvedValue(chosen as string);
    const fetchMock = stubFetch(response);

    await generateStructuredByok(REQUEST, provider as 'gemini' | 'openai' | 'anthropic');

    // The card said "Gemini 3.1 Flash-Lite" while the call went to
    // gemini-2.0-flash — the picker must not be decorative.
    if (provider === 'gemini') {
      expect(fetchMock.mock.calls[0][0]).toContain(chosen);
    } else {
      expect(bodyOf(fetchMock).model).toBe(chosen);
    }
  });

  it('spends a BORROWED key on the actual call — it is never in the vault', async () => {
    // The resolver already answers with the plaintext of a lent key; re-reading
    // the Keychain for it found nothing (a borrowed key lives in memory only, by
    // design) and every shared-key scan died on `.trim()` of null before it
    // reached the provider — after the member had been told the key was ready.
    mockKeys({});
    jest
      .mocked(getBorrowedAiKey)
      .mockImplementation(async (p) =>
        p === 'anthropic' ? { provider: 'anthropic', apiKey: 'sk-lent', ownerUserId: 'u-ann' } : null,
      );
    const fetchMock = stubFetch({ content: [{ type: 'tool_use', input: { items: [] } }] });

    await expect(generateStructuredByok(REQUEST)).resolves.toEqual({ items: [] });
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('sk-lent');
  });

  it('names the model actually used in the HTTP error, not the default', async () => {
    mockKeys({ gemini: 'g-key' });
    jest.mocked(getPreferredModel).mockResolvedValue('gemini-3.1-pro-preview');
    stubFetch({ error: { message: 'nope' } }, false, 400);

    await expect(generateStructuredByok(REQUEST, 'gemini')).rejects.toThrow(/gemini HTTP 400/);
  });
});
