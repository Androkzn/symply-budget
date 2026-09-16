import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { TransferPackageId } from '@api/smart-engine';
import { Card, GradientButton, Typography } from '@components/ui';
import {CornerRadius, Spacing, useAppColors } from '@theme';

import { getBrandDisplayName, getPackageLabel } from './labels';

type ConsentConfirmationCardProps = {
  packageId: TransferPackageId;
  sourceBrandId: string;
  destinationBrandId: string;
  purpose: string;
  expiryLabel?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  confirming?: boolean;
  disabled?: boolean;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  const colors = useAppColors();  return (
    <View style={styles.row}>
      <Typography variant="footnote" color={colors.textSecondary} style={styles.rowLabel}>
        {label}
      </Typography>
      <Typography variant="body" weight="medium" style={styles.rowValue}>
        {value}
      </Typography>
    </View>
  );
}

export function ConsentConfirmationCard({
  packageId,
  sourceBrandId,
  destinationBrandId,
  purpose,
  expiryLabel = 'One-time import unless you revoke consent',
  confirmLabel = 'Allow and continue',
  onConfirm,
  onCancel,
  confirming = false,
  disabled = false,
}: ConsentConfirmationCardProps) {
  const colors = useAppColors();
  const pkg = getPackageLabel(packageId);

  return (
    <Card variant="filled" style={styles.card} testID="consent-confirmation-card">
      <Typography variant="title3" weight="semibold" style={styles.title}>
        Review data sharing
      </Typography>
      <Typography variant="body" color={colors.textSecondary} style={styles.intro}>
        You are about to share a versioned Soft Transfer package. Nothing moves until you confirm.
      </Typography>

      <DetailRow label="What is moving?" value={`${pkg.title} — ${pkg.contents}`} />
      <DetailRow label="From" value={getBrandDisplayName(sourceBrandId)} />
      <DetailRow label="To" value={getBrandDisplayName(destinationBrandId)} />
      <DetailRow label="Why?" value={purpose} />
      <DetailRow label="How long?" value={expiryLabel} />
      <DetailRow
        label="How to stop"
        value="Revoke anytime in Settings → Data sharing"
      />

      <GradientButton
        title={confirming ? 'Working…' : confirmLabel}
        variant="primary"
        onPress={onConfirm}
        disabled={disabled || confirming}
        fullWidth
        style={styles.confirmButton}
        testID="consent-confirm-button"
      />
      {onCancel ? (
        <GradientButton
          title="Not now"
          variant="secondary"
          onPress={onCancel}
          disabled={confirming}
          fullWidth
          style={styles.cancelButton}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    borderRadius: CornerRadius.lg,
    gap: Spacing.sm,
  },
  title: {
    marginBottom: Spacing.xxs,
  },
  intro: {
    marginBottom: Spacing.sm,
  },
  row: {
    gap: Spacing.xxs,
    marginBottom: Spacing.xs,
  },
  rowLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowValue: {
    flexShrink: 1,
  },
  confirmButton: {
    marginTop: Spacing.md,
  },
  cancelButton: {
    marginTop: Spacing.sm,
  },
});
