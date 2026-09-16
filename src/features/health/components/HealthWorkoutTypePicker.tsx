import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BottomSheet, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  searchWorkoutTypes,
  WORKOUT_CATEGORIES,
  WORKOUT_CATEGORY_ICONS,
  WORKOUT_CATEGORY_LABELS,
  workoutTypeCategory,
  workoutTypeIcon,
  workoutTypeLabel,
  type WorkoutCategory,
  type WorkoutType,
} from '../healthWorkoutTypes';

/**
 * Pick one of the donor's 61 workout types.
 *
 * WHY A SHEET AND NOT A LONGER CHIP ROW. Seven types fit on a form; sixty-one
 * do not. A flat list of 61 is only marginally better than the seven it
 * replaces — the member still has to scan the whole thing to find "Table
 * Tennis" — so this reproduces the donor's structure (`AddWorkoutView`'s
 * category chips + type grid) and adds the one thing the donor lacks: a search
 * box. Search matches the label, the slug AND the alias table, so "bike" finds
 * Cycling and "abs" finds Core Training.
 *
 * The GROUPING survives a search on purpose. Collapsing to a flat hit list is
 * exactly the failure mode this component exists to avoid: "Squash" and
 * "Stretching" both match "s", and only the category header tells them apart at
 * a glance.
 *
 * Recently-used types sit above the categories. That is not in the donor, and it
 * is what actually makes 61 usable — most people log four or five types over and
 * over, and the picker should not make them re-find those every time.
 */

export interface HealthWorkoutTypePickerProps {
  visible: boolean;
  selected: WorkoutType;
  /** Distinct types the member has logged, newest first. Empty is fine. */
  recent?: readonly WorkoutType[];
  onSelect: (type: WorkoutType) => void;
  onClose: () => void;
}

const MAX_RECENT = 6;

type CategoryFilter = WorkoutCategory | 'all';

export function HealthWorkoutTypePicker({
  visible,
  selected,
  recent = [],
  onSelect,
  onClose,
}: HealthWorkoutTypePickerProps) {
  const colors = useAppColors();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const searching = query.trim().length > 0;

  const groups = useMemo(() => {
    const found = searchWorkoutTypes(query);
    return category === 'all' ? found : found.filter((group) => group.category === category);
  }, [query, category]);

  const recentTypes = useMemo(() => {
    const seen = new Set<string>();
    const out: WorkoutType[] = [];
    for (const type of recent) {
      if (seen.has(type)) continue;
      seen.add(type);
      out.push(type);
      if (out.length === MAX_RECENT) break;
    }
    return out;
  }, [recent]);

  const handlePick = (type: WorkoutType) => {
    onSelect(type);
    // Leave the query behind: reopening the picker should start from the whole
    // catalogue, not from whatever was typed last time.
    setQuery('');
    setCategory('all');
    onClose();
  };

  const typeChip = (type: WorkoutType, keyPrefix: string) => {
    const active = type === selected;
    return (
      <Pressable
        key={`${keyPrefix}-${type}`}
        onPress={() => handlePick(type)}
        accessibilityRole="button"
        accessibilityLabel={`Workout type ${workoutTypeLabel(type)}`}
        accessibilityState={{ selected: active }}
        testID={`${keyPrefix}-${type}`}
        style={[
          styles.typeChip,
          {
            borderColor: active ? colors.primary : colors.borderColor,
            backgroundColor: active ? colors.primary : 'transparent',
          },
        ]}
      >
        <Icon
          name={workoutTypeIcon(type)}
          size={14}
          color={active ? colors.white : colors.textSecondary}
        />
        <Typography
          variant="caption1"
          weight="semibold"
          color={active ? colors.white : colors.textPrimary}
        >
          {workoutTypeLabel(type)}
        </Typography>
      </Pressable>
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Workout type"
      height="tall"
      showCloseButton
    >
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search 61 types — try “bike” or “abs”"
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search workout types"
          testID="health-workout-type-search"
          style={[
            styles.input,
            styles.flexInput,
            {
              color: colors.textPrimary,
              borderColor: colors.borderColor,
              backgroundColor: colors.backgroundMain,
            },
          ]}
        />
        {searching && (
          <Pressable
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            testID="health-workout-type-search-clear"
            hitSlop={8}
          >
            <Icon name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
      >
        {(['all', ...WORKOUT_CATEGORIES] as CategoryFilter[]).map((option) => {
          const active = option === category;
          const label = option === 'all' ? 'All' : WORKOUT_CATEGORY_LABELS[option];
          return (
            <Pressable
              key={option}
              onPress={() => setCategory(option)}
              accessibilityRole="button"
              accessibilityLabel={`Show ${label}`}
              accessibilityState={{ selected: active }}
              testID={`health-workout-category-${option}`}
              style={[
                styles.categoryChip,
                {
                  borderColor: active ? colors.primary : colors.borderColor,
                  backgroundColor: active ? colors.primary : 'transparent',
                },
              ]}
            >
              {option !== 'all' && (
                <Icon
                  name={WORKOUT_CATEGORY_ICONS[option]}
                  size={13}
                  color={active ? colors.white : colors.textSecondary}
                />
              )}
              <Typography
                variant="caption1"
                weight="semibold"
                color={active ? colors.white : colors.textSecondary}
              >
                {label}
              </Typography>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {!searching && category === 'all' && recentTypes.length > 0 && (
          <View testID="health-workout-type-recent">
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={styles.sectionLabel}
            >
              RECENTLY LOGGED
            </Typography>
            <View style={styles.typeGrid}>
              {recentTypes.map((type) => typeChip(type, 'health-workout-type-recent-option'))}
            </View>
          </View>
        )}

        {groups.length === 0 ? (
          <Typography
            variant="body"
            color={colors.textSecondary}
            testID="health-workout-type-empty"
          >
            {`Nothing matches “${query.trim()}”. Try a shorter word, or pick ${workoutTypeLabel(
              'other'
            )} and describe it in the note.`}
          </Typography>
        ) : (
          groups.map((group) => (
            <View key={group.category} testID={`health-workout-group-${group.category}`}>
              <View style={styles.groupHead}>
                <Icon name={group.icon} size={15} color={colors.textSecondary} />
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  style={styles.sectionLabel}
                >
                  {group.label.toUpperCase()}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {group.types.length}
                </Typography>
              </View>
              <View style={styles.typeGrid}>
                {group.types.map((type) => typeChip(type, 'health-workout-type-option'))}
              </View>
            </View>
          ))
        )}

        <Typography variant="caption1" color={colors.textSecondary}>
          {searching
            ? 'Results stay grouped by category so two similar names are never confused.'
            : `Currently logging ${workoutTypeLabel(selected)} · ${
                WORKOUT_CATEGORY_LABELS[workoutTypeCategory(selected)]
              }.`}
        </Typography>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  flexInput: {
    flex: 1,
  },
  categoryRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingVertical: Spacing.xxs,
    paddingRight: Spacing.base,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  list: {
    marginTop: Spacing.sm,
  },
  listContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
});
