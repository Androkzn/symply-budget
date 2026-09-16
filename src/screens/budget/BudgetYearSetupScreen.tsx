import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { budgetApi } from '@api/budget';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { GradientButton, TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type BudgetYearSetupRouteProp = RouteProp<BudgetStackParamList, 'BudgetYearSetup'>;
type BudgetYearSetupNavigationProp = NativeStackNavigationProp<BudgetStackParamList, 'BudgetYearSetup'>;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function BudgetYearSetupScreen() {
  const colors = useAppColors();
  const { theme } = useTheme();
  const navigation = useNavigation<BudgetYearSetupNavigationProp>();
  const route = useRoute<BudgetYearSetupRouteProp>();
  const { year, fromMonth, plannedBudget } = route.params;
  const { currentHousehold } = useHouseholdStore();
  const { markInsightsDirty } = useBudgetStore();

  const remainingMonths = Array.from({ length: 12 - fromMonth }, (_, i) => fromMonth + 1 + i);
  const [amounts, setAmounts] = useState<Record<number, string>>(() =>
    Object.fromEntries(remainingMonths.map((m) => [m, (plannedBudget / 100).toString()]))
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveAll = async () => {
    if (!currentHousehold?.id) return;
    const entries = remainingMonths
      .map((month) => ({ month, dollars: parseFloat(amounts[month] ?? '') }))
      .filter((e) => !Number.isNaN(e.dollars) && e.dollars >= 0);

    if (entries.length === 0) {
      navigation.popToTop();
      return;
    }

    setIsSaving(true);
    try {
      await Promise.all(
        entries.map((e) =>
          budgetApi.setMonthlyGoal(currentHousehold.id, year, e.month, {
            planned_budget: Math.round(e.dollars * 100),
          })
        )
      );
      markInsightsDirty(currentHousehold.id);
      navigation.popToTop();
    } catch (error) {
      console.error('Error saving year budgets:', error);
      Alert.alert('Error', 'Could not save these budgets.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppBackground>
    <SafeAreaView edges={[]}>
      <ScreenHeader
        title={`Set budgets for ${year}`}
        showBackButton
        backButtonTestID="back-button"
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />

      <ScrollView
        {...keyboardDismissScrollProps}
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
        testID="budget-year-setup-screen"
      >
        <Typography variant="caption1" color={colors.textSecondary} style={styles.subtitle}>
          Adjust any month below, or leave the prefilled amount. Months left blank won't be set.
        </Typography>

        {remainingMonths.map((month) => (
          <TextInput
            key={month}
            label={`${MONTH_NAMES[month - 1]} ${year} ($)`}
            placeholder="0"
            value={amounts[month] ?? ''}
            onChangeText={(text) => setAmounts((prev) => ({ ...prev, [month]: text }))}
            keyboardType="decimal-pad"
            style={styles.monthInput}
            testID={`budget-year-setup-month-${month}`}
          />
        ))}

        <GradientButton
          title={isSaving ? 'Saving…' : 'Save all'}
          variant="blue"
          onPress={handleSaveAll}
          disabled={isSaving}
          fullWidth
          style={styles.saveButton}
          testID="budget-year-setup-save-all"
        />
        {isSaving && <ActivityIndicator style={styles.spinner} color={theme.pastel.teal} />}
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  subtitle: { marginBottom: 16 },
  monthInput: { marginBottom: 12 },
  saveButton: { marginTop: 12 },
  spinner: { marginTop: 12 },
});
