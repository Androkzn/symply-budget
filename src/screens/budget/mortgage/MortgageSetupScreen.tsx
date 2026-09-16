import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { mortgageApi, type CreateMortgageRequest, type MortgagePaymentFrequency } from '@api/mortgage';
import { AppBackground, HeaderActionButton, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Button, FilterTabs, TextInput, Typography, type FilterTab } from '@components/ui';
import { type Compounding } from '@features/mortgage/amortization';
import { useHouseholdStore } from '@stores/householdStore';
import { useMortgageStore } from '@stores/mortgageStore';
import { Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { DateField } from './DateField';
import { convertDurationValue, durationToMonths, type DurationUnit } from './duration';
import { DurationUnitToggle } from './DurationUnitToggle';
import { LenderPicker } from './LenderPicker';

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
 * Mortgage setup wizard — collects the initial conditions and creates the
 * mortgage + its first term. The user enters figures from their own mortgage
 * documents (no client-side payment estimate); once saved, every figure comes
 * from the server.
 */
export function MortgageSetupScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();
  const { currentHousehold } = useHouseholdStore();
  const markDirty = useMortgageStore((s) => s.markDirty);
  const setSelectedMortgage = useMortgageStore((s) => s.setSelectedMortgage);

  const [nickname, setNickname] = useState('');
  const [lender, setLender] = useState('');
  const [amount, setAmount] = useState('');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('years');
  const [amortValue, setAmortValue] = useState('25');
  const [startDate, setStartDate] = useState(todayISO());
  const [rate, setRate] = useState('');
  const [termValue, setTermValue] = useState('5');
  const [rateKind, setRateKind] = useState('fixed');
  const [frequency, setFrequency] = useState<MortgagePaymentFrequency>('monthly');
  const [payment, setPayment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const compounding: Compounding = rateKind === 'fixed' ? 'semi_annual' : 'monthly';

  // Flip both duration fields to the new unit, preserving the real durations.
  const onUnitChange = (next: DurationUnit) => {
    setAmortValue((v) => convertDurationValue(v, durationUnit, next));
    setTermValue((v) => convertDurationValue(v, durationUnit, next));
    setDurationUnit(next);
  };

  const onSave = async () => {
    setError(null);
    const principal = parseFloat(amount);
    const amortMonths = durationToMonths(amortValue, durationUnit);
    const ratePct = parseFloat(rate);
    const termMonths = durationToMonths(termValue, durationUnit);
    const paymentAmt = parseFloat(payment);
    if (!nickname.trim()) return setError('Give your mortgage a name.');
    if (!(principal > 0)) return setError('Enter the original principal amount.');
    if (!(amortMonths > 0)) return setError(`Enter the amortization in ${durationUnit}.`);
    if (!(ratePct > 0)) return setError('Enter the interest rate.');
    if (!(termMonths > 0)) return setError(`Enter the term length in ${durationUnit}.`);
    if (!(paymentAmt > 0)) return setError('Enter your regular payment amount.');
    if (!currentHousehold?.id) return setError('No household selected.');

    const body: CreateMortgageRequest = {
      nickname: nickname.trim(),
      lender: lender.trim() || null,
      originalPrincipalCents: Math.round(principal * 100),
      originalAmortizationMonths: amortMonths,
      startDate,
      rateType: rateKind === 'fixed' ? 'fixed' : 'variable_arm',
      compounding,
      nominalRateBps: Math.round(ratePct * 100),
      termMonths,
      paymentFrequency: frequency,
      scheduledPaymentCents: Math.round(paymentAmt * 100),
    };

    setSaving(true);
    try {
      const created = await mortgageApi.create(currentHousehold.id, body);
      setSelectedMortgage(created.id);
      markDirty();
      navigation.goBack();
    } catch {
      setError('Could not save your mortgage. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppBackground>
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScreenHeader
        title="Set up mortgage"
        showBackButton
        onBackPress={() => navigation.goBack()}
        rightElement={
          <HeaderActionButton
            label={saving ? 'Saving…' : 'Save'}
            onPress={onSave}
            disabled={saving}
            testID="mortgage-setup-save"
          />
        }
      />
      <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.body}
        {...keyboardDismissScrollProps}
        keyboardDismissMode="on-drag"
      >
        {/* Core loan figures first — these are the REQUIRED inputs, kept together at the
            top so the whole set is reachable without scrolling. The numeric keypad has no
            dismiss affordance and iOS-26 RN New-Arch does not scroll this ScrollView
            reliably, so any required field below the fold becomes unfillable (in E2E and
            for a real user on a small device). */}
        <TextInput label="Mortgage name" placeholder="Main home" value={nickname} onChangeText={setNickname} />
        <TextInput
          label="Original principal ($)"
          placeholder="500000"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />
        <TextInput
          label="Annual interest rate (%)"
          placeholder="5.0"
          keyboardType="decimal-pad"
          value={rate}
          onChangeText={setRate}
        />
        <View style={styles.paymentField}>
          <TextInput
            label="Principal & interest payment ($)"
            placeholder="2875.46"
            keyboardType="decimal-pad"
            value={payment}
            onChangeText={setPayment}
            testID="mortgage-setup-payment"
          />
          <Typography variant="caption" color={colors.textSecondary}>
            Enter the regular payment from your mortgage documents.
          </Typography>
        </View>

        {/* Details & options below — lender is optional; duration/term, start date and
            the rate-type / frequency selectors all carry sensible defaults. */}
        <LenderPicker value={lender} onChange={setLender} testID="mortgage-setup-lender" />
        <DurationUnitToggle label="Enter duration in" unit={durationUnit} onChange={onUnitChange} />
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <TextInput
              label="Amortization period"
              keyboardType="decimal-pad"
              value={amortValue}
              onChangeText={setAmortValue}
            />
          </View>
          <View style={styles.rowItem}>
            <TextInput
              label="Term"
              keyboardType="decimal-pad"
              value={termValue}
              onChangeText={setTermValue}
            />
          </View>
        </View>
        <DateField label="Start date" value={startDate} onChange={setStartDate} testID="mortgage-setup-start-date" />

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

        <Button title={saving ? 'Saving…' : 'Save mortgage'} onPress={onSave} disabled={saving} />
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 140 },
  row: { flexDirection: 'row', gap: Spacing.md },
  rowItem: { flex: 1 },
  groupLabel: { marginTop: Spacing.sm },
  paymentField: { gap: Spacing.xs },
  error: { marginTop: Spacing.xs },
});
