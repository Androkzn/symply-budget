import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Modal, StyleSheet, TextInput as RNTextInput, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import type { Edge } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  budgetApi,
  type BudgetCategory,
  type BudgetItem,
  type BudgetQuickAddSuggestion,
  type BulkMonthContext,
  type BulkSuggestion,
  type Expense,
  type ExpenseBulkPlan,
} from '@api/budget';
import { isFullBudget } from '@brand/capabilities';
import { AppBackground, OverlaySheetHeader, SafeAreaView, ScreenHeader } from '@components/common';
import { DatePickerSheet, TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { formatRegionLabel } from '@config/regions';
import { useTheme } from '@contexts/ThemeContext';
import { monthIndexOf, monthKeyOf } from '@features/budget/bulk/bulkSplit';
import { BULK_DEFAULT_MONTHS } from '@features/budget/bulk/bulkTypes';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import {
  listAliasHints,
  recordNameRename,
  type ReceiptAliasHint,
} from '@features/budget/local/receiptAliases';
import { useDeviceType } from '@hooks/useDeviceType';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import { useIsScrollableFormSheet } from '@navigation/presentation';
import type { BudgetStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useAppStore } from '@stores/appStore';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { IconSize, Layout, useAppColors } from '@theme';
import { resolveCategoryIcon } from '@utils/budgetCategoryIcon';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { BudgetBulkPurchaseSection } from './BudgetBulkPurchaseSection';
import { BudgetCategoryCreateRow, useBudgetCategoryQuickCreate } from './budgetCategoryQuickCreate';
import { budgetPriorityColor } from './budgetFormat';
import {
  PRIORITIES,
  WHEN_OPTIONS,
  clampToMonthBounds,
  defaultDateForMonth,
  inferWhenMode,
  monthDateBounds,
  parseLocalYMD,
  resolveWhenDate,
  toCents,
  toDollarsString,
  toLocalYMD,
  whenHelperText,
  whenOptionSubtitle,
  type WhenMode,
} from './budgetItemFormUtils';
import { BudgetNameSuggestionRow } from './BudgetNameSuggestionRow';
import {
  buildNameVocabulary,
  rankNameSuggestions,
  type NameVocabularyEntry,
} from './budgetNameSuggestions';
import {
  expenseDateForQuickAdd,
  mergeQuickAddSuggestions,
  plannedTargetDateForQuickAdd,
} from './budgetQuickAddHelpers';
import { BudgetQuickAddRow } from './BudgetQuickAddRow';
import {
  defaultTaxLines,
  restoreTaxLines,
  totalTaxCents,
  type TaxLineDraft,
} from './budgetTaxEntry';
import { BudgetTaxSection } from './BudgetTaxSection';

type CostMode = 'exact' | 'range';
type SpendingKind = 'planned' | 'spent';

/**
 * How far back the name shortcuts look. Deep enough that a household's habitual
 * names all survive the cut, shallow enough that the read stays a slice of an
 * already-hydrated local ledger rather than a scroll through years of history.
 */
const NAME_VOCABULARY_SAMPLE = 500;

/**
 * Trailing wait before the bulk estimate re-runs after a keystroke. Zero under
 * Jest, where the suites flush microtasks only (same idea as the save flush).
 */
const BULK_ESTIMATE_DEBOUNCE_MS = process.env.JEST_WORKER_ID !== undefined ? 0 : 250;

type BudgetItemFormRouteProp = RouteProp<BudgetStackParamList, 'BudgetItemForm'>;
type BudgetItemFormNavigationProp = NativeStackNavigationProp<BudgetStackParamList, 'BudgetItemForm'>;

/** Editable form state that decides whether the form is dirty. */
interface BudgetItemFormValues {
  spendingKind: SpendingKind;
  title: string;
  vendor: string;
  description: string;
  priority: BudgetItem['priority'];
  categoryId: string | undefined;
  costMode: CostMode;
  exactCost: string;
  costMin: string;
  costMax: string;
  hasDiscount: boolean;
  savedAmount: string;
  hasTax: boolean;
  /** Empty whenever `hasTax` is false, so an untouched rate table never reads as an edit. */
  taxLines: TaxLineDraft[];
  whenMode: WhenMode;
  specificDate: Date;
  spentDate: Date;
  /** Stock-up: spread the amount over `bulkMonths` consecutive months. */
  isBulk: boolean;
  bulkMonths: number;
}

/** Empty baseline for a brand-new item — any input diverges from this. */
function makeEmptyBudgetItemFormValues(
  spendingKind: SpendingKind,
  specificDate: Date,
  spentDate: Date
): BudgetItemFormValues {
  return {
    spendingKind,
    title: '',
    vendor: '',
    description: '',
    priority: 'medium',
    categoryId: undefined,
    costMode: 'exact',
    exactCost: '',
    costMin: '',
    costMax: '',
    hasDiscount: false,
    savedAmount: '',
    hasTax: false,
    taxLines: [],
    whenMode: 'this_month',
    specificDate,
    spentDate,
    isBulk: false,
    bulkMonths: BULK_DEFAULT_MONTHS,
  };
}

export function BudgetItemFormScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const { isIPad, width } = useDeviceType();
  const useCenteredCategorySheet = isIPad && width >= Layout.sidebarBreakpoint;
  // How much of the screen the keypad is covering — used to lift the category
  // picker sheet, which is a Modal and so cannot rely on a KeyboardAvoidingView.
  const keyboardInset = useKeyboardInset();
  const safeAreaEdges: Edge[] = [];
  // Sheet-ness comes from the SAME helper the navigator registered this screen
  // with, never from a hand-set boolean: on iPhone `useScrollableFormPresentation`
  // resolves to `modal` — a page sheet whose card starts below the status bar, so
  // re-applying the window inset draws a blank band above the title — and on iPad
  // to `fullScreenModal`, which owns the status bar and needs the inset.
  const insideSheet = useIsScrollableFormSheet();
  const navigation = useNavigation<BudgetItemFormNavigationProp>();
  const route = useRoute<BudgetItemFormRouteProp>();
  const itemId = route.params?.itemId;
  const expenseId = route.params?.expenseId;
  const expenseDraft = route.params?.expenseDraft;
  const quickAddDraft = route.params?.quickAddDraft;
  const initialKind = expenseId ? 'spent' : (route.params?.kind ?? 'planned');
  const kindLocked = !itemId && !expenseId && !!route.params?.kind;
  const isEditingPlanned = !!itemId;
  const isEditingExpense = !!expenseId;
  const isEditing = isEditingPlanned || isEditingExpense;
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, markInsightsDirty } = useBudgetStore();
  // Settings → Region. Decides which sales taxes a hand-typed spending is
  // offered (Canada = GST + PST) and at what default rates.
  const taxCountry = useAppStore((state) => state.taxCountry);
  const taxRegion = useAppStore((state) => state.taxRegion);
  const insets = useSafeAreaInsets();
  const [scrollViewportHeight, setScrollViewportHeight] = useState<number | null>(null);

  const [spendingKind, setSpendingKind] = useState<SpendingKind>(initialKind);
  const isSpentForm = spendingKind === 'spent';

  const [title, setTitle] = useState('');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<BudgetItem['priority']>('medium');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [costMode, setCostMode] = useState<CostMode>('exact');
  const [exactCost, setExactCost] = useState('');
  const [hasDiscount, setHasDiscount] = useState(false);
  const [savedAmount, setSavedAmount] = useState('');
  const [hasTax, setHasTax] = useState(false);
  const [taxLines, setTaxLines] = useState<TaxLineDraft[]>(() =>
    defaultTaxLines(taxCountry, taxRegion)
  );
  // Once the rows have been opened, edited, or restored from a saved expense
  // they are the user's — the region effect below must stop re-seeding them.
  const taxTouchedRef = useRef(false);
  const [costMin, setCostMin] = useState('');
  const [costMax, setCostMax] = useState('');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [whenMode, setWhenMode] = useState<WhenMode>('this_month');
  const [showWhenSheet, setShowWhenSheet] = useState(false);
  const [specificDate, setSpecificDate] = useState<Date>(() =>
    defaultDateForMonth(selectedYear, selectedMonth)
  );
  const [spentDate, setSpentDate] = useState<Date>(() =>
    clampToMonthBounds(defaultDateForMonth(selectedYear, selectedMonth), selectedYear, selectedMonth)
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [quickAdd, setQuickAdd] = useState<{ recent: BudgetQuickAddSuggestion[]; popular: BudgetQuickAddSuggestion[] }>({
    recent: [],
    popular: [],
  });
  // One flat strip: the API's Recent/Popular split is folded before render.
  const quickAddSuggestions = useMemo(
    () => mergeQuickAddSuggestions(quickAdd.recent, quickAdd.popular),
    [quickAdd]
  );
  const [isLoading, setIsLoading] = useState(isEditing && !expenseDraft);
  // What this household calls things, plus the renames it has already made.
  // Feeds the name shortcut bubbles under the Name field.
  const [nameVocabulary, setNameVocabulary] = useState<NameVocabularyEntry[]>([]);
  const [nameAliases, setNameAliases] = useState<ReceiptAliasHint[]>([]);

  // Bulk purchase (stock-up). The estimate reads the household's own ledger, so
  // the section exists only where that ledger does: the full Budget brand on
  // the local-first path. Elsewhere the form is exactly what it was.
  const bulkSupported = useMemo(() => isFullBudget() && isBudgetLocalFirst(), []);
  const [isBulk, setIsBulk] = useState(false);
  const [bulkMonths, setBulkMonths] = useState(BULK_DEFAULT_MONTHS);
  // Once the member has touched the stepper (or a saved plan was loaded), a
  // fresh estimate informs but no longer overrides.
  const bulkTouchedRef = useRef(false);
  const [bulkSuggestion, setBulkSuggestion] = useState<BulkSuggestion | null>(null);
  const [bulkMonthContext, setBulkMonthContext] = useState<BulkMonthContext[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Ref-backed field mirrors so Maestro inputText can persist through Save even
  // when native typing skips React onChangeText (see AddWishModal).
  const titleRef = useRef('');
  const exactCostRef = useRef('');
  const costMinRef = useRef('');
  const costMaxRef = useRef('');
  const pendingSaveRef = useRef(false);
  const titleInputRef = useRef<RNTextInput>(null);
  // The name this spending arrived with. If it leaves under a different one,
  // that rename is the strongest possible signal about what to offer next time.
  const loadedTitleRef = useRef('');
  const exactCostInputRef = useRef<RNTextInput>(null);
  // The picker's search box doubles as the name field for an inline category,
  // so "Create a new category" with nothing typed just focuses it.
  const categorySearchInputRef = useRef<RNTextInput>(null);

  const syncTitle = (text: string) => {
    titleRef.current = text;
    if (text !== title) setTitle(text);
  };
  const syncExactCost = (text: string) => {
    exactCostRef.current = text;
    if (text !== exactCost) setExactCost(text);
  };
  const syncCostMin = (text: string) => {
    costMinRef.current = text;
    if (text !== costMin) setCostMin(text);
  };
  const syncCostMax = (text: string) => {
    costMaxRef.current = text;
    if (text !== costMax) setCostMax(text);
  };
  const resolveTitle = () => (titleRef.current || title).trim();
  const resolveExactCost = () => exactCostRef.current || exactCost;
  const resolveCostMin = () => costMinRef.current || costMin;
  const resolveCostMax = () => costMaxRef.current || costMax;

  // Snapshot of the last-saved form values, used to gate Save via
  // useUnsavedChanges. For a new item this is the empty initial values (so any
  // input makes the form dirty); when editing we overwrite it with the loaded
  // entity's values (see setBaselineFromValues in the apply* helpers).
  const [baseline, setBaseline] = useState<BudgetItemFormValues>(() =>
    makeEmptyBudgetItemFormValues(
      initialKind,
      defaultDateForMonth(selectedYear, selectedMonth),
      clampToMonthBounds(defaultDateForMonth(selectedYear, selectedMonth), selectedYear, selectedMonth)
    )
  );

  useEffect(() => {
    if (!currentHousehold?.id) return;
    budgetApi.getCategories(currentHousehold.id).then((res) => setCategories(res.categories)).catch(() => {});
  }, [currentHousehold?.id]);

  // Settings are hydrated from disk after first paint, and the region can also
  // change while this form is open — re-seed the rates until the rows are the
  // user's, so BC's 5% + 7% never lands on a form that opened before hydration.
  useEffect(() => {
    if (taxTouchedRef.current) return;
    setTaxLines(defaultTaxLines(taxCountry, taxRegion));
  }, [taxCountry, taxRegion]);

  useEffect(() => {
    if (!currentHousehold?.id || isEditing) return;
    budgetApi
      .getQuickAddSuggestions(currentHousehold.id, spendingKind)
      .then(setQuickAdd)
      .catch(() => setQuickAdd({ recent: [], popular: [] }));
  }, [currentHousehold?.id, isEditing, spendingKind]);

  // Name shortcuts read the spending history once per form open, not per
  // keystroke: what a household calls things is a property of every month it
  // has ever logged, not of the one being edited, and ranking is pure.
  useEffect(() => {
    if (!currentHousehold?.id || !isSpentForm) return;
    let cancelled = false;
    // Wrapped whole: the bubbles are a convenience layered on top of a form
    // that has to keep working. Nothing this load does — a ledger that will not
    // read, storage that is not there — may reach the screen.
    void (async () => {
      try {
        const [{ expenses }, aliases] = await Promise.all([
          budgetApi.getExpenses(currentHousehold.id, { limit: NAME_VOCABULARY_SAMPLE }),
          listAliasHints(),
        ]);
        if (cancelled) return;
        setNameVocabulary(buildNameVocabulary(expenses));
        setNameAliases(aliases);
      } catch {
        // No history yet, or storage unavailable — the Name field goes on
        // behaving exactly as it did before this row existed.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentHousehold?.id, isSpentForm]);

  const nameSuggestions = useMemo(
    () =>
      isSpentForm
        ? rankNameSuggestions({ query: title, vocabulary: nameVocabulary, aliases: nameAliases })
        : [],
    [isSpentForm, title, nameVocabulary, nameAliases]
  );

  useEffect(() => {
    if (!isEditingPlanned || !currentHousehold?.id || !itemId) return;
    const load = async () => {
      try {
        const { item } = await budgetApi.getItem(currentHousehold.id, itemId);
        applyItem(item);
      } catch (error) {
        console.error('Error loading budget item:', error);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isEditingPlanned, itemId, currentHousehold?.id]);

  useEffect(() => {
    if (!isEditingExpense || !expenseDraft) return;
    applyExpenseFields(expenseDraft);
  }, [isEditingExpense, expenseDraft, selectedYear, selectedMonth]);

  // Prefill a brand-new form from a quick-add chip tapped outside the form.
  // Runs once so the user can freely edit the prefilled fields afterwards.
  const quickAddPrefilledRef = useRef(false);
  useEffect(() => {
    if (isEditing || !quickAddDraft || quickAddPrefilledRef.current) return;
    quickAddPrefilledRef.current = true;
    applyQuickAddSuggestion(quickAddDraft);
  }, [isEditing, quickAddDraft]);

  useEffect(() => {
    if (!isEditingExpense || !currentHousehold?.id || !expenseId) return;
    const load = async () => {
      try {
        const { expense } = await budgetApi.getExpense(currentHousehold.id, expenseId);
        applyExpense(expense);
      } catch (error) {
        console.error('Error loading expense:', error);
        if (!expenseDraft) {
          Alert.alert('Could not load spending', 'Please try again.');
          navigation.goBack();
        }
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [isEditingExpense, expenseId, currentHousehold?.id, expenseDraft, navigation]);

  function applyItem(item: BudgetItem) {
    const minStr = toDollarsString(item.estimated_cost_min);
    const maxStr = toDollarsString(item.estimated_cost_max);
    const hasRange =
      item.estimated_cost_min !== null &&
      item.estimated_cost_max !== null &&
      item.estimated_cost_min !== item.estimated_cost_max;
    const inferred = inferWhenMode(
      item.target_date ? parseLocalYMD(item.target_date) : null,
      selectedYear,
      selectedMonth,
    );

    setTitle(item.title);
    setDescription(item.description ?? '');
    setPriority(item.priority);
    setCategoryId(item.category_id ?? undefined);
    if (hasRange) {
      setCostMode('range');
      setCostMin(minStr);
      setCostMax(maxStr);
      setExactCost('');
    } else {
      setCostMode('exact');
      setExactCost(minStr || maxStr);
      setCostMin('');
      setCostMax('');
    }
    setWhenMode(inferred.mode);
    setSpecificDate(inferred.specificDate);

    // Capture the loaded values as the dirty-tracking baseline.
    setBaseline({
      ...makeEmptyBudgetItemFormValues(
        'planned',
        inferred.specificDate,
        clampToMonthBounds(defaultDateForMonth(selectedYear, selectedMonth), selectedYear, selectedMonth)
      ),
      title: item.title,
      description: item.description ?? '',
      priority: item.priority,
      categoryId: item.category_id ?? undefined,
      costMode: hasRange ? 'range' : 'exact',
      exactCost: hasRange ? '' : minStr || maxStr,
      costMin: hasRange ? minStr : '',
      costMax: hasRange ? maxStr : '',
      whenMode: inferred.mode,
      specificDate: inferred.specificDate,
    });
  }

  function applyExpenseFields(
    fields: {
      title: string;
      amount: number;
      expense_date: string;
      category_id?: string | null;
      saved_amount?: number;
      tax_amount?: number;
      vendor?: string | null;
      bulk?: ExpenseBulkPlan | null;
    },
    // Only the edit/draft load path adopts these as the baseline; a quick-add
    // prefill is a user action and must leave the form dirty so Save is enabled.
    captureBaseline = true
  ) {
    const clampedSpentDate = clampToMonthBounds(
      parseLocalYMD(fields.expense_date),
      selectedYear,
      selectedMonth
    );
    const saved = fields.saved_amount ?? 0;
    // `amount` is stored tax-INCLUSIVE, while the form's Amount field is the
    // pre-tax price the tax rows are computed from — so an expense with tax
    // comes back split, and re-saving it untouched writes the same total back.
    const tax = Math.max(0, fields.tax_amount ?? 0);
    const subtotal = Math.max(0, fields.amount - tax);
    const restoredTaxLines = tax > 0 ? restoreTaxLines(tax, subtotal, taxCountry, taxRegion) : [];

    setSpendingKind('spent');
    // syncTitle keeps the ref mirror in step — a quick-add prefill lands here
    // on a form that may already have text typed into the Name field.
    syncTitle(fields.title);
    setVendor(fields.vendor?.trim() && fields.vendor !== 'Other' ? fields.vendor : '');
    setExactCost(toDollarsString(subtotal));
    setCategoryId(fields.category_id ?? undefined);
    setSpentDate(clampedSpentDate);
    setHasDiscount(saved > 0);
    setSavedAmount(saved > 0 ? toDollarsString(saved) : '');
    setHasTax(tax > 0);
    if (tax > 0) {
      setTaxLines(restoredTaxLines);
      taxTouchedRef.current = true;
    }
    // A saved plan is the member's decision: load it as touched so the
    // estimate that runs on open cannot quietly replace it.
    const plan = fields.bulk ?? null;
    setIsBulk(!!plan);
    setBulkMonths(plan?.months ?? BULK_DEFAULT_MONTHS);
    bulkTouchedRef.current = !!plan;

    if (captureBaseline) {
      loadedTitleRef.current = fields.title.trim();
      setBaseline({
        ...makeEmptyBudgetItemFormValues(
          'spent',
          defaultDateForMonth(selectedYear, selectedMonth),
          clampedSpentDate
        ),
        spendingKind: 'spent',
        title: fields.title,
        vendor: fields.vendor?.trim() && fields.vendor !== 'Other' ? fields.vendor : '',
        categoryId: fields.category_id ?? undefined,
        exactCost: toDollarsString(subtotal),
        hasDiscount: saved > 0,
        savedAmount: saved > 0 ? toDollarsString(saved) : '',
        hasTax: tax > 0,
        taxLines: restoredTaxLines,
        spentDate: clampedSpentDate,
        isBulk: !!plan,
        bulkMonths: plan?.months ?? BULK_DEFAULT_MONTHS,
      });
    }
  }

  function applyExpense(expense: Expense) {
    applyExpenseFields(expense);
  }

  /**
   * Tapping a bubble changes the name and nothing else — not the category, not
   * the amount, not the store. That restraint is what separates it from a
   * quick-add chip, which is allowed to fill the whole form.
   *
   * The swap is also the clearest teaching signal there is, so it is recorded
   * immediately rather than waiting for Save: someone who reaches for "Nuts"
   * and then abandons the edit has still told us what they call peanuts.
   */
  function applyNameSuggestion(name: string) {
    const previous = resolveTitle();
    syncTitle(name);
    void recordNameRename(previous, name);
  }

  function applyQuickAddSuggestion(suggestion: BudgetQuickAddSuggestion) {
    if (isSpentForm) {
      // A chip with no remembered price still fills the name and category — a
      // tap that does nothing reads as a dead chip (that is how the local
      // ledger's amount-less suggestions presented). Only the amount is left
      // blank, for the member to type, rather than showing a literal "0".
      const amount = suggestion.amount && suggestion.amount > 0 ? suggestion.amount : null;
      applyExpenseFields(
        {
          title: suggestion.title,
          amount: amount ?? 0,
          expense_date: expenseDateForQuickAdd(selectedYear, selectedMonth),
          category_id: suggestion.category_id,
        },
        false
      );
      if (amount === null) setExactCost('');
      return;
    }

    // syncTitle, not setTitle: `resolveTitle` prefers the ref, so a chip tapped
    // after something was typed would otherwise save the typed text instead.
    syncTitle(suggestion.title);
    setDescription(suggestion.description ?? '');
    setPriority(suggestion.priority ?? 'medium');
    setCategoryId(suggestion.category_id ?? undefined);
    const minStr = toDollarsString(suggestion.estimated_cost_min);
    const maxStr = toDollarsString(suggestion.estimated_cost_max);
    const hasRange =
      suggestion.estimated_cost_min !== null &&
      suggestion.estimated_cost_max !== null &&
      suggestion.estimated_cost_min !== suggestion.estimated_cost_max;
    if (hasRange) {
      setCostMode('range');
      setCostMin(minStr);
      setCostMax(maxStr);
      setExactCost('');
    } else {
      setCostMode('exact');
      setExactCost(minStr || maxStr);
      setCostMin('');
      setCostMax('');
    }
    setWhenMode('specific_date');
    setSpecificDate(parseLocalYMD(plannedTargetDateForQuickAdd(selectedYear, selectedMonth)));
  }

  const spentDateBounds = useMemo(
    () => monthDateBounds(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  // The tax-inclusive total a stock-up would split — the same figure Save records.
  const bulkTotalCents = useMemo(() => {
    const cost = toCents(exactCost) ?? 0;
    return cost + (hasTax ? totalTaxCents(taxLines, cost) : 0);
  }, [exactCost, hasTax, taxLines]);
  const bulkPurchaseDate = useMemo(
    () => toLocalYMD(clampToMonthBounds(spentDate, selectedYear, selectedMonth)),
    [spentDate, selectedYear, selectedMonth]
  );
  const bulkSavedCents = hasDiscount ? toCents(savedAmount) ?? 0 : 0;
  // Re-spreading a plan whose first months are already behind us rewrites
  // those months' totals; the section says so.
  const bulkTouchesClosedMonths =
    isEditingExpense &&
    isBulk &&
    monthIndexOf(monthKeyOf(bulkPurchaseDate)) < monthIndexOf(monthKeyOf(toLocalYMD(new Date())));

  // Ask the ledger how long this should last whenever the inputs that matter
  // move — trailing debounce so typing an amount does not re-estimate per digit.
  useEffect(() => {
    if (!bulkSupported || !isBulk || !currentHousehold?.id) return;
    const householdId = currentHousehold.id;
    let cancelled = false;
    const run = () => {
      setBulkLoading(true);
      budgetApi
        .getBulkSuggestion(householdId, {
          title,
          category_id: categoryId ?? null,
          amount: bulkTotalCents,
          saved_amount: bulkSavedCents,
          expense_date: bulkPurchaseDate,
          exclude_expense_id: expenseId ?? null,
        })
        .then((result) => {
          if (cancelled) return;
          setBulkSuggestion(result.suggestion);
          setBulkMonthContext(result.monthContext);
          if (!bulkTouchedRef.current) setBulkMonths(result.suggestion.months);
        })
        .catch(() => {
          if (!cancelled) setBulkSuggestion(null);
        })
        .finally(() => {
          if (!cancelled) setBulkLoading(false);
        });
    };
    if (BULK_ESTIMATE_DEBOUNCE_MS === 0) {
      run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(run, BULK_ESTIMATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    bulkSupported,
    isBulk,
    currentHousehold?.id,
    title,
    categoryId,
    bulkTotalCents,
    bulkSavedCents,
    bulkPurchaseDate,
    expenseId,
  ]);

  const toggleBulk = () => {
    setIsBulk((on) => {
      // Switching on starts from the estimate again; a saved plan that was
      // switched off and back on is a fresh decision.
      if (!on) bulkTouchedRef.current = false;
      return !on;
    });
  };

  const changeBulkMonths = (next: number) => {
    bulkTouchedRef.current = true;
    setBulkMonths(next);
  };

  const spentDateHelperText = useMemo(
    () =>
      `Must be in ${new Date(selectedYear, selectedMonth - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })}.`,
    [selectedYear, selectedMonth]
  );

  const selectedCategory = useMemo(
    () => categories.find((cat) => cat.id === categoryId),
    [categories, categoryId],
  );

  const filteredCategories = useMemo(
    () =>
      categories.filter((cat) =>
        cat.name.toLowerCase().includes(categorySearchQuery.trim().toLowerCase()),
      ),
    [categories, categorySearchQuery],
  );

  const handleCostModeChange = (mode: CostMode) => {
    if (mode === costMode) return;
    if (mode === 'exact') {
      setExactCost(exactCost || costMin || costMax);
    } else {
      const seed = exactCost || costMin || costMax;
      setCostMin(seed);
      setCostMax(costMax || seed);
    }
    setCostMode(mode);
  };

  const resolvedTargetDate = useMemo(
    () => resolveWhenDate(whenMode, specificDate, selectedYear, selectedMonth),
    [whenMode, specificDate, selectedYear, selectedMonth],
  );

  // Frequently-used options stay on a fixed row; the rest live behind "More".
  const primaryWhenOptions = useMemo(() => WHEN_OPTIONS.filter((o) => o.primary), []);
  const selectedWhenOption = useMemo(
    () => WHEN_OPTIONS.find((o) => o.value === whenMode),
    [whenMode],
  );
  const isSelectedWhenPrimary = selectedWhenOption?.primary ?? false;

  const handleWhenModeChange = (mode: WhenMode) => {
    setWhenMode(mode);
    if (mode !== 'specific_date') {
      setShowDatePicker(false);
    } else {
      setShowDatePicker(true);
    }
  };

  const handleWhenSheetSelect = (mode: WhenMode) => {
    handleWhenModeChange(mode);
    setShowWhenSheet(false);
    if (mode === 'specific_date') setShowDatePicker(true);
  };

  const closeCategoryPicker = () => {
    setShowCategoryPicker(false);
    setCategorySearchQuery('');
  };

  // Creating a category from inside the picker: the new one is listed, selected
  // and the sheet closes, so the half-typed spending is never abandoned to go
  // make a category in settings.
  const { isCreatingCategory, createCategory } = useBudgetCategoryQuickCreate({
    householdId: currentHousehold?.id,
    categories,
    onCreated: (category) => {
      setCategories((prev) =>
        prev.some((cat) => cat.id === category.id) ? prev : [...prev, category]
      );
      setCategoryId(category.id);
      closeCategoryPicker();
    },
  });

  // Live form values, diffed against `baseline` to gate Save. See
  // [[useUnsavedChanges]].
  const values: BudgetItemFormValues = {
    spendingKind,
    title,
    vendor,
    description,
    priority,
    categoryId,
    costMode,
    exactCost,
    costMin,
    costMax,
    hasDiscount,
    savedAmount,
    hasTax,
    taxLines: hasTax ? taxLines : [],
    whenMode,
    specificDate,
    spentDate,
    isBulk,
    bulkMonths,
  };

  // The plan Save writes: months the member sees on the stepper, plus what the
  // estimate said, so "suggested 4, chose 6" is on the row. `null` clears.
  const bulkPlanForSave = () =>
    isBulk
      ? {
          months: bulkMonths,
          suggested_months: bulkSuggestion?.months ?? null,
          basis: bulkSuggestion?.basis ?? null,
        }
      : null;

  const { isDirty, isSaving, save } = useUnsavedChanges({
    values,
    baseline,
    saveWhen: (_values, dirty) => (isEditing ? dirty : true),
    successMessage: isEditing
      ? 'Changes saved'
      : spendingKind === 'spent'
        ? 'Spending recorded'
        : 'Planned spending added',
    onClose: () => navigation.goBack(),
    onSave: async () => {
      if (!currentHousehold?.id) {
        console.warn('[BudgetItemForm] save aborted: no currentHousehold');
        showToast('error', 'No household selected.');
        return false;
      }
      const trimmedTitle = resolveTitle();
      if (!trimmedTitle) {
        showToast('error', 'Please give this spending a name.');
        return false;
      }

      const spentDateStr = toLocalYMD(clampToMonthBounds(spentDate, selectedYear, selectedMonth));
      // null = an undated ("when possible") planned spending — no month bucket.
      const plannedTargetDate = resolvedTargetDate ? toLocalYMD(resolvedTargetDate) : null;
      const costCents =
        spendingKind === 'spent' || costMode === 'exact'
          ? toCents(resolveExactCost())
          : toCents(resolveCostMin());
      const costMaxCents =
        spendingKind === 'spent' || costMode === 'exact'
          ? toCents(resolveExactCost())
          : toCents(resolveCostMax()) ?? toCents(resolveCostMin());

      if (spendingKind === 'spent' && (!costCents || costCents <= 0)) {
        console.warn('[BudgetItemForm] save aborted: missing cost', {
          exactCostRef: exactCostRef.current,
          exactCost,
        });
        showToast('error', 'Enter how much you spent.');
        return false;
      }

      // Discount/sale savings, in cents — only for recorded spending, and only
      // when the "On sale / discount" toggle is checked.
      const savedCents = isSpentForm && hasDiscount ? toCents(savedAmount) ?? 0 : 0;
      const vendorName = isSpentForm ? vendor.trim() || 'Other' : undefined;

      // Sales tax rides on top of the typed (pre-tax) amount: every row is
      // combined into one total, and what gets recorded is the tax-INCLUSIVE
      // sum, with the tax kept alongside it exactly as receipt scanning does.
      const taxCents = isSpentForm && hasTax ? totalTaxCents(taxLines, costCents ?? 0) : 0;
      const spentTotalCents = (costCents ?? 0) + taxCents;

      if (isEditingExpense && expenseId) {
        await budgetApi.updateExpense(currentHousehold.id, expenseId, {
          title: trimmedTitle,
          amount: spentTotalCents,
          expense_date: spentDateStr,
          category_id: categoryId ?? null,
          saved_amount: savedCents,
          // Always sent, so clearing the toggle clears the stored tax too.
          tax_amount: taxCents,
          vendor: vendorName,
          // Same rule for the stock-up plan: `null` clears it.
          ...(bulkSupported ? { bulk: bulkPlanForSave() } : {}),
        });
        // A spending that arrived as "Peanuts" and left as "Nuts" has taught us
        // what this household calls the thing, whether the new name came from a
        // bubble or from the keyboard. Only once the rename is actually stored:
        // a failed save is not a decision.
        if (loadedTitleRef.current) {
          void recordNameRename(loadedTitleRef.current, trimmedTitle);
        }
      } else if (spendingKind === 'spent' && !isEditing) {
        await budgetApi.addExpense(currentHousehold.id, {
          title: trimmedTitle,
          description: description.trim() || undefined,
          amount: spentTotalCents,
          expense_date: spentDateStr,
          category_id: categoryId,
          saved_amount: savedCents,
          tax_amount: taxCents,
          vendor: vendorName,
          ...(bulkSupported && isBulk ? { bulk: bulkPlanForSave() } : {}),
        });
      } else if (isEditingPlanned && itemId) {
        const shared = {
          title: trimmedTitle,
          description: description.trim() || undefined,
          category_id: categoryId,
          priority,
          estimated_cost_min: costCents,
          estimated_cost_max: costMaxCents,
        };
        // null clears the date, turning a scheduled spending into an undated one.
        await budgetApi.updateItem(currentHousehold.id, itemId, { ...shared, target_date: plannedTargetDate });
      } else {
        await budgetApi.createItem(currentHousehold.id, {
          title: trimmedTitle,
          description: description.trim() || undefined,
          category_id: categoryId,
          priority,
          estimated_cost_min: costCents,
          estimated_cost_max: costMaxCents,
          timeframe: 'immediate',
          target_date: plannedTargetDate ?? undefined,
        });
      }
      markInsightsDirty(currentHousehold.id);
      return;
    },
  });

  const formTitle = isEditingExpense
    ? 'Edit spending'
    : isEditingPlanned
      ? 'Edit planned spending'
      : spendingKind === 'spent'
        ? 'Record spending'
        : 'Add planned spending';

  const saveDisabled =
    isSaving || (isEditing ? !isDirty || !resolveTitle() : false);
  // Save lives only in the header, and only once there is something to save: an
  // untouched form (a freshly opened editor, or a brand-new form nothing has
  // been typed into yet) renders no action at all rather than a greyed-out one.
  const showSaveAction = isDirty || isSaving;
  const runSaveAfterNativeFlush = () => {
    if (pendingSaveRef.current) return;
    pendingSaveRef.current = true;
    Keyboard.dismiss();
    titleInputRef.current?.blur();
    exactCostInputRef.current?.blur();

    const finish = () => {
      if (!pendingSaveRef.current) return;
      pendingSaveRef.current = false;
      void save();
    };

    // onEndEditing usually fires during blur; keep a fallback for Maestro.
    if (process.env.JEST_WORKER_ID !== undefined) {
      finish();
      return;
    }
    setTimeout(finish, 650);
  };
  const saveHeaderAction = (
    <TouchableOpacity
      onPress={runSaveAfterNativeFlush}
      disabled={saveDisabled}
      testID="budget-item-form-save-header"
    >
      {isSaving ? (
        <ActivityIndicator size="small" color={theme.pastel.teal} />
      ) : (
        <Typography
          variant="body"
          weight="semibold"
          color={saveDisabled ? colors.textTertiary : theme.pastel.teal}
        >
          Save
        </Typography>
      )}
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]}>
          <ScreenHeader
            title={formTitle}
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
            showPropertySwitcher={false}
            insideSheet={insideSheet}
          />
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
      testID="budget-item-form"
    >
      <ScreenHeader
        title={formTitle}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        rightElement={showSaveAction ? saveHeaderAction : undefined}
        insideSheet={insideSheet}
      />
      {/* No KeyboardAvoidingView: it only SHRINKS the viewport, it never
          scrolls the focused field back into view, and stacked on
          `automaticallyAdjustKeyboardInsets` it double-counts the keyboard.
          `keyboardDismissScrollProps` is the half that reveals the field —
          see `@utils/keyboard`. */}
      <View
        style={styles.container}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (height > 0) {
            setScrollViewportHeight(height);
          }
        }}
      >
        <ScrollView
          {...keyboardDismissScrollProps}
          style={[
            styles.scrollView,
            scrollViewportHeight != null && { height: scrollViewportHeight },
          ]}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator
        >
        {!isEditing && (
          <BudgetQuickAddRow
            kind={spendingKind}
            suggestions={quickAddSuggestions}
            busyTitle={null}
            onSelect={applyQuickAddSuggestion}
          />
        )}
        {!isEditing && !kindLocked && (
          <>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.fieldLabel}>
              Type
            </Typography>
            <View style={styles.scheduleRow}>
              <TouchableOpacity
                style={[
                  styles.scheduleChip,
                  {
                    borderColor: theme.pastel.teal,
                    backgroundColor: spendingKind === 'planned' ? theme.pastel.teal : 'transparent',
                  },
                ]}
                onPress={() => setSpendingKind('planned')}
                testID="budget-item-kind-planned"
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={spendingKind === 'planned' ? colors.white : theme.pastel.teal}
                >
                  Planned spending
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.scheduleChip,
                  {
                    borderColor: theme.pastel.teal,
                    backgroundColor: spendingKind === 'spent' ? theme.pastel.teal : 'transparent',
                  },
                ]}
                onPress={() => {
                  setSpendingKind('spent');
                  setCostMode('exact');
                }}
                testID="budget-item-kind-spent"
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={spendingKind === 'spent' ? colors.white : theme.pastel.teal}
                >
                  Already spent
                </Typography>
              </TouchableOpacity>
            </View>
            <Typography variant="caption2" color={colors.textSecondary}>
              {spendingKind === 'planned'
                ? 'Something you plan to buy or pay for later.'
                : 'Money you already paid — updates your spent total right away.'}
            </Typography>
          </>
        )}

        <TextInput
          ref={titleInputRef}
          testID="budget-item-title"
          label="Name"
          placeholder={isSpentForm ? 'e.g. Groceries' : 'e.g. Replace water heater'}
          value={title}
          onChangeText={syncTitle}
          onEndEditing={(event) => syncTitle(event.nativeEvent.text)}
        />

        <BudgetNameSuggestionRow suggestions={nameSuggestions} onSelect={applyNameSuggestion} />

        {isSpentForm && (
          <TextInput
            testID="budget-item-store"
            label="Store"
            placeholder="Other"
            value={vendor}
            onChangeText={setVendor}
          />
        )}

        {!isSpentForm && (
          <TextInput
            testID="budget-item-description"
            label="Description"
            placeholder="What and why — any context that helps later"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            style={styles.multiline}
          />
        )}

        {!isSpentForm && (
          <Typography variant="caption1" color={colors.textSecondary} style={styles.fieldLabel}>
            Cost
          </Typography>
        )}
        {!isSpentForm && ((spendingKind === 'planned' && !isEditing) || isEditing) ? (
          <View style={styles.scheduleRow}>
            <TouchableOpacity
              style={[
                styles.scheduleChip,
                {
                  borderColor: theme.pastel.teal,
                  backgroundColor: costMode === 'exact' ? theme.pastel.teal : 'transparent',
                },
              ]}
              onPress={() => handleCostModeChange('exact')}
              testID="budget-item-cost-mode-exact"
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={costMode === 'exact' ? colors.white : theme.pastel.teal}
              >
                Exact
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.scheduleChip,
                {
                  borderColor: theme.pastel.teal,
                  backgroundColor: costMode === 'range' ? theme.pastel.teal : 'transparent',
                },
              ]}
              onPress={() => handleCostModeChange('range')}
              testID="budget-item-cost-mode-range"
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={costMode === 'range' ? colors.white : theme.pastel.teal}
              >
                Range
              </Typography>
            </TouchableOpacity>
          </View>
        ) : null}
        {isSpentForm || costMode === 'exact' ? (
          <TextInput
            ref={exactCostInputRef}
            testID="budget-item-cost-exact"
            // Tax is added on top, so once the section is open this field is
            // explicitly the pre-tax price — the running total below spells
            // out what will actually be recorded.
            label={isSpentForm ? (hasTax ? 'Amount before tax ($)' : 'Amount ($)') : 'Cost ($)'}
            placeholder="0"
            value={exactCost}
            onChangeText={syncExactCost}
            onEndEditing={(event) => syncExactCost(event.nativeEvent.text)}
            keyboardType="decimal-pad"
          />
        ) : (
          <View style={styles.row}>
            <TextInput
              testID="budget-item-cost-min"
              label="Min cost ($)"
              placeholder="0"
              value={costMin}
              onChangeText={syncCostMin}
              onEndEditing={(event) => syncCostMin(event.nativeEvent.text)}
              keyboardType="decimal-pad"
              style={styles.flexInput}
            />
            <TextInput
              testID="budget-item-cost-max"
              label="Max cost ($)"
              placeholder="0"
              value={costMax}
              onChangeText={syncCostMax}
              onEndEditing={(event) => syncCostMax(event.nativeEvent.text)}
              keyboardType="decimal-pad"
              style={styles.flexInput}
            />
          </View>
        )}

        {isSpentForm && (
          <>
            <TouchableOpacity
              style={styles.discountToggle}
              onPress={() => setHasDiscount((v) => !v)}
              activeOpacity={0.7}
              testID="budget-item-discount-toggle"
            >
              <View
                style={[
                  styles.discountCheckbox,
                  { borderColor: hasDiscount ? theme.pastel.teal : colors.borderColor },
                  hasDiscount && { backgroundColor: theme.pastel.teal },
                ]}
              >
                {hasDiscount && (
                  <Icon name="checkmark" size={IconSize.sm} color={colors.white} />
                )}
              </View>
              <Typography variant="body">On sale / discount</Typography>
            </TouchableOpacity>
            {hasDiscount && (
              <TextInput
                testID="budget-item-saved-amount"
                label="Amount saved ($)"
                placeholder="0"
                value={savedAmount}
                onChangeText={setSavedAmount}
                keyboardType="decimal-pad"
              />
            )}
            <BudgetTaxSection
              enabled={hasTax}
              onToggle={(next) => {
                taxTouchedRef.current = true;
                setHasTax(next);
              }}
              lines={taxLines}
              onChangeLines={(next) => {
                taxTouchedRef.current = true;
                setTaxLines(next);
              }}
              subtotalCents={toCents(exactCost) ?? 0}
              regionLabel={formatRegionLabel(taxCountry, taxRegion)}
            />
          </>
        )}

        {isSpentForm && bulkSupported && (
          <BudgetBulkPurchaseSection
            enabled={isBulk}
            onToggle={toggleBulk}
            months={bulkMonths}
            onChangeMonths={changeBulkMonths}
            suggestion={bulkSuggestion}
            loading={bulkLoading}
            totalCents={bulkTotalCents}
            purchaseDate={bulkPurchaseDate}
            monthContext={bulkMonthContext}
            touchesClosedMonths={bulkTouchesClosedMonths}
          />
        )}

        {isSpentForm && (
          <>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.fieldLabel}>
              Date
            </Typography>
            <TouchableOpacity
              style={[
                styles.pickerButton,
                { borderColor: colors.borderColor, backgroundColor: colors.groupedListBackground },
              ]}
              onPress={() => setShowDatePicker(true)}
              testID="budget-item-spent-date-picker"
            >
              <Typography variant="body">
                {spentDate.toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Typography>
              <Icon name="calendar-outline" size={IconSize.md} color={theme.pastel.teal} />
            </TouchableOpacity>
            <Typography variant="caption2" color={colors.textSecondary}>
              {spentDateHelperText}
            </Typography>
            <DatePickerSheet
              visible={showDatePicker}
              value={spentDate}
              title="Date of spending"
              helperText={spentDateHelperText}
              minimumDate={spentDateBounds.minimumDate}
              maximumDate={spentDateBounds.maximumDate}
              onConfirm={(selectedDate) =>
                setSpentDate(clampToMonthBounds(selectedDate, selectedYear, selectedMonth))
              }
              onClose={() => setShowDatePicker(false)}
              testID="budget-item-spent-date-sheet"
            />
          </>
        )}

        {categories.length > 0 && (
          <>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.fieldLabel}>
              Category
            </Typography>
            <TouchableOpacity
              style={[
                styles.pickerButton,
                { borderColor: colors.borderColor, backgroundColor: colors.groupedListBackground },
              ]}
              onPress={() => setShowCategoryPicker(true)}
              testID="budget-item-category-picker"
            >
              {selectedCategory ? (
                <View style={styles.categoryOptionLeft}>
                  <View
                    style={[
                      styles.categoryOptionIcon,
                      { backgroundColor: `${selectedCategory.color || colors.primary}22` },
                    ]}
                  >
                    <Icon
                      name={resolveCategoryIcon(selectedCategory)}
                      size={IconSize.lg}
                      color={selectedCategory.color || colors.primary}
                    />
                  </View>
                  <Typography variant="body" color={colors.textPrimary}>
                    {selectedCategory.name}
                  </Typography>
                </View>
              ) : (
                <Typography variant="body" color={colors.textSecondary}>
                  Select category
                </Typography>
              )}
              <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
            </TouchableOpacity>
          </>
        )}

        {spendingKind === 'planned' && (
          <>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.fieldLabel}>
              Priority
            </Typography>
            <View style={styles.priorityRow}>
              {PRIORITIES.map((p) => {
                const active = priority === p.value;
                const pColor = budgetPriorityColor(colors, p.value);
                return (
                  <TouchableOpacity
                    key={p.value}
                    testID={`budget-item-priority-${p.value}`}
                    style={[
                      styles.priorityChip,
                      { borderColor: pColor, backgroundColor: active ? pColor : 'transparent' },
                    ]}
                    onPress={() => setPriority(p.value)}
                  >
                    <Typography variant="caption1" weight="semibold" color={active ? colors.white : pColor}>
                      {p.label}
                    </Typography>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {!isSpentForm && (
          <>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.fieldLabel}>
              When
            </Typography>
            <View style={styles.whenRow}>
              {primaryWhenOptions.map((option) => {
                const active = whenMode === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.whenChip,
                      {
                        borderColor: theme.pastel.teal,
                        backgroundColor: active ? theme.pastel.teal : 'transparent',
                      },
                    ]}
                    onPress={() => handleWhenModeChange(option.value)}
                    testID={`budget-item-when-${option.value.replace(/_/g, '-')}`}
                  >
                    <Typography
                      variant="caption1"
                      weight="semibold"
                      color={active ? colors.white : theme.pastel.teal}
                    >
                      {option.label}
                    </Typography>
                  </TouchableOpacity>
                );
              })}
              {/* Keep the current choice visible even when it lives in the dropdown. */}
              {!isSelectedWhenPrimary && selectedWhenOption && (
                <TouchableOpacity
                  style={[
                    styles.whenChip,
                    { borderColor: theme.pastel.teal, backgroundColor: theme.pastel.teal },
                  ]}
                  onPress={() => setShowWhenSheet(true)}
                  testID={`budget-item-when-${selectedWhenOption.value.replace(/_/g, '-')}`}
                >
                  <Typography variant="caption1" weight="semibold" color={colors.white}>
                    {selectedWhenOption.label}
                  </Typography>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.whenChip, styles.whenMoreChip, { borderColor: theme.pastel.teal }]}
                onPress={() => setShowWhenSheet(true)}
                testID="budget-item-when-more"
              >
                <Typography variant="caption1" weight="semibold" color={theme.pastel.teal}>
                  More
                </Typography>
                <Icon name="chevron-down" size={IconSize.sm} color={theme.pastel.teal} />
              </TouchableOpacity>
            </View>
            <Typography variant="caption2" color={colors.textSecondary}>
              {whenHelperText(whenMode, resolvedTargetDate)}
            </Typography>

            {whenMode === 'specific_date' && (
              <TouchableOpacity
                style={[
                  styles.pickerButton,
                  { borderColor: colors.borderColor, backgroundColor: colors.groupedListBackground },
                ]}
                onPress={() => setShowDatePicker(true)}
                testID="budget-item-specific-date-picker"
              >
                <Typography variant="body">{specificDate.toLocaleDateString()}</Typography>
                <Icon name="calendar-outline" size={IconSize.md} color={theme.pastel.teal} />
              </TouchableOpacity>
            )}
            {whenMode === 'specific_date' && (
              <DatePickerSheet
                visible={showDatePicker}
                value={specificDate}
                title="Target date"
                onConfirm={setSpecificDate}
                onClose={() => setShowDatePicker(false)}
                testID="budget-item-specific-date-sheet"
              />
            )}
          </>
        )}

        </ScrollView>
      </View>

      <Modal
        visible={showCategoryPicker}
        transparent
        animationType={useCenteredCategorySheet ? 'fade' : 'slide'}
        onRequestClose={closeCategoryPicker}
      >
        <View
          style={[
            styles.categoryModalOverlay,
            { backgroundColor: colors.modalBackdrop },
            useCenteredCategorySheet && styles.categoryModalOverlayCentered,
            // The search field sits in a bottom-anchored sheet, so the keypad it
            // summons lands on top of the results underneath it. Lift by the
            // measured inset — a KeyboardAvoidingView is unreliable in a Modal,
            // and `categoryModalSheet`'s percentage height shrinks with the
            // padding so the sheet never runs off the top.
            { paddingBottom: keyboardInset },
          ]}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeCategoryPicker}
            accessibilityLabel="Close category picker"
          />
          <View
            style={[
              styles.categoryModalSheet,
              { backgroundColor: colors.backgroundMain },
              useCenteredCategorySheet && styles.categoryModalSheetCentered,
            ]}
          >
            <OverlaySheetHeader
              title="Select category"
              onClose={closeCategoryPicker}
              closeTestID="budget-item-category-close"
            />

            <View
              style={[
                styles.searchContainer,
                { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
              ]}
            >
              <Icon name="search" size={IconSize.sm} color={colors.textTertiary} />
              <RNTextInput
                ref={categorySearchInputRef}
                testID="budget-item-category-search"
                style={[styles.searchInput, { color: colors.textPrimary }]}
                value={categorySearchQuery}
                onChangeText={setCategorySearchQuery}
                placeholder="Search or name a new category..."
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
              {categorySearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setCategorySearchQuery('')}>
                  <Icon name="close-circle" size={IconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Pinned above the list: a member who scrolled the whole list
                looking for a fitting category shouldn't have to scroll back. */}
            <BudgetCategoryCreateRow
              query={categorySearchQuery}
              categories={categories}
              isCreating={isCreatingCategory}
              onCreate={createCategory}
              onNeedsName={() => categorySearchInputRef.current?.focus()}
              rowTestID="budget-item-category-create"
            />

            <ScrollView
              style={styles.categoryModalList}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator
            >
              <TouchableOpacity
                style={[
                  styles.categoryOption,
                  { borderBottomColor: colors.divider },
                  !categoryId && { backgroundColor: colors.surfaceSelected },
                ]}
                onPress={() => {
                  setCategoryId(undefined);
                  closeCategoryPicker();
                }}
                testID="budget-item-category-none"
              >
                <Typography variant="body" color={colors.textSecondary}>
                  No category
                </Typography>
                {!categoryId && (
                  <Icon name="checkmark" size={IconSize.md} color={theme.pastel.teal} />
                )}
              </TouchableOpacity>

              {filteredCategories.map((cat) => {
                const active = categoryId === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryOption,
                      { borderBottomColor: colors.divider },
                      active && { backgroundColor: colors.surfaceSelected },
                    ]}
                    onPress={() => {
                      setCategoryId(cat.id);
                      closeCategoryPicker();
                    }}
                    testID={`budget-item-category-${cat.id}`}
                  >
                    <View style={styles.categoryOptionLeft}>
                      <View
                        style={[
                          styles.categoryOptionIcon,
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

              {filteredCategories.length === 0 && (
                <View style={styles.noResults}>
                  <Typography variant="body" color={colors.textSecondary}>
                    No categories found
                  </Typography>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showWhenSheet}
        transparent
        animationType={useCenteredCategorySheet ? 'fade' : 'slide'}
        onRequestClose={() => setShowWhenSheet(false)}
      >
        <View
          style={[
            styles.categoryModalOverlay,
            { backgroundColor: colors.modalBackdrop },
            useCenteredCategorySheet && styles.categoryModalOverlayCentered,
          ]}
        >
          {/*
            Tap-to-dismiss backdrop. It fills the screen, so it must NOT be an
            accessibility element: an accessible view at absoluteFill sits in
            front of everything and swallows the sheet behind it — VoiceOver
            lands on one screen-sized "Close when picker" button and can never
            reach the eight options. It also made the sheet unreachable to
            XCUITest, which is how budget-item-form kept failing on
            `budget-item-when-sheet-asap` while the screenshot showed all eight
            rows drawn (2026-08-22). Dismissing by tapping outside still works —
            that is a touch affordance, not an accessibility one, and VoiceOver
            users have the explicit Done button.
          */}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowWhenSheet(false)}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          />
          <View
            // Scopes assistive tech to the sheet while it is up, instead of
            // leaving the form underneath focusable behind the backdrop.
            accessibilityViewIsModal
            style={[
              styles.whenSheet,
              { backgroundColor: colors.backgroundMain, paddingBottom: insets.bottom + 12 },
              useCenteredCategorySheet && styles.whenSheetCentered,
            ]}
          >
            <OverlaySheetHeader
              title="When"
              onClose={() => setShowWhenSheet(false)}
              closeTestID="budget-item-when-close"
            />
            {WHEN_OPTIONS.map((option) => {
              const active = whenMode === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.categoryOption,
                    { borderBottomColor: colors.divider },
                    active && { backgroundColor: colors.surfaceSelected },
                  ]}
                  onPress={() => handleWhenSheetSelect(option.value)}
                  testID={`budget-item-when-sheet-${option.value.replace(/_/g, '-')}`}
                >
                  <View style={styles.whenSheetLabel}>
                    <Typography variant="body" color={colors.textPrimary}>
                      {option.label}
                    </Typography>
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {whenOptionSubtitle(option.value, selectedYear, selectedMonth)}
                    </Typography>
                  </View>
                  {active && <Icon name="checkmark" size={IconSize.md} color={theme.pastel.teal} />}
                </TouchableOpacity>
              );
            })}
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
  row: { flexDirection: 'row', gap: 12 },
  flexInput: { flex: 1 },
  fieldLabel: { marginTop: -4 },
  discountToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  discountCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityRow: { flexDirection: 'row', gap: 8 },
  priorityChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  categoryModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  categoryModalOverlayCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  categoryModalSheet: {
    height: '90%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  categoryModalSheetCentered: {
    width: '100%',
    maxWidth: 520,
    height: '80%',
    borderRadius: 20,
  },
  categoryModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  categoryModalList: {
    flex: 1,
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  categoryOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  categoryOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noResults: {
    padding: 16,
    alignItems: 'center',
  },
  scheduleRow: { flexDirection: 'row', gap: 8 },
  scheduleChip: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  whenRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  whenChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  whenMoreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  whenSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  whenSheetCentered: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 20,
  },
  whenSheetLabel: { gap: 2 },
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
});
