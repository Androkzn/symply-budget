import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { savingsApi, type PensionOverview, type RegisteredAccountType } from '@api/savings';
import { Card, InstitutionLogo, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { usePensionStore } from '@stores/pensionStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  budgetCtaFill,
  budgetCtaOutline,
  budgetCtaTint,
  BUDGET_CTA_ROW_STYLES,
} from '../budgetCtaLayout';
import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { PensionProgressBar } from './PensionProgressBar';

const ACCOUNT_TYPE_LABEL: Record<RegisteredAccountType, string> = {
  tfsa: 'TFSA',
  rrsp: 'RRSP',
  fhsa: 'FHSA',
  dpsp: 'DPSP',
  rpp: 'Pension (RPP)',
};

/** DC workplace plans show a plan-cap "room", not personal contribution room. */
const DC_PLAN_TYPES: RegisteredAccountType[] = ['dpsp', 'rpp'];

/**
 * Pension → Accounts sub-view. Renders the BE-computed registered-account overview:
 * household totals, an over-contribution banner, and per-member account cards each
 * with a room bar (self/employer split) and a goal bar. THIN CLIENT — every figure
 * comes from `savingsApi.getRegisteredOverview`; this view does no money math.
 */
export function PensionAccountsView() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, dataRevision } = usePensionStore();

  const [overview, setOverview] = useState<PensionOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const data = await savingsApi.getRegisteredOverview(currentHousehold.id, selectedYear);
      setOverview(data);
    } catch (error) {
      console.error('Error loading pension overview:', error);
    }
  }, [currentHousehold?.id, selectedYear]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load])
  );

  React.useEffect(() => {
    if (dataRevision === 0) return;
    void load();
  }, [currentHousehold?.id, selectedYear, dataRevision, load]);

  const openManage = () => navigation.navigate('SavingsRegistered');
  const openImport = () => navigation.navigate('PensionImport');

  // Room-only placeholders (set on the Room tab) are not real accounts — hide them here.
  const visibleGroups = (overview?.groups ?? [])
    .map((group) => ({
      ...group,
      accounts: group.accounts.filter((s) => !s.account.is_room_only),
    }))
    .filter((group) => group.accounts.length > 0);

  const hasAccounts = visibleGroups.length > 0;

  return (
    <View testID="pension-accounts" style={styles.root}>
      {/* Action row — Add/Manage accounts + AI statement import. */}
      <View style={BUDGET_CTA_ROW_STYLES.addRow}>
        <TouchableOpacity
          onPress={openManage}
          activeOpacity={0.85}
          style={[BUDGET_CTA_ROW_STYLES.addCta, budgetCtaOutline(colors.primary)]}
          testID="pension-manage-accounts"
        >
          <Icon name="add" size={16} color={budgetCtaTint('outline', colors)} />
          <Typography variant="caption1" weight="semibold" color={budgetCtaTint('outline', colors)}>
            Add / manage
          </Typography>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={openImport}
          activeOpacity={0.85}
          style={[BUDGET_CTA_ROW_STYLES.addCta, budgetCtaFill(colors.primary)]}
          testID="pension-import-statement"
        >
          <Icon name="sparkles" size={16} color={budgetCtaTint('primary', colors)} />
          <Typography variant="caption1" weight="semibold" color={budgetCtaTint('primary', colors)}>
            Import statement (AI)
          </Typography>
        </TouchableOpacity>
      </View>

      {isLoading && !overview ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !hasAccounts ? (
        <View style={styles.empty}>
          <Icon name="shield-checkmark-outline" size={40} color={colors.textTertiary} />
          <Typography variant="body" weight="semibold" style={styles.emptyTitle}>
            Track your RRSP, TFSA & pensions
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.emptyBody}>
            Add an account to set contribution goals, watch your CRA room, and see employer
            matching — or import a statement and we'll fill it in.
          </Typography>
        </View>
      ) : (
        <>
          {/* Household totals */}
          {overview && <TotalsCard overview={overview} />}

          {/* Over-contribution banner */}
          {overview?.warnings.includes('ROOM_OVER_CONTRIBUTION') && (
            <View style={[styles.banner, { backgroundColor: colors.surfaceSelected }]}>
              <Icon name="warning-outline" size={18} color={colors.error} />
              <Typography variant="caption1" weight="semibold" color={colors.error}>
                One or more accounts are over their contribution room.
              </Typography>
            </View>
          )}

          {/* Accounts grouped by member */}
          {visibleGroups.map((group) => (
            <View key={group.memberId ?? 'household'} style={styles.group}>
              <Typography variant="caption1" weight="semibold" color={colors.textSecondary} style={styles.groupTitle}>
                {group.memberName ?? 'Household'} · {formatCurrency(group.totalBalanceCents)}
              </Typography>
              {group.accounts.map((summary) => (
                <PensionAccountCard
                  key={summary.account.id}
                  label={ACCOUNT_TYPE_LABEL[summary.account.account_type]}
                  institution={summary.account.institution}
                  employerName={summary.account.employer_name}
                  isDcPlan={DC_PLAN_TYPES.includes(summary.account.account_type)}
                  balanceCents={summary.account.balance_cents}
                  room={summary.room}
                  onPress={openManage}
                />
              ))}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function TotalsCard({ overview }: { overview: PensionOverview }) {
  const colors = useAppColors();
  const { totals } = overview;
  return (
    <Card variant="elevated" style={styles.totalsCard} testID="pension-totals">
      <Typography variant="caption1" color={colors.textSecondary}>
        Total balance
      </Typography>
      <Typography variant="title1" weight="bold">
        {formatCurrency(totals.totalBalanceCents)}
      </Typography>
      <View style={styles.totalsRow}>
        <View style={styles.totalItem}>
          <Typography variant="caption2" color={colors.textSecondary}>
            Room left
          </Typography>
          <Typography variant="subheadline" weight="semibold">
            {formatCurrency(totals.totalRoomRemainingCents)}
          </Typography>
        </View>
        <View style={styles.totalItem}>
          <Typography variant="caption2" color={colors.textSecondary}>
            You contributed
          </Typography>
          <Typography variant="subheadline" weight="semibold">
            {formatCurrency(totals.totalContributedSelfCents)}
          </Typography>
        </View>
        <View style={styles.totalItem}>
          <Typography variant="caption2" color={colors.textSecondary}>
            Employer
          </Typography>
          <Typography variant="subheadline" weight="semibold" color={colors.primary}>
            {formatCurrency(totals.totalContributedEmployerCents)}
          </Typography>
        </View>
      </View>
      {totals.goalCents > 0 && (
        <>
          <View style={styles.goalHeader}>
            <Typography variant="caption2" color={colors.textSecondary}>
              Annual goal progress
            </Typography>
            <Typography variant="caption2" weight="semibold">
              {formatCurrency(totals.goalContributedCents)} / {formatCurrency(totals.goalCents)} ({totals.goalPct}%)
            </Typography>
          </View>
          <PensionProgressBar fraction={totals.goalPct / 100} color={colors.primary} />
        </>
      )}
    </Card>
  );
}

interface PensionAccountCardProps {
  label: string;
  institution: string | null;
  employerName: string | null;
  isDcPlan: boolean;
  balanceCents: number;
  room: PensionOverview['groups'][number]['accounts'][number]['room'];
  onPress: () => void;
}

function PensionAccountCard({
  label,
  institution,
  employerName,
  isDcPlan,
  balanceCents,
  room,
  onPress,
}: PensionAccountCardProps) {
  const colors = useAppColors();
  const over = room.warnings.includes('ROOM_OVER_CONTRIBUTION');

  const denom = room.annualLimit > 0 ? room.annualLimit : Math.max(room.used, 1);
  const selfFrac = room.usedByContributor.self / denom;
  const employerFrac = room.usedByContributor.employer / denom;

  const goalFrac = room.goalCents && room.goalCents > 0 ? room.goalContributedCents / room.goalCents : 0;

  return (
    <Card
      variant="outlined"
      pressable
      onPress={onPress}
      style={styles.accountCard}
      testID="pension-account-card"
    >
      <View style={styles.accountHeader}>
        {institution ? <InstitutionLogo name={institution} size={32} /> : null}
        <View style={styles.flex}>
          <Typography variant="body" weight="semibold">
            {label}
            {institution ? ` · ${institution}` : ''}
          </Typography>
          {employerName ? (
            <Typography variant="caption2" color={colors.primary}>
              Workplace · {employerName}
            </Typography>
          ) : null}
        </View>
        <Typography variant="body" weight="semibold">
          {formatCurrency(balanceCents)}
        </Typography>
      </View>

      {/* Room bar with self (primary) + employer (skyBlue) split. */}
      <PensionProgressBar
        fraction={selfFrac}
        color={colors.primary}
        secondFraction={employerFrac}
        secondColor={colors.info}
        over={over}
      />
      <View style={styles.statsRow}>
        <Typography variant="caption2" color={colors.textSecondary}>
          {formatCurrency(room.used)} of {formatCurrency(room.annualLimit)}
          {isDcPlan ? ' (plan limit)' : ' room'} used
        </Typography>
        <Typography variant="caption2" weight="semibold" color={over ? colors.error : colors.success}>
          {formatCurrency(room.roomRemaining)} left
        </Typography>
      </View>

      {room.usedByContributor.employer > 0 && (
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            <Typography variant="caption2" color={colors.textSecondary}>
              You {formatCurrency(room.usedByContributor.self)}
            </Typography>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.info }]} />
            <Typography variant="caption2" color={colors.textSecondary}>
              Employer {formatCurrency(room.usedByContributor.employer)}
            </Typography>
          </View>
        </View>
      )}

      {/* Goal bar (when a goal is set). */}
      {room.goalCents != null && room.goalCents > 0 && (
        <View style={styles.goalBlock}>
          <View style={styles.goalHeader}>
            <Typography variant="caption2" color={colors.textSecondary}>
              Goal {formatCurrency(room.goalContributedCents)} / {formatCurrency(room.goalCents)}
            </Typography>
            <Typography variant="caption2" weight="semibold" color={colors.primary}>
              {room.goalPct}%
            </Typography>
          </View>
          <PensionProgressBar fraction={goalFrac} color={colors.success} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', alignSelf: 'stretch', gap: Spacing.base },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  empty: { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { marginTop: Spacing.sm },
  emptyBody: { textAlign: 'center', paddingHorizontal: Spacing.lg },
  totalsCard: { gap: Spacing.xs, padding: Spacing.base },
  totalsRow: { flexDirection: 'row', marginTop: Spacing.sm, gap: Spacing.md },
  totalItem: { flex: 1, gap: 2 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
  },
  group: { gap: Spacing.sm },
  groupTitle: { marginTop: Spacing.xs },
  accountCard: { gap: Spacing.sm, padding: Spacing.base },
  accountHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  flex: { flex: 1 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  legendRow: { flexDirection: 'row', gap: Spacing.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  goalBlock: { gap: Spacing.xs, marginTop: Spacing.xs },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
