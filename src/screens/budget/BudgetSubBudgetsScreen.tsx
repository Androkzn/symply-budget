import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  budgetApi,
  type BudgetCategory,
  type SubBudgetLimitType,
  type SubBudgetProgress,
  type SubBudgetTotals,
} from '@api/budget';
import { AppBackground, OverlaySheetHeader, SafeAreaView, ScreenHeader } from '@components/common';
import { Card, FilterTabs, GradientButton, TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useDeviceType } from '@hooks/useDeviceType';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import type { BudgetStackParamList } from '@navigation/types';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Layout, Spacing, hexToRgba, useAppColors } from '@theme';
import { getBudgetCategoryIcon, resolveCategoryIcon } from '@utils/budgetCategoryIcon';

import { BudgetCategoryCreateRow, useBudgetCategoryQuickCreate } from './budgetCategoryQuickCreate';
import { formatBudgetCurrency } from './budgetFormat';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'all' → recurring default (month null); 'month' → single-month override. */
type SubBudgetEditorScope = 'all' | 'month';

interface EditorState {
  categoryId: string | null;
  limitType: SubBudgetLimitType;
  value: string;
  scope: SubBudgetEditorScope;
  /** True when the row already existed (enables Remove, locks the category). */
  editing: boolean;
}

const EMPTY_EDITOR: EditorState = {
  categoryId: null,
  limitType: 'amount',
  value: '',
  scope: 'all',
  editing: false,
};

