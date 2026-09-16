/**
 * SavingsEntryForm — income / spending entry form, end-to-end behaviour.
 *
 * Stubs `@components/common` (its real `SafeAreaView` barrel transitively pulls
 * the SidebarTabBar → TaskDetail navigator chain that crashes under the mocked
 * `@react-navigation/native`), the native date picker, the savings API, and the
 * stores — then exercises: create income (dollars → int cents), create
 * spending, edit (prefill → update, delete), and the in-flight double-tap guard.
 * Every successful mutation must bump `markDirty` + `navigation.goBack`.
 */

// SafeAreaView passthrough so the heavy @components/common barrel never loads.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    // Mirrors `OverlaySheetHeader`: the sheet's glass ✕ (carrying `closeTestID`)
    // and an optional trailing commit — the "Done" these pickers used to end in
    // is now the ✕, so a flow driving that id still finds it here.
    OverlaySheetHeader: ({ title, onClose, closeTestID, action }: Record<string, any>) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        React.createElement(TouchableOpacity, { onPress: onClose, testID: closeTestID }),
        action
          ? React.createElement(
              TouchableOpacity,
              { onPress: action.onPress, testID: action.testID },
              React.createElement(Text, null, action.label)
            )
          : null
      ),
    // Mirrors `SheetHeader`, the form's own top bar since it stopped hand-rolling
    // one: the ✕ carries `leftTestID` (the id the Cancel flow drives) and the
    // single trailing commit carries `rightTestID`.
    SheetHeader: ({
      title,
      onLeftPress,
      leftTestID,
      rightLabel,
      onRightPress,
      rightDisabled,
      rightTestID,
    }: Record<string, any>) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        React.createElement(TouchableOpacity, { onPress: onLeftPress, testID: leftTestID }),
        rightLabel
          ? React.createElement(
              TouchableOpacity,
              { onPress: onRightPress, disabled: rightDisabled, testID: rightTestID },
              React.createElement(Text, null, rightLabel)
            )
          : null
      ),
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
  };
});

// Native date picker → prop-forwarding stub so tests can drive onChange.
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return (props: Record<string, unknown>) =>
    React.createElement(View, { testID: 'mock-datetimepicker', ...props });
});

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockRouteParams: any = {};
// Stable navigation object — a fresh object per render would make the
// edit-load effect (deps include `navigation`) re-run and clobber typed input.
const mockNavigation = { goBack: mockGoBack, navigate: mockNavigate };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

// Device profile — defaults to a phone so the existing suite is unchanged; the
// "iPad layout" block flips it to exercise the centered-sheet branch. Only read
// when useDeviceType() runs at render, so no hoist/TDZ concern.
let mockDeviceInfo: { isIPad: boolean; width: number } = { isIPad: false, width: 390 };
jest.mock('@hooks/useDeviceType', () => ({
  useDeviceType: () => mockDeviceInfo,
}));

// Validation + save-failure UX moved from Alert.alert to showToast('error', …).
jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

const mockHouseholdsGet = jest.fn();
jest.mock('@api/households', () => ({
  householdsApi: {
    get: (...args: unknown[]) => mockHouseholdsGet(...args),
  },
}));

const mockListIncome = jest.fn();
const mockCreateIncome = jest.fn();
const mockUpdateIncome = jest.fn();
const mockDeleteIncome = jest.fn();
const mockListSpending = jest.fn();
const mockCreateSpending = jest.fn();
const mockUpdateSpending = jest.fn();
const mockDeleteSpending = jest.fn();
const mockListCategories = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    listIncome: (...args: unknown[]) => mockListIncome(...args),
    createIncome: (...args: unknown[]) => mockCreateIncome(...args),
    updateIncome: (...args: unknown[]) => mockUpdateIncome(...args),
    deleteIncome: (...args: unknown[]) => mockDeleteIncome(...args),
    listSpending: (...args: unknown[]) => mockListSpending(...args),
    createSpending: (...args: unknown[]) => mockCreateSpending(...args),
    updateSpending: (...args: unknown[]) => mockUpdateSpending(...args),
    deleteSpending: (...args: unknown[]) => mockDeleteSpending(...args),
    listCategories: (...args: unknown[]) => mockListCategories(...args),
  },
}));

