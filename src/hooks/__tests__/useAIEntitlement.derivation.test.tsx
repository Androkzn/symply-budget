/**
 * useAIEntitlement derivation — locks the two booleans that gate every AI
 * surface: `canUseAI = aiFeaturesEnabled && server.can_use_ai` and
 * `hasBYOKAccess = hasConnection && bringYourOwnAIEnabled`. These are what flip
 * on after a BYOK connect (the shared ['ai-access'] refetch), so the formula is
 * pinned here rather than only exercised transitively through AIAccessGate.
 */

// renderOnDevice drives useDeviceType through a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// Use the REAL hook (jest.setup stubs it globally as always-entitled).
jest.unmock('@hooks/useAIEntitlement');

let mockAccess: unknown = null;
let mockFlags: Record<string, boolean> = {};

jest.mock('@tanstack/react-query', () => ({
  __esModule: true,
  useQuery: () => ({ data: mockAccess, isLoading: false, refetch: jest.fn() }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('@stores/featureFlagStore', () => ({
  __esModule: true,
  isFeatureEnabled: (key: string) => mockFlags[key] ?? false,
  useFeatureFlagStore: () => undefined,
}));

import React from 'react';
import { Text } from 'react-native';

import { renderOnDevice, treeText } from '../../test-utils/deviceRender';
import { useAIEntitlement } from '../useAIEntitlement';

function Probe() {
  const e = useAIEntitlement();
  return <Text>{`canUseAI=${e.canUseAI};byok=${e.hasBYOKAccess}`}</Text>;
}

function readProbe() {
  return treeText(renderOnDevice('iPhone 14 Pro', <Probe />));
}

const access = (over: Record<string, unknown> = {}) => ({
  subscription: { is_paid: false },
  byok: { connections: [] as unknown[] },
  can_use_ai: false,
  source: null,
  provider: null,
  available_models: [],
  ...over,
});

beforeEach(() => {
  mockAccess = access();
  mockFlags = {};
});

describe('useAIEntitlement — canUseAI / hasBYOKAccess derivation', () => {
  it('canUseAI is true only when AI features are on AND the server allows it', () => {
    mockFlags = { aiFeaturesEnabled: true };
    mockAccess = access({ can_use_ai: true });
    expect(readProbe()).toContain('canUseAI=true');
  });

  it('canUseAI is false when the server says can_use_ai=false even with the flag on', () => {
    mockFlags = { aiFeaturesEnabled: true };
    mockAccess = access({ can_use_ai: false });
    expect(readProbe()).toContain('canUseAI=false');
  });

  it('canUseAI is false when the aiFeaturesEnabled flag is off even if the server allows it', () => {
    mockFlags = { aiFeaturesEnabled: false };
    mockAccess = access({ can_use_ai: true });
    expect(readProbe()).toContain('canUseAI=false');
  });

  it('hasBYOKAccess is true when a connection exists AND BYOK is enabled (post-connect)', () => {
    mockFlags = { bringYourOwnAIEnabled: true };
    mockAccess = access({ byok: { connections: [{ provider: 'anthropic' }] } });
    expect(readProbe()).toContain('byok=true');
  });

  it('hasBYOKAccess is false when a key is connected but BYOK is remotely disabled', () => {
    mockFlags = { bringYourOwnAIEnabled: false };
    mockAccess = access({ byok: { connections: [{ provider: 'anthropic' }] } });
    expect(readProbe()).toContain('byok=false');
  });
});
