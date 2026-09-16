/**
 * SavingsSpendingView — spending list, self-fetching sub-view behaviour.
 *
 * Fetches spending rows + categories on focus (listSpending + listCategories),
 * renders the list with category subtitles, and routes: "Add spending" →
 * SavingsEntryForm (spending mode), a tapped row → SavingsEntryForm with its
 * entryId, and the Monthly-Payments entry point → SavingsRecurringPayments.
 *
 * Stubs `@components/common` (its real barrel transitively pulls the
 * SidebarTabBar → navigator chain that crashes under the mocked navigation),
 * the savings API, and the stores. `mockNavigate` is captured to assert the
 * navigation targets.
 */

// SafeAreaView passthrough so the heavy @components/common barrel never loads.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'spd-new-uuid' }));

// Native date picker → prop-forwarding stub (the CopyEntryModal imports it).
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return (props: Record<string, unknown>) =>
    React.createElement(View, { testID: 'mock-datetimepicker', ...props });
});

jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  return {
    TouchableOpacity: RN.TouchableOpacity,
  };
});

jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({
    children,
    renderRightActions,
  }: {
    children: unknown;
    renderRightActions?: () => React.ReactNode;
  }) => (
    <>
      {children}
      {typeof renderRightActions === 'function' ? renderRightActions() : null}
    </>
  ),
}));

const mockListSpending = jest.fn();
const mockListCategories = jest.fn();
const mockCreateSpending = jest.fn();
const mockDeleteSpending = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    listSpending: (...args: unknown[]) => mockListSpending(...args),
    listCategories: (...args: unknown[]) => mockListCategories(...args),
    createSpending: (...args: unknown[]) => mockCreateSpending(...args),
    deleteSpending: (...args: unknown[]) => mockDeleteSpending(...args),
  },
}));

const mockMarkDirty = jest.fn();
let mockDataRevision = 0;

jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      selectedYear: 2026,
      selectedMonth: 7,
      dataRevision: mockDataRevision,
      markDirty: mockMarkDirty,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = { dataRevision: 0 };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' }, currentHouseholdMembers: [] };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { formatBudgetCurrency } from '../../budgetFormat';
import { SavingsSpendingView } from '../SavingsSpendingView';

function spendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'spd-1',
    household_id: 'hh-test',
    category_id: 'cat-1',
    label: 'Groceries',
    amount_cents: 12000,
    currency: 'CAD',
    spending_date: '2026-07-10',
    notes: null,
    recurring_payment_id: null,
    period: '2026-07',
    created_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function category(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat-1',
    household_id: 'hh-test',
    name: 'Food',
    icon: null,
    color: null,
    is_essential: true,
    sort_order: 0,
    created_at: '',
    ...overrides,
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsSpendingView />
      </ThemeProvider>
    );
  });
  return tree;
}

function allText(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);
}

