import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { mortgageApi, type CreateStatementRequest, type StoredRatePeriod } from '@api/mortgage';
import { CloudFilePicker } from '@components/cloud-storage';
import { AppBackground, ProcessingOverlay, SafeAreaView, ScanImportSources, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Card, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { budgetLocalUnsupportedCopyFromError } from '@features/budget/local/ai/localAiUnsupported';
import type { BudgetStackParamList } from '@navigation/types';
import ImageCropPicker from '@services/image-picker-compat';
import { useHouseholdStore } from '@stores/householdStore';
import { useMortgageStore } from '@stores/mortgageStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

const MORTGAGE_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

interface Attachment {
  uri: string;
  name: string;
  type: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function dollarsToCents(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
/** Percent string ("3.59") → basis points (359). Rates are stored in bps. */
function pctToBps(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const pctNumToBps = (v: number | null): number | null =>
  v != null && Number.isFinite(v) ? Math.round(v * 100) : null;
/** Read `{ ratePeriods }` back out of a statement's raw_extraction_json (safe). */
function parseStoredRatePeriods(raw: string | null | undefined): StoredRatePeriod[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { ratePeriods?: StoredRatePeriod[] };
    return Array.isArray(parsed?.ratePeriods) ? parsed.ratePeriods : [];
  } catch {
    return [];
  }
}
function inferMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}
/**
 * Statement review + manual entry, with AI import from the SAME four sources as
 * the receipt scanner (Camera · Gallery · File · Google Drive). Committing a
 * statement RE-ANCHORS the mortgage balance (reconciliation). The AI draft is
 * PII-scrubbed server-side (no full number / no name). Dedup 409 → replace.
 */
function centsToInput(cents: number | null | undefined): string {
  return cents != null ? String(cents / 100) : '';
}

export function MortgageStatementFormScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<BudgetStackParamList, 'MortgageStatementForm'>>();
  const mortgageId = route.params?.mortgageId;
  // When a `statement` is passed we're EDITING it: prefill the fields, retitle,
  // and commit with `replace` so the same-date row is overwritten in place.
  const editing = route.params?.statement ?? null;
  const { currentHousehold } = useHouseholdStore();
  const markDirty = useMortgageStore((s) => s.markDirty);

  const [statementDate, setStatementDate] = useState(editing?.statement_date ?? todayISO());
  const [closing, setClosing] = useState(editing ? centsToInput(editing.closing_balance_cents) : '');
  const [interestPaid, setInterestPaid] = useState(centsToInput(editing?.interest_paid_cents));
  const [principalPaid, setPrincipalPaid] = useState(centsToInput(editing?.principal_paid_cents));
  const [payment, setPayment] = useState(centsToInput(editing?.payment_amount_cents));
  // The interest rate the statement reported (%). THIS is what re-bases the
  // forward projection: the summary's forward rate = the latest statement's
  // rate, so without it a variable/HELOC mortgage keeps modelling the original
  // sign-up rate no matter how many rate-changed statements are uploaded.
  const [rate, setRate] = useState(
    editing?.interest_rate_bps != null ? String(editing.interest_rate_bps / 100) : ''
  );
  // Prime + variance ride along from the AI draft (not manually edited) so the
  // statement carries the full rate breakdown the columns already support.
  const [primeRateBps, setPrimeRateBps] = useState<number | null>(editing?.prime_rate_bps ?? null);
  const [varianceBps, setVarianceBps] = useState<number | null>(editing?.variance_bps ?? null);
  // The statement's per-sub-period rate breakdown (bps). This is what lets us
  // detect a mid-period rate change (e.g. Oct 30) automatically from ONE upload —
  // persisted verbatim in raw_extraction_json and read back by the rate chart.
  const [ratePeriods, setRatePeriods] = useState<StoredRatePeriod[]>(
    parseStoredRatePeriods(editing?.raw_extraction_json)
  );
  // Where the statement came from — tags the row (Scanned / From file / …) and
  // defaults to the original source when editing.
  const [sourceKind, setSourceKind] = useState<CreateStatementRequest['source']>(
    (editing?.source as CreateStatementRequest['source']) ?? 'manual'
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  // Manual entry is collapsed by default when ADDING — the primary path is
  // Scan / import. Editing an existing statement opens straight to the fields.
  const [manualOpen, setManualOpen] = useState(false);

  const runExtract = async (raw: Attachment) => {
    if (!currentHousehold?.id || !mortgageId) return;
    setError(null);
    setScanning(true);
    try {
      const att = await toVisionSafeAttachment(raw);
      const form = new FormData();
      form.append('file', { uri: att.uri, name: att.name, type: att.type } as unknown as Blob);
      const { draft } = await mortgageApi.extractStatement(currentHousehold.id, mortgageId, form);
      if (draft.statementDate) setStatementDate(draft.statementDate);
      if (draft.closingBalance != null) setClosing(String(draft.closingBalance));
      if (draft.interestPaid != null) setInterestPaid(String(draft.interestPaid));
      if (draft.principalPaid != null) setPrincipalPaid(String(draft.principalPaid));
      if (draft.paymentAmount != null) setPayment(String(draft.paymentAmount));
      // Capture the rate the bank charged this period — the piece that makes a
      // rate change actually take effect in the forecast.
      if (draft.interestRate != null) setRate(String(draft.interestRate));
      if (draft.primeRate != null) setPrimeRateBps(Math.round(draft.primeRate * 100));
      if (draft.variance != null) setVarianceBps(Math.round(draft.variance * 100));
      // Keep the full sub-period breakdown so a mid-period change is detectable.
      if (Array.isArray(draft.ratePeriods) && draft.ratePeriods.length) {
        setRatePeriods(
          draft.ratePeriods.map((p) => ({
            effectiveDate: p.effectiveDate,
            rateBps: Math.round(p.interestRate * 100),
            primeRateBps: pctNumToBps(p.primeRate),
            varianceBps: pctNumToBps(p.variance),
          }))
        );
      }
    } catch (error) {
      const offlineCopy = budgetLocalUnsupportedCopyFromError(error, 'mortgage-extract');
      setError(
        offlineCopy?.message ??
          'Could not read that statement. Please enter the values manually.',
      );
    } finally {
      setScanning(false);
      // Either way the member now needs the fields — to review what we read, or
      // to type the values in after a failed read.
      setManualOpen(true);
    }
  };

  const pickCamera = async () => {
    try {
      const image = await ImageCropPicker.openCamera({ cropping: false, compressImageQuality: 0.8, mediaType: 'photo' });
      setSourceKind('camera');
      await runExtract({ uri: image.path, name: image.filename || 'statement.jpg', type: image.mime || 'image/jpeg' });
    } catch (e) {
      if (isPickerPermissionError(e)) presentPickerPermissionDeniedAlert('camera');
      else if ((e as { code?: string }).code !== 'E_PICKER_CANCELLED') Alert.alert('Error', 'Could not open the camera.');
    }
  };
  const pickGallery = async () => {
    try {
      const image = await ImageCropPicker.openPicker({ cropping: false, compressImageQuality: 0.8, mediaType: 'photo' });
      setSourceKind('gallery');
      await runExtract({ uri: image.path, name: image.filename || 'statement.jpg', type: image.mime || 'image/jpeg' });
    } catch (e) {
      if (isPickerPermissionError(e)) presentPickerPermissionDeniedAlert('library');
      else if ((e as { code?: string }).code !== 'E_PICKER_CANCELLED') Alert.alert('Error', 'Could not open the photo library.');
    }
  };
  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: [...MORTGAGE_MIMES], copyToCacheDirectory: true });
      if (!result.canceled && result.assets[0]) {
        const a = result.assets[0];
        setSourceKind('file');
        await runExtract({ uri: a.uri, name: a.name || 'statement', type: a.mimeType || inferMime(a.name || '') });
      }
    } catch {
      Alert.alert('Error', 'Could not open the file picker.');
    }
  };
  const onDriveFile = (file: { uri: string; name: string; size: number }) => {
    setShowDrivePicker(false);
    const name = file.name || 'statement';
    setSourceKind('google_drive');
    runExtract({ uri: file.uri, name, type: inferMime(name) });
  };

  const commit = async (replace: boolean) => {
    setError(null);
    const closingCents = dollarsToCents(closing);
    if (!currentHousehold?.id || !mortgageId) {
      return Alert.alert('Missing mortgage', 'We could not find the mortgage to update.');
    }
    if (closingCents == null || closingCents < 0) {
      return Alert.alert('Closing balance needed', 'Enter the closing balance before saving.');
    }
    const body: CreateStatementRequest = {
      statementDate,
      closingBalanceCents: closingCents,
      interestPaidCents: dollarsToCents(interestPaid),
      principalPaidCents: dollarsToCents(principalPaid),
      paymentAmountCents: dollarsToCents(payment),
      // The rate re-bases the forward projection (variable/HELOC borrowers see
      // the actual rate movement, not the frozen sign-up rate).
      interestRateBps: pctToBps(rate),
      primeRateBps,
      varianceBps,
      // The sub-period breakdown powers automatic rate-change detection (chart +
      // change list). Sent as typed rows (→ `mortgage_rate_periods`, the
      // queryable rate axis); the JSON blob is kept in step for older clients
      // reading `raw_extraction_json`. Only sent when the statement carried one —
      // omitting `ratePeriods` lets the backend derive one from the headline rate.
      ratePeriods: ratePeriods.length ? ratePeriods : undefined,
      rawExtractionJson: ratePeriods.length ? JSON.stringify({ ratePeriods }) : undefined,
      source: sourceKind,
      // Editing always overwrites the row we opened; adds only replace after a 409.
      replace: editing ? true : replace,
    };
    setSaving(true);
    try {
      await mortgageApi.addStatement(currentHousehold.id, mortgageId, body);
      // If an edit MOVED the statement to a new date, drop the original-dated
      // row so we don't leave a stale duplicate behind.
      if (editing && editing.statement_date !== statementDate) {
        try {
          await mortgageApi.deleteStatement(currentHousehold.id, mortgageId, editing.id);
        } catch {
          /* best-effort cleanup — the new row is already saved */
        }
      }
      markDirty();
      // Confirm, then close the screen when the member dismisses the dialog.
      Alert.alert(
        editing ? 'Statement updated' : 'Statement saved',
        'Your figures are reconciled to the new closing balance.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        // Not a hard error — offer to overwrite the same-date row.
        Alert.alert(
          'Statement already exists',
          'A statement for this date already exists. Replace it?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Replace', style: 'destructive', onPress: () => commit(true) },
          ]
        );
      } else {
        Alert.alert('Could not save', 'Something went wrong saving your statement. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const busy = scanning || saving;

  // While a statement is being read or saved, the member must not be able to
  // leave the screen and orphan the in-flight request — disable the swipe-back
  // gesture and swallow any `beforeRemove` (hardware back / edge swipe).
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !busy });
  }, [navigation, busy]);
  useEffect(() => {
    if (!busy) return;
    const unsub = navigation.addListener('beforeRemove', (e) => e.preventDefault());
    return unsub;
  }, [navigation, busy]);

  // Save lives in the header — reachable with the numeric keypad open (a bottom
  // button gets occluded) and only shown once there are fields to save.
  const saveAction =
    manualOpen || editing ? (
      <TouchableOpacity
        onPress={() => commit(false)}
        disabled={busy}
        activeOpacity={0.7}
        testID="mortgage-statement-save"
      >
        <Typography variant="body" weight="semibold" color={busy ? colors.textSecondary : colors.primary}>
          {saving ? 'Saving…' : 'Save'}
        </Typography>
      </TouchableOpacity>
    ) : undefined;

  return (
    <AppBackground>
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScreenHeader
        title={editing ? 'Edit statement' : 'Add statement'}
        showBackButton
        onBackPress={() => {
          if (!busy) navigation.goBack();
        }}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={saveAction}
      />
      <ScrollView
        {...keyboardDismissScrollProps}
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.body}
      >
        {editing ? null : (
          <View style={styles.scanSection}>
            <Typography variant="label" weight="semibold">
              Scan / import (AI)
            </Typography>
            <Typography variant="caption" color={colors.textSecondary}>
              Pick a PDF or photo — we read it and fill the fields below. Your account number and name are
              never stored.
            </Typography>
            <ScanImportSources
              testIDPrefix="mortgage-statement"
              disabled={busy}
              onCamera={pickCamera}
              onGallery={pickGallery}
              onFile={pickFile}
              onDrive={() => setShowDrivePicker(true)}
            />
          </View>
        )}

        {/* Manual entry is the secondary path — collapsed behind a tap so the
            scan sources lead. Editing skips the toggle and opens the fields. */}
        {editing ? null : (
          <TouchableOpacity
            style={[
              styles.manualToggle,
              { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
            ]}
            onPress={() => setManualOpen((open) => !open)}
            accessibilityRole="button"
            testID="mortgage-statement-manual-toggle"
          >
            <View style={styles.manualToggleText}>
              <Typography variant="label" weight="semibold">
                Enter manually
              </Typography>
              <Typography variant="caption" color={colors.textSecondary}>
                Prefer to type it in? Fill the statement values yourself.
              </Typography>
            </View>
            <Icon
              name={manualOpen ? 'chevron-up' : 'chevron-down'}
              size={IconSize.md}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        )}

        {manualOpen || editing ? (
          <View style={styles.manualFields} testID="mortgage-statement-manual-fields">
            <TextInput label="Statement date (YYYY-MM-DD)" value={statementDate} onChangeText={setStatementDate} />
            <TextInput label="Closing balance ($)" placeholder="480000" keyboardType="decimal-pad" value={closing} onChangeText={setClosing} />
            <TextInput label="Interest paid ($)" keyboardType="decimal-pad" value={interestPaid} onChangeText={setInterestPaid} />
            <TextInput label="Principal paid ($)" keyboardType="decimal-pad" value={principalPaid} onChangeText={setPrincipalPaid} />
            <TextInput label="Payment amount ($)" keyboardType="decimal-pad" value={payment} onChangeText={setPayment} />
            <TextInput label="Interest rate (%)" placeholder="3.59" keyboardType="decimal-pad" value={rate} onChangeText={setRate} />

            <Card variant="filled" style={styles.note}>
              <Typography variant="caption" color={colors.textSecondary}>
                Your closing balance becomes the confirmed anchor — every figure reconciles to it.
              </Typography>
            </Card>

            {error ? (
              <Typography variant="caption" color={colors.error}>
                {error}
              </Typography>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        mimeTypeFilter={[...MORTGAGE_MIMES]}
        rememberScope="mortgage-statements"
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={onDriveFile}
      />

      {/* Unskippable while we read the statement — blocks the whole screen so the
          member can't tap a source twice or leave with a request in flight. */}
      <ProcessingOverlay
        visible={scanning}
        message="Reading your statement…"
        caption="Extracting details with AI"
      />
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Layout.bottomTabBarClearance },
  scanSection: { gap: Spacing.sm },
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  manualToggleText: { flex: 1, gap: Spacing.xxs },
  manualFields: { gap: Spacing.md },
  note: { padding: Spacing.base },
});
