import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { mortgageApi, type AddEventRequest, type MortgageEventType } from '@api/mortgage';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Button, FilterTabs, TextInput, Typography, type FilterTab } from '@components/ui';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useMortgageStore } from '@stores/mortgageStore';
import { Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { DateField } from './DateField';

type ChangeType = Extract<MortgageEventType, 'rate_change' | 'payment_increase' | 'lump_sum_prepayment'>;

const TYPE_TABS: FilterTab[] = [
  { id: 'rate_change', label: 'Rate' },
  { id: 'payment_increase', label: 'Payment' },
  { id: 'lump_sum_prepayment', label: 'Prepayment' },
];

const FIELD: Record<ChangeType, { label: string; placeholder: string; hint: string }> = {
  rate_change: { label: 'New rate (%)', placeholder: '4.14', hint: 'Your new annual interest rate.' },
  payment_increase: { label: 'New payment ($)', placeholder: '2875.46', hint: 'Your new regular payment amount.' },
  lump_sum_prepayment: {
    label: 'Prepayment amount ($)',
    placeholder: '10000',
    hint: 'A one-time amount paid against the principal.',
  },
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Record a dated change to the mortgage — a rate change, a payment change or a
 * lump-sum prepayment — into the change ledger (`mortgage_events`). It appears on
 * the History timeline. (Renewals, which re-amortize the balance, have their own
 * flow: MortgageRenewalScreen.)
 */
export function MortgageRecordChangeScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<BudgetStackParamList, 'MortgageRecordChange'>>();
  const mortgageId = route.params?.mortgageId;
  const { currentHousehold } = useHouseholdStore();
  const markDirty = useMortgageStore((s) => s.markDirty);

  const [changeType, setChangeType] = useState<ChangeType>('rate_change');
  const [eventDate, setEventDate] = useState(todayISO());
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const field = FIELD[changeType];

  const onSave = async () => {
    setError(null);
    const num = parseFloat(value);
    if (!currentHousehold?.id || !mortgageId) return setError('Missing mortgage.');
    if (!(num > 0)) return setError(`Enter a valid ${field.label.toLowerCase()}.`);

    const body: AddEventRequest = { eventType: changeType, eventDate, note: note.trim() || null };
    if (changeType === 'rate_change') body.newRateBps = Math.round(num * 100);
    else if (changeType === 'payment_increase') body.newPaymentCents = Math.round(num * 100);
    else body.amountCents = Math.round(num * 100);

    setSaving(true);
    try {
      await mortgageApi.addEvent(currentHousehold.id, mortgageId, body);
      markDirty();
      navigation.goBack();
    } catch {
      setError('Could not record the change. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppBackground>
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScreenHeader title="Record a change" showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView
        {...keyboardDismissScrollProps}
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.body}
      >
        <Typography variant="label" weight="semibold" style={styles.groupLabel}>
          What changed?
        </Typography>
        <FilterTabs
          tabs={TYPE_TABS}
          activeTab={changeType}
          onTabChange={(id) => {
            setChangeType(id as ChangeType);
            setValue('');
          }}
          showActiveIndicator={false}
        />

        <DateField label="Date of change" value={eventDate} onChange={setEventDate} testID="mortgage-change-date" />

        <TextInput
          label={field.label}
          placeholder={field.placeholder}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={setValue}
          testID="mortgage-change-value"
        />
        <Typography variant="caption" color={colors.textSecondary}>
          {field.hint}
        </Typography>

        <TextInput
          label="Note (optional)"
          placeholder="e.g. TD renewal offer"
          value={note}
          onChangeText={setNote}
          testID="mortgage-change-note"
        />

        {error ? (
          <Typography variant="caption" color={colors.error} style={styles.error}>
            {error}
          </Typography>
        ) : null}

        <Button title={saving ? 'Saving…' : 'Save change'} onPress={onSave} disabled={saving} testID="mortgage-change-save" />
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 140 },
  groupLabel: { marginTop: Spacing.sm },
  error: { marginTop: Spacing.xs },
});
