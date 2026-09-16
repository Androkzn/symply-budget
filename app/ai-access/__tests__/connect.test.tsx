/**
 * BYOK Connect screen — the §17.4 cost/privacy acknowledgement gate.
 *
 * Asserts the Connect button stays disabled until BOTH a key (≥8 chars) is
 * entered AND the disclosure is acknowledged, that connecting posts the key to
 * the credential vault, and that the copy is brand-neutral (uses the active
 * brand's display name, never the hard-coded "SimpleHouse").
 */

// deviceRender drives useDeviceType via a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockPost = jest.fn().mockResolvedValue({});
const mockPatch = jest.fn().mockResolvedValue({});
jest.mock('@api/client', () => ({
  __esModule: true,
  api: {
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

const mockInvalidate = jest.fn().mockResolvedValue(undefined);
// Mutable so individual tests can simulate "other providers already connected".
const mockEntitlement: {
  invalidate: typeof mockInvalidate;
  bringYourOwnAIEnabled: boolean;
  byokConnections: { provider: string }[];
  provider: string | null;
} = {
  invalidate: mockInvalidate,
  bringYourOwnAIEnabled: true,
  byokConnections: [],
  provider: null,
};
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => mockEntitlement,
}));

const mockTestConnection = jest.fn();
jest.mock('@api/aiAccess', () => ({
  __esModule: true,
  aiAccessApi: { testConnection: (...args: unknown[]) => mockTestConnection(...args) },
}));

// Pin the provider param so the header + POST path are deterministic.
jest.mock('expo-router', () => ({
  __esModule: true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ provider: 'anthropic' }),
}));

import React from 'react';
import { Alert, Linking, StyleSheet, TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { brand } from '@brand';

import { renderOnDevice, treeText, pressables } from '../../../src/test-utils/deviceRender';
import ConnectKeyScreen from '../connect';

const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);

beforeEach(() => {
  mockPost.mockClear();
  mockPatch.mockClear();
  mockInvalidate.mockClear();
  mockTestConnection.mockReset();
  openURL.mockClear();
  // Default: no providers connected yet, no current default.
  mockEntitlement.byokConnections = [];
  mockEntitlement.provider = null;
});

const testButton = (r: ReactTestRenderer): ReactTestInstance =>
  r.root.findAllByProps({ testID: 'ai-test-connection-button' })[0];

const checkbox = (r: ReactTestRenderer): ReactTestInstance =>
  pressables(r).find((p) => p.props.accessibilityRole === 'checkbox')!;
const connectButton = (r: ReactTestRenderer): ReactTestInstance =>
  r.root.findAllByProps({ testID: 'ai-connect-button' })[0];
const keyLink = (r: ReactTestRenderer): ReactTestInstance =>
  pressables(r).find((p) => p.props.accessibilityRole === 'link')!;
const keyInput = (r: ReactTestRenderer): ReactTestInstance =>
  r.root.findAllByType(TextInput)[0];

