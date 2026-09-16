/**
 * "Shared with you" — the keys other household members lent to this one.
 *
 * One list, two presentations:
 *
 *  - `SharedAiKeyOffers` is the standalone block at the TOP of the provider
 *    picker. A member who has been lent a key has nothing to type and no console
 *    to visit, so the picker must lead with that rather than bury it under three
 *    "go and create a developer key" cards.
 *  - `SharedAiKeyList` with `variant="row"` is the compact half inside the
 *    manage hub's household-sharing section, where it sits under the member's
 *    own outgoing shares.
 *
 * Both render the same rows from the same state (`useSharedAiKeys`), so the
 * consent step, the "ready" wording and the billing rule cannot drift apart.
 *
 * Copy rule, inherited from the sharing section: never imply the lender's key is
 * free. Every state that can spend it says whose account is billed.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AIProviderId } from '@api/aiAccess';
import { brand } from '@brand';
import { Icon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import type { SharedAiKeySummary } from '@services/aiKeyShare';
import { useAppColors } from '@theme';

import { ProviderBrandMark } from './ProviderBrandMark';
import { providerLabel } from './providerMeta';
import { isSharedKeyInUse, shareOwnerName, useSharedAiKeys } from './useSharedAiKeys';

interface SharedAiKeyListProps {
  shares: SharedAiKeySummary[];
  /** Share id currently mid-action. */
  busy: string | null;
  multiHousehold: boolean;
  hasOwnKey: boolean;
  preferredProvider: AIProviderId | null;
  onUse: (share: SharedAiKeySummary) => void;
  /** `card` — the picker's full-width cards. `row` — the manage hub's compact rows. */
  variant?: 'card' | 'row';
}

/** The rows themselves — presentational, so both hosts own their own layout. */
export function SharedAiKeyList({
  shares,
  busy,
  multiHousehold,
  hasOwnKey,
  preferredProvider,
  onUse,
  variant = 'row',
}: SharedAiKeyListProps) {
  const colors = useAppColors();
  if (shares.length === 0) return null;

  return (
    <>
      {shares.map((share) => {
        const label = providerLabel(share.provider);
        const who = shareOwnerName(share);
        const inUse = isSharedKeyInUse(share, { hasOwnKey, preferredProvider });
        // Tapping must be able to CHANGE something. Once the member has accepted
        // and this key is what runs — or their own key outranks it either way —
        // the button would be a no-op, so the row shows state instead of an
        // affordance.
        const canApply = !share.consented || (!hasOwnKey && !inUse);
        // The label is what tells the two taps apart, which is why there is no
        // "set as default or just save?" prompt: accepting says Use, switching
        // says Set default, and only one of them is on a row at a time.
        const action = share.consented ? 'Set default' : 'Use';

        const status = !share.consented
          ? `••••${share.keyHint} · accept to use it`
          : inUse
            ? `In use · ••••${share.keyHint} · billed to them`
            : hasOwnKey
              ? `Ready · your own ${label} key is spent first`
              : `Ready · ••••${share.keyHint} · billed to them`;

        return (
          <View
            key={share.id}
            style={[
              variant === 'card' ? styles.card : styles.row,
              {
                borderColor: inUse ? colors.success : colors.borderColor,
                ...(variant === 'card' ? { backgroundColor: colors.card } : null),
              },
            ]}
            testID={`ai-shared-with-me-${share.provider}`}
          >
            {variant === 'card' ? (
              <ProviderBrandMark provider={share.provider} size={40} connected={inUse} />
            ) : null}

            <View style={styles.rowText}>
              <Typography
                variant={variant === 'card' ? 'headline' : 'subheadline'}
                weight="semibold"
                color={colors.textPrimary}
              >
                {`${who}'s ${label} key`}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {(multiHousehold ? `${share.householdName} · ` : '') + status}
              </Typography>
            </View>

            {canApply ? (
              <Pressable
                onPress={() => onUse(share)}
                disabled={busy === share.id}
                style={[styles.action, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                accessibilityRole="button"
                accessibilityLabel={
                  share.consented
                    ? `Run AI on ${who}'s shared ${label} key`
                    : `Use ${who}'s shared ${label} key`
                }
                // Distinct ids per state on purpose: a flow that means to SWITCH
                // must not silently accept instead (or the reverse) because both
                // taps landed on the same selector.
                testID={
                  share.consented
                    ? `ai-shared-default-${share.provider}`
                    : `ai-shared-accept-${share.provider}`
                }
              >
                {busy === share.id ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Typography variant="caption1" weight="bold" color={colors.white}>
                    {action}
                  </Typography>
                )}
              </Pressable>
            ) : (
              <View style={styles.readyBadge}>
                <Icon name="checkmark-circle" size={20} color={colors.success} />
              </View>
            )}
          </View>
        );
      })}
    </>
  );
}

/**
 * The picker's leading block: keys already waiting for this member.
 *
 * Renders nothing at all when there is nothing lent — including on brands with
 * no local-first household, where the whole concept does not exist — so the
 * picker is unchanged for everyone else.
 */
export function SharedAiKeyOffers({ onChanged }: { onChanged?: () => void }) {
  const colors = useAppColors();
  const { fromOthers, loading, busy, multiHousehold, hasOwnKey, preferredProvider, onUse } =
    useSharedAiKeys(onChanged);

  // A member can be lent all three providers, and only one of them can be the
  // one that runs — say so rather than letting the second Set default look like
  // it failed to stick.
  const oneRunsAtATime =
    fromOthers.length > 1 && !hasOwnKey
      ? ' Only one runs at a time — tap Set default on another to switch.'
      : '';

  // No spinner: this block is an addition to a screen that is already useful
  // without it, and a placeholder above the provider cards would push them
  // around on every open.
  if (loading || fromOthers.length === 0) return null;

  return (
    <View style={styles.section} testID="ai-shared-keys-offers">
      <View style={styles.heading}>
        <Icon name="people" size={16} color={colors.textSecondary} />
        <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
          Shared with you
        </Typography>
      </View>

      <Typography variant="caption1" color={colors.textSecondary} style={styles.blurb}>
        {`Someone in your household lent you their key. Tap Use — there is no key to create or type, ` +
          `and AI in ${brand.displayName} runs on their provider account, billed to them.` +
          oneRunsAtATime}
      </Typography>

      <SharedAiKeyList
        variant="card"
        shares={fromOthers}
        busy={busy}
        multiHousehold={multiHousehold}
        hasOwnKey={hasOwnKey}
        preferredProvider={preferredProvider}
        onUse={onUse}
      />

      <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.orHeading}>
        Or connect your own key
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  blurb: { lineHeight: 18 },
  orHeading: { marginTop: 4 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
  },
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
  readyBadge: { width: 72, alignItems: 'center' },
});
