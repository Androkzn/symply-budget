/**
 * AI Providers — the manage + switch hub (Settings → AI Providers).
 *
 * Shows all three providers in one place. Each connected provider has a
 * default-provider toggle (the whole app then routes inference through it), an
 * inline model dropdown (defaulting to the provider's most-capable model), and
 * test-connection / change-key / disconnect actions. A not-yet-connected
 * provider shows a Connect CTA.
 *
 * The server (/ai-access via useAIEntitlement) is the source of truth for which
 * provider is active, each provider's selected model, and each key's status.
 * Brand-neutral copy + theme so every app in the ecosystem renders it in its own
 * colours.
 */

import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { aiAccessApi, type AIProviderId } from '@api/aiAccess';
import { brand } from '@brand';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { AiUsagePanel } from '@components/ai/AiUsagePanel';
import { HouseholdKeySharing } from '@components/ai/HouseholdKeySharing';
import { ProviderCard } from '@components/ai/ProviderCard';
import { PROVIDER_ORDER, providerLabel } from '@components/ai/providerMeta';
import { FilterTabs, Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAIConnectionHealth } from '@hooks/useAIConnectionHealth';
import { useAIEntitlement, type BYOKConnectionView } from '@hooks/useAIEntitlement';
import { useAiUsage } from '@hooks/useAiUsage';
import { useProviderModels } from '@hooks/useProviderModels';
import { aiKeyVault } from '@services/aiKeyVault';
import { setPreferredModel, setPreferredProvider } from '@services/aiModelPreference';
import { showToast } from '@services/toastManager';
import { useAppColors } from '@theme';

const TABS = [
  { id: 'providers', label: 'Providers' },
  { id: 'usage', label: 'Usage' },
];
const PERIODS = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
];

