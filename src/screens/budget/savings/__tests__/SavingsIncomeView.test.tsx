/**
 * SavingsIncomeView — income list, self-fetching sub-view behaviour.
 *
 * Fetches income rows on focus (listIncome), renders the list, and routes
 * to the shared SavingsEntryForm in `income` mode for both the "Add income"
 * CTA (no entryId) and a tapped row (with entryId).
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

// `hasBrandIcon` reads src/brand/icons.generated.ts, which is rewritten by every
// per-brand `icons:build`. Pinning it true keeps this suite asserting the real
// contract — the view forwards the kit's answer into `active` — instead of
// silently depending on whichever brand kit the working tree was last built for.
jest.mock('@components/ui/Icon', () => ({
  ...jest.requireActual('@components/ui/Icon'),
  hasBrandIcon: () => true,
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'inc-new-uuid' }));

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

const mockListIncome = jest.fn();
const mockCreateIncome = jest.fn();
const mockDeleteIncome = jest.fn();
const mockConfirmIncome = jest.fn();
const mockConfirmAllDraftIncome = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    listIncome: (...args: unknown[]) => mockListIncome(...args),
    createIncome: (...args: unknown[]) => mockCreateIncome(...args),
    deleteIncome: (...args: unknown[]) => mockDeleteIncome(...args),
    confirmIncome: (...args: unknown[]) => mockConfirmIncome(...args),
    confirmAllDraftIncome: (...args: unknown[]) => mockConfirmAllDraftIncome(...args),
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
    const s = {
      currentHousehold: { id: 'hh-test' },
      // Component keys the member map by membership `id` (HouseholdMember.id),
      // which is what income rows store in member_id — not user_id.
      currentHouseholdMembers: [
        { id: 'u-1', display_name: 'Alex' },
        { id: 'u-2', display_name: null },
      ],
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { formatBudgetCurrency } from '../../budgetFormat';
import { SavingsIncomeView } from '../SavingsIncomeView';

function incomeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    household_id: 'hh-test',
    member_id: 'u-1',
    source_type: 'payroll',
    label: 'July Paycheck',
    amount_cents: 500000,
    income_date: '2026-07-15',
    currency: 'CAD',
    notes: null,
    template_id: null,
    period: '2026-07',
    status: 'confirmed',
    rolled_over_from_entry_id: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsIncomeView />
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

describe('SavingsIncomeView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDataRevision = 0;
    mockListIncome.mockResolvedValue({ entries: [incomeRow()] });
    mockCreateIncome.mockResolvedValue({ entry: incomeRow({ id: 'inc-copy' }) });
    mockDeleteIncome.mockResolvedValue({});
    mockConfirmIncome.mockResolvedValue({ entry: incomeRow({ status: 'confirmed' }) });
    mockConfirmAllDraftIncome.mockResolvedValue({ confirmed: 1 });
  });

  it('fetches income for the selected household / year / month on focus', async () => {
    await renderScreen();
    expect(mockListIncome).toHaveBeenCalledWith('hh-test', 2026, 7);
  });

  it('shows the total income for the month (sum of all rows)', async () => {
    mockListIncome.mockResolvedValue({
      entries: [
        incomeRow({ id: 'a', amount_cents: 500000 }),
        incomeRow({ id: 'b', amount_cents: 300000 }),
      ],
    });
    const tree = await renderScreen();
    const total = tree.root.findByProps({ testID: 'savings-income-total' });
    expect(total.props.children).toBe(formatBudgetCurrency(800000));
  });

  it('renders the income list with the fetched rows', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    expect(root.findByProps({ testID: 'savings-income' })).toBeTruthy();
    // testID propagates to the Touchable's host tree, so match ≥ 1 rather than
    // an exact node count.
    expect(root.findAllByProps({ testID: 'savings-income-item' }).length).toBeGreaterThan(0);
    expect(allText(tree)).toContain('July Paycheck');
  });

  it('renders the income-source icon as brushed brand art (active), not a flat glyph', async () => {
    // A saturated non-brand accent background would otherwise gate <Icon> down to
    // a monochrome glyph; the view must pass active so the kit PNG (slug "income"
    // for payroll) renders brushed.
    const tree = await renderScreen();
    const { Icon } = require('@components/ui/Icon');
    const sourceIcons = tree.root
      .findAllByType(Icon)
      .filter((n: { props: { name?: string } }) => n.props.name === 'income');
    expect(sourceIcons.length).toBeGreaterThan(0);
    expect(sourceIcons[0].props.active).toBe(true);
  });

  it('routes to SavingsEntryForm in income mode when "Add" is pressed', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-add-income' })[0].props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('SavingsEntryForm', { mode: 'income' });
  });

  it('shows the 3-button CTA row with concise labels, no redundant "income"', async () => {
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('Add');
    expect(text).toContain('Import (AI)');
    expect(text).not.toContain('Add income');
    expect(text).not.toContain('Import income (AI)');
  });

  it('routes to SavingsEntryForm with the row entryId when a row is pressed', async () => {
    const tree = await renderScreen();

    await act(async () => {
      // The Touchable is the first (outermost) node carrying the testID.
      tree.root.findAllByProps({ testID: 'savings-income-item' })[0].props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('SavingsEntryForm', {
      mode: 'income',
      entryId: 'inc-1',
    });
  });

  it('shows the empty state when there is no income', async () => {
    mockListIncome.mockResolvedValue({ entries: [] });
    const tree = await renderScreen();

    expect(tree.root.findAllByProps({ testID: 'savings-income-item' }).length).toBe(0);
    expect(allText(tree).some((t) => t.includes('No income recorded'))).toBe(true);
  });

  it('offers a copy-from-another-month CTA in the empty state, which opens the sheet', async () => {
    // An empty month is when copying forward is most likely the answer, so the
    // empty state carries its own way in rather than relying on the "Copy" chip
    // in the action row above it.
    mockListIncome.mockResolvedValue({ entries: [] });
    const tree = await renderScreen();

    const cta = tree.root.findAllByProps({ testID: 'savings-income-empty-copy-month' })[0];
    expect(cta).toBeDefined();
    expect(allText(tree)).toContain('Copy from another month');

    await act(async () => {
      cta.props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Same sheet the top-row Copy opens.
    expect(tree.root.findAllByProps({ testID: 'copy-month-income-cancel' }).length).toBeGreaterThan(0);
  });

  it('hides the empty-state copy CTA once the month has income', async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-income-empty-copy-month' }).length).toBe(0);
  });

  it('routes to the AI import in income scope', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-income-ai-import' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SavingsImport', { scope: 'income' });
  });

  it('formats sub-$1000 amounts as whole dollars and drops a missing member', async () => {
    mockListIncome.mockResolvedValue({
      entries: [incomeRow({ amount_cents: 50000, member_id: null })],
    });
    const tree = await renderScreen();
    expect(allText(tree)).toContain('$500');
  });

  it.each([
    ['marketplace_sale', 'Marketplace sale'],
    ['gift', 'Gift'],
    ['refund', 'Refund'],
    ['bonus', 'Bonus'],
    ['freelance', 'Freelance'],
  ])('labels a %s row as "%s"', async (sourceType, expected) => {
    mockListIncome.mockResolvedValue({
      entries: [incomeRow({ source_type: sourceType, label: 'Sold couch' })],
    });
    const tree = await renderScreen();
    const text = allText(tree);
    // The human label must render — never the raw enum value.
    expect(text.some((t) => t.includes(expected))).toBe(true);
    expect(text).not.toContain(sourceType);
  });

  it('still renders when loading income fails', async () => {
    mockListIncome.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-income-item' }).length).toBe(0);
  });

  it('reloads when the savings data revision changes', async () => {
    const tree = await renderScreen();
    const callsAfterMount = mockListIncome.mock.calls.length;

    mockDataRevision = 3;
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <SavingsIncomeView />
        </ThemeProvider>
      );
    });

    expect(mockListIncome.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('renders $0 and a "Member" fallback for a nameless member', async () => {
    mockListIncome.mockResolvedValue({
      entries: [incomeRow({ id: 'inc-z', amount_cents: 0, member_id: 'u-2' })],
    });
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('$0');
    expect(text.some((t) => t.includes('Member'))).toBe(true);
  });

  it('copies an income row to the same date when the copy action confirms unchanged', async () => {
    const tree = await renderScreen();

    // Swipe "copy" opens the target-date sheet…
    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-income-copy' })[0].props.onPress();
    });
    // …and confirming without changing the date copies it to the source date.
    await act(async () => {
      tree.root.findAllByProps({ testID: 'copy-entry-confirm' })[0].props.onPress();
      await Promise.resolve();
    });

    expect(mockCreateIncome).toHaveBeenCalledWith('hh-test', {
      id: 'inc-new-uuid',
      member_id: 'u-1',
      source_type: 'payroll',
      label: 'July Paycheck',
      amount_cents: 500000,
      income_date: '2026-07-15',
      currency: 'CAD',
      notes: null,
    });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('copies an income row to the next month keeping the same day', async () => {
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-income-copy' })[0].props.onPress();
    });
    await act(async () => {
      tree.root.findAllByProps({ testID: 'copy-entry-quick-next-month' })[0].props.onPress();
    });
    await act(async () => {
      tree.root.findAllByProps({ testID: 'copy-entry-confirm' })[0].props.onPress();
      await Promise.resolve();
    });

    expect(mockCreateIncome).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ income_date: '2026-08-15' })
    );
  });

  it('labels every swipe action so the open row is readable, not icon-only', async () => {
    const tree = await renderScreen();
    for (const [testID, label] of [
      ['savings-income-edit', 'Edit'],
      ['savings-income-copy', 'Copy'],
      ['savings-income-delete', 'Delete'],
    ]) {
      expect(tree.root.findAllByProps({ testID })[0].props.label).toBe(label);
    }
    expect(allText(tree)).toEqual(expect.arrayContaining(['Edit', 'Copy', 'Delete']));
  });

  it('routes the swipe edit action to the entry form for that row', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-income-edit' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SavingsEntryForm', {
      mode: 'income',
      entryId: 'inc-1',
    });
  });

  it('deletes an income row once the destructive alert is confirmed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-income-delete' })[0].props.onPress();
    });
    const call = alertSpy.mock.calls.find((c) => c[0] === 'Delete income');
    expect(call?.[1]).toContain('July Paycheck');

    const buttons = call![2] as unknown as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
    });

    expect(mockDeleteIncome).toHaveBeenCalledWith('hh-test', 'inc-1');
    expect(mockMarkDirty).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('keeps the income row when the delete alert is cancelled', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-income-delete' })[0].props.onPress();
    });
    const buttons = alertSpy.mock.calls.find((c) => c[0] === 'Delete income')![2] as unknown as {
      text: string;
      onPress?: () => void;
    }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Cancel')!.onPress?.();
    });

    expect(mockDeleteIncome).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('alerts when deleting an income row fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockDeleteIncome.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-income-delete' })[0].props.onPress();
    });
    const buttons = alertSpy.mock.calls.find((c) => c[0] === 'Delete income')![2] as unknown as {
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

  it('alerts when copying an income row fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateIncome.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();

    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-income-copy' })[0].props.onPress();
    });
    await act(async () => {
      tree.root.findAllByProps({ testID: 'copy-entry-confirm' })[0].props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(alertSpy.mock.calls.some((c) => c[0] === 'Error')).toBe(true);
    alertSpy.mockRestore();
  });

  describe('copy income from another month', () => {
    /** Open the Income tab's whole-month copy sheet and let its first fetch settle. */
    async function openCopySheet(tree: ReactTestRenderer.ReactTestRenderer) {
      await act(async () => {
        tree.root.findAllByProps({ testID: 'savings-income-copy-month' })[0].props.onPress();
      });
      await act(async () => {
        await Promise.resolve();
      });
    }

    /** Drive the nested month wheels the way a member does: open, spin, Done. */
    async function pickSourceMonth(tree: ReactTestRenderer.ReactTestRenderer, month: number) {
      await act(async () => {
        tree.root.findAllByProps({ testID: 'copy-month-income-month-field' })[0].props.onPress();
      });
      await act(async () => {
        tree.root
          .findAll((n) => n.props?.testID === 'copy-month-income-picker-month')[0]
          .props.onValueChange(month);
      });
      await act(async () => {
        tree.root.findAllByProps({ testID: 'copy-month-income-picker-done' })[0].props.onPress();
      });
      await act(async () => {
        await Promise.resolve();
      });
    }

    it('defaults the source month to the previous month and copies every entry into the current month', async () => {
      mockListIncome.mockImplementation((_id: unknown, year: number, month: number) => {
        if (year === 2026 && month === 7) return Promise.resolve({ entries: [incomeRow()] });
        if (year === 2026 && month === 6) {
          return Promise.resolve({
            entries: [incomeRow({ id: 'inc-june', label: 'June Paycheck', income_date: '2026-06-15' })],
          });
        }
        return Promise.resolve({ entries: [] });
      });

      const tree = await renderScreen();
      await openCopySheet(tree);

      expect(allText(tree)).toContain('June 2026');
      // Everything arrives ticked, so the whole month is still a single tap.
      expect(allText(tree).some((t) => t.includes('1 of 1 selected'))).toBe(true);

      await act(async () => {
        tree.root.findAllByProps({ testID: 'copy-month-income-confirm' })[0].props.onPress();
        await Promise.resolve();
      });

      expect(mockCreateIncome).toHaveBeenCalledWith(
        'hh-test',
        expect.objectContaining({
          id: 'inc-new-uuid',
          label: 'June Paycheck',
          income_date: '2026-07-15',
        })
      );
      expect(mockMarkDirty).toHaveBeenCalled();
    });

    it('lets the user pick a different source month on the wheels before copying', async () => {
      mockListIncome.mockImplementation((_id: unknown, year: number, month: number) => {
        if (year === 2026 && month === 7) return Promise.resolve({ entries: [incomeRow()] });
        if (year === 2026 && month === 5) {
          return Promise.resolve({
            entries: [incomeRow({ id: 'inc-may', label: 'May Paycheck', income_date: '2026-05-10' })],
          });
        }
        return Promise.resolve({ entries: [] });
      });

      const tree = await renderScreen();
      await openCopySheet(tree);
      await pickSourceMonth(tree, 5);

      expect(allText(tree)).toContain('May 2026');

      await act(async () => {
        tree.root.findAllByProps({ testID: 'copy-month-income-confirm' })[0].props.onPress();
        await Promise.resolve();
      });

      expect(mockCreateIncome).toHaveBeenCalledWith(
        'hh-test',
        expect.objectContaining({ label: 'May Paycheck', income_date: '2026-07-10' })
      );
    });

    it('copies only the ticked entries, leaving the unticked ones behind', async () => {
      mockListIncome.mockImplementation((_id: unknown, year: number, month: number) => {
        if (year === 2026 && month === 7) return Promise.resolve({ entries: [incomeRow()] });
        return Promise.resolve({
          entries: [
            incomeRow({ id: 'inc-payroll', label: 'June Paycheck', income_date: '2026-06-15' }),
            incomeRow({
              id: 'inc-bonus',
              label: 'One-off Bonus',
              source_type: 'bonus',
              income_date: '2026-06-20',
            }),
          ],
        });
      });

      const tree = await renderScreen();
      await openCopySheet(tree);

      expect(allText(tree).some((t) => t.includes('2 of 2 selected'))).toBe(true);

      // Untick the one-off — the whole reason this sheet picks per entry.
      await act(async () => {
        tree.root.findAllByProps({ testID: 'copy-month-income-row-inc-bonus' })[0].props.onPress();
      });

      expect(allText(tree).some((t) => t.includes('1 of 2 selected'))).toBe(true);

      await act(async () => {
        tree.root.findAllByProps({ testID: 'copy-month-income-confirm' })[0].props.onPress();
        await Promise.resolve();
      });

      expect(mockCreateIncome).toHaveBeenCalledTimes(1);
      expect(mockCreateIncome).toHaveBeenCalledWith(
        'hh-test',
        expect.objectContaining({ label: 'June Paycheck' })
      );
    });

    it('select all clears every tick, then restores them', async () => {
      mockListIncome.mockImplementation((_id: unknown, year: number, month: number) => {
        if (year === 2026 && month === 7) return Promise.resolve({ entries: [incomeRow()] });
        return Promise.resolve({
          entries: [
            incomeRow({ id: 'inc-a', income_date: '2026-06-15' }),
            incomeRow({ id: 'inc-b', income_date: '2026-06-20' }),
          ],
        });
      });

      const tree = await renderScreen();
      await openCopySheet(tree);

      const pressSelectAll = async () => {
        await act(async () => {
          tree.root.findAllByProps({ testID: 'copy-month-income-select-all' })[0].props.onPress();
        });
      };

      // Starts fully ticked, so the first press is a "deselect all".
      await pressSelectAll();
      expect(allText(tree).some((t) => t.includes('0 of 2 selected'))).toBe(true);
      expect(
        tree.root.findAllByProps({ testID: 'copy-month-income-confirm' })[0].props.disabled
      ).toBe(true);

      await pressSelectAll();
      expect(allText(tree).some((t) => t.includes('2 of 2 selected'))).toBe(true);
    });

    it('refuses to copy a month into itself', async () => {
      mockListIncome.mockResolvedValue({ entries: [incomeRow()] });

      const tree = await renderScreen();
      await openCopySheet(tree);
      // Scroll the wheels back onto July 2026 — the month behind the sheet.
      await pickSourceMonth(tree, 7);

      expect(
        tree.root.findAllByProps({ testID: 'copy-month-income-confirm' })[0].props.disabled
      ).toBe(true);
      expect(
        allText(tree).some((t) => t.includes("is the month you're viewing"))
      ).toBe(true);
      expect(mockCreateIncome).not.toHaveBeenCalled();
    });

    it('disables the confirm button and explains when the chosen month has no income', async () => {
      mockListIncome.mockImplementation((_id: unknown, year: number, month: number) => {
        if (year === 2026 && month === 7) return Promise.resolve({ entries: [incomeRow()] });
        return Promise.resolve({ entries: [] });
      });

      const tree = await renderScreen();
      await openCopySheet(tree);

      const confirmBtn = tree.root.findAllByProps({ testID: 'copy-month-income-confirm' })[0];
      expect(confirmBtn.props.disabled).toBe(true);
      expect(allText(tree).some((t) => t.includes('No income recorded in June 2026'))).toBe(true);

      await act(async () => {
        confirmBtn.props.onPress();
        await Promise.resolve();
      });
      expect(mockCreateIncome).not.toHaveBeenCalled();
    });

    it('closes without copying when cancelled', async () => {
      const tree = await renderScreen();
      await act(async () => {
        tree.root.findAllByProps({ testID: 'savings-income-copy-month' })[0].props.onPress();
      });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        tree.root.findAllByProps({ testID: 'copy-month-income-cancel' })[0].props.onPress();
      });

      expect(mockCreateIncome).not.toHaveBeenCalled();
    });

    it('alerts when copying from another month fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockListIncome.mockImplementation((_id: unknown, year: number, month: number) => {
        if (year === 2026 && month === 7) return Promise.resolve({ entries: [incomeRow()] });
        return Promise.resolve({
          entries: [incomeRow({ id: 'inc-june', income_date: '2026-06-15' })],
        });
      });
      mockCreateIncome.mockRejectedValueOnce(new Error('boom'));

      const tree = await renderScreen();
      await act(async () => {
        tree.root.findAllByProps({ testID: 'savings-income-copy-month' })[0].props.onPress();
      });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        tree.root.findAllByProps({ testID: 'copy-month-income-confirm' })[0].props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(alertSpy.mock.calls.some((c) => c[0] === 'Error')).toBe(true);
      alertSpy.mockRestore();
    });
  });

  describe('draft (rollover) income', () => {
    it('shows a "Draft" badge when a draft row exists among confirmed ones', async () => {
      mockListIncome.mockResolvedValue({
        entries: [incomeRow({ id: 'inc-draft', status: 'draft' }), incomeRow({ id: 'inc-confirmed' })],
      });
      const tree = await renderScreen();
      expect(allText(tree)).toContain('Draft');
    });

    it('does not show a Draft badge when every entry is already confirmed', async () => {
      const tree = await renderScreen();
      expect(allText(tree)).not.toContain('Draft');
    });

    it('shows a Confirm swipe action when a draft row exists', async () => {
      mockListIncome.mockResolvedValue({
        entries: [incomeRow({ id: 'inc-draft', status: 'draft' }), incomeRow({ id: 'inc-confirmed' })],
      });
      const tree = await renderScreen();
      expect(tree.root.findAllByProps({ testID: 'savings-income-confirm' }).length).toBeGreaterThan(0);
    });

    it('does not show a Confirm swipe action when there are no draft rows', async () => {
      const tree = await renderScreen();
      expect(tree.root.findAllByProps({ testID: 'savings-income-confirm' }).length).toBe(0);
    });

    it('confirms a draft row via the swipe action and reloads', async () => {
      mockListIncome.mockResolvedValue({ entries: [incomeRow({ id: 'inc-draft', status: 'draft' })] });
      const tree = await renderScreen();

      await act(async () => {
        tree.root.findAllByProps({ testID: 'savings-income-confirm' })[0].props.onPress();
        await Promise.resolve();
      });

      expect(mockConfirmIncome).toHaveBeenCalledWith('hh-test', 'inc-draft');
      expect(mockMarkDirty).toHaveBeenCalled();
    });

    it('alerts when confirming a draft row fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockConfirmIncome.mockRejectedValue(new Error('boom'));
      mockListIncome.mockResolvedValue({ entries: [incomeRow({ id: 'inc-draft', status: 'draft' })] });
      const tree = await renderScreen();

      await act(async () => {
        tree.root.findAllByProps({ testID: 'savings-income-confirm' })[0].props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(alertSpy.mock.calls.some((c) => c[0] === 'Error')).toBe(true);
      alertSpy.mockRestore();
    });

    it('shows a "needs confirming" banner with a count when drafts exist', async () => {
      mockListIncome.mockResolvedValue({
        entries: [
          incomeRow({ id: 'inc-draft-1', status: 'draft' }),
          incomeRow({ id: 'inc-draft-2', status: 'draft' }),
          incomeRow({ id: 'inc-confirmed' }),
        ],
      });
      const tree = await renderScreen();
      expect(tree.root.findByProps({ testID: 'savings-income-draft-banner' })).toBeTruthy();
      expect(allText(tree).some((t) => t.includes('2 income entries need confirming'))).toBe(true);
    });

    it('does not show the draft banner when every entry is already confirmed', async () => {
      const tree = await renderScreen();
      expect(tree.root.findAllByProps({ testID: 'savings-income-draft-banner' }).length).toBe(0);
    });

    it('confirms every draft for the month via "Confirm all"', async () => {
      mockListIncome.mockResolvedValue({ entries: [incomeRow({ id: 'inc-draft', status: 'draft' })] });
      const tree = await renderScreen();

      await act(async () => {
        tree.root.findAllByProps({ testID: 'savings-income-confirm-all' })[0].props.onPress();
        await Promise.resolve();
      });

      expect(mockConfirmAllDraftIncome).toHaveBeenCalledWith('hh-test', 2026, 7);
      expect(mockMarkDirty).toHaveBeenCalled();
    });

    it('alerts when "Confirm all" fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockConfirmAllDraftIncome.mockRejectedValue(new Error('boom'));
      mockListIncome.mockResolvedValue({ entries: [incomeRow({ id: 'inc-draft', status: 'draft' })] });
      const tree = await renderScreen();

      await act(async () => {
        tree.root.findAllByProps({ testID: 'savings-income-confirm-all' })[0].props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(alertSpy.mock.calls.some((c) => c[0] === 'Error')).toBe(true);
      alertSpy.mockRestore();
    });
  });
});
