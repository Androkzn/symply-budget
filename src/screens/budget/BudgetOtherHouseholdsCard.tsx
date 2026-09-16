import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import {
  fetchControlPlaneState,
  forgetLocalFirstDevice,
  leaveBudgetHousehold,
  listControlPlaneHouseholds,
  revokeRemoteHouseholdDevice,
  type ControlPlaneHousehold,
  type ControlPlaneState,
} from '@features/budget/local/controlPlaneClient';
import { describeDevice } from '@features/budget/local/deviceName';
import { getLocalLedger, isLocalBudgetSessionOpen, listLocalBudgetHouseholds } from '@features/budget/local/engine';
import type { BudgetStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { ButtonMetrics, CornerRadius, Spacing, useAppColors } from '@theme';

/**
 * Households the ACCOUNT belongs to that this phone holds no ledger for.
 *
 * Membership lives on the control plane; the ledger lives on the device. Those
 * two can part company for entirely ordinary reasons — the member wiped the
 * phone, signed in on a replacement, or switched accounts, all of which archive
 * or mint a local ledger without ending the server-side membership (that is
 * deliberate: wiping one phone must not evict you from a household you still
 * hold on another).
 *
 * The cost of the gap was that the rest of Budget is driven entirely by the
 * local ledger, so such a household became INVISIBLE on this device — including
 * to its own owner. A household whose owner had replaced their phone could then
 * be administered by nobody: other members saw the owner's dead enrolments
 * listed as trusted devices and lacked the role to remove them, while the owner
 * had the role and no screen to use it on. This card is that screen.
 */
/** How many to show before folding the rest away. */
const COLLAPSED_LIMIT = 3;

/** Enough of the id to tell two identically-named households apart. */
function shortHouseholdId(householdId: string): string {
  const bare = householdId.replace(/^hh_local_/i, '');
  return bare.length > 6 ? bare.slice(-6) : bare;
}

export function BudgetOtherHouseholdsCard() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const selfUserId = useAuthStore((s) => s.user?.id);
  const ownDeviceId = isLocalBudgetSessionOpen() ? getLocalLedger().deviceId : null;
  const [others, setOthers] = useState<ControlPlaneHousehold[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stateById, setStateById] = useState<Record<string, ControlPlaneState>>({});
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [leavingHouseholdId, setLeavingHouseholdId] = useState<string | null>(null);
  const [expandedAll, setExpandedAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [remote, local] = [await listControlPlaneHouseholds(), listLocalBudgetHouseholds()];
      const held = new Set(local.map((h) => h.householdId));
      setOthers(remote.filter((h) => !held.has(h.id)));
    } catch {
      // Offline, or the control plane is unreachable. The local list above is
      // still correct and is what the member came here for — an error banner
      // for a supplementary section would be noise.
      setOthers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadState = useCallback(async (householdId: string) => {
    try {
      const state = await fetchControlPlaneState(householdId);
      setStateById((prev) => ({ ...prev, [householdId]: state }));
    } catch {
      Alert.alert('Error', 'Could not load that household right now.');
    }
  }, []);

  const toggle = useCallback(
    (householdId: string) => {
      const next = expandedId === householdId ? null : householdId;
      setExpandedId(next);
      if (next && !stateById[next]) void loadState(next);
    },
    [expandedId, stateById, loadState],
  );

  const handleRevoke = useCallback(
    (household: ControlPlaneHousehold, deviceId: string, deviceName: string) => {
      Alert.alert(
        'Revoke device?',
        `${deviceName} will lose access to ${household.display_name}. Household keys rotate for everyone still in it.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Revoke',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setBusyDeviceId(deviceId);
                try {
                  const state = await revokeRemoteHouseholdDevice(household.id, deviceId);
                  setStateById((prev) => ({ ...prev, [household.id]: state }));
                } catch (error) {
                  const status =
                    typeof error === 'object' && error !== null
                      ? (error as { response?: { status?: number } }).response?.status
                      : undefined;
                  Alert.alert(
                    status === 403 ? 'Owner only' : 'Error',
                    status === 403
                      ? 'Only the household owner can revoke someone else’s device.'
                      : 'Could not revoke that device.',
                  );
                } finally {
                  setBusyDeviceId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [],
  );

  /**
   * Delete a revoked row from a household this phone holds no ledger for.
   *
   * Same act as on the trusted-device list above, and it needs no session or key
   * material here for the same reason it needs none there: the device lost its
   * access when it was revoked, and nothing rotates for a tidy-up. Which is what
   * makes it usable from this card at all — the revoke beside it can only work
   * because the epoch bump happens server-side.
   */
  const handleForget = useCallback(
    (household: ControlPlaneHousehold, deviceId: string, deviceName: string) => {
      Alert.alert(
        'Remove from list?',
        `${deviceName} already lost access to ${household.display_name} when it was revoked. Removing it only clears it from this list.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setBusyDeviceId(deviceId);
                try {
                  const state = await forgetLocalFirstDevice(household.id, deviceId);
                  setStateById((prev) => ({ ...prev, [household.id]: state }));
                } catch (error) {
                  const status =
                    typeof error === 'object' && error !== null
                      ? (error as { response?: { status?: number } }).response?.status
                      : undefined;
                  if (status === 409) {
                    // Re-enrolled between render and tap. Re-read rather than
                    // delete a row that now describes a live device.
                    Alert.alert(
                      'Still has access',
                      'That device has access again. Revoke it first if you want it out.',
                    );
                    await loadState(household.id);
                    return;
                  }
                  Alert.alert(
                    status === 403 ? 'Owner only' : 'Error',
                    status === 403
                      ? 'Only the household owner can remove someone else’s device.'
                      : 'Could not remove that device.',
                  );
                } finally {
                  setBusyDeviceId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [loadState],
  );

  /**
   * Walk out of a household this phone does not hold.
   *
   * The only exit that exists for one of these. Leaving elsewhere is bound to a
   * local ledger — it ends the membership and then erases this device's copy —
   * and there is no copy here to erase, which is exactly why the membership
   * outlives every trace of the household on the phone and can otherwise only
   * be ended by asking its owner. Nothing local is touched; the row simply stops
   * being on the account.
   */
  const handleLeave = useCallback(
    (household: ControlPlaneHousehold) => {
      Alert.alert(
        `Leave ${household.display_name}?`,
        'You leave the household and every device you hold there is removed from its record. Nothing on this phone is deleted — this household’s budget is not stored here. You will need a fresh invite to get back in.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setLeavingHouseholdId(household.id);
                try {
                  await leaveBudgetHousehold(household.id);
                  await refresh();
                } catch (error) {
                  const status =
                    typeof error === 'object' && error !== null
                      ? (error as { response?: { status?: number } }).response?.status
                      : undefined;
                  // Already out — the owner got there first. The list is the
                  // thing that is wrong now, so re-read it and say nothing.
                  if (status === 404) {
                    await refresh();
                    return;
                  }
                  Alert.alert(
                    status === 409 ? 'Make someone else an owner first' : 'Error',
                    status === 409
                      ? `You are the last owner of ${household.display_name}. Make another member an owner before you leave — otherwise nobody left in it could invite anyone or approve a device.`
                      : 'Could not leave that household right now. Nothing has changed.',
                  );
                } finally {
                  setLeavingHouseholdId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [refresh],
  );

  /**
   * Owned first, then by name — and only the first few, because this list is
   * not the handful it looks like in development.
   *
   * A household takes its creator's display name, so an account that has reset
   * its local ledger a few times owns a run of households ALL called "Andrei",
   * one per reset, indistinguishable from each other and from the one that
   * actually matters. (Observed: 46 on one account, 25 after a staging purge.)
   * Ordering by role puts anything shared or owned above the debris, and the
   * short id disambiguates the rest.
   */
  const ordered = useMemo(() => {
    const rank = (h: ControlPlaneHousehold) => (h.role === 'OWNER' ? 0 : 1);
    return [...others].sort(
      (a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name),
    );
  }, [others]);

  const shown = expandedAll ? ordered : ordered.slice(0, COLLAPSED_LIMIT);

  const body = useMemo(() => {
    if (loading || others.length === 0) return null;

    return shown.map((household, index) => {
      const isOwner = household.role === 'OWNER';
      const state = stateById[household.id];
      const expanded = expandedId === household.id;

      return (
        <View
          key={household.id}
          style={[
            styles.householdBlock,
            index > 0 ? { borderTopColor: colors.borderColor, ...styles.divider } : null,
          ]}
        >
          <View style={styles.householdText}>
            <Typography variant="footnote" weight="semibold" numberOfLines={1}>
              {household.display_name}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              {isOwner ? 'You own it' : 'You are a member'} · not on this phone · ID{' '}
              {shortHouseholdId(household.id)}
            </Typography>
          </View>
          {/* One emphasis level per act. The screen's primary CTA is "Sync now"
              at the top; repeating that same brand gradient three times per
              household — six households deep — turned an administrative list
              into a wall of identical slabs, with the destructive act ("Leave")
              wearing exactly the same paint as the benign one ("Manage"). So:
              an outlined action for the one thing you came here to do, quiet
              text for the drill-down, and red for the act you cannot undo. */}
          <Button
            title="Use on this phone"
            variant="outline"
            size="sm"
            fullWidth
            onPress={() => navigation.navigate('BudgetJoin')}
            testID={`budget-other-household-open-${household.id}`}
          />
          <View style={styles.householdActions}>
            <Button
              title={expanded ? 'Hide devices' : 'Manage devices'}
              variant="ghost"
              size="sm"
              underline={false}
              onPress={() => toggle(household.id)}
              testID={`budget-other-household-toggle-${household.id}`}
            />
            {leavingHouseholdId === household.id ? (
              <View style={styles.actionBusy}>
                <ActivityIndicator size="small" color={colors.error} />
              </View>
            ) : (
              <Button
                title="Leave"
                variant="ghost"
                size="sm"
                underline={false}
                // Same weight as its neighbour, told apart by colour alone —
                // the pair reads as one row of text actions, and the one you
                // cannot undo is the red one.
                textColor={colors.error}
                disabled={leavingHouseholdId !== null}
                onPress={() => handleLeave(household)}
                testID={`budget-other-household-leave-${household.id}`}
              />
            )}
          </View>

          {expanded && !state ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}

          {expanded && state
            ? state.devices.map((device) => {
                const { name, meta } = describeDevice({
                  label: device.label,
                  deviceId: device.deviceId,
                  isSelf: ownDeviceId === device.deviceId,
                  status: device.status,
                  enrolledAt: device.enrolledAt,
                  lastSeenAt: device.lastSeenAt,
                });
                const revoked = device.status === 'revoked';
                const mine = Boolean(selfUserId) && device.userId === selfUserId;
                return (
                  <View key={device.deviceId} style={styles.deviceRow}>
                    <View style={styles.deviceText}>
                      <Typography variant="caption1" weight="semibold" numberOfLines={1}>
                        {name}
                      </Typography>
                      <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
                        {meta}
                      </Typography>
                    </View>
                    {isOwner || mine ? (
                      busyDeviceId === device.deviceId ? (
                        <ActivityIndicator size="small" color={colors.error} />
                      ) : revoked ? (
                        // Nothing folds these away here, so a household that has
                        // cycled through a few phones is mostly dead rows until
                        // somebody can clear them.
                        <Button
                          title="Remove"
                          variant="destructive"
                          size="sm"
                          onPress={() => handleForget(household, device.deviceId, name)}
                          testID={`budget-other-household-forget-${device.deviceId}`}
                        />
                      ) : (
                        <Button
                          title="Revoke"
                          variant="destructive"
                          size="sm"
                          onPress={() => handleRevoke(household, device.deviceId, name)}
                          testID={`budget-other-household-revoke-${device.deviceId}`}
                        />
                      )
                    ) : null}
                  </View>
                );
              })
            : null}
        </View>
      );
    });
  }, [
    loading,
    others.length,
    shown,
    stateById,
    expandedId,
    colors,
    selfUserId,
    busyDeviceId,
    leavingHouseholdId,
    toggle,
    handleRevoke,
    handleForget,
    handleLeave,
    navigation,
    ownDeviceId,
  ]);

  // Silence is the common case — most members hold every household they belong
  // to — and an empty "Other households" heading would only raise a question it
  // then refuses to answer.
  if (!body) return null;

  return (
    <>
      <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
        OTHER HOUSEHOLDS ON YOUR ACCOUNT
      </Typography>
      <Card style={styles.card} testID="budget-other-households">
        <Typography variant="caption2" color={colors.textSecondary} style={styles.intro}>
          These are on your account but their budget is not stored on this phone. Use on this phone
          downloads it next to the budget you already have — you will need a fresh invite from the
          owner, then you pick which household to open in Settings → Households.
        </Typography>
        {body}
        {ordered.length > COLLAPSED_LIMIT ? (
          <Button
            title={expandedAll ? 'Show fewer' : `Show all ${ordered.length} households`}
            variant="ghost"
            size="sm"
            underline={false}
            style={styles.showAll}
            onPress={() => setExpandedAll((v) => !v)}
            testID="budget-other-households-toggle-all"
          />
        ) : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  // Matches the "TRUSTED DEVICES" heading directly above this card.
  groupLabel: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  card: { padding: Spacing.base, borderRadius: CornerRadius.lg },
  intro: { marginBottom: Spacing.sm },
  householdBlock: { gap: Spacing.sm, paddingVertical: Spacing.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.md },
  householdText: { gap: 2 },
  /** Secondary acts sit on one right-aligned line under the CTA — they hug
   *  their labels rather than stretching into slabs that compete with it. */
  householdActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  actionBusy: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: ButtonMetrics.minTapTarget,
    minHeight: ButtonMetrics.minTapTarget,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.base,
  },
  deviceText: { flex: 1, gap: 2 },
  showAll: { marginTop: Spacing.xs, alignSelf: 'center' },
});
