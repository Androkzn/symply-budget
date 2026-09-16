/**
 * Per-provider detail — usage (estimated $ + tokens), billing/usage deep links,
 * and management (test connection / change key / disconnect) for one provider.
 *
 * Reached from the AI Providers hub ("Usage & billing"). The server
 * (useAIEntitlement / ai-usage) is the source of truth; brand-neutral copy so
 * every app in the ecosystem renders it in its own colours.
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { aiAccessApi, type AIProviderId } from '@api/aiAccess';
import { brand } from '@brand';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { AiUsagePanel } from '@components/ai/AiUsagePanel';
import { ProviderBrandMark } from '@components/ai/ProviderBrandMark';
import { PROVIDER_META, isAIProviderId } from '@components/ai/providerMeta';
import { FilterTabs, Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { useAiUsage } from '@hooks/useAiUsage';
import { aiKeyVault } from '@services/aiKeyVault';
import { showToast } from '@services/toastManager';
import { useAppColors } from '@theme';

const PERIODS = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
];

function formatStatus(status: string): string {
  const words = status.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown';
}

export default function ProviderDetailScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const params = useLocalSearchParams<{ provider?: string }>();
  const provider: AIProviderId = isAIProviderId(params.provider) ? params.provider : 'anthropic';
  const meta = PROVIDER_META[provider];

  const { byokConnections, invalidate, bringYourOwnAIEnabled, providerEnabled } = useAIEntitlement();
  const connection = byokConnections.find((c) => c.provider === provider) ?? null;
  const enabled = bringYourOwnAIEnabled && providerEnabled[provider];

  const [days, setDays] = useState(30);
  const { usage, isLoading } = useAiUsage({ provider, days });

  const [busy, setBusy] = useState<'validate' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openUrl = useCallback((url: string) => {
    Linking.openURL(url).catch(() => setError('Could not open the provider page.'));
  }, []);

  const onRevalidate = useCallback(async () => {
    setError(null);
    setBusy('validate');
    try {
      await aiAccessApi.validateConnection(provider);
      await invalidate();
      showToast('success', `${meta.label} connection is working.`);
    } catch (err) {
      setError((err as Error)?.message || `Could not reach ${meta.label}.`);
    } finally {
      setBusy(null);
    }
  }, [provider, meta.label, invalidate]);

  const onDisconnect = useCallback(() => {
    Alert.alert(
      'Disconnect provider?',
      `This removes your stored ${meta.label} key from ${brand.displayName}. ` +
        'It does not revoke the key at the provider — do that in the provider console.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setError(null);
            setBusy('delete');
            try {
              await aiAccessApi.deleteConnection(provider);
              // Also wipe the key from this device's Keychain — no key material left.
              await aiKeyVault.deleteKey(provider);
              await invalidate();
              router.back();
            } catch (err) {
              setError((err as Error)?.message || `Could not disconnect ${meta.label}.`);
              setBusy(null);
            }
          },
        },
      ]
    );
  }, [provider, meta.label, invalidate, router]);

  return (
    <AIFlowScaffold title={meta.label} screenTestID={`ai-provider-detail-screen-${provider}`}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Identity + status */}
      <View style={[styles.identity, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        <ProviderBrandMark provider={provider} size={44} connected={!!connection} />
        <View style={styles.identityText}>
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            {meta.label}
          </Typography>
          {connection ? (
            <Typography variant="caption1" color={colors.textSecondary}>
              Key {connection.keyHint} · {formatStatus(connection.status)}
            </Typography>
          ) : (
            <Typography variant="caption1" color={colors.textSecondary}>
              Not connected
            </Typography>
          )}
        </View>
      </View>

      {error ? (
        <Typography variant="footnote" color={colors.error}>
          {error}
        </Typography>
      ) : null}

      {/* Usage */}
      <View style={styles.section}>
        <FilterTabs
          tabs={PERIODS}
          activeTab={String(days)}
          onTabChange={(id) => setDays(Number(id))}
          activeColor={meta.accent}
        />
        <AiUsagePanel
          usage={usage}
          isLoading={isLoading}
          mode="provider"
          accent={meta.accent}
          testID={`ai-usage-panel-${provider}`}
        />
        <Typography variant="caption2" color={colors.textTertiary}>
          Estimated from metered tokens — your provider console has the exact bill.
        </Typography>
      </View>

      {/* Billing / usage deep links */}
      <View style={styles.section}>
        <LinkRow
          icon="card-outline"
          label="Open billing at the provider"
          onPress={() => openUrl(meta.billingUrl)}
          testID={`ai-billing-link-${provider}`}
        />
        <LinkRow
          icon="pie-chart-outline"
          label="Open usage dashboard"
          onPress={() => openUrl(meta.usageUrl)}
          testID={`ai-usage-link-${provider}`}
        />
      </View>

      {/* Management */}
      {connection ? (
        <View style={styles.actions}>
          <DetailAction
            label="Test connection"
            color={meta.accent}
            loading={busy === 'validate'}
            disabled={!!busy}
            onPress={onRevalidate}
          />
          <DetailAction
            label="Change key"
            color={colors.textSecondary}
            disabled={!!busy || !enabled}
            onPress={() => router.push(`/ai-access/change-key?provider=${provider}`)}
          />
          <DetailAction
            label="Disconnect"
            color={colors.error}
            loading={busy === 'delete'}
            disabled={!!busy}
            onPress={onDisconnect}
          />
        </View>
      ) : (
        <DetailAction
          label={enabled ? 'Connect' : 'Unavailable'}
          color={meta.accent}
          disabled={!enabled}
          onPress={() => router.push(`/ai-access/connect?provider=${provider}`)}
          fill
        />
      )}
    </AIFlowScaffold>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      style={[styles.linkRow, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      testID={testID}
    >
      <Icon name={icon} size={18} color={colors.textSecondary} />
      <Typography variant="footnote" color={colors.textPrimary} style={styles.linkLabel}>
        {label}
      </Typography>
      <Icon name="open-outline" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

function DetailAction({
  label,
  color,
  onPress,
  disabled,
  loading,
  fill,
}: {
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  fill?: boolean;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      style={[
        styles.actionBtn,
        // Border tracks the label colour so each action reads as an outline
        // button in its own intent instead of a faint grey box.
        { borderColor: disabled ? colors.borderColor : color },
        fill && styles.actionFill,
        disabled && styles.actionDisabled,
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Typography variant="footnote" weight="semibold" color={color}>
          {label}
        </Typography>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  identityText: { flex: 1, gap: 2 },
  section: { gap: 12 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  linkLabel: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  actionFill: { flex: 1 },
  actionDisabled: { opacity: 0.5 },
});
