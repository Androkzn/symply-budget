/**
 * Shared shell, gate and notice primitives for the House V2 enrolment screens
 * (plan §5.1 — "House needs a real screen").
 *
 * Three screens sit on top of this: create an invite, join with one, and manage
 * the devices that came out of it. They all need the same four answers before
 * they can render anything useful, and getting any of them wrong shows the
 * member a dead button:
 *
 *   1. Is local-first even on for this build? (`isHouseLocalFirst`)
 *   2. Is a local session open on this device? (`isLocalHouseSessionOpen`)
 *   3. Which property is active, and what is it called?
 *   4. Is this device still waiting to be approved into that property?
 *
 * (3) and (4) are re-read on every ledger change rather than only on mount:
 * the enrolment gate flips inside a SYNC run — the household data key arrives
 * by mailbox after the owner approves — so nothing this screen does can be the
 * trigger. `subscribeToHouseLedgerChanges` is that trigger.
 *
 * Multi-property (plan §7): every accessor here reads the ACTIVE property.
 * A device can be fully enrolled in one property and still awaiting approval in
 * another, so screens must never present "awaiting" as a device-wide state.
 */
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  AppBackground,
  SafeAreaView,
  ScreenHeader,
  screenScrollViewStyle,
} from '@components/common';
import { Card, GradientButton, Typography } from '@components/ui';
import {
  getActiveHouseholdId,
  getLocalHouseLedger,
  isAwaitingHouseEnrolment,
  isLocalHouseSessionOpen,
  subscribeToHouseLedgerChanges,
} from '@features/house/local/engine';
import { HouseLocalNotReadyError } from '@features/house/local/errors';
import { isHouseLocalFirst } from '@features/house/local/flag';
import {
  toMemberFacingError,
  type MemberFacingError,
} from '@features/house/local/memberFacingError';
import { useHouseSyncStatusStore } from '@features/house/local/sync/syncStatusStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

export type EnrolmentGate = {
  /** The build ships the local-first client. */
  localFirstOn: boolean;
  /** A property is open on this device — every control-plane call needs one. */
  sessionOpen: boolean;
  /** Both of the above: safe to call the control plane. */
  ready: boolean;
  /** This device has claimed the ACTIVE property but has no key for it yet. */
  awaitingEnrolment: boolean;
  /**
   * That wait cannot end: no live device is left to approve it.
   *
   * Always false unless `awaitingEnrolment` — it qualifies the wait, it is not a
   * state of its own. See `canEnrolmentStillBeApproved` for why this needs the
   * device roster rather than anything the waiting device can see about itself.
   *
   * Distinct from the device-wide `recover-this-home` bootstrap state that
   * `HouseRecoverHomeScreen` renders: that one fires when this phone holds no
   * key for ANY home. A phone fully enrolled in one property and permanently
   * locked out of another satisfies neither that gate nor the plain "waiting"
   * copy, which is the gap this closes.
   */
  enrolmentUnreachable: boolean;
  householdId: string | null;
  householdName: string | null;
  /** This device's id, for "which one of these is me" on the devices screen. */
  deviceId: string | null;
  /** Bumps on every ledger change — a dependency for callers that re-fetch. */
  revision: number;
};

/**
 * The one place the enrolment screens learn where they stand.
 *
 * Deliberately not a store: everything here is derived from the engine, and a
 * second copy of it in Zustand is a second thing to keep in sync with a session
 * that opens, closes and swaps property under it.
 */
export function useEnrolmentGate(): EnrolmentGate {
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeToHouseLedgerChanges(() => setRevision((r) => r + 1)), []);
  // Subscribed, not read once. Like the enrolment flag itself this is decided
  // inside a SYNC run — the orchestrator sets it while asking the control plane
  // who is still alive — so no action on this screen is the trigger, and a
  // snapshot taken at mount would never update.
  const unreachable = useHouseSyncStatusStore((s) => s.enrolmentUnreachable);

  return useMemo<EnrolmentGate>(() => {
    const localFirstOn = isHouseLocalFirst();
    const sessionOpen = localFirstOn && isLocalHouseSessionOpen();
    if (!sessionOpen) {
      return {
        localFirstOn,
        sessionOpen: false,
        ready: false,
        awaitingEnrolment: false,
        enrolmentUnreachable: false,
        householdId: null,
        householdName: null,
        deviceId: null,
        revision,
      };
    }
    const ledger = getLocalHouseLedger();
    const awaitingEnrolment = isAwaitingHouseEnrolment(getActiveHouseholdId() ?? undefined);
    return {
      localFirstOn,
      sessionOpen: true,
      ready: true,
      awaitingEnrolment,
      // Qualifies the wait and never outlives it: the status store is written
      // per sync run and only for the ACTIVE property, so a stale `true` left
      // over from a home the member has since switched away from must not
      // present the home in front of them as beyond saving.
      enrolmentUnreachable: awaitingEnrolment && unreachable,
      householdId: ledger.household.id,
      householdName: String(ledger.household.name ?? ''),
      deviceId: ledger.deviceId,
      revision,
    };
  }, [revision, unreachable]);
}

/**
 * Member-facing copy for the two states in which an enrolment screen cannot do
 * its job. Returns null when the screen is good to go.
 *
 * The "not ready" branch reuses `toMemberFacingError` rather than writing its
 * own sentence, so a member sees the same words here as anywhere else the
 * session is still opening.
 */
