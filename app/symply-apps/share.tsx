/**
 * Post-install data-sharing step. After the user installs a sibling Symply app
 * (and confirms it), this screen grants a baseline Soft Transfer profile consent
 * so the new app can pick up their Symply profile. Revocable anytime in
 * Settings → Data sharing.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { smartEngineApi } from '@api/smart-engine';
import { brandId } from '@brand';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { GradientButton, Typography } from '@components/ui';
import { ConsentConfirmationCard } from '@features/ecosystem/ConsentConfirmationCard';
import { resolveSoftTransferErrorMessage } from '@features/ecosystem/errors';
import { getBrandDisplayName } from '@features/ecosystem/labels';
import {
  getActiveAppName,
  resolveProfileConsent,
} from '@features/ecosystem/siblingApps';
import { Spacing, useAppColors } from '@theme';

export default function ShareDataScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const { app } = useLocalSearchParams<{ app?: string }>();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const route = app ? resolveProfileConsent(brandId, app) : null;
  const destName = app ? getBrandDisplayName(app) : 'this app';
  const purpose = `Set up ${destName} with your ${getActiveAppName()} profile`;

  const handleConfirm = async () => {
    if (!route) return;
    setConfirming(true);
    setError(null);
    try {
      await smartEngineApi.grantConsent({
        package_id: route.packageId,
        source_brand_id: route.sourceBrandId,
        destination_brand_id: route.destinationBrandId,
        purpose,
      });
      router.back();
    } catch (e) {
      setError(resolveSoftTransferErrorMessage(e));
      setConfirming(false);
    }
  };

  if (!route) {
    return (
      <AIFlowScaffold title="Data sharing" screenTestID="share-data-screen">
        <Typography variant="body" color={colors.textSecondary}>
          Data sharing with {destName} isn’t available yet.
        </Typography>
        <GradientButton
          title="Back"
          variant="secondary"
          onPress={() => router.back()}
          fullWidth
          style={styles.back}
        />
      </AIFlowScaffold>
    );
  }

  return (
    <AIFlowScaffold title="Data sharing" screenTestID="share-data-screen">
      <ConsentConfirmationCard
        packageId={route.packageId}
        sourceBrandId={route.sourceBrandId}
        destinationBrandId={route.destinationBrandId}
        purpose={purpose}
        confirmLabel="Accept and share"
        onConfirm={handleConfirm}
        onCancel={() => router.back()}
        confirming={confirming}
      />
      {error ? (
        <View style={styles.error}>
          <Typography variant="footnote" color={colors.statusOverdue}>
            {error}
          </Typography>
        </View>
      ) : null}
    </AIFlowScaffold>
  );
}

const styles = StyleSheet.create({
  back: {
    marginTop: Spacing.md,
  },
  error: {
    marginTop: Spacing.sm,
  },
});
