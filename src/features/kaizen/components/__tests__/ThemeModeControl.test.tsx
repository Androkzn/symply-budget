/**
 * ThemeModeControl — Symply Kaizen (`symply-kaizen`) appearance segmented control.
 *
 * Renders the REAL control over a mocked ThemeContext + appColors, and asserts
 * every pill routes its mode through `setThemeMode`.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { allText, pressByText } from '../../test-utils/kaizenScreenTestKit';

const mockSetThemeMode = jest.fn();
jest.mock('@contexts/ThemeContext', () => ({
  __esModule: true,
  useTheme: () => ({
    setThemeMode: mockSetThemeMode,
    isDark: false,
    theme: { colors: {} },
    toggleTheme: jest.fn(),
  }),
}));

jest.mock('@features/kaizen/theme/appColors', () => ({
  __esModule: true,
  useAppColors: () => ({ pillBackground: '#EEEEEE', textPrimary: '#111111' }),
}));

const { ThemeModeControl } = require('../ThemeModeControl');

function renderControl(): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeModeControl />);
  });
  return tree;
}

beforeEach(() => mockSetThemeMode.mockClear());

describe('ThemeModeControl', () => {
  it('renders all three appearance pills', () => {
    const text = allText(renderControl().toJSON());
    expect(text).toContain('System');
    expect(text).toContain('Light');
    expect(text).toContain('Dark');
  });

  it.each([
    ['System', 'system'],
    ['Light', 'light'],
    ['Dark', 'dark'],
  ])('routes the "%s" pill to setThemeMode("%s")', (label, mode) => {
    const tree = renderControl();
    act(() => pressByText(tree, label));
    expect(mockSetThemeMode).toHaveBeenCalledWith(mode);
  });
});
