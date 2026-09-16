import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { mortgageApi, type MortgageOffersView } from '@api/mortgage';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Button, Card, TextInput, Typography } from '@components/ui';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { formatMoney, useDisplayCurrency } from '@utils/money';

import { convertDurationValue, durationToMonths, type DurationUnit } from './duration';
import { DurationUnitToggle } from './DurationUnitToggle';

function fmtCents(cents: number): string {
  return formatMoney(cents);
}

/**
 * Renewal offer shopping — add offers from different banks and compare the
 * payment each implies against the incumbent (server-computed). Shortlist,
 * accept, or decline. Attacks the "auto-renew and leave money on the table"
 * problem (implementation plan §8).
 */
export function MortgageRenewalOffersScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<BudgetStackParamList, 'MortgageRenewalOffers'>>();
  const mortgageId = route.params?.mortgageId;
  const { currentHousehold } = useHouseholdStore();

  const [view, setView] = useState<MortgageOffersView | null>(null);
  const [bank, setBank] = useState('');
  const [rate, setRate] = useState('');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('years');
  const [termValue, setTermValue] = useState('5');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!currentHousehold?.id || !mortgageId) return;
    const v = await mortgageApi.listOffers(currentHousehold.id, mortgageId);
    setView(v);
  }, [currentHousehold?.id, mortgageId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onUnitChange = (next: DurationUnit) => {
    setTermValue((v) => convertDurationValue(v, durationUnit, next));
    setDurationUnit(next);
  };

  const addOffer = async () => {
    setError(null);
    const ratePct = parseFloat(rate);
    const termMonths = durationToMonths(termValue, durationUnit);
    if (!currentHousehold?.id || !mortgageId) return;
    if (!bank.trim()) return setError('Enter the bank name.');
    if (!(ratePct > 0)) return setError('Enter the offered rate.');
    if (!(termMonths > 0)) return setError('Enter the term length.');
    setBusy(true);
    try {
      await mortgageApi.addOffer(currentHousehold.id, mortgageId, {
        bankName: bank.trim(),
        offeredRateBps: Math.round(ratePct * 100),
        rateType: 'fixed',
        termMonths,
      });
      setBank('');
      setRate('');
      await load();
    } catch (e) {
      setError('Could not add the offer.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (offerId: string, status: 'shortlisted' | 'accepted' | 'declined') => {
    if (!currentHousehold?.id || !mortgageId) return;
    await mortgageApi.updateOffer(currentHousehold.id, mortgageId, offerId, { status });
    await load();
  };

  const remove = async (offerId: string) => {
    if (!currentHousehold?.id || !mortgageId) return;
    await mortgageApi.deleteOffer(currentHousehold.id, mortgageId, offerId);
    await load();
  };

  return (
    <AppBackground>
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScreenHeader title="Renewal offers" showBackButton onBackPress={() => navigation.goBack()} />
      <ScrollView
        {...keyboardDismissScrollProps}
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.body}
      >
        {view ? (
          <Card variant="filled" style={styles.card}>
            <Typography variant="caption" color={colors.textSecondary}>
              Your current payment
            </Typography>
            <Typography variant="title" weight="bold">
              {fmtCents(view.incumbentPaymentCents)} / month
            </Typography>
          </Card>
        ) : null}

        <Card variant="filled" style={styles.card}>
          <Typography variant="label" weight="semibold">
            Add an offer
          </Typography>
          <TextInput label="Bank" placeholder="RBC, Scotiabank…" value={bank} onChangeText={setBank} />
          <DurationUnitToggle label="Enter term in" unit={durationUnit} onChange={onUnitChange} />
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <TextInput label="Rate (%)" placeholder="4.5" keyboardType="decimal-pad" value={rate} onChangeText={setRate} />
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
          {error ? (
            <Typography variant="caption" color={colors.error}>
              {error}
            </Typography>
          ) : null}
          <Button title={busy ? 'Adding…' : 'Add offer'} onPress={addOffer} disabled={busy} />
        </Card>

        {view?.offers.map((o) => (
          <Card key={o.id} variant="filled" style={styles.card}>
            <View style={styles.offerHead}>
              <Typography variant="bodyLarge" weight="bold">
                {o.bankName} · {o.offeredRatePct}%
              </Typography>
              <Typography variant="caption" color={colors.textSecondary}>
                {o.status}
              </Typography>
            </View>
            <View style={styles.offerRow}>
              <Typography variant="caption" color={colors.textSecondary}>
                {fmtCents(o.monthlyPaymentCents)}/mo
              </Typography>
              <Typography
                variant="caption"
                weight="semibold"
                color={o.paymentSavedVsCurrentCents >= 0 ? colors.success : colors.error}
              >
                {o.paymentSavedVsCurrentCents >= 0 ? 'saves ' : 'costs '}
                {fmtCents(Math.abs(o.paymentSavedVsCurrentCents))}/mo
              </Typography>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => setStatus(o.id, 'shortlisted')}>
                <Typography variant="caption" color={colors.primary}>
                  Shortlist
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStatus(o.id, 'accepted')}>
                <Typography variant="caption" color={colors.success}>
                  Accept
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => remove(o.id)}>
                <Typography variant="caption" color={colors.error}>
                  Delete
                </Typography>
              </TouchableOpacity>
            </View>
          </Card>
        ))}

        {view && view.offers.length === 0 ? (
          <Typography variant="caption" color={colors.textSecondary} align="center">
            No offers yet. Add offers from a few banks to compare.
          </Typography>
        ) : null}
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 140 },
  card: { padding: Spacing.base, gap: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.md },
  rowItem: { flex: 1 },
  offerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  offerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.xs },
});
