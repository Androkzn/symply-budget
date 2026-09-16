/**
 * MortgageRecordChangeScreen — logs a dated rate/payment/prepayment change into
 * the change ledger. Verifies the type tabs switch which figure is captured, that
 * Save posts the right AddEventRequest shape per type (and marks the store dirty),
 * and that an empty amount blocks the save. DateField is stubbed (no native picker
 * in jest).
 */
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(View, { testID: 'screen-header', onPress: onBackPress }),
    screenScrollViewStyle: { scroll: {} },
  };
});

jest.mock('../DateField', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    DateField: ({ testID }: { testID?: string }) => React.createElement(View, { testID }),
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { mortgageId: 'm-1' } }),
}));

const mockAddEvent = jest.fn();
jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: { addEvent: (...a: unknown[]) => mockAddEvent(...a) },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-1' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

const mockMarkDirty = jest.fn();
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: (sel?: (s: unknown) => unknown) => {
    const s = { markDirty: mockMarkDirty };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageRecordChangeScreen } from '../MortgageRecordChangeScreen';

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageRecordChangeScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    await Promise.resolve();
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

const setValue = (tree: ReactTestRenderer.ReactTestRenderer, v: string) =>
  tree.root.findAllByProps({ testID: 'mortgage-change-value' })[0].props.onChangeText(v);
const save = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAllByProps({ testID: 'mortgage-change-save' })[0].props.onPress();
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAddEvent.mockResolvedValue({ id: 'e-new' });
});

describe('MortgageRecordChangeScreen', () => {
  it('records a rate change (newRateBps), marks dirty and goes back', async () => {
    const tree = await render();
    await act(async () => {
      setValue(tree, '4.14');
    });
    await act(async () => {
      save(tree);
      await flush();
    });
    expect(mockAddEvent).toHaveBeenCalledWith(
      'hh-1',
      'm-1',
      expect.objectContaining({ eventType: 'rate_change', newRateBps: 414 })
    );
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('switches to Payment and records newPaymentCents', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findAllByProps({ activeTab: 'rate_change' })[0].props.onTabChange('payment_increase');
    });
    await act(async () => {
      setValue(tree, '2875.46');
    });
    await act(async () => {
      save(tree);
      await flush();
    });
    expect(mockAddEvent).toHaveBeenCalledWith(
      'hh-1',
      'm-1',
      expect.objectContaining({ eventType: 'payment_increase', newPaymentCents: 287546 })
    );
  });

  it('records a lump-sum prepayment (amountCents)', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findAllByProps({ activeTab: 'rate_change' })[0].props.onTabChange('lump_sum_prepayment');
    });
    await act(async () => {
      setValue(tree, '10000');
    });
    await act(async () => {
      save(tree);
      await flush();
    });
    expect(mockAddEvent).toHaveBeenCalledWith(
      'hh-1',
      'm-1',
      expect.objectContaining({ eventType: 'lump_sum_prepayment', amountCents: 1_000_000 })
    );
  });

  it('blocks save when the amount is empty', async () => {
    const tree = await render();
    await act(async () => {
      save(tree);
      await flush();
    });
    expect(mockAddEvent).not.toHaveBeenCalled();
    expect(allText(tree.root)).toContain('Enter a valid');
  });
});
