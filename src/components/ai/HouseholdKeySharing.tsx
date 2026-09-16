/**
 * Household AI key sharing — the section on Settings → AI Providers.
 *
 * Two halves, because there are two roles:
 *
 *  - **Sharing out.** For each provider whose key is on THIS device, a control
 *    to offer it to the household. The key is sealed on-device under the
 *    household key before it leaves; the server stores a blob it cannot read.
 *  - **Shared with you.** Keys other members have offered. Using one needs an
 *    explicit acceptance first, because the member's own prompts are about to
 *    reach a third party under someone else's account and billing. Those rows
 *    are `SharedAiKeyList`, the same component the provider picker leads with —
 *    a member most often meets a lent key there, and the two must agree on what
 *    "ready" and "in use" mean.
 *
 * The whole section is hidden unless the brand has a local-first household —
 * without a Household Data Key there is nothing to seal against.
 *
 * Copy rule for this screen: never promise revocation is absolute. Stopping a
 * share ends access through this app, and the console link is the only complete
 * revocation. Both the share confirmation and the stop confirmation say so.
 */

import React, { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import type { AIProviderId } from '@api/aiAccess';
import { brand } from '@brand';
import { Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import {
  aiKeyShareErrorMessage,
  shareAiKeyWithHousehold,
  stopSharingAiKey,
  type HouseholdCrypto,
} from '@services/aiKeyShare';
import { aiKeyVault } from '@services/aiKeyVault';
import { showToast } from '@services/toastManager';
import { useAppColors } from '@theme';

import { providerLabel } from './providerMeta';
import { SharedAiKeyList } from './SharedAiKeys';
import { useSharedAiKeys } from './useSharedAiKeys';

interface Props {
  /** Providers whose key is present in THIS device's Keychain — the shareable set. */
  localKeyProviders: Set<AIProviderId> | null;
  /** Re-read entitlement after a change so the cards above stay truthful. */
  onChanged?: () => void;
}

export function HouseholdKeySharing({ localKeyProviders, onChanged }: Props) {
  const colors = useAppColors();
  // Shared with `SharedAiKeyOffers` on the provider picker, so the received half
  // of this section and the picker's leading block cannot drift apart.
  const {
    households,
    multiHousehold,
    shares,
    fromOthers,
    loading,
    busy,
    setBusy,
    hasOwnKey,
    preferredProvider,
    refresh,
    onUse,
  } = useSharedAiKeys(onChanged);

  /**
   * One row per provider PER HOUSEHOLD. Sharing is a per-household act — the key
   * is sealed under that household's HDK and its members are the ones who get to
   * spend on your provider account — so a device in two households gets two
   * rows, each independently shareable, rather than one row that silently picks.
   */
  const outgoing = [...(localKeyProviders ?? [])].flatMap((provider) =>
    households.map((household, index) => ({
      provider,
      household,
      isShared: shares.some(
        (s) => s.isMine && s.provider === provider && s.householdId === household.householdId,
      ),
      // The active household keeps the bare testID so single-household selectors
      // (the overwhelmingly common case) stay valid.
      testSuffix: index === 0 ? '' : `-${household.householdId}`,
    })),
  );

  const onShare = useCallback(
    (provider: AIProviderId, household: HouseholdCrypto) => {
      // Name the household in the prompt whenever there is a choice: this is the
      // moment the member takes on someone else's provider bill, and "your
      // household" is not specific enough when the device holds two.
      const where = multiHousehold ? `“${household.displayName}”` : 'your household';
      Alert.alert(
        `Share your ${providerLabel(provider)} key?`,
        `Everyone in ${where} will be able to run AI in ${brand.displayName} using this key, and ` +
          `${providerLabel(provider)} will bill YOUR account for what they use.\n\n` +
          'The key is encrypted on this device before it is sent — our servers cannot read it. ' +
          'You can stop sharing at any time, but anyone who has already used it may have kept a copy; ' +
          'the only complete undo is rotating the key in the provider console.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Share',
            onPress: async () => {
              setBusy(`${provider}:${household.householdId}`);
              try {
                const apiKey = await aiKeyVault.getKey(provider);
                if (!apiKey?.trim()) {
                  // The card above can say "connected" off SERVER state while
                  // this device holds no key — sharing nothing would publish an
                  // empty envelope, so stop here and name the fix.
                  showToast(
                    'error',
                    `Your ${providerLabel(provider)} key isn't on this device — tap Change key first.`,
                  );
                  return;
                }
                await shareAiKeyWithHousehold({
                  provider,
                  apiKey: apiKey.trim(),
                  householdId: household.householdId,
                });
                showToast('success', `Your ${providerLabel(provider)} key is shared with ${where}.`);
                await refresh();
                onChanged?.();
              } catch (err) {
                showToast('error', aiKeyShareErrorMessage(err, 'Could not share that key.'));
              } finally {
                setBusy(null);
              }
            },
          },
        ],
      );
    },
    [multiHousehold, onChanged, refresh, setBusy],
  );

  const onStop = useCallback(
    (provider: AIProviderId, household: HouseholdCrypto) => {
      const where = multiHousehold ? `Members of “${household.displayName}”` : 'Household members';
      Alert.alert(
        'Stop sharing?',
        `${where} will no longer be able to run AI on your ${providerLabel(provider)} key.\n\n` +
          'This does not revoke the key at the provider. If you need it to be truly dead, rotate it in ' +
          'the provider console.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Stop sharing',
            style: 'destructive',
            onPress: async () => {
              setBusy(`${provider}:${household.householdId}`);
              try {
                await stopSharingAiKey(provider, household.householdId);
                showToast('success', `Stopped sharing your ${providerLabel(provider)} key.`);
                await refresh();
                onChanged?.();
              } catch (err) {
                showToast('error', aiKeyShareErrorMessage(err, 'Could not stop sharing.'));
              } finally {
                setBusy(null);
              }
            },
          },
        ],
      );
    },
    [multiHousehold, onChanged, refresh, setBusy],
  );

  if (households.length === 0 && !loading) return null;
  if (loading) {
    return <ActivityIndicator color={colors.primary} style={styles.loader} />;
  }
  if (outgoing.length === 0 && fromOthers.length === 0) return null;

  return (
    <View style={styles.section} testID="ai-household-sharing">
      <View style={styles.heading}>
        <Icon name="people" size={16} color={colors.textSecondary} />
        <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
          Household sharing
        </Typography>
      </View>

      {outgoing.map(({ provider, household, isShared, testSuffix }) => {
        const busyKey = `${provider}:${household.householdId}`;
        const shared = multiHousehold
          ? `Shared with “${household.displayName}” — your account is billed.`
          : 'Shared — your household can use it, and your account is billed.';
        const notShared = multiHousehold
          ? `Not shared with “${household.displayName}”.`
          : 'Only on your devices.';
        return (
          <View
            key={`mine-${provider}-${household.householdId}`}
            style={[styles.row, { borderColor: colors.borderColor }]}
            testID={`ai-share-row-${provider}${testSuffix}`}
          >
            <View style={styles.rowText}>
              <Typography variant="subheadline" weight="semibold">
                Your {providerLabel(provider)} key
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {isShared ? shared : notShared}
              </Typography>
            </View>
            <Pressable
              onPress={() =>
                isShared ? onStop(provider, household) : onShare(provider, household)
              }
              disabled={busy === busyKey}
              style={[
                styles.action,
                {
                  backgroundColor: isShared ? 'transparent' : colors.primary,
                  borderColor: isShared ? colors.borderColor : colors.primary,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                isShared
                  ? `Stop sharing your ${providerLabel(provider)} key with ${household.displayName}`
                  : `Share your ${providerLabel(provider)} key with ${household.displayName}`
              }
              testID={`ai-share-toggle-${provider}${testSuffix}`}
            >
              {busy === busyKey ? (
                <ActivityIndicator color={isShared ? colors.textPrimary : colors.white} />
              ) : (
                <Typography
                  variant="caption1"
                  weight="bold"
                  color={isShared ? colors.textPrimary : colors.white}
                >
                  {isShared ? 'Stop Sharing' : 'Share'}
                </Typography>
              )}
            </Pressable>
          </View>
        );
      })}

      <SharedAiKeyList
        variant="row"
        shares={fromOthers}
        busy={busy}
        multiHousehold={multiHousehold}
        hasOwnKey={hasOwnKey}
        preferredProvider={preferredProvider}
        onUse={onUse}
      />

      <Typography variant="caption2" color={colors.textTertiary}>
        Shared keys are encrypted on the sharer’s device with your household key — {brand.displayName}
        ’s servers store them but cannot read them.
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 4 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowText: { flex: 1, gap: 2 },
  action: {
    minWidth: 72,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader: { marginVertical: 12 },
});
