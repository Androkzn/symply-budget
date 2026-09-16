/**
 * Feature-flag resolveFlag — all brands share the same resolution chain
 * (dev override → remote → build-time default). No brand hard-disables AI/BYOK.
 */

import type { FeatureFlagKey } from '@config/features';

type State = {
  remoteFlags: Partial<Record<FeatureFlagKey, boolean>>;
  devOverrides: Partial<Record<FeatureFlagKey, boolean>>;
  version: number;
  lastFetchedAt: number | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
};

const emptyState = (over: Partial<State> = {}): State => ({
  remoteFlags: {},
  devOverrides: {},
  version: 0,
  lastFetchedAt: null,
  status: 'idle',
  ...over,
});

/** Load resolveFlag without pulling the live axios brand client. */
function loadResolveFlag(): (s: State, k: FeatureFlagKey) => boolean {
  let resolveFlag!: (s: State, k: FeatureFlagKey) => boolean;
  jest.isolateModules(() => {
    jest.doMock('@api/features', () => ({
      featuresApi: { getFeatureFlags: jest.fn() },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require
    resolveFlag = require('../featureFlagStore').resolveFlag;
  });
  return resolveFlag;
}

const AI_FLAGS: FeatureFlagKey[] = [
  'aiFeaturesEnabled',
  'aiRequiresAccess',
  'aiHousekeeper',
  'subscriptionsEnabled',
  'bringYourOwnAIEnabled',
  'openAIProviderEnabled',
  'anthropicProviderEnabled',
  'geminiProviderEnabled',
];

describe('resolveFlag — ecosystem brands share AI defaults', () => {
  it('uses build-time AI defaults (no brand hard-off)', () => {
    const resolveFlag = loadResolveFlag();
    expect(resolveFlag(emptyState(), 'aiFeaturesEnabled')).toBe(true);
    expect(resolveFlag(emptyState(), 'bringYourOwnAIEnabled')).toBe(true);
    for (const key of AI_FLAGS) {
      expect(typeof resolveFlag(emptyState(), key)).toBe('boolean');
    }
  });

  it('lets remote values win over defaults', () => {
    const resolveFlag = loadResolveFlag();
    const state = emptyState({
      remoteFlags: { aiFeaturesEnabled: true, bringYourOwnAIEnabled: false },
    });
    expect(resolveFlag(state, 'aiFeaturesEnabled')).toBe(true);
    expect(resolveFlag(state, 'bringYourOwnAIEnabled')).toBe(false);
  });
});