let mockMembers: Array<Record<string, unknown>> = [
  { id: 'm1', user_id: 'u1', display_name: 'Andrei' },
];
jest.mock('@stores/householdStore', () => {
  const useHouseholdStore = (selector?: (s: unknown) => unknown) => {
    const state = {
      currentHousehold: { id: 'hh-test' },
      currentHouseholdMembers: mockMembers,
    };
    return selector ? selector(state) : state;
  };
  return { useHouseholdStore };
});

const mockMarkDirty = jest.fn();
let mockSelectedMonth = 7;

jest.mock('@stores/savingsStore', () => {
  // markDirty is a wrapper so it resolves the (hoist-deferred) mockMarkDirty at
  // call time rather than capturing its still-undefined value at factory eval.
  const build = () => ({
    selectedYear: 2026,
    selectedMonth: mockSelectedMonth,
    markDirty: (...args: unknown[]) => mockMarkDirty(...args),
  });
  const useSavingsStore = (selector?: (s: ReturnType<typeof build>) => unknown) =>
    selector ? selector(build()) : build();
  (useSavingsStore as any).getState = () => build();
  return { useSavingsStore };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { showToast } from '@services/toastManager';

import { SavingsEntryForm } from '../SavingsEntryForm';

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsEntryForm />
      </ThemeProvider>
    );
  });
  return tree;
}

function spendingEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sp-1',
    household_id: 'hh-test',
    category_id: 'cat-1',
    label: 'Dining out',
    amount_cents: 5000,
    spending_date: '2026-07-12',
    currency: 'CAD',
    notes: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function incomeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    household_id: 'hh-test',
    // Matches the form's member.id convention (household member `id`, not user_id).
    member_id: 'm1',
    source_type: 'payroll',
    label: 'Paycheck',
    amount_cents: 250000,
    income_date: '2026-07-15',
    currency: 'CAD',
    notes: null,
    template_id: null,
    period: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('SavingsEntryForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    mockMembers = [{ id: 'm1', user_id: 'u1', display_name: 'Andrei' }];
    mockSelectedMonth = 7;
    mockHouseholdsGet.mockResolvedValue({ members: [{ id: 'm9', display_name: 'Fetched', email: 'f@x.io' }] });
    mockListIncome.mockResolvedValue({ entries: [incomeEntry()] });
    mockListSpending.mockResolvedValue({ entries: [] });
    mockListCategories.mockResolvedValue({ categories: [] });
    mockCreateIncome.mockResolvedValue({});
    mockUpdateIncome.mockResolvedValue({});
    mockDeleteIncome.mockResolvedValue({});
    mockCreateSpending.mockResolvedValue({});
    mockUpdateSpending.mockResolvedValue({});
    mockDeleteSpending.mockResolvedValue({});
  });

  it('creates an income entry with dollars → int cents, then marks dirty + goes back', async () => {
    mockRouteParams = { mode: 'income' };
    const tree = await renderScreen();
    const root = tree.root;

    // Income has no free-text name — its label is derived from member + source.
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('2500');
    });
    // Pick a non-default source type (payroll is the default).
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-source-rental' }).props.onPress();
    });
    // Open the member picker sheet and choose the household member.
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-m1' }).props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });

    expect(mockCreateIncome).toHaveBeenCalledTimes(1);
    const [hid, payload] = mockCreateIncome.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(payload).toMatchObject({
      id: 'test-uuid',
      member_id: 'm1',
      source_type: 'rental',
      label: 'Andrei Rental',
      amount_cents: 250000,
    });
    expect(typeof payload.income_date).toBe('string');
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('creates a marketplace-sale income entry from the one-off sources', async () => {
    mockRouteParams = { mode: 'income' };
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('120');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-source-marketplace_sale' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-m1' }).props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });

    expect(mockCreateIncome).toHaveBeenCalledTimes(1);
    const [, payload] = mockCreateIncome.mock.calls[0];
    expect(payload).toMatchObject({
      source_type: 'marketplace_sale',
      // Label is still derived from member + source, so the one-off source name
      // has to be human-readable rather than the raw enum value.
      label: 'Andrei Marketplace sale',
      amount_cents: 12000,
    });
  });

  it.each([
    ['gift', 'Gift'],
    ['refund', 'Refund'],
    ['bonus', 'Bonus'],
    ['freelance', 'Freelance'],
  ])('offers %s in the income source picker', async (value, label) => {
    mockRouteParams = { mode: 'income' };
    const tree = await renderScreen();

    const chip = tree.root.findByProps({ testID: `savings-entry-source-${value}` });
    expect(chip).toBeTruthy();
    expect(tree.root.findAll((n) => n.props?.children === label).length).toBeGreaterThan(0);
  });

  it('creates a spending entry via createSpending', async () => {
    mockRouteParams = { mode: 'spending' };
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-entry-label' }).props.onChangeText('Groceries');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('80.50');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });

    expect(mockCreateIncome).not.toHaveBeenCalled();
    expect(mockCreateSpending).toHaveBeenCalledTimes(1);
    const [hid, payload] = mockCreateSpending.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(payload).toMatchObject({ id: 'test-uuid', label: 'Groceries', amount_cents: 8050 });
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('prefills an existing income entry and saves via updateIncome', async () => {
    mockRouteParams = { mode: 'income', entryId: 'inc-1' };
    const tree = await renderScreen();
    const root = tree.root;

    expect(mockListIncome).toHaveBeenCalledWith('hh-test', 2026, 7);
    // Amount prefills from the loaded entry (dollars string). Income has no
    // free-text name field — its label is re-derived from member + source.
    expect(root.findByProps({ testID: 'savings-entry-amount' }).props.value).toBe('2500');

    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('3000');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });

    expect(mockCreateIncome).not.toHaveBeenCalled();
    expect(mockUpdateIncome).toHaveBeenCalledTimes(1);
    const [hid, id, payload] = mockUpdateIncome.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(id).toBe('inc-1');
    // Loaded member `m1` (Andrei) + source `payroll` → derived label.
    expect(payload).toMatchObject({ amount_cents: 300000, label: 'Andrei Payroll' });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('keeps a non-payroll source when an unrelated field is edited', async () => {
    // REGRESSION (found on device by budget-savings-income-crud.yaml).
    // `sourceTypeRef` is initialised to a TRUTHY 'payroll' and `persistEntry`
    // reads `resolveSourceType()` = `sourceTypeRef.current || sourceType`. The
    // edit-load path used to call `setSourceType(...)` WITHOUT syncing the ref,
    // so editing any non-payroll entry rewrote `source_type` to 'payroll' and
    // re-derived the label with it — silently reclassifying one-off income as
    // regular, which corrupts the Overview regular/one-off split and the
    // Projection pace (one-off income is excluded from pace by design).
    //
    // This case only bites for a source that is NOT the ref's default, which is
    // exactly why the payroll-fixture test above passed throughout.
    mockListIncome.mockResolvedValue({
      entries: [incomeEntry({ source_type: 'freelance', label: 'Andrei Freelance' })],
    });
    mockRouteParams = { mode: 'income', entryId: 'inc-1' };
    const tree = await renderScreen();
    const root = tree.root;

    // Touch ONLY the amount — the source chip is never tapped, which is what
    // left the ref stale in the first place.
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('3000');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });

    expect(mockUpdateIncome).toHaveBeenCalledTimes(1);
    const [, , payload] = mockUpdateIncome.mock.calls[0];
    expect(payload).toMatchObject({
      source_type: 'freelance',
      label: 'Andrei Freelance',
      amount_cents: 300000,
    });
  });

  it('deletes an existing income entry through the delete control', async () => {
    mockRouteParams = { mode: 'income', entryId: 'inc-1' };
    const tree = await renderScreen();
    const root = tree.root;

    // Delete triggers a confirm Alert; auto-press its destructive button.
    const { Alert } = require('react-native');
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t: unknown, _m: unknown, buttons?: unknown) => {
        const list = (buttons as { style?: string; onPress?: () => void }[]) ?? [];
        list.find((b) => b.style === 'destructive')?.onPress?.();
      });

    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-delete' }).props.onPress();
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(mockDeleteIncome).toHaveBeenCalledWith('hh-test', 'inc-1');
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('guards against double-tap while a save is in flight (createIncome once)', async () => {
    mockRouteParams = { mode: 'income' };
    // Never-resolving promise keeps isSaving = true after the first press.
    let release!: () => void;
    mockCreateIncome.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));

    const tree = await renderScreen();
    const root = tree.root;

    // Income label is derived (member + source); only the amount is required.
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('2500');
    });

    const save = root.findByProps({ testID: 'savings-entry-form-save-header' });
    // First press starts the (never-resolving) save → isSaving flips true.
    await act(async () => {
      save.props.onPress();
      await Promise.resolve();
    });
    // Second press must be ignored by the in-flight guard.
    await act(async () => {
      save.props.onPress();
      await Promise.resolve();
    });

    expect(mockCreateIncome).toHaveBeenCalledTimes(1);

    // Resolve the in-flight save inside act so the trailing setIsSaving(false)
    // re-render flushes before teardown (avoids "log after tests are done").
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it('blocks saving when the amount is missing', async () => {
    mockRouteParams = { mode: 'income' };
    const tree = await renderScreen();
    // Dirty the form without an amount (Save only renders once the form is
    // dirty), so the save runs and hits persistEntry's amount validation. CAD,
    // not USD: USD is the default display currency, so tapping it changes
    // nothing and leaves the form clean.
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-entry-currency-CAD' }).props.onPress();
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('amount'));
    expect(mockCreateIncome).not.toHaveBeenCalled();
  });

  it('blocks a spending save when the name is missing', async () => {
    mockRouteParams = { mode: 'spending' };
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('20');
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('name'));
    expect(mockCreateSpending).not.toHaveBeenCalled();
  });

  it('selects a category and edits a spending entry via updateSpending', async () => {
    mockRouteParams = { mode: 'spending', entryId: 'sp-1' };
    mockListSpending.mockResolvedValue({ entries: [spendingEntry()] });
    mockListCategories.mockResolvedValue({
      categories: [
        { id: 'cat-1', household_id: 'hh-test', name: 'Dining', icon: '🍽️', color: '#000', kind: 'spending', sort_order: 0, created_at: '' },
        { id: 'cat-2', household_id: 'hh-test', name: 'Travel', icon: '✈️', color: '#111', kind: 'spending', sort_order: 1, created_at: '' },
      ],
    });
    const tree = await renderScreen();
    const root = tree.root;
    expect(root.findByProps({ testID: 'savings-entry-amount' }).props.value).toBe('50');

    await act(async () => {
      root.findByProps({ testID: 'savings-entry-category-picker' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-category-cat-2' }).props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });

    expect(mockUpdateSpending).toHaveBeenCalledTimes(1);
    const [hid, id, payload] = mockUpdateSpending.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(id).toBe('sp-1');
    expect(payload).toMatchObject({ label: 'Dining out', amount_cents: 5000, category_id: 'cat-2' });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('deletes an existing spending entry', async () => {
    mockRouteParams = { mode: 'spending', entryId: 'sp-1' };
    mockListSpending.mockResolvedValue({ entries: [spendingEntry()] });
    const { Alert } = require('react-native');
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t: unknown, _m: unknown, buttons?: unknown) => {
        const list = (buttons as { style?: string; onPress?: () => void }[]) ?? [];
        list.find((b) => b.style === 'destructive')?.onPress?.();
      });
    const tree = await renderScreen();
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-entry-form-delete' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockDeleteSpending).toHaveBeenCalledWith('hh-test', 'sp-1');
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('saves and stays on the form via "save & add another" (no goBack)', async () => {
    mockRouteParams = { mode: 'income' };
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('5');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-add-another' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateIncome).toHaveBeenCalledTimes(1);
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('toggles the date picker open', async () => {
    mockRouteParams = { mode: 'spending' };
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-entry-date-picker' }).props.onPress();
    });
    // No throw = the show-date-picker branch executed.
    expect(tree.root.findByProps({ testID: 'savings-entry-date-picker' })).toBeTruthy();
  });

  it('picks a specific date through the date picker onChange', async () => {
    mockRouteParams = { mode: 'income' };
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-date-picker' }).props.onPress();
    });
    await act(async () => {
      root
        .findByProps({ testID: 'mock-datetimepicker' })
        .props.onChange({}, new Date(2026, 2, 9, 12, 0, 0));
    });
    // Add an amount then save → the picked date (2026-03-09) flows into the payload.
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('10');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateIncome.mock.calls[0][1].income_date).toBe('2026-03-09');
  });

  it('selects the USD currency', async () => {
    mockRouteParams = { mode: 'spending' };
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-currency-USD' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-label' }).props.onChangeText('X');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('10');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateSpending.mock.calls[0][1].currency).toBe('USD');
  });

  it('alerts when saving an entry fails', async () => {
    mockRouteParams = { mode: 'income' };
    mockCreateIncome.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('10');
    });
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('save'));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('alerts when deleting an entry fails', async () => {
    mockRouteParams = { mode: 'spending', entryId: 'sp-1' };
    mockListSpending.mockResolvedValue({ entries: [spendingEntry()] });
    mockDeleteSpending.mockRejectedValue(new Error('boom'));
    const { Alert } = require('react-native');
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t: unknown, _m: unknown, buttons?: unknown) => {
        const list = (buttons as { style?: string; onPress?: () => void }[]) ?? [];
        list.find((b) => b.style === 'destructive')?.onPress?.();
      });
    const tree = await renderScreen();
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-entry-form-delete' }).props.onPress();
      await Promise.resolve();
    });
    expect(
      alertSpy.mock.calls.some((c) => c[0] === 'Error' && String(c[1]).includes('delete'))
    ).toBe(true);
    alertSpy.mockRestore();
  });

  it('shows an error and goes back when loading an entry to edit fails', async () => {
    mockRouteParams = { mode: 'income', entryId: 'inc-1' };
    mockListIncome.mockRejectedValue(new Error('boom'));
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderScreen();
    expect(alertSpy).toHaveBeenCalledWith('Could not load entry', expect.any(String));
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('fetches household members directly when the store is empty (income mode)', async () => {
    mockRouteParams = { mode: 'income' };
    mockMembers = [];
    const tree = await renderScreen();
    await act(async () => Promise.resolve());
    expect(mockHouseholdsGet).toHaveBeenCalledWith('hh-test');
    // The fetched member is offered in the picker.
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'savings-entry-member-m9' }).length).toBeGreaterThan(0);
  });

  it('clears the member selection via "No member"', async () => {
    mockRouteParams = { mode: 'income' };
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-m1' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-none' }).props.onPress();
    });
    // Back to the placeholder — no member selected.
    expect(root.findByProps({ testID: 'savings-entry-member-picker' }).props.children).toBeTruthy();
  });

  it('clears the category selection via "No category"', async () => {
    mockRouteParams = { mode: 'spending', entryId: 'sp-1' };
    mockListSpending.mockResolvedValue({ entries: [spendingEntry()] });
    mockListCategories.mockResolvedValue({
      categories: [
        { id: 'cat-1', household_id: 'hh-test', name: 'Dining', icon: '🍽️', color: '#000', kind: 'spending', sort_order: 0, created_at: '' },
      ],
    });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-category-picker' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-category-none' }).props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockUpdateSpending.mock.calls[0][2].category_id).toBeNull();
  });

  it('defaults a new entry to the 1st when viewing a non-current month', async () => {
    mockRouteParams = { mode: 'spending' };
    mockSelectedMonth = 3; // not the current month (test clock is July)
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-label' }).props.onChangeText('X');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('10');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateSpending.mock.calls[0][1].spending_date).toBe('2026-03-01');
  });

  it('lets the keyboard scroll the focused field into view', async () => {
    // The form used to measure its own viewport with onLayout and pin the
    // ScrollView to that pixel height. That height was captured BEFORE the
    // keyboard existed, so tapping a field near the bottom (Description) left it
    // behind the keypad with nothing to scroll it back.
    // `automaticallyAdjustKeyboardInsets` is the half that actually reveals the
    // field — see the note in src/utils/keyboard.ts.
    mockRouteParams = { mode: 'spending' };
    const tree = await renderScreen();

    const scrollers = tree.root.findAll(
      (n) => typeof n.props?.contentContainerStyle !== 'undefined' &&
             typeof n.props?.automaticallyAdjustKeyboardInsets !== 'undefined'
    );
    expect(scrollers.length).toBeGreaterThan(0);
    expect(scrollers[0].props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(scrollers[0].props.keyboardShouldPersistTaps).toBe('handled');

    // No hard-coded pixel height may survive on the form scroller.
    const flatten = (v: unknown): object[] =>
      Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === 'object' ? [v] : [];
    for (const layer of flatten(scrollers[0].props.style)) {
      expect(layer).not.toHaveProperty('height');
    }
  });

  it('saves from the header Save button', async () => {
    mockRouteParams = { mode: 'spending' };
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-label' }).props.onChangeText('X');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-amount' }).props.onChangeText('10');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-entry-form-save-header' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateSpending).toHaveBeenCalledTimes(1);
  });

  it('closes the category and member pickers via their backdrops', async () => {
    mockRouteParams = { mode: 'spending', entryId: 'sp-1' };
    mockListSpending.mockResolvedValue({ entries: [spendingEntry()] });
    mockListCategories.mockResolvedValue({
      categories: [
        { id: 'cat-1', household_id: 'hh-test', name: 'Dining', icon: '🍽️', color: '#000', kind: 'spending', sort_order: 0, created_at: '' },
      ],
    });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-category-picker' }).props.onPress();
    });
    await act(async () => {
      root.findAllByProps({ accessibilityLabel: 'Close category picker' })[0].props.onPress();
    });
    expect(root.findByProps({ testID: 'savings-entry-form' })).toBeTruthy();
  });

  it('closes the category picker via Done and the hardware back (onRequestClose)', async () => {
    mockRouteParams = { mode: 'spending', entryId: 'sp-1' };
    mockListSpending.mockResolvedValue({ entries: [spendingEntry()] });
    mockListCategories.mockResolvedValue({
      categories: [
        { id: 'cat-1', household_id: 'hh-test', name: 'Dining', icon: '🍽️', color: '#000', kind: 'spending', sort_order: 0, created_at: '' },
      ],
    });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-category-picker' }).props.onPress();
    });
    // Dismiss via the sheet's standard glass ✕ (it replaced the old "Done").
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-category-close' }).props.onPress();
    });
    // Reopen and dismiss via the Modal's onRequestClose (hardware back).
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-category-picker' }).props.onPress();
    });
    await act(async () => {
      const modal = root
        .findAll((n) => typeof n.props?.onRequestClose === 'function' && n.props?.visible === true)
        .find(() => true);
      modal!.props.onRequestClose();
    });
    expect(root.findByProps({ testID: 'savings-entry-form' })).toBeTruthy();
  });

  it('closes the member picker via Done and the hardware back (onRequestClose)', async () => {
    mockRouteParams = { mode: 'income' };
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-close' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    await act(async () => {
      const modal = root
        .findAll((n) => typeof n.props?.onRequestClose === 'function' && n.props?.visible === true)
        .find(() => true);
      modal!.props.onRequestClose();
    });
    // Reopen and dismiss via the backdrop.
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    await act(async () => {
      root.findAllByProps({ accessibilityLabel: 'Close member picker' })[0].props.onPress();
    });
    expect(root.findByProps({ testID: 'savings-entry-form' })).toBeTruthy();
  });

  it('goes back when Cancel is pressed', async () => {
    mockRouteParams = { mode: 'spending' };
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-entry-form-cancel' }).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('dismisses the iOS date picker via its Done button', async () => {
    mockRouteParams = { mode: 'spending' };
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-date-picker' }).props.onPress();
    });
    // The Done button lives in the same container as the picker (iOS branch).
    // parent = DateTimePicker composite, parent.parent = datePickerContainer View.
    const container = root.findByProps({ testID: 'mock-datetimepicker' }).parent!.parent!;
    const done = container.findAll((n) => typeof n.props?.onPress === 'function')[0];
    await act(async () => {
      done.props.onPress();
    });
    expect(root.findAllByProps({ testID: 'mock-datetimepicker' }).length).toBe(0);
  });
});

