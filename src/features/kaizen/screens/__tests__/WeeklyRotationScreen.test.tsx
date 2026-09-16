/**
 * WeeklyRotationScreen — Symply Kaizen (`symply-kaizen`) per-weekday focus.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked store, asserts the
 * seven weekday rows (prefilled from stored rotations), and drives a field edit +
 * blur (→ saveWeeklyRotation).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { IPAD, IPHONE, allText } from '../../test-utils/kaizenScreenTestKit';
import { WeeklyRotationScreen } from '../WeeklyRotationScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

const saveWeeklyRotation = jest.fn();

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <WeeklyRotationScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, {
    rotations: [{ weekday: 1, focus_title: 'Deep work' }],
    saveWeeklyRotation,
  });
});

describe('WeeklyRotationScreen', () => {
  it('renders every weekday row and the prefilled focus', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Weekly rotation');
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((day) =>
      expect(text).toContain(day),
    );
    const monday = tree.root.findAllByType(TextInput)[0];
    expect(monday.props.value).toBe('Deep work');
  });

  it('saves a weekday focus on blur after editing', async () => {
    const tree = await renderScreen();
    const monday = tree.root.findAllByType(TextInput)[0];
    act(() => monday.props.onChangeText('Planning'));
    act(() => monday.props.onBlur());
    expect(saveWeeklyRotation).toHaveBeenCalledWith(1, 'Planning');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Weekly rotation');
  });

  it('starts with empty focus fields when no rotations are stored', async () => {
    Object.assign(mockState, { rotations: [], saveWeeklyRotation });
    const tree = await renderScreen();
    tree.root.findAllByType(TextInput).forEach((input) => {
      expect(input.props.value).toBe('');
    });
  });

  it('persists each weekday focus on blur', async () => {
    Object.assign(mockState, { rotations: [], saveWeeklyRotation });
    const tree = await renderScreen();
    const inputs = tree.root.findAllByType(TextInput);
    const focuses = ['Planning', 'Build', 'Review', 'Ship', 'Reflect', 'Rest', 'Prep'];
    focuses.forEach((focus, index) => {
      act(() => inputs[index].props.onChangeText(focus));
      act(() => inputs[index].props.onBlur());
      expect(saveWeeklyRotation).toHaveBeenCalledWith(index + 1, focus);
    });
    expect(saveWeeklyRotation).toHaveBeenCalledTimes(7);
  });
});
