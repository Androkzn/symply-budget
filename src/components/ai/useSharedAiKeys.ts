/**
 * Shared AI keys — the state behind every "a member lent you their key" surface.
 *
 * Two screens show the same facts and must not drift: the provider picker
 * (`app/ai-access/providers.tsx`) leads with the keys that are already waiting
 * for you, and the manage hub lists them under your own sharing controls. Both
 * read this hook, so the consent copy, the accepted/ready states and the billing
 * rule are written once.
 *
 * ## What "Use" actually does
 *
 * Accepting is a DISCLOSURE, not a switch: it records that the member
 * understands their prompts are about to reach a third party under someone
 * else's account and billing. What decides which key a call runs on is
 * `resolveLocalByokProvider`, and its rule is a billing one — every key of the
 * member's OWN is spent before anyone else's.
 *
 * So "Use" also writes this device's preferred provider, which is what makes the
 * button mean what it says when a member is lent more than one provider. Two
 * guards on that write, because only one key can be the one that runs:
 *
 *  - **Never with a key of the member's own on the device.** The preference
 *    could not change which key runs (own always wins) and writing it anyway
 *    would quietly stomp the member's own default.
 *  - **Never as a side effect of accepting.** A member lent all three keys
 *    accepts all three; if each acceptance took over, the last one tapped would
 *    win by accident. Accepting a key while another lent key is already running
 *    only records the disclosure — the row then offers "Set default", and THAT
 *    is the tap that switches. The first accepted key has nothing to displace,
 *    so it starts running immediately and the member is told so.
 *
 * Renders nothing outside a local-first household — `householdCryptos()` answers
 * empty for a brand or device with no Household Data Key, which is also the
 * capability check every consumer uses to decide whether to show the section.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import type { AIProviderId } from '@api/aiAccess';
import { brand } from '@brand';
import {
  acceptSharedAiKey,
  aiKeyShareErrorMessage,
  forgetBorrowedAiKey,
  householdCryptos,
  listSharedAiKeys,
  type HouseholdCrypto,
  type SharedAiKeySummary,
} from '@services/aiKeyShare';
import { aiKeyVault } from '@services/aiKeyVault';
import { getPreferredProvider, setPreferredProvider } from '@services/aiModelPreference';
import { showToast } from '@services/toastManager';

import { CONSENT_VERSION, PROVIDER_ORDER, providerLabel } from './providerMeta';

/** Who lent the key, for copy that has to name them. */
export function shareOwnerName(share: SharedAiKeySummary): string {
  return share.ownerName?.trim() || 'A member';
}

/**
 * Whether this share is the key a local AI call would actually pick up right
 * now: accepted, nothing of the member's own to spend first, and the provider
 * this device prefers.
 */
export function isSharedKeyInUse(
  share: SharedAiKeySummary,
  opts: { hasOwnKey: boolean; preferredProvider: AIProviderId | null },
): boolean {
  return share.consented && !opts.hasOwnKey && opts.preferredProvider === share.provider;
}

export interface SharedAiKeysState {
  /** Every local-first household on this device (active first). */
  households: HouseholdCrypto[];
  /** Name the household in copy only when there is more than one to confuse. */
  multiHousehold: boolean;
  /** Every share visible to this member, mine and theirs. */
  shares: SharedAiKeySummary[];
  /** The half that other members lent to this one. */
  fromOthers: SharedAiKeySummary[];
  loading: boolean;
  /** id of the row mid-action — a share id here, `provider:householdId` in the hub. */
  busy: string | null;
  setBusy: (id: string | null) => void;
  /** True when this device holds a key of the member's own, for any provider. */
  hasOwnKey: boolean;
  /** The provider this device runs AI on when it has a choice. */
  preferredProvider: AIProviderId | null;
  /** The lent key AI actually runs on right now, if any. */
  activeShare: SharedAiKeySummary | null;
  refresh: () => Promise<void>;
  /** Accept a lent key, or — once accepted — make it the one that runs. */
  onUse: (share: SharedAiKeySummary) => void;
}

