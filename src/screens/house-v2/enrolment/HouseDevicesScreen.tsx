/**
 * House V2 — the devices enrolled in this home, and how to remove one.
 *
 * **Per home, not per person.** `fetchControlPlaneState` is scoped to a
 * household id, and House members routinely hold several homes, so this surface
 * says out loud which one it is listing. Revoking here does nothing to that
 * device's access to a DIFFERENT home.
 *
 * **Revoke is the one genuinely irreversible control in the enrolment surface**,
 * and it does more than the word suggests: `revokeLocalFirstDevice` rotates the
 * home key to a new epoch, and every remaining device has to pick that new key
 * up before it can read anything written afterwards. Members are told that in
 * those words — not "keys rotate", which means nothing outside this file — and
 * the confirmation is an in-app panel so it is read before it is tapped (and so
 * an automated check can see it; iOS renders `Alert` in a window that XCUITest
 * snapshots of the app do not include).
 *
 * **Removing a revoked row is a different act** and is offered separately: it
 * grants nothing back and takes nothing away — the device lost its access, and
 * its keys, when it was revoked. What it costs is the evidence, which is why the
 * confirm says so plainly rather than borrowing the revoke panel's language.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar, Card, GradientButton, Typography } from '@components/ui';
import {
  fetchControlPlaneState,
  forgetLocalFirstDevice,
  renameLocalFirstDevice,
  revokeLocalFirstDevice,
  type ControlPlaneState,
} from '@features/house/local/controlPlaneClient';
import {
  describeDevice,
  getLocalDeviceName,
  suggestDeviceName,
} from '@features/house/local/deviceName';
import { houseMemberName } from '@features/house/local/householdRoster';
import {
  toMemberFacingError,
  type MemberFacingError,
} from '@features/house/local/memberFacingError';
import { useAuthStore } from '@stores/authStore';
import { Spacing, useAppColors } from '@theme';

import {
  EnrolmentShell,
  NoticeCard,
  StatusLine,
  gateNotice,
  useEnrolmentGate,
  type EnrolmentGate,
  type NoticeTone,
} from './enrolmentShared';
import { HouseDeviceNameSheet } from './HouseDeviceNameSheet';

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

export function HouseDevicesBody({ gate }: { gate: EnrolmentGate }) {
  const colors = useAppColors();
  const self = useAuthStore((s) => s.user);

  const [state, setState] = useState<ControlPlaneState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<MemberFacingError | null>(null);
  const [confirmDeviceId, setConfirmDeviceId] = useState<string | null>(null);
  const [confirmForgetDeviceId, setConfirmForgetDeviceId] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [localName, setLocalName] = useState('');
  const [renaming, setRenaming] = useState(false);
  /**
   * Revoked devices stay on record — the list is also an audit of who lost
   * access and when — but they are not what the member came to read, and after
   * clearing out a few stale enrolments they crowd out the devices that still
   * work. Folded away by default, one tap from view.
   */
  const [showRevoked, setShowRevoked] = useState(false);

  const householdId = gate.householdId;

  useEffect(() => {
    let alive = true;
    void getLocalDeviceName().then((name) => {
      if (alive) setLocalName(name);
    });
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!gate.ready || !householdId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const next = await fetchControlPlaneState(householdId);
      // Painting one home's registrations under another is cross-home bleed the
      // member can act on: a Revoke button aimed at a device in the wrong home's
      // registry.
      if (gate.householdId !== householdId) return;
      setState(next);
    } catch (error) {
      console.warn('[house.enrolment] control-plane state failed', error);
      setState(null);
      setLoadError(
        toMemberFacingError(
          error,
          'Could not list the devices in this home. That list lives on our servers, so it needs a connection — your home itself is fine offline.',
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, [gate.ready, gate.householdId, householdId]);

  useEffect(() => {
    // Blank BEFORE the new home's answer arrives, rather than leaving the
    // previous list up as a placeholder. A trusted-device list is a security
    // surface: rows that are stale for a few hundred milliseconds are rows the
    // member can revoke in the wrong home, and "no devices yet" is at worst
    // momentarily pessimistic.
    setState(null);
    setNote(null);
    void load();
  }, [load]);

  /**
   * One row per device, self first.
   *
   * The self row is synthesised when the control plane has not registered this
   * device yet — first launch, or a local erase that minted a new device id.
   * Without it the list shows only the OTHER copies, each under an opaque id,
   * and the phone in the member's hand is missing from its own device list.
   */
  const deviceRows = useMemo((): DeviceRow[] => {
    const rows: DeviceRow[] = (state?.devices ?? []).map((device) => ({
      deviceId: device.deviceId,
      status: device.status,
      label: device.label ?? null,
      enrolledAt: device.enrolledAt ?? null,
      isSelf: device.deviceId === gate.deviceId,
      isMine: Boolean(self?.id) && device.userId === self?.id,
      lastSeenAt: device.lastSeenAt ?? null,
      // Whose phone this is. A home of two people with two phones each showed
      // four rows of hardware and no way to tell which pair was whose.
      owner: {
        display_name: device.displayName ?? null,
        avatar_url: device.avatarUrl ?? null,
        email: device.email ?? '',
      },
    }));
    if (gate.deviceId && !rows.some((row) => row.isSelf)) {
      rows.push({
        deviceId: gate.deviceId,
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
  }, [state, gate.deviceId, localName, self]);

  const revokedRows = useMemo(
    () => deviceRows.filter((row) => row.status === 'revoked'),
    [deviceRows],
  );
  const visibleDeviceRows = useMemo(
    () => (showRevoked ? deviceRows : deviceRows.filter((row) => row.status !== 'revoked')),
    [deviceRows, showRevoked],
  );

  /**
   * Only the home OWNER may revoke a device — the coordinator enforces it — with
   * one exception the server also makes: anyone may revoke their OWN devices, so
   * a member who loses a phone can cut it off without waiting on the owner.
   *
   * Mirror the server's own predicate so the button is only ever shown to
   * someone it can work for. Offering it to everybody means a non-owner's tap
   * can only ever come back 403, which reads as a glitch rather than a rule — so
   * the natural response is to try again, and then on a different device.
   */
  const isHouseholdOwner = useMemo(() => {
    const members = state?.members ?? [];
    if (!self?.id) return false;
    return members.some(
      (member) => member.userId === self.id && member.status === 'active' && member.role === 'OWNER',
    );
  }, [state, self]);

  const handleRename = useCallback(
    async (name: string) => {
      try {
        const result = await renameLocalFirstDevice(name, householdId ?? undefined);
        setLocalName(result.name);
        // Only adopt the returned registry if it is still the one on screen; a
        // switch during the round trip makes it the wrong home's answer.
        if (result.state && gate.householdId === householdId) setState(result.state);
        else await load();
      } catch (error) {
        console.warn('[house.enrolment] device rename failed', error);
        setNote({
          tone: 'error',
          text: toMemberFacingError(error, 'Could not rename this device.').message,
        });
      }
    },
    [gate.householdId, householdId, load],
  );

  const handleRevoke = useCallback(
    (deviceId: string) => {
      setNote(null);
      setBusyDeviceId(deviceId);
      void (async () => {
        try {
          const next = await revokeLocalFirstDevice(deviceId, householdId ?? undefined);
          setState(next);
          setConfirmDeviceId(null);
          setNote({
            tone: 'ok',
            text: `Removed. This home is now on key ${next.keyEpoch} — every device that is still approved picks it up on its next sync.`,
          });
        } catch (error) {
          console.warn('[house.enrolment] revoke device failed', error);
          const status =
            typeof error === 'object' && error !== null
              ? (error as { response?: { status?: number } }).response?.status
              : undefined;
          setNote({
            tone: 'error',
            // A rule the server enforces should be stated, never reported as a
            // generic failure the member is invited to retry.
            text:
              status === 403
                ? 'Only an owner of this home can remove someone else’s device.'
                : toMemberFacingError(
                    error,
                    'Could not remove that device. Removing one needs a connection — try again when you have signal.',
                  ).message,
          });
        } finally {
          setBusyDeviceId(null);
        }
      })();
    },
    [householdId],
  );

  const handleForget = useCallback(
    (deviceId: string) => {
      // The list is only ever rendered from a home's own registry, so this
      // cannot fire without one — but the request path must never be built with
      // a blank id, which reaches the Worker as a different route entirely.
      if (!householdId) return;
      setNote(null);
      setBusyDeviceId(deviceId);
      void (async () => {
        try {
          const next = await forgetLocalFirstDevice(householdId, deviceId);
          setConfirmForgetDeviceId(null);
          if (gate.householdId === householdId) setState(next);
          else await load();
          setNote({ tone: 'ok', text: 'Removed from the list.' });
        } catch (error) {
          console.warn('[house.enrolment] forget device failed', error);
          const status =
            typeof error === 'object' && error !== null
              ? (error as { response?: { status?: number } }).response?.status
              : undefined;
          if (status === 409) {
            // The row went back to active between render and tap — the device
            // re-enrolled. Deleting it now would drop a live device out of the
            // list the member uses to police access.
            setNote({
              tone: 'warn',
              text: 'That device has access again. Revoke it first if you want it out.',
            });
            await load();
            return;
          }
          setNote({
            tone: 'error',
            text:
              status === 403
                ? 'Only an owner of this home can remove someone else’s device.'
                : toMemberFacingError(error, 'Could not remove that device.').message,
          });
        } finally {
          setBusyDeviceId(null);
        }
      })();
    },
    [gate.householdId, householdId, load],
  );

  const notice = gateNotice(gate);
  if (notice) {
    return <NoticeCard notice={notice} testID="lf-devices-gate-notice" />;
  }

  return (
    <View testID="lf-devices-panel">
      <Typography variant="caption1" color={colors.textSecondary} testID="lf-devices-property">
        {gate.householdName
          ? `Devices that can open ${gate.householdName}. Other homes you belong to have their own list.`
          : 'Devices that can open this home. Other homes you belong to have their own list.'}
      </Typography>

      <View style={styles.block}>
        <GradientButton
          title={isLoading ? 'Checking…' : 'Refresh'}
          variant="secondary"
          disabled={isLoading}
          onPress={() => void load()}
          testID="lf-devices-refresh"
        />
      </View>

      {loadError ? (
        <NoticeCard
          notice={loadError}
          testID="lf-devices-error"
          action={{ label: 'Try again', onPress: () => void load(), testID: 'lf-devices-retry' }}
        />
      ) : null}

      {state ? (
        <StatusLine
          text={`Key ${state.keyEpoch} · ${visibleDeviceRows.length} device${visibleDeviceRows.length === 1 ? '' : 's'}`}
          tone="muted"
          testID="lf-devices-summary"
        />
      ) : null}

      {!isLoading && !loadError && visibleDeviceRows.length === 0 ? (
        <StatusLine
          text="No other devices yet. Invite someone and their device appears here once you approve it."
          tone="muted"
          testID="lf-devices-empty"
        />
      ) : null}

      {visibleDeviceRows.map((device) => {
        const revoked = device.status === 'revoked';
        const { name, meta } = describeDevice({ ...device, localName });
        const ownerName = houseMemberName(device.owner, '');
        const busy = busyDeviceId === device.deviceId;
        return (
          <Card
            key={device.deviceId}
            variant="filled"
            style={styles.deviceRow}
            testID={`lf-devices-row-${device.deviceId}`}
          >
            <View style={styles.deviceHead}>
              {/* The person, not the hardware. A phone glyph is identical on
                  every row and says only "this is a device", which the list
                  already says. */}
              <Avatar user={device.owner} size="sm" />
              <View style={styles.deviceText}>
                <Typography
                  variant="footnote"
                  weight={device.isSelf ? 'semibold' : 'regular'}
                  numberOfLines={1}
                  testID={
                    device.isSelf ? 'lf-devices-this-device' : `lf-devices-name-${device.deviceId}`
                  }
                >
                  {name}
                </Typography>
                <Typography
                  variant="caption2"
                  color={revoked ? colors.error : colors.textSecondary}
                  numberOfLines={1}
                  testID={`lf-devices-meta-${device.deviceId}`}
                >
                  {ownerName ? `${ownerName} · ${meta}` : meta}
                </Typography>
              </View>
            </View>

            {device.isSelf ? (
              <View style={styles.blockTight}>
                <GradientButton
                  title="Rename"
                  variant="secondary"
                  size="sm"
                  onPress={() => setRenaming(true)}
                  testID="lf-devices-rename"
                />
              </View>
            ) : revoked && (isHouseholdOwner || device.isMine) ? (
              // Only reachable with the revoked rows unfolded, which is the right
              // amount of friction for a delete: you have to have asked to see
              // them first.
              <View style={styles.blockTight}>
                <GradientButton
                  title="Remove from list"
                  variant="secondary"
                  size="sm"
                  disabled={busyDeviceId !== null}
                  onPress={() => {
                    setNote(null);
                    setConfirmForgetDeviceId(device.deviceId);
                  }}
                  testID={`lf-devices-forget-${device.deviceId}`}
                />
              </View>
            ) : !revoked && (isHouseholdOwner || device.isMine) ? (
              <View style={styles.blockTight}>
                <GradientButton
                  title="Remove this device"
                  variant="secondary"
                  size="sm"
                  disabled={busyDeviceId !== null}
                  onPress={() => {
                    setNote(null);
                    setConfirmDeviceId(device.deviceId);
                  }}
                  testID={`lf-devices-revoke-${device.deviceId}`}
                />
              </View>
            ) : null}

            {confirmDeviceId === device.deviceId ? (
              <View style={styles.blockTight} testID="lf-devices-revoke-panel">
                <Typography variant="footnote" weight="semibold" color={colors.warning}>
                  Remove this device from {gate.householdName ?? 'this home'}?
                </Typography>
                <Typography variant="caption1" color={colors.warning} style={styles.confirmBody}>
                  It loses access straight away and cannot be let back in without a new invite.
                  Everything in this home is then locked with a new key, so every other device —
                  including this one — has to pick that key up before it can see anything written
                  from now on. That happens by itself the next time each of them syncs.
                </Typography>
                <View style={styles.blockTight}>
                  <GradientButton
                    title={busy ? 'Removing…' : 'Remove and lock them out'}
                    disabled={busy}
                    onPress={() => handleRevoke(device.deviceId)}
                    testID="lf-devices-revoke-confirm"
                  />
                </View>
                <View style={styles.blockTight}>
                  <GradientButton
                    title="Keep this device"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setConfirmDeviceId(null)}
                    testID="lf-devices-revoke-cancel"
                  />
                </View>
              </View>
            ) : null}

            {confirmForgetDeviceId === device.deviceId ? (
              <View style={styles.blockTight} testID="lf-devices-forget-panel">
                <Typography variant="footnote" weight="semibold">
                  Remove {name} from this list?
                </Typography>
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  style={styles.confirmBody}
                >
                  It already lost access when it was removed. Taking it off the list only clears the
                  row — the record of when it lost access goes with it. Nothing is re-keyed and
                  nobody has to sync.
                </Typography>
                <View style={styles.blockTight}>
                  <GradientButton
                    title={busy ? 'Removing…' : 'Remove from list'}
                    disabled={busy}
                    onPress={() => handleForget(device.deviceId)}
                    testID="lf-devices-forget-confirm"
                  />
                </View>
                <View style={styles.blockTight}>
                  <GradientButton
                    title="Keep the record"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setConfirmForgetDeviceId(null)}
                    testID="lf-devices-forget-cancel"
                  />
                </View>
              </View>
            ) : null}
          </Card>
        );
      })}

      {revokedRows.length ? (
        <View style={styles.block}>
          <GradientButton
            title={
              showRevoked
                ? 'Hide removed devices'
                : `Show ${revokedRows.length} removed device${revokedRows.length === 1 ? '' : 's'}`
            }
            variant="secondary"
            size="sm"
            onPress={() => setShowRevoked((v) => !v)}
            testID="lf-devices-toggle-revoked"
          />
        </View>
      ) : null}

      {deviceRows.length > 1 && !isHouseholdOwner ? (
        <StatusLine
          text="You can remove your own devices. Only an owner of this home can remove someone else’s."
          tone="muted"
          testID="lf-devices-owner-only"
        />
      ) : null}

      {note ? <StatusLine text={note.text} tone={note.tone} testID="lf-devices-status" /> : null}

      <HouseDeviceNameSheet
        visible={renaming}
        value={localName}
        suggestion={suggestDeviceName()}
        onClose={() => setRenaming(false)}
        onSave={handleRename}
      />
    </View>
  );
}

export default function HouseDevicesScreen() {
  const gate = useEnrolmentGate();
  return (
    <EnrolmentShell title="Devices" testID="lf-devices-screen">
      <HouseDevicesBody gate={gate} />
    </EnrolmentShell>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: Spacing.md },
  blockTight: { marginTop: Spacing.xs },
  deviceRow: { marginTop: Spacing.sm },
  deviceHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  deviceText: { flex: 1, gap: 2 },
  confirmBody: { marginTop: Spacing.xxs },
});
