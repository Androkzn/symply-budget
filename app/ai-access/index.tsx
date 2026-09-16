/**
 * Unlock AI — the entry hub. Two paths: an Apple subscription (managed AI) or
 * bring-your-own developer API key (OpenAI / Anthropic / Gemini). Branded NUX
 * chrome; brand-neutral copy so every app renders it in its own name + colours.
 * Gated by feature flags.
 */

import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { brand } from '@brand';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { ProviderBrandMark } from '@components/ai/ProviderBrandMark';
import { PROVIDER_ORDER, providerLabel } from '@components/ai/providerMeta';
import { Icon, IconBackgroundChip, Typography } from '@components/ui';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { useAppColors } from '@theme';

export default function UnlockAIScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const {
    canUseAI,
    isPaid,
    source,
    provider,
    subscriptionsEnabled,
    bringYourOwnAIEnabled,
    aiFeaturesEnabled,
    isLoading,
    byokConnections = [],
  } = useAIEntitlement();
  const hasConnections = byokConnections.length > 0;
  const usingOwnKey = source === 'byok' && !!provider;

  return (
    <AIFlowScaffold
      title="Unlock AI"
      subtitle={`Use ${brand.displayName}-managed AI with an Apple subscription, or connect your own developer API key and pay the provider directly.`}
      screenTestID="ai-access-screen"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Provider marks — a quick visual of who you can bring */}
      <View style={styles.marksRow}>
        {PROVIDER_ORDER.map((p) => (
          <ProviderBrandMark key={p} provider={p} size={40} />
        ))}
      </View>

      {isLoading ? (
        <Typography variant="caption1" color={colors.textTertiary}>
          Checking access…
        </Typography>
      ) : null}
      {!aiFeaturesEnabled ? (
        <Typography variant="caption1" color={colors.textTertiary}>
          AI features are currently unavailable.
        </Typography>
      ) : null}
      {canUseAI ? (
        <View style={[styles.activeBanner, { backgroundColor: colors.success + '18' }]}>
          <Icon name="checkmark-circle" size={18} color={colors.success} />
          <Typography variant="footnote" color={colors.success} weight="medium">
            {usingOwnKey && provider
              ? `AI is active — using your own ${providerLabel(provider)} key.`
              : 'AI access is already active.'}
          </Typography>
        </View>
      ) : null}

      <OptionCard
        icon="logo-apple"
        title={isPaid ? 'Manage Apple subscription' : 'Subscribe with Apple'}
        body={
          isPaid
            ? `${brand.displayName} AI is included. Change or cancel billing in your Apple ID subscriptions — you keep any AI provider you connect below.`
            : `${brand.displayName} AI included. Manage billing in your Apple ID subscriptions.`
        }
        badge={!subscriptionsEnabled ? 'Coming soon' : undefined}
        disabled={!subscriptionsEnabled}
        onPress={() => router.push('/ai-access/paywall')}
      />

      <OptionCard
        icon="key-outline"
        title="Connect your API key"
        body="OpenAI, Anthropic, or Google Gemini developer keys. You pay the provider for API usage — not a consumer plan."
        badge={!bringYourOwnAIEnabled ? 'Coming soon' : undefined}
        disabled={!bringYourOwnAIEnabled}
        onPress={() => router.push('/ai-access/providers')}
      />

      {hasConnections ? (
        <OptionCard
          icon="options-outline"
          title="Manage AI providers"
          body={`Switch the active provider, re-validate, or disconnect the ${
            byokConnections.length === 1 ? 'key' : 'keys'
          } you have connected.`}
          onPress={() => router.push('/ai-access/manage')}
        />
      ) : null}

      {/* The third option, and the one a member is most likely to take: neither.
          Saying so plainly here is the point of the pricing model — the app is
          free and complete without AI, and nothing below this screen is a
          paywall on a feature they already rely on. */}
      <Typography variant="footnote" color={colors.textTertiary} style={styles.noThanks}>
        Or use neither. Every {brand.displayName} feature works without AI — AI only adds
        the assistant, scanning and suggestions on top.
      </Typography>
    </AIFlowScaffold>
  );
}

function OptionCard({
  icon,
  title,
  body,
  badge,
  disabled,
  onPress,
}: {
  icon: string;
  title: string;
  body: string;
  badge?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.borderColor },
        disabled && styles.disabled,
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <IconBackgroundChip name={icon} size={22} style={styles.cardIcon} />
      <View style={styles.cardText}>
        <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
          {title}
        </Typography>
        <Typography variant="subheadline" color={colors.textSecondary} style={styles.cardBody}>
          {body}
        </Typography>
        {badge ? (
          <Typography variant="caption2" weight="semibold" color={colors.textTertiary} style={styles.badge}>
            {badge}
          </Typography>
        ) : null}
      </View>
      {!disabled ? <Icon name="chevron-forward" size={20} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  marksRow: { flexDirection: 'row', gap: 12, marginVertical: 4 },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    padding: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
  },
  disabled: { opacity: 0.55 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 2 },
  cardBody: { marginTop: 2, lineHeight: 20 },
  noThanks: { textAlign: 'center', lineHeight: 19, paddingHorizontal: 8, marginTop: 2 },
  badge: { marginTop: 6, letterSpacing: 0.5, textTransform: 'uppercase' },
});
