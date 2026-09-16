import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { budgetApi, isCategoryNameConflict, type BudgetCategory } from '@api/budget';
import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Button, Card, TextInput, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { ButtonMetrics, CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { budgetIconForActiveKit, resolveCategoryIcon } from '@utils/budgetCategoryIcon';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { PRESET_CATEGORY_COLORS, PRESET_CATEGORY_ICONS } from './budgetCategoryPresets';

export function BudgetCategoriesScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();

  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState(PRESET_CATEGORY_COLORS[0]);
  const [newCategoryIcon, setNewCategoryIcon] = useState(PRESET_CATEGORY_ICONS[0]);
  // Non-null => the form is editing that category instead of creating one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // The editor sits BELOW the custom list, and that list is unbounded (a
  // household that predates the seed carries every hand-made name as a custom
  // row — the E2E account has ~57). Tapping the pencil on a row near the top
  // loaded the form a screen or two further down, where nothing visibly
  // changed: the tap read as a dead button. Starting an edit therefore scrolls
  // the editor into view. The y comes from the editor section's own layout
  // (it is a direct child of the scroll content, so the offset is already in
  // content coordinates), captured once and refreshed on every re-layout.
  const scrollRef = useRef<ScrollView>(null);
  const editorOffsetY = useRef(0);
  const onEditorLayout = useCallback((event: LayoutChangeEvent) => {
    editorOffsetY.current = event.nativeEvent.layout.y;
  }, []);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) {
      setCategories([]);
      setIsLoading(false);
      return;
    }
    try {
      // Include hidden defaults so they can be toggled back on here.
      const res = await budgetApi.getCategories(currentHousehold.id, { includeHidden: true });
      setCategories(res.categories);
    } catch (error) {
      console.error('Error loading budget categories:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddCategory = async () => {
    if (!currentHousehold?.id || !newCategoryName.trim()) return;
    const name = newCategoryName.trim();
    setIsAddingCategory(true);
    try {
      const res = await budgetApi.createCategory(currentHousehold.id, {
        name,
        color: newCategoryColor,
        icon: newCategoryIcon,
      });
      setCategories((prev) => [...prev, res.category]);
      resetForm();
    } catch (error) {
      console.error('Error creating category:', error);
      if (isCategoryNameConflict(error)) {
        Alert.alert('Category exists', `A category named "${name}" already exists.`);
      } else {
        Alert.alert('Error', 'Could not create this category.');
      }
    } finally {
      setIsAddingCategory(false);
    }
  };

  const resetForm = () => {
    setNewCategoryName('');
    setNewCategoryColor(PRESET_CATEGORY_COLORS[0]);
    setNewCategoryIcon(PRESET_CATEGORY_ICONS[0]);
    setEditingId(null);
  };

  /**
   * Load a custom category into the shared form; the Add button becomes Save.
   * Then bring the form on screen — see `scrollRef` for why that is not optional.
   */
  const handleStartEdit = (category: BudgetCategory) => {
    setEditingId(category.id);
    setNewCategoryName(category.name);
    setNewCategoryColor(category.color || PRESET_CATEGORY_COLORS[0]);
    setNewCategoryIcon(category.icon || PRESET_CATEGORY_ICONS[0]);
    scrollRef.current?.scrollTo({
      y: Math.max(0, editorOffsetY.current - Spacing.base),
      animated: true,
    });
  };

  const handleSaveEdit = async () => {
    if (!currentHousehold?.id || !editingId || !newCategoryName.trim()) return;
    const name = newCategoryName.trim();
    setIsSavingEdit(true);
    try {
      const res = await budgetApi.updateCategory(currentHousehold.id, editingId, {
        name,
        color: newCategoryColor,
        icon: newCategoryIcon,
      });
      setCategories((prev) => prev.map((c) => (c.id === editingId ? res.category : c)));
      resetForm();
    } catch (error) {
      console.error('Error updating category:', error);
      if (isCategoryNameConflict(error)) {
        Alert.alert('Category exists', `A category named "${name}" already exists.`);
      } else {
        Alert.alert('Error', 'Could not update this category.');
      }
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteCategory = (category: BudgetCategory) => {
    if (!currentHousehold?.id) return;
    Alert.alert('Delete category', `Delete "${category.name}"? Spendings using it will be uncategorized.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(category.id);
          try {
            await budgetApi.deleteCategory(currentHousehold.id, category.id);
            setCategories((prev) => prev.filter((c) => c.id !== category.id));
            // Editing the row that just vanished would save into nothing.
            if (editingId === category.id) resetForm();
          } catch (error) {
            console.error('Error deleting category:', error);
            Alert.alert('Error', 'Could not delete this category.');
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  // Predefined categories are hidden/shown (not deleted). Flip optimistically so
  // the switch feels instant, then persist; revert if the request fails.
  const handleToggleCategory = async (category: BudgetCategory) => {
    if (!currentHousehold?.id || togglingId) return;
    const nextHidden = !category.hidden;
    setTogglingId(category.id);
    setCategories((prev) =>
      prev.map((c) => (c.id === category.id ? { ...c, hidden: nextHidden } : c))
    );
    try {
      await budgetApi.updateCategory(currentHousehold.id, category.id, { hidden: nextHidden });
    } catch (error) {
      console.error('Error toggling category:', error);
      setCategories((prev) =>
        prev.map((c) => (c.id === category.id ? { ...c, hidden: category.hidden } : c))
      );
      Alert.alert('Error', 'Could not update this category.');
    } finally {
      setTogglingId(null);
    }
  };

  // Split into user-created (deletable) and app-seeded defaults (togglable),
  // each sorted alphabetically for a predictable management list.
  const byName = (a: BudgetCategory, b: BudgetCategory) => a.name.localeCompare(b.name);
  const customCategories = useMemo(
    () => categories.filter((c) => !c.is_default).sort(byName),
    [categories]
  );
  const defaultCategories = useMemo(
    () => categories.filter((c) => c.is_default).sort(byName),
    [categories]
  );

  const header = (
    <ScreenHeader
      // Same words as the Settings → Preferences row that opens this screen, so
      // the destination confirms the tap instead of renaming it on arrival.
      title="Spending Categories"
      showBackButton
      onBackPress={() => navigation.goBack()}
      showNotificationBell={false}
      showAvatar={false}
      showPropertySwitcher={false}
    />
  );

  if (isLoading) {
    return (
      // ScreenHeader owns the top safe-area inset, so no `top` edge here.
      <AppBackground>
        <SafeAreaView edges={[]} testID="budget-categories-screen">
          {header}
          <View style={styles.loadingContainer} testID="budget-categories-loading">
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="budget-categories-screen">
      {header}
      <ScrollView
        ref={scrollRef}
        {...keyboardDismissScrollProps}
        style={styles.flex}
        contentContainerStyle={styles.content}
        testID="budget-categories-scroll"
      >
        <Typography variant="caption1" color={colors.textSecondary} style={styles.sectionSubtitle}>
          Add your own categories with an icon and colour, edit or delete them any time, and
          turn the built-in ones you don’t use on or off.
        </Typography>

        {/* Custom categories — user-created, removable. */}
        <Typography variant="overline" color={colors.textTertiary} style={styles.groupLabel}>
          YOUR CATEGORIES
        </Typography>
        <Card variant="filled" style={styles.listCard} testID="budget-custom-categories">
          {customCategories.length === 0 ? (
            <View style={styles.emptyRow}>
              <Typography variant="body" color={colors.textSecondary}>
                No custom categories yet — add one below.
              </Typography>
            </View>
          ) : (
            customCategories.map((cat, index) => (
              <View
                key={cat.id}
                style={[
                  styles.categoryRow,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
                ]}
              >
                <View style={[styles.categoryIcon, { backgroundColor: cat.color || colors.primary }]}>
                  {/* White, NOT `active`: `active` forces the kit's green gradient
                      sheet, which turns to mud on a coloured tile. */}
                  <Icon name={resolveCategoryIcon(cat)} size={IconSize.lg} color={colors.white} />
                </View>
                <Typography variant="body" style={styles.categoryName} numberOfLines={1}>
                  {cat.name}
                </Typography>
                <TouchableOpacity
                  onPress={() => handleStartEdit(cat)}
                  hitSlop={{ top: Spacing.sm, bottom: Spacing.sm, left: Spacing.sm, right: Spacing.sm }}
                  style={styles.rowControl}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${cat.name}`}
                  testID={`budget-category-edit-${cat.id}`}
                >
                  <Icon
                    name="create-outline"
                    size={IconSize.lg}
                    color={editingId === cat.id ? colors.primary : colors.textSecondary}
                  />
                </TouchableOpacity>
                {deletingId === cat.id ? (
                  <ActivityIndicator size="small" color={colors.primary} style={styles.rowControl} />
                ) : (
                  <TouchableOpacity
                    onPress={() => handleDeleteCategory(cat)}
                    hitSlop={{ top: Spacing.sm, bottom: Spacing.sm, left: Spacing.sm, right: Spacing.sm }}
                    style={styles.rowControl}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${cat.name}`}
                    testID={`budget-category-delete-${cat.id}`}
                  >
                    <Icon name="trash-outline" size={IconSize.lg} color={colors.destructive} />
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </Card>

        {/* Editor — one card that builds the whole category (glyph, colour, name)
            with a live preview, instead of two identical colour chips whose
            purpose you could only learn by tapping them. Label + card share one
            wrapper so the edit-scroll lands on the heading, not mid-card. */}
        <View onLayout={onEditorLayout} testID="budget-category-editor-section">
        <Typography variant="overline" color={colors.textTertiary} style={styles.groupLabel}>
          {editingId ? 'EDIT CATEGORY' : 'NEW CATEGORY'}
        </Typography>
        <Card variant="filled" style={styles.editorCard} testID="budget-category-editor">
          <View style={styles.editorTopRow}>
            <View
              style={[styles.previewTile, { backgroundColor: newCategoryColor }]}
              testID="budget-category-preview"
            >
              <Icon name={newCategoryIcon} size={IconSize.xl} color={colors.white} />
            </View>
            <TextInput
              placeholder={editingId ? 'Category name' : 'New category name'}
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              containerStyle={styles.flexInput}
              testID="budget-category-name-input"
            />
          </View>

          <Typography variant="caption2" color={colors.textTertiary} style={styles.pickerLabel}>
            COLOR
          </Typography>
          {/* A rail, like the glyphs below: the palette outgrew the two wrapped
              rows it used to fit in, and letting it keep wrapping would push the
              icons and the Add button off the bottom of the card. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pickerRail}
            testID="budget-category-color-grid"
          >
            {PRESET_CATEGORY_COLORS.map((swatch) => (
              <TouchableOpacity
                key={swatch}
                onPress={() => setNewCategoryColor(swatch)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: swatch },
                  swatch === newCategoryColor && { borderColor: colors.textPrimary },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: swatch === newCategoryColor }}
                accessibilityLabel={`Use color ${swatch}`}
                testID={`budget-category-color-${swatch}`}
              >
                {swatch === newCategoryColor && (
                  <Icon name="checkmark" size={IconSize.sm} color={colors.white} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Typography variant="caption2" color={colors.textTertiary} style={styles.pickerLabel}>
            ICON
          </Typography>
          {/* A rail, not a wrapped grid: 50-odd glyphs stacked six rows deep
              pushed the Add button and the whole default list below the fold. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pickerRail}
            testID="budget-category-icon-grid"
          >
            {PRESET_CATEGORY_ICONS.map((glyph) => {
              const selected = glyph === newCategoryIcon;
              return (
                <TouchableOpacity
                  key={glyph}
                  onPress={() => setNewCategoryIcon(glyph)}
                  style={[
                    styles.iconTile,
                    {
                      backgroundColor: selected ? newCategoryColor : colors.groupedListBackground,
                      borderColor: selected ? newCategoryColor : colors.borderColor,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Use icon ${glyph}`}
                  testID={`budget-category-icon-${glyph}`}
                >
                  {/* Stores the Budget SLUG, draws whatever the active kit can:
                      most of this rail is missing from House's kit, and an
                      unresolved slug is not an Ionicons glyph either, so the
                      picker offered rows of "?" tiles. */}
                  <Icon
                    name={budgetIconForActiveKit(glyph)}
                    size={IconSize.lg}
                    color={selected ? colors.white : colors.textSecondary}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.editorActions}>
            {editingId && (
              <Button
                title="Cancel"
                variant="secondary"
                onPress={resetForm}
                style={styles.editorAction}
                accessibilityLabel="Cancel editing"
                testID="budget-category-edit-cancel"
              />
            )}
            <Button
              title={editingId ? 'Save changes' : 'Add category'}
              onPress={editingId ? handleSaveEdit : handleAddCategory}
              loading={isAddingCategory || isSavingEdit}
              disabled={isAddingCategory || isSavingEdit || !newCategoryName.trim()}
              style={styles.editorAction}
              testID={editingId ? 'budget-category-save' : 'budget-category-add'}
            />
          </View>
        </Card>
        </View>

        {/* Predefined categories — always available; hidden via a toggle, never deleted. */}
        {defaultCategories.length > 0 && (
          <>
            <Typography variant="overline" color={colors.textTertiary} style={styles.groupLabel}>
              DEFAULT CATEGORIES
            </Typography>
            <Card variant="filled" style={styles.listCard} testID="budget-default-categories">
              {defaultCategories.map((cat, index) => (
                <View
                  key={cat.id}
                  style={[
                    styles.categoryRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
                  ]}
                >
                  <View
                    style={[
                      styles.categoryIcon,
                      { backgroundColor: cat.color || colors.primary },
                      cat.hidden && styles.categoryIconMuted,
                    ]}
                  >
                    <Icon name={resolveCategoryIcon(cat)} size={IconSize.lg} color={colors.white} />
                  </View>
                  <Typography
                    variant="body"
                    style={styles.categoryName}
                    numberOfLines={1}
                    color={cat.hidden ? colors.textTertiary : colors.textPrimary}
                  >
                    {cat.name}
                  </Typography>
                  {togglingId === cat.id ? (
                    <ActivityIndicator size="small" color={colors.primary} style={styles.rowControl} />
                  ) : (
                    <Toggle
                      value={!cat.hidden}
                      onValueChange={() => handleToggleCategory(cat)}
                      style={styles.rowControl}
                      accessibilityLabel={`${cat.hidden ? 'Show' : 'Hide'} ${cat.name}`}
                      testID={`budget-category-toggle-${cat.id}`}
                    />
                  )}
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance },
  sectionSubtitle: { marginBottom: Spacing.md },
  groupLabel: {
    marginTop: Spacing.base,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  // Rows own their padding so the hairline dividers span edge to edge; the Card's
  // rounded corners + overflow:hidden clip them cleanly.
  listCard: { padding: 0 },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    gap: Spacing.smd,
  },
  // 40pt tile (xxl + sm) — big enough for a 24pt glyph to read at arm's length.
  categoryIcon: {
    width: Spacing.xxl + Spacing.sm,
    height: Spacing.xxl + Spacing.sm,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIconMuted: { opacity: ButtonMetrics.pressOpacityDisabled },
  categoryName: { flex: 1 },
  rowControl: { marginLeft: Spacing.xs },
  emptyRow: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.base },
  editorCard: { padding: Spacing.base },
  editorTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  // Live preview of what the row will look like once saved.
  previewTile: {
    width: Spacing.xxl + Spacing.lg,
    height: Spacing.xxl + Spacing.lg,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fills the row next to the preview tile; drop the field's default bottom
  // margin so the two stay vertically centred on each other.
  flexInput: { flex: 1, marginBottom: 0 },
  pickerLabel: { marginTop: Spacing.base, marginBottom: Spacing.sm },
  // Shared by both rails so the swatches and the glyph tiles scroll on the
  // same rhythm; the trailing pad keeps the last item clear of the card edge.
  pickerRail: { flexDirection: 'row', gap: Spacing.sm, paddingRight: Spacing.base },
  colorSwatch: {
    width: Spacing.xxl,
    height: Spacing.xxl,
    borderRadius: Spacing.base,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTile: {
    width: Spacing.xxl + Spacing.sm,
    height: Spacing.xxl + Spacing.sm,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  editorAction: { flex: 1 },
});