describe('BYOK ConnectKeyScreen — disclosure gate', () => {
  it('keeps Connect disabled until a key is entered AND the terms are acknowledged', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);

    // Nothing entered/acknowledged → disabled.
    expect(connectButton(r).props.disabled).toBe(true);

    // Key alone (no acknowledgement) → still disabled.
    act(() => keyInput(r).props.onChangeText('sk-ant-abcdefgh'));
    expect(connectButton(r).props.disabled).toBe(true);

    // Acknowledge as well → enabled.
    act(() => checkbox(r).props.onPress());
    expect(connectButton(r).props.disabled).toBe(false);

    // Un-acknowledge → disabled again (the gate is live, not one-way).
    act(() => checkbox(r).props.onPress());
    expect(connectButton(r).props.disabled).toBe(true);
  });

  it('acknowledgement alone (no key) does not enable Connect', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    act(() => checkbox(r).props.onPress());
    expect(connectButton(r).props.disabled).toBe(true);
  });

  it('mints a session lease (device-Keychain key) with consent once key + acknowledgement are present', async () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    act(() => keyInput(r).props.onChangeText('  sk-ant-abcdefgh  '));
    act(() => checkbox(r).props.onPress());

    await act(async () => {
      await connectButton(r).props.onPress();
    });

    // Hybrid storage: the durable key goes to the device Keychain; the server
    // only gets a short-lived session lease, carrying the data-sharing consent.
    expect(mockPost).toHaveBeenCalledWith(
      '/ai-credentials/anthropic/session-lease',
      expect.objectContaining({
        api_key: 'sk-ant-abcdefgh',
        consent: expect.objectContaining({ version: expect.any(String) }),
      })
    );
    expect(mockPatch).toHaveBeenCalledWith('/ai-preferences', {
      credential_source: 'byok',
      active_provider: 'anthropic',
    });
    // The connect→refresh contract: invalidating ['ai-access'] is what makes
    // every AIAccessGate-wrapped surface (item-AI, receipt scan, imports, Mira,
    // chat @assistant, …) re-render enabled once a provider is connected.
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('makes the FIRST/only connected provider the default automatically — no prompt', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    act(() => keyInput(r).props.onChangeText('sk-ant-abcdefgh'));
    act(() => checkbox(r).props.onPress());

    await act(async () => {
      await connectButton(r).props.onPress();
    });

    // No other providers → set as default silently, no confirmation dialog.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledWith('/ai-preferences', {
      credential_source: 'byok',
      active_provider: 'anthropic',
    });
    alertSpy.mockRestore();
  });

  it('asks before stealing the default when another provider is already connected', async () => {
    // Gemini is already connected and is the current default.
    mockEntitlement.byokConnections = [{ provider: 'gemini' }];
    mockEntitlement.provider = 'gemini';
    // User declines: keep Gemini as the default.
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => {
        (buttons ?? []).find((b) => b.style === 'cancel')?.onPress?.();
      });

    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    act(() => keyInput(r).props.onChangeText('sk-ant-abcdefgh'));
    act(() => checkbox(r).props.onPress());
    await act(async () => {
      await connectButton(r).props.onPress();
    });

    // The prompt fired, and because the user declined, the default is NOT switched
    // (no active_provider PATCH) — but the key was still connected (session lease).
    expect(alertSpy).toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledWith(
      '/ai-credentials/anthropic/session-lease',
      expect.any(Object)
    );
    expect(mockPatch).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('switches the default to the new provider when the user accepts the prompt', async () => {
    mockEntitlement.byokConnections = [{ provider: 'gemini' }];
    mockEntitlement.provider = 'gemini';
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => {
        // Press the non-cancel (confirm) button.
        (buttons ?? []).find((b) => b.style !== 'cancel')?.onPress?.();
      });

    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    act(() => keyInput(r).props.onChangeText('sk-ant-abcdefgh'));
    act(() => checkbox(r).props.onPress());
    await act(async () => {
      await connectButton(r).props.onPress();
    });

    expect(mockPatch).toHaveBeenCalledWith('/ai-preferences', {
      credential_source: 'byok',
      active_provider: 'anthropic',
    });
    alertSpy.mockRestore();
  });

  it('is brand-neutral — shows the active brand name, never hard-coded "SimpleHouse"', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    const text = treeText(r);
    expect(brand.displayName).toBe('Symply House'); // default test brand
    expect(text).toContain(brand.displayName);
    expect(text).not.toContain('SimpleHouse');
  });
});

describe('BYOK ConnectKeyScreen — test connection', () => {
  it('stays disabled until a plausible key is entered, then dry-run probes it (no acknowledgement needed)', async () => {
    mockTestConnection.mockResolvedValue({ provider: 'anthropic', ok: true, status: 'active', error_code: null });
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);

    // Empty → disabled.
    expect(testButton(r).props.disabled).toBe(true);

    // Key alone (no acknowledgement) is enough to test.
    act(() => keyInput(r).props.onChangeText('  sk-ant-abcdefgh  '));
    expect(testButton(r).props.disabled).toBe(false);

    await act(async () => {
      await testButton(r).props.onPress();
    });

    // Probes the trimmed key without saving (no upsert POST, no preference patch).
    expect(mockTestConnection).toHaveBeenCalledWith('anthropic', 'sk-ant-abcdefgh');
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
    expect(treeText(r)).toContain('this key works');
  });

  it('shows a rejection message when the key is invalid', async () => {
    mockTestConnection.mockResolvedValue({ provider: 'anthropic', ok: false, status: 'invalid', error_code: 'invalid_key' });
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    act(() => keyInput(r).props.onChangeText('sk-ant-boguskey'));

    await act(async () => {
      await testButton(r).props.onPress();
    });

    expect(treeText(r)).toContain('That key was rejected');
  });

  it('surfaces a friendly message — never the raw axios status — when the probe request throws', async () => {
    // A 401/403 from the probe request itself (auth/infra), not a key verdict.
    mockTestConnection.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 401'), {
        response: { status: 401 },
      })
    );
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    act(() => keyInput(r).props.onChangeText('sk-ant-abcdefgh'));

    await act(async () => {
      await testButton(r).props.onPress();
    });

    const text = treeText(r);
    expect(text).not.toContain('status code 401');
    expect(text).toContain("Couldn't verify the key");
  });
});

