import { useFocusEffect } from "expo-router/react-navigation";
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import { savingsApi, type PensionOverview, type RegisteredAccountType } from '@api/savings';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useHouseholdStore } from '@stores/householdStore';
import { usePensionStore } from '@stores/pensionStore';
import { Spacing, useAppColors } from '@theme';

import {
  budgetCtaFill,
  budgetCtaOutline,
  budgetCtaTint,
  BUDGET_CTA_ROW_STYLES,
} from '../budgetCtaLayout';
import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { PensionBackfillSheet, type PensionBackfillInitial } from './PensionBackfillSheet';
import { PensionEntrySheet, type PensionEntryInitial, type PensionEntryMode } from './PensionEntrySheet';
import { pensionLines, pensionMemberIdentities, showsMemberOnRows } from './pensionScope';

const TYPE_LABEL: Record<RegisteredAccountType, string> = {
  tfsa: 'TFSA',
  rrsp: 'RRSP',
  fhsa: 'FHSA',
  dpsp: 'DPSP',
  rpp: 'Pension (RPP)',
};

/**
 * Pension → Contributions sub-view. Add manual contributions and set up automated
 * recurring monthly contributions (with employer match) — no account. Shows what each
 * member has contributed this year + their recurring setup. Self-contained (no Accounts).
 */
