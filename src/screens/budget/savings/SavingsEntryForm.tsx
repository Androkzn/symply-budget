import DateTimePicker from '@react-native-community/datetimepicker';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import { RouteProp, useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Modal, Platform, ScrollView as RNScrollView, StyleSheet, TextInput as RNTextInput, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import type { Edge } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { householdsApi, type HouseholdMember } from '@api/households';
import {
  savingsApi,
  type SavingsCategory,
  type SavingsIncomeEntry,
  type SavingsIncomeSourceType,
  type SavingsSpendingEntry,
} from '@api/savings';
import { AppBackground, OverlaySheetHeader, SafeAreaView, SheetHeader } from '@components/common';
import { TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import {
  SUPPORTED_CURRENCIES,
  resolveCurrency,
  type CurrencyCode,
} from '@config/currencies';
import { useTheme } from '@contexts/ThemeContext';
import { useDeviceType } from '@hooks/useDeviceType';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import { useIsScrollableFormSheet } from '@navigation/presentation';
import type { BudgetStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { IconSize, Layout, useAppColors } from '@theme';
import { resolveCategoryIcon } from '@utils/budgetCategoryIcon';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { useDisplayCurrency } from '@utils/money';

import { INCOME_SOURCE_OPTIONS } from './incomeSourceMeta';

type SavingsEntryFormRouteProp = RouteProp<BudgetStackParamList, 'SavingsEntryForm'>;
type SavingsEntryFormNavigationProp = NativeStackNavigationProp<
  BudgetStackParamList,
  'SavingsEntryForm'
>;

/** Editable form state that decides whether the entry form is dirty. */
interface SavingsEntryFormValues {
  label: string;
  amount: string;
  dateYMD: string;
  notes: string;
  memberId: string | null;
  sourceType: SavingsIncomeSourceType;
  categoryId: string | null;
  currency: CurrencyCode;
}

/** Regular sources first, then one-off ones — see INCOME_SOURCE_OPTIONS. */
const SOURCE_TYPES = INCOME_SOURCE_OPTIONS;

function sourceLabel(value: SavingsIncomeSourceType): string {
  return SOURCE_TYPES.find((s) => s.value === value)?.label ?? 'Income';
}

/** Display name for a household member (falls back to the email local-part). */
function memberLabel(m: { display_name: string | null; email: string }): string {
  return m.display_name?.trim() || m.email.split('@')[0];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? ''} ${year}`.trim();
}

/** Keep only digits + a single decimal point, capped at 2 decimals (xxxxx.xx). */
function sanitizeAmount(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
}

/** Local YYYY-MM-DD (matches BE income_date / spending_date columns). */
function todayYMD(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Default date for a NEW entry: use today when the user is viewing the current
 * month, otherwise the 1st of the month they're looking at. This lets you scroll
 * the Savings view to any month (e.g. back to January) and add income/spending
 * straight into that month — matching a per-month budget spreadsheet.
 */
function defaultEntryYMD(year: number, month: number): string {
  const now = new Date();
  if (year === now.getFullYear() && month === now.getMonth() + 1) return todayYMD();
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function ymdToDate(ymd: string): Date {
  return new Date(ymd.slice(0, 10) + 'T12:00:00');
}

function dateToYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDollarsString(cents: number): string {
  if (cents === 0) return '';
  return (cents / 100).toString();
}

function toCents(dollars: string): number | undefined {
  const n = parseFloat(dollars);
  if (Number.isNaN(n) || n <= 0) return undefined;
  return Math.round(n * 100);
}

export function SavingsEntryForm() {
  const { theme } = useTheme();
  const colors = useAppColors();
  // New entries are stamped with the household's display currency (Settings →
  // Currency) rather than a hard-coded CAD.
  const displayCurrency = useDisplayCurrency();
  const { isIPad, width } = useDeviceType();
  const useCenteredSheet = isIPad && width >= Layout.sidebarBreakpoint;
  // On iPhone this form is presented as a page sheet, so its card already starts
  // below the status bar: taking the `top` safe-area edge as well would reserve
  // the inset a second time, inside the card, as a blank band above the header.
  const insideSheet = useIsScrollableFormSheet();
  const safeAreaEdges: Edge[] = insideSheet ? ['bottom'] : ['top', 'bottom'];
  const navigation = useNavigation<SavingsEntryFormNavigationProp>();
  const route = useRoute<SavingsEntryFormRouteProp>();
  const { mode, entryId } = route.params;
  const isIncome = mode === 'income';
  const isEditing = !!entryId;

  const { currentHousehold, currentHouseholdMembers } = useHouseholdStore();
  const { selectedYear, selectedMonth, markDirty } = useSavingsStore();
  const insets = useSafeAreaInsets();

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [dateYMD, setDateYMD] = useState<string>(() =>
    defaultEntryYMD(selectedYear, selectedMonth)
  );
  const [notes, setNotes] = useState('');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<SavingsIncomeSourceType>('payroll');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>(displayCurrency);

  const [categories, setCategories] = useState<SavingsCategory[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>(currentHouseholdMembers);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePicked, setDatePicked] = useState(isEditing);
  const [memberOpen, setMemberOpen] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  const [isLoading, setIsLoading] = useState(isEditing);
  // In-flight guard for the secondary flows (Save & add another, Delete) that do
  // NOT go through useUnsavedChanges. The primary save-and-close button uses the
  // hook's own isSaving instead.
  const [isBusy, setIsBusy] = useState(false);

  const amountRef = useRef('');
  const sourceTypeRef = useRef<SavingsIncomeSourceType>('payroll');
  const memberIdRef = useRef<string | null>(null);
  const pendingSaveRef = useRef(false);
  const amountInputRef = useRef<RNTextInput>(null);

  const syncAmount = (text: string) => {
    amountRef.current = text;
    if (text !== amount) setAmount(text);
  };
  const syncSourceType = (value: SavingsIncomeSourceType) => {
    sourceTypeRef.current = value;
    if (value !== sourceType) setSourceType(value);
  };
  const syncMemberId = (value: string | null) => {
    memberIdRef.current = value;
    if (value !== memberId) setMemberId(value);
  };
  const resolveAmount = () => amountRef.current || amount;
  const resolveSourceType = () => sourceTypeRef.current || sourceType;
  const resolveMemberId = () => memberIdRef.current ?? memberId;

  // Snapshot of the last-saved values for dirty-tracking on the primary
  // save-and-close path. Empty for a new entry; overwritten with the loaded
  // entry's values when editing.
  const [baseline, setBaseline] = useState<SavingsEntryFormValues>(() => ({
    label: '',
    amount: '',
    dateYMD: defaultEntryYMD(selectedYear, selectedMonth),
    notes: '',
    memberId: null,
    sourceType: 'payroll',
    categoryId: null,
    currency: displayCurrency,
  }));

  // Load categories for the spending picker.
  useEffect(() => {
    if (isIncome || !currentHousehold?.id) return;
    savingsApi
      .listCategories(currentHousehold.id)
      .then((res) => setCategories(res.categories))
      .catch(() => {});
  }, [isIncome, currentHousehold?.id]);

  // Load household members for the income member dropdown. Prefer the store, but
  // fetch directly when it hasn't been populated for this household yet.
  useEffect(() => {
    if (!isIncome || !currentHousehold?.id) return;
    if (currentHouseholdMembers.length > 0) {
      setMembers(currentHouseholdMembers);
      return;
    }
    householdsApi
      .get(currentHousehold.id)
      .then((res) => setMembers(res.members))
      .catch(() => {});
  }, [isIncome, currentHousehold?.id, currentHouseholdMembers]);

  // Load the existing entry when editing.
  useEffect(() => {
    if (!isEditing || !currentHousehold?.id || !entryId) return;
    const { selectedYear, selectedMonth } = useSavingsStore.getState();
    const load = async () => {
      try {
        if (isIncome) {
          const { entries } = await savingsApi.listIncome(
            currentHousehold.id,
            selectedYear,
            selectedMonth
          );
          const found = entries.find((e: SavingsIncomeEntry) => e.id === entryId);
          if (found) {
            const loadedCurrency = resolveCurrency(found.currency).code;
            const loadedDate = found.income_date.slice(0, 10);
            setLabel(found.label);
            setAmount(toDollarsString(found.amount_cents));
            setDateYMD(loadedDate);
            setNotes(found.notes ?? '');
            setMemberId(found.member_id);
            setSourceType(found.source_type);
            setCurrency(loadedCurrency);
            // Seed the submit-time refs from the loaded entry as well as the
            // state. `persistEntry` reads `resolveSourceType()` —
            // `sourceTypeRef.current || sourceType` — and the ref is
            // initialised to a TRUTHY 'payroll', so leaving it unsynced made
            // every edit of a non-payroll entry write `source_type: 'payroll'`
            // (and the derived label with it) unless the member happened to
            // re-tap a source chip. A "Bonus"/"Freelance" row silently became
            // Payroll on an unrelated amount edit, which also moved it from
            // one-off to regular income — corrupting the Overview split and
            // the Projection pace, which deliberately excludes one-off income.
            // Caught on device by budget-savings-income-crud.yaml.
            amountRef.current = toDollarsString(found.amount_cents);
            memberIdRef.current = found.member_id;
            sourceTypeRef.current = found.source_type;
            // Adopt the loaded income entry as the dirty-tracking baseline.
            setBaseline({
              label: found.label,
              amount: toDollarsString(found.amount_cents),
              dateYMD: loadedDate,
              notes: found.notes ?? '',
              memberId: found.member_id,
              sourceType: found.source_type,
              categoryId: null,
              currency: loadedCurrency,
            });
          }
        } else {
          const { entries } = await savingsApi.listSpending(
            currentHousehold.id,
            selectedYear,
            selectedMonth
          );
          const found = entries.find((e: SavingsSpendingEntry) => e.id === entryId);
          if (found) {
            const loadedCurrency = resolveCurrency(found.currency).code;
            const loadedDate = found.spending_date.slice(0, 10);
            setLabel(found.label);
            setAmount(toDollarsString(found.amount_cents));
            setDateYMD(loadedDate);
            setNotes(found.notes ?? '');
            setCategoryId(found.category_id);
            setCurrency(loadedCurrency);
            // Same ref seeding as the income branch above. `amountRef` starts
            // EMPTY, so `resolveAmount()` already fell through to state here —
            // but keeping the ref in step with the loaded entry means the two
            // branches cannot drift apart the way sourceType did.
            amountRef.current = toDollarsString(found.amount_cents);
            // Adopt the loaded spending entry as the dirty-tracking baseline.
            setBaseline({
              label: found.label,
              amount: toDollarsString(found.amount_cents),
              dateYMD: loadedDate,
              notes: found.notes ?? '',
              memberId: null,
              sourceType: 'payroll',
              categoryId: found.category_id,
              currency: loadedCurrency,
            });
          }
        }
      } catch (error) {
        console.error('Error loading savings entry:', error);
        Alert.alert('Could not load entry', 'Please try again.');
        navigation.goBack();
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isEditing, entryId, currentHousehold?.id, isIncome, navigation]);

  const selectedMember = useMemo(
    () => members.find((m) => m.id === memberId) ?? null,
    [members, memberId]
  );

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId]
  );

  const values: SavingsEntryFormValues = {
    label,
    amount,
    dateYMD,
    notes,
    memberId,
    sourceType,
    categoryId,
    currency,
  };

  /**
   * Shared persistence for both the primary save-and-close path and the
   * "Save & add another" path. Shows a validation toast and returns `false`
   * when the form is incomplete; throws on API failure so the caller can react.
   */
  const persistEntry = async (): Promise<boolean> => {
    if (!currentHousehold?.id) return false;
    const amountCents = toCents(resolveAmount());
    if (!amountCents) {
      showToast('error', 'Enter an amount greater than zero.');
      return false;
    }
    // Income has no free-text name — its label is derived from member + source
    // (e.g. "Andrei Payroll"). Spending keeps its typed name.
    const incomeMember = members.find((m) => m.id === resolveMemberId()) ?? null;
    const entryLabel = isIncome
      ? [incomeMember ? memberLabel(incomeMember) : '', sourceLabel(resolveSourceType())]
          .filter(Boolean)
          .join(' ')
          .trim()
      : label.trim();
    if (!isIncome && !entryLabel) {
      showToast('error', 'Please give this spending a name.');
      return false;
    }

    if (isIncome) {
      if (isEditing && entryId) {
        await savingsApi.updateIncome(currentHousehold.id, entryId, {
          member_id: resolveMemberId(),
          source_type: resolveSourceType(),
          label: entryLabel,
          amount_cents: amountCents,
          currency,
          income_date: dateYMD,
          notes: notes.trim() || null,
        });
      } else {
        await savingsApi.createIncome(currentHousehold.id, {
          id: Crypto.randomUUID(),
          member_id: resolveMemberId(),
          source_type: resolveSourceType(),
          label: entryLabel,
          amount_cents: amountCents,
          currency,
          income_date: dateYMD,
          notes: notes.trim() || null,
        });
      }
    } else {
      if (isEditing && entryId) {
        await savingsApi.updateSpending(currentHousehold.id, entryId, {
          category_id: categoryId,
          label: entryLabel,
          amount_cents: amountCents,
          currency,
          spending_date: dateYMD,
          notes: notes.trim() || null,
        });
      } else {
        await savingsApi.createSpending(currentHousehold.id, {
          id: Crypto.randomUUID(),
          category_id: categoryId,
          label: entryLabel,
          amount_cents: amountCents,
          currency,
          spending_date: dateYMD,
          notes: notes.trim() || null,
        });
      }
    }
    markDirty();
    return true;
  };

  // Primary save-and-close button. On success the hook shows a toast and closes
  // the view. See [[useUnsavedChanges]].
  const { isDirty, isSaving, save } = useUnsavedChanges({
    values,
    baseline,
    saveWhen: (_values, dirty) => (isEditing ? dirty : true),
    successMessage: isEditing
      ? 'Changes saved'
      : isIncome
        ? 'Income added'
        : 'Spending added',
    onClose: () => navigation.goBack(),
    onSave: async () => {
      const ok = await persistEntry();
      return ok ? undefined : false; // false = validation aborted (toast already shown)
    },
  });

  // "Save & add another": persist, then stay on the form for the next entry in
  // the same month (keep member + source, clear amount/description). Does NOT
  // close. Uses its own in-flight flag so it stays independent of the hook.
  const handleAddAnother = async () => {
    if (isBusy || isSaving) return; // double-tap / concurrent-save guard.
    setIsBusy(true);
    try {
      const ok = await persistEntry();
      if (!ok) return; // validation toast already shown.
      showToast('success', isIncome ? 'Income added' : 'Spending added');
      setAmount('');
      setNotes('');
      setLabel('');
    } catch (error) {
      console.error('Error saving savings entry:', error);
      showToast('error', 'Could not save this entry. Please try again.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = () => {
    if (!currentHousehold?.id || !entryId) return;
    Alert.alert('Delete entry', `Delete "${label || 'this entry'}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (isBusy) return;
          setIsBusy(true);
          try {
            if (isIncome) {
              await savingsApi.deleteIncome(currentHousehold.id, entryId);
            } else {
              await savingsApi.deleteSpending(currentHousehold.id, entryId);
            }
            markDirty();
            navigation.goBack();
          } catch (error) {
            console.error('Error deleting savings entry:', error);
            Alert.alert('Error', 'Could not delete this entry.');
          } finally {
            setIsBusy(false);
          }
        },
      },
    ]);
  };

  const formTitle = isEditing
    ? isIncome
      ? 'Edit income'
      : 'Edit spending'
    : isIncome
      ? 'Add income'
      : 'Add spending';

  const saveDisabled = isSaving || isBusy || (isEditing && !isDirty);
  // Save lives only in the header, and only once there is something to save: an
  // untouched form renders no action at all rather than a greyed-out one.
  const showSaveAction = isDirty || isSaving;
  const runSaveAfterNativeFlush = () => {
    if (pendingSaveRef.current) return;
    pendingSaveRef.current = true;
    Keyboard.dismiss();
    amountInputRef.current?.blur();

    const finish = () => {
      if (!pendingSaveRef.current) return;
      pendingSaveRef.current = false;
      void save();
    };

    if (process.env.JEST_WORKER_ID !== undefined) {
      finish();
      return;
    }
    setTimeout(finish, 650);
  };

  if (isLoading) {
    return (
      <AppBackground>
        <SafeAreaView edges={['top']}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <AppBackground>
      <SafeAreaView
        edges={safeAreaEdges}
        style={[styles.flex, { backgroundColor: colors.backgroundMain }]}
        testID="savings-entry-form"
      >
        <View style={styles.container}>
          {/* The app's one sheet header — same glass ✕ on the left, same centred
              title, same single commit on the right as every `BottomSheet` and
              overlay sheet. This screen used to hand-roll the row (a teal
              "Cancel" against a teal "Save", no equal side columns), which is
              how its title drifted off-centre whenever Save was hidden. */}
          <SheetHeader
            title={formTitle}
            titleLines={2}
            leftVariant="close"
            onLeftPress={() => navigation.goBack()}
            leftTestID="savings-entry-form-cancel"
            leftAccessibilityLabel="Cancel"
            {...(showSaveAction
              ? {
                  rightLabel: 'Save',
                  onRightPress: runSaveAfterNativeFlush,
                  rightDisabled: saveDisabled,
                  rightLoading: isSaving,
                  rightTestID: 'savings-entry-form-save-header',
                }
              : {})}
            showDivider
          />

          <ScrollView
            {...keyboardDismissScrollProps}
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator
          >
            {!isIncome && (
              <TextInput
                testID="savings-entry-label"
                label="Name"
                placeholder="e.g. Groceries"
                value={label}
                onChangeText={setLabel}
              />
            )}

            <TextInput
              ref={amountInputRef}
              testID="savings-entry-amount"
              label="Amount ($)"
              placeholder="0.00"
              value={amount}
              onChangeText={(t) => syncAmount(sanitizeAmount(t))}
              onEndEditing={(event) => syncAmount(sanitizeAmount(event.nativeEvent.text))}
              keyboardType="decimal-pad"
              inputMode="decimal"
              autoFocus={!isEditing}
            />

            {/* Currency — defaults to Settings → Currency, overridable per entry
                for households that record income in more than one currency. */}
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.fieldLabel}
            >
              Currency
            </Typography>
            <View style={styles.chipRow}>
              {SUPPORTED_CURRENCIES.map(({ code: c }) => {
                const active = currency === c;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.chip,
                      {
                        borderColor: theme.pastel.teal,
                        backgroundColor: active ? theme.pastel.teal : 'transparent',
                      },
                    ]}
                    onPress={() => setCurrency(c)}
                    testID={`savings-entry-currency-${c}`}
                  >
                    <Typography
                      variant="caption1"
                      weight="semibold"
                      color={active ? colors.white : theme.pastel.teal}
                    >
                      {c}
                    </Typography>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Income defaults to the whole month; tap to pick a specific date
                (add several income entries on different dates if you want). */}
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.fieldLabel}
            >
              {isIncome ? 'Month' : 'Date'}
            </Typography>
            <TouchableOpacity
              style={[
                styles.pickerButton,
                {
                  borderColor: colors.borderColor,
                  backgroundColor: colors.groupedListBackground,
                },
              ]}
              onPress={() => setShowDatePicker(true)}
              testID="savings-entry-date-picker"
            >
              <Typography variant="body">
                {isIncome && !datePicked
                  ? monthLabel(selectedYear, selectedMonth)
                  : ymdToDate(dateYMD).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
              </Typography>
              <Icon name="calendar-outline" size={IconSize.md} color={theme.pastel.teal} />
            </TouchableOpacity>
            {isIncome && !datePicked && (
              <Typography
                variant="caption1"
                color={colors.textTertiary}
                style={styles.dateHint}
              >
                Applies to the whole month — tap to set a specific date.
              </Typography>
            )}
            {showDatePicker && (
              <View style={styles.datePickerContainer}>
                <DateTimePicker
                  value={ymdToDate(dateYMD)}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_event, selectedDate) => {
                    if (Platform.OS === 'android') setShowDatePicker(false);
                    if (selectedDate) {
                      setDateYMD(dateToYMD(selectedDate));
                      setDatePicked(true);
                    }
                  }}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    onPress={() => setShowDatePicker(false)}
                    style={styles.datePickerDone}
                  >
                    <Typography variant="body" weight="semibold" color={theme.pastel.teal}>
                      Done
                    </Typography>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Income: member + source type */}
            {isIncome && (
              <>
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  style={styles.fieldLabel}
                >
                  Member
                </Typography>
                {/* Tap to open the member picker sheet (backdrop-tap closes it). */}
                <TouchableOpacity
                  style={[
                    styles.pickerButton,
                    {
                      borderColor: memberOpen ? theme.pastel.teal : colors.borderColor,
                      backgroundColor: colors.groupedListBackground,
                    },
                  ]}
                  onPress={() => setMemberOpen(true)}
                  testID="savings-entry-member-picker"
                >
                  <Typography
                    variant="body"
                    color={selectedMember ? colors.textPrimary : colors.textSecondary}
                  >
                    {selectedMember ? memberLabel(selectedMember) : 'Select member'}
                  </Typography>
                  <Icon
                    name={memberOpen ? 'chevron-up' : 'chevron-down'}
                    size={IconSize.md}
                    color={theme.pastel.teal}
                  />
                </TouchableOpacity>

                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  style={styles.fieldLabel}
                >
                  Source
                </Typography>
                <View style={styles.chipRow}>
                  {SOURCE_TYPES.map((s) => {
                    const active = sourceType === s.value;
                    return (
                      <TouchableOpacity
                        key={s.value}
                        style={[
                          styles.chip,
                          {
                            borderColor: theme.pastel.teal,
                            backgroundColor: active ? theme.pastel.teal : 'transparent',
                          },
                        ]}
                        onPress={() => syncSourceType(s.value)}
                        testID={`savings-entry-source-${s.value}`}
                      >
                        <Typography
                          variant="caption1"
                          weight="semibold"
                          color={active ? colors.white : theme.pastel.teal}
                        >
                          {s.label}
                        </Typography>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Optional free-text description (income has no required name). */}
                <TextInput
                  testID="savings-entry-description"
                  label="Description (optional)"
                  placeholder="Add a note"
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={3}
                  style={styles.multiline}
                />
              </>
            )}

            {/* Spending: category + notes */}
            {!isIncome && (
              <>
                {categories.length > 0 && (
                  <>
                    <Typography
                      variant="caption1"
                      color={colors.textSecondary}
                      style={styles.fieldLabel}
                    >
                      Category
                    </Typography>
                    <TouchableOpacity
                      style={[
                        styles.pickerButton,
                        {
                          borderColor: colors.borderColor,
                          backgroundColor: colors.groupedListBackground,
                        },
                      ]}
                      onPress={() => setShowCategoryPicker(true)}
                      testID="savings-entry-category-picker"
                    >
                      {selectedCategory ? (
                        <View style={styles.pickerButtonLabel}>
                          <View
                            style={[
                              styles.pickerButtonIcon,
                              { backgroundColor: `${selectedCategory.color || colors.primary}22` },
                            ]}
                          >
                            <Icon
                              name={resolveCategoryIcon(selectedCategory)}
                              size={IconSize.md}
                              color={selectedCategory.color || colors.primary}
                            />
                          </View>
                          <Typography variant="body" color={colors.textPrimary}>
                            {selectedCategory.name}
                          </Typography>
                        </View>
                      ) : (
                        <Typography variant="body" color={colors.textSecondary}>
                          No category
                        </Typography>
                      )}
                      <Icon
                        name="chevron-forward"
                        size={IconSize.md}
                        color={colors.textTertiary}
                      />
                    </TouchableOpacity>
                  </>
                )}

                <TextInput
                  testID="savings-entry-notes"
                  label="Notes"
                  placeholder="Optional"
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={3}
                  style={styles.multiline}
                />
              </>
            )}

            {isIncome && !isEditing && (
              <TouchableOpacity
                onPress={handleAddAnother}
                disabled={saveDisabled}
                style={styles.deleteButton}
                testID="savings-entry-form-save-add-another"
              >
                <Typography variant="body" weight="semibold" color={theme.pastel.teal}>
                  {isBusy ? 'Saving…' : 'Save & add another'}
                </Typography>
              </TouchableOpacity>
            )}

            {isEditing && (
              <TouchableOpacity
                onPress={handleDelete}
                disabled={isBusy || isSaving}
                style={styles.deleteButton}
                testID="savings-entry-form-delete"
                // Distinct accessible name so it never collides with the delete
                // confirmation Alert's own "Delete" button — both would otherwise
                // expose accessibilityText "Delete", making the confirm ambiguous
                // (a real screen-reader ambiguity, and it broke the delete E2E).
                accessibilityLabel={isIncome ? 'Delete income' : 'Delete spending'}
              >
                <Typography variant="body" weight="semibold" color={colors.error}>
                  Delete
                </Typography>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

        {/* Category picker */}
        <Modal
          visible={showCategoryPicker}
          transparent
          animationType={useCenteredSheet ? 'fade' : 'slide'}
          onRequestClose={() => setShowCategoryPicker(false)}
        >
          <View
            style={[
              styles.modalOverlay,
              { backgroundColor: colors.modalBackdrop },
              useCenteredSheet && styles.modalOverlayCentered,
            ]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setShowCategoryPicker(false)}
              accessibilityLabel="Close category picker"
            />
            <View
              style={[
                styles.modalSheet,
                { backgroundColor: colors.backgroundMain },
                useCenteredSheet && styles.modalSheetCentered,
              ]}
            >
              <OverlaySheetHeader
                title="Select category"
                onClose={() => setShowCategoryPicker(false)}
                closeTestID="savings-entry-category-close"
              />
              <ScrollView style={styles.modalList} keyboardShouldPersistTaps="always">
                <TouchableOpacity
                  style={[styles.optionRow, { borderBottomColor: colors.divider }]}
                  onPress={() => {
                    setCategoryId(null);
                    setShowCategoryPicker(false);
                  }}
                  testID="savings-entry-category-none"
                >
                  <Typography variant="body" color={colors.textSecondary}>
                    No category
                  </Typography>
                  {!categoryId && (
                    <Icon name="checkmark" size={IconSize.md} color={theme.pastel.teal} />
                  )}
                </TouchableOpacity>
                {categories.map((cat) => {
                  const active = categoryId === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.optionRow, { borderBottomColor: colors.divider }]}
                      onPress={() => {
                        setCategoryId(cat.id);
                        setShowCategoryPicker(false);
                      }}
                      testID={`savings-entry-category-${cat.id}`}
                    >
                      <View style={styles.optionRowLeft}>
                        <View
                          style={[
                            styles.optionRowIcon,
                            { backgroundColor: `${cat.color || colors.primary}22` },
                          ]}
                        >
                          <Icon
                            name={resolveCategoryIcon(cat)}
                            size={IconSize.lg}
                            color={cat.color || colors.primary}
                          />
                        </View>
                        <Typography variant="body" color={colors.textPrimary}>
                          {cat.name}
                        </Typography>
                      </View>
                      {active && (
                        <Icon name="checkmark" size={IconSize.md} color={theme.pastel.teal} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Member picker */}
        <Modal
          visible={memberOpen}
          transparent
          animationType={useCenteredSheet ? 'fade' : 'slide'}
          onRequestClose={() => setMemberOpen(false)}
        >
          <View
            style={[
              styles.modalOverlay,
              { backgroundColor: colors.modalBackdrop },
              useCenteredSheet && styles.modalOverlayCentered,
            ]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setMemberOpen(false)}
              accessibilityLabel="Close member picker"
            />
            <View
              style={[
                styles.modalSheet,
                { backgroundColor: colors.backgroundMain },
                useCenteredSheet && styles.modalSheetCentered,
              ]}
            >
              <OverlaySheetHeader
                title="Select member"
                onClose={() => setMemberOpen(false)}
                closeTestID="savings-entry-member-close"
              />
              <RNScrollView style={styles.modalList} keyboardShouldPersistTaps="always">
                <TouchableOpacity
                  style={[styles.optionRow, { borderBottomColor: colors.divider }]}
                  onPress={() => {
                    setMemberId(null);
                    syncMemberId(null);
                    setMemberOpen(false);
                  }}
                  testID="savings-entry-member-none"
                >
                  <Typography variant="body" color={colors.textSecondary}>
                    No member
                  </Typography>
                  {!memberId && (
                    <Icon name="checkmark" size={IconSize.md} color={theme.pastel.teal} />
                  )}
                </TouchableOpacity>
                {members.map((member) => {
                  const active = memberId === member.id;
                  return (
                    <TouchableOpacity
                      key={member.id}
                      style={[styles.optionRow, { borderBottomColor: colors.divider }]}
                      onPress={() => {
                        syncMemberId(member.id);
                        setMemberOpen(false);
                      }}
                      testID={`savings-entry-member-${member.id}`}
                    >
                      <Typography variant="body" color={colors.textPrimary}>
                        {memberLabel(member)}
                      </Typography>
                      {active && (
                        <Icon name="checkmark" size={IconSize.md} color={theme.pastel.teal} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </RNScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
      </AppBackground>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  scrollView: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  fieldLabel: { marginTop: -4 },
  dateHint: { marginTop: 2, marginLeft: 2 },
  pickerButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  pickerButtonLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  pickerButtonIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  datePickerContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  datePickerDone: { alignSelf: 'flex-end', padding: 8 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  deleteButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalOverlayCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalSheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  modalSheetCentered: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '80%',
    borderRadius: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  modalList: {
    maxHeight: 420,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  optionRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
