/**
 * BYOK Connect screen — per-provider data-sharing consent (Apple 5.1.2(i)).
 *
 * Complements connect.test.tsx (which covers the acknowledgement GATE). Here we
 * pin the provider to Gemini to assert the provider-specific disclosure surface:
 * the plain-language "what you share" statement, the provider's official policy
 * links, the Gemini-only free-tier training warning, and the explicit consent
 * label naming the provider. See documents/engineering/ai-provider-consent-legal.md.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('@api/client', () => ({
  __esModule: true,
  api: { post: jest.fn().mockResolvedValue({}), patch: jest.fn().mockResolvedValue({}) },
}));

jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: () => ({ invalidate: jest.fn(), bringYourOwnAIEnabled: true }),
}));

jest.mock('@api/aiAccess', () => ({
  __esModule: true,
  aiAccessApi: { testConnection: jest.fn() },
}));

// Pin the provider to Gemini — the one with the free-tier training warning.
jest.mock('expo-router', () => ({
  __esModule: true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ provider: 'gemini' }),
}));

import React from 'react';
import { Linking } from 'react-native';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import { renderOnDevice, treeText, pressables } from '../../../src/test-utils/deviceRender';
import ConnectKeyScreen from '../connect';

const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);

beforeEach(() => openURL.mockClear());

const findLink = (r: ReactTestRenderer, label: string): ReactTestInstance | undefined =>
  pressables(r).find(
    (p) =>
      p.props.accessibilityRole === 'link' &&
      typeof p.props.accessibilityLabel === 'string' &&
      p.props.accessibilityLabel.includes(label)
  );

describe('BYOK ConnectKeyScreen — per-provider data-sharing consent', () => {
  it('states what is shared and that the app does not store the submitted personal data', () => {
    const text = treeText(renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />));
    expect(text).toContain('What you share with');
    expect(text).toContain('does not store your prompts');
    // Gemini's own summarized data stance.
    expect(text).toContain('not used to improve its products');
  });

  it('renders the Gemini free-tier training warning', () => {
    const text = treeText(renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />));
    expect(text).toContain('free (unpaid)');
    expect(text).toContain('human reviewers may read it');
  });

  it('opens the provider’s official policy pages', () => {
    const r = renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />);
    const termsLink = findLink(r, 'Gemini API Terms');
    expect(termsLink).toBeTruthy();
    termsLink!.props.onPress();
    expect(openURL).toHaveBeenCalledWith('https://ai.google.dev/gemini-api/terms');
  });

  it('names the provider in the explicit consent line', () => {
    const text = treeText(renderOnDevice('iPhone 14 Pro', <ConnectKeyScreen />));
    expect(text).toContain('sent to');
    expect(text).toContain('Google Gemini');
  });
});
