import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Avatar, Card, GradientButton, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { BudgetSyncProgressPanel } from '@features/budget/components/BudgetSyncProgressPanel';
import {
  budgetHouseholdControlPlaneStatus,
  fetchControlPlaneState,
  forgetLocalFirstDevice,
  renameLocalFirstDevice,
  revokeLocalFirstDevice,
  type ControlPlaneState,
} from '@features/budget/local/controlPlaneClient';
import {
  describeDevice,
  getLocalDeviceName,
  suggestDeviceName,
} from '@features/budget/local/deviceName';
import {
  clearLocalConflicts,
  getActiveBudgetHouseholdId,
  getLedgerRevision,
  getLocalConflicts,
  getLocalLedger,
  isLocalBudgetSessionOpen,
  requestHouseholdBackfill,
  subscribeToLedgerChanges,
} from '@features/budget/local/engine';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { budgetMemberName } from '@features/budget/local/householdRoster';
import { runBudgetLocalSync } from '@features/budget/local/sync/orchestrator';
import type { SyncErrorCode } from '@features/budget/local/sync/syncErrors';
import {
  formatRecordCount,
  readBudgetSyncInventory,
} from '@features/budget/local/sync/syncInventory';
import {
  useBudgetSyncStatusStore,
  type SyncPhase,
} from '@features/budget/local/sync/syncStatusStore';
import type { BudgetStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';

import { BudgetDangerZoneCard } from './BudgetDangerZoneCard';
import { BudgetDeviceNameSheet } from './BudgetDeviceNameSheet';
import { BudgetOtherHouseholdsCard } from './BudgetOtherHouseholdsCard';

/**
 * Re-render on every move of the ACTIVE household's ledger, and hand back which
 * household that is.
 *
 * Two things on this screen are read straight off the engine rather than out of
 * a React store — which household the device list describes, and how many
 * conflicts that household has logged — and the engine is a mutable projection
 * with a listener set, so neither is visible to React until something unrelated
 * happens to re-render. Before BR-016 that was survivable because the answer
 * never changed; now a switch replaces the entire contents of this screen.
 *
 * The revision is the snapshot because it moves for both facts: an activation
 * bumps it (with the NEW id, so the switch itself passes the filter below) and
 * so does an auto-merge logging a conflict. The filter is the same rule
 * `sync/ledgerRefresh.ts` uses — a background household's mailbox sync must not
 * repaint a screen that is not showing it — and it is read per event rather than
 * captured, because the pointer it compares against is what just moved.
 */
function useActiveBudgetHouseholdId(): string | null {
  const subscribe = useCallback(
    (onChange: () => void) =>
      subscribeToLedgerChanges((_revision, change) => {
        if (change.householdId !== getActiveBudgetHouseholdId()) return;
        onChange();
      }),
    [],
  );
  useSyncExternalStore(subscribe, getLedgerRevision, getLedgerRevision);
  return getActiveBudgetHouseholdId();
}

/**
 * Budget → Settings → Device sync.
 *
 * Split out of BudgetSettingsScreen, where sync, backup and invites shared one
 * card and the member had to read the whole thing to find the one button they
 * came for. This screen owns everything about THIS device's copy of the budget:
 * force a sync, see which devices are trusted, revoke one — and, last, the
 * irreversible local wipes.
 *
 * The Danger zone lives here rather than at the bottom of Settings on purpose:
 * erasing this phone's ledger is a sync-shaped decision (the data lives here,
 * not on a server), so it belongs beside the trusted-device list that explains
 * who else still holds a copy.
 *
 * Everything below the Sync button is scoped to ONE household (BR-016): trust is
 * granted per household, so the same phone can be an enrolled device of the
 * household you are in and a stranger to the one you are not. The screen follows
 * the ACTIVE household and names it on every call, rather than letting each
 * helper re-resolve "whatever is active" at its own await point.
 */
export function BudgetSyncScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();

  const [isSyncing, setIsSyncing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [syncNote, setSyncNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [controlPlane, setControlPlane] = useState<ControlPlaneState | null>(null);
  const [localName, setLocalName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [forgettingDeviceId, setForgettingDeviceId] = useState<string | null>(null);
  /**
   * Revoked devices stay on record — the list is also an audit of who lost
   * access and when — but they are not what the member came to read, and after
   * clearing out a few stale enrolments they crowd out the devices that still
   * work. Folded away by default, one tap from view.
   *
   * Folding is not deleting, and eventually a member wants the second thing: a
   * phone that was replaced two handsets ago is not an audit record anybody will
   * read again, and the toggle only moves it out of sight. Each revoked row
   * carries its own Remove (see `handleForget`).
   */
  const [showRevoked, setShowRevoked] = useState(false);

  // The self row is synthesised before the control plane has registered this
  // device (see `deviceRows`), and it has to carry a face too — otherwise the
  // one row that is definitely you is the only one without one.
  const self = useAuthStore((s) => s.user);

  const activeHouseholdId = useActiveBudgetHouseholdId();

  const lastSyncedAt = useBudgetSyncStatusStore((s) => s.lastSyncedAt);
  const pendingOutbound = useBudgetSyncStatusStore((s) => s.pendingOutbound);
  // While a backfill is already owed, the progress panel above is saying so and
  // the retry is automatic — offering a second button for the same work would
  // read as "the first one did not take".
  const backfilling = useBudgetSyncStatusStore((s) => s.backfilling);

  /**
   * How many records this device holds, re-counted whenever the ledger moves.
   *
   * Null until the first count lands (and for a device with no household), which
   * is what keeps the row off the screen rather than showing a "0" that would
   * read as data loss during the half-second before the real number arrives.
   */
  const [recordTotal, setRecordTotal] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const count = () => {
      const householdId = getActiveBudgetHouseholdId();
      if (!householdId) {
        if (!cancelled) setRecordTotal(null);
        return;
      }
      void readBudgetSyncInventory(householdId)
        .then((inventory) => {
          if (!cancelled) setRecordTotal(inventory.total);
        })
        .catch(() => {
          // An unreadable ledger leaves the row hidden rather than showing a
          // number this screen cannot stand behind.
          if (!cancelled) setRecordTotal(null);
        });
    };
    count();
    const stop = subscribeToLedgerChanges(count);
    return () => {
      cancelled = true;
      stop();
    };
  }, [activeHouseholdId]);

  /**
   * BR-044's count, taken from the ACTIVE household's ledger rather than from
   * the sync status store.
   *
   * The store is one device-wide record. The orchestrator only lets the active
   * household write to it, which correctly keeps a background household's
   * failure off this screen — but it also means the number still sitting there
   * after a switch belongs to the household you LEFT, until the one you arrived
   * in happens to sync. Acknowledging that notice would then clear the conflicts
   * of a household it was never about, and the real ones would stay hidden. The
   * ledger keeps conflicts per household, so ask it.
   */
  const conflicts = isLocalBudgetSessionOpen() ? getLocalConflicts().length : 0;

  // Device-scoped, not household-scoped: one device, one identity, registered
  // per household on the control plane (`createLocalBudgetHousehold` reuses
  // `deviceId`). So this survives a switch untouched and only the registrations
  // it is matched against below change.
  const localDeviceId =
    isBudgetLocalFirst() && isLocalBudgetSessionOpen() ? getLocalLedger().deviceId : null;

  useEffect(() => {
    let alive = true;
    void getLocalDeviceName().then((name) => {
      if (alive) setLocalName(name);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refreshControlPlane = useCallback(async () => {
    if (!isBudgetLocalFirst() || !activeHouseholdId) return;
    try {
      const state = await fetchControlPlaneState(activeHouseholdId);
      // The member may have switched while this was in flight. Painting one
      // household's registrations under another is the cross-household bleed
      // BR-016 exists to prevent, and here it is one a user can act on: a
      // Revoke button aimed at a device in the wrong household's registry.
      if (getActiveBudgetHouseholdId() !== activeHouseholdId) return;
      setControlPlane(state);
    } catch {
      if (getActiveBudgetHouseholdId() !== activeHouseholdId) return;
      setControlPlane(null);
    }
  }, [activeHouseholdId]);

  useEffect(() => {
    // Blank BEFORE the new household's answer arrives, rather than leaving the
    // previous list up as a placeholder. A trusted-device list is a security
    // surface: rows that are stale for a few hundred milliseconds are rows the
    // member can revoke in the wrong household, and "no devices yet" is at
    // worst momentarily pessimistic. The note goes with it — it describes a
    // sync run of the household just left.
    setControlPlane(null);
    setSyncNote(null);
    void refreshControlPlane();
  }, [refreshControlPlane]);

  /** Plain language, never engine vocabulary ("via mailbox", "5 merge conflicts"). */
  const statusLine = useMemo(() => {
    if (isSyncing) return 'Syncing…';
    const waiting =
      pendingOutbound > 0
        ? ` · ${pendingOutbound} change${pendingOutbound === 1 ? '' : 's'} waiting to send`
        : '';
    if (!lastSyncedAt) return `Not synced on this device yet${waiting}`;
    return `Last synced ${new Date(lastSyncedAt).toLocaleString()}${waiting}`;
  }, [isSyncing, lastSyncedAt, pendingOutbound]);

  /**
   * Deliberately the fan-out (`runBudgetLocalSync`), not `runBudgetLocalSyncFor`
   * the active household.
   *
   * "Sync now" is the member's answer to "is my budget up to date", and on a
   * device holding several households the honest answer covers all of them —
   * the alternative is a household that never catches up until it is switched
   * into. Reading the outcome off the status store stays correct anyway: the
   * orchestrator only lets the ACTIVE household write there, so the note below
   * describes this screen's household even though the run touched every one.
   */
  const handleSyncNow = () => {
    // The tap itself, before anything can swallow it.
    //
    // "Sync now does nothing" is a report about this handler, and until this
    // line existed there was no way to tell the three cases apart from a log:
    // the tap never reached here, it reached here and the run refused to start,
    // or it ran a full round and legitimately found nothing. Every path below
    // now prints, including the failure one.
    console.log('[BudgetLocal] SYNC NOW tapped');
    setSyncNote(null);
    setIsSyncing(true);
    void runBudgetLocalSync('sync-now-button')
      .then(() => {
        const s0 = useBudgetSyncStatusStore.getState();
        console.log(
          `[BudgetLocal] SYNC NOW finished phase=${s0.phase} appliedFromPeers=${s0.lastAppliedFromPeers} pendingOutbound=${s0.pendingOutbound} peersOnline=${s0.peersOnline} conflicts=${s0.conflicts} transport=${s0.lastTransport ?? 'none'} errorCode=${s0.lastErrorCode ?? 'none'}`,
        );
      })
      .then(async () => {
        // Inline, not an alert: the result belongs next to the button that
        // caused it, and a modal here interrupts whatever the member was doing
        // to say "done".
        const s = useBudgetSyncStatusStore.getState();
        if (s.phase === 'offline' || s.phase === 'error') {
          setSyncNote({ ok: false, text: syncFailureCopy(s.phase, s.lastErrorCode) });
          return;
        }
        // 'idle' means this household never ran — it is not "up to date".
        //
        // `syncOneHousehold` returns at `setPhase('idle')` before doing anything
        // when the household has no control-plane row, which is correct: a solo
        // ledger is a file on this phone and must not be published just because
        // somebody tapped a button. What was wrong was what the member was then
        // told. 'idle' fell through to the success branch below with
        // `lastAppliedFromPeers === 0`, so a household that deliberately did
        // NOTHING reported "Up to date. Nothing new from your household." —
        // word for word what a healthy, fully-synced household reports.
        //
        // That is the "Sync now does nothing" report: the button works, the
        // sync is skipped by design, and the only signal says everything is
        // fine. Naming the actual state costs one branch and turns an invisible
        // no-op into the next thing to do.
        //
        // WHICH 'idle' it is has to be asked, not assumed. The gate returns
        // false for a solo household AND for a device that could not reach the
        // control plane, so claiming "only on this device" off `idle` alone
        // tells a member of a real shared household, on a train, that their
        // budget is not shared — and then invites them to fix it by inviting
        // somebody who is already a member. Wrong, and worse than saying
        // nothing. `budgetHouseholdControlPlaneStatus` separates the two.
        if (s.phase === 'idle') {
          const status = activeHouseholdId
            ? await budgetHouseholdControlPlaneStatus(activeHouseholdId)
            : 'unknown';
          setSyncNote(
            status === 'no'
              ? {
                  ok: true,
                  text: 'This budget is only on this device. Invite someone to start syncing.',
                }
              : {
                  // 'unknown' — do not guess in either direction. Nothing was
                  // sent and nothing was lost, and that is the whole message.
                  ok: false,
                  text: 'Could not check your household just now. Your changes are safe on this device and will sync when it is back.',
                },
          );
          return;
        }
        setSyncNote({
          ok: true,
          text:
            s.lastAppliedFromPeers > 0
              ? `Up to date — ${s.lastAppliedFromPeers} change${
                  s.lastAppliedFromPeers === 1 ? '' : 's'
                } from your household.`
              : 'Up to date. Nothing new from your household.',
        });
      })
      .catch((error: unknown) => {
        // `runBudgetLocalSync` swallows per-household failures via allSettled,
        // so reaching here means the fan-out itself broke. That used to be
        // reported to the member as "could not reach your household" and to the
        // log as nothing at all.
        console.warn('[BudgetLocal] SYNC NOW failed', error);
        setSyncNote({
          ok: false,
          text: 'Could not reach your household right now. Your changes are safe on this device.',
        });
      })
      .finally(() => {
        setIsSyncing(false);
        void refreshControlPlane();
      });
  };

  /**
   * "I can see less than the others can" — the repair for a partial ledger.
   *
   * Re-arms the durable backfill marker and runs a sync, which downloads and
   * installs the household's checkpoint. Non-destructive by construction:
   * `installCheckpointPlaintext` replaces the projection and then replays every
   * local op newer than the snapshot, so anything authored on this device
   * survives.
   *
   * Manual rather than automatic because there is no signal a device can read to
   * know it is missing history — that is exactly the shape of the bug, a ledger
   * that looks healthy from the inside. The member comparing two phones is the
   * only detector that exists.
   */
  const handleDownloadHistory = () => {
    const householdId = activeHouseholdId;
    if (!householdId) return;
    setSyncNote(null);
    setRepairing(true);
    void requestHouseholdBackfill(householdId)
      .then(() => runBudgetLocalSync('history-repair'))
      .then(() => {
        const s = useBudgetSyncStatusStore.getState();
        setSyncNote(
          s.backfilling
            ? {
                // Still owed: the household has not published a snapshot yet.
                // Says whose action is missing, because the member cannot do
                // anything about it themselves and should not keep retrying.
                ok: false,
                text: 'No household snapshot to download yet. Ask another member to open their Budget once — it publishes one — then try again.',
              }
            : { ok: true, text: 'This device now holds the full household history.' },
        );
      })
      .catch((error: unknown) => {
        console.warn('[BudgetLocal] history repair failed', error);
        setSyncNote({
          ok: false,
          text: 'Could not download the history right now. Nothing on this device was changed.',
        });
      })
      .finally(() => setRepairing(false));
  };

  /**
   * BR-044: an auto-merge kept this device's value and dropped the incoming one.
   * Acknowledging clears the ledger's conflict log, so the notice describes what
   * happened SINCE the member last looked rather than everything that ever
   * happened — an un-clearable running total stops being read after a while.
   *
   * `clearLocalConflicts` is one of the engine's deliberately active-only calls,
   * which is exactly right here: the count above is now read from the same
   * active ledger, so the button clears the log the notice was about. The store
   * is zeroed alongside it only to keep the device-wide record honest — nothing
   * on screen reads it for this any more.
   */
  const handleAcknowledgeConflicts = () => {
    void clearLocalConflicts()
      .then(() => useBudgetSyncStatusStore.getState().setResult({ conflicts: 0 }))
      .catch(() => {
        // Nothing to tell the member: the log is a notice, not their data, and a
        // failed clear just means they see the same notice next time.
      });
  };

  /**
   * One row per device, self first.
   *
   * The self row is synthesised when the control plane has not registered this
   * device yet — first launch, or a local erase that minted a new device id.
   * Without it the list showed only the OTHER copies, each under an opaque id,
   * and the phone in the member's hand was missing from its own device list.
   */
  const deviceRows = useMemo((): DeviceRow[] => {
    const rows: DeviceRow[] = (controlPlane?.devices ?? []).map((device) => ({
      deviceId: device.deviceId,
      status: device.status,
      label: device.label ?? null,
      enrolledAt: device.enrolledAt ?? null,
      isSelf: device.deviceId === localDeviceId,
      isMine: Boolean(self?.id) && device.userId === self?.id,
      lastSeenAt: device.lastSeenAt ?? null,
      // Whose phone this is. A household of two people with two phones each
      // showed four rows of hardware and no way to tell which pair was whose.
      owner: {
        display_name: device.displayName ?? null,
        avatar_url: device.avatarUrl ?? null,
        email: device.email ?? '',
      },
    }));
    if (localDeviceId && !rows.some((row) => row.isSelf)) {
      rows.push({
        deviceId: localDeviceId,
        status: 'active',
        label: localName,
        enrolledAt: null,
        isSelf: true,
        isMine: true,
        lastSeenAt: null,
        owner: {
          display_name: self?.display_name ?? null,
          avatar_url: self?.avatar_url ?? null,
          email: self?.email ?? '',
        },
      });
    }
    return rows.sort((a, b) => rank(a) - rank(b));
  }, [controlPlane, localDeviceId, localName, self]);

  /**
   * Only the household OWNER may revoke a device — the coordinator enforces it
   * (`handleRevokeDevice` in backend/src/durable-objects/household-coordinator.ts
   * 403s any actor whose active member row is not `OWNER`).
   *
   * …with one exception the server also makes: anyone may revoke their OWN
   * devices (`device.isMine`), so a member who loses a phone can cut it off
   * without waiting on the owner.
   *
   * The list used to offer "Revoke" on every row that was not your own phone,
   * whoever was looking. For a non-owner that button could only ever fail: the
   * DELETE came back 403 and the member got "Could not revoke that device",
   * which reads as a glitch rather than a rule, so the natural response was to
   * try again — and then to try it on a different device. (Seen on Budget-B:
   * five 403s across three devices in forty seconds.) Mirror the server's own
   * predicate so the button is only ever shown to someone it can work for.
   */
  const revokedRows = useMemo(
    () => deviceRows.filter((row) => row.status === 'revoked'),
    [deviceRows],
  );
  const visibleDeviceRows = useMemo(
    () => (showRevoked ? deviceRows : deviceRows.filter((row) => row.status !== 'revoked')),
    [deviceRows, showRevoked],
  );

  const isHouseholdOwner = useMemo(() => {
    const members = controlPlane?.members ?? [];
    if (!self?.id) return false;
    return members.some(
      (member) => member.userId === self.id && member.status === 'active' && member.role === 'OWNER',
    );
  }, [controlPlane, self]);

  /**
   * The name is device-scoped but a registration is per household, so the push
   * names the household whose list is on screen. Left to default, it would
   * resolve the active household again inside `renameLocalFirstDevice` — after
   * an await, and therefore possibly a different one — and the state it returns
   * would be a registry this screen is not showing.
   */
  const handleRename = async (name: string) => {
    try {
      const result = await renameLocalFirstDevice(name, activeHouseholdId ?? undefined);
      setLocalName(result.name);
      // Only adopt the returned registry if it is still the one on screen; a
      // switch during the round trip makes it the wrong household's answer.
      if (result.state && getActiveBudgetHouseholdId() === activeHouseholdId) {
        setControlPlane(result.state);
      } else {
        await refreshControlPlane();
      }
    } catch (error) {
      console.error('Rename failed', error);
      Alert.alert('Error', 'Could not rename this device.');
    }
  };

  /**
   * A revocation ends trust in ONE household — the same device can stay enrolled
   * in the member's others — so both the DELETE and the key rotation that
   * follows it name the household this list belongs to. Without that, revoking
   * from a list rendered for household B would rotate whichever household is
   * active at the moment the request resolves: every peer of an untouched
   * household locked out, and the revoked device still reading the one it was
   * removed from.
   */
  const handleRevoke = (deviceId: string) => {
    const householdId = activeHouseholdId;
    Alert.alert(
      'Revoke device?',
      'This device will lose access to this household. Household keys rotate on this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              // A revoke is a DELETE plus a key rotation plus a control-plane
              // refetch — seconds on a slow link, with nothing on screen to say
              // so. An untouched-looking button after a destructive confirm
              // reads as "the tap missed", and the response is to press it
              // again: five duplicate revokes across three devices were
              // observed that way before this existed.
              setRevokingDeviceId(deviceId);
              try {
                await revokeLocalFirstDevice(deviceId, householdId ?? undefined);
                await refreshControlPlane();
                Alert.alert('Revoked', 'Device revoked and keys rotated.');
              } catch (error) {
                console.error('Revoke failed', error);
                // The button is owner-only (see `isHouseholdOwner`), but the
                // role can change between render and tap — and a rule the
                // server enforces should be stated, never reported as a
                // generic failure the member is invited to retry.
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
                setRevokingDeviceId(null);
              }
            })();
          },
        },
      ],
    );
  };

  /**
   * Delete a revoked row from the record.
   *
   * Deliberately a separate act from revoking, and only offered on rows that are
   * already revoked: it grants nothing back and takes nothing away — the device
   * lost its access, and its keys, when it was revoked. What it costs is the
   * evidence, which is why the confirm says so plainly rather than borrowing the
   * revoke sheet's "will lose access" language, and why there is no rotation
   * here to make everyone else re-key over a tidy-up.
   *
   * Named household, like every other write on this screen: the row being
   * deleted belongs to the list currently on screen, not to whichever household
   * happens to be active when the DELETE resolves.
   */
  const handleForget = (deviceId: string, deviceName: string) => {
    const householdId = activeHouseholdId;
    // The list is only ever rendered from a household's own registry, so this
    // cannot fire without one — but the request path must never be built with a
    // blank id, which reaches the Worker as a different route entirely.
    if (!householdId) return;
    Alert.alert(
      'Remove from list?',
      `${deviceName} already lost access when it was revoked. Removing it only clears it from this list — the record of when it was revoked goes with it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setForgettingDeviceId(deviceId);
              try {
                const state = await forgetLocalFirstDevice(householdId, deviceId);
                // Repaint from the answer — but only if it is still this
                // screen's household, exactly as `handleRename` does.
                if (getActiveBudgetHouseholdId() === householdId) {
                  setControlPlane(state);
                } else {
                  await refreshControlPlane();
                }
              } catch (error) {
                console.error('Forget device failed', error);
                const status =
                  typeof error === 'object' && error !== null
                    ? (error as { response?: { status?: number } }).response?.status
                    : undefined;
                if (status === 409) {
                  // The row went back to active between render and tap — the
                  // device re-enrolled. Deleting it now would drop a live device
                  // out of the list the member uses to police access.
                  Alert.alert(
                    'Still has access',
                    'That device has access again. Revoke it first if you want it out.',
                  );
                  await refreshControlPlane();
                  return;
                }
                Alert.alert(
                  status === 403 ? 'Owner only' : 'Error',
                  status === 403
                    ? 'Only the household owner can remove someone else’s device.'
                    : 'Could not remove that device.',
                );
              } finally {
                setForgettingDeviceId(null);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID="budget-sync-screen">
        <ScreenHeader
          title="Device Sync"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.intro}>
            Your budget lives on this device. Everyone in the household keeps their own copy, and the
            copies update each other — encrypted, so nothing readable is ever stored on our servers.
          </Typography>

          {/* Above the button, because while it is showing it is the answer to
              the question the member came here with. */}
          <BudgetSyncProgressPanel />

          <GradientButton
            title={isSyncing ? 'Syncing…' : 'Sync now'}
            disabled={isSyncing}
            fullWidth
            onPress={handleSyncNow}
            testID="budget-settings-sync-now"
          />
          <Typography
            variant="caption2"
            color={colors.textSecondary}
            style={styles.hint}
            testID="budget-sync-status-line"
          >
            {statusLine}
          </Typography>

          {/* WHAT is on this device, next to WHEN it last synced.
              A timestamp reports an event and says nothing about content — a
              device missing half a year still says "synced 2 minutes ago", which
              is precisely how a failed backfill stayed invisible. This is the
              content half, and it is a push because the per-category breakdown
              behind it is what makes it verifiable rather than merely
              reassuring. */}
          {recordTotal !== null ? (
            <TouchableOpacity
              style={[styles.inventoryRow, { borderColor: colors.borderColor }]}
              onPress={() => navigation.navigate('BudgetSyncInventory')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${formatRecordCount(recordTotal)} records on this device. See the breakdown by category.`}
              testID="budget-sync-records-row"
            >
              <Icon name="layers-outline" forceIonicons size={IconSize.md} color={colors.primary} />
              <View style={styles.inventoryText}>
                <Typography variant="footnote" weight="semibold" testID="budget-sync-records-total">
                  {formatRecordCount(recordTotal)} records synced
                </Typography>
                <Typography variant="caption2" color={colors.textSecondary}>
                  Tap to check the breakdown against another member&apos;s phone
                </Typography>
              </View>
              <Icon
                name="chevron-forward"
                forceIonicons
                size={IconSize.md}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          ) : null}
          {syncNote ? (
            <Typography
              variant="caption1"
              color={syncNote.ok ? colors.textSecondary : colors.warning}
              style={styles.hint}
              testID="budget-settings-sync-note"
            >
              {syncNote.text}
            </Typography>
          ) : null}

          {/* The repair, for a device that is already missing history.
              "Sync now" cannot fix it: a device that joined before the backfill
              marker existed has a non-empty version vector, so every ordinary
              pass reports a healthy sync over a ledger that is missing every
              month before the join. This re-arms the backfill and runs it. It is
              safe to press at any time — installing the snapshot replaces the
              projection and then replays everything this device holds that is
              newer, so nothing written here is lost. */}
          {activeHouseholdId && !backfilling ? (
            <View style={styles.repairRow}>
              <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
                Missing older months, goals or income that other members can see?
              </Typography>
              <GradientButton
                title={repairing ? 'Downloading…' : 'Download full household history'}
                disabled={repairing || isSyncing}
                fullWidth
                onPress={handleDownloadHistory}
                testID="budget-sync-download-history"
              />
            </View>
          ) : null}

          {/* BR-044 — a merge discarded someone's edit. This lives here, not on
              the dashboard: it is a sync outcome, and it belongs beside the
              button that produced it and the device list that explains who the
              other edit came from. */}
          {conflicts > 0 ? (
            <View style={styles.conflictRow}>
              <Typography
                variant="caption1"
                color={colors.warning}
                style={styles.conflictText}
                testID="budget-sync-conflicts"
              >
                {conflicts === 1
                  ? 'An edit from your household was replaced by a newer change made on this device.'
                  : `${conflicts} edits from your household were replaced by newer changes made on this device.`}
              </Typography>
              <GradientButton
                title="Got it"
                variant="secondary"
                size="sm"
                onPress={handleAcknowledgeConflicts}
                testID="budget-sync-conflicts-ack"
              />
            </View>
          ) : null}

          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            TRUSTED DEVICES
          </Typography>
          {visibleDeviceRows.length ? (
            <Card style={styles.card} testID="budget-settings-devices">
              {visibleDeviceRows.map((device, index) => {
                const revoked = device.status === 'revoked';
                const { name, meta } = describeDevice({ ...device, localName });
                const ownerName = budgetMemberName(device.owner, '');
                return (
                  <View
                    key={device.deviceId}
                    style={[
                      styles.deviceRow,
                      index > 0 ? { borderTopColor: colors.borderColor, ...styles.divider } : null,
                    ]}
                    testID={`budget-sync-device-${device.deviceId}`}
                  >
                    {/* The person, not the hardware. The phone glyph was
                        identical on every row and said only "this is a device",
                        which the list already said. */}
                    <Avatar user={device.owner} size="sm" />
                    <View style={styles.deviceText}>
                      <Typography variant="footnote" weight="semibold" numberOfLines={1}>
                        {name}
                      </Typography>
                      <Typography
                        variant="caption2"
                        color={colors.textSecondary}
                        numberOfLines={1}
                        testID={`budget-sync-device-owner-${device.deviceId}`}
                      >
                        {ownerName ? `${ownerName} · ${meta}` : meta}
                      </Typography>
                    </View>
                    {device.isSelf ? (
                      <GradientButton
                        title="Rename"
                        variant="secondary"
                        size="sm"
                        onPress={() => setRenaming(true)}
                        testID="budget-sync-rename-device"
                      />
                    ) : revokingDeviceId === device.deviceId ||
                      forgettingDeviceId === device.deviceId ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.error}
                        testID={`budget-settings-revoking-${device.deviceId}`}
                      />
                    ) : revoked && (isHouseholdOwner || device.isMine) ? (
                      // Only reachable with the revoked rows unfolded, which is
                      // the right amount of friction for a delete: you have to
                      // have asked to see them first.
                      <GradientButton
                        title="Remove"
                        variant="secondary"
                        size="sm"
                        disabled={revokingDeviceId !== null || forgettingDeviceId !== null}
                        onPress={() => handleForget(device.deviceId, name)}
                        testID={`budget-sync-forget-${device.deviceId}`}
                      />
                    ) : !revoked && (isHouseholdOwner || device.isMine) ? (
                      <GradientButton
                        title="Revoke"
                        variant="secondary"
                        size="sm"
                        disabled={revokingDeviceId !== null || forgettingDeviceId !== null}
                        onPress={() => handleRevoke(device.deviceId)}
                        testID={`budget-settings-revoke-${device.deviceId}`}
                      />
                    ) : null}
                  </View>
                );
              })}
            </Card>
          ) : (
            <Card style={styles.card} testID="budget-sync-devices-empty">
              <Typography variant="footnote" color={colors.textSecondary}>
                Only this device holds the budget so far. Invite someone from Settings → Invite &
                household to add another.
              </Typography>
            </Card>
          )}
          {revokedRows.length ? (
            <GradientButton
              title={
                showRevoked
                  ? 'Hide revoked devices'
                  : `Show ${revokedRows.length} revoked device${revokedRows.length === 1 ? '' : 's'}`
              }
              variant="secondary"
              size="sm"
              onPress={() => setShowRevoked((v) => !v)}
              testID="budget-sync-toggle-revoked"
            />
          ) : null}
          {deviceRows.length > 1 && !isHouseholdOwner ? (
            <Typography
              variant="caption2"
              color={colors.textSecondary}
              style={styles.hint}
              testID="budget-sync-devices-owner-only"
            >
              You can revoke your own devices. Only the household owner can revoke someone
              else&apos;s.
            </Typography>
          ) : null}
          {visibleDeviceRows.length === 1 && visibleDeviceRows[0]?.isSelf ? (
            <Typography
              variant="caption2"
              color={colors.textSecondary}
              style={styles.hint}
              testID="budget-sync-devices-solo"
            >
              Only this device holds the budget so far. Invite someone from Settings → Invite &
              household to add another.
            </Typography>
          ) : null}

          {/* Households the account belongs to that this phone holds no ledger
              for — invisible everywhere else in Budget, and the only place an
              owner who replaced their phone can still administer one. */}
          <BudgetOtherHouseholdsCard />

          {/* Last on the screen, on purpose: irreversible local wipes. */}
          <BudgetDangerZoneCard onOpenBackup={() => navigation.navigate('BudgetBackup')} />
        </ScrollView>

        <BudgetDeviceNameSheet
          visible={renaming}
          value={localName}
          suggestion={suggestDeviceName()}
          onClose={() => setRenaming(false)}
          onSave={handleRename}
        />
      </SafeAreaView>
    </AppBackground>
  );
}

