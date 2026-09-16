/**
 * Inline "create a category" affordance for the budget category pickers.
 *
 * Every picker (spending form, receipt review, sub-budget editor) used to be a
 * read-only list of household categories: a member who could not find a fitting
 * one had to abandon the half-filled form, walk to Budget settings →
 * Categories, create it there, and come back. The row this module renders sits
 * under the picker's search field, turns whatever the member typed into a real
 * category, and hands it straight back to the picker as the selection.
 *
 * The colour/glyph come from the same presets the Categories screen offers
 * ([[budgetCategoryPresets]]), so an inline category is indistinguishable from
 * one created deliberately in settings.
 */
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import { budgetApi, isCategoryNameConflict, type BudgetCategory } from '@api/budget';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { showToast } from '@services/toastManager';
import { IconSize, useAppColors } from '@theme';

import { DEFAULT_NEW_CATEGORY_ICON, nextCategoryColor } from './budgetCategoryPresets';

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A 409 means the name belongs to a category this picker does not list, which
 * in practice is a default that was toggled off on the Categories screen.
 * Turning it back on is what the member just asked for — a "name taken" alert
 * about a category they cannot see would be a dead end. Returns null when
 * nothing matched, so the caller can fall back to the alert.
 */
async function reviveHiddenCategory(
  householdId: string,
  name: string
): Promise<BudgetCategory | null> {
  try {
    const all = await budgetApi.getCategories(householdId, { includeHidden: true });
    const match = all.categories.find((cat) => sameName(cat.name, name));
    if (!match) return null;
    if (!match.hidden) return match;
    const res = await budgetApi.updateCategory(householdId, match.id, { hidden: false });
    return res.category;
  } catch {
    return null;
  }
}

interface QuickCreateArgs {
  householdId?: string;
  /** Categories the picker lists — drives the colour rotation and the already-listed check. */
  categories: BudgetCategory[];
  /** Receives the new (or re-shown) category so the picker can list and select it. */
  onCreated: (category: BudgetCategory) => void;
}

export function useBudgetCategoryQuickCreate({
  householdId,
  categories,
  onCreated,
}: QuickCreateArgs) {
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  const createCategory = useCallback(
    async (rawName: string) => {
      const name = rawName.trim();
      if (!householdId || !name || isCreatingCategory) return;

      // Already on screen (the list moved under a slow finger) — just pick it.
      const listed = categories.find((cat) => sameName(cat.name, name));
      if (listed) {
        onCreated(listed);
        return;
      }

      setIsCreatingCategory(true);
      try {
        const res = await budgetApi.createCategory(householdId, {
          name,
          color: nextCategoryColor(categories.length),
          icon: DEFAULT_NEW_CATEGORY_ICON,
        });
        onCreated(res.category);
        showToast('success', `“${res.category.name}” added`);
      } catch (error) {
        if (isCategoryNameConflict(error)) {
          const revived = await reviveHiddenCategory(householdId, name);
          if (revived) {
            onCreated(revived);
            showToast('success', `“${revived.name}” is back on`);
            return;
          }
          Alert.alert('Category exists', `A category named “${name}” already exists.`);
          return;
        }
        console.error('Error creating budget category:', error);
        Alert.alert('Error', 'Could not create this category.');
      } finally {
        setIsCreatingCategory(false);
      }
    },
    [categories, householdId, isCreatingCategory, onCreated]
  );

  return { isCreatingCategory, createCategory };
}

interface CreateRowProps {
  /** The picker's live search text — doubles as the name for the new category. */
  query: string;
  /** Categories the picker lists; an exact match hides the row (nothing to create). */
  categories: BudgetCategory[];
  isCreating: boolean;
  /** Tapped with a name typed. */
  onCreate: (name: string) => void;
  /** Tapped with the search box empty — the picker focuses it so the member can type. */
  onNeedsName: () => void;
  /**
   * testID for the pressable row. Deliberately NOT named `testID`: a composite
   * that carries one shadows the touchable inside it for `root.find`, which
   * searches outermost-first, so `press(id)` would land on a node with no
   * onPress.
   */
  rowTestID: string;
}

export function BudgetCategoryCreateRow({
  query,
  categories,
  isCreating,
  onCreate,
  onNeedsName,
  rowTestID,
}: CreateRowProps) {
  const colors = useAppColors();
  const name = query.trim();

  // Offering `Create "Groceries"` right above the Groceries row is noise.
  if (name && categories.some((cat) => sameName(cat.name, name))) return null;

  return (
    <TouchableOpacity
      style={[
        styles.row,
        { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.divider },
      ]}
      onPress={() => (name ? onCreate(name) : onNeedsName())}
      disabled={isCreating}
      testID={rowTestID}
      accessibilityRole="button"
      accessibilityLabel={name ? `Create category ${name}` : 'Create a new category'}
    >
      <View style={[styles.icon, { backgroundColor: `${colors.primary}22` }]}>
        {isCreating ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Icon name="add" size={IconSize.lg} color={colors.primary} />
        )}
      </View>
      <Typography variant="body" color={colors.primary} numberOfLines={1} style={styles.label}>
        {name ? `Create “${name}”` : 'Create a new category'}
      </Typography>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
  },
});
