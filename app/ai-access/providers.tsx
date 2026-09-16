/**
 * Step 1 of the BYOK flow — choose an AI provider.
 *
 * Branded NUX chrome (AppBackground + centered header) so it reads as
 * first-class onboarding. No step progress bar: this is a three-tap settings
 * task reachable from the More list, not a linear first-run wizard, and the bar
 * read as a commitment to a longer flow than it is. Honors the per-provider
 * rollout flags and marks providers the user has already connected.
 * Brand-neutral: app name comes from the theme.
 *
 * Keys OTHER household members have already lent this one come FIRST, above the
 * three "go and create a developer key" cards. A member who has been lent a key
 * has no console to visit and nothing to type — one tap on Use is the whole
 * flow — so burying that under the create-a-key path asked them to do work they
 * did not need to do. The block renders nothing when nobody has shared anything.
 */

import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AIProviderId } from '@api/aiAccess';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { ProviderBrandMark } from '@components/ai/ProviderBrandMark';
import { PROVIDERS_ORDERED } from '@components/ai/providerMeta';
import { SharedAiKeyOffers } from '@components/ai/SharedAiKeys';
import { Icon, Typography } from '@components/ui';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { useAppColors } from '@theme';

export default function AIProvidersScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const { bringYourOwnAIEnabled, providerEnabled, connectedProviders, invalidate } =
    useAIEntitlement();

  return (
    <AIFlowScaffold
      title="Choose your AI provider"
      subtitle="Connect a developer API key and pay the provider directly. Consumer plans (ChatGPT Plus, Claude Pro, Gemini Advanced) do not include API access."
    >
      <Stack.Screen options={{ headerShown: false }} />

      <SharedAiKeyOffers onChanged={invalidate} />

      {PROVIDERS_ORDERED.map((meta) => {
        const id = meta.id as AIProviderId;
        const enabled = bringYourOwnAIEnabled && providerEnabled[id];
        const connected = connectedProviders.has(id);
        return (
          <Pressable
            key={id}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: connected ? colors.success : colors.borderColor },
              !enabled && styles.disabled,
            ]}
            disabled={!enabled}
            onPress={() => router.push(`/ai-access/connect?provider=${id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Connect ${meta.label}${connected ? ', already connected' : ''}`}
          >
            <ProviderBrandMark provider={id} size={46} connected={connected} />
            <View style={styles.cardText}>
              <View style={styles.titleRow}>
                <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                  {meta.label}
                </Typography>
                {meta.freeTier ? (
                  <View style={[styles.pill, { backgroundColor: colors.success + '22' }]}>
                    <Typography variant="caption2" weight="semibold" color={colors.success}>
                      FREE TIER
                    </Typography>
                  </View>
                ) : null}
              </View>
              <Typography variant="subheadline" color={colors.textSecondary}>
                {meta.tagline}
              </Typography>
              <Typography variant="caption1" color={colors.textTertiary} style={styles.models}>
                {meta.models}
              </Typography>
              {!enabled ? (
                <Typography variant="caption1" color={colors.textTertiary} style={styles.models}>
                  {bringYourOwnAIEnabled ? 'Temporarily unavailable' : 'Coming soon'}
                </Typography>
              ) : null}
            </View>
            <View style={styles.chevron}>
              {connected ? (
                <Typography variant="caption1" weight="semibold" color={colors.success}>
                  Connected
                </Typography>
              ) : (
                <Icon name="chevron-forward" size={20} color={colors.textTertiary} />
              )}
            </View>
          </Pressable>
        );
      })}

      <View style={[styles.note, { backgroundColor: colors.backgroundSecondary }]}>
        <Icon name="shield-checkmark-outline" size={16} color={colors.textSecondary} />
        <Typography variant="caption1" color={colors.textSecondary} style={styles.noteText}>
          Your key is encrypted on the server and never shown again. You can switch providers
          or disconnect any time.
        </Typography>
      </View>
    </AIFlowScaffold>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
  },
  disabled: { opacity: 0.5 },
  cardText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  models: { marginTop: 2 },
  chevron: { alignItems: 'flex-end', justifyContent: 'center' },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
  },
  noteText: { flex: 1, lineHeight: 18 },
});
