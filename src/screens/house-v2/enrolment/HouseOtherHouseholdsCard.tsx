/**
 * Homes the ACCOUNT belongs to that this device holds no ledger for.
 *
 * Membership lives on the control plane; the home itself lives on the device.
 * Those two part company for entirely ordinary reasons — the phone was wiped and
 * the member signed in on a replacement, they reinstalled, or they switched
 * accounts. Every one of those opens a fresh local ledger without ending the
 * server-side membership, which is deliberate: wiping one phone must not evict
 * you from a home you still hold on another.
 *
 * The cost of the gap is that the whole of House V2 is driven by the LOCAL
 * ledger — `syncHouseholdStoreFromLocalLedger` republishes "Homes" from the
 * engine's own sessions — so a home in that state is invisible on this device to
 * its own owner. Observed on staging: one account carrying 17 homes it could
 * neither see nor get rid of from inside the app, and a member whose real home
 * simply vanished from the list with nothing on screen to explain it.
 *
 * This card is the escape hatch. It is not the fix for the cause (that is
 * adopt-before-mint, in the engine); it is what makes the drift visible, and
 * what the members already carrying it can act on — because nothing else in the
 * app can reach those homes at all.
 *
 * Deliberately NOT offered here: `DELETE /households/:id`. It soft-deletes the
 * LEGACY `households` mirror, while this list is served from `lf_households`
 * JOIN `lf_memberships` (`listHouseholdsForUser`) — so it would leave every row
 * on screen exactly where it was. Ending the local-first membership is the only
 * act that removes one, which is what "Remove from account" below does.
 */
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Card, GradientButton, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import {
  fetchControlPlaneState,
  leaveHouseHousehold,
  listControlPlaneHouseholds,
  type ControlPlaneHousehold,
  type ControlPlaneState,
} from '@features/house/local/controlPlaneClient';
import { listLocalHouseProperties } from '@features/house/local/engine';
import { isHouseLocalFirst } from '@features/house/local/flag';
import type { SettingsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { Spacing, useAppColors } from '@theme';

import { StatusLine } from './enrolmentShared';

/** How many to show before folding the rest away — 17 rows is not a list. */
const COLLAPSED_LIMIT = 3;

/** Enough of the id to tell two identically-named homes apart. */
function shortHouseholdId(householdId: string): string {
  const bare = householdId.replace(/^hh_local_/i, '');
  return bare.length > 6 ? bare.slice(-6) : bare;
}

function isOwnerRole(role: string | null | undefined): boolean {
  return (role ?? '').trim().toUpperCase() === 'OWNER';
}

function httpStatusOf(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'response' in error
    ? (error as { response?: { status?: number } }).response?.status
    : undefined;
}

/**
 * Whether the server will accept this account walking out, decided by the same
 * rule the coordinator decides it by (`handleLeaveHousehold`).
 *
 * An owner is refused ONLY while other people are still in the home and none of
 * them is an owner — otherwise the home survives with members who can never
 * invite, approve a device or remove anybody. The LAST person in a home may
 * always leave, owner or not, and that is the case every one of these orphans
 * is in: nobody is left to strand.
 *
 * Reading it off the roster rather than off the account id means it needs no
 * identity of its own: "I am the only owner" and "there are two owners" are both
 * answerable by counting, and the count is the same rule either way.
 */
function canLeaveHome(myRole: string, state: ControlPlaneState): boolean {
  if (!isOwnerRole(myRole)) return true;
  const active = state.members.filter((m) => m.status === 'active');
  if (active.length <= 1) return true;
  return active.filter((m) => isOwnerRole(m.role)).length > 1;
}

type RowState =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; state: ControlPlaneState };

