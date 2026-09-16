import { LifeSystem } from '@features/kaizen/constants';

jest.mock('expo-linking', () => ({
  parse: (url: string) => {
    try {
      const parsed = new URL(url.replace('kaizen://', 'https://kaizen.test/'));
      return {
        hostname: parsed.hostname || parsed.pathname.split('/')[0] || '',
        path: parsed.pathname,
        queryParams: Object.fromEntries(parsed.searchParams.entries()),
      };
    } catch {
      return { hostname: '', path: '', queryParams: {} };
    }
  },
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockHydrate = jest.fn().mockResolvedValue(undefined);
const mockSetOnboardingComplete = jest.fn().mockResolvedValue(undefined);
const mockFinishOnboarding = jest.fn().mockResolvedValue(undefined);
const mockSaveCareerSetup = jest.fn().mockResolvedValue(undefined);

const mockStoreState = {
  profile: { user_id: 'user-1', onboarding_complete: 0 } as {
    user_id: string;
    onboarding_complete: number;
  } | null,
  hydrate: mockHydrate,
  setOnboardingComplete: mockSetOnboardingComplete,
  finishOnboarding: mockFinishOnboarding,
  saveCareerSetup: mockSaveCareerSetup,
};

mockHydrate.mockImplementation(async () => {
  mockStoreState.profile = {
    user_id: 'user-1',
    onboarding_complete: mockStoreState.profile?.onboarding_complete ?? 0,
  };
});
mockFinishOnboarding.mockImplementation(async () => {
  if (mockStoreState.profile) mockStoreState.profile.onboarding_complete = 1;
});

jest.mock('@brand', () => ({
  hasBrandCapability: jest.fn((capability: string) => capability === 'kaizenApi'),
}));

jest.mock('@features/kaizen', () => ({
  isKaizenBrand: jest.fn(() => true),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => ({
  useKaizenStore: {
    getState: () => mockStoreState,
  },
}));

const mockIsAuthenticated = jest.fn(() => true);
jest.mock('@stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ isAuthenticated: mockIsAuthenticated() }),
  },
}));

import {
  __resetE2EKaizenSetupStateForTests,
  applyE2EKaizenSetup,
  buildE2ESetupUrl,
  flushPendingE2EKaizenSetup,
  hasPendingE2EKaizenSetup,
  tryQueueE2ESetupFromUrl,
} from '../e2e-kaizen-setup';

describe('e2e-kaizen-setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetE2EKaizenSetupStateForTests();
    mockIsAuthenticated.mockReturnValue(true);
  });

  it('builds the kaizen setup deep link', () => {
    expect(buildE2ESetupUrl()).toBe('kaizen://e2e-setup');
  });

  it('queues setup from the e2e-setup URL and flushes when authenticated', async () => {
    expect(tryQueueE2ESetupFromUrl('kaizen://e2e-setup')).toBe(true);
    expect(hasPendingE2EKaizenSetup()).toBe(true);

    await flushPendingE2EKaizenSetup();

    expect(mockSetOnboardingComplete).toHaveBeenCalledWith([LifeSystem.Career]);
    expect(mockFinishOnboarding).toHaveBeenCalled();
    expect(mockSaveCareerSetup).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'complete' }),
    );
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(hasPendingE2EKaizenSetup()).toBe(false);
  });

  it('defers apply until the user is signed in', async () => {
    mockIsAuthenticated.mockReturnValue(false);
    await applyE2EKaizenSetup();
    expect(mockHydrate).not.toHaveBeenCalled();
    expect(hasPendingE2EKaizenSetup()).toBe(true);
  });

  it('rejects non-setup URLs', () => {
    expect(tryQueueE2ESetupFromUrl('kaizen://today')).toBe(false);
    expect(hasPendingE2EKaizenSetup()).toBe(false);
  });
});