describe('SavingsEntryForm — iPad layout', () => {
  beforeEach(() => {
    // Income mode renders the member picker (a centered/slide sheet); spending
    // mode would instead call the unmocked listCategories effect.
    mockRouteParams = { mode: 'income' };
  });
  afterEach(() => {
    mockDeviceInfo = { isIPad: false, width: 390 };
    mockRouteParams = {};
  });

  it('opens the member picker as a centered (fade) sheet on a wide iPad', async () => {
    mockDeviceInfo = { isIPad: true, width: 1366 };
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    const modals = root.findAll(
      (n) => (n.props as { animationType?: string })?.animationType !== undefined,
      { deep: true }
    );
    expect(modals.length).toBeGreaterThan(0);
    expect(modals.some((m) => (m.props as { animationType?: string }).animationType === 'fade')).toBe(true);
  });

  it('keeps the phone bottom-sheet (slide) on a narrow iPad below the sidebar breakpoint', async () => {
    mockDeviceInfo = { isIPad: true, width: 700 };
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-entry-member-picker' }).props.onPress();
    });
    const modals = root.findAll(
      (n) => (n.props as { animationType?: string })?.animationType !== undefined,
      { deep: true }
    );
    expect(modals.some((m) => (m.props as { animationType?: string }).animationType === 'slide')).toBe(true);
  });
});
