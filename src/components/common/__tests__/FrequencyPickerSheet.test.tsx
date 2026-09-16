/**
 * FrequencyPickerSheet — the shared "remind me again..." picker for the
 * recurring-reminders system. Verifies every option renders, the current
 * selection is marked, and picking an option reports it and closes the sheet.
 */

// Render the sheet body inline (BottomSheet is a Modal/portal in the real app).
jest.mock('@components/ui', () => {
  const actual = jest.requireActual('@components/ui');
  return {
    ...actual,
    BottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? children : null,
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { FrequencyPickerSheet } from '../FrequencyPickerSheet';

const OPTIONS = [
  { id: 'evening_today' as const, label: 'Later today', description: 'Nudge again this evening' },
  { id: 'tomorrow_morning' as const, label: 'Tomorrow morning', description: 'Nudge again tomorrow morning' },
  { id: 'every_3_days' as const, label: 'Every few days', description: 'Nudge again in 3 days' },
  { id: 'weekly' as const, label: 'Weekly', description: 'Nudge again in a week' },
];

function render(extra?: Partial<React.ComponentProps<typeof FrequencyPickerSheet>>) {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <FrequencyPickerSheet visible options={OPTIONS} onSelect={onSelect} onClose={onClose} {...extra} />
      </ThemeProvider>
    );
  });
  return { tree, onSelect, onClose };
}

describe('FrequencyPickerSheet', () => {
  it('renders nothing when not visible', () => {
    const { tree } = render({ visible: false });
    expect(tree.root.findAllByProps({ testID: 'frequency-option-weekly' })).toHaveLength(0);
  });

  it('renders every option', () => {
    const { tree } = render();
    for (const option of OPTIONS) {
      expect(tree.root.findAllByProps({ testID: `frequency-option-${option.id}` }).length).toBeGreaterThan(0);
    }
  });

  it('selecting an option reports it and closes the sheet', () => {
    const { tree, onSelect, onClose } = render();
    act(() => tree.root.findByProps({ testID: 'frequency-option-weekly' }).props.onPress());
    expect(onSelect).toHaveBeenCalledWith('weekly');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks the currently-selected option', () => {
    const { tree } = render({ selectedId: 'every_3_days' });
    const selected = tree.root.findByProps({ testID: 'frequency-option-every_3_days' });
    expect(selected.findAllByType(require('@components/ui/Icon').Icon).length).toBeGreaterThan(0);
    const unselected = tree.root.findByProps({ testID: 'frequency-option-weekly' });
    expect(unselected.findAllByType(require('@components/ui/Icon').Icon).length).toBe(0);
  });
});
