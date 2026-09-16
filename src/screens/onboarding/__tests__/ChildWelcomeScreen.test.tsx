/**
 * ChildWelcomeScreen — Budget/Kaizen/Health single-step onboarding welcome.
 *
 * Drives the real screen's "Get Started" handler (via a stubbed
 * <OnboardingWelcome> that exposes `onGetStarted`) and asserts the accept-terms
 * wiring: success hands off to EssentialPermissions on every brand except
 * Health (which itself completes onboarding once the member has answered/
 * skipped the permission ask — see EssentialPermissionsScreen.test.tsx);
 * Health alone detours through its goals mini-flow first, starting at
 * HealthGoalsBiometrics ("About you" — gender/age/height/activity level,
 * which the later steps' suggestions need) and landing on
 * EssentialPermissions only at the far end of HealthGoalsWater; a 401
 * (expired session) stays silent because the API client already logged the
 * user out and the app routes back to login on its own.
 */
import { AxiosError, AxiosHeaders } from 'axios';
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ChildWelcomeScreen } from '../ChildWelcomeScreen';

const mockAcceptTerms = jest.fn();
jest.mock('@api/auth', () => ({
  __esModule: true,
  authApi: { acceptTerms: () => mockAcceptTerms() },
}));

const mockNavigate = jest.fn();
jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('@brand', () => ({ __esModule: true, brandId: 'symply-budget' }));
jest.mock('@config/brandContent', () => ({
  __esModule: true,
  getWelcomeContent: () => ({ title: 'Welcome', features: [] }),
}));

let mockIsHealthBrand = false;
jest.mock('@features/health', () => ({
  __esModule: true,
  isHealthBrand: () => mockIsHealthBrand,
}));

const mockSetUser = jest.fn();
let mockIsAuthenticated = true;
jest.mock('@stores/authStore', () => {
  const state = { setUser: (...a: unknown[]) => mockSetUser(...a) };
  const useAuthStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useAuthStore.getState = () => ({ isAuthenticated: mockIsAuthenticated });
  return { __esModule: true, useAuthStore };
});

// Expose the screen's onGetStarted so the test can invoke it directly.
let capturedOnGetStarted: (() => void) | undefined;
jest.mock('@components/onboarding', () => ({
  __esModule: true,
  OnboardingWelcome: (props: { onGetStarted: () => void }) => {
    capturedOnGetStarted = props.onGetStarted;
    return null;
  },
}));

jest.spyOn(Alert, 'alert').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

function axios401(): AxiosError {
  const err = new AxiosError('Request failed with status code 401');
  err.response = {
    status: 401,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return err;
}

async function tapGetStarted(): Promise<void> {
  await act(async () => {
    ReactTestRenderer.create(<ChildWelcomeScreen />);
  });
  await act(async () => {
    capturedOnGetStarted?.();
  });
}

describe('ChildWelcomeScreen', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockIsHealthBrand = false;
    mockIsAuthenticated = true;
    capturedOnGetStarted = undefined;
  });

  it('hands off to EssentialPermissions on success', async () => {
    const user = { id: 'u1', email: 'a@b.co' };
    mockAcceptTerms.mockResolvedValue({ user });

    await tapGetStarted();

    expect(mockSetUser).toHaveBeenCalledWith(user);
    expect(mockNavigate).toHaveBeenCalledWith('EssentialPermissions', { onDone: 'complete' });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('detours through the goals mini-flow first, on the Health brand', async () => {
    mockIsHealthBrand = true;
    const user = { id: 'u1', email: 'a@b.co' };
    mockAcceptTerms.mockResolvedValue({ user });

    await tapGetStarted();

    expect(mockSetUser).toHaveBeenCalledWith(user);
    expect(mockNavigate).toHaveBeenCalledWith('HealthGoalsBiometrics', { onDone: 'complete' });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('stays silent on a 401 when the session is actually dead — the app routes back to login', async () => {
    mockIsAuthenticated = false;
    mockAcceptTerms.mockRejectedValue(axios401());

    await tapGetStarted();

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('surfaces a 401 with a generic message when still authenticated — a refresh-and-retry that still 401ed, not a dead session', async () => {
    mockIsAuthenticated = true;
    mockAcceptTerms.mockRejectedValue(axios401());

    await tapGetStarted();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Something went wrong',
      "We couldn't save that. Please check your connection and try again."
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('surfaces a non-401 failure with a generic message, not the raw error text', async () => {
    mockAcceptTerms.mockRejectedValue(new Error('Network Error'));

    await tapGetStarted();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Something went wrong',
      "We couldn't save that. Please check your connection and try again."
    );
  });
});
