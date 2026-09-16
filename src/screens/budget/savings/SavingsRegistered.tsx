import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import {
  savingsApi,
  type RegisteredAccount,
  type RegisteredAccountType,
  type RegisteredContributor,
  type RegisteredRoom,
  type RegisteredTransactionKind,
  type RegisteredTransactionType,
} from '@api/savings';
import { AppBackground, HeaderActionButton, OverlaySheetHeader, SafeAreaView, ScreenHeader } from '@components/common';
import { Button, Card, InstitutionLogo, TextInput, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { Header, IconSize, Layout, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { InstitutionPicker } from './InstitutionPicker';

/**
 * Phase 3 — Registered Accounts (TFSA / RRSP / FHSA).
 *
 * THIN CLIENT: every room figure (roomRemaining, annualLimit, used,
 * usedByKind, warnings) is computed by `savingsApi.getRoom(...)` and only
 * rendered here — no client-side room math. Money inputs are dollars→int
 * cents on submit. Every mutation calls `markDirty()` so the room bars and
 * the Dashboard headroom card refetch. Submit buttons disable while in flight.
 */

function toCents(dollars: string): number | undefined {
  const n = parseFloat(dollars.replace(/,/g, ''));
  if (Number.isNaN(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

function centsToDollarsString(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || cents === 0) return '';
  return (cents / 100).toString();
}

function todayYMD(): string {
  // Local calendar date (not UTC) so an evening entry doesn't roll into the next
  // day / tax year for users behind UTC. Matches SavingsEntryForm.todayYMD().
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when today falls inside the first 60 days of the calendar year. */
function isWithinFirst60Days(): boolean {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diffDays = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  return diffDays < 60;
}

const ACCOUNT_TYPES: Array<{ value: RegisteredAccountType; label: string }> = [
  { value: 'tfsa', label: 'TFSA' },
  { value: 'rrsp', label: 'RRSP' },
  { value: 'fhsa', label: 'FHSA' },
  { value: 'dpsp', label: 'DPSP' },
  { value: 'rpp', label: 'Pension (RPP)' },
];

const ACCOUNT_TYPE_LABEL: Record<RegisteredAccountType, string> = {
  tfsa: 'TFSA',
  rrsp: 'RRSP',
  fhsa: 'FHSA',
  dpsp: 'DPSP',
  rpp: 'Pension (RPP)',
};

/** Employer DC plans generate a Pension Adjustment; they are workplace-only. */
const EMPLOYER_PLAN_TYPES: RegisteredAccountType[] = ['dpsp', 'rpp'];

/**
 * CRA RRSP dollar limit prefill (editable). Kept as a display convenience only —
 * the authoritative annual limit is computed server-side from the account's
 * stored fields. Users can override for the exact NOA year.
 */
const RRSP_DOLLAR_LIMIT_PREFILL_CENTS = 3_381_000; // $33,810

interface AccountFormState {
  id: string | null; // null = create
  account_type: RegisteredAccountType;
  member_id: string | null;
  institution: string;
  isEmployerPlan: boolean;
  employerName: string;
  balance: string;
  startingRoom: string;
  annualLimitOverride: string;
  regularContribution: string;
  annualGoal: string;
  priorEarnedIncome: string;
  pensionAdjustment: string;
}

function emptyAccountForm(): AccountFormState {
  return {
    id: null,
    account_type: 'tfsa',
    member_id: null,
    institution: '',
    isEmployerPlan: false,
    employerName: '',
    balance: '',
    startingRoom: '',
    annualLimitOverride: '',
    regularContribution: '',
    annualGoal: '',
    priorEarnedIncome: '',
    pensionAdjustment: '',
  };
}

function formFromAccount(account: RegisteredAccount): AccountFormState {
  return {
    id: account.id,
    account_type: account.account_type,
    member_id: account.member_id,
    institution: account.institution ?? '',
    isEmployerPlan: account.is_employer_plan,
    employerName: account.employer_name ?? '',
    balance: centsToDollarsString(account.balance_cents),
    startingRoom: centsToDollarsString(account.starting_room_cents),
    annualLimitOverride: centsToDollarsString(account.annual_limit_override_cents),
    regularContribution: centsToDollarsString(account.regular_contribution_cents),
    annualGoal: centsToDollarsString(account.annual_goal_cents),
    priorEarnedIncome: centsToDollarsString(account.prior_earned_income_cents),
    pensionAdjustment: centsToDollarsString(account.pension_adjustment_cents),
  };
}

export function SavingsRegistered() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold, currentHouseholdMembers } = useHouseholdStore();
  const { selectedYear, dataRevision, markDirty } = useSavingsStore();
  // Both sheets below are anchored to the bottom of a raw `Modal`, where a
  // `KeyboardAvoidingView` is unreliable and only shrinks the viewport anyway —
  // the keypad landed on the very field it was summoned by. Lift by the measured
  // inset instead; the sheets' percentage `maxHeight` then resolves against
  // what is left above the keyboard, so a tall sheet stays on screen.
  const keyboardInset = useKeyboardInset();

  const [accounts, setAccounts] = useState<RegisteredAccount[]>([]);
  const [roomByAccount, setRoomByAccount] = useState<Record<string, RegisteredRoom>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Account add/edit modal
  const [accountForm, setAccountForm] = useState<AccountFormState | null>(null);
  // Snapshot of the form as opened, to diff against for unsaved-changes gating.
  const [accountBaseline, setAccountBaseline] = useState<AccountFormState | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Contribution log modal
  const [logAccount, setLogAccount] = useState<RegisteredAccount | null>(null);
  const [logAmount, setLogAmount] = useState('');
  const [logType, setLogType] = useState<RegisteredTransactionType>('contribution');
  const [logKind, setLogKind] = useState<RegisteredTransactionKind>('manual');
  const [logContributor, setLogContributor] = useState<RegisteredContributor>('self');
  const [isLoggingTx, setIsLoggingTx] = useState(false);

  // Per-account "apply this month's regular" busy / applied state
  const [applyingRegularId, setApplyingRegularId] = useState<string | null>(null);
  const [appliedRegularIds, setAppliedRegularIds] = useState<Set<string>>(new Set());

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of currentHouseholdMembers) {
      // member_id is the membership id (HouseholdMember.id) — the backend's
      // canonical member key that getRegisteredOverview groups + names by.
      map.set(member.id, member.display_name ?? 'Member');
    }
    return map;
  }, [currentHouseholdMembers]);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    const hid = currentHousehold.id;
    try {
      const { accounts: rows } = await savingsApi.listAccounts(hid);
      setAccounts(rows);

      const roomResults = await Promise.all(
        rows.map((acc) =>
          savingsApi
            .getRoom(hid, acc.id, selectedYear)
            .then((room) => [acc.id, room] as const)
            .catch(() => null)
        )
      );
      const nextRooms: Record<string, RegisteredRoom> = {};
      for (const result of roomResults) {
        if (result) nextRooms[result[0]] = result[1];
      }
      setRoomByAccount(nextRooms);
    } catch (error) {
      console.error('Error loading registered accounts:', error);
    }
  }, [currentHousehold?.id, selectedYear]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
    // Reload keyed on household + data revision (every mutation bumps dataRevision).
  }, [currentHousehold?.id, dataRevision, load]);

  // ---- Grouping: cards grouped per member ----
  const groups = useMemo(() => {
    const byMember = new Map<string | null, RegisteredAccount[]>();
    for (const acc of accounts) {
      const key = acc.member_id ?? null;
      const list = byMember.get(key) ?? [];
      list.push(acc);
      byMember.set(key, list);
    }
    return Array.from(byMember.entries()).map(([memberId, list]) => ({
      memberId,
      memberName: memberId ? memberNameById.get(memberId) ?? 'Member' : 'Household',
      list,
    }));
  }, [accounts, memberNameById]);

  const isEditingAccount = !!accountForm?.id;

  // Account form save via useUnsavedChanges: onSave is persistence ONLY (the hook
  // shows the success toast + closes on success, and the error toast on throw).
  // values/baseline are the same AccountFormState shape (empty defaults when the
  // modal is closed keeps the hook call unconditional).
  const {
    isDirty: isAccountDirty,
    isSaving: isSavingAccountForm,
    save: saveAccountForm,
  } = useUnsavedChanges<AccountFormState>({
    values: accountForm ?? emptyAccountForm(),
    baseline: accountBaseline ?? emptyAccountForm(),
    successMessage: isEditingAccount ? 'Account saved' : 'Account added',
    errorMessage: 'Could not save this account. Please try again.',
    onClose: () => setAccountForm(null),
    onSave: async () => {
      if (!currentHousehold?.id || !accountForm) return false;
      const hid = currentHousehold.id;
      const form = accountForm;

      const balance_cents = toCents(form.balance) ?? 0;
      const starting_room_cents = form.startingRoom.trim() ? toCents(form.startingRoom) ?? null : null;
      const annual_limit_override_cents = form.annualLimitOverride.trim()
        ? toCents(form.annualLimitOverride) ?? null
        : null;
      const regular_contribution_cents = form.regularContribution.trim()
        ? toCents(form.regularContribution) ?? null
        : null;
      const prior_earned_income_cents = form.priorEarnedIncome.trim()
        ? toCents(form.priorEarnedIncome) ?? null
        : null;
      const pension_adjustment_cents = form.pensionAdjustment.trim()
        ? toCents(form.pensionAdjustment) ?? null
        : null;
      const annual_goal_cents = form.annualGoal.trim() ? toCents(form.annualGoal) ?? null : null;
      // DC plans are always employer plans; otherwise honor the toggle.
      const is_employer_plan = EMPLOYER_PLAN_TYPES.includes(form.account_type)
        ? true
        : form.isEmployerPlan;
      const employer_name = is_employer_plan ? form.employerName.trim() || null : null;

      if (form.id) {
        await savingsApi.updateAccount(hid, form.id, {
          account_type: form.account_type,
          member_id: form.member_id,
          institution: form.institution.trim() || null,
          is_employer_plan,
          employer_name,
          balance_cents,
          starting_room_cents,
          annual_limit_override_cents,
          regular_contribution_cents,
          annual_goal_cents,
          prior_earned_income_cents,
          pension_adjustment_cents,
        });
      } else {
        await savingsApi.createAccount(hid, {
          id: Crypto.randomUUID(),
          account_type: form.account_type,
          member_id: form.member_id,
          institution: form.institution.trim() || null,
          is_employer_plan,
          employer_name,
          balance_cents,
          starting_room_cents,
          annual_limit_override_cents,
          regular_contribution_cents,
          annual_goal_cents,
          prior_earned_income_cents,
          pension_adjustment_cents,
        });
      }
      markDirty();
      return;
    },
  });

  // ---- Account form helpers ----
  const openCreate = useCallback(() => {
    setShowAdvanced(false);
    setAccountForm(emptyAccountForm());
    setAccountBaseline(emptyAccountForm());
  }, []);

  const openEdit = useCallback((account: RegisteredAccount) => {
    setShowAdvanced(false);
    setAccountForm(formFromAccount(account));
    setAccountBaseline(formFromAccount(account));
  }, []);

  const closeAccountForm = useCallback(() => {
    if (isSavingAccountForm) return;
    setAccountForm(null);
  }, [isSavingAccountForm]);

  const updateForm = useCallback((patch: Partial<AccountFormState>) => {
    setAccountForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const handleDeleteAccount = useCallback(
    (account: RegisteredAccount) => {
      if (!currentHousehold?.id) return;
      const hid = currentHousehold.id;
      Alert.alert(
        'Delete account',
        `Delete this ${ACCOUNT_TYPE_LABEL[account.account_type]} account and its contributions?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await savingsApi.deleteAccount(hid, account.id);
                markDirty();
              } catch (error) {
                console.error('Error deleting registered account:', error);
                Alert.alert('Error', 'Could not delete this account.');
              }
            },
          },
        ]
      );
    },
    [currentHousehold?.id, markDirty]
  );

  // ---- Contribution log helpers ----
  const openLog = useCallback((account: RegisteredAccount) => {
    setLogAmount('');
    setLogType('contribution');
    setLogKind('manual');
    setLogContributor('self');
    setLogAccount(account);
  }, []);

  const closeLog = useCallback(() => {
    if (isLoggingTx) return;
    setLogAccount(null);
  }, [isLoggingTx]);

  const handleLogTransaction = useCallback(async () => {
    if (!currentHousehold?.id || !logAccount) return;
    const amount_cents = toCents(logAmount);
    if (!amount_cents || amount_cents <= 0) {
      Alert.alert('Missing amount', 'Enter an amount greater than zero.');
      return;
    }
    const hid = currentHousehold.id;
    setIsLoggingTx(true);
    try {
      await savingsApi.addTransaction(hid, logAccount.id, {
        id: Crypto.randomUUID(),
        type: logType,
        kind: logKind,
        contributor: logType === 'contribution' ? logContributor : 'self',
        amount_cents,
        transaction_date: todayYMD(),
      });
      markDirty();
      setLogAccount(null);
    } catch (error) {
      console.error('Error logging registered transaction:', error);
      Alert.alert('Error', 'Could not log this contribution.');
    } finally {
      setIsLoggingTx(false);
    }
  }, [currentHousehold?.id, logAccount, logAmount, logType, logKind, logContributor, markDirty]);

  const handleApplyRegular = useCallback(
    async (account: RegisteredAccount) => {
      if (!currentHousehold?.id) return;
      const hid = currentHousehold.id;
      const month = new Date().getMonth() + 1;
      setApplyingRegularId(account.id);
      try {
        await savingsApi.applyRegularContribution(hid, account.id, {
          year: selectedYear,
          month,
        });
        setAppliedRegularIds((prev) => new Set(prev).add(account.id));
        markDirty();
      } catch (error) {
        console.error('Error applying regular contribution:', error);
        Alert.alert('Error', 'Could not apply this month’s regular contribution.');
      } finally {
        setApplyingRegularId(null);
      }
    },
    [currentHousehold?.id, markDirty, selectedYear]
  );

  const showRrspDeadlineBanner = isWithinFirst60Days();

  // ---- Render ----
  return (
    <AppBackground>
    <SafeAreaView
      edges={[]}
      style={[styles.flex, { backgroundColor: colors.backgroundMain }]}
      testID="savings-registered"
    >
      {/* The app's one screen header — glass chrome, centred title, back
          button — instead of a hand-rolled row with its own BackButton +
          Typography title. This was the one Savings screen still building
          its own header; SavingsYearHistoryScreen / SavingsCompareYearsScreen
          in this same folder already use ScreenHeader with rightElement. */}
      <ScreenHeader
        title="Registered accounts"
        showBackButton
        onBackPress={() => navigation.goBack()}
        backButtonTestID="savings-registered-back"
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        rightElement={
          <HeaderActionButton
            iconOnly
            onPress={openCreate}
            testID="savings-registered-add"
            accessibilityLabel="Add registered account"
          >
            <Icon name="add" size={Header.actionIconSize} color={colors.primary} />
          </HeaderActionButton>
        }
      />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.pastel.teal} />
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={styles.flex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {showRrspDeadlineBanner && (
            <View style={[styles.banner, { backgroundColor: colors.surfaceSelected }]} testID="savings-rrsp-deadline-banner">
              <Icon name="alarm-outline" size={IconSize.md} color={theme.pastel.teal} />
              <View style={styles.bannerText}>
                <Typography variant="subheadline" weight="semibold">
                  RRSP first-60-days window
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Contributions made in the first 60 days of the year can be deducted on last year’s
                  return.
                </Typography>
              </View>
            </View>
          )}

          {accounts.length === 0 ? (
            <View style={styles.empty}>
              <Typography variant="body" color={colors.textSecondary} align="center">
                No registered accounts yet. Add a TFSA, RRSP, or FHSA to track your contribution
                room.
              </Typography>
            </View>
          ) : (
            groups.map((group) => (
              <View key={group.memberId ?? 'household'} style={styles.group}>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.groupTitle}
                >
                  {group.memberName.toUpperCase()}
                </Typography>
                {group.list.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    room={roomByAccount[account.id]}
                    tealColor={theme.pastel.teal}
                    onEdit={() => openEdit(account)}
                    onLog={() => openLog(account)}
                    onApplyRegular={() => void handleApplyRegular(account)}
                    isApplying={applyingRegularId === account.id}
                    isApplied={appliedRegularIds.has(account.id)}
                  />
                ))}
              </View>
            ))
          )}

          <Typography
            variant="caption2"
            color={colors.textTertiary}
            align="center"
            style={styles.disclaimer}
          >
            Estimate only — verify on CRA My Account.
          </Typography>
        </ScrollView>
      )}

      {/* Account add / edit modal */}
      <Modal
        visible={!!accountForm}
        transparent
        animationType="slide"
        onRequestClose={closeAccountForm}
      >
        <View
          style={[
            styles.modalOverlay,
            { backgroundColor: colors.modalBackdrop, paddingBottom: keyboardInset },
          ]}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeAccountForm}
            accessibilityLabel="Close"
          />
          <View style={[styles.sheet, { backgroundColor: colors.backgroundMain }]}>
            {/* Same chrome as the "Log contribution" sheet below — grabber,
                glass ✕ on the left, centred title — instead of the title-plus-
                teal-"Cancel" row this one used to hand-roll. */}
            <OverlaySheetHeader
              title={accountForm?.id ? 'Edit account' : 'Add account'}
              onClose={closeAccountForm}
              closeTestID="savings-account-close"
            />

            {accountForm && (
              /* No `automaticallyAdjustKeyboardInsets` here, and that is deliberate: the
                 sheet is ALREADY lifted clear of the keypad by `keyboardInset` on the
                 backdrop above. Letting the scroller offset by the keyboard height as
                 well counts it twice and drives the focused field's own label off the
                 top of the card. Verified on a device via ProjectionTargetModal. */
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetContent}
                showsVerticalScrollIndicator
              >
                {/* Account type */}
                <Typography variant="caption1" color={colors.textSecondary}>
                  Account type
                </Typography>
                <View style={styles.chipRow}>
                  {ACCOUNT_TYPES.map((opt) => {
                    const active = accountForm.account_type === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.chip,
                          {
                            borderColor: theme.pastel.teal,
                            backgroundColor: active ? theme.pastel.teal : 'transparent',
                          },
                        ]}
                        onPress={() => updateForm({ account_type: opt.value })}
                        testID={`savings-account-type-${opt.value}`}
                      >
                        <Typography
                          variant="caption1"
                          weight="semibold"
                          color={active ? colors.white : theme.pastel.teal}
                        >
                          {opt.label}
                        </Typography>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Member picker */}
                <Typography variant="caption1" color={colors.textSecondary}>
                  Account owner
                </Typography>
                <View style={styles.chipRow}>
                  {currentHouseholdMembers.map((member) => {
                    const active = accountForm.member_id === member.id;
                    return (
                      <TouchableOpacity
                        key={member.id}
                        style={[
                          styles.chip,
                          {
                            borderColor: theme.pastel.teal,
                            backgroundColor: active ? theme.pastel.teal : 'transparent',
                          },
                        ]}
                        onPress={() =>
                          updateForm({ member_id: active ? null : member.id })
                        }
                        testID={`savings-account-member-${member.id}`}
                      >
                        <Typography
                          variant="caption1"
                          weight="semibold"
                          color={active ? colors.white : theme.pastel.teal}
                        >
                          {member.display_name ?? 'Member'}
                        </Typography>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Institution — searchable brand picker (popular presets + custom). */}
                <InstitutionPicker
                  value={accountForm.institution}
                  onChange={(v) => updateForm({ institution: v })}
                />

                {/* Workplace / employer plan. DC plans (DPSP/RPP) are always employer
                    plans, so the toggle is forced on and hidden for those. */}
                {!EMPLOYER_PLAN_TYPES.includes(accountForm.account_type) && (
                  <View style={styles.toggleRow}>
                    <View style={styles.toggleLabel}>
                      <Typography variant="body" weight="medium">
                        Workplace / employer plan
                      </Typography>
                      <Typography variant="caption2" color={colors.textTertiary}>
                        e.g. a group RRSP with employer matching
                      </Typography>
                    </View>
                    <Toggle
                      value={accountForm.isEmployerPlan}
                      onValueChange={(v) => updateForm({ isEmployerPlan: v })}
                      testID="savings-account-employer-toggle"
                    />
                  </View>
                )}
                {(accountForm.isEmployerPlan ||
                  EMPLOYER_PLAN_TYPES.includes(accountForm.account_type)) && (
                  <TextInput
                    label="Employer name (optional)"
                    placeholder="e.g. Acme Corp"
                    value={accountForm.employerName}
                    onChangeText={(v) => updateForm({ employerName: v })}
                    testID="savings-account-employer-name"
                  />
                )}

                {/* Annual contribution goal (all types) */}
                <TextInput
                  label="Annual contribution goal ($, optional)"
                  placeholder="e.g. 10000"
                  value={accountForm.annualGoal}
                  onChangeText={(v) => updateForm({ annualGoal: v })}
                  keyboardType="decimal-pad"
                  testID="savings-account-annual-goal"
                />

                {/* Type-specific fields */}
                {accountForm.account_type === 'rrsp' && (
                  <>
                    <TextInput
                      label="RRSP deduction limit from your NOA ($)"
                      placeholder="0"
                      value={accountForm.startingRoom}
                      onChangeText={(v) => updateForm({ startingRoom: v })}
                      keyboardType="decimal-pad"
                      testID="savings-rrsp-noa-room"
                    />
                    <TouchableOpacity
                      style={styles.advancedToggle}
                      onPress={() => setShowAdvanced((s) => !s)}
                      testID="savings-rrsp-advanced-toggle"
                    >
                      <Typography variant="caption1" weight="semibold" color={theme.pastel.teal}>
                        {showAdvanced ? 'Hide advanced' : 'Advanced (prior income · pension adj.)'}
                      </Typography>
                      <Icon
                        name={showAdvanced ? 'chevron-up' : 'chevron-down'}
                        size={IconSize.sm}
                        color={theme.pastel.teal}
                      />
                    </TouchableOpacity>
                    {showAdvanced && (
                      <>
                        <Typography variant="caption2" color={colors.textTertiary}>
                          Reference only once your NOA room is entered.
                        </Typography>
                        <TextInput
                          label="Prior year earned income ($)"
                          placeholder="0"
                          value={accountForm.priorEarnedIncome}
                          onChangeText={(v) => updateForm({ priorEarnedIncome: v })}
                          keyboardType="decimal-pad"
                        />
                        <TextInput
                          label="Pension adjustment ($)"
                          placeholder="0"
                          value={accountForm.pensionAdjustment}
                          onChangeText={(v) => updateForm({ pensionAdjustment: v })}
                          keyboardType="decimal-pad"
                        />
                      </>
                    )}
                    <View style={styles.limitRow}>
                      <View style={styles.flex}>
                        <TextInput
                          label="This year’s RRSP dollar limit ($, optional)"
                          placeholder="0"
                          value={accountForm.annualLimitOverride}
                          onChangeText={(v) => updateForm({ annualLimitOverride: v })}
                          keyboardType="decimal-pad"
                          testID="savings-rrsp-annual-limit"
                        />
                      </View>
                    </View>
                    {!accountForm.annualLimitOverride.trim() && (
                      <TouchableOpacity
                        onPress={() =>
                          updateForm({
                            annualLimitOverride: centsToDollarsString(
                              RRSP_DOLLAR_LIMIT_PREFILL_CENTS
                            ),
                          })
                        }
                        testID="savings-rrsp-prefill-limit"
                      >
                        <Typography variant="caption1" color={theme.pastel.teal}>
                          Use CRA limit ({formatCurrency(RRSP_DOLLAR_LIMIT_PREFILL_CENTS)})
                        </Typography>
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {accountForm.account_type === 'tfsa' && (
                  <>
                    <TextInput
                      label="Your TFSA contribution room (from CRA My Account) ($)"
                      placeholder="0"
                      value={accountForm.startingRoom}
                      onChangeText={(v) => updateForm({ startingRoom: v })}
                      keyboardType="decimal-pad"
                      testID="savings-tfsa-room"
                    />
                    <TextInput
                      label="This year’s TFSA limit ($, optional)"
                      placeholder="0"
                      value={accountForm.annualLimitOverride}
                      onChangeText={(v) => updateForm({ annualLimitOverride: v })}
                      keyboardType="decimal-pad"
                      testID="savings-tfsa-annual-limit"
                    />
                  </>
                )}

                {accountForm.account_type === 'fhsa' && (
                  <TextInput
                    label="Balance ($)"
                    placeholder="0"
                    value={accountForm.balance}
                    onChangeText={(v) => updateForm({ balance: v })}
                    keyboardType="decimal-pad"
                    testID="savings-fhsa-balance"
                  />
                )}

                {/* Regular monthly contribution (all types) */}
                <TextInput
                  label="Regular monthly contribution ($, optional)"
                  placeholder="e.g. RRSP employer matching"
                  value={accountForm.regularContribution}
                  onChangeText={(v) => updateForm({ regularContribution: v })}
                  keyboardType="decimal-pad"
                  testID="savings-regular-contribution"
                />

                <Typography variant="caption2" color={colors.textTertiary}>
                  Estimate only — verify on CRA My Account.
                </Typography>

                <Button
                  title={accountForm.id ? 'Save changes' : 'Add account'}
                  variant="primary"
                  onPress={() => void saveAccountForm()}
                  loading={isSavingAccountForm}
                  disabled={isSavingAccountForm || !isAccountDirty}
                  fullWidth
                  style={styles.submitButton}
                  testID="savings-account-submit"
                />
                {accountForm.id && (
                  <Button
                    title="Delete account"
                    variant="ghost"
                    onPress={() => {
                      const acc = accounts.find((a) => a.id === accountForm.id);
                      if (acc) {
                        setAccountForm(null);
                        handleDeleteAccount(acc);
                      }
                    }}
                    disabled={isSavingAccountForm}
                    textColor={colors.error}
                    fullWidth
                  />
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Log contribution modal */}
      <Modal visible={!!logAccount} transparent animationType="slide" onRequestClose={closeLog}>
        <View
          style={[
            styles.modalOverlay,
            { backgroundColor: colors.modalBackdrop, paddingBottom: keyboardInset },
          ]}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeLog}
            accessibilityLabel="Close"
          />
          <View style={[styles.sheet, styles.logSheet, { backgroundColor: colors.backgroundMain }]}>
            <OverlaySheetHeader
              title="Log contribution"
              onClose={closeLog}
              closeTestID="savings-log-close"
            />
            <View style={styles.sheetContent}>
              {logAccount && (
                <Typography variant="caption1" color={colors.textSecondary}>
                  {ACCOUNT_TYPE_LABEL[logAccount.account_type]}
                  {logAccount.member_id
                    ? ` · ${memberNameById.get(logAccount.member_id) ?? 'Member'}`
                    : ''}
                </Typography>
              )}

              <TextInput
                label="Amount ($)"
                placeholder="0"
                value={logAmount}
                onChangeText={setLogAmount}
                keyboardType="decimal-pad"
                testID="savings-log-amount"
              />

              {/* Contribution / Withdrawal */}
              <View style={styles.chipRow}>
                {(['contribution', 'withdrawal'] as RegisteredTransactionType[]).map((t) => {
                  const active = logType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.chip,
                        styles.chipFlex,
                        {
                          borderColor: theme.pastel.teal,
                          backgroundColor: active ? theme.pastel.teal : 'transparent',
                        },
                      ]}
                      onPress={() => setLogType(t)}
                      testID={`savings-log-type-${t}`}
                    >
                      <Typography
                        variant="caption1"
                        weight="semibold"
                        color={active ? colors.white : theme.pastel.teal}
                      >
                        {t === 'contribution' ? 'Contribution' : 'Withdrawal'}
                      </Typography>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Regular / Manual */}
              <View style={styles.chipRow}>
                {(['manual', 'regular'] as RegisteredTransactionKind[]).map((k) => {
                  const active = logKind === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      style={[
                        styles.chip,
                        styles.chipFlex,
                        {
                          borderColor: theme.pastel.skyBlue,
                          backgroundColor: active ? theme.pastel.skyBlue : 'transparent',
                        },
                      ]}
                      onPress={() => setLogKind(k)}
                      testID={`savings-log-kind-${k}`}
                    >
                      <Typography
                        variant="caption1"
                        weight="semibold"
                        color={active ? colors.white : theme.pastel.skyBlue}
                      >
                        {k === 'manual' ? 'Manual' : 'Regular'}
                      </Typography>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Who contributed (contributions only) — employer match counts toward
                  room + goal but is shown separately. */}
              {logType === 'contribution' && (
                <View style={styles.chipRow}>
                  {(['self', 'employer'] as RegisteredContributor[]).map((cx) => {
                    const active = logContributor === cx;
                    return (
                      <TouchableOpacity
                        key={cx}
                        style={[
                          styles.chip,
                          styles.chipFlex,
                          {
                            borderColor: theme.pastel.teal,
                            backgroundColor: active ? theme.pastel.teal : 'transparent',
                          },
                        ]}
                        onPress={() => setLogContributor(cx)}
                        testID={`savings-log-contributor-${cx}`}
                      >
                        <Typography
                          variant="caption1"
                          weight="semibold"
                          color={active ? colors.white : theme.pastel.teal}
                        >
                          {cx === 'self' ? 'You' : 'Employer'}
                        </Typography>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <Button
                title="Log contribution"
                variant="primary"
                onPress={() => void handleLogTransaction()}
                loading={isLoggingTx}
                disabled={isLoggingTx}
                fullWidth
                style={styles.submitButton}
                testID="savings-log-submit"
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
    </AppBackground>
  );
}

// ============ Account card (room bar from getRoom — no local room math) ============

interface AccountCardProps {
  account: RegisteredAccount;
  room: RegisteredRoom | undefined;
  tealColor: string;
  onEdit: () => void;
  onLog: () => void;
  onApplyRegular: () => void;
  isApplying: boolean;
  isApplied: boolean;
}

function AccountCard({
  account,
  room,
  tealColor,
  onEdit,
  onLog,
  onApplyRegular,
  isApplying,
  isApplied,
}: AccountCardProps) {
  const { theme } = useTheme();
  const colors = useAppColors();

  const overContribution = room?.warnings.includes('ROOM_OVER_CONTRIBUTION') ?? false;
  const annualLimit = room?.annualLimit ?? 0;
  const regularUsed = room?.usedByKind.regular ?? 0;
  const manualUsed = room?.usedByKind.manual ?? 0;

  // Bar widths are a visual proportion of the annual limit (presentation only —
  // all figures themselves come from getRoom). Guard divide-by-zero.
  const denom = annualLimit > 0 ? annualLimit : Math.max(regularUsed + manualUsed, 1);
  const regularPct = Math.min(100, (regularUsed / denom) * 100);
  const manualPct = Math.min(100, Math.max(0, ((regularUsed + manualUsed) / denom) * 100 - regularPct));

  const hasRegularContribution = (account.regular_contribution_cents ?? 0) > 0;

  return (
    <Card variant="outlined" style={styles.accountCard} testID="savings-account-card">
      <View style={styles.accountHeader}>
        {account.institution ? <InstitutionLogo name={account.institution} size={32} /> : null}
        <View style={styles.flex}>
          <Typography variant="body" weight="semibold">
            {ACCOUNT_TYPE_LABEL[account.account_type]}
            {account.institution ? ` · ${account.institution}` : ''}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            Balance {formatCurrency(account.balance_cents)}
          </Typography>
        </View>
        <TouchableOpacity onPress={onEdit} testID="savings-account-edit" hitSlop={8}>
          <Icon name="pencil" size={IconSize.sm} color={tealColor} />
        </TouchableOpacity>
      </View>

      {/* Room used bar (regular + manual split vs annual limit) */}
      <View style={styles.roomBarTrack}>
        <View
          style={[styles.roomBarSegment, { width: `${regularPct}%`, backgroundColor: theme.pastel.skyBlue }]}
        />
        <View
          style={[styles.roomBarSegment, { width: `${manualPct}%`, backgroundColor: tealColor }]}
        />
      </View>

      <View style={styles.roomStatsRow}>
        <Typography variant="caption1" color={colors.textSecondary}>
          {formatCurrency(room?.used ?? 0)} of {formatCurrency(annualLimit)} used
        </Typography>
        <Typography variant="caption1" weight="semibold" color={overContribution ? colors.error : colors.success}>
          {formatCurrency(room?.roomRemaining ?? 0)} left
        </Typography>
      </View>

      <View style={styles.roomLegendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: theme.pastel.skyBlue }]} />
          <Typography variant="caption2" color={colors.textSecondary}>
            Regular {formatCurrency(regularUsed)}
          </Typography>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: tealColor }]} />
          <Typography variant="caption2" color={colors.textSecondary}>
            Manual {formatCurrency(manualUsed)}
          </Typography>
        </View>
      </View>

      {overContribution && (
        <View style={[styles.warnBadge, { backgroundColor: colors.surfaceSelected }]} testID="savings-over-contribution-badge">
          <Icon name="warning-outline" size={IconSize.sm} color={colors.error} />
          <Typography variant="caption2" weight="semibold" color={colors.error}>
            Over contribution room
          </Typography>
        </View>
      )}

      <View style={styles.accountActions}>
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: tealColor }]}
          onPress={onLog}
          testID="savings-account-log"
        >
          <Icon name="add-circle-outline" size={IconSize.sm} color={tealColor} />
          <Typography variant="caption1" weight="semibold" color={tealColor}>
            Log
          </Typography>
        </TouchableOpacity>

        {hasRegularContribution && (
          <TouchableOpacity
            style={[
              styles.actionBtn,
              {
                borderColor: isApplied ? colors.success : tealColor,
                opacity: isApplying || isApplied ? 0.7 : 1,
              },
            ]}
            onPress={onApplyRegular}
            disabled={isApplying || isApplied}
            testID="savings-account-apply-regular"
          >
            {isApplying ? (
              <ActivityIndicator size="small" color={tealColor} />
            ) : (
              <Icon
                name={isApplied ? 'checkmark-circle' : 'sync-outline'}
                size={IconSize.sm}
                color={isApplied ? colors.success : tealColor}
              />
            )}
            <Typography
              variant="caption1"
              weight="semibold"
              color={isApplied ? colors.success : tealColor}
            >
              {isApplied ? 'Applied' : 'Apply monthly'}
            </Typography>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: 16,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    marginBottom: 16,
  },
  bannerText: { flex: 1 },
  empty: { paddingVertical: 40 },
  group: { marginBottom: 20 },
  groupTitle: { marginBottom: 8, marginLeft: 4 },
  accountCard: { marginBottom: 12, gap: 10 },
  accountHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  roomBarTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(120,120,128,0.16)',
    overflow: 'hidden',
  },
  roomBarSegment: { height: '100%' },
  roomStatsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roomLegendRow: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  warnBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  accountActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  disclaimer: { marginTop: 8 },
  // Modals
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  logSheet: { maxHeight: '70%' },
  // `flexShrink: 1` is what lets the form give up height once the keyboard
  // tightens the sheet's cap — without it the scroller keeps its content
  // height and pushes the sheet off the top of the screen instead.
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetContent: { padding: 20, paddingTop: 8, gap: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  chipFlex: { flex: 1, alignItems: 'center' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  toggleLabel: { flex: 1 },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  limitRow: { flexDirection: 'row', gap: 12 },
  submitButton: { marginTop: 8 },
});
