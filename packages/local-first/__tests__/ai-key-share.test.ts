import { describe, expect, it } from 'vitest';

import {
  aiKeyHint,
  deriveAiKeyShareKey,
  generateHouseholdKeys,
  openAiKeyShare,
  sealAiKeyShare,
  type AiKeyShareContext,
} from '../src/index';

const API_KEY = 'sk-ant-api03-not-a-real-key-0000000000000000000000000000abcd';

function ctx(overrides: Partial<AiKeyShareContext> = {}): AiKeyShareContext {
  return {
    householdId: 'hh-1',
    keyEpoch: 1,
    provider: 'anthropic',
    ownerUserId: 'user-owner',
    ...overrides,
  };
}

describe('ai key share envelope', () => {
  it('round-trips an API key between two devices holding the same HDK', () => {
    const { hdk } = generateHouseholdKeys('hh-1');
    const sealed = sealAiKeyShare({ hdk, ctx: ctx(), apiKey: API_KEY });

    // The recipient derives the same subkey from its own copy of the HDK.
    expect(openAiKeyShare({ hdk, ctx: ctx(), ciphertextB64: sealed })).toBe(API_KEY);
  });

  it('does not leak the key into the stored envelope', () => {
    const { hdk } = generateHouseholdKeys('hh-1');
    const sealed = sealAiKeyShare({ hdk, ctx: ctx(), apiKey: API_KEY });
    expect(sealed).not.toContain(API_KEY);
    expect(sealed).not.toContain('sk-ant');
  });

  it('cannot be opened by a device from another household', () => {
    const mine = generateHouseholdKeys('hh-1');
    const theirs = generateHouseholdKeys('hh-2');
    const sealed = sealAiKeyShare({ hdk: mine.hdk, ctx: ctx(), apiKey: API_KEY });

    expect(() => openAiKeyShare({ hdk: theirs.hdk, ctx: ctx(), ciphertextB64: sealed })).toThrow();
  });

  it('is bound to the epoch that sealed it, so a rotation does not silently open it', () => {
    const { hdk } = generateHouseholdKeys('hh-1');
    const sealed = sealAiKeyShare({ hdk, ctx: ctx({ keyEpoch: 1 }), apiKey: API_KEY });

    expect(() =>
      openAiKeyShare({ hdk, ctx: ctx({ keyEpoch: 2 }), ciphertextB64: sealed }),
    ).toThrow();
  });

  it('is bound to the provider', () => {
    const { hdk } = generateHouseholdKeys('hh-1');
    const sealed = sealAiKeyShare({ hdk, ctx: ctx({ provider: 'anthropic' }), apiKey: API_KEY });

    expect(() =>
      openAiKeyShare({ hdk, ctx: ctx({ provider: 'openai' }), ciphertextB64: sealed }),
    ).toThrow();
  });

  it('refuses to open under a different owner, so rows cannot be re-pointed', () => {
    // The threat: whoever controls the database swaps the owner_user_id on a row
    // so a recipient unseals Ann's key believing it is Bob's, and bills Ann.
    const { hdk } = generateHouseholdKeys('hh-1');
    const sealed = sealAiKeyShare({ hdk, ctx: ctx({ ownerUserId: 'ann' }), apiKey: API_KEY });

    expect(() =>
      openAiKeyShare({ hdk, ctx: ctx({ ownerUserId: 'bob' }), ciphertextB64: sealed }),
    ).toThrow();
  });

  it('rejects a tampered envelope rather than returning garbage', () => {
    const { hdk } = generateHouseholdKeys('hh-1');
    const sealed = sealAiKeyShare({ hdk, ctx: ctx(), apiKey: API_KEY });
    const flipped = `${sealed.slice(0, -2)}${sealed.slice(-2) === 'AA' ? 'AB' : 'AA'}`;

    expect(() => openAiKeyShare({ hdk, ctx: ctx(), ciphertextB64: flipped })).toThrow();
  });

  it('derives a distinct subkey per provider and epoch', () => {
    const { hdk } = generateHouseholdKeys('hh-1');
    const seen = new Set(
      [
        deriveAiKeyShareKey(hdk, ctx({ provider: 'openai', keyEpoch: 1 })),
        deriveAiKeyShareKey(hdk, ctx({ provider: 'anthropic', keyEpoch: 1 })),
        deriveAiKeyShareKey(hdk, ctx({ provider: 'anthropic', keyEpoch: 2 })),
      ].map((k) => Buffer.from(k).toString('hex')),
    );
    expect(seen.size).toBe(3);
  });

  it('never derives the raw HDK as the share key', () => {
    const { hdk } = generateHouseholdKeys('hh-1');
    const derived = deriveAiKeyShareKey(hdk, ctx());
    expect(Buffer.from(derived).toString('hex')).not.toBe(Buffer.from(hdk).toString('hex'));
  });

  it('hints with the last four characters only', () => {
    expect(aiKeyHint(API_KEY)).toBe('abcd');
    expect(aiKeyHint('ab')).toBe('****');
  });
});
