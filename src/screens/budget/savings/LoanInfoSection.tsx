import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  budgetLoansApi,
  type BudgetLoan,
  type LoanRateType,
  type LoanSummary,
} from '@api/budgetLoans';
import { GradientButton, ProgressBar, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useTheme } from '@contexts/ThemeContext';
import ImageCropPicker from '@services/image-picker-compat';
import { showToast } from '@services/toastManager';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { LoanFieldsForm } from './LoanFieldsForm';
import {
  bpsToPctInput,
  centsToDollarsInput,
  estimateStartDateFromProgress,
  inferLoanStatementMime,
  LOAN_STATEMENT_MIMES,
  todayIso,
  validateLoanFields,
  type LoanAttachment,
} from './loanShared';

interface LoanInfoSectionProps {
  householdId: string;
  recurringPaymentId: string;
  recurringPaymentLabel: string;
  /**
   * Fires around the "Fill with AI" extract call so the PARENT screen
   * (`SavingsRecurringPaymentsScreen`) can disable its own Save/Delete taps
   * while it's in flight — this component's own `ProcessingOverlay` is
   * `embedded` (see below) and only covers this section's own bounds, not
   * the parent form's buttons.
   */
  onScanningChange?: (scanning: boolean) => void;
  /**
   * Fires once a "Fill with AI" extract returns a monthly payment amount
   * and/or due day — these belong to the PARENT's own "Monthly amount" /
   * "Day of month" fields (this section only owns the loan-specific ones),
   * so the parent must apply them to its own form state itself. Omitted
   * fields the statement didn't show come through as `null` — the parent
   * should leave its existing value alone rather than clearing it.
   */
  onExtractedPayment?: (fields: { amountCents: number | null; dueDayOfMonth: number | null }) => void;
}

/**
 * "Track a loan" for one Monthly-Payments item — car loans, buy-now-pay-later
 * plans (IKEA-style), personal loans. Rendered inside
 * `SavingsRecurringPaymentsScreen`'s edit-payment modal alongside
 * `RenewalReminderSection`, split into its own component for the same reason.
 *
 * Self-contained: fetches/saves against `budgetLoansApi` directly. Every
 * derived number (payments remaining, interest paid to date, total interest)
 * comes back server-computed as `summary` — this component never does
 * amortization math itself.
 *
 * "Fill with AI" photographs/uploads a statement and pre-fills the fields
 * below for review — nothing is auto-saved, the member still presses
 * Save/Update. Its `ProcessingOverlay` is rendered `embedded` (no wrapping
 * `Modal`) because this whole section lives inside the parent screen's own
 * edit-payment `<Modal>`, and iOS only presents one modal per view
 * controller — a second real `Modal` here would silently never appear. The
 * Google Drive tile's `CloudFilePicker` (rendered inside the shared
 * `LoanFieldsForm` below) is a sibling within that SAME parent `<Modal>`,
 * not a second top-level `Modal` of its own — `RenewalReminderSection`
 * already proves that exact pattern presents reliably on both platforms, so
 * there's no reason for this section to omit the Drive tile.
 *
 * The actual field rows (rate chips, principal/term, start date, amount
 * already paid, "More details", and the "Fill with AI" source row incl.
 * Drive) live in the shared, stateless `LoanFieldsForm` — also used by
 * `LoanDraftSection` for the Add-payment flow, before a payment (and this
 * component) exist at all. This component keeps the data-fetching, save/
 * toggle orchestration, and the summary card.
 */