export function gateNotice(
  gate: EnrolmentGate,
  options?: {
    /**
     * This screen works on a device that holds no home at all.
     *
     * True only for JOIN. Every other enrolment screen acts on a property — it
     * invites into one, or lists the devices enrolled in one — and has nothing
     * to say without a session. Joining is the opposite: since sign-up stopped
     * minting a home nobody asked for, an invitee's ordinary state is holding
     * none, and `openHouseDeviceForEnrolment` gives the claim the keypair it
     * needs without one. Telling that member "your home is still opening" would
     * be describing a home they do not have and blocking the screen that gets
     * them one.
     */
    worksWithoutAHome?: boolean;
  },
): MemberFacingError | null {
  if (!gate.localFirstOn) {
    return {
      title: 'Device sync is off',
      message:
        'This copy of Symply House keeps your home on our servers, so there are no devices to enrol. Sharing a home with someone needs device sync switched on first.',
      expected: true,
      needsAiProvider: false,
    };
  }
  if (!gate.sessionOpen && !options?.worksWithoutAHome) {
    return toMemberFacingError(
      new HouseLocalNotReadyError(),
      'Your home is still opening on this device. Give it a moment and try again — nothing is lost.',
    );
  }
  return null;
}

/**
 * The one honest thing to say when an enrolment can no longer be approved.
 *
 * Never phrased as waiting. The member has almost certainly been told to "wait
 * for approval" already — by this app, on this screen — and repeating it is how
 * a device sat on that message for 194 polls. What changed is that we now know
 * nobody is coming, and the only kind thing to do with that knowledge is say it
 * and name the two roads that still work.
 *
 * Deliberately does NOT offer to delete the home. The data is still there and
 * still encrypted; a member who restores the backup gets it back, and a member
 * who taps a destructive button in a moment of frustration does not.
 */
export function enrolmentUnreachableNotice(householdName?: string | null): MemberFacingError {
  const home = householdName?.trim() ? `“${householdName.trim()}”` : 'This home';
  return {
    title: 'No device left to let you in',
    message:
      `${home} is locked to devices that have stopped syncing, so the approval this ` +
      'device is waiting for cannot arrive. Waiting longer will not change that. If you ' +
      'still have one of those devices, open Symply House on it and approve this one. ' +
      'Otherwise restore the home from its backup using your recovery phrase — your data ' +
      'is safe, it just cannot be unlocked from here yet.',
    // Not `expected`: this is a dead end the member has to act on, and muting it
    // to match the ordinary "still opening" notice would bury the one message on
    // this screen that changes what they should do next.
    expected: false,
    // Nothing an AI provider key can help with — the missing thing is a
    // household key held by hardware, not a model.
    needsAiProvider: false,
  };
}

export type NoticeTone = 'ok' | 'warn' | 'error' | 'muted';

/** Resolve a tone to a theme token. No screen picks a colour by hand. */
export function useToneColor(tone: NoticeTone): string {
  const colors = useAppColors();
  switch (tone) {
    case 'ok':
      return colors.success;
    case 'warn':
      return colors.warning;
    case 'error':
      return colors.error;
    default:
      return colors.textSecondary;
  }
}

/** A titled block of member-facing copy — never a raw error string. */
export function NoticeCard({
  notice,
  tone,
  testID,
  action,
}: {
  notice: MemberFacingError;
  /** Defaults to the notice's own `expected` flag: expected reads muted. */
  tone?: NoticeTone;
  testID: string;
  action?: { label: string; onPress: () => void; testID: string };
}) {
  const resolved = tone ?? (notice.expected ? 'muted' : 'error');
  const color = useToneColor(resolved);
  return (
    <Card variant="filled" style={styles.notice} testID={testID}>
      <Typography variant="footnote" weight="semibold" color={color}>
        {notice.title}
      </Typography>
      <Typography variant="caption1" color={color} style={styles.noticeBody}>
        {notice.message}
      </Typography>
      {action ? (
        <View style={styles.noticeAction}>
          <GradientButton
            title={action.label}
            variant="secondary"
            size="sm"
            onPress={action.onPress}
            testID={action.testID}
          />
        </View>
      ) : null}
    </Card>
  );
}

/** One line of inline outcome text, sitting next to the control that caused it. */
export function StatusLine({
  text,
  tone,
  testID,
}: {
  text: string;
  tone: NoticeTone;
  testID: string;
}) {
  const color = useToneColor(tone);
  return (
    <Typography variant="caption1" color={color} style={styles.statusLine} testID={testID}>
      {text}
    </Typography>
  );
}

/**
 * A label + a value the member is expected to read out or hand over, with the
 * value on its own line so it stays legible at any width.
 */
export function ValueRow({
  label,
  value,
  testID,
  selectable = true,
}: {
  label: string;
  value: string;
  testID: string;
  selectable?: boolean;
}) {
  const colors = useAppColors();
  return (
    <View style={[styles.valueRow, { borderColor: colors.borderColor }]}>
      <Typography variant="caption2" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="footnote" selectable={selectable} testID={testID}>
        {value}
      </Typography>
    </View>
  );
}

/** Screen chrome shared by the three enrolment routes. */
export function EnrolmentShell({
  title,
  testID,
  children,
}: {
  title: string;
  testID: string;
  children: React.ReactNode;
}) {
  const navigation = useNavigation();
  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID={testID}>
        <ScreenHeader
          title={title}
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />
        <ScrollView
          {...keyboardDismissScrollProps}
          style={screenScrollViewStyle.scroll}
          contentContainerStyle={styles.content}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

/** "Expires in 23 hours" beats an ISO timestamp nobody can parse at a glance. */
export function describeExpiry(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Expires soon';
  const minutes = Math.round((at - now) / 60000);
  if (minutes <= 0) return 'This invite has expired';
  if (minutes < 60) return `Expires in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} days`;
}

export const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  notice: { marginBottom: Spacing.md },
  noticeBody: { marginTop: Spacing.xxs },
  noticeAction: { marginTop: Spacing.sm },
  statusLine: { marginTop: Spacing.sm },
  valueRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
});
