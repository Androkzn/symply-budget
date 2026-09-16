/**
 * SystemConfigScreen — Symply Kaizen (`symply-kaizen`) per-system task configurator.
 *
 * Renders the REAL screen through <ThemeProvider> for the Career system (route
 * param), asserts the catalog-driven header + custom-action section, and drives
 * "Save system" → materializeSystemTasks. The real SYSTEM_TASK_CATALOG is kept;
 * only the setup-flow router helper is stubbed. The extended suite toggles catalog
 * tasks, adds custom actions, exercises every post-save navigation branch (detail,
 * next-system, career-setup, finish onboarding) and the unknown-system fallback.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { router } from 'expo-router';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { markSystemConfigured } from '@features/kaizen/services/setupFlow';

import {
  IPHONE,
  allText,
  instanceText,
  pressByText,
  typeIn,
} from '../../test-utils/kaizenScreenTestKit';
import { SystemConfigScreen } from '../SystemConfigScreen';

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

jest.mock('@features/kaizen/services/setupFlow', () => ({
  __esModule: true,
  markSystemConfigured: jest.fn(() => ({ kind: 'done' })),
}));

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const A = () => jest.fn().mockResolvedValue(undefined);
  const state = {
    materializeSystemTasks: A(),
    finishOnboarding: A(),
  };
  const useKaizenStore = (sel?: (value: typeof state) => unknown) => (sel ? sel(state) : state);
  useKaizenStore.getState = () => state;
  useKaizenStore.setState = (p: Partial<typeof state> | ((value: typeof state) => Partial<typeof state>)) => Object.assign(state, typeof p === 'function' ? p(state) : p);
  return { __esModule: true, useKaizenStore, __state: state };
});

 
const { __state: state } = require('@features/kaizen/stores/kaizenStore');

const textInputs = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => String(n.type) === 'TextInput');

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SystemConfigScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockParams = { system: 'career' };
  (markSystemConfigured as jest.Mock).mockReturnValue({ kind: 'done' });
  state.materializeSystemTasks.mockResolvedValue(undefined);
  state.finishOnboarding.mockResolvedValue(undefined);
});

describe('SystemConfigScreen', () => {
  it('renders the Career config header and custom-actions section', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Configure Career');
    expect(text).toContain('Custom actions');
  });

  it('materializes the selected catalog tasks on "Save system"', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Save system');
    });
    expect(state.materializeSystemTasks).toHaveBeenCalledWith(
      'career',
      expect.any(Array),
      [],
    );
  });

  it('navigates to the system detail after a non-setup save', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Save system');
    });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/kaizen/system-detail',
      params: { system: 'career' },
    });
  });

  it('toggles catalog tasks on and off before saving', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Learn something')); // non-suggested → select
    act(() => pressByText(tree, 'One skill rep')); // suggested → deselect
    await act(async () => {
      pressByText(tree, 'Save system');
    });
    const selected = state.materializeSystemTasks.mock.calls[0][1] as string[];
    expect(selected).toContain('career.daily.learn');
    expect(selected).not.toContain('career.daily.skillRep');
  });

  it('adds custom actions (explicit + defaulted output) and saves them', async () => {
    const tree = await renderScreen();
    const inputs = textInputs(tree);
    act(() => inputs[0].props.onChangeText('Meditate 10 min'));
    act(() => inputs[1].props.onChangeText('10 minutes logged'));
    act(() => pressByText(tree, 'Add custom action'));
    // Second custom action leaves output blank → falls back to the title.
    act(() => textInputs(tree)[0].props.onChangeText('Cold shower'));
    act(() => pressByText(tree, 'Add custom action'));

    expect(allText(tree.toJSON())).toContain('Meditate 10 min');
    expect(allText(tree.toJSON())).toContain('Cold shower');

    await act(async () => {
      pressByText(tree, 'Save system');
    });
    const custom = state.materializeSystemTasks.mock.calls[0][2] as Array<Record<string, unknown>>;
    expect(custom).toEqual([
      expect.objectContaining({ title: 'Meditate 10 min', outputDescription: '10 minutes logged' }),
      expect.objectContaining({ title: 'Cold shower', outputDescription: 'Cold shower' }),
    ]);
  });

  it('ignores an empty custom action', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Add custom action'));
    await act(async () => {
      pressByText(tree, 'Save system');
    });
    expect(state.materializeSystemTasks).toHaveBeenCalledWith('career', expect.any(Array), []);
  });

  it('defaults an unknown system param to Career', async () => {
    mockParams = { system: 'totally-bogus' };
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Configure Career');
  });

  it('advances to the next system during setup', async () => {
    mockParams = { system: 'career', setup: '1' };
    (markSystemConfigured as jest.Mock).mockReturnValue({ kind: 'next-system', system: 'health' });
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('You will configure each selected system.');
    await act(async () => {
      pressByText(tree, 'Save & continue');
    });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/kaizen/system-config',
      params: { system: 'health', setup: '1' },
    });
  });

  it('routes to career setup when the flow requires it', async () => {
    mockParams = { system: 'career', setup: '1' };
    (markSystemConfigured as jest.Mock).mockReturnValue({ kind: 'career-setup' });
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Save & continue');
    });
    expect(router.replace).toHaveBeenCalledWith('/kaizen/career-setup?setup=1');
  });

  it('finishes onboarding when setup is done', async () => {
    mockParams = { system: 'career', setup: '1' };
    (markSystemConfigured as jest.Mock).mockReturnValue({ kind: 'done' });
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Save & continue');
    });
    expect(state.finishOnboarding).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('renders the Health catalog when the route param is health', async () => {
    mockParams = { system: 'health' };
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Configure Health');
    expect(text).toContain('Hit your sleep window');
    expect(text).toContain('Log your meals');
  });

  it('does not navigate while materializeSystemTasks is still pending', async () => {
    let resolveSave!: () => void;
    state.materializeSystemTasks.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Save system');
    });
    expect(state.materializeSystemTasks).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/kaizen/system-detail',
      params: { system: 'career' },
    });
  });

  it('keeps the add-custom button disabled until a title is typed', async () => {
    const tree = await renderScreen();
    const addButtons = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && instanceText(n).includes('Add custom action'),
    );
    expect(addButtons[0].props.disabled).toBe(true);
    act(() => typeIn(tree, 'Stretch', 0));
    const enabled = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && instanceText(n).includes('Add custom action'),
    );
    expect(enabled[0].props.disabled).toBe(false);
  });
});
