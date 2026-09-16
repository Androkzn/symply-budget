import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRoute, useNavigation, useFocusEffect, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { Typography, Card, GradientButton } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { utilitiesApi, type UtilityBill, type ExtractedBillData } from '@features/utilities/api/utilities';
import type { UtilitiesStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { parseLocalDateOnly } from '@utils/localDate';
import { formatMoney, formatMoneyUnits, useDisplayCurrency } from '@utils/money';

// Format a plain dollar number (already in dollars, not cents)
function formatDollars(amount: number): string {
  return formatMoneyUnits(amount, { decimals: 2 });
}

function parseExtracted(raw: string | null): ExtractedBillData | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExtractedBillData;
  } catch {
    return null;
  }
}

type UtilityDetailScreenNavigationProp = NativeStackNavigationProp<UtilitiesStackParamList>;

// Format currency from cents
function formatCurrency(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

// Format date. parseLocalDateOnly keeps date-only strings from rendering one day
// early west of GMT (new Date('2026-07-14') is UTC midnight).
function formatDate(dateString: string): string {
  return parseLocalDateOnly(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function UtilityDetailScreen() {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<UtilityDetailScreenNavigationProp>();
  const route = useRoute<RouteProp<UtilitiesStackParamList, 'UtilityDetail'>>();
  const { currentHousehold } = useHouseholdStore();
  const [bill, setBill] = useState<UtilityBill | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const billId = route.params?.billId;

  const extracted = useMemo(() => parseExtracted(bill?.ai_extracted_data ?? null), [bill]);
  const lineItems = extracted?.lineItems ?? [];
  const taxes = extracted?.taxes ?? [];
  const meterReadings = extracted?.meterReadings ?? [];

  const loadBill = useCallback(async () => {
    // This early-returned BEFORE the try/finally, so `setIsLoading(false)`
    // never ran and the screen spun forever with no way out but the back
    // button — the exact state a member hits when the route is opened without
    // a billId, or before a household is selected. Clear the flag first, then
    // bail: no household and no bill is "not found", not "still loading".
    if (!currentHousehold?.id || !billId) {
      setIsLoading(false);
      return;
    }

    try {
      const bills = await utilitiesApi.getBills(currentHousehold.id);
      const foundBill = bills.find((b) => b.id === billId);
      setBill(foundBill || null);
    } catch (error) {
      console.error('Error loading bill:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id, billId]);

  // Reload on focus so edits made on the edit screen show when we return here.
  useFocusEffect(
    useCallback(() => {
      loadBill();
    }, [loadBill])
  );

  const handleEdit = () => {
    if (!bill) return;
    navigation.navigate('AddUtilityBill', { billId: bill.id });
  };

  const handleDelete = () => {
    if (!currentHousehold?.id || !bill) return;
    Alert.alert('Delete Bill', 'Are you sure you want to delete this bill? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await utilitiesApi.deleteBill(currentHousehold.id, bill.id);
            navigation.goBack();
          } catch (error) {
            console.error('Error deleting bill:', error);
            Alert.alert('Error', 'Failed to delete bill');
          }
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader showBackButton onBackPress={() => navigation.goBack()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (!bill) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader showBackButton onBackPress={() => navigation.goBack()} />
        <View style={styles.emptyContainer}>
          <Typography variant="body" color={colors.textSecondary}>
            Bill not found
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const isPaid = bill.paid_date !== null;
  const detailRowStyle = [styles.detailRow, { borderBottomColor: colors.divider }];

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        showBackButton
        onBackPress={() => navigation.goBack()}
        rightElement={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={handleEdit}
              style={styles.headerActionButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Edit bill"
            >
              <Icon name="create-outline" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleDelete}
              style={styles.headerActionButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Delete bill"
            >
              <Icon name="trash-outline" size={22} color={colors.error} />
            </TouchableOpacity>
          </View>
        }
      />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card variant="filled" style={styles.billCard}>
          <Typography variant="headline" weight="semibold" style={styles.billTitle}>
            {bill.provider || bill.bill_type.charAt(0).toUpperCase() + bill.bill_type.slice(1)}
          </Typography>
          <Typography variant="title1" weight="bold" color={colors.primary} style={styles.billAmount}>
            {formatCurrency(bill.amount)}
          </Typography>
          {isPaid && (
            <View style={[styles.paidBadge, { backgroundColor: colors.success + '1A' }]}>
              <Icon name="checkmark-circle" size={16} color={colors.success} />
              <Typography variant="caption1" color={colors.success} weight="semibold">
                Paid on {formatDate(bill.paid_date!)}
              </Typography>
            </View>
          )}
        </Card>

        <Card variant="filled" style={styles.detailsCard}>
          <Typography variant="title3" weight="semibold" style={styles.sectionTitle}>
            Bill Details
          </Typography>

          <View style={detailRowStyle}>
            <Typography variant="body" color={colors.textSecondary}>
              Billing Period
            </Typography>
            <Typography variant="body" weight="medium">
              {formatDate(bill.billing_period_start)} - {formatDate(bill.billing_period_end)}
            </Typography>
          </View>

          <View style={detailRowStyle}>
            <Typography variant="body" color={colors.textSecondary}>
              Due Date
            </Typography>
            <Typography variant="body" weight="medium">
              {formatDate(bill.due_date)}
            </Typography>
          </View>

          {bill.account_number && (
            <View style={detailRowStyle}>
              <Typography variant="body" color={colors.textSecondary}>
                Account Number
              </Typography>
              <Typography variant="body" weight="medium">
                {bill.account_number}
              </Typography>
            </View>
          )}

          {/* `!= null`, not truthiness — see PropertyTaxScreen: a zero-usage
              bill (a credit, or a period with no consumption) rendered the
              bare number 0 into a <View> and crashed the screen. */}
          {bill.usage_quantity != null && (
            <View style={detailRowStyle}>
              <Typography variant="body" color={colors.textSecondary}>
                Usage
              </Typography>
              <Typography variant="body" weight="medium">
                {bill.usage_quantity} {bill.usage_unit || ''}
              </Typography>
            </View>
          )}

          {extracted?.usage?.averageDailyCost != null && (
            <View style={detailRowStyle}>
              <Typography variant="body" color={colors.textSecondary}>
                Avg Daily Cost
              </Typography>
              <Typography variant="body" weight="medium">
                {formatDollars(extracted.usage.averageDailyCost)}
              </Typography>
            </View>
          )}

          {extracted?.account?.invoiceNumber && (
            <View style={detailRowStyle}>
              <Typography variant="body" color={colors.textSecondary}>
                Invoice Number
              </Typography>
              <Typography variant="body" weight="medium">
                {extracted.account.invoiceNumber}
              </Typography>
            </View>
          )}
        </Card>

        {/* Charge breakdown (from AI extraction) */}
        {(lineItems.length > 0 || taxes.length > 0) && (
          <Card variant="filled" style={styles.detailsCard}>
            <Typography variant="title3" weight="semibold" style={styles.sectionTitle}>
              Charge Breakdown
            </Typography>
            {lineItems.map((item, i) => (
              <View key={`li-${i}`} style={detailRowStyle}>
                <View style={styles.lineItemLabel}>
                  <Typography variant="body" color={colors.textPrimary}>
                    {item.description}
                  </Typography>
                  {item.quantity != null && item.rate != null && (
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {item.quantity} {item.unit || ''} × {formatDollars(item.rate)}
                    </Typography>
                  )}
                </View>
                <Typography variant="body" weight="medium">
                  {formatDollars(item.amount)}
                </Typography>
              </View>
            ))}
            {taxes.map((tax, i) => (
              <View key={`tax-${i}`} style={detailRowStyle}>
                <Typography variant="body" color={colors.textSecondary}>
                  {tax.description}
                </Typography>
                <Typography variant="body" weight="medium">
                  {formatDollars(tax.amount)}
                </Typography>
              </View>
            ))}
          </Card>
        )}

        {/* Meter readings (from AI extraction) */}
        {meterReadings.length > 0 && (
          <Card variant="filled" style={styles.detailsCard}>
            <Typography variant="title3" weight="semibold" style={styles.sectionTitle}>
              Meter Readings
            </Typography>
            {meterReadings.map((m, i) => (
              <View key={`mr-${i}`} style={styles.meterBlock}>
                {m.meterNumber && (
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Meter {m.meterNumber}
                  </Typography>
                )}
                <View style={detailRowStyle}>
                  <Typography variant="body" color={colors.textSecondary}>
                    Previous
                  </Typography>
                  <Typography variant="body" weight="medium">
                    {m.previousReading ?? '—'}
                    {m.previousReadingDate ? ` (${formatDate(m.previousReadingDate)})` : ''}
                  </Typography>
                </View>
                <View style={detailRowStyle}>
                  <Typography variant="body" color={colors.textSecondary}>
                    Current
                  </Typography>
                  <Typography variant="body" weight="medium">
                    {m.currentReading ?? '—'}
                    {m.currentReadingDate ? ` (${formatDate(m.currentReadingDate)})` : ''}
                  </Typography>
                </View>
                {m.consumption != null && (
                  <View style={detailRowStyle}>
                    <Typography variant="body" color={colors.textSecondary}>
                      Consumption
                    </Typography>
                    <Typography variant="body" weight="medium">
                      {m.consumption} {m.unit || ''}
                    </Typography>
                  </View>
                )}
              </View>
            ))}
          </Card>
        )}

        {!isPaid && (
          <GradientButton
            onPress={() => {
              // Mark as paid
              if (currentHousehold?.id) {
                utilitiesApi
                  .updateBill(currentHousehold.id, bill.id, {
                    paidDate: new Date().toISOString().split('T')[0],
                    paidAmount: bill.amount,
                  })
                  .then(() => {
                    navigation.goBack();
                  })
                  .catch((err) => console.error('Error updating bill:', err));
              }
            }}
            style={styles.payButton}
            title="Mark as Paid"
            fullWidth
          />
        )}
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  billCard: {
    padding: Spacing.xl,
    marginBottom: Spacing.base,
    alignItems: 'center',
  },
  billTitle: {
    marginBottom: Spacing.sm,
  },
  billAmount: {
    marginBottom: Spacing.md,
  },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + Spacing.xxs,
    borderRadius: CornerRadius.sm,
  },
  detailsCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.base,
  },
  sectionTitle: {
    marginBottom: Spacing.base,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lineItemLabel: {
    flex: 1,
    paddingRight: Spacing.md,
  },
  meterBlock: {
    marginBottom: Spacing.sm,
  },
  payButton: {
    marginTop: Spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerActionButton: {
    padding: Spacing.xs,
  },
});
