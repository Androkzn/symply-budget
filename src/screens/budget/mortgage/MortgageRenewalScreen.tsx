import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { mortgageApi, type MortgagePaymentFrequency, type RenewMortgageRequest } from '@api/mortgage';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Button, Card, FilterTabs, TextInput, Typography, type FilterTab } from '@components/ui';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useMortgageStore } from '@stores/mortgageStore';
import { Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { convertDurationValue, durationToMonths, type DurationUnit } from './duration';
import { DurationUnitToggle } from './DurationUnitToggle';

const RATE_TABS: FilterTab[] = [
  { id: 'fixed', label: 'Fixed' },
  { id: 'variable', label: 'Variable' },
];
const FREQ_TABS: FilterTab[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'biweekly', label: 'Bi-weekly' },
  { id: 'accel_biweekly', label: 'Accel. bi-weekly' },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Renewal wizard — records a new term at renewal. The server snaps the balance
 * at renewal (reconciled) and re-amortizes over the ACTUAL remaining amortization
 * at the new rate (§4.6). This is the flow the renewal reminder deep-links into.
 */
export function MortgageRenewalScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<BudgetStackParamList, 'MortgageRenew'>>();
  const mortgageId = route.params?.mortgageId;
  const { currentHousehold } = useHouseholdStore();
  const markDirty = useMortgageStore((s) => s.markDirty);

  const [termStartDate, setTermStartDate] = useState(todayISO());
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('years');
  const [termValue, setTermValue] = useState('5');
  const [rate, setRate] = useState('');
  const [rateKind, setRateKind] = useState('fixed');
  const [frequency, setFrequency] = useState<MortgagePaymentFrequency>('monthly');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onUnitChange = (next: DurationUnit) => {
    setTermValue((v) => convertDurationValue(v, durationUnit, next));
    setDurationUnit(next);
  };

  const onSave = async () => {
    setError(null);
    const ratePct = parseFloat(rate);
    const termMonths = durationToMonths(termValue, durationUnit);
    if (!currentHousehold?.id || !mortgageId) return setError('Missing mortgage.');
    if (!(ratePct > 0)) return setError('Enter the new interest rate.');
    if (!(termMonths > 0)) return setError('Enter the new term length.');

    const body: RenewMortgageRequest = {
      termStartDate,
      termMonths,
      rateType: rateKind === 'fixed' ? 'fixed' : 'variable_arm',
      compounding: rateKind === 'fixed' ? 'semi_annual' : 'monthly',
      nominalRateBps: Math.round(ratePct * 100),
      paymentFrequency: frequency,
    };

    setSaving(true);
    try {
      await mortgageApi.renew(currentHousehold.id, mortgageId, body);
      markDirty();
      navigation.goBack();
    } catch (e) {
      setError('Could not record the renewal. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppBackground>
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScreenHeader title="Renew mortgage" showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView
        {...keyboardDismissScrollProps}
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.body}
      >
        <Card variant="filled" style={styles.note}>
          <Typography variant="caption" color={colors.textSecondary}>
            Enter your renewal terms. We re-amortize your current balance over the remaining amortization at
            the new rate.
          </Typography>
        </Card>

        <TextInput label="Renewal date (YYYY-MM-DD)" value={termStartDate} onChangeText={setTermStartDate} />
        <DurationUnitToggle label="Enter term in" unit={durationUnit} onChange={onUnitChange} />
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <TextInput
              label="New term"
              keyboardType="decimal-pad"
              value={termValue}
              onChangeText={setTermValue}
            />
          </View>
          <View style={styles.rowItem}>
            <TextInput label="New rate (%)" placeholder="6.0" keyboardType="decimal-pad" value={rate} onChangeText={setRate} />
          </View>
        </View>

        <Typography variant="label" weight="semibold" style={styles.groupLabel}>
          Rate type
        </Typography>
        <FilterTabs tabs={RATE_TABS} activeTab={rateKind} onTabChange={setRateKind} showActiveIndicator={false} />

        <Typography variant="label" weight="semibold" style={styles.groupLabel}>
          Payment frequency
        </Typography>
        <FilterTabs
          tabs={FREQ_TABS}
          activeTab={frequency}
          onTabChange={(id) => setFrequency(id as MortgagePaymentFrequency)}
          showActiveIndicator={false}
        />

        {error ? (
          <Typography variant="caption" color={colors.error} style={styles.error}>
            {error}
          </Typography>
        ) : null}

        <Button title={saving ? 'Saving…' : 'Record renewal'} onPress={onSave} disabled={saving} />
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 140 },
  note: { padding: Spacing.base },
  row: { flexDirection: 'row', gap: Spacing.md },
  rowItem: { flex: 1 },
  groupLabel: { marginTop: Spacing.sm },
  error: { marginTop: Spacing.xs },
});
