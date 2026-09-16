/**
 * OnboardingScreen — Symply Kaizen (`symply-kaizen`) first-run system picker.
 *
 * Renders the REAL screen through <ThemeProvider>, asserts the brand + system
 * tiles, and drives "Continue" → beginSetupSystems([career]) (the default
 * selection) → beginSetupQueue → router.replace to the first system config.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';


import { IPHONE, IPAD, allText, pressByText } from '../../test-utils/kaizenScreenTestKit';
import { OnboardingScreen } from '../OnboardingScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockBeginSetupQueue = jest.fn();
jest.mock('@features/kaizen/services/setupFlow', () => ({
  __esModule: true,
  beginSetupQueue: (...args: unknown[]) => mockBeginSetupQueue(...args),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const state = {
    beginSetupSystems: jest.fn().mockResolvedValue(undefined),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) =>
    Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <OnboardingScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
});

describe('OnboardingScreen', () => {
  it('renders the brand header, system tiles, and CTA', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Build your system');
    expect(text).toContain('Your life systems');
    expect(text).toContain('Career');
    expect(text).toContain('Continue');
  });

  it('begins system setup with the default Career selection on Continue', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Continue');
    });
    expect(state.beginSetupSystems).toHaveBeenCalledWith(['career']);
    expect(mockBeginSetupQueue).toHaveBeenCalledWith(['career']);
    expect(router.replace).toHaveBeenCalled();
  });

  it('toggles an extra system on and continues with the expanded selection', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Health'));
    await act(async () => {
      pressByText(tree, 'Continue');
    });
    expect(state.beginSetupSystems).toHaveBeenCalledWith(['career', 'health']);
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/kaizen/system-config',
        params: expect.objectContaining({ system: 'career', setup: '1' }),
      }),
    );
  });

  it('deselects the default system and routes to the systems hub when nothing is selected', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Career'));
    await act(async () => {
      pressByText(tree, 'Continue');
    });
    expect(state.beginSetupSystems).toHaveBeenCalledWith([]);
    expect(mockBeginSetupQueue).toHaveBeenCalledWith([]);
    expect(router.replace).toHaveBeenCalledWith('/kaizen-systems');
  });

  it('mounts on iPad-class dimensions with the same content', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Build your system');
  });
});
