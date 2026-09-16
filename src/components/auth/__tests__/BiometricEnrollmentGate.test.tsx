/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoisted factories and resetModules require synchronous isolated imports. */
/**
 * BiometricEnrollmentGate — one-time Face ID / Touch ID enrollment prompt.
 */
import React from 'react';
import { act } from 'react-test-renderer';
import ReactTestRenderer from 'react-test-renderer';

const mockIsAvailable = jest.fn(async (..._args: unknown[]) => true);

jest.mock('@services/biometric', () => ({
  biometricService: {
    isAvailable: (...a: unknown[]) => mockIsAvailable(...a),
  },
}));

jest.mock('@config/env', () => ({
  ENV: {
    FEATURES: { ENABLE_BIOMETRIC_AUTH: true },
  },
}));

const authState = {
  biometricEnabled: false,
  biometricPromptShown: false,
  refreshToken: 'rt',
  user: { id: 'u1', email: 'user@example.com' },
};

jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    typeof selector === 'function' ? selector(authState) : authState,
}));

jest.mock('@components/auth/BiometricSetupModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BiometricSetupModal: ({ visible }: { visible: boolean }) =>
      visible ? React.createElement(View, { testID: 'biometric-setup-modal' }) : null,
  };
});

import { BiometricEnrollmentGate } from '../BiometricEnrollmentGate';

describe('BiometricEnrollmentGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsAvailable.mockResolvedValue(true);
    authState.biometricEnabled = false;
    authState.biometricPromptShown = false;
    authState.refreshToken = 'rt';
    authState.user = { id: 'u1', email: 'user@example.com' };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the setup modal when eligible and hardware is available', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<BiometricEnrollmentGate />);
    });

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    expect(tree.root.findByProps({ testID: 'biometric-setup-modal' })).toBeTruthy();
  });

  it('stays inert when biometrics are already enabled', async () => {
    authState.biometricEnabled = true;
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<BiometricEnrollmentGate />);
    });

    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
    });

    expect(tree.root.findAllByProps({ testID: 'biometric-setup-modal' })).toHaveLength(0);
  });

  it('stays inert when the prompt was already shown', async () => {
    authState.biometricPromptShown = true;
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<BiometricEnrollmentGate />);
    });

    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
    });

    expect(tree.root.findAllByProps({ testID: 'biometric-setup-modal' })).toHaveLength(0);
  });
});
