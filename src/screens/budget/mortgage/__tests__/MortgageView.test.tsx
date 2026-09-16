/**
 * MortgageView — resilience of the load path. Regression guard for the bug where
 * a single failed detail fetch (summary/schedule/terms) left the whole view empty
 * with dead actions: `activeId` is now set BEFORE the detail fetches, so the
 * History destination tab still navigates, and a failed load shows a Retry state
 * instead of a blank screen. Nav/focus + stores + api are stubbed; real UI renders
 * under ThemeProvider.
 */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

const mockList = jest.fn();
const mockGetSummary = jest.fn();
const mockGetSchedule = jest.fn();
const mockListTerms = jest.fn();
const mockListStatements = jest.fn();
jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: {
    list: (...a: unknown[]) => mockList(...a),
    getSummary: (...a: unknown[]) => mockGetSummary(...a),
    getSchedule: (...a: unknown[]) => mockGetSchedule(...a),
    listTerms: (...a: unknown[]) => mockListTerms(...a),
    listStatements: (...a: unknown[]) => mockListStatements(...a),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: { id: 'hh-1' } }),
}));

const mockSetSelected = jest.fn();
const mockSetMortgages = jest.fn();
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: () => ({
    selectedMortgageId: null,
    setSelectedMortgage: mockSetSelected,
    setMortgages: mockSetMortgages,
    activeSubTab: 'overview',
    setActiveSubTab: jest.fn(),
    dataRevision: 0,
  }),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageView } from '../MortgageView';

const MORTGAGE = {
  id: 'm-1',
  nickname: 'Main home',
  lender: 'TD',
  productType: 'standard',
  currentBalanceCents: 47_000_000,
  pctPaid: 0.2,
  nextRenewalDate: '2028-06-20',
  isActive: true,
};

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageView />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

function allText(root: ReactTestRenderer.ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const inst = node as ReactTestRenderer.ReactTestInstance;
    if (inst && inst.children) walk(inst.children as unknown);
  };
  walk(root.children as unknown);
  return out.join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSchedule.mockResolvedValue({ scheduleAvailable: true, paymentsElapsed: 0, rows: [] });
  mockListTerms.mockResolvedValue({ terms: [] });
  mockListStatements.mockResolvedValue({ statements: [] });
});

describe('MortgageView load resilience', () => {
  it('keeps the History tab usable + shows Retry when the summary fetch fails', async () => {
    mockList.mockResolvedValue({ mortgages: [MORTGAGE] });
    mockGetSummary.mockRejectedValue(new Error('boom')); // one detail fetch fails

    const tree = await render();

    // The view is NOT blank: it shows an in-content Retry…
    expect(allText(tree.root)).toContain('load the details');

    // …and the History destination tab still navigates (activeId was set before
    // the fetch).
    await act(async () => {
      tree.root.findAllByProps({ testID: 'filter-tab-history' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageHistory', { mortgageId: 'm-1' });
  });

  it('opens the statements list from the Statements tab', async () => {
    mockList.mockResolvedValue({ mortgages: [MORTGAGE] });

    const tree = await render();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'filter-tab-statements' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageStatements', { mortgageId: 'm-1' });
  });

  it('shows a top-level Retry when the list call itself fails', async () => {
    mockList.mockRejectedValue(new Error('offline'));

    const tree = await render();
    expect(allText(tree.root)).toContain('load your mortgage');
  });

  it('publishes the property list for the header switcher', async () => {
    // The header's title dropdown renders outside this view — it reads the list
    // from the store instead of issuing a second list() call.
    mockList.mockResolvedValue({ mortgages: [MORTGAGE] });

    await render();
    expect(mockSetMortgages).toHaveBeenCalledWith([MORTGAGE]);
  });

  it('empties the published list when the last property is deleted', async () => {
    mockList.mockResolvedValue({ mortgages: [] });

    await render();
    expect(mockSetMortgages).toHaveBeenCalledWith([]);
  });
});
