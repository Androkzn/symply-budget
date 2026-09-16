/**
 * SubscriptionSection — the single, shared subscription-management surface.
 *
 * Rendered identically by EVERY app in the ecosystem (House, Budget, Kaizen,
 * Language, Health) so subscription logic + setup never diverge per brand:
 *  - PRO / FREE tier badge and status line;
 *  - what the plan grants in AI terms — "Using your own ChatGPT, Gemini or
 *    Claude account" (a BYOK key wins over tier and survives a cancellation) or
 *    "AI included with your subscription" — plus the "Unlock AI" upsell for a
 *    FREE member with no key. These state the subscription's value; MANAGING AI
 *    access is not here. That entry lives once, in Settings → AI (see
 *    @components/ai/useAIAccessEntry) — this card carried a second one with its
 *    own destination, and two entry points for one subject is what that move
 *    deleted. Do not re-add a "Manage AI access" button here;
 *  - a provider-aware "Manage subscription" action that deep-links to Apple for
 *    App Store / RevenueCat billing (StoreKit owns cancellation) and falls back
 *    to the backend cancel endpoint for any explicit web biller.
 *
 * Server `/ai-access` (via useAIEntitlement) is authoritative for entitlement:
 * once PRO lapses and no BYOK key is connected, `can_use_ai` drops and every AI
 * surface auto-locks through AIAccessGate — no extra gating needed here.
 */

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { subscriptionApi } from '@api/subscription';
import { Button, Card, Icon, Typography } from '@components/ui';
import { useI18n } from '@contexts/I18nContext';
import { useSubscription } from '@contexts/SubscriptionContext';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { showToast } from '@services/toastManager';
import { isFeatureEnabled } from '@stores/featureFlagStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';

/** Explicit web billers route to the backend cancel endpoint; everything else
 *  ('revenuecat', 'apple', legacy null) is Apple IAP and cancels through Apple. */
const WEB_BILLING_PROVIDERS = ['stripe', 'web', 'paddle'];

interface SubscriptionSectionProps {
  /** Optional container style override (e.g. per-screen margin). */
  style?: StyleProp<ViewStyle>;
}

export function SubscriptionSection({ style }: SubscriptionSectionProps) {
  const colors = useAppColors();
  const router = useRouter();
  const { t } = useI18n();
  const { subscription, isPremium, refreshSubscription } = useSubscription();

  const aiFeaturesEnabled = isFeatureEnabled('aiFeaturesEnabled');
  // BYOK state drives the affordance: a connected own key survives a PRO
  // cancellation (FREE plan + own provider), so it must win over the tier.
  const { byokConnections } = useAIEntitlement();
  const hasOwnProvider = byokConnections.length > 0;

  const [isUpgrading, setIsUpgrading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const handleUpgrade = () => {
    setIsUpgrading(true);
    try {
      router.push('/ai-access');
      void refreshSubscription();
    } finally {
      setIsUpgrading(false);
    }
  };

  const isAppleBilled =
    !subscription?.provider || !WEB_BILLING_PROVIDERS.includes(subscription.provider);

  const aiCancelWarning =
    aiFeaturesEnabled && !hasOwnProvider
      ? ' AI features will turn off unless you connect your own AI provider.'
      : '';

  const openAppleSubscriptions = () => {
    Linking.openURL('https://apps.apple.com/account/subscriptions').catch(() => {
      Alert.alert(
        t('common.error'),
        'Could not open Apple Subscriptions. Manage it in Settings → Apple ID → Subscriptions.'
      );
    });
    // Re-sync on return so the badge + AI gate reflect any change they made.
    void refreshSubscription();
  };

  const cancelWebSubscription = async () => {
    setIsCancelling(true);
    try {
      await subscriptionApi.cancelSubscription();
      await refreshSubscription();
      showToast('success', 'Subscription cancelled');
    } catch (err) {
      Alert.alert(
        t('common.error'),
        (err as Error)?.message || 'Could not cancel your subscription. Please try again.'
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const handleManageSubscription = () => {
    if (isAppleBilled) {
      Alert.alert(
        'Manage subscription',
        `Your PRO subscription is billed through Apple. You'll be taken to Apple's Subscriptions page to cancel or change it.${aiCancelWarning}`,
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: 'Open Apple Subscriptions', onPress: openAppleSubscriptions },
        ]
      );
      return;
    }
    Alert.alert(
      'Cancel subscription?',
      `Your PRO subscription will stop renewing.${aiCancelWarning}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: 'Cancel subscription', style: 'destructive', onPress: cancelWebSubscription },
      ]
    );
  };

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }, style]}
    >
      <View style={styles.header}>
        <Typography variant="headline" weight="semibold">
          Subscription
        </Typography>
        <View
          style={[
            styles.tierBadge,
            { backgroundColor: isPremium ? colors.primary : colors.groupedListBackground },
          ]}
        >
          <Typography
            variant="caption1"
            weight="semibold"
            color={isPremium ? colors.white : colors.textPrimary}
          >
            {isPremium ? 'PRO' : 'FREE'}
          </Typography>
        </View>
      </View>

      {subscription && (
        <Typography variant="footnote" color={colors.textSecondary} style={styles.status}>
          Status: {subscription.status}
          {subscription.provider ? ` · ${subscription.provider}` : ''}
        </Typography>
      )}

      {aiFeaturesEnabled && hasOwnProvider && (
        <View style={styles.aiStatusRow}>
          <Icon name="key" size={15} color={colors.primary} />
          <Typography variant="footnote" color={colors.textSecondary} style={styles.aiStatusText}>
            Using your own ChatGPT, Gemini or Claude account
          </Typography>
        </View>
      )}

      {aiFeaturesEnabled && !hasOwnProvider && isPremium && (
        <View style={styles.aiStatusRow}>
          <Icon name="sparkles" size={15} color={colors.primary} />
          <Typography variant="footnote" color={colors.textSecondary} style={styles.aiStatusText}>
            AI included with your subscription
          </Typography>
        </View>
      )}

      {aiFeaturesEnabled && !hasOwnProvider && !isPremium && (
        <View style={styles.actionButton}>
          <Button
            title="Unlock AI"
            variant="primary"
            size="md"
            fullWidth
            onPress={handleUpgrade}
            loading={isUpgrading}
            testID="profile-ai-access-button"
          />
        </View>
      )}

      {isPremium && (
        <View style={styles.actionButton}>
          <Button
            title="Manage subscription"
            variant="outline"
            size="md"
            fullWidth
            onPress={handleManageSubscription}
            loading={isCancelling}
            testID="profile-manage-subscription-button"
          />
          {aiFeaturesEnabled && !hasOwnProvider && (
            <Typography variant="caption1" color={colors.textSecondary} style={styles.footnote}>
              Canceling PRO turns off AI unless you connect your own provider.
            </Typography>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  // Radius/padding come from Card's own tokens so every card on the screen matches.
  card: {
    marginBottom: Spacing.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  tierBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.full,
  },
  status: {
    marginBottom: Spacing.xs,
  },
  aiStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  aiStatusText: {
    flex: 1,
  },
  actionButton: {
    marginTop: Spacing.md,
  },
  footnote: {
    marginTop: Spacing.sm,
  },
});
