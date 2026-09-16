import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { householdsApi, type HouseholdMember } from '@api/households';
import { savingsApi } from '@api/savings';
import { BottomSheet, Button, TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

type LineType = 'rrsp' | 'tfsa';

export interface PensionBackfillInitial {
  memberId?: string;
  accountType?: LineType;
}

interface Props {
  visible: boolean;
  householdId: string;
  members: HouseholdMember[];
  /** Tax year the grid edits — from the Pension year stepper. */
  year: number;
  initial?: PensionBackfillInitial;
  onClose: () => void;
  onSaved: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LINE_TYPES: { id: LineType; label: string }[] = [
  { id: 'rrsp', label: 'RRSP' },
  { id: 'tfsa', label: 'TFSA' },
];

interface MonthRow {
  self: string;
  employer: string;
}

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
const emptyRows = (): MonthRow[] => MONTHS.map(() => ({ self: '', employer: '' }));

/**
 * Pension → Contributions per-month editor ("backfill"). A real RRSP/TFSA statement carries
 * DIFFERENT amounts each month for both the member contribution and the employer match, so
 * this sheet lets you enter (or correct) every month of the selected year at once. An
 * "Apply to all" quick-fill covers the same-amount-each-month case; the per-month rows cover
 * the different-each-month case. THIN CLIENT — the grid is pre-filled from and saved back to
 * `savingsApi`; the backend owns the money math.
 */
export function PensionBackfillSheet({
  visible,
  householdId,
  members,
  year,
  initial,
  onClose,
  onSaved,
}: Props) {
  const colors = useAppColors();

  // Roster can be empty on this screen — seed from the prop, fetch on open (mirrors PensionEntrySheet).
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
  const [rows, setRows] = useState<MonthRow[]>(emptyRows);
  const [fillSelf, setFillSelf] = useState('');
  const [fillEmployer, setFillEmployer] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed member/type each time the sheet opens with new context.
  useEffect(() => {
    if (!visible) return;
    setMemberId(initial?.memberId ?? memberList[0]?.id);
    setType(initial?.accountType ?? 'rrsp');
    setFillSelf('');
    setFillEmployer('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial]);

  useEffect(() => {
    if (!memberId && memberList.length > 0) setMemberId(initial?.memberId ?? memberList[0].id);
  }, [memberList, memberId, initial?.memberId]);

  // Pre-fill the grid from the server whenever member / type / year changes while open.
  useEffect(() => {
    if (!visible || !memberId) return;
    let cancelled = false;
    setLoading(true);
    savingsApi
      .getMemberMonthly(householdId, memberId, type, year)
      .then((res) => {
        if (cancelled) return;
        const next = emptyRows();
        for (const m of res.months) {
          if (m.month < 1 || m.month > 12) continue;
          next[m.month - 1] = {
            self: centsToInput(m.selfCents),
            employer: centsToInput(m.employerCents),
          };
        }
        setRows(next);
      })
      .catch(() => {
        if (!cancelled) setRows(emptyRows());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, householdId, memberId, type, year]);

  // "Apply to all" fills every month up to the current month for the current year (a backfill
  // shouldn't invent future contributions); all 12 for past/future years.
  const fillThroughIndex = useMemo(() => {
    const now = new Date();
    if (year === now.getFullYear()) return now.getMonth(); // 0-based → up to & incl. current month
    return 11;
  }, [year]);

  const applyToAll = () => {
    setRows((prev) =>
      prev.map((r, i) =>
        i <= fillThroughIndex ? { self: fillSelf.trim(), employer: fillEmployer.trim() } : r
      )
    );
  };

  const setRow = (i: number, key: keyof MonthRow, value: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: sanitizeAmount(value) } : r)));

  const totals = useMemo(() => {
    let self = 0;
    let employer = 0;
    for (const r of rows) {
      self += toCents(r.self);
      employer += toCents(r.employer);
    }
    return { self, employer };
  }, [rows]);

  const canSave = !!memberId && !saving && !loading;

  const save = async () => {
    if (!memberId) return;
    setSaving(true);
    try {
      await savingsApi.backfillMemberContributions(householdId, {
        member_id: memberId,
        account_type: type,
        year,
        entries: rows.map((r, i) => ({
          month: i + 1,
          self_cents: toCents(r.self),
          employer_cents: toCents(r.employer),
        })),
      });
      onSaved();
      onClose();
    } catch (error) {
      console.error('Error saving pension backfill:', error);
    } finally {
      setSaving(false);
    }
  };

  const pill = (active: boolean) => [
    styles.pill,
    {
      borderColor: active ? colors.primary : colors.borderColor,
      backgroundColor: active ? colors.surfaceSelected : 'transparent',
    },
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`Monthly contributions · ${year}`}
      height="tall"
      showCloseButton
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        {...keyboardDismissScrollProps}
        showsVerticalScrollIndicator={false}
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
                  testID={`pension-backfill-member-${m.id}`}
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
                testID={`pension-backfill-type-${t.id}`}
              >
                <Typography variant="caption1" color={active ? colors.primary : colors.textPrimary}>
                  {t.label}
                </Typography>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Apply-to-all quick fill (same amount every month) */}
        <View style={[styles.fillCard, { borderColor: colors.borderColor }]}>
          <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
            Same amount every month?
          </Typography>
          <View style={styles.fillRow}>
            <TextInput
              testID="pension-backfill-fill-self"
              containerStyle={styles.fillInput}
              placeholder="You"
              value={fillSelf}
              onChangeText={(t) => setFillSelf(sanitizeAmount(t))}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
            <TextInput
              testID="pension-backfill-fill-employer"
              containerStyle={styles.fillInput}
              placeholder="Employer"
              value={fillEmployer}
              onChangeText={(t) => setFillEmployer(sanitizeAmount(t))}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
            <TouchableOpacity
              onPress={applyToAll}
              style={[styles.applyBtn, { backgroundColor: colors.primary }]}
              testID="pension-backfill-apply-all"
            >
              <Icon name="arrow-down" size={14} color={colors.white} />
              <Typography variant="caption2" weight="semibold" color={colors.white}>
                Apply
              </Typography>
            </TouchableOpacity>
          </View>
          <Typography variant="caption2" color={colors.textTertiary}>
            Different every month? Just type each month's amounts below.
          </Typography>
        </View>

        {/* Column headers */}
        <View style={styles.gridHeader}>
          <Typography variant="caption2" color={colors.textTertiary} style={styles.monthLabel}>
            Month
          </Typography>
          <Typography variant="caption2" color={colors.textTertiary} style={styles.colLabel}>
            You
          </Typography>
          <Typography variant="caption2" color={colors.textTertiary} style={styles.colLabel}>
            Employer
          </Typography>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          rows.map((r, i) => (
            <View key={MONTHS[i]} style={styles.monthRow}>
              <Typography variant="caption1" color={colors.textSecondary} style={styles.monthLabel}>
                {MONTHS[i]}
              </Typography>
              <TextInput
                testID={`pension-backfill-self-${i + 1}`}
                containerStyle={styles.cellInput}
                placeholder="0"
                value={r.self}
                onChangeText={(t) => setRow(i, 'self', t)}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
              <TextInput
                testID={`pension-backfill-employer-${i + 1}`}
                containerStyle={styles.cellInput}
                placeholder="0"
                value={r.employer}
                onChangeText={(t) => setRow(i, 'employer', t)}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            </View>
          ))
        )}

        {/* Year totals (echo of typed input) */}
        <View style={[styles.totalRow, { borderTopColor: colors.borderColor }]}>
          <Typography variant="caption1" weight="semibold" style={styles.monthLabel}>
            Total
          </Typography>
          <Typography variant="caption1" weight="semibold" style={styles.colLabel}>
            {formatCurrency(totals.self)}
          </Typography>
          <Typography variant="caption1" weight="semibold" style={styles.colLabel}>
            {formatCurrency(totals.employer)}
          </Typography>
        </View>

        <Button
          title={saving ? 'Saving…' : 'Save'}
          onPress={save}
          disabled={!canSave}
          style={styles.saveBtn}
          testID="pension-backfill-save"
        />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { width: '100%' },
  body: { gap: Spacing.sm, paddingBottom: Spacing.xxl },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
  },
  fillCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.sm,
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  fillRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  fillInput: { flex: 1, marginBottom: 0 },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 10,
  },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  monthLabel: { width: 48 },
  colLabel: { flex: 1, textAlign: 'right' },
  cellInput: { flex: 1, marginBottom: 0 },
  center: { paddingVertical: Spacing.xl, alignItems: 'center' },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderTopWidth: 1,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  saveBtn: { marginTop: Spacing.md },
});