/**
 * Copy per failure code (V2 §3.4).
 *
 * Inherited from SyncStatusBanner, which was deleted with the rest of the
 * dashboard strip on 2026-08-16 — it was the only thing that read
 * `lastErrorCode`, and this screen was answering a permanent failure with "Up to
 * date. Nothing new from your household." because it branched on `phase ===
 * 'offline'` alone and the orchestrator resolves rather than rejects on failure.
 *
 * Two rules, both learned the hard way: never render `lastError` (a raw system
 * string), and never dress a permanent failure as a transient one. The
 * oversized-batch case is terminal — retrying cannot help, because the batch
 * only grows — so its sentence must not invite a retry.
 */
function syncFailureCopy(phase: SyncPhase, code: SyncErrorCode | null): string {
  if (phase === 'offline' || code === 'offline') {
    return 'You are offline. Your changes are saved here and will sync automatically.';
  }
  switch (code) {
    case 'payload_too_large':
      return 'This device has more changes waiting than we can send at once. Nothing is lost, but syncing will not restart on its own — please get in touch so we can clear the backlog.';
    case 'auth':
      return 'Your session expired. Sign in again to sync — everything you changed is safe on this device.';
    case 'key_epoch':
      return 'Your household key changed because someone was added or removed. Try again — this usually clears on the next sync.';
    case 'decrypt':
      return 'An update from another device could not be read, so it was skipped. Try again; if it keeps happening, that device may need to send it fresh.';
    case 'server':
      return 'We could not reach the sync service. Your changes are safe on this device and will go out when it is back.';
    default:
      return 'Could not reach your household right now. Your changes are safe on this device.';
  }
}

type DeviceRow = {
  deviceId: string;
  status: string;
  label: string | null;
  enrolledAt: string | null;
  /** This exact phone. */
  isSelf: boolean;
  /** Any device belonging to the signed-in member — `isSelf` plus their others. */
  isMine: boolean;
  /** Server-stamped liveness; null on records predating the field. */
  lastSeenAt: string | null;
  /** The person who holds it, in the shape `Avatar` reads. */
  owner: { display_name: string | null; avatar_url: string | null; email: string };
};

/** This device first, then the peers that still have access, revoked last. */
function rank(row: DeviceRow): number {
  if (row.isSelf) return 0;
  return row.status === 'revoked' ? 2 : 1;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance + 48 },
  intro: { marginBottom: Spacing.lg },
  hint: { marginTop: Spacing.sm },
  repairRow: { marginTop: Spacing.lg, gap: Spacing.sm },
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
  },
  inventoryText: { flex: 1, gap: Spacing.xxs },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  conflictText: { flex: 1 },
  groupLabel: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  card: { padding: Spacing.base, borderRadius: CornerRadius.lg },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.xs },
  deviceText: { flex: 1, gap: 2 },
});
