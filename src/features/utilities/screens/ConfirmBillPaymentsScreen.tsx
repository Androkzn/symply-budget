import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, FlatList, Alert } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { Typography, Card, GradientButton } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { utilitiesApi, type UtilityBill } from '@features/utilities/api/utilities';
import { ProviderLogo } from '@features/utilities/components/ProviderLogo';
import { getBillTypeIonicon } from '@features/utilities/providers/bill-providers';
import { hasProviderLogo } from '@features/utilities/providers/provider-logos';
import type { UtilitiesStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { parseLocalDateOnly } from '@utils/localDate';
import { formatMoney, useDisplayCurrency } from '@utils/money';

type ConfirmBillPaymentsNavigationProp = NativeStackNavigationProp<
  UtilitiesStackParamList,
  'ConfirmBillPayments'
>;

function formatCurrency(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

function formatDate(dateString: string): string {
  // parseLocalDateOnly keeps date-only strings from rendering one day early west
  // of GMT (new Date('2026-07-14') is UTC midnight).
  const date = parseLocalDateOnly(dateString);
  return Number.isNaN(date.getTime())
    ? dateString
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function billTitle(bill: UtilityBill): string {
  return bill.provider || bill.bill_type.charAt(0).toUpperCase() + bill.bill_type.slice(1);
}

/**
 * Post-import confirmation: the user just imported several bills and now
 * declares which are already paid. Rows seed from each bill's real status
 * (fresh imports arrive unpaid), and every bill left Unpaid keeps a "Pay bill"
 * task on the backend. Supports both per-row toggling and multi-select bulk
 * marking so confirming a large batch is quick.
 */
export function ConfirmBillPaymentsScreen() {
  // Re-render amounts when Settings → Currency changes.
  const displayCurrency = useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<ConfirmBillPaymentsNavigationProp>();
  const route = useRoute<RouteProp<UtilitiesStackParamList, 'ConfirmBillPayments'>>();
  const { currentHousehold } = useHouseholdStore();

  const bills = useMemo(() => route.params?.bills ?? [], [route.params?.bills]);

  // billId → paid?  Seeded from each bill's real status (auto-created imports
  // arrive unpaid; a bill the user already marked paid stays paid).
  const [paidMap, setPaidMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(bills.map((b) => [b.id, !!b.paid_date]))
  );
  // billId → selected for bulk actions
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  const selectedIds = useMemo(
    () => bills.filter((b) => selected[b.id]).map((b) => b.id),
    [bills, selected]
  );
  const allSelected = bills.length > 0 && selectedIds.length === bills.length;
  const paidCount = bills.filter((b) => paidMap[b.id]).length;
  const unpaidCount = bills.length - paidCount;

  const toggleSelect = (id: string) =>
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected({});
    } else {
      setSelected(Object.fromEntries(bills.map((b) => [b.id, true])));
    }
  };

  const togglePaid = (id: string) =>
    setPaidMap((prev) => ({ ...prev, [id]: !prev[id] }));

  const markSelected = (paid: boolean) => {
    if (selectedIds.length === 0) return;
    setPaidMap((prev) => {
      const next = { ...prev };
      selectedIds.forEach((id) => {
        next[id] = paid;
      });
      return next;
    });
    setSelected({});
  };

  // Persist the paid/unpaid choices, then leave. This is the moment the backend
  // creates a "Pay bill" task for each bill left Unpaid (imported bills defer
  // task creation to here), so it must run whether the user taps Done or just
  // backs out — otherwise dismissing would leave unpaid bills with no task.
  const persistAndExit = async () => {
    if (!currentHousehold?.id || bills.length === 0) {
      navigation.popToTop();
      return;
    }
    if (isSaving) return;
    setIsSaving(true);
    try {
      await utilitiesApi.setBillsPaidStatus(
        currentHousehold.id,
        bills.map((b) => ({ billId: b.id, paid: !!paidMap[b.id] }))
      );
      navigation.popToTop();
    } catch (error) {
      console.error('Error saving bill payment statuses:', error);
      Alert.alert('Error', 'Could not save payment statuses. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = persistAndExit;

  const renderItem = ({ item }: { item: UtilityBill }) => {
    const isPaid = !!paidMap[item.id];
    const isSelected = !!selected[item.id];
    const hasLogo = hasProviderLogo(undefined, item.provider);

    return (
      <View style={[styles.row, { backgroundColor: colors.cardBackground, borderColor: colors.borderColor }]}>
        {/* Selection checkbox */}
        <TouchableOpacity
          onPress={() => toggleSelect(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
          style={[
            styles.checkbox,
            {
              backgroundColor: isSelected ? colors.primary : 'transparent',
              borderColor: isSelected ? colors.primary : colors.borderColor,
            },
          ]}
        >
          {isSelected && <Icon name="checkmark" size={16} color={colors.white} />}
        </TouchableOpacity>

        <ProviderLogo
          providerName={item.provider}
          fallbackIcon={getBillTypeIonicon(item.bill_type)}
          size={36}
          logoWidth={72}
        />

        <View style={styles.rowInfo}>
          {!hasLogo && (
            <Typography variant="body" weight="semibold" numberOfLines={1}>
              {billTitle(item)}
            </Typography>
          )}
          <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
            {/* Once marked paid the "Paid" pill on the right says it all — a due
                date is only meaningful while the bill is still outstanding. */}
            {isPaid
              ? formatCurrency(item.amount)
              : `${formatCurrency(item.amount)} · Due ${formatDate(item.due_date)}`}
          </Typography>
        </View>

        {/* Paid / Unpaid pill toggle */}
        <TouchableOpacity
          onPress={() => togglePaid(item.id)}
          activeOpacity={0.8}
          style={[
            styles.pill,
            isPaid
              ? { backgroundColor: colors.success }
              : { backgroundColor: 'transparent', borderColor: colors.borderColor, borderWidth: 1 },
          ]}
        >
          <Icon
            name={isPaid ? 'checkmark-circle' : 'time-outline'}
            size={14}
            color={isPaid ? colors.white : colors.textSecondary}
          />
          <Typography
            variant="caption1"
            weight="semibold"
            color={isPaid ? colors.white : colors.textSecondary}
          >
            {isPaid ? 'Paid' : 'Unpaid'}
          </Typography>
        </TouchableOpacity>
      </View>
    );
  };

  const listHeader = (
    <View>
      <Card variant="elevated" style={styles.introCard}>
        <Typography variant="title3" weight="semibold" color={colors.textPrimary}>
          Confirm payment status
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.introText}>
          {bills.length} bill{bills.length === 1 ? '' : 's'} imported. Mark the ones you've already
          paid — each bill left as Unpaid gets a “Pay bill” task with its due date.
        </Typography>
      </Card>

      {/* Bulk selection toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          onPress={toggleSelectAll}
          activeOpacity={0.7}
          style={styles.selectAll}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View
            style={[
              styles.checkbox,
              {
                backgroundColor: allSelected ? colors.primary : 'transparent',
                borderColor: allSelected ? colors.primary : colors.borderColor,
              },
            ]}
          >
            {allSelected && <Icon name="checkmark" size={16} color={colors.white} />}
          </View>
          <Typography variant="caption1" weight="medium" color={colors.textPrimary}>
            {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Select all'}
          </Typography>
        </TouchableOpacity>

        {selectedIds.length > 0 && (
          <View style={styles.bulkActions}>
            <TouchableOpacity
              onPress={() => markSelected(true)}
              activeOpacity={0.8}
              style={[styles.bulkBtn, { backgroundColor: colors.success + '1A' }]}
            >
              <Typography variant="caption1" weight="semibold" color={colors.success}>
                Mark Paid
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => markSelected(false)}
              activeOpacity={0.8}
              style={[styles.bulkBtn, { backgroundColor: colors.secondaryButtonBackground }]}
            >
              <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                Mark Unpaid
              </Typography>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Confirm Payments"
        showBackButton
        onBackPress={persistAndExit}
        showAvatar={false}
        showNotificationBell={false}
        showPropertySwitcher={false}
      />
      <FlatList
        data={bills}
        keyExtractor={(b) => b.id}
        renderItem={renderItem}
        extraData={displayCurrency}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.content}
        style={styles.list}
        showsVerticalScrollIndicator={false}
      />
      <View style={[styles.footer, { borderTopColor: colors.borderColor, backgroundColor: colors.cardBackground }]}>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.footerSummary}>
          {paidCount} paid · {unpaidCount} unpaid
          {unpaidCount > 0
            ? ` · reminder task${unpaidCount === 1 ? '' : 's'} for the unpaid`
            : ''}
        </Typography>
        <GradientButton
          title={isSaving ? 'Saving…' : 'Done'}
          onPress={handleSave}
          disabled={isSaving}
          fullWidth
        />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Spacing.md,
  },
  introCard: {
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  introText: {
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    minHeight: 32,
  },
  selectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bulkActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  bulkBtn: {
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.full,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
    padding: Spacing.smd,
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: CornerRadius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.full,
  },
  footer: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    paddingBottom: Layout.bottomTabBarClearance,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerSummary: {
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
});
