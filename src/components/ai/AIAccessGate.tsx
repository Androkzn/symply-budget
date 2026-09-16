/**
 * Shared AI access gate for Mira / AI surfaces.
 * When denied, shows unlock CTA instead of the feature.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ENV } from '@config/env';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { Spacing, useAppColors } from '@theme';

interface AIAccessGateProps {
  children: React.ReactNode;
  /** Optional title when locked */
  title?: string;
}

export function AIAccessGate({
  children,
  title = 'AI access required',
}: AIAccessGateProps) {
  const colors = useAppColors();
  const router = useRouter();
  const { canUseAI, isLoading, aiFeaturesEnabled, denialReason, accountAiStatus } =
    useAIEntitlement();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!aiFeaturesEnabled || !canUseAI || accountAiStatus === 'off') {
    return (
      <View style={styles.center}>
        <Typography variant="headline" weight="semibold" style={styles.title}>
          {title}
        </Typography>
        <Typography
          variant="body"
          color={colors.textSecondary}
          style={styles.body}
        >
          {!aiFeaturesEnabled || accountAiStatus === 'off'
            ? `AI features are currently unavailable. Core ${ENV.APP_NAME} works without AI.`
            : denialReason === 'AI_ACCESS_REQUIRED'
              ? 'Subscribe with Apple or connect your own API key to use Mira and other AI tools.'
              : 'Unlock AI to continue.'}
        </Typography>
        <Pressable
          style={[styles.cta, { backgroundColor: colors.accent }]}
          onPress={() => router.push('/ai-access')}
          accessibilityRole="button"
          accessibilityLabel="Unlock AI"
        >
          <Typography variant="body" weight="semibold" color={colors.white}>
            Unlock AI
          </Typography>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  body: {
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  cta: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 12,
  },
});