export function BudgetSubBudgetsScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, markInsightsDirty } = useBudgetStore();
  const { isIPad, width } = useDeviceType();
  const useCenteredSheet = isIPad && width >= Layout.sidebarBreakpoint;
  // The editor sheet is anchored to the bottom edge, so the keypad opens on top
  // of the Amount/Percent field and the Save button under it. Lift by the
  // measured inset; `modalSheet`'s percentage maxHeight resolves against the
  // padded box, so the sheet also shrinks instead of running off the top.
  const keyboardInset = useKeyboardInset();

  const monthName = MONTH_NAMES[selectedMonth - 1];

  const [entries, setEntries] = useState<SubBudgetProgress[]>([]);
  const [totals, setTotals] = useState<SubBudgetTotals | null>(null);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [editorVisible, setEditorVisible] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  // The picker's search box doubles as the name field for an inline category,
  // so "Create a new category" with nothing typed just focuses it.
  const categorySearchInputRef = useRef<RNTextInput>(null);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) {
      setIsLoading(false);
      return;
    }
    try {
      const [subs, cats] = await Promise.all([
        budgetApi.getSubBudgets(currentHousehold.id, selectedYear, selectedMonth),
        budgetApi.getCategories(currentHousehold.id),
      ]);
      setEntries(subs.subBudgets);
      setTotals(subs.totals);
      setCategories(cats.categories);
    } catch (error) {
      console.error('Error loading sub-budgets:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id, selectedYear, selectedMonth]);

  // A plain mount-only effect left this screen showing stale caps/spend after
  // navigating away and back — React Navigation's stack re-focuses the
  // EXISTING screen instance instead of remounting it, so `load` never
  // re-ran. Refetch on every focus instead, matching SavingsOverviewView's
  // fix for the same class of bug.
  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load])
  );

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === editor.categoryId) ?? null,
    [categories, editor.categoryId]
  );

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, categorySearch]);

  const openAddEditor = () => {
    setEditor(EMPTY_EDITOR);
    setEditorVisible(true);
  };

  const openEditEditor = (entry: SubBudgetProgress) => {
    setEditor({
      categoryId: entry.category_id,
      limitType: entry.limit_type,
      value:
        entry.limit_type === 'percent'
          ? String((entry.percent_bps ?? 0) / 100)
          : String((entry.cap_cents ?? 0) / 100),
      // A month override resolves as scope 'month'; defaults/legacy edit as "all".
      scope: entry.scope === 'month' ? 'month' : 'all',
      editing: true,
    });
    setEditorVisible(true);
  };

  const closeEditor = () => {
    setEditorVisible(false);
    setShowCategoryPicker(false);
    setCategorySearch('');
  };

  const closeCategoryPicker = () => {
    setShowCategoryPicker(false);
    setCategorySearch('');
  };

  // Capping a category that doesn't exist yet is a normal way to start: create
  // it here rather than sending the member off to the Categories screen.
  const { isCreatingCategory, createCategory } = useBudgetCategoryQuickCreate({
    householdId: currentHousehold?.id,
    categories,
    onCreated: (category) => {
      setCategories((prev) =>
        prev.some((cat) => cat.id === category.id) ? prev : [...prev, category]
      );
      setEditor((prev) => ({ ...prev, categoryId: category.id }));
      closeCategoryPicker();
    },
  });

  const handleSave = async () => {
    if (!currentHousehold?.id || !editor.categoryId) {
      Alert.alert('Pick a category', 'Choose a category for this sub-budget.');
      return;
    }
    const numeric = parseFloat(editor.value);
    if (Number.isNaN(numeric) || numeric < 0) {
      Alert.alert('Invalid amount', 'Enter a valid, non-negative value.');
      return;
    }
    if (editor.limitType === 'percent' && numeric > 100) {
      Alert.alert('Invalid percent', 'A percent sub-budget must be between 0 and 100%.');
      return;
    }

    const householdId = currentHousehold.id;
    setIsSaving(true);
    try {
      await budgetApi.upsertSubBudget(householdId, {
        category_id: editor.categoryId,
        year: selectedYear,
        month: editor.scope === 'month' ? selectedMonth : null,
        limit_type: editor.limitType,
        amount_cents: editor.limitType === 'amount' ? Math.round(numeric * 100) : null,
        percent_bps: editor.limitType === 'percent' ? Math.round(numeric * 100) : null,
      });
      markInsightsDirty(householdId);
      closeEditor();
      await load();
    } catch (error) {
      console.error('Error saving sub-budget:', error);
      Alert.alert('Error', 'Could not save this sub-budget.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = () => {
    if (!currentHousehold?.id || !editor.categoryId) return;
    const householdId = currentHousehold.id;
    const categoryId = editor.categoryId;
    const scope = editor.scope;
    Alert.alert('Remove sub-budget', 'Remove this category cap?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setIsSaving(true);
          try {
            await budgetApi.deleteSubBudget(householdId, {
              category_id: categoryId,
              year: selectedYear,
              month: scope === 'month' ? selectedMonth : null,
            });
            markInsightsDirty(householdId);
            closeEditor();
            await load();
          } catch (error) {
            console.error('Error removing sub-budget:', error);
            Alert.alert('Error', 'Could not remove this sub-budget.');
          } finally {
            setIsSaving(false);
          }
        },
      },
    ]);
  };

  const header = (
    <ScreenHeader
      title="Sub-budgets"
      showBackButton
      onBackPress={() => navigation.goBack()}
      showNotificationBell={false}
      showAvatar={false}
      showPropertySwitcher={false}
    />
  );

  if (isLoading) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]} testID="budget-sub-budgets-screen">
          {header}
          <View style={styles.loadingContainer} testID="budget-sub-budgets-loading">
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="budget-sub-budgets-screen">
      {header}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.flex}
        contentContainerStyle={styles.content}
      >
        <Typography variant="caption1" color={colors.textSecondary} style={styles.subtitle}>
          Cap spending per category within your {monthName} {selectedYear} budget. Set a dollar amount
          or a percent of the total — percents follow changes to your monthly budget.
        </Typography>

        {/* Soft over-allocation warning — never blocks saving. */}
        {totals && totals.overAllocatedBy > 0 && (
          <Card
            variant="filled"
            style={[styles.warnCard, { backgroundColor: hexToRgba(colors.warning, 0.12) }]}
            testID="budget-sub-budgets-overallocated"
          >
            <Icon name="alert-circle-outline" size={IconSize.md} color={colors.warning} active />
            <Typography variant="footnote" color={colors.textPrimary} style={styles.warnText}>
              Your sub-budgets exceed {monthName}’s total by {formatBudgetCurrency(totals.overAllocatedBy)}.
            </Typography>
          </Card>
        )}

        {entries.length === 0 ? (
          <Card variant="filled" style={styles.emptyCard} testID="budget-sub-budgets-empty">
            <Typography variant="body" color={colors.textSecondary} style={styles.emptyText}>
              No sub-budgets yet. Add one to track a category like Groceries, Alcohol or Coffee against
              its own cap.
            </Typography>
          </Card>
        ) : (
          <Card variant="filled" style={styles.listCard} testID="budget-sub-budgets-list">
            {entries.map((entry, index) => {
              const fraction =
                entry.cap_cents > 0 ? Math.min(entry.spent_cents / entry.cap_cents, 1) : 0;
              const barColor = entry.over ? colors.error : colors.primary;
              const capLabel =
                entry.limit_type === 'percent'
                  ? `${(entry.percent_bps ?? 0) / 100}% · ${formatBudgetCurrency(entry.cap_cents)}`
                  : formatBudgetCurrency(entry.cap_cents);
              return (
                <TouchableOpacity
                  key={entry.category_id}
                  activeOpacity={0.7}
                  onPress={() => openEditEditor(entry)}
                  style={[
                    styles.entryRow,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.divider,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${entry.name} sub-budget, ${capLabel}`}
                  testID={`budget-sub-budget-${entry.category_id}`}
                >
                  <View style={styles.entryHeader}>
                    <View
                      style={[
                        styles.entryIcon,
                        { backgroundColor: entry.color || colors.primary },
                      ]}
                    >
                      <Icon
                        name={getBudgetCategoryIcon(entry.name)}
                        size={IconSize.md}
                        color={colors.white}
                        active
                      />
                    </View>
                    <Typography variant="body" weight="medium" style={styles.entryName} numberOfLines={1}>
                      {entry.name}
                    </Typography>
                    <Typography variant="footnote" color={colors.textSecondary}>
                      {capLabel}
                    </Typography>
                  </View>

                  {/* Spent-vs-cap progress. */}
                  <View style={[styles.progressTrack, { backgroundColor: colors.divider }]}>
                    <View
                      style={[
                        styles.progressFill,
                        { backgroundColor: barColor, width: `${Math.round(fraction * 100)}%` },
                      ]}
                    />
                  </View>

                  <View style={styles.entryFooter}>
                    <Typography
                      variant="caption1"
                      color={colors.textSecondary}
                      testID={`budget-sub-budget-spent-${entry.category_id}`}
                    >
                      {formatBudgetCurrency(entry.spent_cents)} spent
                    </Typography>
                    <Typography
                      variant="caption1"
                      weight="semibold"
                      color={entry.over ? colors.error : colors.textPrimary}
                    >
                      {entry.over
                        ? `${formatBudgetCurrency(-entry.remaining_cents)} over`
                        : `${formatBudgetCurrency(entry.remaining_cents)} left`}
                    </Typography>
                  </View>
                </TouchableOpacity>
              );
            })}
          </Card>
        )}

        <GradientButton
          title="Add sub-budget"
          onPress={openAddEditor}
          fullWidth
          style={styles.addButton}
          testID="budget-sub-budget-add"
        />
      </ScrollView>

      {/* Editor sheet. The category picker used to be a SECOND native <Modal>
      presented on top of this one — two stacked iOS modal presentations are
      unreliable (the picker could silently fail to present at all; see
      [[budget-subbudget-category-picker-broken]]). It's now an internal view
      swap inside this SAME modal instead, so only one native modal is ever
      presented at a time. */}
      <Modal
        visible={editorVisible}
        transparent
        animationType={useCenteredSheet ? 'fade' : 'slide'}
        onRequestClose={showCategoryPicker ? closeCategoryPicker : closeEditor}
      >
        <View
          style={[
            styles.modalOverlay,
            { backgroundColor: colors.modalBackdrop },
            useCenteredSheet && styles.modalOverlayCentered,
            { paddingBottom: keyboardInset },
          ]}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={showCategoryPicker ? closeCategoryPicker : closeEditor}
            accessibilityLabel={showCategoryPicker ? 'Close category picker' : 'Close sub-budget editor'}
          />
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.backgroundMain },
              useCenteredSheet && styles.modalSheetCentered,
            ]}
          >
            {showCategoryPicker ? (
              <>
                <OverlaySheetHeader
                  title="Select category"
                  onClose={closeCategoryPicker}
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
                    testID="budget-sub-budget-category-search"
                    style={[styles.searchInput, { color: colors.textPrimary }]}
                    value={categorySearch}
                    onChangeText={setCategorySearch}
                    placeholder="Search or name a new category..."
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>

                <BudgetCategoryCreateRow
                  query={categorySearch}
                  categories={categories}
                  isCreating={isCreatingCategory}
                  onCreate={createCategory}
                  onNeedsName={() => categorySearchInputRef.current?.focus()}
                  rowTestID="budget-sub-budget-category-create"
                />

                <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="always">
                  {filteredCategories.map((cat) => {
                    const active = editor.categoryId === cat.id;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[
                          styles.pickerOption,
                          { borderBottomColor: colors.divider },
                          active && { backgroundColor: colors.surfaceSelected },
                        ]}
                        onPress={() => {
                          setEditor((prev) => ({ ...prev, categoryId: cat.id }));
                          closeCategoryPicker();
                        }}
                        testID={`budget-sub-budget-category-${cat.id}`}
                      >
                        <View style={styles.pickerOptionLeft}>
                          <View
                            style={[
                              styles.pickerOptionIcon,
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
                        {active && <Icon name="checkmark" size={IconSize.md} color={theme.pastel.teal} />}
                      </TouchableOpacity>
                    );
                  })}
                  {filteredCategories.length === 0 && (
                    <View style={styles.pickerEmpty}>
                      <Typography variant="body" color={colors.textSecondary}>
                        No categories match “{categorySearch}”.
                      </Typography>
                    </View>
                  )}
                </ScrollView>
              </>
            ) : (
              <>
                <OverlaySheetHeader
                  title={editor.editing ? 'Edit sub-budget' : 'New sub-budget'}
                  onClose={closeEditor}
                  closeTestID="budget-sub-budget-editor-close"
                />

                {/* Category */}
                <Typography variant="overline" color={colors.textTertiary} style={styles.fieldLabel}>
                  CATEGORY
                </Typography>
                <TouchableOpacity
                  disabled={editor.editing}
                  onPress={() => setShowCategoryPicker(true)}
                  style={[
                    styles.categoryButton,
                    { borderColor: colors.borderColor, backgroundColor: colors.backgroundSecondary },
                    editor.editing && styles.categoryButtonLocked,
                  ]}
                  testID="budget-sub-budget-category-picker"
                  accessibilityRole="button"
                  accessibilityLabel="Select category"
                >
                  {selectedCategory ? (
                    <View style={styles.categoryButtonLabel}>
                      <View
                        style={[
                          styles.categoryButtonIcon,
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
                    <Typography variant="body" color={colors.textTertiary}>
                      Select category
                    </Typography>
                  )}
                  {!editor.editing && (
                    <Icon name="chevron-down" size={IconSize.sm} color={colors.textTertiary} />
                  )}
                </TouchableOpacity>

                {/* Limit type */}
                <Typography variant="overline" color={colors.textTertiary} style={styles.fieldLabel}>
                  LIMIT
                </Typography>
                <FilterTabs
                  tabs={[
                    { id: 'amount', label: 'Amount ($)' },
                    { id: 'percent', label: 'Percent (%)' },
                  ]}
                  activeTab={editor.limitType}
                  onTabChange={(id) =>
                    setEditor((prev) => ({ ...prev, limitType: id as SubBudgetLimitType }))
                  }
                />

                <TextInput
                  testID="budget-sub-budget-value"
                  label={editor.limitType === 'percent' ? 'Percent of total budget' : 'Amount ($)'}
                  placeholder={editor.limitType === 'percent' ? '10' : '100'}
                  value={editor.value}
                  onChangeText={(value) => setEditor((prev) => ({ ...prev, value }))}
                  keyboardType="decimal-pad"
                  containerStyle={styles.valueInput}
                />

                {/* Scope */}
                <Typography variant="overline" color={colors.textTertiary} style={styles.fieldLabel}>
                  APPLIES TO
                </Typography>
                <FilterTabs
                  tabs={[
                    { id: 'all', label: 'All months' },
                    { id: 'month', label: `Only ${monthName}` },
                  ]}
                  activeTab={editor.scope}
                  onTabChange={(id) =>
                    setEditor((prev) => ({ ...prev, scope: id as SubBudgetEditorScope }))
                  }
                />

                <GradientButton
                  title={isSaving ? 'Saving…' : 'Save sub-budget'}
                  onPress={handleSave}
                  disabled={isSaving}
                  fullWidth
                  style={styles.saveButton}
                  testID="budget-sub-budget-save"
                />
                {editor.editing && (
                  <TouchableOpacity
                    onPress={handleRemove}
                    disabled={isSaving}
                    style={styles.removeButton}
                    accessibilityRole="button"
                    accessibilityLabel="Remove sub-budget"
                    testID="budget-sub-budget-remove"
                  >
                    <Typography variant="body" color={colors.destructive}>
                      Remove sub-budget
                    </Typography>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance },
  subtitle: { marginBottom: Spacing.md },
  warnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  warnText: { flex: 1 },
  emptyCard: { padding: Spacing.lg },
  emptyText: { textAlign: 'center' },
  listCard: { padding: 0 },
  entryRow: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.base, gap: Spacing.sm },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.smd },
  entryIcon: {
    width: Spacing.xl,
    height: Spacing.xl,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryName: { flex: 1 },
  progressTrack: { height: 8, borderRadius: CornerRadius.xs, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: CornerRadius.xs },
  entryFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addButton: { marginTop: Spacing.lg },
  // Modals
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalOverlayCentered: { justifyContent: 'center', alignItems: 'center' },
  modalSheet: {
    borderTopLeftRadius: CornerRadius.xl,
    borderTopRightRadius: CornerRadius.xl,
    padding: Spacing.base,
    paddingBottom: Spacing.xl,
    maxHeight: '85%',
  },
  modalSheetCentered: {
    width: '80%',
    maxWidth: 520,
    borderRadius: CornerRadius.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  fieldLabel: { marginTop: Spacing.md, marginBottom: Spacing.sm },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
  },
  categoryButtonLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  categoryButtonIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryButtonLocked: { opacity: 0.6 },
  valueInput: { marginTop: Spacing.md },
  saveButton: { marginTop: Spacing.lg },
  removeButton: { alignItems: 'center', paddingVertical: Spacing.md },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.smd,
    paddingVertical: Platform.OS === 'ios' ? Spacing.smd : Spacing.xs,
    marginBottom: Spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 16, padding: 0 },
  pickerList: { maxHeight: 360 },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  pickerOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmpty: { paddingVertical: Spacing.lg, alignItems: 'center' },
});
