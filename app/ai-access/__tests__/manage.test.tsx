/**
 * AI Providers hub — manage + SWITCH the default provider across all three.
 *
 * Asserts every provider renders (connected or not) with its brand-neutral
 * label; connected rows show status + key hint; the active BYOK provider is
 * marked DEFAULT; the default toggle / Test connection / Disconnect hit the
 * right endpoints; the inline model dropdown saves a per-provider model; a
 * not-connected provider offers Connect; and the copy is brand-neutral (uses
 * the active brand's display name, never "SimpleHouse").
 */

// deviceRender drives useDeviceType via a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockValidate = jest.fn().mockResolvedValue({});
const mockDelete = jest.fn().mockResolvedValue({ success: true });
const mockPatch = jest.fn().mockResolvedValue({});
jest.mock('@api/aiAccess', () => ({
  __esModule: true,
  aiAccessApi: {
    validateConnection: (...args: unknown[]) => mockValidate(...args),
    deleteConnection: (...args: unknown[]) => mockDelete(...args),
    patchPreferences: (...args: unknown[]) => mockPatch(...args),
  },
}));

const mockInvalidate = jest.fn().mockResolvedValue(undefined);
type Conn = {
  provider: string;
  status: string;
  keyHint: string;
  lastValidatedAt: string | null;
  capabilities: string[];
  selectedModelId: string | null;
  leaseExpiresAt: string | null;
};
type Entitlement = {
  byokConnections: Conn[];
  provider: string | null;
  source: 'simplehouse' | 'byok' | null;
  invalidate: () => Promise<void>;
  isLoading: boolean;
  bringYourOwnAIEnabled: boolean;
  providerEnabled: Record<string, boolean>;
};
const ALL_ENABLED = { openai: true, anthropic: true, gemini: true };
const defaultEntitlement = (): Entitlement => ({
  byokConnections: [
    { provider: 'anthropic', status: 'valid', keyHint: '•••• PQAA', lastValidatedAt: '2026-07-01T00:00:00.000Z', capabilities: ['text'], selectedModelId: 'anthropic.claude-fable-5', leaseExpiresAt: null },
    { provider: 'openai', status: 'invalid', keyHint: '•••• 9Z2X', lastValidatedAt: null, capabilities: [], selectedModelId: null, leaseExpiresAt: null },
  ],
  provider: 'anthropic',
  source: 'byok',
  invalidate: mockInvalidate,
  isLoading: false,
  bringYourOwnAIEnabled: true,
  providerEnabled: { ...ALL_ENABLED },
});
const mockEntitlement: Entitlement = defaultEntitlement();
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => mockEntitlement,
}));

// Connection-health banner — default to healthy.
const mockHealth = { isDisconnected: false, activeProvider: null as string | null, reason: null as string | null };
jest.mock('@hooks/useAIConnectionHealth', () => ({
  __esModule: true,
  useAIConnectionHealth: () => mockHealth,
}));

// Per-provider model catalog — anthropic has a couple of models for the DD test.
const ANTHROPIC_MODELS = [
  { id: 'anthropic.claude-fable-5', display_name: 'Claude Fable 5', profile_label: 'quality', capabilities: ['text'], is_default: false, flagship: true },
  { id: 'anthropic.claude-sonnet-5', display_name: 'Claude Sonnet 5', profile_label: 'balanced', capabilities: ['text'], is_default: true, flagship: false },
];
jest.mock('@hooks/useProviderModels', () => ({
  __esModule: true,
  useProviderModels: (provider: string) => ({
    models: provider === 'anthropic' ? ANTHROPIC_MODELS : [],
    isLoading: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@services/toastManager', () => ({
  __esModule: true,
  showToast: jest.fn(),
}));

const mockUsage = {
  currency: 'USD',
  range: { days: 30 },
  provider: null,
  totals: { requests: 12, tokens: 82000, costUsd: 0.42 },
  byFeature: [],
  byModel: [],
  byProvider: [{ provider: 'anthropic', requests: 12, tokens: 82000, costUsd: 0.42 }],
  byDay: [{ date: '2026-07-20', requests: 12, tokens: 82000, costUsd: 0.42 }],
};
jest.mock('@hooks/useAiUsage', () => ({
  __esModule: true,
  useAiUsage: () => ({ householdId: 'h1', usage: mockUsage, isLoading: false, isError: false, refetch: jest.fn() }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  // The screen re-reads the device Keychain on focus (so a key stored by the
  // change-key flow clears the "Key not on this device" warning on return).
  // Off-navigator, focus is "always" — run it like a plain effect.
  useFocusEffect: (cb: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(cb, [cb]),
}));

import React from 'react';
import { Alert } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { brand } from '@brand';

import { renderOnDevice, treeText, pressables } from '../../../src/test-utils/deviceRender';
import ManageProvidersScreen from '../manage';

// Auto-confirm the destructive button so Disconnect reaches the API.
const alertSpy = jest
  .spyOn(Alert, 'alert')
  .mockImplementation((_title, _message, buttons) => {
    const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
    destructive?.onPress?.();
  });

const byLabel = (r: ReactTestRenderer, label: string): ReactTestInstance =>
  pressables(r).find((p) => p.props.accessibilityLabel === label)!;
const byTestID = (r: ReactTestRenderer, id: string): ReactTestInstance =>
  r.root.findAll((n) => n.props?.testID === id)[0];

beforeEach(() => {
  mockValidate.mockClear();
  mockDelete.mockClear();
  mockPatch.mockClear();
  mockInvalidate.mockClear();
  mockPush.mockClear();
  alertSpy.mockClear();
  Object.assign(mockEntitlement, defaultEntitlement());
  Object.assign(mockHealth, { isDisconnected: false, activeProvider: null, reason: null });
});

describe('ManageProvidersScreen — provider list', () => {
  it('renders all three providers with brand-neutral labels', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    const text = treeText(r);
    expect(text).toContain('Anthropic Claude');
    expect(text).toContain('OpenAI');
    expect(text).toContain('Google Gemini');
  });

  it('shows status + validated date for connected providers (no key-hint clutter)', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    const text = treeText(r);
    expect(text).toContain('Valid');
    expect(text).toContain('Invalid');
    expect(text).toContain('Validated');
    expect(text).toContain('Never validated');
    // The masked key hint was removed from the card — it added noise without value.
    expect(text).not.toContain('•••• PQAA');
    expect(text).not.toContain('•••• 9Z2X');
  });

  it('marks the active BYOK provider as DEFAULT', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    expect(treeText(r)).toContain('DEFAULT');
  });

  it('offers Connect for a provider that has no key yet (Gemini)', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    // Gemini is not in byokConnections → its row exposes a Connect action.
    expect(byLabel(r, 'Connect Google Gemini')).toBeTruthy();
  });

  it('is brand-neutral — shows the active brand name, never hard-coded "SimpleHouse"', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    const text = treeText(r);
    expect(brand.displayName).toBe('Symply House'); // default test brand
    expect(text).toContain(brand.displayName);
    expect(text).not.toContain('SimpleHouse');
  });
});

