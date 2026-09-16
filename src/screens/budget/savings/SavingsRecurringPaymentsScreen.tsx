import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { budgetLoansApi } from '@api/budgetLoans';
import {
  savingsApi,
  type RecurringPaymentsView,
  type SavingsRecurringPayment,
} from '@api/savings';
import { AdaptiveModal, AppBackground, HeaderActionButton, OverlaySheetHeader, SafeAreaView, ScreenHeader, SheetHeader, screenScrollViewStyle } from '@components/common';
import { BottomSheet, TextInput, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import type { BudgetStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { CornerRadius, Header, hexToRgba, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { seriesColor } from '@theme/chartPalette';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { LoanDraftSection, type LoanDraftSectionHandle } from './LoanDraftSection';
import { LoanInfoSection } from './LoanInfoSection';
import { centsToDollarsInput, loanCardInfo } from './loanShared';
import { RenewalReminderSection } from './RenewalReminderSection';

type Nav = NativeStackNavigationProp<BudgetStackParamList>;

function toCents(dollars: string): number | null {
  const cleaned = dollars.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

/** "Renews in N days" / "Renewal overdue" pill copy + tone for a tracked renewal. */
function renewalPillInfo(
  summary: SavingsRecurringPayment['renewal_summary'],
  colors: ReturnType<typeof useAppColors>
): { label: string; tone: string } | null {
  if (!summary || summary.status !== 'upcoming') return null;
  const daysLeft = Math.ceil(
    (new Date(`${summary.next_renewal_date}T00:00:00Z`).getTime() - Date.now()) / 86_400_000
  );
  if (daysLeft < 0) return { label: 'Renewal overdue', tone: colors.error };
  if (daysLeft === 0) return { label: 'Renews today', tone: colors.error };
  if (daysLeft <= summary.reminder_lead_days) {
    return { label: `Renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, tone: colors.warning };
  }
  return { label: `Renews in ${daysLeft} days`, tone: colors.textSecondary };
}

function toDayOfMonth(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  const value = Number.parseInt(cleaned, 10);
  if (Number.isNaN(value)) return null;
  return Math.min(31, Math.max(1, value));
}

interface FormState {
  id: string | null; // null = create, else editing
  label: string;
  amount: string; // dollars
  dayOfMonth: string;
  groupLabel: string;
  isEssential: boolean;
  active: boolean;
  /** Autopay — while on, "Day of month" is hidden and cleared; no due-day nudge needed. */
  isAutomated: boolean;
  /**
   * Month scope — 'all_year' (default) runs the payment every month.
   * 'custom_months' restricts it to `activeMonths` of the currently viewed
   * year (a payment that started or ended mid-year); other years still run
   * all 12 months.
   */
  scopeType: 'all_year' | 'custom_months';
  activeMonths: Set<number>;
}

const EMPTY_FORM: FormState = {
  id: null,
  label: '',
  amount: '',
  dayOfMonth: '',
  groupLabel: 'Loans & Debt',
  isEssential: false,
  active: true,
  isAutomated: false,
  scopeType: 'all_year',
  activeMonths: new Set(),
};

const UNGROUPED_KEY = '__ungrouped__';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** "Mar–Sep 2026" / "Mar, Nov 2026" / "6 months · 2026" — compact scope pill copy. */
function formatActiveMonths(months: number[], year: number): string {
  const sorted = [...months].sort((a, b) => a - b);
  if (sorted.length === 0) return `${year}`;
  if (sorted.length === 1) return `${MONTHS_SHORT[sorted[0] - 1]} ${year}`;
  const isContiguous = sorted.every((m, i) => i === 0 || m === sorted[i - 1] + 1);
  if (isContiguous) {
    return `${MONTHS_SHORT[sorted[0] - 1]}–${MONTHS_SHORT[sorted[sorted.length - 1] - 1]} ${year}`;
  }
  return `${sorted.length} months · ${year}`;
}

/**
 * Built-in groups every household starts with. Groups are just a label on each
 * payment (no separate table) — the picker offers these plus any custom label
 * already in use, and "create custom" simply types a new one. The list view
 * groups + subtotals by this same label.
 */
const PREDEFINED_GROUPS = [
  'Housing',
  'Utilities',
  'Subscriptions',
  'Transportation',
  'Insurance',
  'Loans & Debt',
  'Food & Groceries',
  'Health',
  'Childcare & Education',
  'Savings & Investments',
  'Other',
];

export function SavingsRecurringPaymentsScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<BudgetStackParamList, 'SavingsRecurringPayments'>>();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, dataRevision, markDirty } = useSavingsStore();
  // The group picker is a bottom-anchored sheet inside this screen's modal, so an
  // open keypad lands on top of its "New group name" field. Lift it by the inset.
  const keyboardInset = useKeyboardInset();

  const [view, setView] = useState<RecurringPaymentsView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // "+" opens this small menu (Add manually / Import with AI) rather than
  // jumping straight into the create form — the AI import route needs its own
  // entry point too, and both belong under the one "+" affordance.
  const [addMenuVisible, setAddMenuVisible] = useState(false);

  const [formVisible, setFormVisible] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Set by `LoanInfoSection`'s/`LoanDraftSection`'s `onScanningChange` while a
  // "Fill with AI" loan extract is in flight — its own overlay only covers its
  // own bounds (it's `embedded`, not a real Modal, since it's nested inside
  // THIS form's Modal), so Save/Delete/close here must be disabled from up
  // here instead.
  const [loanScanning, setLoanScanning] = useState(false);

  // While creating a NEW payment with Group = "Loans & Debt", `LoanDraftSection`
  // holds the "track as a loan" fields with no id to attach to yet — read via
  // this ref in `handleSubmit` right after the new payment itself is created.
  const loanDraftRef = useRef<LoanDraftSectionHandle>(null);

  // `LoanInfoSection`/`LoanDraftSection` only own the loan-specific fields
  // (principal/rate/term/…) — a "Fill with AI" extract's monthly payment /
  // due day belong to THIS screen's own "Monthly amount" / "Day of month"
  // fields one level up, so they report back here via this callback instead
  // of trying to own state that isn't theirs.
  const handleExtractedLoanPayment = useCallback(
    (fields: { amountCents: number | null; dueDayOfMonth: number | null }) => {
      setForm((f) => ({
        ...f,
        amount: fields.amountCents != null ? centsToDollarsInput(fields.amountCents) : f.amount,
        dayOfMonth: fields.dueDayOfMonth != null ? String(fields.dueDayOfMonth) : f.dayOfMonth,
      }));
    },
    []
  );

  // Group picker + inline "create custom group" state.
  const [groupPickerVisible, setGroupPickerVisible] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // Baseline amount for the payment being edited + which months of the selected
  // year already carry applied payments — together they decide whether editing
  // the amount should offer the "apply to which months" scope prompt.
  const [editBaselineAmount, setEditBaselineAmount] = useState<number | null>(null);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [appliedMonths, setAppliedMonths] = useState<number[]>([]);

  // True when the payment being edited already carries a custom month scope
  // for a DIFFERENT year than the one currently in view. The form can only
  // show/edit the scope for `selectedYear`, so a foreign-year scope must be
  // left untouched on save rather than silently cleared by the form's own
  // (unrelated-year) "Entire year" default.
  const [foreignScope, setForeignScope] = useState(false);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const data = await savingsApi.listRecurringPayments(
        currentHousehold.id,
        selectedYear,
        selectedMonth
      );
      setView(data);
    } catch (error) {
      console.error('Error loading recurring payments:', error);
    }
  }, [currentHousehold?.id, selectedYear, selectedMonth]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
    // Reload whenever a mutation bumps dataRevision.
  }, [load, dataRevision]);

  // Predefined groups + any custom label already in use across the household's
  // payments (deduped, predefined first). Backs the group picker.
  const availableGroups = useMemo(() => {
    const inUse = new Set<string>();
    for (const item of view?.items ?? []) {
      const g = item.group_label?.trim();
      if (g) inUse.add(g);
    }
    const custom = [...inUse].filter((g) => !PREDEFINED_GROUPS.includes(g)).sort();
    return [...PREDEFINED_GROUPS, ...custom];
  }, [view]);

  // Group rows by their BE-provided group_label; render BE subtotals per group.
  const groups = useMemo(() => {
    if (!view) return [];
    const byKey = new Map<string, SavingsRecurringPayment[]>();
    for (const item of view.items) {
      const key = item.group_label ?? UNGROUPED_KEY;
      const list = byKey.get(key) ?? [];
      list.push(item);
      byKey.set(key, list);
    }
    return view.byGroup.map((g) => ({
      key: g.group_label ?? UNGROUPED_KEY,
      label: g.group_label ?? 'Other',
      subtotalCents: g.subtotalCents,
      items: byKey.get(g.group_label ?? UNGROUPED_KEY) ?? [],
    }));
  }, [view]);

  const openCreate = () => {
    // A brand-new payment defaults to "this month onward" rather than
    // 'all_year' — so adding it today doesn't retroactively count against
    // months that already closed (e.g. YTD). Users can still switch the
    // toggle to "Entire year" to explicitly backdate it.
    const remainingMonths = Array.from(
      { length: 12 - selectedMonth + 1 },
      (_, i) => selectedMonth + i
    );
    setForm({
      ...EMPTY_FORM,
      scopeType: selectedMonth === 1 ? 'all_year' : 'custom_months',
      activeMonths: selectedMonth === 1 ? new Set<number>() : new Set(remainingMonths),
    });
    setEditBaselineAmount(null);
    setIsEditingExisting(false);
    setAppliedMonths([]);
    setForeignScope(false);
    setFormVisible(true);
  };

  /**
   * Run an add-menu choice only AFTER the menu's sheet has actually closed.
   *
   * iOS presents one modal per view controller, so flipping the menu shut and
   * the form's `AdaptiveModal` open in the SAME commit silently drops the form
   * — the identical trap the group picker below documents, and the reason the
   * menu could not simply call `openCreate()` inline once it became a Modal.
   * The choice is parked in a ref, the sheet closes on this commit, and the
   * effect below acts on it on the next one. A ref (not state) because it must
   * not itself trigger a render, and the null-out makes it fire exactly once.
   */
  const pendingAddRef = useRef<'manual' | 'import' | null>(null);

  const requestAddAction = (action: 'manual' | 'import') => {
    pendingAddRef.current = action;
    setAddMenuVisible(false);
  };

  useEffect(() => {
    if (addMenuVisible) return;
    const action = pendingAddRef.current;
    if (!action) return;
    pendingAddRef.current = null;
    if (action === 'manual') {
      openCreate();
    } else {
      navigation.navigate('SavingsImport', { scope: 'recurring' });
    }
    // `openCreate` is re-created every render; the ref guard above already makes
    // this body run exactly once per choice, so it is deliberately not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMenuVisible]);

  const openEdit = (item: SavingsRecurringPayment) => {
    // A custom scope belonging to a DIFFERENT year than the one currently in
    // view can't be shown/edited by this form (it only knows `selectedYear`)
    // — flag it so submit leaves it untouched instead of clearing it.
    const isForeignScope = item.scope_type === 'custom_months' && item.scope_year !== selectedYear;
    setForeignScope(isForeignScope);
    setForm({
      id: item.id,
      label: item.label,
      amount: item.amount_cents ? (item.amount_cents / 100).toString() : '',
      dayOfMonth: item.day_of_month != null ? String(item.day_of_month) : '',
      groupLabel: item.group_label ?? '',
      isEssential: item.is_essential,
      active: item.active,
      isAutomated: item.is_automated,
      scopeType: item.scope_type === 'custom_months' && !isForeignScope ? 'custom_months' : 'all_year',
      activeMonths: new Set(isForeignScope ? [] : (item.active_months ?? [])),
    });
    setEditBaselineAmount(item.amount_cents);
    setIsEditingExisting(true);
    setFormVisible(true);

    // Which months of the current year already carry applied payments — so on
    // save we only offer the scope prompt when there's something to update.
    if (currentHousehold?.id) {
      savingsApi
        .getRecurringApplyStatus(currentHousehold.id, selectedYear)
        .then((status) =>
          setAppliedMonths(status.months.filter((m) => m.applied).map((m) => m.month))
        )
        .catch(() => setAppliedMonths([]));
    }
  };

  const closeForm = () => {
    if (isSubmitting || loanScanning) return;
    setFormVisible(false);
  };

  // `focusItemId` (passed by the Savings-tab quick-view sheet's "Edit" button)
  // auto-opens that payment's full edit form here exactly as if its row had
  // been tapped in the list. Runs once per id: `focusedIdRef` guards against
  // re-firing on unrelated re-renders (e.g. after the form closes) while
  // `view` is still populated with the same id.
  const focusItemId = route.params?.focusItemId;
  const focusedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusItemId || !view) return;
    if (focusedIdRef.current === focusItemId) return;
    const item = view.items.find((i) => i.id === focusItemId);
    if (!item) return;
    focusedIdRef.current = focusItemId;
    openEdit(item);
    navigation.setParams({ focusItemId: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId, view]);

  // Custom groups are just a free-text label — "creating" one selects the typed
  // name; it persists on the payment and joins the picker for future payments.
  const handleCreateGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setForm((f) => ({ ...f, groupLabel: name }));
    setNewGroupName('');
    setGroupPickerVisible(false);
  };

  /**
   * After an edit changes a payment's amount, ask how far to push it into months
   * already materialized for the selected year, then propagate. Cancelling leaves
   * past months as a historical record (template already saved).
   */
  const promptPropagateScope = (paymentId: string, label: string) => {
    if (!currentHousehold?.id) return;
    const householdId = currentHousehold.id;
    const monthName = MONTH_NAMES[selectedMonth - 1] ?? `month ${selectedMonth}`;

    const runPropagate = async (fromMonth: number, toMonth: number) => {
      try {
        const { updated } = await savingsApi.propagateRecurringPayment(householdId, paymentId, {
          year: selectedYear,
          fromMonth,
          toMonth,
        });
        markDirty();
        await load();
        showToast(
          'success',
          updated > 0
            ? `Updated ${updated} month${updated > 1 ? 's' : ''}`
            : 'No added months to update'
        );
      } catch (error) {
        console.error('Error propagating recurring payment:', error);
        Alert.alert('Error', 'Could not update the added months. Please try again.');
      }
    };

    Alert.alert(
      'Apply change to added months?',
      `"${label}" changed. Update the months you've already added it to in ${selectedYear}?`,
      [
        { text: `This month (${monthName})`, onPress: () => runPropagate(selectedMonth, selectedMonth) },
        { text: 'This & future months', onPress: () => runPropagate(selectedMonth, 12) },
        { text: `Whole year (${selectedYear})`, onPress: () => runPropagate(1, 12) },
        { text: 'Keep past months', style: 'cancel' },
      ]
    );
  };

  const handleSubmit = async () => {
    if (!currentHousehold?.id || isSubmitting) return;
    const label = form.label.trim();
    if (!label) {
      Alert.alert('Missing name', 'Please give this payment a name.');
      return;
    }
    const amountCents = toCents(form.amount);
    if (amountCents == null || amountCents <= 0) {
      Alert.alert('Missing amount', 'Enter a monthly amount greater than $0.');
      return;
    }
    if (form.scopeType === 'custom_months' && form.activeMonths.size === 0) {
      Alert.alert('Select months', 'Choose at least one month, or switch back to "Entire year".');
      return;
    }

    setIsSubmitting(true);
    try {
      const shared = {
        label,
        amount_cents: amountCents,
        // Autopay never needs a due-day nudge — cleared here too (not just
        // hidden in the UI below), matching what the backend enforces.
        day_of_month: form.isAutomated ? null : toDayOfMonth(form.dayOfMonth),
        group_label: form.groupLabel.trim() || null,
        is_essential: form.isEssential,
        active: form.active,
        is_automated: form.isAutomated,
        // A foreign-year scope (see `foreignScope`) is invisible to this form —
        // omit these fields entirely so the update leaves it exactly as-is,
        // rather than clearing it via the form's unrelated "Entire year" default.
        ...(foreignScope
          ? {}
          : {
              scope_type: form.scopeType,
              scope_year: form.scopeType === 'custom_months' ? selectedYear : null,
              active_months:
                form.scopeType === 'custom_months'
                  ? [...form.activeMonths].sort((a, b) => a - b)
                  : null,
            }),
      };
      const editingId = form.id;
      // Did this edit change the amount an already-applied month would show?
      const amountChanged = isEditingExisting && editBaselineAmount !== amountCents;

      if (editingId) {
        await savingsApi.updateRecurringPayment(currentHousehold.id, editingId, shared);
      } else {
        const newId = Crypto.randomUUID();
        await savingsApi.createRecurringPayment(currentHousehold.id, {
          id: newId,
          ...shared,
        });

        // If the member turned on "Track as a loan" while adding this
        // payment, save its loan record right after, under the SAME new id
        // — one "Add payment" tap creates both. `null` means tracking was
        // never turned on (or the section never mounted) — nothing to do.
        const draftLoan = loanDraftRef.current?.getDraftLoanPayload();
        if (draftLoan) {
          if (!draftLoan.valid) {
            // The payment itself is already saved. Rather than risk a
            // duplicate payment on a blind resubmit, hand the member into
            // this payment's own edit form (which now exists, id and all) to
            // fix and save the loan there — the form stays open.
            markDirty();
            await load();
            setForm((f) => ({ ...f, id: newId }));
            Alert.alert('Loan details', draftLoan.error);
            return;
          }
          try {
            await budgetLoansApi.upsert(currentHousehold.id, newId, draftLoan.payload);
          } catch (loanError) {
            console.error('Error saving draft loan:', loanError);
            markDirty();
            setFormVisible(false);
            await load();
            Alert.alert(
              'Payment saved',
              'Payment saved, but the loan details could not be saved — edit this payment to add them.'
            );
            return;
          }
        }
      }
      markDirty();
      setFormVisible(false);
      await load();

      // Offer to sync the change into months this payment is already applied to.
      if (editingId && amountChanged && appliedMonths.length > 0) {
        promptPropagateScope(editingId, label);
      }
    } catch (error) {
      console.error('Error saving recurring payment:', error);
      Alert.alert('Error', 'Could not save this payment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (item: SavingsRecurringPayment) => {
    if (!currentHousehold?.id || togglingId) return;
    setTogglingId(item.id);
    try {
      await savingsApi.updateRecurringPayment(currentHousehold.id, item.id, {
        active: !item.active,
      });
      markDirty();
      await load();
    } catch (error) {
      console.error('Error toggling recurring payment:', error);
      Alert.alert('Error', 'Could not update this payment. Please try again.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = (item: SavingsRecurringPayment) => {
    if (!currentHousehold?.id) return;
    Alert.alert('Delete payment', `Remove "${item.label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(item.id);
          try {
            await savingsApi.deleteRecurringPayment(currentHousehold.id, item.id);
            markDirty();
            await load();
          } catch (error) {
            console.error('Error deleting recurring payment:', error);
            Alert.alert('Error', 'Could not delete this payment. Please try again.');
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="savings-recurring-payments">
      <ScreenHeader
        title="Monthly Payments"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        rightElement={
          <HeaderActionButton
            iconOnly
            onPress={() => setAddMenuVisible(true)}
            testID="savings-recurring-add"
            accessibilityLabel="Add monthly payment"
          >
            <Icon name="add" size={Header.actionIconSize} color={colors.primary} />
          </HeaderActionButton>
        }
      />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.pastel.teal} />
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={[screenScrollViewStyle.scroll, styles.flex]}
          contentContainerStyle={styles.content}
        >
          {view && view.items.length > 0 && (
            <View style={[styles.totalCard, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="caption1" color={colors.textSecondary}>
                Monthly payments
              </Typography>
              <Typography variant="title2" weight="bold" testID="savings-recurring-total">
                {formatCurrency(view.totalMonthlyCents)}
              </Typography>
            </View>
          )}

          {(!view || view.items.length === 0) && (
            <View style={styles.empty}>
              <Typography variant="body" color={colors.textSecondary} align="center">
                No monthly payments yet. Add one to track your recurring bills.
              </Typography>
            </View>
          )}

          {groups.map((group, groupIndex) => (
            <View key={group.key} style={styles.groupSection}>
              <View style={styles.groupHeader}>
                <View style={styles.groupHeaderLeft}>
                  <View
                    style={[styles.groupDot, { backgroundColor: seriesColor(colors, groupIndex) }]}
                  />
                  <Typography variant="subheadline" weight="semibold">
                    {group.label}
                  </Typography>
                </View>
                <Typography variant="subheadline" weight="semibold" color={colors.textSecondary}>
                  {formatCurrency(group.subtotalCents)}
                </Typography>
              </View>
              <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
                {group.items.map((item, index) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.itemRow,
                      { borderTopColor: colors.borderColor },
                      index === 0 && styles.itemRowFirst,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => openEdit(item)}
                    onLongPress={() => handleDelete(item)}
                    testID="savings-recurring-item"
                  >
                    <View style={styles.itemContent}>
                      <View style={styles.itemTitleRow}>
                        <Typography
                          variant="body"
                          weight="medium"
                          numberOfLines={2}
                          style={styles.itemLabel}
                          color={item.active ? colors.textPrimary : colors.textTertiary}
                        >
                          {item.label}
                        </Typography>
                        {(() => {
                          const loan = loanCardInfo(item.loan_summary);
                          if (!loan || loan.totalInterestCents !== 0) return null;
                          return (
                            <View
                              style={[
                                styles.interestFreeBadge,
                                { backgroundColor: hexToRgba(theme.pastel.teal, 0.14) },
                              ]}
                              testID="savings-recurring-interest-free-badge"
                            >
                              <Typography variant="caption2" weight="semibold" color={theme.pastel.teal}>
                                Interest free
                              </Typography>
                            </View>
                          );
                        })()}
                      </View>
                      {item.day_of_month != null && (
                        <Typography variant="caption1" color={colors.textSecondary}>
                          Due day {item.day_of_month}
                        </Typography>
                      )}
                      {item.scope_type === 'custom_months' && item.scope_year != null && (
                        <View
                          style={[
                            styles.scopePill,
                            { backgroundColor: hexToRgba(theme.pastel.teal, 0.14) },
                          ]}
                          testID="savings-recurring-scope-pill"
                        >
                          <Typography variant="caption2" weight="semibold" color={theme.pastel.teal}>
                            {formatActiveMonths(item.active_months ?? [], item.scope_year)}
                          </Typography>
                        </View>
                      )}
                      {(() => {
                        const pill = renewalPillInfo(item.renewal_summary, colors);
                        if (!pill) return null;
                        return (
                          <View
                            style={[styles.renewalPill, { backgroundColor: hexToRgba(pill.tone, 0.14) }]}
                            testID="savings-recurring-renewal-pill"
                          >
                            <Typography variant="caption2" weight="semibold" color={pill.tone}>
                              {pill.label}
                            </Typography>
                          </View>
                        );
                      })()}
                    </View>
                    <Typography
                      variant="subheadline"
                      weight="semibold"
                      color={item.active ? colors.textPrimary : colors.textTertiary}
                    >
                      {formatCurrency(item.amount_cents)}
                    </Typography>
                    {togglingId === item.id || deletingId === item.id ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.pastel.teal}
                        style={styles.rowSwitch}
                      />
                    ) : (
                      <Toggle
                        value={item.active}
                        onValueChange={() => handleToggleActive(item)}
                        style={styles.rowSwitch}
                        testID="savings-recurring-toggle"
                      />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <AdaptiveModal visible={formVisible} onClose={closeForm}>
        <SafeAreaView edges={['top', 'bottom']} style={[styles.flex, { backgroundColor: colors.backgroundMain }]}>
          {/* The app-wide sheet header: ✕ left, title centred, the commit on
              the right — not this form's old Cancel-left text button. */}
          <SheetHeader
            title={form.id ? 'Edit payment' : 'Add payment'}
            leftVariant="close"
            onLeftPress={closeForm}
            leftTestID="savings-recurring-form-cancel"
            rightLabel={form.id ? 'Save' : 'Add'}
            onRightPress={handleSubmit}
            rightDisabled={loanScanning}
            rightLoading={isSubmitting}
            rightTestID="savings-recurring-form-save"
            style={styles.modalHeader}
          />

          {/* This sheet does NOT lift itself — `keyboardInset` is applied only to the
              other modal in this file — so the scroller is the only thing that can
              reveal a focused field here, and it keeps the auto-inset. */}
          <ScrollView
            {...keyboardDismissScrollProps}
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
          >
            <View>
              <Typography variant="caption1" color={colors.textSecondary} style={styles.fieldLabel}>
                Group (optional)
              </Typography>
              <TouchableOpacity
                style={[
                  styles.pickerButton,
                  {
                    borderColor: colors.borderColor,
                    backgroundColor: colors.groupedListBackground,
                  },
                ]}
                onPress={() => {
                  setNewGroupName('');
                  setGroupPickerVisible(true);
                }}
                testID="savings-recurring-form-group"
              >
                <Typography
                  variant="body"
                  color={form.groupLabel ? colors.textPrimary : colors.textSecondary}
                >
                  {form.groupLabel || 'No group'}
                </Typography>
                <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <TextInput
              testID="savings-recurring-form-label"
              label="Name"
              placeholder="e.g. Rent, Netflix, Car loan"
              value={form.label}
              onChangeText={(label) => setForm((f) => ({ ...f, label }))}
            />
            <TextInput
              testID="savings-recurring-form-amount"
              label="Monthly amount ($)"
              placeholder="0"
              value={form.amount}
              onChangeText={(amount) => setForm((f) => ({ ...f, amount }))}
              keyboardType="decimal-pad"
            />

            <View style={styles.switchRow}>
              <View style={styles.switchRowText}>
                <Typography variant="body">Autopay</Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Charged automatically — no due-day reminder needed.
                </Typography>
              </View>
              <Toggle
                value={form.isAutomated}
                onValueChange={(isAutomated) =>
                  setForm((f) => ({ ...f, isAutomated, dayOfMonth: isAutomated ? '' : f.dayOfMonth }))
                }
                testID="savings-recurring-form-automated"
              />
            </View>

            {!form.isAutomated && (
              <TextInput
                testID="savings-recurring-form-day"
                label="Day of month (optional, 1–31)"
                placeholder="e.g. 1"
                value={form.dayOfMonth}
                onChangeText={(dayOfMonth) => setForm((f) => ({ ...f, dayOfMonth }))}
                keyboardType="number-pad"
              />
            )}

            <View style={styles.switchRow}>
              <Typography variant="body">Essential</Typography>
              <Toggle
                value={form.isEssential}
                onValueChange={(isEssential) => setForm((f) => ({ ...f, isEssential }))}
                testID="savings-recurring-form-essential"
              />
            </View>
            <View style={styles.switchRow}>
              <Typography variant="body">Active</Typography>
              <Toggle
                value={form.active}
                onValueChange={(active) => setForm((f) => ({ ...f, active }))}
                testID="savings-recurring-form-active"
              />
            </View>

            {/* Month scope — most payments run the whole year; a payment that
                started or ended mid-year can be pinned to specific months of
                the year currently in view instead. */}
            <View>
              <Typography variant="caption1" color={colors.textSecondary} style={styles.fieldLabel}>
                Applies to
              </Typography>
              <View style={styles.scopeSegment}>
                <TouchableOpacity
                  style={[
                    styles.scopeSegmentBtn,
                    { borderColor: colors.borderColor },
                    form.scopeType === 'all_year' && {
                      backgroundColor: theme.pastel.teal,
                      borderColor: theme.pastel.teal,
                    },
                  ]}
                  onPress={() => setForm((f) => ({ ...f, scopeType: 'all_year' }))}
                  testID="savings-recurring-form-scope-all-year"
                >
                  <Typography
                    variant="body"
                    weight="medium"
                    color={form.scopeType === 'all_year' ? colors.white : colors.textPrimary}
                  >
                    Entire year
                  </Typography>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.scopeSegmentBtn,
                    { borderColor: colors.borderColor },
                    form.scopeType === 'custom_months' && {
                      backgroundColor: theme.pastel.teal,
                      borderColor: theme.pastel.teal,
                    },
                  ]}
                  onPress={() => setForm((f) => ({ ...f, scopeType: 'custom_months' }))}
                  testID="savings-recurring-form-scope-custom"
                >
                  <Typography
                    variant="body"
                    weight="medium"
                    color={form.scopeType === 'custom_months' ? colors.white : colors.textPrimary}
                  >
                    Specific months
                  </Typography>
                </TouchableOpacity>
              </View>

              {form.scopeType === 'custom_months' && (
                <>
                  <Typography variant="caption2" color={colors.textSecondary} style={styles.scopeHint}>
                    Select the months this payment is active in {selectedYear}. Other years still
                    run all 12 months.
                  </Typography>
                  <View style={styles.scopeGrid}>
                    {MONTHS_SHORT.map((label, i) => {
                      const month = i + 1;
                      const on = form.activeMonths.has(month);
                      return (
                        <TouchableOpacity
                          key={month}
                          activeOpacity={0.8}
                          onPress={() =>
                            setForm((f) => {
                              const next = new Set(f.activeMonths);
                              if (next.has(month)) next.delete(month);
                              else next.add(month);
                              return { ...f, activeMonths: next };
                            })
                          }
                          style={[
                            styles.scopeCell,
                            {
                              borderColor: on ? theme.pastel.teal : colors.borderColor,
                              backgroundColor: on ? `${theme.pastel.teal}1A` : colors.card,
                            },
                          ]}
                          testID={`savings-recurring-form-scope-month-${month}`}
                        >
                          <Typography
                            variant="subheadline"
                            weight={on ? 'semibold' : 'regular'}
                            color={on ? theme.pastel.teal : colors.textPrimary}
                          >
                            {label}
                          </Typography>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            {/* Renewal tracking only makes sense once the payment itself
                exists (it attaches to a real recurring_payment_id) — an
                in-progress "Add payment" must be saved first. */}
            {form.id && currentHousehold?.id && (
              <RenewalReminderSection
                householdId={currentHousehold.id}
                recurringPaymentId={form.id}
                recurringPaymentLabel={form.label}
              />
            )}
            {/* Loan tracking: attached-payment UI once the payment exists,
                or the draft UI while still adding one under Group =
                "Loans & Debt" — mutually exclusive on `form.id`, never both. */}
            {form.id && currentHousehold?.id && (
              <LoanInfoSection
                householdId={currentHousehold.id}
                recurringPaymentId={form.id}
                recurringPaymentLabel={form.label}
                onScanningChange={setLoanScanning}
                onExtractedPayment={handleExtractedLoanPayment}
              />
            )}
            {!form.id && form.groupLabel === 'Loans & Debt' && currentHousehold?.id && (
              <LoanDraftSection
                ref={loanDraftRef}
                householdId={currentHousehold.id}
                recurringPaymentLabel={form.label}
                onScanningChange={setLoanScanning}
                onExtractedPayment={handleExtractedLoanPayment}
                startTracking
              />
            )}

            {form.id && (
              <TouchableOpacity
                onPress={() => {
                  const item = view?.items.find((i) => i.id === form.id);
                  if (item) {
                    setFormVisible(false);
                    handleDelete(item);
                  }
                }}
                disabled={isSubmitting || loanScanning}
                style={styles.deleteLink}
                testID="savings-recurring-form-delete"
              >
                <Typography variant="body" color={colors.error} weight="medium">
                  Delete payment
                </Typography>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Group picker: predefined groups + any custom label in use + create-your-own.
              Rendered as an in-modal overlay (NOT a second <Modal>): iOS presents only one
              modal per view controller, so a sibling <Modal> opened while this form modal is
              up would silently never appear ("Group dropdown not available"). An absolutely
              positioned overlay inside the same modal presents reliably on both platforms. */}
          {groupPickerVisible && (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.modalOverlay,
                { backgroundColor: colors.modalBackdrop, paddingBottom: keyboardInset },
              ]}
            >
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => setGroupPickerVisible(false)}
                accessibilityLabel="Close group picker"
              />
              <View style={[styles.modalSheet, { backgroundColor: colors.backgroundMain }]}>
                <OverlaySheetHeader
                  title="Select group"
                  onClose={() => setGroupPickerVisible(false)}
                  closeTestID="savings-recurring-group-done"
                />

                {/* No `automaticallyAdjustKeyboardInsets` here, and that is deliberate: the
                    sheet is ALREADY lifted clear of the keypad by `keyboardInset` on the
                    backdrop above. Letting the scroller offset by the keyboard height as
                    well counts it twice and drives the focused field's own label off the
                    top of the card. Verified on a device via ProjectionTargetModal. */}
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  style={styles.pickerList}
                  contentContainerStyle={styles.modalContent}
                >
                  <TouchableOpacity
                    style={[styles.optionRow, { borderBottomColor: colors.divider }]}
                    onPress={() => {
                      setForm((f) => ({ ...f, groupLabel: '' }));
                      setGroupPickerVisible(false);
                    }}
                    testID="savings-recurring-group-none"
                  >
                    <Typography variant="body" color={colors.textSecondary}>
                      No group
                    </Typography>
                    {!form.groupLabel && (
                      <Icon name="checkmark" size={IconSize.md} color={theme.pastel.teal} />
                    )}
                  </TouchableOpacity>

                  {availableGroups.map((group) => {
                    const active = form.groupLabel === group;
                    return (
                      <TouchableOpacity
                        key={group}
                        style={[styles.optionRow, { borderBottomColor: colors.divider }]}
                        onPress={() => {
                          setForm((f) => ({ ...f, groupLabel: group }));
                          setGroupPickerVisible(false);
                        }}
                        testID={`savings-recurring-group-${group}`}
                      >
                        <Typography variant="body" color={colors.textPrimary}>
                          {group}
                        </Typography>
                        {active && <Icon name="checkmark" size={IconSize.md} color={theme.pastel.teal} />}
                      </TouchableOpacity>
                    );
                  })}

                  {/* Create a custom group inline. */}
                  <View style={styles.createGroupRow}>
                    <TextInput
                      testID="savings-recurring-group-new"
                      placeholder="New group name"
                      value={newGroupName}
                      onChangeText={setNewGroupName}
                      containerStyle={styles.createGroupInput}
                      onSubmitEditing={handleCreateGroup}
                      returnKeyType="done"
                    />
                    <TouchableOpacity
                      onPress={handleCreateGroup}
                      disabled={!newGroupName.trim()}
                      style={[
                        styles.createGroupBtn,
                        {
                          backgroundColor: newGroupName.trim() ? theme.pastel.teal : colors.borderColor,
                        },
                      ]}
                      testID="savings-recurring-group-create"
                    >
                      <Icon name="add" size={IconSize.md} color={colors.white} />
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </View>
            </View>
          )}
        </SafeAreaView>
      </AdaptiveModal>

      {/* Canonical `BottomSheet` — a real Modal — rather than the absolute
          overlay this used to be. That overlay was a sibling of the screen's
          own content, while the floating tab-bar capsule (zIndex 9999) and the
          chat FAB (zIndex 10000) are rendered ABOVE the screen by the tabs
          layout, so both drew straight over the menu's rows: "Import with AI"
          came up half-covered by the FAB no matter how much bottom padding the
          sheet reserved (observed 2026-09-05 — the earlier
          `bottomTabBarClearance` padding cleared the tab bar but never the FAB,
          which floats 92pt above the safe area). A Modal presents in its own
          window above both, so the sheet is always fully visible and the
          clearance hack is gone. */}
      <BottomSheet
        visible={addMenuVisible}
        onClose={() => setAddMenuVisible(false)}
        height="content"
        title="Add payment"
        showCloseButton
        closeTestID="savings-recurring-add-close"
        noPadding
      >
        <TouchableOpacity
          style={[styles.addMenuRow, { borderBottomColor: colors.divider }]}
          onPress={() => requestAddAction('manual')}
          testID="savings-recurring-add-manual"
        >
          <Icon name="create-outline" size={IconSize.md} color={colors.textPrimary} />
          <Typography variant="body" weight="medium" color={colors.textPrimary}>
            Add manually
          </Typography>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.addMenuRow}
          onPress={() => requestAddAction('import')}
          testID="savings-recurring-add-import"
        >
          <Icon name="sparkles-outline" size={IconSize.md} color={theme.pastel.teal} />
          <Typography variant="body" weight="semibold" color={theme.pastel.teal}>
            Import with AI
          </Typography>
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Header.paddingHorizontal,
    paddingVertical: Spacing.md,
  },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    gap: Spacing.base,
  },
  totalCard: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    gap: Spacing.xxs,
  },
  empty: { paddingVertical: Spacing.xxl },
  groupSection: { gap: Spacing.sm },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  groupHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 },
  groupDot: { width: 10, height: 10, borderRadius: 5 },
  card: { borderRadius: CornerRadius.lg },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    paddingLeft: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.smd,
  },
  itemRowFirst: { borderTopWidth: 0 },
  itemContent: { flex: 1, gap: Spacing.xxs },
  itemTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  itemLabel: { flexShrink: 1 },
  interestFreeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.sm,
  },
  rowSwitch: { marginLeft: Spacing.xs },
  renewalPill: {
    alignSelf: 'flex-start',
    marginTop: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.sm,
  },
  scopePill: {
    alignSelf: 'flex-start',
    marginTop: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.sm,
  },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: {
    maxHeight: '90%',
    borderTopLeftRadius: CornerRadius.xl,
    borderTopRightRadius: CornerRadius.xl,
  },
  addMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Only ever an EXTRA style on a `SheetHeader` (which brings the row itself).
  // Never enough on its own — see the group picker's note above.
  modalHeader: { paddingVertical: Spacing.xs },
  // The sheet grows with the form's content but is capped at modalSheet's 90%.
  // `flexShrink: 1` (NOT `flex: 1`) is essential: inside a content-sized sheet a
  // `flex: 1` ScrollView collapses to 0 height (the whole form goes invisible);
  // flexShrink lets it size to content yet still shrink + scroll once it hits the cap.
  modalScroll: { flexShrink: 1 },
  modalContent: { padding: Spacing.base, paddingBottom: Spacing.xxl, gap: Spacing.base },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  switchRowText: { flex: 1, gap: Spacing.xxs, marginRight: Spacing.sm },
  deleteLink: { alignItems: 'center', paddingVertical: Spacing.sm },
  fieldLabel: { marginBottom: Spacing.xs },
  pickerButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.smd,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // `flexShrink: 1` alongside the cap: once the keyboard lifts this sheet the
  // column has less room than 460pt, and without it the list would keep its
  // height and push the "New group name" field off the top instead of scrolling.
  pickerList: { maxHeight: 460, flexShrink: 1 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  createGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.base,
  },
  createGroupInput: { flex: 1, marginBottom: 0 },
  createGroupBtn: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeSegment: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  scopeSegmentBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.smd,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scopeHint: { marginTop: Spacing.sm },
  scopeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  scopeCell: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '22%',
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
});
