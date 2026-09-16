/**
 * BudgetAddActionsSheet — the Planning / Spending add actions after they moved
 * out of the inline CTA row and behind the header "+".
 *
 * The contract this suite guards is mostly about IDENTITY: the per-action
 * testIDs are the ones the old row used (`budget-add-planned`,
 * `budget-add-spent`, `budget-scan-receipt`, `budget-add-with-ai`), because two
 * dozen Maestro flows drive them by name. The sheet must also close BEFORE it
 * hands over — every action pushes a screen, and one left behind a live sheet
 * is unreachable.
 */
jest.mock('@components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BottomSheet: ({
      visible,
      title,
      children,
    }: {
      visible?: boolean;
      title?: string;
      children?: React.ReactNode;
    }) =>
      visible
        ? React.createElement(View, { testID: `sheet:${title ?? ''}` }, children ?? null)
        : null,
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetAddActionsSheet } from '../BudgetAddActionsSheet';

type Props = React.ComponentProps<typeof BudgetAddActionsSheet>;

function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    visible: true,
    onClose: jest.fn(),
    variant: 'spent',
    onAddPlanned: jest.fn(),
    onAddSpent: jest.fn(),
    onAddAIPress: jest.fn(),
    onScanReceipt: jest.fn(),
    ...overrides,
  };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetAddActionsSheet {...props} />
      </ThemeProvider>
    );
  });
  return { tree, props };
}

const ids = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAllByProps({ testID: id });

describe('BudgetAddActionsSheet — which actions each tab offers', () => {
  it('offers Add Manually, Scan Receipt and Add with AI on the spent tab', () => {
    const { tree } = render({ variant: 'spent' });
    expect(ids(tree, 'budget-add-spent').length).toBeGreaterThan(0);
    expect(ids(tree, 'budget-scan-receipt').length).toBeGreaterThan(0);
    expect(ids(tree, 'budget-add-with-ai').length).toBeGreaterThan(0);
    expect(ids(tree, 'budget-add-planned')).toHaveLength(0);
  });

  it('offers Add Manually and Add with AI on the planned tab — never Scan Receipt', () => {
    const { tree } = render({ variant: 'planned' });
    expect(ids(tree, 'budget-add-planned').length).toBeGreaterThan(0);
    expect(ids(tree, 'budget-add-with-ai').length).toBeGreaterThan(0);
    expect(ids(tree, 'budget-scan-receipt')).toHaveLength(0);
    expect(ids(tree, 'budget-add-spent')).toHaveLength(0);
  });

  it('omits Scan Receipt when the brand ships no receipt scanning', () => {
    const { tree } = render({ variant: 'spent', onScanReceipt: undefined });
    expect(ids(tree, 'budget-scan-receipt')).toHaveLength(0);
    expect(ids(tree, 'budget-add-spent').length).toBeGreaterThan(0);
  });

  it('renders nothing while closed', () => {
    const { tree } = render({ visible: false });
    expect(tree.toJSON()).toBeNull();
  });

  it('titles itself for the tab that opened it', () => {
    expect(
      ids(render({ variant: 'spent' }).tree, 'sheet:Add a spending').length
    ).toBeGreaterThan(0);
    expect(
      ids(render({ variant: 'planned' }).tree, 'sheet:Add a planned item').length
    ).toBeGreaterThan(0);
  });
});

describe('BudgetAddActionsSheet — each action closes, then hands over', () => {
  it.each([
    ['budget-add-spent', 'onAddSpent'],
    ['budget-scan-receipt', 'onScanReceipt'],
    ['budget-add-with-ai', 'onAddAIPress'],
  ] as const)('%s fires %s', (testID, handler) => {
    const order: string[] = [];
    const onClose = jest.fn(() => order.push('close'));
    const action = jest.fn(() => order.push('action'));
    const { tree } = render({ variant: 'spent', onClose, [handler]: action });

    act(() => tree.root.findByProps({ testID }).props.onPress());

    expect(action).toHaveBeenCalledTimes(1);
    // Close first — otherwise the pushed screen lands behind a live sheet.
    expect(order).toEqual(['close', 'action']);
  });

  it('budget-add-planned fires onAddPlanned on the planned tab', () => {
    const onAddPlanned = jest.fn();
    const { tree } = render({ variant: 'planned', onAddPlanned });
    act(() => tree.root.findByProps({ testID: 'budget-add-planned' }).props.onPress());
    expect(onAddPlanned).toHaveBeenCalledTimes(1);
  });
});
