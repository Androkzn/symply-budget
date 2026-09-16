/**
 * SavingsRecurringPaymentsScreen — Monthly Payments UI, end-to-end behaviour.
 *
 * Stubs `@components/common` (whose real `SafeAreaView` barrel transitively
 * pulls the SidebarTabBar → TaskDetail navigator chain that crashes under the
 * mocked `@react-navigation/native`), the savings API, and the stores — then
 * exercises: BE-computed total render, "+" menu → Add manually →
 * createRecurringPayment, "+" menu → Import with AI → navigates to the AI
 * import screen, and active toggle → updateRecurringPayment. Every mutation
 * must bump `markDirty`.
 */

// SafeAreaView passthrough so the heavy @components/common barrel never loads.
jest.mock('@components/common', () => {
  const React = require('react');
  const { Modal, View, Text, TouchableOpacity } = require('react-native');
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
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    // Renders a real RN `Modal` (same as the primitive `AdaptiveModal` wraps
    // internally) so the "single modal, not a sibling modal" regression test
    // can still find the form by type and assert the group picker lives in
    // the same modal subtree.
    AdaptiveModal: ({
      visible,
      onClose,
      children,
    }: {
      visible?: boolean;
      onClose?: () => void;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        Modal,
        { visible: !!visible, transparent: true, onRequestClose: onClose },
        children
      ),
    BackButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement(TouchableOpacity, { testID, onPress }),
    HeaderActionButton: ({
      onPress,
      testID,
      children,
      label,
    }: {
      onPress?: () => void;
      testID?: string;
      children?: React.ReactNode;
      label?: string;
    }) => React.createElement(View, { testID, onPress }, children ?? label ?? null),
    ScreenHeader: ({
      onBackPress,
      rightElement,
    }: {
      onBackPress?: () => void;
      rightElement?: React.ReactNode;
    }) =>
      React.createElement(
        View,
        null,
        React.createElement(TouchableOpacity, { testID: 'savings-recurring-back', onPress: onBackPress }),
        rightElement ?? null
      ),
    SheetHeader: ({
      title,
      onLeftPress,
      leftTestID,
      rightElement,
      rightLabel,
      onRightPress,
      rightTestID,
      testID,
    }: Record<string, unknown>) =>
      React.createElement(
        View,
        { testID },
        title ? React.createElement(Text, null, title) : null,
        onLeftPress
          ? React.createElement(TouchableOpacity, { onPress: onLeftPress, testID: leftTestID })
          : null,
        rightElement ??
          (rightLabel
            ? React.createElement(
                TouchableOpacity,
                { onPress: onRightPress, testID: rightTestID },
                React.createElement(Text, null, rightLabel)
              )
            : null)
      ),
    ScanImportSources: ({ testIDPrefix }: { testIDPrefix?: string }) =>
      React.createElement(View, { testID: testIDPrefix ? `${testIDPrefix}-stub` : undefined }),
    // Used by the shared `LoanFieldsForm` (rendered by both `LoanInfoSection`
    // and `LoanDraftSection` once tracking is on) — a no-op is enough here,
    // since this suite drives loan fields directly by testID, not via AI fill.
    ProcessingOverlay: () => null,
    screenScrollViewStyle: { scroll: { flex: 1 } },
  };
});

jest.mock('@components/cloud-storage', () => ({
  CloudFilePicker: () => null,
}));

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockNav = { goBack: mockGoBack, navigate: mockNavigate, setParams: mockSetParams };
// Mutated per-test (default: no `focusItemId`) to drive the "opened via
// SavingsMonthlyView's quick-view Edit button" auto-open behaviour below.
let mockRouteParams: { focusItemId?: string } | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'rp-new-uuid' }));

const mockListRecurringPayments = jest.fn();
const mockCreateRecurringPayment = jest.fn();
const mockUpdateRecurringPayment = jest.fn();
const mockDeleteRecurringPayment = jest.fn();
// `openEdit` loads per-year "already applied" months on mount (to decide
// whether an amount change should offer to propagate) — default to an empty
// list so editing renders without a network stub per test.
const mockGetRecurringApplyStatus = jest.fn().mockResolvedValue({ months: [] });
const mockPropagateRecurringPayment = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    listRecurringPayments: (...args: unknown[]) => mockListRecurringPayments(...args),
    createRecurringPayment: (...args: unknown[]) => mockCreateRecurringPayment(...args),
    updateRecurringPayment: (...args: unknown[]) => mockUpdateRecurringPayment(...args),
    deleteRecurringPayment: (...args: unknown[]) => mockDeleteRecurringPayment(...args),
    getRecurringApplyStatus: (...args: unknown[]) => mockGetRecurringApplyStatus(...args),
    propagateRecurringPayment: (...args: unknown[]) => mockPropagateRecurringPayment(...args),
  },
}));

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

// RenewalReminderSection fetches on mount whenever the edit form is open — stub
// it so opening/editing a payment in these tests never depends on a real network
// call. Individual tests override the resolved value to exercise the pill/section.
const mockGetRenewal = jest.fn().mockResolvedValue({ renewal: null, documents: [] });
jest.mock('@api/budgetRenewals', () => ({
  RENEWAL_CATEGORIES: ['insurance', 'warranty', 'subscription', 'membership', 'license', 'other'],
  RENEWAL_CYCLES: ['monthly', 'quarterly', 'semi_annual', 'annual', 'custom'],
  RENEWAL_DOCUMENT_SOURCES: ['camera', 'gallery', 'file', 'drive', 'manual'],
  RENEWAL_DOCUMENT_MIME_TYPES: ['image/jpeg', 'image/png', 'application/pdf'],
  budgetRenewalsApi: {
    get: (...args: unknown[]) => mockGetRenewal(...args),
  },
  budgetRenewalDocumentContentSource: jest.fn(() => null),
}));

