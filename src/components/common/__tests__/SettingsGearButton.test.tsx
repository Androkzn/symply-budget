/**
 * SettingsGearButton — the header gear on every House tab.
 *
 * Two behaviours, and the second is the one that keeps ten call sites to one
 * line each:
 *
 *  1. It opens `/house-settings`, the ROOT route, not `/settings`. `/settings`
 *     is the More tab, which is the overflow-tabs hub now — a member who tapped
 *     a gear and landed there would be looking at a screen without any of the
 *     settings the gear promised. The root route also keeps them on the tab they
 *     were on, which a tab switch would not.
 *  2. It renders NOTHING outside House. The screens that draw it (Home, Tasks,
 *     Chat, Reports, …) are shared with other brands, and full Budget has its
 *     own gear wired to `BudgetSettings`; self-gating is what lets every one of
 *     those call sites stay an unconditional `<SettingsGearButton />`.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

// The Jest brand is House, so the rendering case is the default and only the
// "other brand" case needs a mock. A Proxy rather than `{...actual}` — spreading
// `@brand` reads every lazy getter mid-require-cycle and throws (see
// ProfileScreen.settingsGear.test.tsx).
let mockHouseBrand = true;
jest.mock('@brand', () => {
  const actual = jest.requireActual('@brand');
  return new Proxy(actual, {
    get: (target, prop, receiver) =>
      prop === 'isHouseBrand' ? () => mockHouseBrand : Reflect.get(target, prop, receiver),
  });
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { SettingsGearButton } from '../SettingsGearButton';

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SettingsGearButton />
      </ThemeProvider>,
    );
  });
  return tree;
}

const gear = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.testID === 'header-settings-gear')[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockHouseBrand = true;
});

describe('SettingsGearButton', () => {
  it('GEAR-001: renders on House with an accessible label', () => {
    const tree = render();
    const button = gear(tree);

    expect(button).toBeTruthy();
    expect(button.props.accessibilityLabel).toBe('Settings');
  });

  it('GEAR-002: opens the root settings route, never the More tab', () => {
    const tree = render();
    act(() => gear(tree).props.onPress());

    expect(mockPush).toHaveBeenCalledWith('/house-settings');
    expect(mockPush).not.toHaveBeenCalledWith('/settings');
  });

  it('GEAR-003: renders nothing outside House', () => {
    mockHouseBrand = false;
    const tree = render();

    expect(gear(tree)).toBeUndefined();
  });
});
