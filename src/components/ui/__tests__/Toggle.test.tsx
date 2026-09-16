/**
 * Toggle — the app-standard switch.
 *
 * The regression this file exists for: RN's `Switch` renders `value === true`
 * strictly, so a flag that survived a JSON/SQLite round-trip as `1` reads "on"
 * to every `if (row.flag)` in JS while the switch renders OFF. Monthly Payments
 * showed exactly that — every payment counted in the group subtotals, every
 * toggle off. `Toggle` must coerce, so the switch never disagrees with the
 * truthiness the rest of the screen is reading.
 */
import React from 'react';
import { Switch } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { Toggle, type ToggleProps } from '../Toggle';

function renderToggle(props: ToggleProps): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <Toggle {...props} />
      </ThemeProvider>
    );
  });
  return tree;
}

/** What the underlying RN `Switch` was actually handed. */
function switchValue(tree: ReactTestRenderer.ReactTestRenderer): unknown {
  return tree.root.findByType(Switch).props.value;
}

describe('Toggle', () => {
  it('renders on for a real `true`', () => {
    expect(switchValue(renderToggle({ value: true }))).toBe(true);
  });

  it('renders off for a real `false`', () => {
    expect(switchValue(renderToggle({ value: false }))).toBe(false);
  });

  it('renders off when no value is given', () => {
    expect(switchValue(renderToggle({}))).toBe(false);
  });

  it('renders ON for a truthy non-boolean (SQLite 1) instead of silently off', () => {
    // The bug: `1 === true` is false, so RN's Switch drew this OFF while the
    // row it came from counted as active everywhere else on the screen.
    const legacyRow = { active: 1 } as unknown as { active: boolean };
    expect(switchValue(renderToggle({ value: legacyRow.active }))).toBe(true);
  });

  it('renders off for a falsy non-boolean (SQLite 0)', () => {
    const legacyRow = { active: 0 } as unknown as { active: boolean };
    expect(switchValue(renderToggle({ value: legacyRow.active }))).toBe(false);
  });

  it('still forwards onValueChange, testID and disabled', () => {
    const onValueChange = jest.fn();
    const tree = renderToggle({ value: true, onValueChange, testID: 'tgl', disabled: true });
    const sw = tree.root.findByType(Switch);
    expect(sw.props.testID).toBe('tgl');
    expect(sw.props.disabled).toBe(true);
    act(() => {
      sw.props.onValueChange(false);
    });
    expect(onValueChange).toHaveBeenCalledWith(false);
  });
});