export function LoanInfoSection({
  householdId,
  recurringPaymentId,
  recurringPaymentLabel,
  onScanningChange,
  onExtractedPayment,
}: LoanInfoSectionProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const accent = theme.pastel.orange;

  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [loan, setLoan] = useState<BudgetLoan | null>(null);
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const [rateType, setRateType] = useState<LoanRateType>('fixed');
  const [ratePct, setRatePct] = useState('');
  const [principal, setPrincipal] = useState('');
  const [termMonths, setTermMonths] = useState('');

  const [startDate, setStartDate] = useState(todayIso());
  const [amountAlreadyPaid, setAmountAlreadyPaid] = useState('');

  const [moreOpen, setMoreOpen] = useState(false);
  const [lender, setLender] = useState('');
  const [notes, setNotes] = useState('');
  const [portalUrl, setPortalUrl] = useState('');

  const [aiOpen, setAiOpen] = useState(false);
  const [scanning, setScanning] = useState(false);

  const applyLoan = useCallback((l: BudgetLoan | null, s: LoanSummary | null) => {
    setLoan(l);
    setSummary(s);
    setTracking(l !== null);
    if (l) {
      setRateType(l.rate_type);
      setRatePct(bpsToPctInput(l.rate_bps));
      setPrincipal(centsToDollarsInput(l.principal_cents));
      setTermMonths(String(l.term_months));
      setStartDate(l.start_date);
      setAmountAlreadyPaid(l.amount_paid_cents != null ? centsToDollarsInput(l.amount_paid_cents) : '');
      setLender(l.lender ?? '');
      setNotes(l.notes ?? '');
      setPortalUrl(l.portal_url ?? '');
      // Auto-expand "More details" so existing data never appears to
      // "disappear" behind a collapsed section.
      if (l.lender || l.notes || l.portal_url) setMoreOpen(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    budgetLoansApi
      .get(householdId, recurringPaymentId)
      .then((result) => {
        if (cancelled) return;
        applyLoan(result.loan, result.summary);
      })
      .catch(() => {
        if (!cancelled) applyLoan(null, null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, recurringPaymentId, applyLoan]);

  const handleToggle = () => {
    if (tracking && loan) {
      Alert.alert(
        'Stop tracking this loan?',
        `This removes the principal, rate, and term you entered for "${recurringPaymentLabel}".`,
        [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop tracking',
          style: 'destructive',
          onPress: async () => {
            try {
              await budgetLoansApi.remove(householdId, recurringPaymentId);
              applyLoan(null, null);
            } catch {
              Alert.alert('Error', 'Could not remove this loan. Please try again.');
            }
          },
        },
      ]);
      return;
    }
    setTracking(true);
  };

  const runExtract = async (raw: LoanAttachment) => {
    setScanning(true);
    onScanningChange?.(true);
    try {
      const att = await toVisionSafeAttachment(raw);
      const form = new FormData();
      form.append('file', { uri: att.uri, name: att.name, type: att.type } as unknown as Blob);
      const { draft } = await budgetLoansApi.extract(householdId, recurringPaymentId, form);

      if (draft.principal_cents != null) setPrincipal(centsToDollarsInput(draft.principal_cents));
      if (draft.term_months != null) setTermMonths(String(draft.term_months));
      if (draft.rate_type) setRateType(draft.rate_type);
      if (draft.rate_bps != null) setRatePct(bpsToPctInput(draft.rate_bps));
      if (draft.lender) setLender(draft.lender);
      if (draft.notes) setNotes(draft.notes);
      if (draft.amountPaidCents != null) setAmountAlreadyPaid(centsToDollarsInput(draft.amountPaidCents));
      const estimatedStartDate = estimateStartDateFromProgress(
        draft.amountPaidCents,
        draft.monthlyPaymentCents,
        draft.term_months
      );
      if (estimatedStartDate) setStartDate(estimatedStartDate);
      // Don't leave newly-filled lender/notes hidden behind a collapsed
      // "More details" section — same rule `applyLoan` uses for an existing loan.
      if (draft.lender || draft.notes) setMoreOpen(true);
      if (draft.monthlyPaymentCents != null || draft.dueDayOfMonth != null) {
        onExtractedPayment?.({ amountCents: draft.monthlyPaymentCents, dueDayOfMonth: draft.dueDayOfMonth });
      }
    } catch {
      Alert.alert('Could not read that', 'Please enter the details manually.');
    } finally {
      setScanning(false);
      onScanningChange?.(false);
    }
  };

  const pickCamera = async () => {
    try {
      const image = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });
      await runExtract({
        uri: image.path,
        name: image.filename || 'loan-statement.jpg',
        type: image.mime || 'image/jpeg',
      });
    } catch (e) {
      if (isPickerPermissionError(e)) presentPickerPermissionDeniedAlert('camera');
      else if ((e as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        Alert.alert('Error', 'Could not open the camera.');
      }
    }
  };

  const pickGallery = async () => {
    try {
      const image = await ImageCropPicker.openPicker({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });
      await runExtract({
        uri: image.path,
        name: image.filename || 'loan-statement.jpg',
        type: image.mime || 'image/jpeg',
      });
    } catch (e) {
      if (isPickerPermissionError(e)) presentPickerPermissionDeniedAlert('library');
      else if ((e as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        Alert.alert('Error', 'Could not open the photo library.');
      }
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...LOAN_STATEMENT_MIMES],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const a = result.assets[0];
        await runExtract({
          uri: a.uri,
          name: a.name || 'loan-statement',
          type: a.mimeType || inferLoanStatementMime(a.name || ''),
        });
      }
    } catch {
      Alert.alert('Error', 'Could not open the file picker.');
    }
  };

  const pickDriveFile = (file: { uri: string; name: string; size: number }) => {
    void runExtract({
      uri: file.uri,
      name: file.name || 'loan-statement',
      type: inferLoanStatementMime(file.name || ''),
    });
  };

  const handleSave = async () => {
    const result = validateLoanFields({
      rateType,
      ratePct,
      principal,
      termMonths,
      startDate,
      amountAlreadyPaid,
      lender,
      notes,
      portalUrl,
    });
    if (!result.valid) {
      Alert.alert(result.title, result.message);
      return;
    }

    setSaving(true);
    try {
      const { loan: saved, summary: savedSummary } = await budgetLoansApi.upsert(
        householdId,
        recurringPaymentId,
        result.payload
      );
      applyLoan(saved, savedSummary);
      showToast('success', 'Loan details saved');
    } catch {
      Alert.alert('Error', 'Could not save this loan. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={accent} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={[styles.toggleRow, { borderColor: colors.borderColor }]} testID="loan-tracking-toggle">
        <View style={styles.toggleText}>
          <Typography variant="body" weight="semibold">
            Track as a loan
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            Car loans, buy-now-pay-later plans, personal loans — see payments left and interest.
          </Typography>
        </View>
        <Toggle value={tracking} onValueChange={handleToggle} testID="loan-tracking-switch" />
      </View>

      {tracking && (
        <View style={styles.fields}>
          <LoanFieldsForm
            accent={accent}
            rateType={rateType}
            onRateTypeChange={setRateType}
            ratePct={ratePct}
            onRatePctChange={setRatePct}
            principal={principal}
            onPrincipalChange={setPrincipal}
            termMonths={termMonths}
            onTermMonthsChange={setTermMonths}
            startDate={startDate}
            onStartDateChange={setStartDate}
            amountAlreadyPaid={amountAlreadyPaid}
            onAmountAlreadyPaidChange={setAmountAlreadyPaid}
            moreOpen={moreOpen}
            onToggleMoreOpen={() => setMoreOpen((open) => !open)}
            lender={lender}
            onLenderChange={setLender}
            notes={notes}
            onNotesChange={setNotes}
            portalUrl={portalUrl}
            onPortalUrlChange={setPortalUrl}
            aiOpen={aiOpen}
            onToggleAiOpen={() => setAiOpen((open) => !open)}
            scanning={scanning}
            onPickCamera={pickCamera}
            onPickGallery={pickGallery}
            onPickFile={pickFile}
            onPickDriveFile={pickDriveFile}
          />

          <GradientButton
            title={saving ? 'Saving…' : loan ? 'Update loan' : 'Save loan'}
            variant="orange"
            onPress={handleSave}
            disabled={saving}
            fullWidth
            testID="loan-save"
          />

          {summary && (
            <View
              style={[styles.summaryCard, { backgroundColor: colors.backgroundSecondary }]}
              testID="loan-summary-card"
            >
              <View style={styles.summaryHeaderRow}>
                <Typography variant="body" weight="semibold">
                  {summary.paymentsRemaining} of {summary.termMonths} payments left
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Payoff {summary.payoffDate}
                </Typography>
              </View>
              <ProgressBar
                value={summary.elapsedMonths}
                max={summary.termMonths}
                color={accent}
                testID="loan-progress-bar"
              />
              <View style={styles.summaryStatsRow}>
                <View style={styles.summaryStat}>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Interest paid so far
                  </Typography>
                  <Typography variant="subheadline" weight="semibold">
                    {formatCurrency(summary.interestPaidToDateCents)}
                  </Typography>
                </View>
                <View style={styles.summaryStat}>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Total interest
                  </Typography>
                  <Typography variant="subheadline" weight="semibold">
                    {formatCurrency(summary.totalInterestCents)}
                  </Typography>
                </View>
                <View style={styles.summaryStat}>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Remaining balance
                  </Typography>
                  <Typography variant="subheadline" weight="semibold">
                    {formatCurrency(summary.currentBalanceCents)}
                  </Typography>
                </View>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Spacing.base, alignItems: 'center' },
  section: { gap: Spacing.smd },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.smd,
    paddingVertical: Spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleText: { flex: 1, gap: Spacing.xxs },
  fields: { gap: Spacing.smd },
  summaryCard: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    gap: Spacing.smd,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  summaryStat: { flex: 1, gap: Spacing.xxs },
});
