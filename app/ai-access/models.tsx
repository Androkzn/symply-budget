/**
 * Step 3 of the BYOK flow — pick which model the active provider should use.
 *
 * Lists the ≤5 catalog models for the provider (server-controlled). Selection
 * saves immediately via PATCH /ai-preferences; "Done" closes the flow.
 */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { aiAccessApi, type AIModelOption, type AIProviderId } from '@api/aiAccess';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { ProviderBrandMark } from '@components/ai/ProviderBrandMark';
import { PROVIDER_META, isAIProviderId } from '@components/ai/providerMeta';
import { GradientButton, Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { setPreferredModel } from '@services/aiModelPreference';
import { useAppColors } from '@theme';

export default function AIModelsScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const params = useLocalSearchParams<{ provider?: string }>();
  const { selectedModelId, invalidate, provider: activeProvider } = useAIEntitlement();

  const provider: AIProviderId = isAIProviderId(params.provider)
    ? params.provider
    : activeProvider ?? 'anthropic';
  const meta = PROVIDER_META[provider];

  const [models, setModels] = useState<AIModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await aiAccessApi.getModels(provider);
        if (!cancelled) setModels(res.models);
      } catch {
        if (!cancelled) setError('Could not load models.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const onSelect = useCallback(
    async (id: string) => {
      setSavingId(id);
      setError(null);
      try {
        await aiAccessApi.patchPreferences({ active_provider: provider, selected_model_id: id });
        // Mirror onto the device: the local-first BYOK ladders run offline and
        // cannot read /ai-preferences, so without this the pick shows here and
        // is ignored by every actual scan. Cache the PROVIDER's id, not our
        // catalog key — the provider 404s on the latter.
        await setPreferredModel(provider, models.find((m) => m.id === id)?.vendor_model_id ?? null);
        await invalidate();
      } catch {
        setError('Could not save model selection.');
      } finally {
        setSavingId(null);
      }
    },
    [invalidate, models, provider]
  );

  const finish = useCallback(() => {
    if (router.canDismiss?.()) router.dismissAll();
    else router.back();
  }, [router]);

  return (
    <AIFlowScaffold
      title="Choose a model"
      subtitle={`Pick the ${meta.label} model to use. You can change it any time in Settings → AI Providers.`}
      footer={<GradientButton title="Done" variant="teal" size="lg" fullWidth onPress={finish} />}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.providerRow}>
        <ProviderBrandMark provider={provider} size={36} connected />
        <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
          {meta.label}
        </Typography>
      </View>

      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
      {error ? (
        <Typography variant="footnote" color={colors.error}>
          {error}
        </Typography>
      ) : null}

      {models.map((m) => {
        const selected = m.id === selectedModelId || (!selectedModelId && m.is_default);
        return (
          <Pressable
            key={m.id}
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: selected ? colors.primaryDark : colors.borderColor,
                borderWidth: selected ? 2 : 1,
              },
            ]}
            onPress={() => onSelect(m.id)}
            disabled={savingId != null}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={m.display_name}
          >
            <View style={styles.cardText}>
              <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                {m.display_name}
              </Typography>
              <Typography variant="caption1" color={colors.textTertiary}>
                {m.profile_label ?? 'model'}
                {m.is_default ? ' · default' : ''}
              </Typography>
            </View>
            {savingId === m.id ? (
              <ActivityIndicator color={colors.primary} />
            ) : selected ? (
              <Icon name="checkmark-circle" size={22} color={colors.primaryDark} />
            ) : (
              <View style={[styles.radio, { borderColor: colors.borderColor }]} />
            )}
          </Pressable>
        );
      })}
    </AIFlowScaffold>
  );
}

const styles = StyleSheet.create({
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  loader: { marginVertical: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    padding: 16,
  },
  cardText: { flex: 1, gap: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
});
