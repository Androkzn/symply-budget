/**
 * DeepWorkScreen — Symply Kaizen (`symply-kaizen`) focus-block planner.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked store + a mocked
 * focusMode service, asserts the focus hero + add-block form, drives the
 * "Open Focus settings" action (→ openSystemFocusSettings) and adding a block
 * (topic typed → addDeepWorkBlock).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Switch, TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPAD,
  IPHONE,
  allText,
  flushMicrotasks,
  instanceText,
  pressByText,
  mockHandledRejection,
} from '../../test-utils/kaizenScreenTestKit';
import { DeepWorkScreen } from '../DeepWorkScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@components/common', () =>
  require('../../test-utils/mockComponentsCommon').createKaizenComponentsCommonMock(),
);

const mockOpenFocus = jest.fn().mockResolvedValue(true);
jest.mock('@features/kaizen/services/focusMode', () => ({
  __esModule: true,
  focusModeHint: () => 'Focus Mode helps you stay on task.',
  openSystemFocusSettings: () => mockOpenFocus(),
}));

const mockState: Record<string, unknown> = {};
jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

const addDeepWorkBlock = jest.fn().mockResolvedValue(undefined);

function seed(deepWork: unknown[]) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, { deepWork, addDeepWorkBlock });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <DeepWorkScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  seed([]);
});

describe('DeepWorkScreen', () => {
  it('renders the focus hero and add-block form', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Deep work');
    expect(text).toContain('Focus today');
    expect(text).toContain('Add a block');
    expect(text).toContain('No deep work blocks yet.');
  });

  it('opens system focus settings from the secondary action', async () => {
    const tree = await renderScreen();
    // Exercise the pressed-state style callback (both the pressed and idle branches).
    const styled = tree.root.findAll(
      (n) => typeof n.props?.style === 'function' && instanceText(n).includes('Open Focus settings'),
    );
    expect(styled.length).toBeGreaterThan(0);
    act(() =>
      styled.forEach((n) => {
        n.props.style({ pressed: true });
        n.props.style({ pressed: false });
      }),
    );
    await act(async () => {
      pressByText(tree, 'Open Focus settings');
    });
    expect(mockOpenFocus).toHaveBeenCalled();
  });

  it('adds a deep-work block after typing a topic', async () => {
    const tree = await renderScreen();
    const topic = tree.root.findAllByType(TextInput)[0];
    act(() => topic.props.onChangeText('Write the design doc'));
    await act(async () => {
      pressByText(tree, 'Add block');
    });
    expect(addDeepWorkBlock).toHaveBeenCalled();
    expect(addDeepWorkBlock.mock.calls[0][0]).toBe('Write the design doc');
  });

  it('renders today’s blocks and the at-limit pill', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seed([
      {
        id: 'b1',
        date: today,
        topic: 'Design doc',
        start_time: '09:00',
        end_time: '10:00',
        suggest_focus_mode: true,
      },
      // Null topic + no times + no focus suggestion exercises the fallback branches.
      { id: 'b2', date: today, topic: null, suggest_focus_mode: false },
      // A block from another day is filtered out of today’s list.
      { id: 'b0', date: '2000-01-01', topic: 'Old block', suggest_focus_mode: false },
    ]);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('two-block limit');
    expect(text).toContain('Deep work booked for today');
    expect(text).toContain('Design doc');
    expect(text).toContain('09:00 – 10:00');
    expect(text).toContain('Focus suggested');
    expect(text).toContain('Focus block'); // b2 null topic fallback
    expect(text).toContain('Unscheduled'); // b2 no times fallback
    expect(text).not.toContain('Old block');
  });

  it('does not add a block once the two-block limit is reached', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seed([
      { id: 'b1', date: today, topic: 'One', suggest_focus_mode: false },
      { id: 'b2', date: today, topic: 'Two', suggest_focus_mode: false },
    ]);
    const tree = await renderScreen();
    const topic = tree.root.findAllByType(TextInput)[0];
    act(() => topic.props.onChangeText('Third block'));
    await act(async () => {
      pressByText(tree, 'Add block');
    });
    expect(addDeepWorkBlock).not.toHaveBeenCalled();
  });

  it('does not add a block when the topic is empty', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Add block');
    });
    expect(addDeepWorkBlock).not.toHaveBeenCalled();
  });

  it('adds a scheduled block and skips Focus settings when suggestion is off', async () => {
    const tree = await renderScreen();
    const inputs = tree.root.findAllByType(TextInput);
    act(() => {
      inputs[0].props.onChangeText('Write the RFC');
      inputs[1].props.onChangeText('09:00');
      inputs[2].props.onChangeText('10:30');
    });
    act(() => tree.root.findAllByType(Switch)[0].props.onValueChange(false));
    await act(async () => {
      pressByText(tree, 'Add block');
    });
    expect(addDeepWorkBlock).toHaveBeenCalledWith('Write the RFC', '09:00', '10:30', false);
    // Focus suggestion disabled → the auto-open of system Focus settings is skipped.
    expect(mockOpenFocus).not.toHaveBeenCalled();
  });

  it('opens Focus settings after adding a block when suggestion is on', async () => {
    const tree = await renderScreen();
    const topic = tree.root.findAllByType(TextInput)[0];
    act(() => topic.props.onChangeText('Deep focus session'));
    await act(async () => {
      pressByText(tree, 'Add block');
    });
    expect(addDeepWorkBlock).toHaveBeenCalledWith('Deep focus session', undefined, undefined, true);
    expect(mockOpenFocus).toHaveBeenCalled();
  });

  it('clears the form fields after a successful add', async () => {
    const tree = await renderScreen();
    const inputs = tree.root.findAllByType(TextInput);
    act(() => {
      inputs[0].props.onChangeText('Ship feature');
      inputs[1].props.onChangeText('14:00');
      inputs[2].props.onChangeText('15:00');
    });
    await act(async () => {
      pressByText(tree, 'Add block');
    });
    const after = tree.root.findAllByType(TextInput);
    expect(after[0].props.value).toBe('');
    expect(after[1].props.value).toBe('');
    expect(after[2].props.value).toBe('');
  });

  it('keeps the topic when addDeepWorkBlock rejects', async () => {
    mockHandledRejection(addDeepWorkBlock);
    const tree = await renderScreen();
    const topic = tree.root.findAllByType(TextInput)[0];
    act(() => topic.props.onChangeText('Retry block'));
    await act(async () => {
      pressByText(tree, 'Add block');
      await flushMicrotasks();
    });
    expect(addDeepWorkBlock).toHaveBeenCalled();
    expect(topic.props.value).toBe('Retry block');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Deep work');
  });
});