// LoanInfoSection fetches on mount whenever the edit form is open — same
// reasoning as the RenewalReminderSection stub above. `upsert` backs both
// LoanInfoSection's own Save button AND the screen's own post-create loan
// save for the Add-payment "Loans & Debt" draft flow (LoanDraftSection has
// no Save button of its own — see the "creates ... loan" tests below).
const mockGetLoan = jest.fn().mockResolvedValue({ loan: null, summary: null });
const mockUpsertLoan = jest.fn();
jest.mock('@api/budgetLoans', () => ({
  budgetLoansApi: {
    get: (...args: unknown[]) => mockGetLoan(...args),
    upsert: (...args: unknown[]) => mockUpsertLoan(...args),
  },
}));

const mockMarkDirty = jest.fn();

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: { id: 'hh-test' } }),
}));

jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: () => ({
    selectedYear: 2026,
    selectedMonth: 7,
    dataRevision: 0,
    markDirty: mockMarkDirty,
  }),
}));

import React from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Switch } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { SavingsRecurringPaymentsScreen } from '../SavingsRecurringPaymentsScreen';

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsRecurringPaymentsScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

describe('SavingsRecurringPaymentsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
    mockListRecurringPayments.mockResolvedValue({
      items: [
        {
          id: 'rp-1',
          household_id: 'hh-test',
          category_id: null,
          label: 'Rent',
          amount_cents: 180000,
          currency: 'CAD',
          day_of_month: 1,
          group_label: 'Housing',
          is_essential: true,
          active: true,
          is_automated: false,
          source: 'manual',
          created_by: null,
          created_at: '',
          updated_at: '',
        },
      ],
      totalMonthlyCents: 180000,
      savedMonthlyIncomeCents: 500000,
      byGroup: [{ group_label: 'Housing', subtotalCents: 180000 }],
    });
    mockCreateRecurringPayment.mockResolvedValue({ item: {} });
    mockUpdateRecurringPayment.mockResolvedValue({ item: {} });
    mockUpsertLoan.mockResolvedValue({ loan: {}, summary: {} });
  });

  it('loads payments and renders the BE-computed total + controls', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    expect(mockListRecurringPayments).toHaveBeenCalledWith('hh-test', 2026, 7);
    // Payments total and add control both present.
    expect(root.findByProps({ testID: 'savings-recurring-total' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-recurring-add' })).toBeTruthy();
    // The seeded item rendered.
    expect(root.findAllByProps({ testID: 'savings-recurring-item' }).length).toBeGreaterThan(0);
  });

  it('does not render the removed apply-to-months button or MonthApply sheet', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    expect(root.findAllByProps({ testID: 'savings-recurring-apply' })).toHaveLength(0);
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    // The "+" menu offers exactly the two replacement entry points — no
    // leftover bulk "Apply to months" grid anywhere in the tree.
    expect(root.findAllByProps({ testID: 'savings-recurring-add-manual' }).length).toBeGreaterThan(0);
    expect(root.findAllByProps({ testID: 'savings-recurring-add-import' }).length).toBeGreaterThan(0);
    expect(root.findAllByProps({ testID: 'month-apply-confirm' })).toHaveLength(0);
  });

  it('does not render the monthly-income figure (income was removed)', async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-recurring-income' })).toHaveLength(0);
  });

  it('does not render the by-category distribution chart (moved to the Monthly view)', async () => {
    mockListRecurringPayments.mockResolvedValue({
      items: [
        {
          id: 'rp-h',
          household_id: 'hh-test',
          category_id: null,
          label: 'Mortgage Home',
          amount_cents: 430000,
          currency: 'CAD',
          day_of_month: 1,
          group_label: 'Housing',
          is_essential: true,
          active: true,
          source: 'manual',
          created_by: null,
          created_at: '',
          updated_at: '',
        },
        {
          id: 'rp-o',
          household_id: 'hh-test',
          category_id: null,
          label: 'Netflix',
          amount_cents: 1600,
          currency: 'CAD',
          day_of_month: null,
          group_label: null,
          is_essential: false,
          active: true,
          source: 'manual',
          created_by: null,
          created_at: '',
          updated_at: '',
        },
      ],
      totalMonthlyCents: 431600,
      savedMonthlyIncomeCents: 0,
      byGroup: [
        { group_label: 'Housing', subtotalCents: 430000 },
        { group_label: null, subtotalCents: 1600 },
      ],
    });
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-recurring-distribution' })).toHaveLength(0);
  });

  it('creates a new payment with a client id and marks data dirty', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    // Open the add form.
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    // Fill label + amount.
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Internet');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('80');
    });
    // Save.
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });

    expect(mockCreateRecurringPayment).toHaveBeenCalledTimes(1);
    const [hid, payload] = mockCreateRecurringPayment.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(payload).toMatchObject({ id: 'rp-new-uuid', label: 'Internet', amount_cents: 8000 });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('blocks saving a payment with no name', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('50');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Missing name', expect.any(String));
    expect(mockCreateRecurringPayment).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('blocks saving a payment with no amount', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Water');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Missing amount', expect.any(String));
    expect(mockCreateRecurringPayment).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('edits an existing payment (group + day) and updates it', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    // Tap the seeded item to open its edit form.
    await act(async () => {
      root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
    });
    // Form prefilled from the item — EVERY editable field carries the existing
    // value (not just label/amount), so "Edit payment" opens populated.
    expect(root.findByProps({ testID: 'savings-recurring-form-label' }).props.value).toBe('Rent');
    expect(root.findByProps({ testID: 'savings-recurring-form-amount' }).props.value).toBe('1800');
    expect(root.findByProps({ testID: 'savings-recurring-form-day' }).props.value).toBe('1');
    expect(root.findByProps({ testID: 'savings-recurring-form-essential' }).props.value).toBe(true);
    expect(root.findByProps({ testID: 'savings-recurring-form-active' }).props.value).toBe(true);

    // Change the group via the picker (create a custom label) + the due day.
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-new' }).props.onChangeText('Home');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-create' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-day' }).props.onChangeText('5');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });

    expect(mockUpdateRecurringPayment).toHaveBeenCalledTimes(1);
    const [hid, id, payload] = mockUpdateRecurringPayment.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(id).toBe('rp-1');
    expect(payload).toMatchObject({ label: 'Rent', amount_cents: 180000, group_label: 'Home', day_of_month: 5 });
    expect(payload).not.toHaveProperty('category_id');
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  describe('Month scope', () => {
    it('defaults a new payment to the viewed month onward, not retroactively to all_year', async () => {
      // selectedMonth is mocked to 7 (July) — a brand-new payment must not
      // count against months that already closed (e.g. YTD), so it defaults
      // to custom_months=[7..12] rather than 'all_year'.
      const tree = await renderScreen();
      const root = tree.root;

      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Netflix');
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('20');
      });
      await act(async () => {
        await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
      });

      const [, payload] = mockCreateRecurringPayment.mock.calls[0];
      expect(payload).toMatchObject({
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [7, 8, 9, 10, 11, 12],
      });
    });

    it('lets a new payment be explicitly backdated to the entire year', async () => {
      const tree = await renderScreen();
      const root = tree.root;

      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Mortgage');
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('1500');
      });
      // Explicitly switch back to "Entire year" to backdate it.
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-scope-all-year' }).props.onPress();
      });
      await act(async () => {
        await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
      });

      const [, payload] = mockCreateRecurringPayment.mock.calls[0];
      expect(payload).toMatchObject({
        scope_type: 'all_year',
        scope_year: null,
        active_months: null,
      });
    });

    it('creates a payment scoped to specific months of the currently viewed year (2026)', async () => {
      const tree = await renderScreen();
      const root = tree.root;

      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('New gym membership');
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('60');
      });
      // Already custom_months=[7..12] by default (viewed month = July) — only
      // Mar–Jun need toggling ON to reach the full [3..12] range.
      for (const m of [3, 4, 5, 6]) {
        await act(async () => {
          root.findByProps({ testID: `savings-recurring-form-scope-month-${m}` }).props.onPress();
        });
      }
      await act(async () => {
        await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
      });

      const [, payload] = mockCreateRecurringPayment.mock.calls[0];
      expect(payload).toMatchObject({
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });
    });

    it('blocks saving "Specific months" with no month selected', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const tree = await renderScreen();
      const root = tree.root;

      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Camp');
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('40');
      });
      // A new payment defaults to custom_months=[7..12] (viewed month onward)
      // — deselect all of them to reach the empty-selection state.
      for (const m of [7, 8, 9, 10, 11, 12]) {
        await act(async () => {
          root.findByProps({ testID: `savings-recurring-form-scope-month-${m}` }).props.onPress();
        });
      }
      await act(async () => {
        await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
      });

      expect(alertSpy).toHaveBeenCalledWith('Select months', expect.any(String));
      expect(mockCreateRecurringPayment).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('opens edit prefilled with the payment\'s own custom scope for the currently viewed year', async () => {
      mockListRecurringPayments.mockResolvedValue({
        items: [
          {
            id: 'rp-gym',
            household_id: 'hh-test',
            category_id: null,
            label: 'New gym membership',
            amount_cents: 6000,
            currency: 'CAD',
            day_of_month: null,
            group_label: 'Health',
            is_essential: false,
            active: true,
            is_automated: false,
            scope_type: 'custom_months',
            scope_year: 2026,
            active_months: [3, 4, 5],
            source: 'manual',
            created_by: null,
            created_at: '',
            updated_at: '',
          },
        ],
        totalMonthlyCents: 6000,
        savedMonthlyIncomeCents: 0,
        byGroup: [{ group_label: 'Health', subtotalCents: 6000 }],
      });
      const tree = await renderScreen();
      const root = tree.root;

      await act(async () => {
        root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
      });

      // Months 3/4/5 are ON (checkmark colored teal), toggling 3 off then saving
      // should send exactly [4, 5].
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-scope-month-3' }).props.onPress();
      });
      await act(async () => {
        await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
      });

      const [, , payload] = mockUpdateRecurringPayment.mock.calls[0];
      expect(payload).toMatchObject({
        scope_type: 'custom_months',
        scope_year: 2026,
        active_months: [4, 5],
      });
    });

    it('leaves a DIFFERENT year\'s custom scope untouched when editing an unrelated field', async () => {
      // scope_year=2025 while the screen is viewing 2026 (mocked store above).
      mockListRecurringPayments.mockResolvedValue({
        items: [
          {
            id: 'rp-old-scope',
            household_id: 'hh-test',
            category_id: null,
            label: 'Old seasonal payment',
            amount_cents: 4500,
            currency: 'CAD',
            day_of_month: null,
            group_label: null,
            is_essential: false,
            active: true,
            is_automated: false,
            scope_type: 'custom_months',
            scope_year: 2025,
            active_months: [6, 7, 8],
            source: 'manual',
            created_by: null,
            created_at: '',
            updated_at: '',
          },
        ],
        totalMonthlyCents: 4500,
        savedMonthlyIncomeCents: 0,
        byGroup: [{ group_label: null, subtotalCents: 4500 }],
      });
      const tree = await renderScreen();
      const root = tree.root;

      await act(async () => {
        root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
      });

      // Form can't show/edit a foreign-year scope — it reads as "Entire year".
      // Renaming the payment and saving must NOT clear the 2025 scope.
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Renamed payment');
      });
      await act(async () => {
        await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
      });

      const [, , payload] = mockUpdateRecurringPayment.mock.calls[0];
      expect(payload).not.toHaveProperty('scope_type');
      expect(payload).not.toHaveProperty('scope_year');
      expect(payload).not.toHaveProperty('active_months');
    });

    it('shows a compact scope pill on a row for a payment scoped to specific months', async () => {
      mockListRecurringPayments.mockResolvedValue({
        items: [
          {
            id: 'rp-gym',
            household_id: 'hh-test',
            category_id: null,
            label: 'New gym membership',
            amount_cents: 6000,
            currency: 'CAD',
            day_of_month: null,
            group_label: 'Health',
            is_essential: false,
            active: true,
            is_automated: false,
            scope_type: 'custom_months',
            scope_year: 2026,
            active_months: [3, 4, 5, 6, 7, 8, 9],
            source: 'manual',
            created_by: null,
            created_at: '',
            updated_at: '',
          },
        ],
        totalMonthlyCents: 6000,
        savedMonthlyIncomeCents: 0,
        byGroup: [{ group_label: 'Health', subtotalCents: 6000 }],
      });
      const tree = await renderScreen();
      const root = tree.root;

      const pill = root.findByProps({ testID: 'savings-recurring-scope-pill' });
      expect(pill).toBeTruthy();
      const text = root
        .findAll((n) => typeof n.props?.children === 'string')
        .map((n) => n.props.children as string);
      expect(text.some((t) => t === 'Mar–Sep 2026')).toBe(true);
    });
  });

  describe('Autopay', () => {
    it('hides "Day of month" while Autopay is on, and sends is_automated + no day on create', async () => {
      const tree = await renderScreen();
      const root = tree.root;

      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
      });
      expect(root.findAllByProps({ testID: 'savings-recurring-form-day' }).length).toBeGreaterThan(0);

      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-automated' }).props.onValueChange(true);
      });
      expect(root.findAllByProps({ testID: 'savings-recurring-form-day' })).toHaveLength(0);

      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('IKEA 1');
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('379.21');
      });
      await act(async () => {
        await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
      });

      expect(mockCreateRecurringPayment).toHaveBeenCalledTimes(1);
      const [, payload] = mockCreateRecurringPayment.mock.calls[0];
      expect(payload).toMatchObject({ is_automated: true, day_of_month: null });
    });

    it('clears an already-typed day when Autopay is switched on', async () => {
      const tree = await renderScreen();
      const root = tree.root;

      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-day' }).props.onChangeText('15');
      });
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-automated' }).props.onValueChange(true);
      });
      // Field is hidden now — flip Autopay back off to inspect it was cleared.
      await act(async () => {
        root.findByProps({ testID: 'savings-recurring-form-automated' }).props.onValueChange(false);
      });
      expect(root.findByProps({ testID: 'savings-recurring-form-day' }).props.value).toBe('');
    });

    it('opens edit already on for an automated payment, with no day field', async () => {
      mockListRecurringPayments.mockResolvedValue({
        items: [
          {
            id: 'rp-1',
            household_id: 'hh-test',
            category_id: null,
            label: 'IKEA 1',
            amount_cents: 37921,
            currency: 'CAD',
            day_of_month: null,
            group_label: 'Loans & Debt',
            is_essential: false,
            active: true,
            is_automated: true,
            source: 'manual',
            created_by: null,
            created_at: '',
            updated_at: '',
          },
        ],
        totalMonthlyCents: 37921,
        savedMonthlyIncomeCents: 0,
        byGroup: [{ group_label: 'Loans & Debt', subtotalCents: 37921 }],
      });

      const tree = await renderScreen();
      const root = tree.root;
      await act(async () => {
        root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
      });

      expect(root.findByProps({ testID: 'savings-recurring-form-automated' }).props.value).toBe(true);
      expect(root.findAllByProps({ testID: 'savings-recurring-form-day' })).toHaveLength(0);
    });
  });

  it('renders a "Renews in N days" pill for an item with a tracked renewal', async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    mockListRecurringPayments.mockResolvedValue({
      items: [
        {
          id: 'rp-1',
          household_id: 'hh-test',
          category_id: null,
          label: 'Condo insurance',
          amount_cents: 5000,
          currency: 'CAD',
          day_of_month: null,
          group_label: 'Insurance',
          is_essential: false,
          active: true,
          source: 'manual',
          created_by: null,
          created_at: '',
          updated_at: '',
          renewal_summary: {
            next_renewal_date: soon.toISOString().slice(0, 10),
            status: 'upcoming',
            reminder_lead_days: 14,
          },
        },
      ],
      totalMonthlyCents: 5000,
      savedMonthlyIncomeCents: 0,
      byGroup: [{ group_label: 'Insurance', subtotalCents: 5000 }],
    });

    const tree = await renderScreen();
    const pill = tree.root.findByProps({ testID: 'savings-recurring-renewal-pill' });
    expect(pill).toBeTruthy();
    const text = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string);
    expect(text.some((t) => /^Renews in \d+ days?$/.test(t))).toBe(true);
  });

  it('does not render a renewal pill for an item with no tracked renewal', async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-recurring-renewal-pill' })).toHaveLength(0);
  });

  const LOAN_ITEM = {
    id: 'rp-1',
    household_id: 'hh-test',
    category_id: null,
    label: 'Car loan',
    amount_cents: 45000,
    currency: 'CAD',
    day_of_month: null,
    group_label: 'Loans & Debt',
    is_essential: false,
    active: true,
    source: 'manual' as const,
    created_by: null,
    created_at: '',
    updated_at: '',
    loan_summary: {
      termMonths: 60,
      elapsedMonths: 24,
      paymentsRemaining: 36,
      currentBalanceCents: 1_100_000,
      interestPaidToDateCents: 90_000,
      totalInterestCents: 300_000,
      totalCostCents: 2_100_000,
      payoffDate: '2029-01-15',
    },
  };

  function mockLoanItemView() {
    mockListRecurringPayments.mockResolvedValue({
      items: [LOAN_ITEM],
      totalMonthlyCents: 45000,
      savedMonthlyIncomeCents: 0,
      byGroup: [{ group_label: 'Loans & Debt', subtotalCents: 45000 }],
    });
  }

  it('does not render a loan progress card in the list — tapping the row opens the edit form instead', async () => {
    mockLoanItemView();
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-recurring-loan-card' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'savings-recurring-loan-progress-bar' })).toHaveLength(0);
  });

  it('does not show an "Interest free" badge for a tracked loan that accrues interest', async () => {
    mockLoanItemView();
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: 'savings-recurring-interest-free-badge' })).toHaveLength(0);
  });

  it('shows an "Interest free" badge for a 0% tracked loan', async () => {
    mockListRecurringPayments.mockResolvedValue({
      items: [
        {
          ...LOAN_ITEM,
          id: 'rp-zero',
          label: 'IKEA financing',
          loan_summary: { ...LOAN_ITEM.loan_summary, interestPaidToDateCents: 0, totalInterestCents: 0 },
        },
      ],
      totalMonthlyCents: 45000,
      savedMonthlyIncomeCents: 0,
      byGroup: [{ group_label: 'Loans & Debt', subtotalCents: 45000 }],
    });
    const tree = await renderScreen();
    expect(tree.root.findByProps({ testID: 'savings-recurring-interest-free-badge' })).toBeTruthy();
    const texts = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string);
    expect(texts).toContain('Interest free');
  });

  it('tapping a loan-tracked row opens the edit modal directly, pre-filled for that item', async () => {
    mockLoanItemView();
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
    });

    expect(root.findByProps({ testID: 'savings-recurring-form-save' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-recurring-form-label' }).props.value).toBe('Car loan');
    expect(root.findByProps({ testID: 'savings-recurring-form-amount' }).props.value).toBe('450');
  });

  it('tapping a non-loan row still opens the edit modal directly (regression)', async () => {
    // Default fixture (Rent) carries no loan_summary — unaffected by the loan-tracked-row change above.
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
    });

    expect(root.findByProps({ testID: 'savings-recurring-form-save' })).toBeTruthy();
  });

  describe('focusItemId (opened via the Savings-tab quick-view sheet\'s Edit button)', () => {
    it('auto-opens the full edit form for a non-loan item — same as tapping its row', async () => {
      mockRouteParams = { focusItemId: 'rp-1' };
      const tree = await renderScreen();
      const root = tree.root;

      expect(root.findByProps({ testID: 'savings-recurring-form-save' })).toBeTruthy();
      expect(root.findByProps({ testID: 'savings-recurring-form-label' }).props.value).toBe('Rent');
      // Consumed once so it can't re-fire on an unrelated re-render.
      expect(mockSetParams).toHaveBeenCalledWith({ focusItemId: undefined });
    });

    it('auto-opens the full edit form for a loan-tracked item too — same as tapping its row', async () => {
      mockLoanItemView();
      mockRouteParams = { focusItemId: 'rp-1' };
      const tree = await renderScreen();
      const root = tree.root;

      expect(root.findByProps({ testID: 'savings-recurring-form-save' })).toBeTruthy();
      expect(root.findByProps({ testID: 'savings-recurring-form-label' }).props.value).toBe('Car loan');
    });

    it('does nothing when the focused id is not in the loaded list', async () => {
      mockRouteParams = { focusItemId: 'rp-does-not-exist' };
      const tree = await renderScreen();
      const root = tree.root;

      expect(root.findAllByProps({ testID: 'savings-recurring-form-save' })).toHaveLength(0);
    });
  });

  it('offers renewal tracking only when editing an EXISTING payment, not when creating one', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    // Creating: no recurring_payment_id yet to attach a renewal to.
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    expect(root.findAllByProps({ testID: 'renewal-tracking-toggle' })).toHaveLength(0);
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-cancel' }).props.onPress();
    });

    // Editing: the section appears and fetches this payment's renewal.
    await act(async () => {
      root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
    });
    expect(root.findByProps({ testID: 'renewal-tracking-toggle' })).toBeTruthy();
    expect(mockGetRenewal).toHaveBeenCalledWith('hh-test', 'rp-1');
  });

  it('offers loan tracking both when creating (Group defaults to "Loans & Debt") and when editing an existing payment', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    // Creating: no recurring_payment_id yet to attach a loan to, but the
    // draft section still shows because Group defaults to "Loans & Debt".
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    expect(root.findByProps({ testID: 'loan-tracking-toggle' })).toBeTruthy();
    // Draft mode — nothing exists yet, so there's no GET to make.
    expect(mockGetLoan).not.toHaveBeenCalled();
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-cancel' }).props.onPress();
    });

    // Editing: the section appears and fetches this payment's loan.
    await act(async () => {
      root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
    });
    expect(root.findByProps({ testID: 'loan-tracking-toggle' })).toBeTruthy();
    expect(mockGetLoan).toHaveBeenCalledWith('hh-test', 'rp-1');
  });

  it('hides the loan draft section when a new payment is moved OFF "Loans & Debt", and shows it again when moved back', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    // Group defaults to "Loans & Debt" — the draft section shows immediately.
    expect(root.findByProps({ testID: 'loan-tracking-toggle' })).toBeTruthy();

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-Subscriptions' }).props.onPress();
    });
    expect(root.findAllByProps({ testID: 'loan-tracking-toggle' })).toHaveLength(0);

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-Loans & Debt' }).props.onPress();
    });
    expect(root.findByProps({ testID: 'loan-tracking-toggle' })).toBeTruthy();
    expect(mockGetLoan).not.toHaveBeenCalled();
  });

  it('creates both the payment and the loan when the draft "Track as a loan" toggle is on', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Car loan');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('450');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-Loans & Debt' }).props.onPress();
    });
    // Tracking is already on — Group = "Loans & Debt" auto-enables it, no
    // extra tap needed — so the fields are already visible here.
    await act(async () => {
      root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'loan-principal' }).props.onChangeText('27000');
    });
    await act(async () => {
      root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('60');
    });
    await act(async () => {
      root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
    });

    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });

    expect(mockCreateRecurringPayment).toHaveBeenCalledTimes(1);
    const [hid, payload] = mockCreateRecurringPayment.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(payload).toMatchObject({ id: 'rp-new-uuid', label: 'Car loan', group_label: 'Loans & Debt' });

    expect(mockUpsertLoan).toHaveBeenCalledWith(
      'hh-test',
      'rp-new-uuid',
      expect.objectContaining({
        rate_type: 'zero',
        rate_bps: 0,
        principal_cents: 2_700_000,
        term_months: 60,
        start_date: '2026-01-15',
      })
    );
    expect(mockMarkDirty).toHaveBeenCalled();
    // Both saves succeeded — the form closes.
    expect(root.findAllByProps({ testID: 'savings-recurring-form-save' })).toHaveLength(0);
  });

  it('creates only the payment when the draft "Track as a loan" toggle is turned back off', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Netflix');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('16');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-Loans & Debt' }).props.onPress();
    });
    // Group = "Loans & Debt" auto-enables tracking — the member declines it
    // by flipping the switch back off (it's a plain toggle, not a one-way gate).
    await act(async () => {
      root.findByProps({ testID: 'loan-tracking-switch' }).props.onValueChange(false);
    });

    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });

    expect(mockCreateRecurringPayment).toHaveBeenCalledTimes(1);
    expect(mockUpsertLoan).not.toHaveBeenCalled();
    expect(root.findAllByProps({ testID: 'savings-recurring-form-save' })).toHaveLength(0);
  });

  it('creates the payment but keeps the form open (now editing it) when the draft loan fields are invalid', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Car loan');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('450');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-Loans & Debt' }).props.onPress();
    });
    // Tracking is already on — Group = "Loans & Debt" auto-enables it.
    // Principal left blank — invalid; rate type defaults to 'fixed' with no
    // rate either, but principal is checked first.

    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });

    // The payment itself is created regardless...
    expect(mockCreateRecurringPayment).toHaveBeenCalledTimes(1);
    // ...but the loan is never saved, and the form stays open so the member
    // can fix the loan fields — it's now editing the just-created payment.
    expect(mockUpsertLoan).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Loan details', expect.stringContaining('Missing principal'));
    expect(root.findAllByProps({ testID: 'savings-recurring-form-save' }).length).toBeGreaterThan(0);
    expect(root.findByProps({ testID: 'savings-recurring-form-label' }).props.value).toBe('Car loan');
    alertSpy.mockRestore();
  });

  it('closes the form but shows a distinct alert when only the loan (not the payment) fails to save', async () => {
    mockUpsertLoan.mockRejectedValue(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Car loan');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('450');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-Loans & Debt' }).props.onPress();
    });
    // Tracking is already on — Group = "Loans & Debt" auto-enables it.
    await act(async () => {
      root.findByProps({ testID: 'loan-rate-type-zero' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'loan-principal' }).props.onChangeText('27000');
    });
    await act(async () => {
      root.findByProps({ testID: 'loan-term-months' }).props.onChangeText('60');
    });
    await act(async () => {
      root.findByProps({ testID: 'loan-start-date' }).props.onChangeText('2026-01-15');
    });

    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });

    expect(mockCreateRecurringPayment).toHaveBeenCalledTimes(1);
    expect(mockUpsertLoan).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Payment saved', expect.stringContaining('could not be saved'));
    expect(alertSpy).not.toHaveBeenCalledWith('Error', expect.any(String));
    // The payment itself saved fine, so the form still closes.
    expect(root.findAllByProps({ testID: 'savings-recurring-form-save' })).toHaveLength(0);
    alertSpy.mockRestore();
  });

  // Regression guard: the edit sheet's ScrollView must be content-sized
  // (`flexShrink`), never `flex: 1`. A `flex: 1` scroll inside the content-sized
  // bottom sheet collapses to 0 height and the entire form goes invisible.
  it('edit form scroll is content-sized (flexShrink), not a collapsing flex:1', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
    });
    // The form's ScrollView is the one wrapping the label field.
    const label = root.findByProps({ testID: 'savings-recurring-form-label' });
    const formScroll = root
      .findAllByType(ScrollView)
      .find((sv) => sv.findAllByProps({ testID: 'savings-recurring-form-label' }).length > 0);
    expect(formScroll).toBeTruthy();
    expect(label).toBeTruthy();
    const flat = StyleSheet.flatten(formScroll!.props.style) ?? {};
    expect(flat.flexShrink).toBe(1);
    expect(flat.flex).toBeUndefined();
  });

  it('toggles a payment active state via the row switch', async () => {
    mockUpdateRecurringPayment.mockResolvedValue({ item: {} });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-toggle' }).props.onValueChange(false);
      await Promise.resolve();
    });
    expect(mockUpdateRecurringPayment).toHaveBeenCalledWith('hh-test', 'rp-1', { active: false });
    expect(mockMarkDirty).toHaveBeenCalled();
  });

  it('draws the row switch ON for an active payment', async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByType(Switch).map((s) => s.props.value)).toEqual([true]);
  });

  it('draws the row switch ON for a legacy row whose active flag is SQLite 1', async () => {
    // The regression: RN's Switch renders `value === true` strictly, so a `1`
    // drew every toggle OFF while the very same row was counted in the group
    // subtotal and rendered in full-strength text — Monthly Payments showed
    // $9,252 of active payments with every switch off.
    mockListRecurringPayments.mockResolvedValue({
      items: [
        {
          id: 'rp-1',
          household_id: 'hh-test',
          category_id: null,
          label: 'Mortgage Home',
          amount_cents: 434000,
          currency: 'CAD',
          day_of_month: 1,
          group_label: 'Housing',
          is_essential: 1,
          active: 1,
          is_automated: 0,
          source: 'manual',
          created_by: null,
          created_at: '',
          updated_at: '',
        },
      ],
      totalMonthlyCents: 434000,
      savedMonthlyIncomeCents: 500000,
      byGroup: [{ group_label: 'Housing', subtotalCents: 434000 }],
    });
    const tree = await renderScreen();
    expect(tree.root.findAllByType(Switch).map((s) => s.props.value)).toEqual([true]);
  });

  it('draws the row switch OFF for an inactive payment', async () => {
    mockListRecurringPayments.mockResolvedValue({
      items: [
        {
          id: 'rp-1',
          household_id: 'hh-test',
          category_id: null,
          label: 'Old gym',
          amount_cents: 5000,
          currency: 'CAD',
          day_of_month: null,
          group_label: 'Health',
          is_essential: false,
          active: false,
          is_automated: false,
          source: 'manual',
          created_by: null,
          created_at: '',
          updated_at: '',
        },
      ],
      totalMonthlyCents: 0,
      savedMonthlyIncomeCents: 500000,
      // An inactive-only group is absent from the BE subtotals, so the row is
      // never rendered — the switch count is the assertion.
      byGroup: [{ group_label: 'Health', subtotalCents: 0 }],
    });
    const tree = await renderScreen();
    expect(tree.root.findAllByType(Switch).map((s) => s.props.value)).toEqual([false]);
  });

  it('deletes a payment from the edit form', async () => {
    mockDeleteRecurringPayment.mockResolvedValue({});
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t: unknown, _m: unknown, buttons?: unknown) => {
        const list = (buttons as { style?: string; onPress?: () => void }[]) ?? [];
        list.find((b) => b.style === 'destructive')?.onPress?.();
      });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-delete' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockDeleteRecurringPayment).toHaveBeenCalledWith('hh-test', 'rp-1');
    expect(mockMarkDirty).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('swallows a load error without crashing', async () => {
    mockListRecurringPayments.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    // With no view, the empty-state copy shows.
    const texts = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string);
    expect(texts.some((t) => t.includes('No monthly payments yet'))).toBe(true);
  });

  it('goes back from the header back button', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-recurring-back' }).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('navigates to the AI import screen from the add menu', async () => {
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'savings-recurring-add-import' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SavingsImport', { scope: 'recurring' });
  });

  it('long-pressing a row prompts to delete it', async () => {
    mockDeleteRecurringPayment.mockResolvedValue({});
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t: unknown, _m: unknown, buttons?: unknown) => {
        const list = (buttons as { style?: string; onPress?: () => void }[]) ?? [];
        list.find((b) => b.style === 'destructive')?.onPress?.();
      });
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onLongPress();
      await Promise.resolve();
    });
    expect(mockDeleteRecurringPayment).toHaveBeenCalledWith('hh-test', 'rp-1');
    alertSpy.mockRestore();
  });

  it('toggles the essential and active switches in the form', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-essential' }).props.onValueChange(true);
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-active' }).props.onValueChange(false);
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Gym');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('50');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });
    const [, payload] = mockCreateRecurringPayment.mock.calls[0];
    expect(payload).toMatchObject({ is_essential: true, active: false });
  });

  it('alerts when saving a payment fails', async () => {
    mockCreateRecurringPayment.mockRejectedValue(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('X');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('10');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('save'));
    alertSpy.mockRestore();
  });

  it('alerts when toggling active fails', async () => {
    mockUpdateRecurringPayment.mockRejectedValue(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    await act(async () => {
      await tree.root.findByProps({ testID: 'savings-recurring-toggle' }).props.onValueChange(false);
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('update'));
    alertSpy.mockRestore();
  });

  it('alerts when deleting a payment fails', async () => {
    mockDeleteRecurringPayment.mockRejectedValue(new Error('boom'));
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t: unknown, _m: unknown, buttons?: unknown) => {
        const list = (buttons as { style?: string; onPress?: () => void }[]) ?? [];
        list.find((b) => b.style === 'destructive')?.onPress?.();
      });
    const tree = await renderScreen();
    await act(async () => {
      tree.root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onLongPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((alertSpy as jest.Mock).mock.calls.some((c) => c[0] === 'Error')).toBe(true);
    alertSpy.mockRestore();
  });

  it('ignores a form close while a save is in flight', async () => {
    let resolveCreate: (v: unknown) => void = () => {};
    mockCreateRecurringPayment.mockImplementation(
      () => new Promise((res) => { resolveCreate = res; })
    );
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Rent');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('100');
    });
    // Start the save (isSubmitting = true) but don't resolve yet.
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });
    // Cancel is a no-op while submitting → the form is still mounted.
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-cancel' }).props.onPress();
    });
    expect(root.findAllByProps({ testID: 'savings-recurring-form-save' }).length).toBeGreaterThan(0);
    // Let it finish.
    await act(async () => {
      resolveCreate({ item: {} });
      await Promise.resolve();
    });
  });

  it('formats sub-$1000 payment amounts as whole dollars', async () => {
    mockListRecurringPayments.mockResolvedValue({
      items: [
        {
          id: 'rp-small',
          household_id: 'hh-test',
          category_id: null,
          label: 'Netflix',
          amount_cents: 1600,
          currency: 'CAD',
          day_of_month: null,
          group_label: null,
          is_essential: false,
          active: true,
          source: 'manual',
          created_by: null,
          created_at: '',
          updated_at: '',
        },
      ],
      totalMonthlyCents: 1600,
      savedMonthlyIncomeCents: 0,
      byGroup: [{ group_label: null, subtotalCents: 1600 }],
    });
    const tree = await renderScreen();
    const texts = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string);
    expect(texts).toContain('$16');
  });

  it('closes the form via Cancel when idle', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    expect(root.findAllByProps({ testID: 'savings-recurring-form-save' }).length).toBeGreaterThan(0);
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-cancel' }).props.onPress();
    });
    expect(root.findAllByProps({ testID: 'savings-recurring-form-save' })).toHaveLength(0);
  });

  // The menu is a `BottomSheet` now (it has to be — as a plain in-screen overlay
  // the tab bar and the chat FAB drew over its rows), so it is dismissed by the
  // sheet's own ✕ rather than the bespoke backdrop it used to carry.
  it('closes the add menu via its close button without opening the form', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    expect(root.findAllByProps({ testID: 'savings-recurring-add-manual' }).length).toBeGreaterThan(0);
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-close' }).props.onPress();
    });
    expect(root.findAllByProps({ testID: 'savings-recurring-add-manual' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'savings-recurring-form-save' })).toHaveLength(0);
  });

  it('assigns a predefined group to a new payment (no category field)', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Internet');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('80');
    });
    // Open the group picker and pick a predefined group.
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-Utilities' }).props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });

    const [, payload] = mockCreateRecurringPayment.mock.calls[0];
    expect(payload).toMatchObject({ group_label: 'Utilities' });
    // Categories are gone entirely.
    expect(payload).not.toHaveProperty('category_id');
    expect(root.findAllByProps({ testID: 'savings-recurring-form-category' })).toHaveLength(0);
  });

  it('renders the group picker INSIDE the form modal, not as a sibling modal', async () => {
    // Regression: the picker used to be a second <Modal> sibling to the form modal.
    // iOS presents only one modal per view controller, so tapping "No group ›" flipped
    // state but the picker never appeared ("Group dropdown not available"). The picker
    // must render within the form modal's subtree so it presents reliably.
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });

    // The Modal that hosts the form (identified by a field only it contains).
    const formModal = root.findAllByType(Modal).find((m) => {
      try {
        m.findByProps({ testID: 'savings-recurring-form-save' });
        return true;
      } catch {
        return false;
      }
    });
    expect(formModal).toBeTruthy();

    // The open picker's options must live inside that same modal — not a sibling one.
    expect(
      formModal!.findAllByProps({ testID: 'savings-recurring-group-Utilities' }).length
    ).toBeGreaterThan(0);
  });

  it('creates a custom group inline and assigns it to the payment', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-add-manual' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Boat loan');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('40');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-group' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-new' }).props.onChangeText('Toys');
    });
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-group-create' }).props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });
    const [, payload] = mockCreateRecurringPayment.mock.calls[0];
    expect(payload).toMatchObject({ group_label: 'Toys' });
  });

  it('prompts for scope and propagates an edited amount to applied months', async () => {
    mockGetRecurringApplyStatus.mockResolvedValue({
      months: [
        { month: 7, applied: true, appliedCents: 180000, appliedCount: 1, matchesCurrent: true },
      ],
    });
    mockPropagateRecurringPayment.mockResolvedValue({ updated: 6 });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;

    // Open the edit form for the seeded payment and flush the apply-status load.
    await act(async () => {
      root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Change the amount, then save.
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-amount' }).props.onChangeText('2000');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });

    expect(mockUpdateRecurringPayment).toHaveBeenCalled();
    // The scope prompt fired; choosing "This & future months" propagates Jul→Dec.
    const scopeCall = (alertSpy as jest.Mock).mock.calls.find(
      (c) => c[0] === 'Apply change to added months?'
    );
    expect(scopeCall).toBeTruthy();
    const buttons = scopeCall![2] as { text: string; onPress?: () => void }[];
    const future = buttons.find((b) => b.text === 'This & future months');
    await act(async () => {
      await future?.onPress?.();
    });
    expect(mockPropagateRecurringPayment).toHaveBeenCalledWith('hh-test', 'rp-1', {
      year: 2026,
      fromMonth: 7,
      toMonth: 12,
    });
    alertSpy.mockRestore();
  });

  it('skips the scope prompt when only the name changed on an applied payment', async () => {
    mockGetRecurringApplyStatus.mockResolvedValue({
      months: [
        { month: 7, applied: true, appliedCents: 180000, appliedCount: 1, matchesCurrent: true },
      ],
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findAllByProps({ testID: 'savings-recurring-item' })[0].props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Rename only — amount untouched.
    await act(async () => {
      root.findByProps({ testID: 'savings-recurring-form-label' }).props.onChangeText('Rent (new)');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-recurring-form-save' }).props.onPress();
    });

    expect(mockUpdateRecurringPayment).toHaveBeenCalled();
    expect(mockPropagateRecurringPayment).not.toHaveBeenCalled();
    expect(
      (alertSpy as jest.Mock).mock.calls.some((c) => c[0] === 'Apply change to added months?')
    ).toBe(false);
    alertSpy.mockRestore();
  });
});