export function useSharedAiKeys(onChanged?: () => void): SharedAiKeysState {
  const [households, setHouseholds] = useState<HouseholdCrypto[]>([]);
  const [shares, setShares] = useState<SharedAiKeySummary[]>([]);
  const [hasOwnKey, setHasOwnKey] = useState(false);
  const [preferredProvider, setPreferredProviderState] = useState<AIProviderId | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Every household on this device, not just the active one — see the note on
    // `householdCryptos`. A member whose device had minted its own household
    // before joining a shared one saw no shares at all while this read one.
    const hh = await householdCryptos();
    setHouseholds(hh);
    if (hh.length === 0) {
      setLoading(false);
      return;
    }

    const [own, preferred] = await Promise.all([
      Promise.all(PROVIDER_ORDER.map((id) => aiKeyVault.hasKey(id).catch(() => false))),
      getPreferredProvider(),
    ]);
    setHasOwnKey(own.some(Boolean));
    setPreferredProviderState(preferred);

    try {
      const { shares: rows } = await listSharedAiKeys();
      setShares(rows);
    } catch {
      // A household that has never registered with the control plane 404s here.
      // That is "nothing shared yet", not an error worth a red banner.
      setShares([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const multiHousehold = households.length > 1;
  const fromOthers = shares.filter((s) => !s.isMine);
  const activeShare =
    fromOthers.find((s) => isSharedKeyInUse(s, { hasOwnKey, preferredProvider })) ?? null;

  const applyShare = useCallback(
    async (share: SharedAiKeySummary) => {
      const who = shareOwnerName(share);
      const label = providerLabel(share.provider);
      // An explicit "Set default" always takes over; an acceptance does so only
      // when there is nothing to displace. See the two guards at the top.
      const takesOver = !hasOwnKey && (share.consented || !activeShare);
      setBusy(share.id);
      try {
        if (!share.consented) {
          await acceptSharedAiKey({
            householdId: share.householdId,
            shareId: share.id,
            provider: share.provider,
            consentVersion: CONSENT_VERSION,
          });
        }
        if (takesOver) await setPreferredProvider(share.provider);
        // Drop the "nobody is sharing this provider" back-off so the very next
        // scan picks the key up instead of waiting out the negative cache.
        forgetBorrowedAiKey(share.provider);
        showToast(
          'success',
          takesOver
            ? `AI in ${brand.displayName} now runs on ${who}'s ${label} key.`
            : hasOwnKey
              ? `${who}'s ${label} key is ready. Your own key is spent first — this one is the fallback.`
              : // Name what DID stay in charge: the member accepted a key and
                // nothing visibly changed, which reads as a failed tap unless
                // the toast says why and where the switch lives.
                `${who}'s ${label} key is ready. ${shareOwnerName(activeShare!)}'s ` +
                `${providerLabel(activeShare!.provider)} key still runs AI — tap Set default to switch.`,
        );
        await refresh();
        onChanged?.();
      } catch (err) {
        showToast('error', aiKeyShareErrorMessage(err, 'Could not use that key.'));
      } finally {
        setBusy(null);
      }
    },
    [activeShare, hasOwnKey, onChanged, refresh],
  );

  const onUse = useCallback(
    (share: SharedAiKeySummary) => {
      // Already disclosed — this tap only changes which provider runs, so it
      // must not re-ask a question the member has answered.
      if (share.consented) {
        void applyShare(share);
        return;
      }
      const who = shareOwnerName(share);
      // Which household lent it matters to the decision when the device holds
      // several — the answer to "who is about to see my receipts" differs.
      const via = multiHousehold ? ` (via “${share.householdName}”)` : '';
      Alert.alert(
        `Use ${who}'s ${providerLabel(share.provider)} key?`,
        `What you send to AI in ${brand.displayName} — receipts, notes, the text you ask about — will be ` +
          `processed by ${providerLabel(share.provider)} under ${who}'s account${via}, and billed to them.\n\n` +
          'Their provider account, not ours, governs how that data is retained.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Use this key', onPress: () => void applyShare(share) },
        ],
      );
    },
    [applyShare, multiHousehold],
  );

  return {
    households,
    multiHousehold,
    shares,
    fromOthers,
    loading,
    busy,
    setBusy,
    hasOwnKey,
    preferredProvider,
    activeShare,
    refresh,
    onUse,
  };
}
