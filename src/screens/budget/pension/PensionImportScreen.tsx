import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import {
  savingsApi,
  type ExtractedRegisteredStatement,
  type RegisteredAccountType,
  type RegisteredContributor,
  type RegisteredImportAccountInput,
} from '@api/savings';
import { AIAccessGate } from '@components/ai/AIAccessGate';
import { AppBackground, ProcessingOverlay, SafeAreaView, screenScrollViewStyle, ScreenHeader } from '@components/common';
import { Button, Card, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { usePensionStore } from '@stores/pensionStore';
import { useSavingsStore } from '@stores/savingsStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';


const STATEMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ACCOUNT_TYPES: Array<{ value: RegisteredAccountType; label: string }> = [
  { value: 'tfsa', label: 'TFSA' },
  { value: 'rrsp', label: 'RRSP' },
  { value: 'fhsa', label: 'FHSA' },
  { value: 'dpsp', label: 'DPSP' },
  { value: 'rpp', label: 'RPP' },
];

/** One editable draft account (extracted + user overrides) held in local state. */
interface DraftAccount {
  key: string;
  account_type: RegisteredAccountType;
  institution: string | null;
  is_employer_plan: boolean;
  employer_name: string | null;
  balanceCents: number | null;
  memberId: string | null;
  include: boolean;
  contributions: Array<{ amountCents: number; date: string; contributor: RegisteredContributor }>;
}

function toCents(dollars: number | null): number | null {
  if (dollars == null) return null;
  return Math.round(dollars * 100);
}

/**
 * Pension → Import statement (AI). Paste text or upload a PDF/image of an RRSP / TFSA /
 * FHSA / DPSP / pension statement; the backend extracts a draft of accounts +
 * contributions (with an employee/employer split) which the user reviews, assigns to a
 * household member, and commits. THIN CLIENT — extraction + room math are server-side.
 */
export function PensionImportScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold, currentHouseholdMembers } = useHouseholdStore();
  const { selectedYear, markDirty: markPensionDirty } = usePensionStore();
  const markSavingsDirty = useSavingsStore((s) => s.markDirty);

  const [pastedText, setPastedText] = useState('');
  const [attachment, setAttachment] = useState<{ uri: string; name: string; type: string } | null>(
    null
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [drafts, setDrafts] = useState<DraftAccount[] | null>(null);

  const draftFromExtract = useCallback(
    (extract: ExtractedRegisteredStatement): DraftAccount[] =>
      extract.accounts.map((a, i) => ({
        key: `${i}`,
        account_type: a.account_type ?? 'rrsp',
        institution: a.institution,
        is_employer_plan: a.is_employer_plan,
        employer_name: a.employer_name,
        balanceCents: toCents(a.balance),
        memberId: null,
        include: true,
        contributions: a.contributions
          .filter((c) => c.amount != null && c.amount > 0)
          .map((c) => ({
            amountCents: toCents(c.amount) ?? 0,
            date: c.date ?? `${selectedYear}-01-01`,
            contributor: c.contributor,
          })),
      })),
    [selectedYear]
  );

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: STATEMENT_MIMES,
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        if (typeof asset.size === 'number' && asset.size > MAX_UPLOAD_BYTES) {
          Alert.alert('File too large', 'Please choose a file under 20 MB.');
          return;
        }
        setAttachment({
          uri: asset.uri,
          name: asset.name || 'statement',
          type: asset.mimeType || 'application/pdf',
        });
      }
    } catch (error) {
      console.error('Error picking statement file:', error);
      Alert.alert('Error', 'Could not open the file picker.');
    }
  }, []);

  const analyze = useCallback(async () => {
    if (!currentHousehold?.id) return;
    const hid = currentHousehold.id;
    const text = pastedText.trim();
    if (!text && !attachment) {
      Alert.alert('Nothing to analyze', 'Paste your statement text or choose a file first.');
      return;
    }
    setIsAnalyzing(true);
    try {
      const { draft } = attachment
        ? await savingsApi.extractRegisteredStatementFile(hid, attachment, text || undefined)
        : await savingsApi.extractRegisteredStatementText(hid, text);
      const editable = draftFromExtract(draft);
      if (editable.length === 0) {
        Alert.alert('No accounts found', 'We could not read any accounts. Try clearer text or a file.');
      }
      setDrafts(editable);
    } catch (error) {
      console.error('Error analyzing statement:', error);
      Alert.alert('Error', 'Could not analyze this statement. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [attachment, currentHousehold?.id, draftFromExtract, pastedText]);

  const patchDraft = useCallback((key: string, patch: Partial<DraftAccount>) => {
    setDrafts((prev) => prev?.map((d) => (d.key === key ? { ...d, ...patch } : d)) ?? prev);
  }, []);

  const commit = useCallback(async () => {
    if (!currentHousehold?.id || !drafts) return;
    const hid = currentHousehold.id;
    const included = drafts.filter((d) => d.include && d.contributions.length > 0);
    if (included.length === 0) {
      Alert.alert('Nothing to add', 'Select at least one account with contributions.');
      return;
    }
    const accounts: RegisteredImportAccountInput[] = included.map((d) => ({
      id: Crypto.randomUUID(),
      account_type: d.account_type,
      member_id: d.memberId,
      institution: d.institution,
      is_employer_plan: d.is_employer_plan,
      employer_name: d.employer_name,
      balance_cents: d.balanceCents ?? undefined,
      contributions: d.contributions.map((c) => ({
        id: Crypto.randomUUID(),
        amount_cents: c.amountCents,
        transaction_date: c.date,
        contributor: c.contributor,
        tax_year: Number(c.date.substring(0, 4)),
      })),
    }));

    setIsCommitting(true);
    try {
      await savingsApi.commitRegisteredImport(hid, {
        import_batch_id: Crypto.randomUUID(),
        accounts,
      });
      markPensionDirty();
      markSavingsDirty();
      navigation.goBack();
    } catch (error) {
      console.error('Error committing pension import:', error);
      Alert.alert('Error', 'Could not save these accounts. Please try again.');
    } finally {
      setIsCommitting(false);
    }
  }, [currentHousehold?.id, drafts, markPensionDirty, markSavingsDirty, navigation]);

  const memberChips = useMemo(
    // member_id is the membership id (HouseholdMember.id) — the backend's canonical
    // member key for registered/pension lines, not user_id.
    () => currentHouseholdMembers.map((m) => ({ id: m.id, label: m.display_name ?? 'Member' })),
    [currentHouseholdMembers]
  );

  return (
    <AIAccessGate title="Unlock AI for pension import">
    <AppBackground>
    <SafeAreaView edges={[]} testID="pension-import">
      <ScreenHeader
        title="Import statement"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />

      <ScrollView
        {...keyboardDismissScrollProps}
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {!drafts ? (
          <>
            <Typography variant="body" color={colors.textSecondary}>
              Paste the text from your RRSP / TFSA / FHSA or workplace-pension statement, or upload
              a PDF or photo. We'll pull out the accounts and contributions for you to review.
            </Typography>

            <TextInput
              label="Statement text (optional if you upload a file)"
              placeholder="Paste statement details here…"
              value={pastedText}
              onChangeText={setPastedText}
              multiline
              style={styles.textArea}
              testID="pension-import-text"
            />

            <TouchableOpacity
              style={[styles.fileButton, { borderColor: colors.primary }]}
              onPress={pickFile}
              testID="pension-import-pick-file"
            >
              <Icon name="document-attach-outline" size={18} color={colors.primary} />
              <Typography variant="caption1" weight="semibold" color={colors.primary}>
                {attachment ? attachment.name : 'Choose PDF or image'}
              </Typography>
            </TouchableOpacity>

            <Button
              title="Analyze"
              variant="primary"
              onPress={() => void analyze()}
              loading={isAnalyzing}
              disabled={isAnalyzing}
              fullWidth
              testID="pension-import-analyze"
            />
          </>
        ) : (
          <>
            <Typography variant="body" weight="semibold">
              Review {drafts.length} account{drafts.length === 1 ? '' : 's'}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              Pick the owner and confirm the type before adding. Employer contributions count
              toward room and goals automatically.
            </Typography>

            {drafts.map((d) => {
              const total = d.contributions.reduce((s, c) => s + c.amountCents, 0);
              return (
                <Card key={d.key} variant="outlined" style={styles.draftCard} testID="pension-import-draft">
                  <View style={styles.draftHeader}>
                    <Typography variant="body" weight="semibold">
                      {d.institution ?? 'Account'}
                    </Typography>
                    <TouchableOpacity
                      onPress={() => patchDraft(d.key, { include: !d.include })}
                      hitSlop={8}
                      testID="pension-import-toggle-include"
                    >
                      <Icon
                        name={d.include ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        color={d.include ? colors.success : colors.textTertiary}
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Account type */}
                  <View style={styles.chipRow}>
                    {ACCOUNT_TYPES.map((t) => {
                      const active = d.account_type === t.value;
                      return (
                        <TouchableOpacity
                          key={t.value}
                          style={[
                            styles.chip,
                            { borderColor: colors.primary, backgroundColor: active ? colors.primary : 'transparent' },
                          ]}
                          onPress={() => patchDraft(d.key, { account_type: t.value })}
                        >
                          <Typography
                            variant="caption2"
                            weight="semibold"
                            color={active ? colors.white : colors.primary}
                          >
                            {t.label}
                          </Typography>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Owner */}
                  {memberChips.length > 0 && (
                    <View style={styles.chipRow}>
                      {memberChips.map((m) => {
                        const active = d.memberId === m.id;
                        return (
                          <TouchableOpacity
                            key={m.id}
                            style={[
                              styles.chip,
                              { borderColor: colors.info, backgroundColor: active ? colors.info : 'transparent' },
                            ]}
                            onPress={() => patchDraft(d.key, { memberId: active ? null : m.id })}
                          >
                            <Typography
                              variant="caption2"
                              weight="semibold"
                              color={active ? colors.white : colors.info}
                            >
                              {m.label}
                            </Typography>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  <View style={styles.draftStats}>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {d.contributions.length} contribution{d.contributions.length === 1 ? '' : 's'}
                    </Typography>
                    <Typography variant="caption1" weight="semibold">
                      {formatCurrency(total)}
                    </Typography>
                  </View>
                  {d.balanceCents != null && (
                    <Typography variant="caption2" color={colors.textTertiary}>
                      Statement balance {formatCurrency(d.balanceCents)}
                    </Typography>
                  )}
                </Card>
              );
            })}

            <Button
              title="Add to my accounts"
              variant="primary"
              onPress={() => void commit()}
              loading={isCommitting}
              disabled={isCommitting}
              fullWidth
              testID="pension-import-commit"
            />
            <Button
              title="Start over"
              variant="secondary"
              onPress={() => setDrafts(null)}
              disabled={isCommitting}
              fullWidth
            />
          </>
        )}

      </ScrollView>

      {/* Blocks the screen while we read the statement so it can't be
          re-submitted or abandoned mid-analysis. */}
      <ProcessingOverlay
        visible={isAnalyzing}
        message="Reading your statement…"
        caption="Extracting details with AI"
      />
    </SafeAreaView>
    </AppBackground>
    </AIAccessGate>
  );
}

const styles = StyleSheet.create({
  title: { flex: 1 },
  content: { padding: Spacing.base, gap: Spacing.base, paddingBottom: Spacing.xxl },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  fileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderRadius: CornerRadius.lg,
    paddingVertical: Spacing.md,
  },
  draftCard: { gap: Spacing.sm, padding: Spacing.base },
  draftHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  draftStats: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
