/**
 * PLAT-ANALYTICS contract — gating, brand tag, no-op without key, never forked.
 */
import { Platform } from 'react-native';

const mockCapture = jest.fn();
const mockIdentify = jest.fn();
const mockRegister = jest.fn();
const mockReset = jest.fn();
const mockScreen = jest.fn();

jest.mock('posthog-react-native', () => {
  return jest.fn().mockImplementation(() => ({
    capture: mockCapture,
    identify: mockIdentify,
    register: mockRegister,
    reset: mockReset,
    screen: mockScreen,
  }));
});

const mockEnv = {
  POSTHOG_API_KEY: '' as string,
  POSTHOG_HOST: 'https://us.i.posthog.com',
  POSTHOG_DEV: false,
  APP_VERSION: '1.0.0',
  BUILD_NUMBER: '1',
  FEATURES: { ENABLE_ANALYTICS: false },
};

jest.mock('@config/env', () => ({
  ENV: mockEnv,
}));

jest.mock('../../brand', () => ({
  brandId: 'symply-house',
  brand: { integrations: {} },
}));

describe('analytics service (PLAT-ANALYTICS)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockEnv.POSTHOG_API_KEY = '';
    mockEnv.POSTHOG_DEV = false;
    mockEnv.FEATURES.ENABLE_ANALYTICS = false;
  });

  it('PLAT-ANALYTICS-001/007: no-ops without a PostHog key', () => {
    const { initAnalytics, isAnalyticsReady, trackEvent } = require('../analytics');
    initAnalytics();
    expect(isAnalyticsReady()).toBe(false);
    trackEvent('signed_in');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('PLAT-ANALYTICS-002/004: enables when flag or POSTHOG_DEV is set', () => {
    mockEnv.POSTHOG_API_KEY = 'phc_test';
    mockEnv.FEATURES.ENABLE_ANALYTICS = true;
    const PostHog = require('posthog-react-native');
    const { initAnalytics, isAnalyticsReady } = require('../analytics');
    initAnalytics();
    expect(isAnalyticsReady()).toBe(true);
    expect(PostHog).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({ disabled: false })
    );
  });

  it('PLAT-ANALYTICS-003: registers brand super-property', () => {
    mockEnv.POSTHOG_API_KEY = 'phc_test';
    mockEnv.FEATURES.ENABLE_ANALYTICS = true;
    const { initAnalytics } = require('../analytics');
    initAnalytics();
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'symply-house', platform: Platform.OS })
    );
  });

  it('PLAT-ANALYTICS-005: strips undefined props (no sensitive leakage via undefined)', () => {
    mockEnv.POSTHOG_API_KEY = 'phc_test';
    mockEnv.FEATURES.ENABLE_ANALYTICS = true;
    const { initAnalytics, trackEvent } = require('../analytics');
    initAnalytics();
    trackEvent('signed_in', { email: undefined, ok: true });
    expect(mockCapture).toHaveBeenCalledWith(
      'signed_in',
      expect.not.objectContaining({ email: undefined })
    );
    expect(mockCapture.mock.calls.at(-1)[1]).toEqual({ ok: true });
  });

  it('PLAT-ANALYTICS-006: trackScreen forwards screen name', () => {
    mockEnv.POSTHOG_API_KEY = 'phc_test';
    mockEnv.FEATURES.ENABLE_ANALYTICS = true;
    const { initAnalytics, trackScreen } = require('../analytics');
    initAnalytics();
    trackScreen('Home');
    expect(mockScreen).toHaveBeenCalledWith('Home', undefined);
  });

  it('PLAT-ANALYTICS-008: single shared module (not brand-forked)', () => {
    const path = require.resolve('../analytics');
    expect(path).toContain('src/services/analytics');
    expect(path).not.toMatch(/brands\//);
  });
});