export function HouseOtherHouseholdsCard() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const localFirst = isHouseLocalFirst();

  /**
   * The published home list, read as a CHANGE SIGNAL rather than as truth.
   *
   * The engine's own sessions are the authority on what this device holds, and
   * they are not reactive — nothing re-renders when a home is created, joined or
   * removed. The store is republished from those same sessions on every one of
   * those acts, so watching it is what re-runs the diff at the moment the answer
   * changes.
   */
  const storeHouseholdIds = useHouseholdStore((s) => s.households.map((h) => h.id).join(','));

  const [others, setOthers] = useState<ControlPlaneHousehold[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  /**
   * Drift is what the control plane holds MINUS what this device holds.
   *
   * Both local sources count, and a home named by either one is not drift. They
   * are republished from each other so they normally agree, but the moment they
   * do not, the union is the safe side to be wrong on: a false NEGATIVE hides a
   * row until the next visit, while a false positive puts an irreversible
   * "remove from account" next to a home the member still has.
   */
  const refresh = useCallback(async () => {
    if (!localFirst) {
      setLoading(false);
      return;
    }
    try {
      const remote = await listControlPlaneHouseholds();
      const held = new Set<string>([
        ...listLocalHouseProperties().map((p) => p.householdId),
        ...useHouseholdStore.getState().households.map((h) => h.id),
      ]);
      setOthers(remote.filter((h) => !held.has(h.id)));
    } catch {
      // Offline, or the control plane is unreachable. The homes list this card
      // sits under is local and still correct, and it is what the member came
      // here for — an error banner for a supplementary section would be noise,
      // and a blocked screen would be a bug.
      setOthers([]);
    } finally {
      setLoading(false);
    }
  }, [localFirst]);

  useEffect(() => {
    void refresh();
  }, [refresh, storeHouseholdIds]);

  /**
   * One roster read, and only for a row the member opened.
   *
   * An account in this state has seventeen of these; fetching every roster on
   * mount would be seventeen calls to decide which buttons to draw, on a screen
   * that has to work with no network at all.
   */
  const loadRowState = useCallback(async (householdId: string) => {
    setRowStates((prev) => ({ ...prev, [householdId]: { phase: 'loading' } }));
    try {
      const state = await fetchControlPlaneState(householdId);
      setRowStates((prev) => ({ ...prev, [householdId]: { phase: 'ready', state } }));
    } catch {
      // A quiet retry, in the row. Not a dialog: the member tapped "Options",
      // not something that promised to reach the network.
      setRowStates((prev) => ({ ...prev, [householdId]: { phase: 'failed' } }));
    }
  }, []);

  const toggle = useCallback(
    (householdId: string) => {
      const next = expandedId === householdId ? null : householdId;
      setExpandedId(next);
      if (next && rowStates[next]?.phase !== 'ready') void loadRowState(next);
    },
    [expandedId, rowStates, loadRowState],
  );

  /**
   * End this account's membership — the only act that takes a row off this list.
   *
   * Nothing local is touched, and nothing local COULD be: this device holds no
   * ledger for the home, which is the whole reason the row is here. So the
   * confirmation must not promise that anything is deleted, and must say the one
   * thing that is both true and irreversible — a device that still holds this
   * home stops sharing it with this account.
   */
  const confirmLeave = useCallback(
    (household: ControlPlaneHousehold, alone: boolean) => {
      const run = () => {
        void (async () => {
          setBusyId(household.id);
          setRowError((prev) => ({ ...prev, [household.id]: '' }));
          try {
            await leaveHouseHousehold(household.id);
            await refresh();
          } catch (error) {
            const status = httpStatusOf(error);
            // Already out — somebody removed this account while this phone was
            // offline. The list is the thing that is wrong now, so re-read it
            // and say nothing.
            if (status === 404) {
              await refresh();
              return;
            }
            setRowError((prev) => ({
              ...prev,
              [household.id]:
                status === 409
                  ? 'Someone else in this home is relying on you being an owner. Make another person an owner first.'
                  : 'Could not reach your account just now. Nothing has changed — try again when you are back online.',
            }));
          } finally {
            setBusyId(null);
          }
        })();
      };

      Alert.alert(
        alone ? `Remove "${household.display_name}"?` : `Leave "${household.display_name}"?`,
        alone
          ? 'Nobody else is in this home, so removing it takes it off your account for good. Nothing on this phone is deleted — this home is not stored here. If it is still on another device, that device keeps everything in it but stops sharing it with your account.'
          : 'You leave this home and every device you have there is removed from it. Nothing on this phone is deleted — this home is not stored here. You will need a fresh invite to get back in.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: alone ? 'Remove' : 'Leave', style: 'destructive', onPress: run },
        ],
      );
    },
    [refresh],
  );

  /**
   * Shared homes first, then by name.
   *
   * A home takes its creator's display name, so an account that has re-minted a
   * few times owns a run of homes ALL called the same thing, indistinguishable
   * from each other and from the one that matters. Somebody else's home — the
   * one that actually disappeared off this member's list — is the row they came
   * for, so it goes above that debris, and the short id separates the rest.
   */
  const ordered = useMemo(() => {
    const rank = (h: ControlPlaneHousehold) => (isOwnerRole(h.role) ? 1 : 0);
    return [...others].sort(
      (a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name),
    );
  }, [others]);

  const shown = showAll ? ordered : ordered.slice(0, COLLAPSED_LIMIT);

  const rows = useMemo(() => {
    if (loading || ordered.length === 0) return null;

    return shown.map((household) => {
      const owner = isOwnerRole(household.role);
      const row = rowStates[household.id];
      const expanded = expandedId === household.id;
      const busy = busyId === household.id;
      const error = rowError[household.id];

      const ready = row?.phase === 'ready' ? row.state : null;
      const alone = ready ? ready.members.filter((m) => m.status === 'active').length <= 1 : false;
      const mayLeave = ready ? canLeaveHome(household.role, ready) : false;

      return (
        <View
          key={household.id}
          style={styles.row}
          testID={`house-other-household-${household.id}`}
        >
          <View style={styles.rowHead}>
            <View style={styles.rowText}>
              <Typography variant="footnote" weight="semibold" numberOfLines={1}>
                {household.display_name}
              </Typography>
              <Typography variant="caption2" color={colors.textSecondary}>
                {owner ? 'You set this one up' : 'Someone shared this one with you'} · not on this
                phone · ID {shortHouseholdId(household.id)}
              </Typography>
            </View>
            <View style={styles.rowActions}>
              <GradientButton
                title="Get it back"
                size="sm"
                onPress={() => navigation.navigate('HouseDeviceSync')}
                testID={`house-other-household-recover-${household.id}`}
              />
              <GradientButton
                title={expanded ? 'Hide' : 'Options'}
                variant="secondary"
                size="sm"
                onPress={() => toggle(household.id)}
                testID={`house-other-household-options-${household.id}`}
              />
            </View>
          </View>

          {expanded && row?.phase === 'loading' ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}

          {expanded && row?.phase === 'failed' ? (
            <View style={styles.rowDetail}>
              <Typography variant="caption2" color={colors.textSecondary}>
                Could not check who else is in this home.
              </Typography>
              <GradientButton
                title="Try again"
                variant="secondary"
                size="sm"
                onPress={() => void loadRowState(household.id)}
                testID={`house-other-household-retry-${household.id}`}
              />
            </View>
          ) : null}

          {expanded && ready ? (
            <View style={styles.rowDetail}>
              {mayLeave ? (
                <>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    {alone
                      ? 'Nobody else is in this home. Removing it takes it off your account — nothing on this phone is deleted.'
                      : 'Leaving takes this home off your account — nothing on this phone is deleted.'}
                  </Typography>
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.error} />
                  ) : (
                    <GradientButton
                      title={alone ? 'Remove from account' : 'Leave this home'}
                      variant="secondary"
                      size="sm"
                      onPress={() => confirmLeave(household, alone)}
                      testID={`house-other-household-leave-${household.id}`}
                    />
                  )}
                </>
              ) : (
                // No button at all, because the server would refuse it (409
                // `last_owner_cannot_leave`) and an action that is guaranteed to
                // fail is worse than no action.
                <Typography variant="caption2" color={colors.textSecondary}>
                  You are the only person in charge of this home, so you cannot take it off your
                  account — everyone else in it would be left with a home nobody can manage. Put
                  someone else in charge first, from a device that has it.
                </Typography>
              )}
              {error ? (
                <StatusLine
                  text={error}
                  tone="error"
                  testID={`house-other-household-status-${household.id}`}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      );
    });
  }, [
    loading,
    ordered.length,
    shown,
    rowStates,
    expandedId,
    busyId,
    rowError,
    colors,
    navigation,
    toggle,
    loadRowState,
    confirmLeave,
  ]);

  // Silence is the common case — most members hold every home they belong to —
  // and an empty "homes elsewhere" heading would only raise a question it then
  // refuses to answer. It is also what a failed lookup renders.
  if (!rows) return null;

  return (
    <Card variant="filled" style={styles.card} testID="house-other-households-card">
      <Typography variant="body" weight="semibold">
        Homes on your account that are not on this phone
      </Typography>
      <Typography variant="caption2" color={colors.textSecondary}>
        These were set up on another device, or before this app was reinstalled. Nothing in them is
        stored on this phone.
      </Typography>

      {rows}

      {ordered.length > COLLAPSED_LIMIT ? (
        <GradientButton
          title={showAll ? 'Show fewer' : `Show all ${ordered.length}`}
          variant="secondary"
          size="sm"
          onPress={() => setShowAll((v) => !v)}
          testID="house-other-households-show-all"
        />
      ) : null}

      {/* The two ways a home comes BACK onto a phone already exist; this points
          at them rather than inventing a third. "Get it back" on a row opens
          device sync, where another device that has the home approves this one;
          a member with no other device restores from their recovery phrase. */}
      <View style={styles.footer}>
        <Typography variant="caption2" color={colors.textSecondary}>
          Have your recovery phrase? You can bring a home back from a backup instead.
        </Typography>
        <GradientButton
          title="Restore from a backup"
          variant="secondary"
          size="sm"
          onPress={() => navigation.navigate('HouseBackup')}
          testID="house-other-households-restore"
        />
      </View>
    </Card>
  );
}

export default HouseOtherHouseholdsCard;

const styles = StyleSheet.create({
  card: { marginBottom: 24, padding: 16, borderRadius: 12, gap: Spacing.sm },
  row: { gap: Spacing.xs },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  rowText: { flex: 1 },
  rowActions: { gap: Spacing.xs, alignItems: 'flex-end' },
  rowDetail: { gap: Spacing.xs, paddingLeft: Spacing.base },
  footer: { gap: Spacing.xs, marginTop: Spacing.xs },
});
