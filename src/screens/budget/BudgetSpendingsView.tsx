import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  ScrollView,
  TouchableOpacity as GHTouchableOpacity,
} from 'react-native-gesture-handler';

import {
  budgetApi,
  type BudgetCategory,
  type BudgetItem,
  type BulkPortionView,
  type Expense,
  type MonthlyOverview,
} from '@api/budget';
import { ScreenScrollEnd, screenScrollEndTestId } from '@components/common';
import { ResponsiveLayout } from '@components/layout/ResponsiveLayout';
import {
  Button,
  Chip,
  monthKey,
  MonthPickerSheet,
  NativeSwipeAction,
  NativeSwipeActions,
  NativeSwipeable,
  parseMonthKey,
  TextInput,
  Typography,
  type SwipeableMethods,
} from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import {
  countedAmountOf,
  portionByExpenseId,
  reservedPortions,
} from '@features/budget/bulk/bulkOverview';
import { monthIndexOf } from '@features/budget/bulk/bulkSplit';
import { useDeviceType } from '@hooks/useDeviceType';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, hexToRgba, Layout, Spacing, useAppColors } from '@theme';
import { resolveCategoryIcon } from '@utils/budgetCategoryIcon';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import {
  BUDGET_CTA_ROW_STYLES,
  budgetCtaOutline,
  budgetCtaTint,
} from './budgetCtaLayout';
import {
  budgetPriorityColor,
  formatBudgetCurrency as formatCurrency,
  formatBudgetCurrencyRange as formatCurrencyRange,
} from './budgetFormat';
import {
  BUDGET_STICKY_HEADER_INDICES,
  BUDGET_STICKY_SCROLL_CONTENT,
  BudgetMonthHeader,
  MONTH_ABBR,
  monthLabel,
  monthYearLabel,
  shiftMonth,
} from './BudgetMonthHeader';
import { BudgetSpendingExtraBanner } from './BudgetSpendingExtraBanner';
import {
  extraTotalCents,
  SPENDING_EXTRA_KINDS,
  type SpendingExtraKind,
} from './budgetSpendingExtras';

function formatExpenseDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}


/**
 * Re-targets a planned item's `target_date` into `{destYear, destMonth}` while
 * preserving the original day-of-month (clamped to the destination month's last
 * day). Undated ("Anytime") sources copy onto the 1st so the copy actually lands
 * in the chosen month instead of staying undated (and thus in every month).
 */
export function shiftDateToMonth(
  targetDate: string | null,
  destYear: number,
  destMonth: number,
): string {
  const day = targetDate ? Number(targetDate.slice(8, 10)) || 1 : 1;
  const lastDay = new Date(destYear, destMonth, 0).getDate();
  const clamped = Math.min(day, lastDay);
  return `${destYear}-${String(destMonth).padStart(2, '0')}-${String(
    clamped,
  ).padStart(2, '0')}`;
}

/**
 * The plan a copied stock-up carries. `start_month` is left out on purpose: the
 * copy is dated in the destination month, and the ledger anchors the plan there.
 */
function copiedBulkPlan(plan: NonNullable<Expense['bulk']>) {
  return {
    months: plan.months,
    suggested_months: plan.suggested_months,
    basis: plan.basis,
    quantity: plan.quantity ?? null,
    unit: plan.unit ?? null,
  };
}

