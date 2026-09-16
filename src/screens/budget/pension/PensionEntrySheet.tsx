import * as Crypto from 'expo-crypto';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { householdsApi, type HouseholdMember } from '@api/households';
import { savingsApi } from '@api/savings';
import { BottomSheet, Button, TextInput, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { formatMoney, useDisplayCurrency } from '@utils/money';

export type PensionEntryMode = 'room' | 'goal' | 'recurring' | 'contribution';
type LineType = 'rrsp' | 'tfsa';

export interface PensionEntryInitial {
  memberId?: string;
  accountType?: LineType;
  roomCents?: number | null;
  goalCents?: number | null;
  goalPct?: number | null;
  regularContributionCents?: number | null;
  employerMatchCents?: number | null;
}

interface Props {
  visible: boolean;
  mode: PensionEntryMode;
  householdId: string;
  members: HouseholdMember[];
  initial?: PensionEntryInitial;
  /**
   * Goal mode only: `${memberId}:${type}` → the member's room base in cents, used to preview
   * the dollar goal a % resolves to. Base mirrors the backend's `effectiveGoalCents`
   * (`starting_room_cents ?? annualLimit`). Missing key → no preview (no room set yet).
   */
  goalBases?: Record<string, number>;
  onClose: () => void;
  /** Called after a successful save so the caller can markDirty + reload. */
  onSaved: () => void;
}

const TITLES: Record<PensionEntryMode, string> = {
  room: 'Contribution room',
  goal: 'Annual goal',
  recurring: 'Recurring contribution',
  contribution: 'Add contribution',
};

const LINE_TYPES: { id: LineType; label: string }[] = [
  { id: 'rrsp', label: 'RRSP' },
  { id: 'tfsa', label: 'TFSA' },
];

function sanitizeAmount(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
}
function toCents(dollars: string): number {
  const n = parseFloat(dollars);
  if (Number.isNaN(n) || n <= 0) return 0;
  return Math.round(n * 100);
}
function centsToInput(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
function formatDollars(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

/**
 * One reusable add/edit sheet for the whole simple Pension flow. `mode` selects which
 * fields show (room / goal / recurring / manual contribution); every save routes through
 * `savingsApi.setMemberLine` or `addMemberContribution` — no account setup. THIN CLIENT.
 */
export function PensionEntrySheet({
  visible,
  mode,
  householdId,
  members,
  initial,
  goalBases,
  onClose,
  onSaved,
}: Props) {
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const insets = useSafeAreaInsets();
  // Recurring/contribution carry the most fields (employer-match block), so give
  // them a taller sheet; room/goal stay compact.
  const sheetSize = mode === 'recurring' || mode === 'contribution' ? 'tall' : 'standard';

  // The store's currentHouseholdMembers can be empty on this screen, so seed from the prop
  // and fetch the household roster when the sheet opens (mirrors SavingsEntryForm).
  const [memberList, setMemberList] = useState<HouseholdMember[]>(members);
  useEffect(() => {
    if (members.length > 0) setMemberList(members);
  }, [members]);
  useEffect(() => {
    if (!visible || !householdId || memberList.length > 0) return;
    householdsApi
      .get(householdId)
      .then((res) => setMemberList(res.members))
      .catch(() => {});
  }, [visible, householdId, memberList.length]);

  const [memberId, setMemberId] = useState<string | undefined>(initial?.memberId ?? members[0]?.id);
  const [type, setType] = useState<LineType>(initial?.accountType ?? 'rrsp');
  const [goalMode, setGoalMode] = useState<'amount' | 'percent'>(
    initial?.goalPct != null ? 'percent' : 'amount'
  );
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState(''); // custom employer amount (recurring + contribution)
  // Employer-portion controls (recurring + contribution modes).
  const [employerOn, setEmployerOn] = useState(false); // contribution: include an employer portion at all
  const [matchSelf, setMatchSelf] = useState(false); // employer amount mirrors "your" amount
  const [saving, setSaving] = useState(false);

  // Default the member once the roster is available (first open often loads it async).
  useEffect(() => {
    if (!memberId && memberList.length > 0) {
      setMemberId(initial?.memberId ?? memberList[0].id);
    }
  }, [memberList, memberId, initial?.memberId]);

  // Re-seed local state whenever the sheet (re)opens with new context.
  useEffect(() => {
    if (!visible) return;
    setMemberId(initial?.memberId ?? memberList[0]?.id);
    setType(initial?.accountType ?? 'rrsp');
    setSecondary(centsToInput(initial?.employerMatchCents));
    if (mode === 'room') {
      setPrimary(centsToInput(initial?.roomCents));
      setEmployerOn(false);
      setMatchSelf(false);
    } else if (mode === 'goal') {
      const isPct = initial?.goalPct != null;
      setGoalMode(isPct ? 'percent' : 'amount');
      setPrimary(isPct ? String(initial?.goalPct ?? '') : centsToInput(initial?.goalCents));
      setEmployerOn(false);
      setMatchSelf(false);
    } else if (mode === 'recurring') {
      setPrimary(centsToInput(initial?.regularContributionCents));
      // Editing an existing employer match that equals the self amount opens as a "match".
      const emp = initial?.employerMatchCents ?? 0;
      const self = initial?.regularContributionCents ?? 0;
      setEmployerOn(emp > 0);
      setMatchSelf(emp > 0 && emp === self);
    } else {
      // contribution: opt-in employer portion, default to mirroring the member's amount.
      setPrimary('');
      setEmployerOn(false);
      setMatchSelf(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, initial]);

  const primaryLabel = useMemo(() => {
    switch (mode) {
      case 'room':
        return 'Contribution room ($)';
      case 'goal':
        return goalMode === 'percent' ? 'Goal (% of room)' : 'Goal amount ($)';
      case 'recurring':
        return 'Monthly amount — you ($)';
      case 'contribution':
        return 'Your contribution ($)';
    }
  }, [mode, goalMode]);

  // The employer portion (recurring match / contribution add-on). When "match" is on it
  // mirrors the member's own amount; otherwise it's the custom figure they typed.
  const showEmployer = mode === 'recurring' || (mode === 'contribution' && employerOn);
  const employerCents = !showEmployer ? 0 : matchSelf ? toCents(primary) : toCents(secondary);

  // Live preview of the dollar goal a % resolves to (pct × the member's room base). Matches
  // the backend's `effectiveGoalCents`; null when the room base for this member/type is
  // unknown (nothing set yet) so we render an em-dash instead of a misleading figure.
  const goalBaseCents = mode === 'goal' ? goalBases?.[`${memberId ?? ''}:${type}`] ?? null : null;
  const goalPreviewCents =
    goalBaseCents != null && goalBaseCents > 0
      ? Math.round((goalBaseCents * Math.min(100, parseInt(primary, 10) || 0)) / 100)
      : null;

  const canSave = !!memberId && primary.trim().length > 0 && !saving;

  const save = async () => {
    if (!memberId) return;
    setSaving(true);
    try {
      if (mode === 'contribution') {
        const amount = toCents(primary);
        if (amount <= 0) return;
        await savingsApi.addMemberContribution(householdId, {
          // Stable client id so a network retry of this submit doesn't double-count.
          id: Crypto.randomUUID(),
          member_id: memberId,
          account_type: type,
          amount_cents: amount,
          contributor: 'self',
          ...(employerCents > 0 ? { employer_amount_cents: employerCents } : {}),
        });
      } else if (mode === 'goal') {
        await savingsApi.setMemberLine(householdId, {
          member_id: memberId,
          account_type: type,
          ...(goalMode === 'percent'
            ? { goal_pct: Math.min(100, Math.round(parseFloat(primary) || 0)), goal_cents: null }
            : { goal_cents: toCents(primary), goal_pct: null }),
        });
      } else if (mode === 'recurring') {
        await savingsApi.setMemberLine(householdId, {
          member_id: memberId,
          account_type: type,
          regular_contribution_cents: toCents(primary),
          employer_match_cents: employerCents,
        });
      } else {
        await savingsApi.setMemberLine(householdId, {
          member_id: memberId,
          account_type: type,
          room_cents: toCents(primary),
        });
      }
      onSaved();
      onClose();
    } catch (error) {
      console.error('Error saving pension entry:', error);
    } finally {
      setSaving(false);
    }
  };

  const pill = (active: boolean) => [
    styles.pill,
    { borderColor: active ? colors.primary : colors.borderColor, backgroundColor: active ? colors.surfaceSelected : 'transparent' },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={TITLES[mode]} height={sheetSize} showCloseButton>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + Spacing.lg }]}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissScrollProps}
      >
        {/* Member selector */}
        <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
          Member
        </Typography>
        <View style={styles.pillRow}>
          {memberList.length === 0 ? (
            <Typography variant="caption1" color={colors.textSecondary}>
              Loading members…
            </Typography>
          ) : (
            memberList.map((m) => {
              const active = m.id === memberId;
              return (
                <TouchableOpacity
                  key={m.id}
                  onPress={() => setMemberId(m.id)}
                  style={pill(active)}
                  testID={`pension-entry-member-${m.id}`}
                >
                  <Typography variant="caption1" color={active ? colors.primary : colors.textPrimary}>
                    {m.display_name ?? m.email}
                  </Typography>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Account type */}
        <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
          Type
        </Typography>
        <View style={styles.pillRow}>
          {LINE_TYPES.map((t) => {
            const active = t.id === type;
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => setType(t.id)}
                style={pill(active)}
                testID={`pension-entry-type-${t.id}`}
              >
                <Typography variant="caption1" color={active ? colors.primary : colors.textPrimary}>
                  {t.label}
                </Typography>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Goal amount/% switch */}
        {mode === 'goal' && (
          <View style={styles.pillRow}>
            {(['amount', 'percent'] as const).map((g) => {
              const active = g === goalMode;
              return (
                <TouchableOpacity
                  key={g}
                  onPress={() => setGoalMode(g)}
                  style={pill(active)}
                  testID={`pension-entry-goalmode-${g}`}
                >
                  <Typography variant="caption1" color={active ? colors.primary : colors.textPrimary}>
                    {g === 'amount' ? 'Amount ($)' : 'Percent (%)'}
                  </Typography>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TextInput
          testID="pension-entry-primary"
          label={primaryLabel}
          placeholder={mode === 'goal' && goalMode === 'percent' ? 'e.g. 80' : '0.00'}
          value={primary}
          onChangeText={(t) =>
            setPrimary(mode === 'goal' && goalMode === 'percent' ? t.replace(/[^0-9]/g, '') : sanitizeAmount(t))
          }
          keyboardType="decimal-pad"
          inputMode="decimal"
        />

        {/* Percent goal — show the dollar goal it resolves to (pct × the member's room base). */}
        {mode === 'goal' && goalMode === 'percent' && (
          <View style={[styles.matchPreview, { borderColor: colors.borderColor }]}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Goal this year
            </Typography>
            <Typography
              variant="caption1"
              weight="semibold"
              color={colors.primary}
              testID="pension-entry-goal-preview"
            >
              {goalPreviewCents != null && goalPreviewCents > 0 ? formatDollars(goalPreviewCents) : '—'}
            </Typography>
          </View>
        )}

        {/* Employer portion — opt-in for a manual contribution, always shown for recurring. */}
        {mode === 'contribution' && (
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabel}>
              <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                Employer contributed too
              </Typography>
              <Typography variant="caption2" color={colors.textSecondary}>
                Log your employer's matching share alongside yours.
              </Typography>
            </View>
            <Toggle
              testID="pension-entry-employer-toggle"
              value={employerOn}
              onValueChange={setEmployerOn}
            />
          </View>
        )}

        {showEmployer && (
          <>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                  Match my contribution
                </Typography>
                <Typography variant="caption2" color={colors.textSecondary}>
                  {matchSelf
                    ? 'Employer adds the same amount you contribute.'
                    : 'Enter the employer amount manually.'}
                </Typography>
              </View>
              <Toggle
                testID="pension-entry-employer-match-toggle"
                value={matchSelf}
                onValueChange={setMatchSelf}
              />
            </View>

            {matchSelf ? (
              <View style={[styles.matchPreview, { borderColor: colors.borderColor }]}>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {mode === 'recurring' ? 'Employer match / mo' : 'Employer contribution'}
                </Typography>
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={colors.primary}
                  testID="pension-entry-employer-preview"
                >
                  {employerCents > 0 ? formatDollars(employerCents) : '—'}
                </Typography>
              </View>
            ) : (
              <TextInput
                testID="pension-entry-employer-match"
                label={mode === 'recurring' ? 'Employer match — monthly ($)' : 'Employer contribution ($)'}
                placeholder="0.00"
                value={secondary}
                onChangeText={(t) => setSecondary(sanitizeAmount(t))}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            )}
          </>
        )}

        <Button
          title={saving ? 'Saving…' : 'Save'}
          onPress={save}
          disabled={!canSave}
          style={styles.saveBtn}
          testID="pension-entry-save"
        />
        {saving && <ActivityIndicator color={colors.primary} style={styles.savingSpinner} />}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  body: { gap: Spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
  },
  saveBtn: { marginTop: Spacing.sm },
  savingSpinner: { marginTop: Spacing.xs },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  toggleLabel: { flex: 1, gap: 2 },
  matchPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
});
