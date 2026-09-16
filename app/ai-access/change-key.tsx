/**
 * Change key — a dedicated, focused screen for rotating an ALREADY-connected
 * provider's API key (Settings → AI Providers → a connected card → "Change key",
 * or the per-provider detail screen).
 *
 * Unlike the first-connect flow (`connect.tsx`), the user has already accepted
 * the §17.4 cost/privacy disclosures and picked a default + model, so this screen
 * skips the acknowledgement gate and the model step entirely. It just:
 *   1. shows the current key hint + status,
 *   2. lets the user paste + reveal + dry-run test a new key,
 *   3. saves it (device Keychain + a fresh server session lease) — preserving the
 *      existing default-provider, model, and recorded consent.
 *
 * Brand-neutral copy + theme so every app in the ecosystem renders it in its own
 * colours.
 */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { aiAccessApi, type AIProviderId } from '@api/aiAccess';
import { brand } from '@brand';
import { AIFlowError } from '@components/ai/AIFlowError';
import { AIFlowScaffold } from '@components/ai/AIFlowScaffold';
import { ProviderBrandMark } from '@components/ai/ProviderBrandMark';
import { PROVIDER_META, isAIProviderId } from '@components/ai/providerMeta';
import { GradientButton, Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { aiKeyVault } from '@services/aiKeyVault';
import { showToast } from '@services/toastManager';
import { useAppColors } from '@theme';

function formatStatus(status: string): string {
  const words = status.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown';
}

export default function ChangeKeyScreen() {
  const router = useRouter();
  const colors = useAppColors();
  const params = useLocalSearchParams<{ provider?: string }>();
  const provider: AIProviderId = isAIProviderId(params.provider) ? params.provider : 'anthropic';
  const meta = PROVIDER_META[provider];

  const { byokConnections, invalidate, bringYourOwnAIEnabled } = useAIEntitlement();
  const connection = byokConnections.find((c) => c.provider === provider) ?? null;

  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
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
  const canSave = trimmed.length >= 8 && !busy;

  const onKeyChange = (value: string) => {
    setKey(value);
    // A new key invalidates any prior verdict — both the dry-run result and a
    // failed save. Leaving the red card under the button while the user pastes
    // a corrected key reads as "still broken".
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
      // The dry-run endpoint never rejects on a bad key (resolves `{ ok:false }`),
      // so a thrown error is infra/auth/network — not a verdict on the key. Never
      // surface the raw axios "status code 401" string.
      const status =
        (err as { response?: { status?: number }; statusCode?: number })?.response?.status ??
        (err as { statusCode?: number })?.statusCode;
      setTest({
        state: 'fail',
        message:
          status === 401 || status === 403
            ? "Couldn't verify the key. Check you pasted the whole key (tap the eye to reveal it) — if it looks right, reopen the app and try again."
            : `Couldn't reach ${meta.label} to test the key. Check your connection and try again. You can still save the key.`,
      });
    }
  };

  const onSave = async () => {
    if (!bringYourOwnAIEnabled) {
      setError('BYOK is not enabled.');
      return;
    }
    if (trimmed.length < 8) {
      setError('Paste your new API key first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Rotate in place: the durable key goes to the device Keychain; the server
      // gets a fresh short-lived session lease. Consent is deliberately NOT
      // re-sent — the user already accepted the data-sharing terms on first
      // connect, and a silent re-key must not overwrite that recorded consent.
      // Default provider + selected model are untouched.
      await aiKeyVault.setKey(provider, trimmed);
      await aiAccessApi.createSessionLease(provider, trimmed);
      await invalidate();
      setKey('');
      showToast('success', `${meta.label} key updated.`);
      router.back();
    } catch (err) {
      // Never surface the raw axios/system string ("Request failed with status
      // code 401", "Invalid or expired token") — same mapping as the first-
      // connect flow, so a rotation failure reads like an error the user can
      // act on rather than a leaked stack detail.
      const status =
        (err as { response?: { status?: number }; statusCode?: number })?.response?.status ??
        (err as { statusCode?: number })?.statusCode;
      setError(
        status === 401 || status === 403
          ? 'Your session has expired. Please sign out and sign in again, then change your key.'
          : "Couldn't save the new key. Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AIFlowScaffold
      title="Change key"
      subtitle={`Paste a new ${meta.label} API key to replace the one on file. It is stored in this device's Keychain — ${brand.displayName} keeps only a short-lived, encrypted pass and never shows the key again. Your default provider and model stay the same.`}
      screenTestID="ai-access-change-key-screen"
      footer={
        <>
          {error ? <AIFlowError message={error} testID="ai-change-key-error" /> : null}
          <GradientButton
            title={busy ? 'Saving…' : 'Save new key'}
            variant="teal"
            size="lg"
            fullWidth
            disabled={!canSave}
            onPress={onSave}
            testID="ai-change-key-save-button"
          />
          {!canSave && !busy ? (
            <Typography
              variant="caption1"
              color={colors.textTertiary}
              style={styles.saveHint}
              testID="ai-change-key-hint"
            >
              Paste your new API key above to enable Save.
            </Typography>
          ) : null}
        </>
      }
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Identity + the key currently on file */}
      <View style={[styles.identity, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
        <ProviderBrandMark provider={provider} size={44} connected={!!connection} />
        <View style={styles.identityText}>
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            {meta.label}
          </Typography>
          {connection ? (
            <Typography variant="caption1" color={colors.textSecondary}>
              Current key {connection.keyHint} · {formatStatus(connection.status)}
            </Typography>
          ) : (
            <Typography variant="caption1" color={colors.textSecondary}>
              No key on file
            </Typography>
          )}
        </View>
      </View>

      {/* New key input */}
      <View style={styles.inputBlock}>
        <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
          New API key
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
            testID="ai-change-key-input"
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
              testID="ai-change-key-visibility-toggle"
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

        {/* Test connection — dry-run probe, nothing is saved. */}
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
          testID="ai-change-key-test-button"
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
          <View style={styles.testResult} testID="ai-change-key-test-result">
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

      {/* Where to mint a fresh key */}
      <Pressable
        style={[styles.consoleRow, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
        onPress={() => Linking.openURL(meta.consoleUrl)}
        accessibilityRole="link"
        accessibilityLabel={`Open the ${meta.label} console to create a key (opens in browser)`}
        testID="ai-change-key-console-link"
      >
        <Icon name="key-outline" size={18} color={colors.textSecondary} />
        <Typography variant="footnote" color={colors.textPrimary} style={styles.consoleLabel}>
          Create a new key in the {meta.label} console
        </Typography>
        <Icon name="open-outline" size={16} color={colors.textTertiary} />
      </Pressable>
    </AIFlowScaffold>
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
  consoleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  consoleLabel: { flex: 1 },
  saveHint: { textAlign: 'center', marginTop: 2 },
});
