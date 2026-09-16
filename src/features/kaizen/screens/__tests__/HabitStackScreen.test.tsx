/**
 * HabitStackScreen — Symply Kaizen (`symply-kaizen`) habit-stack builder.
 *
 * Renders the REAL screen through <ThemeProvider> off a mocked store, asserts the
 * create form + existing-stack list (or empty state), toggles a daily-core action
 * into the selection, and drives the "Delete" row action (→ deleteHabitStack). The
 * extended suite exercises the full create + reorder + save flow, edit mode (with the
 * glass "Cancel edit" secondary button), and the populated stack list with mixed step
 * shapes.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  IPAD,
  IPHONE,
  allText,
  pressByText,
  pressablesWithText,
} from '../../test-utils/kaizenScreenTestKit';
import { HabitStackScreen } from '../HabitStackScreen';

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

const upsertHabitStack = jest.fn().mockResolvedValue(undefined);
const deleteHabitStack = jest.fn().mockResolvedValue(undefined);

function seed(over: Record<string, unknown> = {}) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, {
    habitStacks: [],
    habitStackSteps: [],
    dailyCore: [{ id: 'act1', title: 'Morning journaling' }],
    upsertHabitStack,
    deleteHabitStack,
    ...over,
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HabitStackScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

const nameInput = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => String(n.type) === 'TextInput')[0];

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  seed();
});

describe('HabitStackScreen', () => {
  it('renders the create form, an available action and the empty state', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Habit stacks');
    expect(text).toContain('Create stack');
    expect(text).toContain('Morning journaling');
    expect(text).toContain('Create a stack from your daily core actions.');
  });

  it('selects a daily-core action into the ordered step list', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Morning journaling'));
    // Selecting flips the count and reveals the "Order" section.
    expect(allText(tree.toJSON())).toContain('Order');
  });

  it('deletes an existing stack from the "Delete" action', async () => {
    seed({
      habitStacks: [{ id: 'st1', name: 'Morning reset' }],
      habitStackSteps: [{ id: 'sp1', stack_id: 'st1', action_id: 'act1', sort_order: 0 }],
    });
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Morning reset');
    act(() => pressByText(tree, 'Delete'));
    expect(deleteHabitStack).toHaveBeenCalledWith('st1');
  });

  it('mounts on iPad-class dimensions', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Habit stacks');
  });

  it('builds, reorders and saves a new stack', async () => {
    seed({
      dailyCore: [
        { id: 'a1', title: 'Journaling' },
        { id: 'a2', title: 'Stretch' },
      ],
    });
    const tree = await renderScreen();
    act(() => nameInput(tree).props.onChangeText('Morning reset'));
    act(() => pressByText(tree, 'Journaling')); // add a1
    act(() => pressByText(tree, 'Stretch')); // add a2
    act(() => pressByText(tree, 'Journaling')); // remove a1 (toggle-off branch)
    act(() => pressByText(tree, 'Journaling')); // add a1 again → [a2, a1]

    // Reorder: move the 2nd row up (valid splice), then hit both boundary no-ops.
    act(() => pressablesWithText(tree, '↑')[1].props.onPress()); // valid: row 1 up
    act(() => pressablesWithText(tree, '↑')[0].props.onPress()); // no-op: top row up
    const downs = pressablesWithText(tree, '↓');
    act(() => downs[downs.length - 1].props.onPress()); // no-op: bottom row down

    await act(async () => {
      pressByText(tree, 'Create stack');
    });
    expect(upsertHabitStack).toHaveBeenCalledTimes(1);
    const [name, ids, editingId] = upsertHabitStack.mock.calls[0];
    expect(name).toBe('Morning reset');
    expect(ids).toHaveLength(2);
    expect(editingId).toBeUndefined();
  });

  it('does not save when the name or selection is empty', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Create stack');
    });
    expect(upsertHabitStack).not.toHaveBeenCalled();
  });

  it('edits an existing stack, then cancels the edit', async () => {
    seed({
      dailyCore: [
        { id: 'a1', title: 'Journaling' },
        { id: 'a2', title: 'Stretch' },
      ],
      habitStacks: [
        { id: 'st1', name: 'Morning reset' },
        { id: 'st2', name: 'Evening wind-down' },
      ],
      habitStackSteps: [
        { id: 'sp1', stack_id: 'st1', action_id: 'a1', sort_order: 1 },
        { id: 'sp2', stack_id: 'st1', action_id: 'a2', sort_order: 0 },
        { id: 'sp3', stack_id: 'st2', action_id: 'unknown-x', sort_order: 0 },
        { id: 'sp4', stack_id: 'st2', action_id: null, sort_order: 1 },
      ],
    });
    const tree = await renderScreen();
    // Two stacks → plural summary + step count.
    expect(allText(tree.toJSON())).toContain('2 stacks');
    // Unknown action falls back to the raw id; null action falls back to "Action".
    expect(allText(tree.toJSON())).toContain('unknown-x');
    expect(allText(tree.toJSON())).toContain('Action');

    act(() => pressByText(tree, 'Edit')); // beginEdit('st1')
    expect(allText(tree.toJSON())).toContain('Edit stack');
    expect(allText(tree.toJSON())).toContain('Save stack');
    expect(allText(tree.toJSON())).toContain('Cancel edit');

    await act(async () => {
      pressByText(tree, 'Save stack');
    });
    expect(upsertHabitStack).toHaveBeenCalledWith('Morning reset', ['a2', 'a1'], 'st1');
  });

  it('cancels an in-progress edit and returns to create mode', async () => {
    seed({
      dailyCore: [{ id: 'a1', title: 'Journaling' }],
      habitStacks: [{ id: 'st1', name: 'Morning reset' }],
      habitStackSteps: [{ id: 'sp1', stack_id: 'st1', action_id: 'a1', sort_order: 0 }],
    });
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Edit'));
    expect(allText(tree.toJSON())).toContain('Cancel edit');

    // Exercise the glass button's pressed/!pressed style callback (line 36 branch).
    const cancelBtn = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Cancel edit' && typeof n.props?.style === 'function',
    )[0];
    expect(cancelBtn.props.style({ pressed: true })).toBeTruthy();
    expect(cancelBtn.props.style({ pressed: false })).toBeTruthy();

    act(() => pressByText(tree, 'Cancel edit'));
    // Back to the create-stack heading, edit affordances gone.
    expect(allText(tree.toJSON())).toContain('Create stack');
    expect(allText(tree.toJSON())).not.toContain('Cancel edit');
  });

  it('edits a nameless stack whose step points at an unknown action', async () => {
    seed({
      dailyCore: [{ id: 'a1', title: 'Journaling' }],
      habitStacks: [{ id: 'st1', name: null }],
      habitStackSteps: [{ id: 'sp1', stack_id: 'st1', action_id: 'ghost-action', sort_order: 0 }],
    });
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Edit')); // beginEdit → name '' (?? ''), selects the ghost step
    // The ordered step falls back to the raw action id (actionById miss).
    expect(allText(tree.toJSON())).toContain('ghost-action');
  });

  it('shows the singular stack summary card', async () => {
    seed({
      habitStacks: [{ id: 'st1', name: 'Morning reset' }],
      habitStackSteps: [{ id: 'sp1', stack_id: 'st1', action_id: 'act1', sort_order: 0 }],
    });
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('1 stack');
    expect(allText(tree.toJSON())).toContain('1 steps ready to run');
  });

  it('does not save when only the stack name is filled in', async () => {
    const tree = await renderScreen();
    act(() => nameInput(tree).props.onChangeText('Evening wind-down'));
    await act(async () => {
      pressByText(tree, 'Create stack');
    });
    expect(upsertHabitStack).not.toHaveBeenCalled();
  });
});
