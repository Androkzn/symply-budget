/**
 * SystemDetailScreen — Symply Kaizen (`symply-kaizen`) single-system detail.
 *
 * Renders the REAL screen through <ThemeProvider> for the Career system (route
 * param) with one daily action, asserts the header + action row, and drives
 * "Pause system" → setSystemActivation.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { IPHONE, allText, pressByText } from '../../test-utils/kaizenScreenTestKit';
import { SystemDetailScreen } from '../SystemDetailScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

let mockParams: Record<string, string> = { system: 'career' };
jest.mock('expo-router', () => ({
  __esModule: true,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
  Link: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

jest.mock('@features/kaizen/upload/KaizenImportUploadSection', () => {
  const R = require('react');
  const { Text, View } = require('react-native');
  return {
    KaizenImportUploadSection: ({ purpose }: { purpose?: string }) =>
      R.createElement(View, null, R.createElement(Text, null, purpose ?? 'upload')),
    importPanelConfig: jest.requireActual('@features/kaizen/upload/KaizenImportUploadSection').importPanelConfig,
  };
});

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const state = {
    dailyCore: [
      { id: 'a1', system: 'career', title: 'Ship one pull request', output_description: 'A merged PR' },
    ],
    setSystemActivation: jest.fn().mockResolvedValue(undefined),
    hydrate: jest.fn().mockResolvedValue(undefined),
    importQuestionsFromText: jest.fn().mockResolvedValue(2),
    analyzeResume: jest.fn().mockResolvedValue({ summary: 'ok' }),
    profile: { system_activation_states: '{}' },
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
        <SystemDetailScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

const DEFAULT_DAILY_CORE = [
  { id: 'a1', system: 'career', title: 'Ship one pull request', output_description: 'A merged PR' },
];

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockParams = { system: 'career' };
  state.dailyCore = DEFAULT_DAILY_CORE.map((a) => ({ ...a }));
  state.profile = { system_activation_states: '{}' };
});

describe('SystemDetailScreen', () => {
  it('renders the system header and its daily action', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Career');
    expect(text).toContain('Daily actions');
    expect(text).toContain('Ship one pull request');
    expect(text).toContain('Files & imports');
    expect(text).toContain('auto');
  });

  it('pauses the active system from "Pause system"', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Pause system');
    });
    expect(state.setSystemActivation).toHaveBeenCalledWith('career', 'paused');
  });

  it('opens the config screen from "Configure tasks"', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Configure tasks'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/kaizen/system-config',
      params: { system: 'career' },
    });
  });

  it('returns to the systems hub from the back link', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Back to systems →'));
    expect(router.push).toHaveBeenCalledWith('/kaizen-systems');
  });

  it('shows a paused system and enables it from "Enable system"', async () => {
    state.profile = { system_activation_states: JSON.stringify({ career: 'paused' }) };
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Paused');
    await act(async () => {
      pressByText(tree, 'Enable system');
    });
    expect(state.setSystemActivation).toHaveBeenCalledWith('career', 'enabled');
  });

  it('falls back to enabled when the activation-states JSON is invalid', async () => {
    state.profile = { system_activation_states: 'not-json' };
    const tree = await renderScreen();
    // The parse throws, status stays "enabled".
    expect(allText(tree.toJSON())).toContain('Active');
  });

  it('renders the empty state and defaults the system when no route param is given', async () => {
    mockParams = {};
    state.dailyCore = [];
    state.profile = null;
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    // Default system param "career".
    expect(text).toContain('Career');
    expect(text).toContain('No actions yet. Configure this system to begin.');
    expect(text).toContain('Active');
  });

  it('falls back to the career icon for an unknown system', async () => {
    mockParams = { system: 'unknown' };
    state.dailyCore = [];
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Unknown');
  });

  it('filters daily actions to the routed system only', async () => {
    mockParams = { system: 'health' };
    state.dailyCore = [
      { id: 'a1', system: 'career', title: 'Ship one pull request', output_description: 'A merged PR' },
      { id: 'a2', system: 'health', title: 'Log your meals', output_description: 'Nutrition logged' },
    ];
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Health');
    expect(text).toContain('Log your meals');
    expect(text).not.toContain('Ship one pull request');
  });

  it('passes the book import purpose for the learning system', async () => {
    mockParams = { system: 'learning' };
    state.dailyCore = [];
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Learning');
    expect(allText(tree.toJSON())).toContain('book');
  });

  it('passes the knowledge import purpose for non-career, non-learning systems', async () => {
    mockParams = { system: 'health' };
    state.dailyCore = [];
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('knowledge');
  });
});
