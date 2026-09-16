/**
 * BYOK Change-key screen — the dedicated key-rotation flow.
 *
 * Asserts that rotating an already-connected provider's key: dry-run tests
 * without saving, saves the new key as a fresh session lease WITHOUT re-sending
 * consent (already accepted on first connect) and WITHOUT touching the default
 * provider / model, needs no acknowledgement gate, and shows the current key
 * hint. Copy stays brand-neutral (never the hard-coded "SimpleHouse").
 */

// deviceRender drives useDeviceType via a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockInvalidate = jest.fn().mockResolvedValue(undefined);
const mockEntitlement: {
  invalidate: typeof mockInvalidate;
  bringYourOwnAIEnabled: boolean;
  byokConnections: { provider: string; keyHint: string; status: string }[];
} = {
  invalidate: mockInvalidate,
  bringYourOwnAIEnabled: true,
  byokConnections: [{ provider: 'anthropic', keyHint: '…ab12', status: 'active' }],
};
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => mockEntitlement,
}));

const mockTestConnection = jest.fn();
const mockCreateSessionLease = jest.fn().mockResolvedValue({});
jest.mock('@api/aiAccess', () => ({
  __esModule: true,
  aiAccessApi: {
    testConnection: (...args: unknown[]) => mockTestConnection(...args),
    createSessionLease: (...args: unknown[]) => mockCreateSessionLease(...args),
  },
}));

const mockSetKey = jest.fn().mockResolvedValue(undefined);
jest.mock('@services/aiKeyVault', () => ({
  __esModule: true,
  aiKeyVault: { setKey: (...args: unknown[]) => mockSetKey(...args) },
}));

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  __esModule: true,
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: mockBack }),
  useLocalSearchParams: () => ({ provider: 'anthropic' }),
}));

import React from 'react';
import { Linking, TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { brand } from '@brand';

import { renderOnDevice, treeText } from '../../../src/test-utils/deviceRender';
import ChangeKeyScreen from '../change-key';

const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);

beforeEach(() => {
  mockInvalidate.mockClear();
  mockTestConnection.mockReset();
  mockCreateSessionLease.mockClear();
  mockSetKey.mockClear();
  mockShowToast.mockClear();
  mockBack.mockClear();
  openURL.mockClear();
  mockEntitlement.bringYourOwnAIEnabled = true;
  mockEntitlement.byokConnections = [{ provider: 'anthropic', keyHint: '…ab12', status: 'active' }];
});

const saveButton = (r: ReactTestRenderer): ReactTestInstance =>
  r.root.findAllByProps({ testID: 'ai-change-key-save-button' })[0];
const testButton = (r: ReactTestRenderer): ReactTestInstance =>
  r.root.findAllByProps({ testID: 'ai-change-key-test-button' })[0];
const keyInput = (r: ReactTestRenderer): ReactTestInstance =>
  r.root.findAllByType(TextInput)[0];

describe('BYOK ChangeKeyScreen — save (rotate) the key', () => {
  it('shows the current key hint on file', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ChangeKeyScreen />);
    expect(treeText(r)).toContain('…ab12');
  });

  it('keeps Save disabled until a key (≥8 chars) is entered — no acknowledgement gate', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ChangeKeyScreen />);
    expect(saveButton(r).props.disabled).toBe(true);

    act(() => keyInput(r).props.onChangeText('sk-ant-short')); // ≥8 chars
    expect(saveButton(r).props.disabled).toBe(false);
  });

  it('rotates the key: writes the Keychain + a fresh lease WITHOUT consent, preserving default/model', async () => {
    const r = renderOnDevice('iPhone 14 Pro', <ChangeKeyScreen />);
    act(() => keyInput(r).props.onChangeText('  sk-ant-newkey123  '));

    await act(async () => {
      await saveButton(r).props.onPress();
    });

    expect(mockSetKey).toHaveBeenCalledWith('anthropic', 'sk-ant-newkey123');
    // A re-key must NOT re-send consent (would overwrite the recorded first-connect
    // acknowledgement) and must NOT patch the default provider / model.
    expect(mockCreateSessionLease).toHaveBeenCalledWith('anthropic', 'sk-ant-newkey123');
    expect(mockCreateSessionLease).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('success', expect.stringContaining('updated'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('is brand-neutral — shows the active brand name, never hard-coded "SimpleHouse"', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ChangeKeyScreen />);
    const text = treeText(r);
    expect(brand.displayName).toBe('Symply House');
    expect(text).toContain(brand.displayName);
    expect(text).not.toContain('SimpleHouse');
  });
});

describe('BYOK ChangeKeyScreen — test connection', () => {
  it('dry-run probes the pasted key without saving anything', async () => {
    mockTestConnection.mockResolvedValue({ provider: 'anthropic', ok: true, status: 'active', error_code: null });
    const r = renderOnDevice('iPhone 14 Pro', <ChangeKeyScreen />);

    expect(testButton(r).props.disabled).toBe(true);
    act(() => keyInput(r).props.onChangeText('  sk-ant-newkey123  '));
    expect(testButton(r).props.disabled).toBe(false);

    await act(async () => {
      await testButton(r).props.onPress();
    });

    expect(mockTestConnection).toHaveBeenCalledWith('anthropic', 'sk-ant-newkey123');
    // Testing never saves.
    expect(mockSetKey).not.toHaveBeenCalled();
    expect(mockCreateSessionLease).not.toHaveBeenCalled();
    expect(treeText(r)).toContain('this key works');
  });

  it('shows a rejection message when the key is invalid', async () => {
    mockTestConnection.mockResolvedValue({ provider: 'anthropic', ok: false, status: 'invalid', error_code: 'invalid_key' });
    const r = renderOnDevice('iPhone 14 Pro', <ChangeKeyScreen />);
    act(() => keyInput(r).props.onChangeText('sk-ant-boguskey'));

    await act(async () => {
      await testButton(r).props.onPress();
    });

    expect(treeText(r)).toContain('That key was rejected');
  });

  it('opens the provider console to create a fresh key', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ChangeKeyScreen />);
    r.root.findAllByProps({ testID: 'ai-change-key-console-link' })[0].props.onPress();
    expect(openURL).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys');
  });
});
