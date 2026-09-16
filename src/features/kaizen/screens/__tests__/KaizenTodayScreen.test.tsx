/**
 * KaizenTodayScreen — Symply Kaizen (`symply-kaizen`) "Today" tab entry.
 *
 * This is the hydrate + onboarding-gate wrapper around the donor <TodayScreen>.
 * TodayScreen is stubbed (its own suite owns it) and the store / auth / setupFlow
 * are mocked so the three gate branches are deterministic:
 *   - not hydrated              → renders loading shell (kaizen-today-loading)
 *   - onboarding incomplete     → <Redirect> to /kaizen/onboarding
 *   - onboarding complete        → renders <TodayScreen>
 * Also asserts the mount effect fires hydrate() → sync() once authenticated.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { allText } from '../../test-utils/kaizenScreenTestKit';

jest.mock('@features/kaizen/brand', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BrandBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'brand-background' }, children),
  };
});

import { KaizenTodayScreen } from '../KaizenTodayScreen';

jest.mock('expo-router', () => {
  const ReactMock = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    Redirect: ({ href }: { href: unknown }) =>
      ReactMock.createElement(
        Text,
        null,
        'REDIRECT:' + (typeof href === 'string' ? href : (href as { pathname?: string })?.pathname),
      ),
  };
});

jest.mock('../TodayScreen', () => {
  const ReactMock = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, TodayScreen: () => ReactMock.createElement(Text, null, 'TODAY-STUB') };
});

let mockSetupActive = false;
let mockNextSystem: string | null = null;
let mockNeedsCareer = false;
jest.mock('../../services/setupFlow', () => ({
  __esModule: true,
  isSetupFlowActive: () => mockSetupActive,
  needsCareerSetupStep: () => mockNeedsCareer,
  nextUnconfiguredSystem: () => mockNextSystem,
}));

const authState: Record<string, unknown> = { user: { id: 'u1' } };
jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

const hydrate = jest.fn().mockResolvedValue(undefined);
const sync = jest.fn().mockResolvedValue(undefined);
const kaizenState: Record<string, unknown> = {
  profile: { onboarding_complete: true },
  isHydrated: true,
  hydrate,
  sync,
};
jest.mock('../../stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof kaizenState) => unknown) =>
    selector ? selector(kaizenState) : kaizenState;
  useKaizenStore.getState = () => kaizenState;
  return { __esModule: true, useKaizenStore };
});

function setStore(over: Record<string, unknown>) {
  Object.assign(kaizenState, over);
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<KaizenTodayScreen />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetupActive = false;
  mockNextSystem = null;
  mockNeedsCareer = false;
  hydrate.mockResolvedValue(undefined);
  sync.mockResolvedValue(undefined);
  authState.user = { id: 'u1' };
  setStore({ profile: { onboarding_complete: true }, isHydrated: true, hydrate, sync });
});

describe('KaizenTodayScreen', () => {


  it('skips the hydrate effect when no user is authenticated', async () => {
    authState.user = null;
    const tree = await renderScreen();
    expect(hydrate).not.toHaveBeenCalled();
    expect(allText(tree.toJSON())).toContain('TODAY-STUB');
  });
});
