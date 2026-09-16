import * as DocumentPicker from 'expo-document-picker';
import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { budgetLoansApi, type LoanRateType, type UpsertLoanRequest } from '@api/budgetLoans';
import { Toggle, Typography } from '@components/ui';
import { useTheme } from '@contexts/ThemeContext';
import ImageCropPicker from '@services/image-picker-compat';
import { Spacing, useAppColors } from '@theme';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

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

export interface LoanDraftSectionProps {
  householdId: string;
  recurringPaymentLabel: string;
  /**
   * Fires around the "Fill with AI" extract call — same reason
   * `LoanInfoSection` reports it: the parent form's Save/Delete must be
   * disabled while an extract is in flight, and this section's own
   * `ProcessingOverlay` (rendered by the shared `LoanFieldsForm`) is
   * `embedded` and only covers this section's own bounds.
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
  /**
   * Seeds "Track as a loan" already on when this section first mounts.
   * The parent only renders `LoanDraftSection` once Group = "Loans & Debt"
   * is picked, which already signals a loan/BNPL plan is being added — so
   * defaulting the toggle on saves the redundant extra tap. Still a plain
   * `Toggle` underneath; the member can flip it back off.
   */
  startTracking?: boolean;
}

export type LoanDraftPayloadResult =
  | { valid: true; payload: UpsertLoanRequest }
  | { valid: false; error: string }
  | null;

export interface LoanDraftSectionHandle {
  /**
   * Snapshot of the current "track as a loan" state, for the parent to call
   * right after it creates the new recurring payment. `null` means tracking
   * is off — nothing to save. On invalid fields, returns a single
   * user-facing `error` string (same validation `LoanInfoSection.handleSave`
   * runs) so the parent can alert and leave the (already-saved) payment
   * form open for the member to fix it.
   */
  getDraftLoanPayload: () => LoanDraftPayloadResult;
}

/**
 * "Track a loan" for the Add-payment flow — same fields, same "Fill with AI",
 * as `LoanInfoSection`, but for a recurring payment that doesn't exist yet:
 *
 * - No initial `GET` (there is nothing to fetch).
 * - "Fill with AI" reads via `budgetLoansApi.extractDraft(householdId, form)`
 *   instead of the per-payment `extract` — no `recurring_payment_id` to
 *   scope it to.
 * - No internal Save button. The parent screen (`SavingsRecurringPaymentsScreen`)
 *   creates the payment first, then calls `getDraftLoanPayload()` via `ref`
 *   and — if tracking was turned on and the fields are valid — saves the
 *   loan itself via `budgetLoansApi.upsert` using the SAME new id it just
 *   gave the payment, so both are created together in one "Add payment" tap.
 *
 * Shares its field rows with `LoanInfoSection` via `LoanFieldsForm` and its
 * validation via `validateLoanFields` so the attached and draft flows can
 * never drift apart.
 */
export const LoanDraftSection = forwardRef<LoanDraftSectionHandle, LoanDraftSectionProps>(
  function LoanDraftSection(
    { householdId, recurringPaymentLabel, onScanningChange, onExtractedPayment, startTracking },
    ref
  ) {
    const { theme } = useTheme();
    const colors = useAppColors();
    const accent = theme.pastel.orange;

    const [tracking, setTracking] = useState(startTracking ?? false);

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

    const runExtract = async (raw: LoanAttachment) => {
      setScanning(true);
      onScanningChange?.(true);
      try {
        const att = await toVisionSafeAttachment(raw);
        const form = new FormData();
        form.append('file', { uri: att.uri, name: att.name, type: att.type } as unknown as Blob);
        const { draft } = await budgetLoansApi.extractDraft(householdId, form);

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

    useImperativeHandle(
      ref,
      () => ({
        getDraftLoanPayload: (): LoanDraftPayloadResult => {
          if (!tracking) return null;
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
            return { valid: false, error: `${result.title}: ${result.message}` };
          }
          return { valid: true, payload: result.payload };
        },
      }),
      [
        tracking,
        rateType,
        ratePct,
        principal,
        termMonths,
        startDate,
        amountAlreadyPaid,
        lender,
        notes,
        portalUrl,
      ]
    );

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
          <Toggle
            value={tracking}
            onValueChange={() => setTracking((prev) => !prev)}
            testID="loan-tracking-switch"
            accessibilityLabel={`Track ${recurringPaymentLabel || 'this payment'} as a loan`}
          />
        </View>

        {tracking && (
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
        )}
      </View>
    );
  }
);

const styles = StyleSheet.create({
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
});
