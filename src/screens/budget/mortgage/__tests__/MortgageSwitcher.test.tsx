/**
 * MortgageSwitcher — the Mortgage tab's header title, doubled as the property
 * picker (it replaced the header's "+ Add statement" shortcut). Covers the
 * label, the empty fallback, selecting another property, and the add route.
 */
const mockNavigate = jest.fn();
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

let mockSelectedId: string | null = null;
let mockMortgages: Array<Record<string, unknown>> = [];
const mockSetSelected = jest.fn();
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: (sel?: (s: Record<string, unknown>) => unknown) => {
    const s = {
      selectedMortgageId: mockSelectedId,
      mortgages: mockMortgages,
      setSelectedMortgage: mockSetSelected,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageSwitcher } from '../MortgageSwitcher';

const MAIN = {
  id: 'm-1',
  nickname: 'Main home',
  lender: 'RBC',
  productType: 'fixed',
  currentBalanceCents: 48_000_000,
  pctPaid: 0.22,
  nextRenewalDate: null,
  isActive: true,
};
const COTTAGE = { ...MAIN, id: 'm-2', nickname: 'Cottage', lender: null };

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageSwitcher />
      </ThemeProvider>
    );
  });
  return tree;
}

function allText(node: ReactTestRenderer.ReactTestInstance): string {
  return node
    .findAllByType('Text' as never)
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
    .filter((c) => typeof c === 'string')
    .join(' ');
}

async function open(tree: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => {
    tree.root.findByProps({ testID: 'mortgage-switcher-trigger' }).props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectedId = null;
  mockMortgages = [];
});

describe('MortgageSwitcher', () => {
  it('falls back to a plain title before any property exists', async () => {
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'mortgage-switcher-trigger' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'mortgage-switcher-title' }).props.children).toBe(
      'Mortgage'
    );
  });

  it('labels the trigger with the selected property', async () => {
    mockSelectedId = 'm-2';
    mockMortgages = [MAIN, COTTAGE];
    const tree = await render();
    expect(tree.root.findByProps({ testID: 'mortgage-switcher-title' }).props.children).toBe(
      'Cottage'
    );
  });

  it('labels the trigger with the FIRST property when nothing is selected', async () => {
    // Mirrors MortgageView's own fallback, so header and dashboard agree.
    mockSelectedId = null;
    mockMortgages = [MAIN, COTTAGE];
    const tree = await render();
    expect(tree.root.findByProps({ testID: 'mortgage-switcher-title' }).props.children).toBe(
      'Main home'
    );
  });

  it('lists every property with its balance and marks the active one', async () => {
    mockSelectedId = 'm-1';
    mockMortgages = [MAIN, COTTAGE];
    const tree = await render();
    await open(tree);
    const text = allText(tree.root);
    expect(text).toContain('Main home');
    expect(text).toContain('Cottage');
    expect(text).toContain('RBC · $480,000 · 22% paid');
    // No lender on the cottage → the meta line starts at the balance.
    expect(text).toContain('$480,000 · 22% paid');
    expect(
      tree.root.findAllByProps({ testID: 'mortgage-switcher-selected-m-1' }).length
    ).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'mortgage-switcher-selected-m-2' })).toHaveLength(
      0
    );
  });

  it('selects another property and closes', async () => {
    mockSelectedId = 'm-1';
    mockMortgages = [MAIN, COTTAGE];
    const tree = await render();
    await open(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-switcher-row-m-2' }).props.onPress();
    });
    expect(mockSetSelected).toHaveBeenCalledWith('m-2');
    // Sheet dismissed → its rows are gone.
    expect(tree.root.findAllByProps({ testID: 'mortgage-switcher-row-m-2' })).toHaveLength(0);
  });

  it('does not re-select (and so does not reload) the property already shown', async () => {
    mockSelectedId = 'm-1';
    mockMortgages = [MAIN, COTTAGE];
    const tree = await render();
    await open(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-switcher-row-m-1' }).props.onPress();
    });
    expect(mockSetSelected).not.toHaveBeenCalled();
  });

  it('opens the set-up flow from "Add a property"', async () => {
    mockSelectedId = 'm-1';
    mockMortgages = [MAIN];
    const tree = await render();
    await open(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'mortgage-switcher-add' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageSetup');
  });
});
