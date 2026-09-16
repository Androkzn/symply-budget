/**
 * useAIAccessEntry — the single source of truth for the AI-access entry that
 * every brand's Settings / More screen renders. Locks the shared gate,
 * destination, and copy so no brand can drift (the whole point of the hook).
 */

import { createElement } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { useAIAccessEntry, type AIAccessEntry } from '../useAIAccessEntry';

const mockEntitlement = jest.fn();
jest.mock('@hooks/useAIEntitlement', () => ({
  useAIEntitlement: () => mockEntitlement(),
}));

const base = {
  aiFeaturesEnabled: true,
  bringYourOwnAIEnabled: true,
  subscriptionsEnabled: false,
  source: null as string | null,
  provider: null as string | null,
  byokConnections: [] as Array<{ provider: string }>,
};

/** Render the hook via a probe component and return its resolved value. */
function resolve(): AIAccessEntry {
  let captured!: AIAccessEntry;
  function Probe() {
    captured = useAIAccessEntry();
    return null;
  }
  act(() => {
    ReactTestRenderer.create(createElement(Probe));
  });
  return captured;
}

beforeEach(() => mockEntitlement.mockReturnValue({ ...base }));

describe('useAIAccessEntry — gate', () => {
  it('shows when AI features + BYOK are enabled', () => {
    expect(resolve().show).toBe(true);
  });

  it('shows when AI features + subscriptions are enabled (managed AI only)', () => {
    mockEntitlement.mockReturnValue({ ...base, bringYourOwnAIEnabled: false, subscriptionsEnabled: true });
    expect(resolve().show).toBe(true);
  });

  it('hides when AI features are off entirely', () => {
    mockEntitlement.mockReturnValue({ ...base, aiFeaturesEnabled: false });
    expect(resolve().show).toBe(false);
  });

  it('hides when neither BYOK nor subscriptions are enabled', () => {
    mockEntitlement.mockReturnValue({ ...base, bringYourOwnAIEnabled: false, subscriptionsEnabled: false });
    expect(resolve().show).toBe(false);
  });

  it('is defensive against a partial entitlement (undefined connections)', () => {
    mockEntitlement.mockReturnValue({ aiFeaturesEnabled: true, bringYourOwnAIEnabled: true });
    const entry = resolve();
    expect(entry.show).toBe(true);
    expect(entry.subtitle).toBe('Connect OpenAI, Claude, or Gemini');
  });
});

describe('useAIAccessEntry — canonical destination + copy (identical for every brand)', () => {
  it('points at the /ai-access hub with the canonical title + icon when nothing is connected', () => {
    const entry = resolve();
    expect(entry.route).toBe('/ai-access');
    expect(entry.title).toBe('AI assistance');
    expect(entry.icon).toBe('sparkles-outline');
  });

  it('subtitle: prompts to connect when nothing is connected', () => {
    expect(resolve().subtitle).toBe('Connect OpenAI, Claude, or Gemini');
  });

  it('subtitle: names the active BYOK provider', () => {
    mockEntitlement.mockReturnValue({ ...base, source: 'byok', provider: 'anthropic' });
    expect(resolve().subtitle).toBe('Anthropic Claude active');
  });

  it('subtitle: offers to manage when keys exist but none is the active source', () => {
    mockEntitlement.mockReturnValue({ ...base, source: 'simplehouse', byokConnections: [{ provider: 'openai' }] });
    expect(resolve().subtitle).toBe('Manage connected AI keys');
  });
});

/**
 * The Profile subscription card used to own a second "Manage AI access" button
 * that routed to `/ai-access/manage`. It was removed; this row absorbed it, so
 * the manage state must be resolvable HERE or it is gone from the app.
 */
describe('useAIAccessEntry — the manage entry (moved off the Profile card)', () => {
  it('becomes "Manage AI access" → /ai-access/manage once a key is connected', () => {
    mockEntitlement.mockReturnValue({
      ...base,
      source: 'byok',
      provider: 'anthropic',
      byokConnections: [{ provider: 'anthropic' }],
    });
    const entry = resolve();
    expect(entry.title).toBe('Manage AI access');
    expect(entry.route).toBe('/ai-access/manage');
    expect(entry.subtitle).toBe('Anthropic Claude active');
    expect(entry.icon).toBe('sparkles-outline');
  });

  it('manages on connections alone — a key that is not the active source still counts', () => {
    // PRO member on managed AI who also left a key connected: there is something
    // to manage even though `source` is not 'byok'.
    mockEntitlement.mockReturnValue({
      ...base,
      source: 'simplehouse',
      byokConnections: [{ provider: 'openai' }],
    });
    const entry = resolve();
    expect(entry.title).toBe('Manage AI access');
    expect(entry.route).toBe('/ai-access/manage');
  });

  it('falls back to the hub the moment the last key is disconnected', () => {
    mockEntitlement.mockReturnValue({ ...base, source: 'simplehouse', byokConnections: [] });
    const entry = resolve();
    expect(entry.title).toBe('AI assistance');
    expect(entry.route).toBe('/ai-access');
  });
});
