/**
 * Real AIAccessGate gating — a dedicated suite that BYPASSES the global
 * passthrough stub (jest.setup.js mocks AIAccessGate as a no-op so screen unit
 * tests render with the gate forced open). This is the one suite that verifies
 * the actual contract: children render only when the account can use AI, and the
 * "Unlock AI" CTA shows otherwise. Connecting a BYOK provider flips `canUseAI`
 * (via the shared ['ai-access'] query) which is what makes every gated surface
 * — item-AI, receipt scan, imports, Mira, chat @assistant — light up.
 */
// renderOnDevice drives useDeviceType through a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.unmock('@components/ai/AIAccessGate');
jest.mock('@hooks/useAIEntitlement', () => ({
  __esModule: true,
  useAIEntitlement: jest.fn(),
}));

import React from 'react';
import { Text } from 'react-native';

import { useAIEntitlement } from '@hooks/useAIEntitlement';

import { renderOnDevice, treeText } from '../../../test-utils/deviceRender';
import { AIAccessGate } from '../AIAccessGate';

const mockUseAIEntitlement = useAIEntitlement as unknown as jest.Mock;

const Feature = () => <Text>SECRET AI FEATURE</Text>;

const ENTITLED = {
  canUseAI: true,
  isLoading: false,
  aiFeaturesEnabled: true,
  accountAiStatus: 'entitled' as const,
  denialReason: null,
};

beforeEach(() => {
  mockUseAIEntitlement.mockReturnValue({ ...ENTITLED });
});

describe('AIAccessGate — real gating', () => {
  it('renders the feature when the account can use AI (post-connect state)', () => {
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <AIAccessGate>
        <Feature />
      </AIAccessGate>
    );
    const text = treeText(r);
    expect(text).toContain('SECRET AI FEATURE');
    expect(text).not.toContain('Unlock AI');
  });

  it('hides the feature and shows the Unlock-AI CTA when the account has no AI access', () => {
    mockUseAIEntitlement.mockReturnValue({
      ...ENTITLED,
      canUseAI: false,
      denialReason: 'AI_ACCESS_REQUIRED',
    });
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <AIAccessGate>
        <Feature />
      </AIAccessGate>
    );
    const text = treeText(r);
    expect(text).not.toContain('SECRET AI FEATURE');
    expect(text).toContain('AI access required');
    expect(text).toContain('Unlock AI');
  });

  it('shows the "unavailable" copy when AI features are off entirely', () => {
    mockUseAIEntitlement.mockReturnValue({
      ...ENTITLED,
      canUseAI: false,
      aiFeaturesEnabled: false,
      accountAiStatus: 'off',
    });
    const r = renderOnDevice(
      'iPhone 14 Pro',
      <AIAccessGate>
        <Feature />
      </AIAccessGate>
    );
    const text = treeText(r);
    expect(text).not.toContain('SECRET AI FEATURE');
    expect(text).toContain('AI features are currently unavailable');
  });
});
