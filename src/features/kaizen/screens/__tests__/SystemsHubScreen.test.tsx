/**
 * SystemsHubScreen — Symply Kaizen (`symply-kaizen`) enabled life-systems list.
 *
 * Renders the REAL screen through <ThemeProvider> with one enabled system parsed
 * from the profile, and drives the "Pause" pill → setSystemActivation.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPHONE,
  IPAD,
  allText,
  hasTestId,
  instanceText,
  pressByText,
  pressablesWithText,
} from '../../test-utils/kaizenScreenTestKit';
import { SystemsHubScreen } from '../SystemsHubScreen';

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

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const state = {
    profile: { enabled_systems: JSON.stringify(['career']), system_activation_states: '{}' },
    setSystemActivation: jest.fn().mockResolvedValue(undefined),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) => Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SystemsHubScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  state.profile = { enabled_systems: JSON.stringify(['career']), system_activation_states: '{}' };
});

describe('SystemsHubScreen', () => {
  it('renders the enabled systems list with the parsed system', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Systems');
    expect(text).toContain('Enabled');
    expect(text).toContain('career');
  });

  it('pauses an enabled system from its "Pause" pill', async () => {
    const tree = await renderScreen();
    // The outer row navigates; the inner pill (whose only text is "Pause") toggles
    // activation. Target the innermost pressable so the toggle handler fires.
    const pill = pressablesWithText(tree, 'Pause').find(
      (p) => instanceText(p).trim() === 'Pause',
    );
    act(() => pill!.props.onPress());
    expect(state.setSystemActivation).toHaveBeenCalledWith('career', 'paused');
  });

  it('navigates to the system detail when the row is pressed', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'career'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/kaizen/system-detail',
      params: { system: 'career' },
    });
  });

  it('renders the empty state when the profile has no systems', async () => {
    state.profile = null;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Choose systems during onboarding to begin.');
  });

  it('shows a paused system and enables it from its "Enable" pill', async () => {
    state.profile = {
      enabled_systems: JSON.stringify(['career']),
      system_activation_states: JSON.stringify({ career: 'paused' }),
    };
    const tree = await renderScreen();
    const enable = pressablesWithText(tree, 'Enable').find(
      (p) => instanceText(p).trim() === 'Enable',
    );
    act(() => enable!.props.onPress());
    expect(state.setSystemActivation).toHaveBeenCalledWith('career', 'enabled');
  });

  it('ignores invalid activation-states JSON', async () => {
    state.profile = { enabled_systems: JSON.stringify(['career']), system_activation_states: 'oops' };
    const tree = await renderScreen();
    // Parse throws → activation states default to {} → system reads as enabled.
    expect(allText(tree.toJSON())).toContain('Pause');
  });

  it('ignores non-object activation-states shapes', async () => {
    // A JSON array and a JSON scalar both fail the object guard without throwing.
    state.profile = { enabled_systems: JSON.stringify(['career']), system_activation_states: '[]' };
    expect(allText((await renderScreen()).toJSON())).toContain('Pause');

    state.profile = { enabled_systems: JSON.stringify(['career']), system_activation_states: '5' };
    expect(allText((await renderScreen()).toJSON())).toContain('Pause');

    state.profile = { enabled_systems: JSON.stringify(['career']), system_activation_states: 'null' };
    expect(allText((await renderScreen()).toJSON())).toContain('Pause');
  });

  it('falls back to the career icon for an unknown enabled system', async () => {
    state.profile = { enabled_systems: JSON.stringify(['mystery']), system_activation_states: '{}' };
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('mystery');
  });

  it('mounts on iPad-class dimensions with the same content', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Enabled');
  });

  it('exposes the systems tab screen test id', async () => {
    const tree = await renderScreen();
    expect(hasTestId(tree, 'kaizen-systems-screen')).toBe(true);
  });

  it('navigates to the correct detail for each enabled system', async () => {
    state.profile = {
      enabled_systems: JSON.stringify(['health', 'learning']),
      system_activation_states: '{}',
    };
    const tree = await renderScreen();
    act(() => pressByText(tree, 'health'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/kaizen/system-detail',
      params: { system: 'health' },
    });
    act(() => pressByText(tree, 'learning'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/kaizen/system-detail',
      params: { system: 'learning' },
    });
  });
});
