import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

import { Icon } from '@components/ui/Icon';
import {
  Chat,
  CornerRadius,
  LegacyTextVariant,
  Picker,
  Spacing,
  useAppColors,
} from '@theme';
import type { AppColors } from '@theme';
import { getContractorCategoryIcon } from '@utils/categoryIcons';

interface ContractorCategoryPickerProps {
  selectedCategory?: string;
  onSelect: (category: string) => void;
}

const CONTRACTOR_CATEGORIES = [
  { value: 'plumber', label: 'Plumber' },
  { value: 'electrician', label: 'Electrician' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'roofer', label: 'Roofer' },
  { value: 'general', label: 'General Contractor' },
  { value: 'landscaper', label: 'Landscaper' },
  { value: 'painter', label: 'Painter' },
  { value: 'carpenter', label: 'Carpenter' },
  { value: 'appliance', label: 'Appliance Repair' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'other', label: 'Other' },
];

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      marginBottom: Spacing.lg,
    },
    title: {
      fontSize: LegacyTextVariant.callout.size,
      lineHeight: LegacyTextVariant.callout.lineHeight,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: Spacing.md,
    },
    scrollContainer: {
      marginHorizontal: -Spacing.base,
    },
    categoriesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: Spacing.base,
      gap: Spacing.md,
    },
    categoryCard: {
      width: Picker.contractorCategoryTile,
      height: Picker.contractorCategoryTile,
      backgroundColor: colors.backgroundSecondary,
      borderRadius: CornerRadius.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: Spacing.xxs,
      borderColor: 'transparent',
    },
    categoryCardSelected: {
      backgroundColor: colors.surfaceSelected,
      borderColor: colors.accent,
    },
    categoryIcon: {
      marginBottom: Spacing.sm,
    },
    categoryLabel: {
      fontSize: LegacyTextVariant.caption1.size,
      lineHeight: LegacyTextVariant.caption1.lineHeight,
      textAlign: 'center',
      color: colors.textPrimary,
    },
    categoryLabelSelected: {
      fontWeight: '600',
      color: colors.accent,
    },
  });
}

export function ContractorCategoryPicker({ selectedCategory, onSelect }: ContractorCategoryPickerProps) {
  const colors = useAppColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Contractor Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollContainer}>
        <View style={styles.categoriesGrid}>
          {CONTRACTOR_CATEGORIES.map((category) => {
            const isSelected = selectedCategory === category.value;
            return (
              <TouchableOpacity
                key={category.value}
                style={[styles.categoryCard, isSelected && styles.categoryCardSelected]}
                onPress={() => onSelect(category.value)}
              >
                <Icon
                  name={getContractorCategoryIcon(category.value)}
                  size={Chat.aiRecommendationIconSize}
                  color={isSelected ? colors.accent : colors.textPrimary}
                  style={styles.categoryIcon}
                />
                <Text style={[styles.categoryLabel, isSelected && styles.categoryLabelSelected]}>
                  {category.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