describe('BYOK ConnectKeyScreen — key visibility + save affordance', () => {
  const visibilityToggle = (r: ReactTestRenderer): ReactTestInstance[] =>
    r.root.findAllByProps({ testID: 'ai-key-visibility-toggle' });

  it('masks the key by default and reveals / re-hides it via the eye toggle', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);

    // No key yet → no reveal affordance.
    expect(visibilityToggle(r)).toHaveLength(0);

    act(() => keyInput(r).props.onChangeText('sk-ant-abcdefgh'));
    expect(keyInput(r).props.secureTextEntry).toBe(true);

    act(() => visibilityToggle(r)[0].props.onPress());
    expect(keyInput(r).props.secureTextEntry).toBe(false);

    act(() => visibilityToggle(r)[0].props.onPress());
    expect(keyInput(r).props.secureTextEntry).toBe(true);
  });

  it('explains why Connect (the save action) is disabled until key + acknowledgement are present', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);

    // No key → hint asks for the key.
    expect(treeText(r)).toContain('Paste your API key above');

    // Key present, not acknowledged → hint points at the box.
    act(() => keyInput(r).props.onChangeText('sk-ant-abcdefgh'));
    expect(treeText(r)).toContain('Tick the box above');

    // Acknowledged → CTA enabled, hint gone.
    act(() => checkbox(r).props.onPress());
    expect(connectButton(r).props.disabled).toBe(false);
    expect(treeText(r)).not.toContain('Tick the box above');
  });
});

describe('BYOK ConnectKeyScreen — provider setup guidance', () => {
  // The provider param is mocked to 'anthropic' for this suite.
  it('shows how-to steps + key format for the selected provider', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    const text = treeText(r);
    // treeText is JSON, so text spanning a {expression} is split — assert on
    // contiguous fragments rather than the concatenated sentence.
    expect(text).toContain('How to get your');
    expect(text).toContain('Anthropic Claude');
    expect(text).toContain('console.anthropic.com');
    expect(text).toContain('sk-ant-'); // key format hint
    expect(text).toContain('does NOT include API access'); // consumer-plan reminder
  });

  it('opens the provider console when the "Open …" link is tapped', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    keyLink(r).props.onPress();
    expect(openURL).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys');
  });

  it('opens an annotated example when a step ⓘ is tapped', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    const exampleButtons = pressables(r).filter(
      (p) =>
        typeof p.props.accessibilityLabel === 'string' &&
        p.props.accessibilityLabel.startsWith('See an example')
    );
    // One ⓘ per step (Anthropic has four).
    expect(exampleButtons).toHaveLength(4);

    // The example modal only mounts its content once opened.
    expect(treeText(r)).not.toContain('Sign in to the Anthropic Console');
    act(() => exampleButtons[0].props.onPress());
    expect(treeText(r)).toContain('Sign in to the Anthropic Console'); // example headline
  });
});

describe('BYOK ConnectKeyScreen — connect failure card', () => {
  // Host views only — the testID also rides on the AIFlowError element itself.
  const errorCard = (r: ReactTestRenderer): ReactTestInstance[] =>
    r.root.findAllByProps({ testID: 'ai-connect-error' }).filter((i) => typeof i.type === 'string');

  const failConnect = async (r: ReactTestRenderer) => {
    act(() => keyInput(r).props.onChangeText('sk-ant-abcdefgh'));
    act(() => checkbox(r).props.onPress());
    await act(async () => {
      await connectButton(r).props.onPress();
    });
  };

  it('renders the failure as an opaque alert card, not bare text over the body', async () => {
    // The footer is an absolutely-positioned overlay whose glass scrim is
    // transparent at its top edge, so the message needs its own solid fill or
    // it floats over the scrolling disclosures.
    mockPost.mockRejectedValueOnce(new Error('network down'));
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);

    expect(errorCard(r)).toHaveLength(0);
    await failConnect(r);

    const card = errorCard(r)[0];
    expect(card).toBeTruthy();
    expect(card.props.accessibilityRole).toBe('alert');
    const fill = StyleSheet.flatten(card.props.style).backgroundColor as string;
    // A solid #RRGGBB, never an rgba()/8-digit tint the body can show through.
    expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
    expect(treeText(r)).toContain("Couldn't connect your key");
  });

  it('maps a 401 to actionable copy instead of the raw axios string', async () => {
    mockPost.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 401'), {
        response: { status: 401 },
      })
    );
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    await failConnect(r);

    const text = treeText(r);
    expect(text).not.toContain('status code 401');
    expect(text).toContain('Your session has expired');
  });

  it('clears the failure once the user edits the key', async () => {
    mockPost.mockRejectedValueOnce(new Error('network down'));
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    await failConnect(r);
    expect(errorCard(r)).toHaveLength(1);

    // Pasting a corrected key must not leave the old verdict under the button.
    act(() => keyInput(r).props.onChangeText('sk-ant-corrected'));
    expect(errorCard(r)).toHaveLength(0);
  });
});