describe('ManageProvidersScreen — actions', () => {
  it('switches the default provider through the preferences endpoint', async () => {
    // openai is connected but not active → toggling it ON activates it.
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    await act(async () => {
      byTestID(r, 'ai-default-toggle-openai').props.onValueChange(true);
    });
    expect(mockPatch).toHaveBeenCalledWith({ credential_source: 'byok', active_provider: 'openai' });
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('saves a per-provider model from the inline dropdown', async () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    // Expand anthropic's model dropdown, then pick Sonnet.
    await act(async () => {
      byTestID(r, 'ai-model-row-anthropic').props.onPress();
    });
    await act(async () => {
      byTestID(r, 'ai-model-option-anthropic-anthropic.claude-sonnet-5').props.onPress();
    });
    expect(mockPatch).toHaveBeenCalledWith({ provider: 'anthropic', selected_model_id: 'anthropic.claude-sonnet-5' });
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('tests the SAVED key through the validate endpoint', async () => {
    // The action was called "Test connection" until it was found to be
    // misleading: it re-validates the key held on the SERVER and says nothing
    // about this device, which keeps its own copy in the Keychain. A member on
    // a fresh install saw a green "connection is working" sitting directly
    // under "Key not on this device", and reasonably read the warning as stale
    // — while `[link-import] no AI provider key on this device` was refusing
    // real work in the same session. The label now names what it tested.
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    await act(async () => {
      byLabel(r, 'Test the saved Anthropic Claude key').props.onPress();
    });
    expect(mockValidate).toHaveBeenCalledWith('anthropic');
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('disconnects a provider (after confirm) through the delete endpoint', async () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    await act(async () => {
      byLabel(r, 'Disconnect OpenAI').props.onPress();
    });
    expect(alertSpy).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('openai');
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('routes to the connect flow when connecting a new provider', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    byLabel(r, 'Connect Google Gemini').props.onPress();
    expect(mockPush).toHaveBeenCalledWith('/ai-access/connect?provider=gemini');
  });

  it('opens the provider detail screen from a connected card', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    byTestID(r, 'ai-provider-detail-row-anthropic').props.onPress();
    expect(mockPush).toHaveBeenCalledWith('/ai-access/provider/anthropic');
  });

  it('shows the reconnect banner when the active provider is disconnected', () => {
    Object.assign(mockHealth, { isDisconnected: true, activeProvider: 'anthropic', reason: 'Key invalid.' });
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    expect(treeText(r)).toContain('disconnected');
    expect(byLabel(r, 'Reconnect Anthropic Claude')).toBeTruthy();
  });
});

describe('ManageProvidersScreen — usage tab', () => {
  it('switches to the Usage tab and shows the estimated total', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ManageProvidersScreen />);
    act(() => {
      byTestID(r, 'filter-tab-usage').props.onPress();
    });
    const text = treeText(r);
    expect(text).toContain('ESTIMATE');
    expect(text).toContain('$0.42');
  });
});