export default function ManageProvidersScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const {
    byokConnections,
    provider: activeProvider,
    source,
    invalidate,
    isLoading,
    bringYourOwnAIEnabled,
    providerEnabled,
  } = useAIEntitlement();

  const { isDisconnected, activeProvider: disconnectedProvider, reason } = useAIConnectionHealth();

  const [tab, setTab] = useState<'providers' | 'usage'>('providers');
  const [usageDays, setUsageDays] = useState(30);
  const [busyProvider, setBusyProvider] = useState<AIProviderId | null>(null);
  const [activatingProvider, setActivatingProvider] = useState<AIProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { usage, isLoading: usageLoading } = useAiUsage({ days: usageDays });

  const connectionByProvider = new Map<AIProviderId, BYOKConnectionView>(
    byokConnections.map((c) => [c.provider, c])
  );

  // Server "connected" and device "has the key" are DIFFERENT facts, and this
  // screen used to report only the first. When a Keychain write fails, the
  // lease POST and preferences PATCH still succeed, so the card read
  // "Active · Validated" while every local-first BYOK feature saw no key and
  // told the member to connect one (observed 2026-08-14, Budget receipt scan).
  //
  // Re-read on every FOCUS, not just when the connection set changes: change-key
  // and connect both write the Keychain for a provider that is already in that
  // set, so a set-keyed effect never re-ran and the card kept showing "Key not
  // on this device" after the key had in fact just been stored.
  const [localKeyProviders, setLocalKeyProviders] = useState<Set<AIProviderId> | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const present = await Promise.all(
          PROVIDER_ORDER.map(async (id) => ((await aiKeyVault.hasKey(id)) ? id : null))
        );
        if (!cancelled) {
          setLocalKeyProviders(new Set(present.filter((id): id is AIProviderId => id !== null)));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // Fixed set of three providers → call the models hook once per provider,
  // fetching only for connected ones (the inline picker needs the catalog).
  const anthropicModels = useProviderModels('anthropic', connectionByProvider.has('anthropic'));
  const openaiModels = useProviderModels('openai', connectionByProvider.has('openai'));
  const geminiModels = useProviderModels('gemini', connectionByProvider.has('gemini'));
  const modelsByProvider = useMemo(
    () => ({ anthropic: anthropicModels, openai: openaiModels, gemini: geminiModels }) as const,
    [anthropicModels, openaiModels, geminiModels]
  );

  const onActivate = useCallback(
    async (provider: AIProviderId) => {
      setError(null);
      setActivatingProvider(provider);
      try {
        await aiAccessApi.patchPreferences({ credential_source: 'byok', active_provider: provider });
        // Mirror to the device cache the offline BYOK ladders read.
        await setPreferredProvider(provider);
        await invalidate();
      } catch (err) {
        setError((err as Error)?.message || `Could not switch to ${providerLabel(provider)}.`);
      } finally {
        setActivatingProvider(null);
      }
    },
    [invalidate]
  );

  const onSelectModel = useCallback(
    async (provider: AIProviderId, modelId: string) => {
      setError(null);
      setBusyProvider(provider);
      try {
        await aiAccessApi.patchPreferences({ provider, selected_model_id: modelId });
        // Mirror to the device cache the offline BYOK ladders read — the
        // provider's own id, not our catalog key (see AIModelOption).
        const picked = modelsByProvider[provider].models.find((m) => m.id === modelId);
        await setPreferredModel(provider, picked?.vendor_model_id ?? null);
        await invalidate();
      } catch (err) {
        setError(
          (err as Error)?.message || `Could not change the ${providerLabel(provider)} model.`
        );
      } finally {
        setBusyProvider(null);
      }
    },
    // `modelsByProvider` supplies the vendor id to cache; it is rebuilt each
    // render, and the consumer passes an inline arrow anyway, so there is no
    // memoization to preserve here.
    [invalidate, modelsByProvider]
  );

  const onRevalidate = useCallback(
    async (provider: AIProviderId) => {
      setError(null);
      setBusyProvider(provider);
      try {
        await aiAccessApi.validateConnection(provider);
        await invalidate();
        // The check that just passed was against the key stored on the server.
        // This device keeps its own copy in the Keychain, and when it has none,
        // AI features here still fail — `[link-import] no AI provider key on
        // this device` was logged in the same session a green "connection is
        // working" toast appeared. Saying only the true half made the warning
        // above look stale, so name which key was tested and what is still
        // missing.
        const keyIsOnThisDevice = localKeyProviders === null || localKeyProviders.has(provider);
        showToast(
          'success',
          keyIsOnThisDevice
            ? `${providerLabel(provider)} key is working.`
            : `${providerLabel(provider)} key is valid, but it isn't on this device yet — tap Change key to use AI here.`
        );
      } catch (err) {
        setError((err as Error)?.message || `Could not reach ${providerLabel(provider)}.`);
      } finally {
        setBusyProvider(null);
      }
    },
    // `localKeyProviders` is read above, so it belongs here: without it the
    // callback keeps the set captured at mount — which is `null` on the first
    // render — and would still claim the key is on this device immediately
    // after the member added one.
    [invalidate, localKeyProviders]
  );

  const onDisconnect = useCallback(
    (provider: AIProviderId) => {
      Alert.alert(
        'Disconnect provider?',
        `This removes your stored ${providerLabel(provider)} key from ${brand.displayName}. ` +
          'It does not revoke the key at the provider — do that in the provider console.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disconnect',
            style: 'destructive',
            onPress: async () => {
              setError(null);
              setBusyProvider(provider);
              try {
                await aiAccessApi.deleteConnection(provider);
                // Also wipe the key from this device's Keychain — no key material left.
                await aiKeyVault.deleteKey(provider);
                await setPreferredModel(provider, null);
                await invalidate();
              } catch (err) {
                setError(
                  (err as Error)?.message || `Could not disconnect ${providerLabel(provider)}.`
                );
              } finally {
                setBusyProvider(null);
              }
            },
          },
        ]
      );
    },
    [invalidate]
  );

  return (
    <AIFlowScaffold
      title="AI Providers"
      subtitle={`Choose which AI powers ${brand.displayName}. Connect any of the three, pick each one's model, and flip a toggle to set your default. You pay each provider directly for API usage.`}
      screenTestID="ai-access-manage-screen"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Disconnection banner — the active provider's key stopped working. This
          is the actionable reconnect path: one tap back into the connect flow
          for the affected provider. */}
      {isDisconnected && disconnectedProvider ? (
        <View
          style={[styles.alertBanner, { backgroundColor: colors.error + '14', borderColor: colors.error }]}
        >
          <Icon name="alert-circle" size={18} color={colors.error} />
          <View style={styles.alertText}>
            <Typography variant="footnote" weight="semibold" color={colors.error}>
              {providerLabel(disconnectedProvider)} disconnected
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {reason ?? 'The stored key is no longer valid.'} AI features are paused until you reconnect.
            </Typography>
          </View>
          <Pressable
            style={[styles.reconnectBtn, { backgroundColor: colors.error }]}
            onPress={() => router.push(`/ai-access/connect?provider=${disconnectedProvider}`)}
            // Compact chip inside the banner row — hitSlop pays the HIG tap
            // target without stretching the banner.
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Reconnect ${providerLabel(disconnectedProvider)}`}
            testID="ai-reconnect-button"
          >
            <Typography variant="caption1" weight="bold" color={colors.white}>
              Reconnect
            </Typography>
          </Pressable>
        </View>
      ) : null}

      {source === 'simplehouse' ? (
        <View style={[styles.banner, { backgroundColor: colors.primary + '14' }]}>
          <Icon name="sparkles" size={16} color={colors.primaryDark} />
          <Typography variant="caption1" color={colors.textSecondary} style={styles.bannerText}>
            You’re on {brand.displayName}-managed AI (subscription). Flip a connected provider’s toggle
            below to use your own key instead.
          </Typography>
        </View>
      ) : null}

      {isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
      {error ? (
        <Typography variant="footnote" color={colors.error}>
          {error}
        </Typography>
      ) : null}

      <FilterTabs
        tabs={TABS}
        activeTab={tab}
        onTabChange={(id) => setTab(id as 'providers' | 'usage')}
        activeColor={colors.primary}
      />

      {tab === 'providers' ? (
        <View style={styles.cards}>
          {PROVIDER_ORDER.map((id) => {
            const conn = connectionByProvider.get(id) ?? null;
            const connected = !!conn;
            // Unknown (still checking) is treated as present so the card does
            // not flash a scary warning on every mount.
            const hasLocalKey = localKeyProviders === null || localKeyProviders.has(id);
            const isActive = connected && hasLocalKey && source === 'byok' && activeProvider === id;
            // The default toggle only makes sense when there's a choice to make —
            // hide it until a second provider is connected (one key is always the
            // default, so the toggle would be an inert no-op).
            const showDefaultToggle = byokConnections.length >= 2;
            const enabled = bringYourOwnAIEnabled && providerEnabled[id];
            const pm = modelsByProvider[id];

            return (
              <ProviderCard
                key={id}
                provider={id}
                connection={conn}
                isActive={isActive}
                missingLocalKey={connected && !hasLocalKey}
                showDefaultToggle={showDefaultToggle}
                enabled={enabled}
                models={pm.models}
                modelsLoading={pm.isLoading}
                selectedModelId={conn?.selectedModelId ?? null}
                busy={busyProvider === id}
                activatingBusy={activatingProvider === id}
                onToggleDefault={(next) => {
                  // Controlled toggle acts as a radio: turning ON activates; turning
                  // OFF is a no-op (BYOK always needs a default) and snaps back.
                  if (next && !isActive) onActivate(id);
                }}
                onSelectModel={(modelId) => onSelectModel(id, modelId)}
                onConnect={() => router.push(`/ai-access/connect?provider=${id}`)}
                onRevalidate={() => onRevalidate(id)}
                onChangeKey={() => router.push(`/ai-access/change-key?provider=${id}`)}
                onDisconnect={() => onDisconnect(id)}
                onOpenDetail={connected ? () => router.push(`/ai-access/provider/${id}`) : undefined}
              />
            );
          })}

          {/* Household sharing sits UNDER the cards: it is about keys that
              already exist, and putting it above would ask a member to share
              before they have anything to share. Renders nothing at all on a
              brand with no local-first household. */}
          <HouseholdKeySharing localKeyProviders={localKeyProviders} onChanged={invalidate} />
        </View>
      ) : (
        <View style={styles.cards}>
          <FilterTabs
            tabs={PERIODS}
            activeTab={String(usageDays)}
            onTabChange={(id) => setUsageDays(Number(id))}
            activeColor={colors.primary}
          />
          <AiUsagePanel usage={usage} isLoading={usageLoading} mode="all" testID="ai-usage-panel-all" />
          <Typography variant="caption2" color={colors.textTertiary}>
            Estimated from metered tokens across {brand.displayName} — each provider’s console has the
            exact bill.
          </Typography>
        </View>
      )}
    </AIFlowScaffold>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    padding: 12,
  },
  bannerText: { flex: 1, lineHeight: 18 },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  alertText: { flex: 1, gap: 2 },
  reconnectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  loader: { marginVertical: 12 },
  cards: { gap: 14 },
});