function defaultAmountCents(item: BudgetItem): number {
  const min = item.estimated_cost_min ?? 0;
  const max = item.estimated_cost_max ?? min;
  return Math.round((min + max) / 2) || min || max;
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

interface Props {
  variant: 'planned' | 'spent';
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  onEditItem: (itemId: string) => void;
  onEditExpense: (expense: Expense) => void;
  /** Opens the "All spending" explorer (filters + distributions). Spent tab only. */
  onSeeAllSpending?: () => void;
  /** Opens the "All planned" explorer (filters + distributions). Planned tab only. */
  onSeeAllPlanned?: () => void;
  /**
   * Opens the page behind a Spent-tab banner — discounts saved, deposits paid
   * or taxes paid: what the figure is, how it is calculated, the previous
   * months. Spent tab only; without it the banners are plain statements.
   */
  onOpenSpendingExtras?: (kind: SpendingExtraKind) => void;
  /**
   * Opens Budget Settings so the user can set this month's cap. When provided,
   * a reminder banner is shown while no budget is set for the visible month.
   */
  onSetBudget?: () => void;
  /**
   * Reports the multi-select toolbar going up/down so the screen around this
   * view can stand down while it is. `BudgetScreen` uses it to pull the header
   * "+" — the add actions belong to the list, not to a batch selection, and the
   * old inline CTA row hid itself here for the same reason.
   */
  onSelectionModeChange?: (active: boolean) => void;
}

export function BudgetSpendingsView({
  variant,
  year,
  month,
  onMonthChange,
  onEditItem,
  onEditExpense,
  onSeeAllSpending,
  onSeeAllPlanned,
  onOpenSpendingExtras,
  onSetBudget,
  onSelectionModeChange,
}: Props) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const { isIPad, width } = useDeviceType();
  const useCenteredSheet = isIPad && width >= Layout.sidebarBreakpoint;
  // "Confirm amount" is a bottom-anchored sheet with a money field in it, so the
  // keypad opens straight on top of the field and its buttons. Lift the sheet by
  // the keyboard inset (a KeyboardAvoidingView is unreliable inside a Modal).
  const keyboardInset = useKeyboardInset();
  const { currentHousehold } = useHouseholdStore();
  const { markInsightsDirty, dataRevision } = useBudgetStore();

  const [overview, setOverview] = useState<MonthlyOverview | null>(null);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recordConfirmItem, setRecordConfirmItem] = useState<BudgetItem | null>(
    null,
  );
  const [recordAmount, setRecordAmount] = useState('');
  const [recordAmountError, setRecordAmountError] = useState<
    string | undefined
  >();

  // Multi-select (both tabs): a "Select" button flips rows into checkbox mode for
  // batch copy-to-month / delete. selectedIds holds the chosen planned item /
  // spent expense ids (the source list is variant-aware — see selectableRows).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  // Copy-to-month picker: which month the selection is copied into.
  const [copySheetVisible, setCopySheetVisible] = useState(false);
  const [copyYear, setCopyYear] = useState(year);
  const [copyMonth, setCopyMonth] = useState(month);

  // Swipe "Copy" on a single row: which row is waiting on a destination month.
  // The action used to duplicate in place, but a row is nearly always copied
  // FORWARD (this month's rent into next month), which made the in-place copy a
  // two-step edit. The wheel opens on the month being viewed, so confirming
  // without turning it reproduces exactly the old in-place duplicate.
  const [copyRow, setCopyRow] = useState<
    | { kind: 'planned'; item: BudgetItem }
    | { kind: 'spent'; expense: Expense }
    | null
  >(null);

  const swipeableRefs = useRef<
    Map<string, React.RefObject<SwipeableMethods | null>>
  >(new Map());

  const getSwipeableRef = useCallback((itemId: string) => {
    let ref = swipeableRefs.current.get(itemId);
    if (!ref) {
      ref = React.createRef<SwipeableMethods>();
      swipeableRefs.current.set(itemId, ref);
    }
    return ref;
  }, []);

  const closeSwipe = useCallback(
    (itemId: string) => {
      getSwipeableRef(itemId).current?.close();
    },
    [getSwipeableRef],
  );

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const [data, categoryRes] = await Promise.all([
        budgetApi.getMonthlyOverview(currentHousehold.id, year, month),
        budgetApi.getCategories(currentHousehold.id),
      ]);
      setOverview(data);
      setCategories(categoryRes.categories);
    } catch (error) {
      // Never leave the previous month's data on screen when a fetch fails —
      // otherwise a failed load silently masquerades as "this month has the same
      // spendings as last month" (every month renders the last good response).
      setOverview(null);
      console.error('Error loading monthly overview:', error);
    }
  }, [currentHousehold?.id, month, year]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  React.useEffect(() => {
    if (dataRevision === 0) return;
    void load();
  }, [dataRevision, load]);

  const categoryById = useMemo(
    () => new Map(categories.map(cat => [cat.id, cat])),
    [categories],
  );

  // Month lens for the list: what each listed row COUNTS here (its portion when
  // it is a stock-up), and the portions reserved from purchases made in
  // earlier months — the "From bulk purchases" group.
  const bulkPortionById = useMemo(() => portionByExpenseId(overview), [overview]);
  const reservedBulk = useMemo(() => reservedPortions(overview), [overview]);

  const { affordableItems, deferredItems, otherPlanned, spentExpenses } =
    useMemo(() => {
      if (!overview) {
        return {
          affordableItems: [],
          deferredItems: [],
          otherPlanned: [],
          spentExpenses: [] as Expense[],
        };
      }
      const affordableIds = new Set(
        overview.affordability.affordable.map(i => i.id),
      );
      const deferredIds = new Set(
        overview.affordability.deferred.map(i => i.id),
      );
      const byId = new Map(overview.items.map(i => [i.id, i]));

      const dated = overview.items.filter(i => !!i.target_date);
      const undated = overview.items.filter(i => !i.target_date);

      return {
        affordableItems: overview.affordability.affordable
          .map(scored => byId.get(scored.id))
          .filter((i): i is BudgetItem => !!i),
        deferredItems: overview.affordability.deferred
          .map(scored => byId.get(scored.id))
          .filter((i): i is BudgetItem => !!i),
        otherPlanned: [...dated, ...undated].filter(
          i => !affordableIds.has(i.id) && !deferredIds.has(i.id),
        ),
        spentExpenses: overview.expenses ?? [],
      };
    }, [overview]);

  const isPlannedTab = variant === 'planned';

  // Flat list of every planned row on screen (all three sections), in the order
  // they render — the source of truth for "select all" and batch lookups.
  const allPlanned = useMemo(
    () => [...affordableItems, ...deferredItems, ...otherPlanned],
    [affordableItems, deferredItems, otherPlanned],
  );

  // The rows the current tab can multi-select over: planned items on the planned
  // tab, recorded expenses on the spent tab. Both carry an `id`, so the selection
  // machinery (toggle / select-all / batch) treats them uniformly.
  const selectableRows: Array<{ id: string }> = isPlannedTab
    ? allPlanned
    : spentExpenses;

  // Leaving the month (or losing rows) must not strand a stale selection — reset
  // selection mode whenever the visible month changes.
  React.useEffect(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [year, month]);

  // Tell the screen around us whether the batch toolbar is up, so it can pull
  // the header "+" for as long as it is. The cleanup reports `false` on unmount
  // too — switching tabs drops this view mid-selection, and a header left with
  // no add button would be the visible symptom.
  React.useEffect(() => {
    onSelectionModeChange?.(selectionMode);
    return () => onSelectionModeChange?.(false);
  }, [selectionMode, onSelectionModeChange]);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedCount = selectedIds.size;
  const allSelected =
    selectableRows.length > 0 && selectedCount === selectableRows.length;

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev =>
      prev.size === selectableRows.length
        ? new Set()
        : new Set(selectableRows.map(i => i.id)),
    );
  }, [selectableRows]);

  const openCopySheet = useCallback(() => {
    // Default the picker to next month — the most common "copy this month's plan
    // forward" case — so a one-tap confirm just works.
    const next = shiftMonth(year, month, -1);
    setCopyYear(next.year);
    setCopyMonth(next.month);
    setCopySheetVisible(true);
  }, [month, year]);

  const performCopy = useCallback(async () => {
    if (!currentHousehold?.id || selectedIds.size === 0) return;
    setBatchBusy(true);
    try {
      if (isPlannedTab) {
        const items = allPlanned.filter(i => selectedIds.has(i.id));
        for (const item of items) {
          await budgetApi.createItem(currentHousehold.id, {
            title: item.title,
            description: item.description ?? undefined,
            category_id: item.category_id ?? undefined,
            timeframe: item.timeframe,
            priority: item.priority,
            estimated_cost_min: item.estimated_cost_min ?? undefined,
            estimated_cost_max: item.estimated_cost_max ?? undefined,
            is_recurring: item.is_recurring,
            ...(item.recurrence_frequency
              ? {
                  recurrence_frequency: item.recurrence_frequency as
                    | 'monthly'
                    | 'quarterly'
                    | 'yearly',
                }
              : {}),
            target_date: shiftDateToMonth(
              item.target_date,
              copyYear,
              copyMonth,
            ),
          });
        }
      } else {
        // Spent tab: re-record each selected expense into the destination month,
        // preserving its day-of-month (shiftDateToMonth clamps to month length).
        const expenses = spentExpenses.filter(e => selectedIds.has(e.id));
        for (const expense of expenses) {
          await budgetApi.addExpense(currentHousehold.id, {
            title: expense.title,
            description: expense.description ?? undefined,
            amount: expense.amount,
            expense_date: shiftDateToMonth(
              expense.expense_date,
              copyYear,
              copyMonth,
            ),
            category_id: expense.category_id ?? undefined,
            vendor: expense.vendor ?? undefined,
            saved_amount: expense.saved_amount,
            // A stock-up copies with its plan, re-anchored on the new month.
            ...(expense.bulk ? { bulk: copiedBulkPlan(expense.bulk) } : {}),
          });
        }
      }
      markInsightsDirty(currentHousehold.id);
      setCopySheetVisible(false);
      exitSelection();
      // Jump to the destination month so the fresh copies are visible and editable.
      onMonthChange(copyYear, copyMonth);
    } catch (error) {
      console.error('Error copying spendings:', error);
      Alert.alert(
        'Error',
        isPlannedTab
          ? 'Could not copy the selected planned spendings.'
          : 'Could not copy the selected spendings.',
      );
    } finally {
      setBatchBusy(false);
    }
  }, [
    allPlanned,
    spentExpenses,
    isPlannedTab,
    copyMonth,
    copyYear,
    currentHousehold?.id,
    exitSelection,
    markInsightsDirty,
    onMonthChange,
    selectedIds,
  ]);

  const performBatchDelete = useCallback(() => {
    if (!currentHousehold?.id || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const count = ids.length;
    const noun = isPlannedTab ? 'planned spending' : 'spending';
    Alert.alert(
      isPlannedTab ? 'Delete planned spendings' : 'Delete spendings',
      `Delete ${count} selected ${noun}${count > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBatchBusy(true);
            try {
              for (const id of ids) {
                if (isPlannedTab) {
                  await budgetApi.deleteItem(currentHousehold.id, id);
                } else {
                  await budgetApi.deleteExpense(currentHousehold.id, id);
                }
              }
              markInsightsDirty(currentHousehold.id);
              exitSelection();
              await load();
            } catch (error) {
              console.error('Error deleting spendings:', error);
              Alert.alert('Error', `Could not delete the selected ${noun}s.`);
            } finally {
              setBatchBusy(false);
            }
          },
        },
      ],
    );
  }, [
    currentHousehold?.id,
    exitSelection,
    isPlannedTab,
    load,
    markInsightsDirty,
    selectedIds,
  ]);

  const openRecordConfirm = useCallback(
    (item: BudgetItem) => {
      closeSwipe(item.id);
      setRecordAmount(toDollarsString(defaultAmountCents(item)));
      setRecordAmountError(undefined);
      setRecordConfirmItem(item);
    },
    [closeSwipe],
  );

  const closeRecordConfirm = useCallback(() => {
    setRecordConfirmItem(null);
    setRecordAmount('');
    setRecordAmountError(undefined);
  }, []);

  const submitRecordSpending = useCallback(async () => {
    if (!currentHousehold?.id || !recordConfirmItem) return;
    const amount = toCents(recordAmount);
    if (!amount) {
      setRecordAmountError('Enter a valid amount greater than zero.');
      return;
    }

    const item = recordConfirmItem;
    setBusyId(item.id);
    try {
      await budgetApi.recordPlannedSpending(currentHousehold.id, item.id, {
        amount,
      });
      markInsightsDirty(currentHousehold.id);
      closeRecordConfirm();
      await load();
    } catch (error) {
      console.error('Error recording spending:', error);
      Alert.alert('Error', 'Could not record this spending.');
    } finally {
      setBusyId(null);
    }
  }, [
    closeRecordConfirm,
    currentHousehold?.id,
    load,
    markInsightsDirty,
    recordAmount,
    recordConfirmItem,
  ]);

  /**
   * Copies one planned item into `dest`.
   *
   * Into the month already on screen, the source `target_date` is carried over
   * verbatim — including "Anytime" (undated), which `shiftDateToMonth` would
   * pin to the 1st. Into any other month the day-of-month is preserved and
   * clamped, and the view follows the copy so it is visible and editable.
   */
  const handleDuplicatePlanned = useCallback(
    async (item: BudgetItem, dest: { year: number; month: number }) => {
      if (!currentHousehold?.id) return;
      const sameMonth = dest.year === year && dest.month === month;
      setBusyId(item.id);
      try {
        await budgetApi.createItem(currentHousehold.id, {
          title: item.title,
          description: item.description ?? undefined,
          category_id: item.category_id ?? undefined,
          timeframe: item.timeframe,
          priority: item.priority,
          estimated_cost_min: item.estimated_cost_min ?? undefined,
          estimated_cost_max: item.estimated_cost_max ?? undefined,
          is_recurring: item.is_recurring,
          ...(item.recurrence_frequency
            ? {
                recurrence_frequency: item.recurrence_frequency as
                  | 'monthly'
                  | 'quarterly'
                  | 'yearly',
              }
            : {}),
          ...(sameMonth
            ? item.target_date
              ? { target_date: item.target_date }
              : {}
            : {
                target_date: shiftDateToMonth(
                  item.target_date,
                  dest.year,
                  dest.month,
                ),
              }),
        });
        markInsightsDirty(currentHousehold.id);
        if (sameMonth) {
          await load();
        } else {
          onMonthChange(dest.year, dest.month);
        }
      } catch (error) {
        console.error('Error duplicating planned spending:', error);
        Alert.alert('Error', 'Could not duplicate this planned spending.');
      } finally {
        setBusyId(null);
      }
    },
    [currentHousehold?.id, load, markInsightsDirty, month, onMonthChange, year],
  );

  /** Copies one recorded expense into `dest` — see `handleDuplicatePlanned`. */
  const handleDuplicateExpense = useCallback(
    async (expense: Expense, dest: { year: number; month: number }) => {
      if (!currentHousehold?.id) return;
      const sameMonth = dest.year === year && dest.month === month;
      try {
        setBusyId(expense.id);
        await budgetApi.addExpense(currentHousehold.id, {
          title: expense.title,
          description: expense.description ?? undefined,
          amount: expense.amount,
          expense_date: sameMonth
            ? expense.expense_date
            : shiftDateToMonth(expense.expense_date, dest.year, dest.month),
          category_id: expense.category_id ?? undefined,
          vendor: expense.vendor ?? undefined,
          // `amount` is tax-INCLUSIVE, so a copy that dropped these reported the
          // same purchase as untaxed and undiscounted.
          saved_amount: expense.saved_amount,
          ...(expense.tax_amount ? { tax_amount: expense.tax_amount } : {}),
          ...(expense.deposit_amount
            ? { deposit_amount: expense.deposit_amount }
            : {}),
          ...(expense.bulk ? { bulk: copiedBulkPlan(expense.bulk) } : {}),
        });
        markInsightsDirty(currentHousehold.id);
        if (sameMonth) {
          await load();
        } else {
          onMonthChange(dest.year, dest.month);
        }
      } catch (error) {
        console.error('Error duplicating spending:', error);
        Alert.alert('Error', 'Could not duplicate this spending.');
      } finally {
        setBusyId(null);
      }
    },
    [currentHousehold?.id, load, markInsightsDirty, month, onMonthChange, year],
  );

  /**
   * Opens the destination-month wheel for one row. Closing the swipe first
   * keeps the open action panel from sitting under the sheet.
   */
  const openRowCopySheet = useCallback(
    (
      row:
        | { kind: 'planned'; item: BudgetItem }
        | { kind: 'spent'; expense: Expense },
    ) => {
      closeSwipe(row.kind === 'planned' ? row.item.id : row.expense.id);
      setCopyRow(row);
    },
    [closeSwipe],
  );

  // The sheet calls `onConfirm` then `onClose`, so the row is read here before
  // `setCopyRow(null)` clears it; the copy itself runs on its own reference.
  const confirmRowCopy = useCallback(
    (key: string) => {
      const dest = parseMonthKey(key);
      if (!dest || !copyRow) return;
      if (copyRow.kind === 'planned') {
        void handleDuplicatePlanned(copyRow.item, dest);
      } else {
        void handleDuplicateExpense(copyRow.expense, dest);
      }
    },
    [copyRow, handleDuplicateExpense, handleDuplicatePlanned],
  );

  const handleDelete = useCallback(
    (item: BudgetItem) => {
      if (!currentHousehold?.id) return;
      closeSwipe(item.id);
      Alert.alert('Delete planned spending', `Delete "${item.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(item.id);
            try {
              await budgetApi.deleteItem(currentHousehold.id, item.id);
              markInsightsDirty(currentHousehold.id);
              await load();
            } catch (error) {
              console.error('Error deleting budget item:', error);
              Alert.alert('Error', 'Could not delete this item.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
    },
    [closeSwipe, currentHousehold?.id, load, markInsightsDirty],
  );

  const handleDeleteExpense = useCallback(
    (expense: Expense) => {
      if (!currentHousehold?.id) return;
      closeSwipe(expense.id);
      Alert.alert('Delete spending', `Delete "${expense.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(expense.id);
            try {
              await budgetApi.deleteExpense(currentHousehold.id, expense.id);
              markInsightsDirty(currentHousehold.id);
              await load();
            } catch (error) {
              console.error('Error deleting expense:', error);
              Alert.alert('Error', 'Could not delete this spending.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
    },
    [closeSwipe, currentHousehold?.id, load, markInsightsDirty],
  );

  const handleEditPlanned = useCallback(
    (item: BudgetItem) => {
      closeSwipe(item.id);
      onEditItem(item.id);
    },
    [closeSwipe, onEditItem],
  );

  const renderPlannedActions = useCallback(
    (item: BudgetItem, rounding?: StyleProp<ViewStyle>) => {
      const isBusy = busyId === item.id;
      return (
        <NativeSwipeActions style={rounding}>
          <NativeSwipeAction
            backgroundColor={theme.pastel.teal}
            onPress={() => handleEditPlanned(item)}
            disabled={isBusy}
            label="Edit"
            testID="budget-edit-planned"
          >
            <Icon name="pencil" size={20} color={colors.white} />
          </NativeSwipeAction>
          {/* Saturated blue, not the near-white `pastel.skyBlue`: a white glyph
              on that pastel fill was effectively invisible in the open row. */}
          <NativeSwipeAction
            backgroundColor={colors.blue}
            onPress={() => openRowCopySheet({ kind: 'planned', item })}
            disabled={isBusy}
            label="Copy"
            testID="budget-duplicate-planned"
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Icon name="copy-outline" size={20} color={colors.white} />
            )}
          </NativeSwipeAction>
          <NativeSwipeAction
            backgroundColor={colors.success}
            onPress={() => openRecordConfirm(item)}
            disabled={isBusy}
            label="Record"
            testID="budget-record-spending"
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Icon name="checkmark" size={22} color={colors.white} />
            )}
          </NativeSwipeAction>
          <NativeSwipeAction
            backgroundColor={colors.error}
            onPress={() => handleDelete(item)}
            disabled={isBusy}
            label="Delete"
            testID="budget-delete-planned"
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Icon name="trash-outline" size={20} color={colors.white} />
            )}
          </NativeSwipeAction>
        </NativeSwipeActions>
      );
    },
    [
      busyId,
      colors.success,
      colors.white,
      handleDelete,
      handleEditPlanned,
      openRecordConfirm,
      openRowCopySheet,
      colors.blue,
      colors.error,
      theme.pastel.teal,
    ],
  );

  const handleEditExpense = useCallback(
    (expense: Expense) => {
      closeSwipe(expense.id);
      onEditExpense(expense);
    },
    [closeSwipe, onEditExpense],
  );

  // A reserved portion is not a row of its own: tapping it opens the purchase
  // it belongs to, in whichever month that was recorded.
  const openReservedPortion = useCallback(
    async (portion: BulkPortionView) => {
      if (!currentHousehold?.id) return;
      try {
        const { expense } = await budgetApi.getExpense(
          currentHousehold.id,
          portion.expenseId,
        );
        onEditExpense(expense);
      } catch (error) {
        console.error('Error opening bulk purchase:', error);
        Alert.alert('Error', 'Could not open this bulk purchase.');
      }
    },
    [currentHousehold?.id, onEditExpense],
  );

  const renderExpenseActions = useCallback(
    (expense: Expense, rounding?: StyleProp<ViewStyle>) => {
      const isBusy = busyId === expense.id;
      return (
        <NativeSwipeActions style={rounding}>
          <NativeSwipeAction
            backgroundColor={theme.pastel.teal}
            onPress={() => handleEditExpense(expense)}
            disabled={isBusy}
            label="Edit"
            testID="budget-edit-spent"
          >
            <Icon name="pencil" size={20} color={colors.white} />
          </NativeSwipeAction>
          <NativeSwipeAction
            backgroundColor={colors.blue}
            onPress={() => openRowCopySheet({ kind: 'spent', expense })}
            disabled={isBusy}
            label="Copy"
            testID="budget-duplicate-spent"
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Icon name="copy-outline" size={20} color={colors.white} />
            )}
          </NativeSwipeAction>
          <NativeSwipeAction
            backgroundColor={colors.error}
            onPress={() => handleDeleteExpense(expense)}
            disabled={isBusy}
            label="Delete"
            testID="budget-delete-spent"
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Icon name="trash-outline" size={20} color={colors.white} />
            )}
          </NativeSwipeAction>
        </NativeSwipeActions>
      );
    },
    [
      busyId,
      colors.white,
      handleDeleteExpense,
      handleEditExpense,
      openRowCopySheet,
      colors.blue,
      colors.error,
      theme.pastel.teal,
    ],
  );

  const renderPlannedItemBody = (item: BudgetItem) => (
    <>
      <View
        style={[
          styles.priorityDot,
          { backgroundColor: budgetPriorityColor(colors, item.priority) },
        ]}
      />
      <View style={styles.itemContent}>
        <Typography variant="body" weight="medium" numberOfLines={1}>
          {item.title}
        </Typography>
        {!!item.description && (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            numberOfLines={1}
          >
            {item.description}
          </Typography>
        )}
      </View>
      <Typography variant="subheadline" weight="semibold">
        {formatCurrencyRange(item.estimated_cost_min, item.estimated_cost_max)}
      </Typography>
    </>
  );

  const renderPlannedItem = (
    item: BudgetItem,
    index: number,
    count: number,
  ) => {
    // Selection mode swaps swipe actions for a leading checkbox; tapping the row
    // toggles selection instead of opening the edit form.
    if (selectionMode) {
      const selected = selectedIds.has(item.id);
      return (
        <TouchableOpacity
          key={item.id}
          style={[
            styles.itemRow,
            {
              borderTopColor: colors.borderColor,
              backgroundColor: colors.backgroundSecondary,
            },
            index === 0 && styles.itemRowFirst,
            index === count - 1 && styles.itemRowLast,
            selected && { backgroundColor: hexToRgba(colors.primary, 0.1) },
          ]}
          onPress={() => toggleSelected(item.id)}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected, selected: selected }}
          testID={`budget-select-row-${item.id}`}
        >
          <View
            style={[
              styles.checkbox,
              { borderColor: selected ? colors.primary : colors.borderColor },
              selected && { backgroundColor: colors.primary },
            ]}
          >
            {selected && (
              <Icon name="checkmark" size={14} color={colors.white} />
            )}
          </View>
          {renderPlannedItemBody(item)}
        </TouchableOpacity>
      );
    }

    return (
      <NativeSwipeable
        key={item.id}
        ref={getSwipeableRef(item.id)}
        renderRightActions={() =>
          renderPlannedActions(item, swipeActionRounding(index, count))
        }
      >
        <GHTouchableOpacity
          style={[
            styles.itemRow,
            {
              borderTopColor: colors.borderColor,
              backgroundColor: colors.backgroundSecondary,
            },
            index === 0 && styles.itemRowFirst,
            index === count - 1 && styles.itemRowLast,
          ]}
          onPress={() => handleEditPlanned(item)}
          activeOpacity={0.7}
          testID="budget-planned-item"
        >
          {renderPlannedItemBody(item)}
        </GHTouchableOpacity>
      </NativeSwipeable>
    );
  };

  const renderCategoryBadge = (categoryId: string | null) => {
    const category = categoryId ? categoryById.get(categoryId) : undefined;
    if (!category) return null;
    return (
      <View
        style={[
          styles.categoryBadge,
          {
            backgroundColor: `${category.color ?? theme.pastel.teal}22`,
          },
        ]}
        testID="budget-spent-category-badge"
      >
        <Icon
          name={resolveCategoryIcon(category)}
          size={14}
          color={category.color ?? colors.textSecondary}
        />
        <Typography
          variant="caption2"
          weight="medium"
          color={category.color ?? colors.textSecondary}
          numberOfLines={1}
        >
          {category.name}
        </Typography>
      </View>
    );
  };

  const renderExpenseBody = (expense: Expense) => {
    // A stock-up shows what it COUNTS this month; the chip carries the whole.
    const portion = bulkPortionById.get(expense.id);
    return (
      <>
        <View
          style={[styles.priorityDot, { backgroundColor: theme.pastel.teal }]}
        />
        <View style={styles.itemContent}>
          <Typography variant="body" weight="medium" numberOfLines={1}>
            {expense.title}
          </Typography>
          <View style={styles.expenseMeta}>
            {renderCategoryBadge(expense.category_id)}
            <Typography variant="caption1" color={colors.textSecondary}>
              {formatExpenseDate(expense.expense_date)}
            </Typography>
            <Chip
              label={(expense.tax_amount ?? 0) > 0 ? 'Tax' : 'No tax'}
              size="sm"
              variant={(expense.tax_amount ?? 0) > 0 ? 'warning' : 'secondary'}
            />
            {portion && (
              <Chip
                label={`Bulk · ${portion.index} of ${portion.months} · ${formatCurrency(
                  portion.total_cents,
                )} total`}
                size="sm"
                variant="primary"
                testID="budget-spent-bulk-chip"
              />
            )}
          </View>
        </View>
        <Typography
          variant="subheadline"
          weight="semibold"
          color={theme.pastel.teal}
          testID="budget-spent-amount"
        >
          {formatCurrency(countedAmountOf(expense, bulkPortionById))}
        </Typography>
      </>
    );
  };

  /** "From bulk purchases": a share of an earlier month's stock-up. Read-only here. */
  const renderReservedPortion = (
    portion: BulkPortionView,
    index: number,
    count: number,
  ) => {
    const purchaseYear = Number(portion.purchase_date.slice(0, 4));
    const purchaseMonth = Number(portion.purchase_date.slice(5, 7));
    return (
      <TouchableOpacity
        key={`${portion.expenseId}:${portion.index}`}
        style={[
          styles.itemRow,
          {
            borderTopColor: colors.borderColor,
            backgroundColor: colors.backgroundSecondary,
          },
          index === 0 && styles.itemRowFirst,
          index === count - 1 && styles.itemRowLast,
        ]}
        onPress={() => void openReservedPortion(portion)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${portion.title}, bulk purchase from ${monthYearLabel(
          purchaseYear,
          purchaseMonth,
        )}, part ${portion.index} of ${portion.months}`}
        testID="budget-reserved-portion"
      >
        <View style={[styles.priorityDot, { backgroundColor: colors.blue }]} />
        <View style={styles.itemContent}>
          <Typography variant="body" weight="medium" numberOfLines={1}>
            {portion.title}
          </Typography>
          <View style={styles.expenseMeta}>
            {renderCategoryBadge(portion.category_id)}
            <Chip
              label={`Bulk purchase · ${monthLabel(purchaseMonth)} ${purchaseYear} · ${
                portion.index
              } of ${portion.months}`}
              size="sm"
              variant="primary"
              testID="budget-reserved-bulk-chip"
            />
          </View>
        </View>
        <Typography variant="subheadline" weight="semibold" color={colors.blue}>
          {formatCurrency(portion.portion_cents)}
        </Typography>
      </TouchableOpacity>
    );
  };

  const renderExpenseItem = (
    expense: Expense,
    index: number,
    count: number,
  ) => {
    // Selection mode swaps swipe actions for a leading checkbox; tapping the row
    // toggles selection instead of opening the edit form.
    if (selectionMode) {
      const selected = selectedIds.has(expense.id);
      return (
        <TouchableOpacity
          key={expense.id}
          style={[
            styles.itemRow,
            {
              borderTopColor: colors.borderColor,
              backgroundColor: colors.backgroundSecondary,
            },
            index === 0 && styles.itemRowFirst,
            index === count - 1 && styles.itemRowLast,
            selected && { backgroundColor: hexToRgba(colors.primary, 0.1) },
          ]}
          onPress={() => toggleSelected(expense.id)}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected, selected: selected }}
          testID={`budget-select-row-${expense.id}`}
        >
          <View
            style={[
              styles.checkbox,
              { borderColor: selected ? colors.primary : colors.borderColor },
              selected && { backgroundColor: colors.primary },
            ]}
          >
            {selected && (
              <Icon name="checkmark" size={14} color={colors.white} />
            )}
          </View>
          {renderExpenseBody(expense)}
        </TouchableOpacity>
      );
    }

    return (
      <NativeSwipeable
        key={expense.id}
        ref={getSwipeableRef(expense.id)}
        renderRightActions={() =>
          renderExpenseActions(expense, swipeActionRounding(index, count))
        }
      >
        <GHTouchableOpacity
          style={[
            styles.itemRow,
            {
              borderTopColor: colors.borderColor,
              backgroundColor: colors.backgroundSecondary,
            },
            index === 0 && styles.itemRowFirst,
            index === count - 1 && styles.itemRowLast,
          ]}
          onPress={() => handleEditExpense(expense)}
          activeOpacity={0.7}
          testID="budget-spent-item"
        >
          {renderExpenseBody(expense)}
        </GHTouchableOpacity>
      </NativeSwipeable>
    );
  };

  // Spending is a record of what's already been paid — it can't project into the
  // future. Cap forward navigation on the spent tab at the current month, or at
  // the last month a stock-up still reserves a share in, whichever is later;
  // the planned tab (and other tabs) still scroll freely into future months.
  const now = new Date();
  const currentMonthIndex = now.getFullYear() * 12 + (now.getMonth() + 1);
  const selectedMonthIndex = year * 12 + month;
  const lastReservedIndex = overview?.bulkLastMonth
    ? monthIndexOf(overview.bulkLastMonth) + 1
    : 0;
  const blockForwardMonth =
    !isPlannedTab &&
    selectedMonthIndex >= Math.max(currentMonthIndex, lastReservedIndex);

  const rootTestId = isPlannedTab
    ? 'budget-planned-spendings'
    : 'budget-spendings';
  const isEmpty = isPlannedTab
    ? affordableItems.length === 0 &&
      deferredItems.length === 0 &&
      otherPlanned.length === 0
    : spentExpenses.length === 0 && reservedBulk.length === 0;

  // Planned groups in render order; only the non-empty ones are shown, and the
  // first carries the "See all" link (see below).
  const plannedSections = [
    {
      key: 'affordable',
      title: 'Planned · fits this month',
      items: affordableItems,
    },
    {
      key: 'deferred',
      title: "Planned · doesn't fit yet",
      items: deferredItems,
    },
    { key: 'other', title: 'Planned · other', items: otherPlanned },
  ].filter(section => section.items.length > 0);

  // Nudge the user to set a monthly cap while none exists for the visible month —
  // a no-budget month can't show a remaining balance anywhere in the app.
  const noBudgetSet = !!overview && (overview.plannedBudget ?? 0) <= 0;

  return (
    <ScrollView
      {...keyboardDismissScrollProps}
      testID={rootTestId}
      style={styles.scroll}
      contentContainerStyle={BUDGET_STICKY_SCROLL_CONTENT}
      showsVerticalScrollIndicator={false}
      stickyHeaderIndices={BUDGET_STICKY_HEADER_INDICES}
    >
      {/* Sticky index 0 — month stepper stays pinned while the list below
          scrolls. Shared with Planning/Savings/Pension so the header's metrics
          can't drift per screen (see BudgetMonthHeader). */}
      <BudgetMonthHeader
        label={monthYearLabel(year, month)}
        onPrev={() => {
          const prev = shiftMonth(year, month, 1);
          onMonthChange(prev.year, prev.month);
        }}
        onNext={() => {
          const next = shiftMonth(year, month, -1);
          onMonthChange(next.year, next.month);
        }}
        nextDisabled={blockForwardMonth}
        prevTestID="budget-spendings-month-prev"
        nextTestID="budget-spendings-month-next"
      >
        {/* Selection mode replaces the add/quick-add rows with a select
            toolbar. It rides along as the header's child so it shares the ONE
            pinned band: Cancel / Copy to month / Delete stay reachable no
            matter how far the list is scrolled (scrolling away from the batch
            actions while ticking rows was the bug). Sticky children must stay
            here — a second `stickyHeaderIndices` entry would push the month
            stepper off instead of stacking under it. */}
        {selectionMode ? (
          // Same reading-width cap as the list below, so the toolbar lines up
          // with the rows it acts on instead of stretching on iPad.
          <ResponsiveLayout maxWidth={700} centerContent padding={0}>
            <View style={styles.selectionBlock}>
              <View
                style={styles.selectionToolbar}
                testID="budget-selection-toolbar"
              >
                <TouchableOpacity
                  onPress={exitSelection}
                  style={styles.selectionToolbarSide}
                  disabled={batchBusy}
                  accessibilityRole="button"
                  testID="budget-selection-cancel"
                >
                  <Typography
                    variant="body"
                    weight="semibold"
                    color={colors.primary}
                  >
                    Cancel
                  </Typography>
                </TouchableOpacity>
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  testID="budget-selection-count"
                >
                  {selectedCount === 0
                    ? isPlannedTab
                      ? 'Select planned items'
                      : 'Select spendings'
                    : `${selectedCount} selected`}
                </Typography>
                <TouchableOpacity
                  onPress={toggleSelectAll}
                  style={[
                    styles.selectionToolbarSide,
                    styles.selectionToolbarSideEnd,
                  ]}
                  disabled={batchBusy || selectableRows.length === 0}
                  accessibilityRole="button"
                  testID="budget-selection-selectall"
                >
                  <Typography
                    variant="body"
                    weight="semibold"
                    color={colors.primary}
                  >
                    {allSelected ? 'Clear' : 'Select all'}
                  </Typography>
                </TouchableOpacity>
              </View>
              <View style={styles.selectionActions}>
                <GHTouchableOpacity
                  onPress={openCopySheet}
                  activeOpacity={0.85}
                  containerStyle={styles.selectionActionSlot}
                  style={[
                    styles.addCta,
                    budgetCtaOutline(colors.primary),
                    selectedCount === 0 && styles.actionDisabled,
                  ]}
                  disabled={selectedCount === 0 || batchBusy}
                  testID="budget-batch-copy"
                >
                  <Icon
                    name="copy-outline"
                    size={16}
                    color={budgetCtaTint('outline', colors)}
                  />
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={budgetCtaTint('outline', colors)}
                  >
                    Copy to month
                  </Typography>
                </GHTouchableOpacity>
                <GHTouchableOpacity
                  onPress={performBatchDelete}
                  activeOpacity={0.85}
                  containerStyle={styles.selectionActionSlot}
                  style={[
                    styles.addCta,
                    styles.deleteCta,
                    { borderColor: colors.error },
                    selectedCount === 0 && styles.actionDisabled,
                  ]}
                  disabled={selectedCount === 0 || batchBusy}
                  testID="budget-batch-delete"
                >
                  {batchBusy ? (
                    <ActivityIndicator size="small" color={colors.error} />
                  ) : (
                    <Icon name="trash-outline" size={16} color={colors.error} />
                  )}
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={colors.error}
                  >
                    Delete
                  </Typography>
                </GHTouchableOpacity>
              </View>
            </View>
          </ResponsiveLayout>
        ) : null}
      </BudgetMonthHeader>

      {/* Reading-width cap + centering on iPad — without it this single column
          of cards/rows stretches edge-to-edge on wide screens (a
          stretched-iPhone layout, not a real iPad adaptation). No-op on phone
          widths (ResponsiveLayout only constrains when isTablet). Mirrors the
          BudgetDashboardView fix — sticky month selector above stays outside
          so stickyHeaderIndices={[0]} keeps working. */}
      <ResponsiveLayout maxWidth={700} centerContent padding={0}>
      {!selectionMode && noBudgetSet && onSetBudget && (
        <TouchableOpacity
          style={[
            styles.budgetReminder,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: colors.primary,
            },
          ]}
          onPress={onSetBudget}
          activeOpacity={0.7}
          testID="budget-set-budget-reminder"
          accessibilityRole="button"
          accessibilityLabel={`Set a budget for ${monthYearLabel(year, month)}`}
        >
          <View
            style={[
              styles.budgetReminderIcon,
              { backgroundColor: hexToRgba(colors.primary, 0.15) },
            ]}
          >
            <Icon name="wallet-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.budgetReminderText}>
            <Typography variant="subheadline" weight="semibold">
              No budget set for {monthYearLabel(year, month)}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              Set a monthly cap to track how much you have left.
            </Typography>
          </View>
          <View style={styles.budgetReminderCta}>
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.primary}
            >
              Set budget
            </Typography>
            <Icon name="chevron-forward" size={14} color={colors.primary} />
          </View>
        </TouchableOpacity>
      )}

      {/* Only the main content area swaps to a spinner while loading — the month
          selector above stays statically mounted. */}
      {isLoading ? (
        <View
          style={styles.loadingContainer}
          testID={
            isPlannedTab
              ? 'budget-planned-spendings-loading'
              : 'budget-spendings-loading'
          }
        >
          <ActivityIndicator size="large" color={theme.pastel.teal} />
        </View>
      ) : (
        <>
          {isPlannedTab &&
            plannedSections.map((section, index) => (
              <Section
                key={section.key}
                title={section.title}
                items={section.items}
                renderItem={renderPlannedItem}
                // Mirror the Spent tab's header actions — "Select" sits to the LEFT
                // of "See all" on the first planned group (both flip/open the same
                // way as on Spent). Hidden while already selecting.
                selectAction={
                  index === 0 && !selectionMode
                    ? {
                        label: 'Select',
                        onPress: () => setSelectionMode(true),
                        testID: 'budget-planned-select',
                        accessibilityLabel: 'Select planned spendings',
                      }
                    : undefined
                }
                // A single "See all" link on the first planned group opens the
                // "All planned" explorer.
                action={
                  index === 0 && onSeeAllPlanned
                    ? {
                        label: 'See all',
                        onPress: onSeeAllPlanned,
                        testID: 'budget-see-all-planned',
                      }
                    : undefined
                }
              />
            ))}

          {/* Discounts saved / deposits paid / taxes paid — one banner per
              figure the month actually has, each a link (chevron) to the page
              that explains and charts it. Zero figures render nothing. */}
          {!isPlannedTab &&
            SPENDING_EXTRA_KINDS.map((kind) => {
              const cents = extraTotalCents(overview, kind);
              if (cents <= 0) return null;
              return (
                <BudgetSpendingExtraBanner
                  key={kind}
                  kind={kind}
                  cents={cents}
                  onPress={onOpenSpendingExtras}
                />
              );
            })}

          {!isPlannedTab && (spentExpenses.length > 0 || reservedBulk.length > 0) && (
            <View
              style={[styles.spentTotalRow, { backgroundColor: colors.backgroundSecondary }]}
            >
              <Typography variant="body" weight="semibold">
                Total spent
              </Typography>
              <Typography
                variant="headline"
                weight="bold"
                color={theme.pastel.teal}
                testID="budget-spent-total"
              >
                {formatCurrency(overview?.actualSpent ?? 0)}
              </Typography>
            </View>
          )}

          {!isPlannedTab && spentExpenses.length > 0 && (
            <Section
              title="Spent this month"
              items={spentExpenses}
              renderItem={renderExpenseItem}
              // "Select" sits to the LEFT of "See all" and flips the list into
              // multi-select mode for batch copy-to-month / delete. Hidden while
              // already selecting (the toolbar owns that state).
              selectAction={
                !selectionMode
                  ? {
                      label: 'Select',
                      onPress: () => setSelectionMode(true),
                      testID: 'budget-spent-select',
                      accessibilityLabel: 'Select spendings',
                    }
                  : undefined
              }
              action={
                onSeeAllSpending
                  ? {
                      label: 'See all',
                      onPress: onSeeAllSpending,
                      testID: 'budget-see-all-spending',
                    }
                  : undefined
              }
            />
          )}

          {!isPlannedTab && reservedBulk.length > 0 && (
            <Section
              title="From bulk purchases"
              items={reservedBulk}
              renderItem={renderReservedPortion}
            />
          )}

          {isEmpty && (
            <View style={styles.empty}>
              <Typography
                variant="body"
                color={colors.textSecondary}
                align="center"
              >
                {isPlannedTab
                  ? 'No planned spendings yet. Tap + to add one manually or with AI.'
                  : 'Nothing spent this month yet. Tap + to record something you paid for.'}
              </Typography>
            </View>
          )}
        </>
      )}
      </ResponsiveLayout>

      <Modal
        visible={!!recordConfirmItem}
        transparent
        animationType={useCenteredSheet ? 'fade' : 'slide'}
        onRequestClose={closeRecordConfirm}
      >
        <View
          style={[
            styles.confirmOverlay,
            { backgroundColor: colors.modalBackdrop },
            useCenteredSheet && styles.confirmOverlayCentered,
            { paddingBottom: keyboardInset },
          ]}
        >
          <View
            style={[
              styles.confirmSheet,
              useCenteredSheet && styles.confirmSheetCentered,
              { backgroundColor: colors.backgroundMain },
            ]}
          >
            <Typography variant="headline" weight="semibold">
              Confirm amount
            </Typography>
            {recordConfirmItem && (
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.confirmSubtitle}
              >
                How much did you spend on "{recordConfirmItem.title}"?
              </Typography>
            )}
            <TextInput
              label="Amount"
              value={recordAmount}
              onChangeText={text => {
                setRecordAmount(text);
                if (recordAmountError) setRecordAmountError(undefined);
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              error={recordAmountError}
              testID="budget-record-amount"
            />
            {recordConfirmItem &&
              (recordConfirmItem.estimated_cost_min != null ||
                recordConfirmItem.estimated_cost_max != null) && (
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  style={styles.confirmHint}
                >
                  Planned:{' '}
                  {formatCurrencyRange(
                    recordConfirmItem.estimated_cost_min,
                    recordConfirmItem.estimated_cost_max,
                  )}
                </Typography>
              )}
            <View style={styles.confirmActions}>
              <View style={styles.confirmActionButton}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={closeRecordConfirm}
                  fullWidth
                />
              </View>
              <View style={styles.confirmActionButton}>
                <Button
                  title="Record spent"
                  variant="primary"
                  onPress={() => void submitRecordSpending()}
                  loading={busyId === recordConfirmItem?.id}
                  fullWidth
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={copySheetVisible}
        transparent
        animationType={useCenteredSheet ? 'fade' : 'slide'}
        onRequestClose={() => setCopySheetVisible(false)}
      >
        <View
          style={[
            styles.confirmOverlay,
            { backgroundColor: colors.modalBackdrop },
            useCenteredSheet && styles.confirmOverlayCentered,
          ]}
        >
          <View
            style={[
              styles.confirmSheet,
              useCenteredSheet && styles.confirmSheetCentered,
              { backgroundColor: colors.backgroundMain },
            ]}
            testID="budget-copy-month-sheet"
          >
            <Typography variant="headline" weight="semibold">
              Copy to month
            </Typography>
            <Typography
              variant="body"
              color={colors.textSecondary}
              style={styles.confirmSubtitle}
              testID="budget-copy-subtitle"
            >
              {`${selectedCount} ${
                isPlannedTab ? 'planned spending' : 'spending'
              }${
                selectedCount === 1 ? '' : 's'
              } will be copied. Pick the month to copy into.`}
            </Typography>

            <View style={styles.copyYearRow}>
              <TouchableOpacity
                onPress={() => setCopyYear(y => y - 1)}
                style={styles.monthArrow}
                testID="budget-copy-year-prev"
              >
                <Icon
                  name="chevron-back"
                  size={20}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
              <Typography variant="headline" weight="semibold">
                {copyYear}
              </Typography>
              <TouchableOpacity
                onPress={() => setCopyYear(y => y + 1)}
                style={styles.monthArrow}
                testID="budget-copy-year-next"
              >
                <Icon
                  name="chevron-forward"
                  size={20}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.copyMonthGrid}>
              {MONTH_ABBR.map((abbr, idx) => {
                const m = idx + 1;
                const selected = m === copyMonth;
                const isSource = copyYear === year && m === month;
                return (
                  <TouchableOpacity
                    key={abbr}
                    onPress={() => setCopyMonth(m)}
                    style={[
                      styles.copyMonthCell,
                      { borderColor: colors.borderColor },
                      selected && {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    testID={`budget-copy-month-${m}`}
                  >
                    <Typography
                      variant="subheadline"
                      weight={selected ? 'semibold' : 'regular'}
                      color={selected ? colors.white : colors.textPrimary}
                    >
                      {abbr}
                    </Typography>
                    {isSource && (
                      <Typography
                        variant="caption2"
                        color={selected ? colors.white : colors.textSecondary}
                      >
                        this month
                      </Typography>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.confirmActions}>
              <View style={styles.confirmActionButton}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  onPress={() => setCopySheetVisible(false)}
                  disabled={batchBusy}
                  fullWidth
                  testID="budget-copy-cancel"
                />
              </View>
              <View style={styles.confirmActionButton}>
                <Button
                  title={`Copy to ${monthLabel(copyMonth)}`}
                  variant="primary"
                  onPress={() => void performCopy()}
                  loading={batchBusy}
                  fullWidth
                  testID="budget-copy-confirm"
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
      {/* Single-row "Copy": the destination month on two wheels, opened on the
          month being viewed so a plain Done copies in place. */}
      <MonthPickerSheet
        visible={copyRow !== null}
        value={monthKey(year, month)}
        title={isPlannedTab ? 'Copy planned spending' : 'Copy spending'}
        minMonth={monthKey(year - 3, 1)}
        maxMonth={monthKey(year + 5, 12)}
        helperText={
          copyRow
            ? `"${
                copyRow.kind === 'planned'
                  ? copyRow.item.title
                  : copyRow.expense.title
              }" is copied into the month you pick.`
            : undefined
        }
        onConfirm={confirmRowCopy}
        onClose={() => setCopyRow(null)}
        testID="budget-row-copy-month"
      />
      <ScreenScrollEnd testID={screenScrollEndTestId(rootTestId)} />
    </ScrollView>
  );
}

/**
 * Rounds the swiped-open action panel to match the card corner it sits behind:
 * top-right on the first row, bottom-right on the last, so the red delete edge
 * follows the row shape instead of poking past the rounded card corner.
 */
function swipeActionRounding(
  index: number,
  count: number,
): StyleProp<ViewStyle> {
  const isFirst = index === 0;
  const isLast = index === count - 1;
  if (!isFirst && !isLast) return undefined;
  return {
    overflow: 'hidden',
    borderTopRightRadius: isFirst ? 16 : 0,
    borderBottomRightRadius: isLast ? 16 : 0,
  };
}

function Section<T>({
  title,
  items,
  renderItem,
  action,
  selectAction,
}: {
  title: string;
  items: T[];
  renderItem: (item: T, index: number, count: number) => React.ReactNode;
  /** Optional right-aligned header link (e.g. "See all →"). */
  action?: { label: string; onPress: () => void; testID?: string };
  /**
   * Optional "Select" affordance rendered to the LEFT of `action` — flips the
   * list into multi-select (checkbox) mode for batch copy/delete.
   */
  selectAction?: {
    label: string;
    onPress: () => void;
    testID?: string;
    accessibilityLabel?: string;
  };
}) {
  const colors = useAppColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Typography
          variant="footnote"
          weight="semibold"
          color={colors.textSecondary}
          style={styles.sectionTitle}
        >
          {title.toUpperCase()}
        </Typography>
        {(selectAction || action) && (
          <View style={styles.sectionActions}>
            {selectAction && (
              <TouchableOpacity
                onPress={selectAction.onPress}
                style={styles.sectionAction}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={
                  selectAction.accessibilityLabel ?? selectAction.label
                }
                testID={selectAction.testID}
              >
                <Icon
                  name="checkmark-circle-outline"
                  size={14}
                  color={colors.primary}
                />
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.primary}
                >
                  {selectAction.label}
                </Typography>
              </TouchableOpacity>
            )}
            {action && (
              <TouchableOpacity
                onPress={action.onPress}
                style={styles.sectionAction}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                testID={action.testID}
              >
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.primary}
                >
                  {action.label}
                </Typography>
                <Icon name="chevron-forward" size={14} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.backgroundSecondary },
        ]}
      >
        {items.map((item, index) => renderItem(item, index, items.length))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  // Year stepper inside the "copy to month" modal — the screen header itself is
  // BudgetMonthHeader.
  monthArrow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  addCta: {
    ...BUDGET_CTA_ROW_STYLES.addCta,
    flex: 1,
  },
  // Lives INSIDE the pinned BudgetMonthHeader band, so the gap to the list
  // below is the band's own `marginBottom` — a margin here would double it.
  selectionBlock: {
    gap: Spacing.sm,
  },
  selectionToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectionToolbarSide: {
    minWidth: 72,
    paddingVertical: Spacing.xs,
  },
  selectionToolbarSideEnd: {
    alignItems: 'flex-end',
  },
  selectionActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  selectionActionSlot: {
    flex: 1,
  },
  deleteCta: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
  },
  copyMonthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  copyMonthCell: {
    width: '30%',
    flexGrow: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xs,
  },
  budgetReminder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    marginBottom: 16,
  },
  budgetReminderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetReminderText: {
    flex: 1,
    gap: Spacing.xxs,
  },
  budgetReminderCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  spentTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: {
    marginLeft: 4,
  },
  sectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sectionAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  sectionCard: {
    borderRadius: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingLeft: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemRowFirst: {
    borderTopWidth: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  itemRowLast: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  itemContent: {
    flex: 1,
    marginRight: 8,
  },
  expenseMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    maxWidth: '70%',
  },
  empty: {
    paddingVertical: 40,
  },
  confirmOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  confirmOverlayCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  confirmSheet: {
    borderTopLeftRadius: CornerRadius.xl,
    borderTopRightRadius: CornerRadius.xl,
    padding: Layout.pageMargin,
    gap: Spacing.md,
  },
  confirmSheetCentered: {
    width: '100%',
    maxWidth: Layout.formSheetWidth,
    borderRadius: CornerRadius.xl,
  },
  confirmSubtitle: {
    marginTop: Spacing.xs,
  },
  confirmHint: {
    marginTop: -Spacing.xs,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  confirmActionButton: {
    flex: 1,
  },
});
