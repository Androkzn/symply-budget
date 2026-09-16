import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import type { LoanRateType } from '@api/budgetLoans';
import { CloudFilePicker } from '@components/cloud-storage';
import { ProcessingOverlay, ScanImportSources } from '@components/common';
import { TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

import { LOAN_STATEMENT_MIMES } from './loanShared';

const RATE_TYPE_LABELS: Record<LoanRateType, string> = {
  zero: '0% APR',
  fixed: 'Fixed rate',
};

export interface LoanFieldsFormProps {
  /** Accent tint (loan sections use `theme.pastel.orange`). */
  accent: string;

  rateType: LoanRateType;
  onRateTypeChange: (value: LoanRateType) => void;
  ratePct: string;
  onRatePctChange: (value: string) => void;
  principal: string;
  onPrincipalChange: (value: string) => void;
  termMonths: string;
  onTermMonthsChange: (value: string) => void;

  startDate: string;
  onStartDateChange: (value: string) => void;
  /**
   * Purely informational once saved — never re-derives `startDate` on load.
   * A fresh "Fill with AI" draft DOES use it once (with the monthly payment)
   * to suggest a `startDate`; see `estimateStartDateFromProgress`. Optional/
   * blank is fine.
   */
  amountAlreadyPaid: string;
  onAmountAlreadyPaidChange: (value: string) => void;

  moreOpen: boolean;
  onToggleMoreOpen: () => void;
  lender: string;
  onLenderChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  portalUrl: string;
  onPortalUrlChange: (value: string) => void;

  /** "Fill with AI" — collapsible state + in-flight indicator + source pickers. */
  aiOpen: boolean;
  onToggleAiOpen: () => void;
  scanning: boolean;
  onPickCamera: () => void;
  onPickGallery: () => void;
  onPickFile: () => void;
  /** Fires once a Google Drive file has been downloaded and is ready to extract. */
  onPickDriveFile: (file: { uri: string; name: string; size: number }) => void;
}

/**
 * Pure, controlled "track a loan" field rows — rate-type chips, principal/
 * term, start date, a purely-informational "amount already paid" field, the
 * "More details" collapsible (lender/notes/portal_url), and the "Fill with
 * AI" source row (camera, gallery, file, Google Drive). Shared by
 * `LoanInfoSection` (attached to an already-saved recurring payment) and
 * `LoanDraftSection` (Add-payment flow, before the payment exists) so the two
 * never visually or behaviourally drift apart. Has NO idea which host it's
 * in, no data fetching, and no Save button — the host owns state, "Fill with
 * AI" wiring (which endpoint to call), validation, and persistence.
 *
 * Owns only the Google Drive picker's open/closed state internally — from
 * the host's point of view, Drive is just one more "give me a file" source,
 * indistinguishable from camera/gallery/file once `onPickDriveFile` fires.
 */
export function LoanFieldsForm({
  accent,
  rateType,
  onRateTypeChange,
  ratePct,
  onRatePctChange,
  principal,
  onPrincipalChange,
  termMonths,
  onTermMonthsChange,
  startDate,
  onStartDateChange,
  amountAlreadyPaid,
  onAmountAlreadyPaidChange,
  moreOpen,
  onToggleMoreOpen,
  lender,
  onLenderChange,
  notes,
  onNotesChange,
  portalUrl,
  onPortalUrlChange,
  aiOpen,
  onToggleAiOpen,
  scanning,
  onPickCamera,
  onPickGallery,
  onPickFile,
  onPickDriveFile,
}: LoanFieldsFormProps) {
  const colors = useAppColors();
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  return (
    <View style={styles.fields}>
      <View style={styles.aiSection}>
        <TouchableOpacity
          style={[styles.aiToggle, { borderColor: accent }]}
          onPress={onToggleAiOpen}
          testID="loan-ai-fill-toggle"
        >
          <Icon name="sparkles-outline" size={IconSize.md} color={accent} />
          <Typography variant="body" weight="semibold" color={accent} style={styles.aiToggleLabel}>
            Fill with AI
          </Typography>
          <Icon name={aiOpen ? 'chevron-up' : 'chevron-down'} size={IconSize.sm} color={accent} />
        </TouchableOpacity>
        {aiOpen && (
          <View style={styles.aiBody}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Photograph or upload a loan statement — we'll read the details below for you to review.
            </Typography>
            <ScanImportSources
              testIDPrefix="loan-ai-fill"
              disabled={scanning}
              onCamera={onPickCamera}
              onGallery={onPickGallery}
              onFile={onPickFile}
              onDrive={() => setShowDrivePicker(true)}
            />
          </View>
        )}
        {/* Rendered LAST (not first) so it paints on top of the toggle + source
            tiles above — RN stacks siblings in JSX order, so an earlier overlay
            paints BEHIND later content and never actually blocks it, which is
            what let the toggle and Camera/Gallery/File/Drive tiles show through
            the scrim instead of being covered by it. Scoped to just this section
            (not the whole `fields` column, which runs much taller than one
            screen) so the spinner+message card centers on what the member is
            actually looking at. */}
        <ProcessingOverlay
          visible={scanning}
          embedded
          message="Reading your loan…"
          caption="Extracting details with AI"
          testID="loan-ai-fill-overlay"
        />
      </View>

      <Typography variant="caption1" color={colors.textSecondary}>
        Interest
      </Typography>
      <View style={styles.chipRow}>
        {(Object.keys(RATE_TYPE_LABELS) as LoanRateType[]).map((value) => {
          const active = rateType === value;
          return (
            <TouchableOpacity
              key={value}
              style={[
                styles.chip,
                { borderColor: accent, backgroundColor: active ? accent : 'transparent' },
              ]}
              onPress={() => onRateTypeChange(value)}
              testID={`loan-rate-type-${value}`}
            >
              <Typography variant="caption1" weight="semibold" color={active ? colors.white : accent}>
                {RATE_TYPE_LABELS[value]}
              </Typography>
            </TouchableOpacity>
          );
        })}
      </View>
      {rateType === 'fixed' && (
        <TextInput
          testID="loan-rate-pct"
          label="Interest rate (% APR)"
          placeholder="e.g. 6.49"
          value={ratePct}
          onChangeText={onRatePctChange}
          keyboardType="decimal-pad"
        />
      )}

      <TextInput
        testID="loan-principal"
        label="Original loan amount ($)"
        placeholder="0"
        value={principal}
        onChangeText={onPrincipalChange}
        keyboardType="decimal-pad"
      />
      <TextInput
        testID="loan-term-months"
        label="Term (how many months)"
        placeholder="e.g. 60"
        value={termMonths}
        onChangeText={onTermMonthsChange}
        keyboardType="number-pad"
      />

      <TextInput
        testID="loan-start-date"
        label="Start date (YYYY-MM-DD)"
        value={startDate}
        onChangeText={onStartDateChange}
      />
      <TextInput
        testID="loan-amount-already-paid"
        label="Amount already paid ($)"
        placeholder="0"
        value={amountAlreadyPaid}
        onChangeText={onAmountAlreadyPaidChange}
        keyboardType="decimal-pad"
      />
      <Typography variant="caption2" color={colors.textSecondary} style={styles.amountAlreadyPaidCaption}>
        Just for your own reference — doesn't affect the payoff schedule above.
      </Typography>

      <TouchableOpacity
        style={[styles.moreToggle, { borderColor: colors.borderColor }]}
        onPress={onToggleMoreOpen}
        testID="loan-more-details-toggle"
      >
        <Typography variant="body" weight="semibold">
          More details
        </Typography>
        <Icon name={moreOpen ? 'chevron-up' : 'chevron-down'} size={IconSize.md} color={colors.textSecondary} />
      </TouchableOpacity>
      {moreOpen && (
        <View style={styles.moreBody} testID="loan-more-details-body">
          <TextInput
            testID="loan-lender"
            label="Lender (optional)"
            placeholder="e.g. Toyota Financial, IKEA"
            value={lender}
            onChangeText={onLenderChange}
          />
          <TextInput
            testID="loan-notes"
            label="Description / notes (optional)"
            value={notes}
            onChangeText={onNotesChange}
            multiline
          />
          <TextInput
            testID="loan-portal-url"
            label="Manage this loan online (link, optional)"
            placeholder="https://…"
            value={portalUrl}
            onChangeText={onPortalUrlChange}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}

      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        mimeTypeFilter={[...LOAN_STATEMENT_MIMES]}
        rememberScope="budget-loan"
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={(file) => {
          setShowDrivePicker(false);
          onPickDriveFile(file);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: Spacing.smd },
  aiSection: { gap: Spacing.sm, position: 'relative' },
  aiToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.smd,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  aiToggleLabel: { flex: 0 },
  aiBody: { gap: Spacing.smd },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.smd,
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  amountAlreadyPaidCaption: { marginTop: Spacing.xxs },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.smd,
    paddingVertical: Spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  moreBody: { gap: Spacing.smd },
});