export function PensionContributionsView() {
  const colors = useAppColors();
  const { currentHousehold, currentHouseholdMembers } = useHouseholdStore();
  const { selectedYear, selectedMemberId, dataRevision, markDirty, setMemberGroups } =
    usePensionStore();

  const [overview, setOverview] = useState<PensionOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState<PensionEntryMode>('contribution');
  const [initial, setInitial] = useState<PensionEntryInitial | undefined>(undefined);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillInitial, setBackfillInitial] = useState<PensionBackfillInitial | undefined>(undefined);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const next = await savingsApi.getRegisteredOverview(currentHousehold.id, selectedYear);
      setOverview(next);
      setMemberGroups(pensionMemberIdentities(next));
    } catch (error) {
      console.error('Error loading pension contributions:', error);
    }
  }, [currentHousehold?.id, selectedYear, setMemberGroups]);

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

  const lines = pensionLines(overview, selectedMemberId).filter(
    (a) =>
      a.room.usedByContributor.self > 0 ||
      a.room.usedByContributor.employer > 0 ||
      (a.account.regular_contribution_cents ?? 0) > 0 ||
      (a.account.employer_match_cents ?? 0) > 0
  );
  const showMember = showsMemberOnRows(selectedMemberId);

  const open = (m: PensionEntryMode, init?: PensionEntryInitial) => {
    setMode(m);
    // Scoped to a member, an "Add" with no row context still means THEM.
    setInitial(init ?? (selectedMemberId ? { memberId: selectedMemberId } : undefined));
    setSheetOpen(true);
  };

  const openBackfill = (init: PensionBackfillInitial) => {
    setBackfillInitial(init);
    setBackfillOpen(true);
  };

  const confirmDelete = (memberId: string | null, type: 'tfsa' | 'rrsp', label: string) => {
    if (!currentHousehold?.id || !memberId) return;
    Alert.alert(
      `Delete ${label} contributions?`,
      `This removes ${selectedYear}'s recorded contributions and turns off recurring automation for this account. Room and goal stay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await savingsApi.deleteMemberContributions(currentHousehold.id, {
                member_id: memberId,
                account_type: type,
                year: selectedYear,
              });
              markDirty();
            } catch (error) {
              console.error('Error deleting pension contributions:', error);
              Alert.alert('Error', 'Could not delete these contributions. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <View testID="pension-contributions" style={styles.root}>
      <View style={BUDGET_CTA_ROW_STYLES.addRow}>
        <TouchableOpacity
          onPress={() => open('contribution')}
          activeOpacity={0.85}
          style={[BUDGET_CTA_ROW_STYLES.addCta, budgetCtaFill(colors.primary)]}
          testID="pension-contribution-add"
        >
          <Icon name="add" size={16} color={budgetCtaTint('primary', colors)} />
          <Typography variant="caption1" weight="semibold" color={budgetCtaTint('primary', colors)}>
            Add contribution
          </Typography>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => open('recurring')}
          activeOpacity={0.85}
          style={[BUDGET_CTA_ROW_STYLES.addCta, budgetCtaOutline(colors.primary)]}
          testID="pension-recurring-add"
        >
          <Icon name="repeat" size={16} color={budgetCtaTint('outline', colors)} />
          <Typography variant="caption1" weight="semibold" color={budgetCtaTint('outline', colors)}>
            Set up recurring
          </Typography>
        </TouchableOpacity>
      </View>

      {isLoading && !overview ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : lines.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="cash-outline" size={38} color={colors.textTertiary} />
          <Typography variant="caption1" color={colors.textSecondary} style={styles.emptyBody}>
            Add a one-off contribution, or set up an automated monthly amount (with employer
            match) — we'll record it every month for you.
          </Typography>
        </View>
      ) : (
        lines.map((line) => {
          const { account, room, memberName, memberId } = line;
          const recurringSelf = account.regular_contribution_cents ?? 0;
          const recurringEmployer = account.employer_match_cents ?? 0;
          const hasRecurring = recurringSelf > 0 || recurringEmployer > 0;
          const type = account.account_type === 'tfsa' ? 'tfsa' : 'rrsp';
          const contributedSelf = room.usedByContributor.self;
          const contributedEmployer = room.usedByContributor.employer;
          const contributedTotal = contributedSelf + contributedEmployer;
          return (
            <Card
              key={account.id}
              variant="outlined"
              style={styles.card}
              testID="pension-contribution-row"
            >
              <View style={styles.cardHeader}>
                <Typography variant="body" weight="semibold">
                  {TYPE_LABEL[account.account_type]}
                  {/* Scoped to one member the name repeats on every row — the
                      header title already says whose contributions these are. */}
                  {showMember && memberName ? ` · ${memberName}` : ''}
                </Typography>
                {hasRecurring && (
                  <View style={styles.recurringBadge}>
                    <Icon name="repeat" size={12} color={colors.primary} />
                    <Typography variant="caption2" color={colors.primary}>
                      Auto
                    </Typography>
                  </View>
                )}
              </View>

              {/* Hero: total contributed this year (you + employer), with the split
                  as a caption — the headline number for this card type. */}
              <View style={styles.totalBlock}>
                <View style={styles.totalTop}>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Contributed in {selectedYear}
                  </Typography>
                  <Typography variant="title3" weight="bold" color={colors.textPrimary}>
                    {formatCurrency(contributedTotal)}
                  </Typography>
                </View>
                <Typography variant="caption2" color={colors.textTertiary}>
                  {contributedEmployer > 0
                    ? `You ${formatCurrency(contributedSelf)} · Employer ${formatCurrency(contributedEmployer)}`
                    : `You ${formatCurrency(contributedSelf)}`}
                </Typography>
              </View>

              {hasRecurring && (
                <Row
                  label="Recurring / mo"
                  value={
                    recurringEmployer > 0
                      ? `${formatCurrency(recurringSelf)} you · ${formatCurrency(recurringEmployer)} employer`
                      : `${formatCurrency(recurringSelf)} you`
                  }
                  colors={colors}
                />
              )}

              {/* Explicit actions (no whole-card tap → avoids nested-touchable flakiness). */}
              <View style={styles.cardActions}>
                <TouchableOpacity
                  onPress={() =>
                    open('recurring', {
                      memberId: memberId ?? undefined,
                      accountType: type,
                      regularContributionCents: account.regular_contribution_cents,
                      employerMatchCents: account.employer_match_cents,
                    })
                  }
                  style={[styles.actionChip, { borderColor: colors.borderColor }]}
                  testID="pension-contribution-edit-recurring"
                >
                  <Icon name="repeat" size={13} color={colors.textSecondary} />
                  <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
                    {hasRecurring ? 'Edit recurring' : 'Set recurring'}
                  </Typography>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => openBackfill({ memberId: memberId ?? undefined, accountType: type })}
                  style={[styles.actionChip, { borderColor: colors.primary }]}
                  testID="pension-contribution-edit-months"
                >
                  <Icon name="calendar-outline" size={13} color={colors.primary} />
                  <Typography variant="caption2" weight="semibold" color={colors.primary}>
                    Enter by month
                  </Typography>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    confirmDelete(memberId, type, TYPE_LABEL[account.account_type])
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.deleteButton}
                  testID="pension-contribution-delete"
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${TYPE_LABEL[account.account_type]} contributions`}
                >
                  <Icon name="trash-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            </Card>
          );
        })
      )}

      {currentHousehold?.id && (
        <PensionEntrySheet
          visible={sheetOpen}
          mode={mode}
          householdId={currentHousehold.id}
          members={currentHouseholdMembers}
          initial={initial}
          onClose={() => setSheetOpen(false)}
          onSaved={markDirty}
        />
      )}

      {currentHousehold?.id && (
        <PensionBackfillSheet
          visible={backfillOpen}
          householdId={currentHousehold.id}
          members={currentHouseholdMembers}
          year={selectedYear}
          initial={backfillInitial}
          onClose={() => setBackfillOpen(false)}
          onSaved={markDirty}
        />
      )}
    </View>
  );
}

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <View style={styles.row}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="caption1" weight="semibold">
        {value}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', alignSelf: 'stretch', gap: Spacing.base, paddingBottom: Spacing.lg },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  empty: { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  emptyBody: { textAlign: 'center' },
  card: { gap: Spacing.xs, padding: Spacing.base },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  recurringBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  totalBlock: { gap: 2, marginBottom: Spacing.xs },
  totalTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  // Push the destructive action to the far end of the row so it reads as separate.
  // Destructive action is de-emphasized: an icon-only, muted tap target pushed
  // to the far right of the actions row (red is reserved for the confirm dialog).
  deleteButton: {
    marginLeft: 'auto',
    alignSelf: 'center',
    padding: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
