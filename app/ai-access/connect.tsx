/**
 * Step 2 of the BYOK flow — paste + acknowledge + connect a provider key.
 *
 * Branded NUX chrome + an illustrated `ProviderKeyGuide` (a mock developer
 * console, not a bundled screenshot) so users can actually obtain a key, plus
 * the §17.4 cost/privacy acknowledgement gate before a key can be saved.
 */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { aiAccessApi, type AIProviderId } from '@api/aiAccess';
import { api } from '@api/client';
import { brand } from '@brand';
import { AIFlowError } from '@components/ai/AIFlowError';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { ProviderKeyGuide } from '@components/ai/ProviderKeyGuide';
import {
  CONSENT_VERSION,
  PROVIDER_META,
  isAIProviderId,
  providerLabel,
} from '@components/ai/providerMeta';
import { Icon, GradientButton, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { aiKeyVault } from '@services/aiKeyVault';
import { setPreferredProvider } from '@services/aiModelPreference';
import { useAppColors } from '@theme';

/**
 * Ask whether to switch the app's default AI to a newly-connected provider when
 * the user already has another one set up. Resolves true = switch, false = keep
 * the current default (the new key stays connected either way, just not default).
 */
function confirmDefaultSwitch(
  newLabel: string,
  currentProvider: AIProviderId | null
): Promise<boolean> {
  const current = currentProvider ? providerLabel(currentProvider) : null;
  return new Promise((resolve) => {
    Alert.alert(
      `Make ${newLabel} your default?`,
      current
        ? `${current} is currently powering your AI. Use ${newLabel} instead from now on?`
        : `Use ${newLabel} as your default AI from now on?`,
      [
        { text: 'Keep current', style: 'cancel', onPress: () => resolve(false) },
        { text: `Use ${newLabel}`, onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

export default function ConnectKeyScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const params = useLocalSearchParams<{ provider?: string }>();
  const {
    invalidate,
    bringYourOwnAIEnabled,
    byokConnections,
    provider: activeProvider,
  } = useAIEntitlement();
  const provider: AIProviderId = isAIProviderId(params.provider) ? params.provider : 'anthropic';
  const meta = PROVIDER_META[provider];

  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; message: string }>({
    state: 'idle',
    message: '',
  });

  const trimmed = key.trim();
  const looksValid = useMemo(
    () => meta.keyPrefixes.some((p) => trimmed.startsWith(p)),
    [trimmed, meta.keyPrefixes]
  );
  const canTest = trimmed.length >= 8 && test.state !== 'testing' && !busy;
  const canConnect = acknowledged && trimmed.length >= 8 && !busy;

  const onKeyChange = (value: string) => {
    setKey(value);
    // A new key invalidates any prior verdict — both the dry-run result and a
    // failed connect. Leaving the red card under the button while the user is
    // pasting a corrected key reads as "still broken".
    if (test.state !== 'idle') setTest({ state: 'idle', message: '' });
    if (error) setError(null);
  };

  const onTest = async () => {
    if (!canTest) return;
    setError(null);
    setTest({ state: 'testing', message: '' });
    try {
      const result = await aiAccessApi.testConnection(provider, trimmed);
      if (result.ok) {
        setTest({ state: 'ok', message: `${meta.label} responded — this key works.` });
      } else {
        setTest({
          state: 'fail',
          message:
            result.error_code === 'invalid_key'
              ? 'That key was rejected. Check you copied the whole key.'
              : `Couldn't reach ${meta.label}. Check your connection and try again.`,
        });
      }
    } catch (err) {
      // The dry-run endpoint is designed never to reject on a bad key (it
      // resolves `{ ok:false }`), so a thrown error here is an infra/auth/network
      // problem — NOT a verdict on the key. Never surface the raw axios
      // "Request failed with status code 401" string; map it to something the
      // user can act on. A 401/403 during a probe usually means the pasted key
      // is wrong or the session lapsed, so point them at both.
      const status =
        (err as { response?: { status?: number }; statusCode?: number })?.response?.status ??
        (err as { statusCode?: number })?.statusCode;
      setTest({
        state: 'fail',
        message:
          status === 401 || status === 403
            ? "Couldn't verify the key. Check you pasted the whole key (tap the eye to reveal it) — if it looks right, reopen the app and try again."
            : `Couldn't reach ${meta.label} to test the key. Check your connection and try again. You can still Connect to save the key.`,
      });
    }
  };

  const onConnect = async () => {
    if (!bringYourOwnAIEnabled) {
      setError('BYOK is not enabled.');
      return;
    }
    if (!acknowledged) {
      setError('Please acknowledge the cost and privacy terms first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The key's durable home is the device Keychain. The server gets only a
      // short-lived, encrypted session lease so background AI keeps working.
      // The user's data-sharing consent (Apple 5.1.2(i)) rides along on connect.
      await aiKeyVault.setKey(provider, trimmed);
      await api.post(`/ai-credentials/${provider}/session-lease`, {
        api_key: trimmed,
        consent: { version: CONSENT_VERSION, accepted_at: new Date().toISOString() },
      });

      // Default-provider selection:
      //  • the first/only connected provider (or re-keying the current default) →
      //    make it the default automatically, no prompt.
      //  • another provider is already connected → ask before switching the default
      //    away from the one the user is already using.
      const otherConnected = (byokConnections ?? []).filter((c) => c.provider !== provider);
      const makeDefault =
        activeProvider === provider || otherConnected.length === 0
          ? true
          : await confirmDefaultSwitch(meta.label, activeProvider);
      if (makeDefault) {
        await api.patch('/ai-preferences', {
          credential_source: 'byok',
          active_provider: provider,
        });
        await setPreferredProvider(provider);
      }
      await invalidate();
      setKey('');
      router.replace(`/ai-access/models?provider=${provider}`);
    } catch (err) {
      // Never surface the raw axios/system string ("Request failed with status
      // code 401", "Invalid or expired token"). Map to friendly, actionable copy.
      const status =
        (err as { response?: { status?: number }; statusCode?: number })?.response?.status ??
        (err as { statusCode?: number })?.statusCode;
      setError(
        status === 401 || status === 403
          ? 'Your session has expired. Please sign out and sign in again, then reconnect your key.'
          : "Couldn't connect your key. Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  const disclosures = [
    `Provider API charges are separate from ${brand.displayName} and Apple — the provider bills you directly.`,
    'Costs vary by model, tokens, files, images, and retries.',
    `${brand.displayName} cannot read your provider balance or guarantee a spending cap.`,
    'Prompts may include your household data needed for the selected feature.',
    'Retention / training terms depend on your own provider account settings.',
    `Your key is stored in this device's Keychain. ${brand.displayName} holds only a short-lived, encrypted pass so background features keep working — it expires automatically and you can revoke it anytime.`,
    'Deleting the key here does not revoke it at the provider — revoke it in the provider console.',
  ];

  return (
    <AIFlowScaffold
      title={`Connect ${meta.label}`}
      screenTestID="ai-access-connect-screen"
      subtitle={`Paste a developer API key. It is stored in this device's Keychain — ${brand.displayName} keeps only a short-lived, encrypted pass and never shows the key again.`}
      footer={
        <>
          {error ? <AIFlowError message={error} testID="ai-connect-error" /> : null}
          <GradientButton
            title={busy ? 'Connecting…' : 'Connect & validate'}
            variant="teal"
            size="lg"
            fullWidth
            disabled={!canConnect}
            onPress={onConnect}
            testID="ai-connect-button"
          />
          {/* Tell the user *why* the CTA is inert — the greyed button otherwise
              reads as "no way to save". Connect is the save action; it just gates
              on a key + the acknowledgement. */}
          {!canConnect && !busy ? (
            <Typography
              variant="caption1"
              color={colors.textTertiary}
              style={styles.connectHint}
              testID="ai-connect-hint"
            >
              {trimmed.length < 8
                ? 'Paste your API key above to enable Connect.'
                : 'Tick the box above to enable Connect.'}
            </Typography>
          ) : null}
        </>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Illustrated "how to get a key" diagram */}
      <ProviderKeyGuide provider={provider} />

      {/* Key input */}
      <View style={styles.inputBlock}>
        <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
          API key
        </Typography>
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: colors.inputFieldBackground,
              borderColor: looksValid ? colors.success : colors.borderColor,
            },
          ]}
        >
          <TextInput
            testID="ai-key-input"
            style={[styles.input, { color: colors.textPrimary }]}
            value={key}
            onChangeText={onKeyChange}
            placeholder={meta.keyFormat}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showKey}
            textContentType="password"
            editable={!busy}
          />
          {trimmed.length > 0 ? (
            <Pressable
              onPress={() => setShowKey((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={showKey ? 'Hide API key' : 'Show API key'}
              testID="ai-key-visibility-toggle"
            >
              <Icon
                name={showKey ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
          {looksValid ? <Icon name="checkmark-circle" size={20} color={colors.success} /> : null}
        </View>
        <Typography variant="caption1" color={colors.textTertiary}>
          Looks like: {meta.keyFormat}
        </Typography>

        {/* Test connection — dry-run probe, nothing is saved. Lets the user
            confirm the key actually reaches the provider before committing. */}
        <Pressable
          style={[
            styles.testBtn,
            // Brand-tinted border so it reads as an outline button, matching the
            // shared Button's `outline` variant, rather than a faint grey box.
            { borderColor: canTest ? colors.primary : colors.borderColor },
            !canTest && styles.testBtnDisabled,
          ]}
          onPress={onTest}
          disabled={!canTest}
          accessibilityRole="button"
          accessibilityLabel={`Test ${meta.label} connection`}
          testID="ai-test-connection-button"
        >
          {test.state === 'testing' ? (
            <ActivityIndicator color={colors.primaryDark} />
          ) : (
            <>
              <Icon name="pulse" size={16} color={colors.primaryDark} />
              <Typography variant="footnote" weight="semibold" color={colors.primaryDark}>
                Test connection
              </Typography>
            </>
          )}
        </Pressable>

        {test.state === 'ok' || test.state === 'fail' ? (
          <View style={styles.testResult} testID="ai-test-connection-result">
            <Icon
              name={test.state === 'ok' ? 'checkmark-circle' : 'alert-circle'}
              size={16}
              color={test.state === 'ok' ? colors.success : colors.error}
            />
            <Typography
              variant="caption1"
              color={test.state === 'ok' ? colors.success : colors.error}
              style={styles.testResultText}
            >
              {test.message}
            </Typography>
          </View>
        ) : null}
      </View>

      {/* Data & privacy — provider-specific disclosure shown BEFORE any request
          is sent (Apple App Review Guideline 5.1.2(i)). What leaves the device,
          to whom, under whose terms, and that {brand} does not store it. */}
      <View style={[styles.privacyBox, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.privacyHeader}>
          <Icon name="shield-checkmark" size={16} color={colors.primaryDark} />
          <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
            What you share with {meta.label}
          </Typography>
        </View>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.privacyText}>
          Connecting sends the content of your AI requests — which can include your household,
          task, budget, or note data — directly to {meta.label} using your own key and account.{' '}
          <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
            {brand.displayName} does not store your prompts or the personal data you choose to
            submit.
          </Typography>{' '}
          What you send is up to you.
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.privacyText}>
          {meta.dataDisclaimer}
        </Typography>

        {/* Provider's own official policies — the authoritative source. */}
        <View style={styles.linkRow}>
          {meta.legalLinks.map((link) => (
            <Pressable
              key={link.url}
              onPress={() => Linking.openURL(link.url)}
              accessibilityRole="link"
              accessibilityLabel={`${meta.label} ${link.label} (opens in browser)`}
              hitSlop={6}
            >
              <Typography variant="caption1" weight="semibold" color={colors.primaryDark}>
                {link.label} ↗
              </Typography>
            </Pressable>
          ))}
        </View>

        {/* Free-tier warning (Gemini): free-tier content may be trained on and
            human-reviewed — advise against sending sensitive data. */}
        {meta.freeTierWarning ? (
          <View
            testID="ai-free-tier-warning"
            style={[
              styles.warnCard,
              { backgroundColor: colors.warning + '1A', borderColor: colors.warning },
            ]}
          >
            <Icon name="warning" size={16} color={colors.warning} />
            <Typography variant="caption1" color={colors.textPrimary} style={styles.warnText}>
              {meta.freeTierWarning}
            </Typography>
          </View>
        ) : null}
      </View>

      {/* Disclosures */}
      <View style={[styles.disclosureBox, { backgroundColor: colors.backgroundSecondary }]}>
        {disclosures.map((d) => (
          <View key={d} style={styles.disclosureItem}>
            <Icon name="ellipse" size={5} color={colors.textTertiary} style={styles.bullet} />
            <Typography variant="caption1" color={colors.textSecondary} style={styles.disclosureText}>
              {d}
            </Typography>
          </View>
        ))}
      </View>

      {/* Acknowledgement gate */}
      <Pressable
        style={styles.ackRow}
        onPress={() => setAcknowledged((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acknowledged, selected: acknowledged }}
        disabled={busy}
        testID="ai-consent-checkbox"
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: acknowledged ? colors.primaryDark : colors.borderColor,
              backgroundColor: acknowledged ? colors.primaryDark : 'transparent',
            },
          ]}
        >
          {acknowledged ? <Icon name="checkmark" size={15} color={colors.white} /> : null}
        </View>
        <Typography variant="footnote" color={colors.textPrimary} style={styles.ackText}>
          I understand my requests are sent to {meta.label} under my own account and terms, that{' '}
          {brand.displayName} does not store the personal data I submit, that provider charges are
          billed to me directly, and I agree to proceed.
        </Typography>
      </Pressable>
    </AIFlowScaffold>
  );
}

const styles = StyleSheet.create({
  inputBlock: { gap: 8 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 10,
    marginTop: 4,
    minHeight: 44,
  },
  testBtnDisabled: { opacity: 0.5 },
  testResult: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  testResultText: { flex: 1, lineHeight: 16 },
  privacyBox: {
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  privacyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  privacyText: { lineHeight: 18 },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingTop: 2 },
  warnCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 2,
  },
  warnText: { flex: 1, lineHeight: 18 },
  disclosureBox: {
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  disclosureItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bullet: { marginTop: 7 },
  disclosureText: { flex: 1, lineHeight: 18 },
  connectHint: { textAlign: 'center', marginTop: 2 },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 4 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  ackText: { flex: 1, lineHeight: 20 },
});
