/**
 * Apple IAP paywall — RevenueCat purchase + restore + backend sync.
 */

import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { brand } from '@brand';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useTheme } from '@contexts/ThemeContext';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { trackEvent, AnalyticsEvent } from '@services/analytics';
import {
  getRevenueCatApiKey,
  purchaseDefaultPackage,
  restorePurchases,
} from '@services/purchases';
import { isFeatureEnabled } from '@stores/featureFlagStore';

const PURCHASE_FAILED_COPY =
  'That purchase could not be completed. Nothing has been charged — try again, or connect your own API key instead.';
const RESTORE_FAILED_COPY =
  'No previous purchase could be restored on this Apple ID. If you subscribed with a different one, sign in with that account and try again.';

export default function PaywallScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const { invalidate, isPaid, canUseAI } = useAIEntitlement();

  // Fire once per presentation, regardless of which entry point routed here.
  useEffect(() => {
    trackEvent(AnalyticsEvent.PAYWALL_VIEWED);
  }, []);
  const enabled = isFeatureEnabled('subscriptionsEnabled');
  const rcConfigured = Boolean(getRevenueCatApiKey());
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const afterPurchase = useCallback(async () => {
    setSyncing(true);
    try {
      await invalidate();
    } finally {
      setSyncing(false);
    }
  }, [invalidate]);

  const onSubscribe = useCallback(async () => {
    setError(null);
    setBusy('purchase');
    try {
      await purchaseDefaultPackage();
      await afterPurchase();
      router.back();
    } catch (err) {
      // A cancel is not a failure — say nothing. Anything else gets member-facing
      // copy, never StoreKit's or RevenueCat's own string (no raw error leaks).
      if (!(err as { userCancelled?: boolean })?.userCancelled) {
        setError(PURCHASE_FAILED_COPY);
      }
    } finally {
      setBusy(null);
    }
  }, [afterPurchase, router]);

  const onRestore = useCallback(async () => {
    setError(null);
    setBusy('restore');
    try {
      await restorePurchases();
      await afterPurchase();
    } catch {
      setError(RESTORE_FAILED_COPY);
    } finally {
      setBusy(null);
    }
  }, [afterPurchase]);

  return (
    // Same in-body chrome as every other ai-access screen, with the native
    // header off. The native header put a floating back chip on top that
    // labelled itself with the PREVIOUS route's name — `ai-access/index`, since
    // the hub hides its header and so has no title for the back button to
    // borrow. The scaffold's own top bar is just the back control.
    <AIFlowScaffold screenTestID="ai-access-paywall-screen">
      <Stack.Screen options={{ headerShown: false }} />

      <Text style={[styles.body, { color: c.textSecondary }]}>
        Subscribe through Apple to use {brand.displayName}-managed AI for reports, Mira,
        budgets, and more. Cancel anytime in Settings → Apple ID → Subscriptions.
      </Text>

      {isPaid || canUseAI ? (
        <Text style={[styles.meta, { color: c.textTertiary }]}>You already have AI access.</Text>
      ) : null}

      {!enabled ? (
        <Text style={[styles.meta, { color: c.textTertiary }]}>Subscriptions are not available yet.</Text>
      ) : null}

      {enabled && !rcConfigured ? (
        <Text style={[styles.error, { color: c.error }]}>
          Apple subscriptions are not available in this build yet. You can still connect your
          own API key below — and everything in {brand.displayName} apart from AI works without
          either.
        </Text>
      ) : null}

      {error ? <Text style={[styles.error, { color: c.error }]}>{error}</Text> : null}
      {syncing ? <Text style={[styles.meta, { color: c.textTertiary }]}>Purchase received; access is still syncing…</Text> : null}

      <Pressable
        style={[styles.primary, { backgroundColor: c.primary }, (!enabled || !rcConfigured || busy) && styles.disabled]}
        disabled={!enabled || !rcConfigured || busy != null}
        onPress={onSubscribe}
        accessibilityRole="button"
        accessibilityLabel="Subscribe"
      >
        {busy === 'purchase' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>Subscribe</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.secondary, { backgroundColor: c.surface, borderColor: c.border }, (!enabled || !rcConfigured || busy) && styles.disabled]}
        disabled={!enabled || !rcConfigured || busy != null}
        onPress={onRestore}
        accessibilityRole="button"
        accessibilityLabel="Restore purchases"
      >
        {busy === 'restore' ? (
          <ActivityIndicator color={c.primary} />
        ) : (
          <Text style={[styles.secondaryText, { color: c.text }]}>Restore purchases</Text>
        )}
      </Pressable>

      <View style={styles.links}>
        <Pressable
          onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}
          accessibilityRole="link"
        >
          <Text style={[styles.link, { color: c.textSecondary }]}>Manage subscription</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/ai-access')} accessibilityRole="link">
          <Text style={[styles.link, { color: c.textSecondary }]}>Or connect your own API key</Text>
        </Pressable>
      </View>
    </AIFlowScaffold>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 16, lineHeight: 22 },
  meta: { fontSize: 13 },
  error: { fontSize: 13 },
  primary: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1 },
  secondaryText: { fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  links: { gap: 14, marginTop: 2 },
  link: { fontSize: 14, textAlign: 'center', textDecorationLine: 'underline' },
});
