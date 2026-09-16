/**
 * WidgetOrderSection — the "which cards, in what order" editor extracted from
 * the inline Customise panels Home and Weight used to carry on their own
 * screens (`health-home-customise-*` / `health-weight-customise-*`). It is
 * now the ONE editor Home, Weight and Activity all point their per-screen
 * widget layout at, reachable from More → Customize Tabs. This suite pins
 * the interaction contract directly against the shared primitive rather than
 * through any one screen that embeds it.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { WidgetOrderSection, type WidgetOrderMeta } from '../WidgetOrderSection';

// A drag-free stand-in that hands the suite the list's `onDragEnd`, so a
// reorder can be simulated directly (same pattern platform.tabCustomization.
// test.tsx and MortgageTabsScreen.test use for this same library).
jest.mock('react-native-draggable-flatlist', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      data,
      renderItem,
      keyExtractor,
      onDragEnd,
    }: {
      data: string[];
      renderItem: (p: unknown) => React.ReactNode;
      keyExtractor: (i: string) => string;
      onDragEnd?: (p: { data: string[] }) => void;
    }) =>
      ReactMock.createElement(
        View,
        { testID: 'widget-order-list', onDragEnd },
        data.map((item) =>
          ReactMock.createElement(
            ReactMock.Fragment,
            { key: keyExtractor(item) },
            renderItem({ item, drag: jest.fn(), isActive: false }),
          ),
        ),
      ),
    ScaleDecorator: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, null, children ?? null),
  };
});

const WIDGETS: WidgetOrderMeta[] = [
  { key: 'alpha', title: 'Alpha', icon: 'heart', description: 'Alpha widget' },
  { key: 'beta', title: 'Beta', icon: 'heart', description: 'Beta widget' },
  { key: 'gamma', title: 'Gamma', icon: 'heart', description: 'Gamma widget' },
];

function find(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAllByProps({ testID })[0];
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  act(() => find(tree, testID).props.onPress());
}

function renderSection(overrides: Partial<React.ComponentProps<typeof WidgetOrderSection>> = {}) {
  const onToggle = jest.fn();
  const onReorder = jest.fn();
  const onSelectAll = jest.fn();
  const onDeselectAll = jest.fn();
  const onReset = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <WidgetOrderSection
          testIDPrefix="widgets"
          title="WIDGETS"
          hint="Pick the cards you want and drag to reorder."
          widgets={WIDGETS}
          order={['alpha']}
          onToggle={onToggle}
          onReorder={onReorder}
          onSelectAll={onSelectAll}
          onDeselectAll={onDeselectAll}
          onReset={onReset}
          {...overrides}
        />
      </ThemeProvider>,
    );
  });
  return { tree, onToggle, onReorder, onSelectAll, onDeselectAll, onReset };
}

describe('WidgetOrderSection', () => {
  it('starts collapsed — the widget rows are not in the tree until expanded', () => {
    const { tree } = renderSection();
    expect(has(tree, 'widgets-alpha')).toBe(false);
    expect(has(tree, 'widgets-beta')).toBe(false);
  });

  it('expanding offers every widget, shown ones checked and hidden ones not', () => {
    const { tree } = renderSection({ order: ['alpha'] });
    press(tree, 'widgets-toggle');

    expect(has(tree, 'widgets-alpha')).toBe(true);
    expect(has(tree, 'widgets-beta')).toBe(true);
    expect(has(tree, 'widgets-gamma')).toBe(true);
    expect(find(tree, 'widgets-toggle-alpha').props.accessibilityState.checked).toBe(true);
    expect(find(tree, 'widgets-toggle-beta').props.accessibilityState.checked).toBe(false);
    expect(find(tree, 'widgets-toggle-gamma').props.accessibilityState.checked).toBe(false);
  });

  it('toggling a hidden widget calls onToggle with its key', () => {
    const { tree, onToggle } = renderSection({ order: ['alpha'] });
    press(tree, 'widgets-toggle');
    press(tree, 'widgets-toggle-beta');
    expect(onToggle).toHaveBeenCalledWith('beta');
  });

  it('Select all is disabled once every widget is already shown', () => {
    const { tree } = renderSection({ order: ['alpha', 'beta', 'gamma'] });
    press(tree, 'widgets-toggle');
    expect(find(tree, 'widgets-select-all').props.disabled).toBe(true);
  });

  it('Deselect all is disabled once only one widget remains shown', () => {
    const { tree } = renderSection({ order: ['alpha'] });
    press(tree, 'widgets-toggle');
    expect(find(tree, 'widgets-deselect-all').props.disabled).toBe(true);
  });

  it('Select all / Deselect all fire their callbacks when enabled', () => {
    const { tree, onSelectAll, onDeselectAll } = renderSection({ order: ['alpha', 'beta'] });
    press(tree, 'widgets-toggle');
    press(tree, 'widgets-select-all');
    press(tree, 'widgets-deselect-all');
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onDeselectAll).toHaveBeenCalledTimes(1);
  });

  it('reset calls onReset', () => {
    const { tree, onReset } = renderSection();
    press(tree, 'widgets-toggle');
    press(tree, 'widgets-reset');
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('a drag settling calls onReorder with only the shown subsequence, hidden widgets filtered out', () => {
    const { tree, onReorder } = renderSection({ order: ['alpha', 'beta'] });
    press(tree, 'widgets-toggle');

    act(() => {
      find(tree, 'widget-order-list').props.onDragEnd({ data: ['gamma', 'beta', 'alpha'] });
    });

    expect(onReorder).toHaveBeenCalledWith(['beta', 'alpha']);
  });
});