describe('SavingsSpendingView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDataRevision = 0;
    mockListSpending.mockResolvedValue({ entries: [spendingRow()] });
    mockListCategories.mockResolvedValue({ categories: [category()] });
    mockCreateSpending.mockResolvedValue({ entry: spendingRow({ id: 'spd-copy' }) });
    mockDeleteSpending.mockResolvedValue({});
  });

  it('fetches spending + categories on focus', async () => {
    await renderScreen();
    expect(mockListSpending).toHaveBeenCalledWith('hh-test', 2026, 7);
    expect(mockListCategories).toHaveBeenCalledWith('hh-test');
  });

  it('shows the total spending for the month (sum of all rows)', async () => {
    mockListSpending.mockResolvedValue({
      entries: [
        spendingRow({ id: 'a', amount_cents: 12000 }),
        spendingRow({ id: 'b', amount_cents: 250000 }),
      ],
    });
    const tree = await renderScreen();
    const total = tree.root.findByProps({ testID: 'savings-spending-total' });
    expect(total.props.children).toBe(formatBudgetCurrency(262000));
  });

  it('renders the spending list with fetched rows and category subtitle', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    expect(root.findByProps({ testID: 'savings-spending' })).toBeTruthy();
    // testID propagates to the Touchable's host tree, so match ≥ 1 rather than
    // an exact node count.
    expect(root.findAllByProps({ testID: 'savings-spending-item' }).length).toBeGreaterThan(0);
    const texts = allText(tree);
    expect(texts).toContain('Groceries');
    // Subtitle joins the resolved category name.
    expect(texts.some((t) => t.includes('Food'))).toBe(true);
  });

  it('routes to SavingsEntryForm in spending mode when "Add spending" is pressed', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-add-spending' })[0].props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('SavingsEntryForm', { mode: 'spending' });
  });

  it('routes to SavingsRecurringPayments from the Monthly-Payments entry point', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-monthly-payments' })[0].props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('SavingsRecurringPayments');
  });

  it('routes to SavingsEntryForm with the row entryId when a row is pressed', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-spending-item' })[0].props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('SavingsEntryForm', {
      mode: 'spending',
      entryId: 'spd-1',
    });
  });

  it('shows the empty state when there is no spending', async () => {
    mockListSpending.mockResolvedValue({ entries: [] });
    const tree = await renderScreen();

    expect(tree.root.findAllByProps({ testID: 'savings-spending-item' }).length).toBe(0);
    expect(allText(tree).some((t) => t.includes('No spending recorded'))).toBe(true);
  });

  it('routes to the AI import in spending scope', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-spending-ai-import' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SavingsImport', { scope: 'spending' });
  });

  it('formats a large amount in full (no k) and handles a row with no category', async () => {
    mockListSpending.mockResolvedValue({
      entries: [spendingRow({ amount_cents: 250000, category_id: null })],
    });
    const tree = await renderScreen();
    expect(allText(tree)).toContain('$2,500');
  });

  it('still renders when loading spending fails', async () => {
    mockListSpending.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-spending-item' }).length).toBe(0);
  });

  it('reloads when the savings data revision changes', async () => {
    const tree = await renderScreen();
    const callsAfterMount = mockListSpending.mock.calls.length;

    mockDataRevision = 5;
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <SavingsSpendingView />
        </ThemeProvider>
      );
    });

    expect(mockListSpending.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('copies a spending row to the same date when the copy action confirms unchanged', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-spending-copy' })[0].props.onPress();
    });
    await act(async () => {
      tree.root.findAllByProps({ testID: 'copy-entry-confirm' })[0].props.onPress();
      await Promise.resolve();
    });

    expect(mockCreateSpending).toHaveBeenCalledWith('hh-test', {
      id: 'spd-new-uuid',
      category_id: 'cat-1',
      label: 'Groceries',
      amount_cents: 12000,
      spending_date: '2026-07-10',
      currency: 'CAD',
      notes: null,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('copies a spending row to the next month keeping the same day', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-spending-copy' })[0].props.onPress();
    });
    await act(async () => {
      tree.root.findAllByProps({ testID: 'copy-entry-quick-next-month' })[0].props.onPress();
    });
    await act(async () => {
      tree.root.findAllByProps({ testID: 'copy-entry-confirm' })[0].props.onPress();
      await Promise.resolve();
    });

    expect(mockCreateSpending).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ spending_date: '2026-08-10' })
    );
  });

  it('labels every swipe action so the open row is readable, not icon-only', async () => {
    const tree = await renderScreen();
    for (const [testID, label] of [
      ['savings-spending-edit', 'Edit'],
      ['savings-spending-copy', 'Copy'],
      ['savings-spending-delete', 'Delete'],
    ]) {
      expect(tree.root.findAllByProps({ testID })[0].props.label).toBe(label);
    }
    expect(allText(tree)).toEqual(expect.arrayContaining(['Edit', 'Copy', 'Delete']));
  });

  it('routes the swipe edit action to the entry form for that row', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-spending-edit' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SavingsEntryForm', {
      mode: 'spending',
      entryId: 'spd-1',
    });
  });

  it('deletes a spending row once the destructive alert is confirmed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-spending-delete' })[0].props.onPress();
    });
    const call = alertSpy.mock.calls.find((c) => c[0] === 'Delete spending');
    expect(call?.[1]).toContain('Groceries');

    const buttons = call![2] as unknown as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
    });

    expect(mockDeleteSpending).toHaveBeenCalledWith('hh-test', 'spd-1');
    expect(mockMarkDirty).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('keeps the spending row when the delete alert is cancelled', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-spending-delete' })[0].props.onPress();
    });
    const buttons = alertSpy.mock.calls.find((c) => c[0] === 'Delete spending')![2] as unknown as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Cancel')!.onPress?.();
    });

    expect(mockDeleteSpending).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('alerts when deleting a spending row fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockDeleteSpending.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-spending-delete' })[0].props.onPress();
    });
    const buttons = alertSpy.mock.calls.find((c) => c[0] === 'Delete spending')![2] as unknown as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(alertSpy.mock.calls.some((c) => c[0] === 'Error')).toBe(true);
    alertSpy.mockRestore();
  });

  it('alerts when copying a spending row fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateSpending.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-spending-copy' })[0].props.onPress();
    });
    await act(async () => {
      tree.root.findAllByProps({ testID: 'copy-entry-confirm' })[0].props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(alertSpy.mock.calls.some((c) => c[0] === 'Error')).toBe(true);
    alertSpy.mockRestore();
  });
});
