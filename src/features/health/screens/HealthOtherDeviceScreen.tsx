/**
 * Symply Health — "Add your other device" (plan §6, He5).
 *
 * The whole personal-ledger enrolment handshake on one surface: mint a code on
 * the device that already has the record, claim it on the second one, approve
 * that claim by its out-of-band phrase, and watch the second device settle.
 *
 * ## Why this is a device screen and not a household screen
 *
 * A Health household is **one user with N devices** (plan §1.2). There is nobody
 * to invite, so there is no role picker, no member list and no "share this with
 * someone" copy anywhere below — `HEALTH_ENROLMENT_COPY` is the contract and
 * `td-40-no-invite-partner-copy.yaml` sweeps every screen for the negative. The
 * structure, the state machine and the error handling are House's
 * (`src/screens/house-v2/enrolment/`); the vocabulary is not, and that is the
 * only difference.
 *
 * ## Two states that are easy to conflate and must not be
 *
 * - **Approved** is the first device saying "yes, that is my other phone". It is
 *   an entry on the control plane and nothing more.
 * - **Enrolled** is the second device actually holding the household data key.
 *   It happens later, over the mailbox, on a sync run.
 *
 * So the second device keeps showing `pendingWrites` after approval, until the
 * key lands — writes really are paused until then
 * (`HealthLocalEnrolmentPendingError`). Collapsing the two would put a device
 * that cannot read a single op in front of a screen saying it is ready.
 *
 * ## Copy is rendered SENTENCE BY SENTENCE, deliberately
 *
 * `splitSentences` is not styling. Maestro matches an element's whole text, so
 * an assertion on `'Scan this code on your other device to keep both in sync.'`
 * can only ever pass against an element carrying exactly that sentence. Every
 * constant below stays byte-for-byte `HEALTH_ENROLMENT_COPY`; only where the
 * sentence breaks are is a screen decision.
 *
 * `pendingWrites` is the exception and is rendered WHOLE — `td-03` asserts both
 * of its sentences as one string, because "changes are paused" is not a
 * separable promise from "waiting for approval".
 *
 * ## Removing a device, and why the panel is LAST on the screen
 *
 * The roster + revoke block (the caller `sync/hdkRotation.ts` never had) is
 * deliberately rendered below the paste-a-link field rather than beside the
 * "this device is set up" card. Two reasons, one product and one mechanical:
 *
 *  - adding a device is what someone opens this screen to do; removing one is
 *    rare, destructive, and belongs after the thing it manages;
 *  - the two-device suite drives `health-other-device-create`,
 *    `health-other-device-code` and `health-other-device-approvals` by
 *    VISIBILITY on a phone-sized viewport. A roster inserted above any of them
 *    pushes it down the scroll view and turns a passing flow into a timeout that
 *    reads like a backend failure.
 *
 * Revoke is offered only in the settled state, never while this device is itself
 * awaiting the key: rotation mints a new household key and hands it to the
 * devices that remain, and a device that does not hold the current key can do
 * neither.
 */
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, GradientButton, TextInput, Typography } from '@components/ui';
import { useAuthStore } from '@stores/authStore';
import { formatEnrolmentSas } from '@symply/local-first';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthSettingsShell } from '../components/HealthSettingsShell';
import {
  approveHealthDeviceEnrolment,
  buildHealthEnrolmentLink,
  createHealthDeviceEnrolment,
  enrolThisDeviceInHealthHousehold,
  fetchHealthControlPlaneState,
  HEALTH_ENROLMENT_COPY,
  HEALTH_ENROLMENT_LINK_SCHEME,
  HealthEnrolmentWouldDiscardDataError,
  HealthSecondUserRefusedError,
  parseHealthEnrolmentInput,
  deriveHealthEnrolmentSas,
  listPendingHealthDeviceEnrolments,
  type PendingHealthDeviceEnrolment,
  type ControlPlaneHealthState,
  type CreatedHealthDeviceEnrolment,
} from '../local/controlPlaneClient';
import {
  getLocalHealthLedger,
  isAwaitingHealthEnrolment,
  isLocalHealthSessionOpen,
  subscribeToHealthLedgerChanges,
} from '../local/engine';
import { HealthLocalNotReadyError } from '../local/errors';
import { isHealthLocalFirst } from '../local/flag';
import { toUserFacingError, type UserFacingError } from '../local/memberFacingError';
import {
  revokeHealthLocalFirstDeviceAndRotateKey,
  type HealthKeyDelivery,
} from '../local/sync/hdkRotation';
import { depositHealthHdkForDevice } from '../local/sync/hdkTransfer';
import { runHealthLocalSync } from '../local/sync/orchestrator';

/**
 * How often the screen re-asks the control plane while it is open.
 *
 * Both waits it covers are for something that happens on the OTHER device — a
 * claim arriving, or the household key being deposited — so nothing this screen
 * does can be the trigger. Slow enough to be free, fast enough that neither
 * person is left staring at a stale panel.
 */
const POLL_MS = 6000;

/**
 * Split product copy into its sentences, keeping the terminating full stop.
 *
 * See the module header: this exists so each sentence is its own text element.
 * Deliberately dumb — it splits on ". " and nothing else, because every string
 * it is used on is a constant in this repo, not user input. No lookbehind: it
 * is ES2018 and Hermes has shipped without it.
 */
export function splitSentences(copy: string): string[] {
  const parts = copy.split('. ');
  return parts
    .map((part, index) => (index === parts.length - 1 ? part.trim() : `${part.trim()}.`))
    .filter(Boolean);
}

/** "Expires in 23 hours" beats an ISO timestamp nobody can parse at a glance. */
export function describeHealthEnrolmentExpiry(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Expires soon';
  const minutes = Math.round((at - now) / 60000);
  if (minutes <= 0) return 'This code has expired';
  if (minutes < 60) return `Expires in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `Expires in ${Math.round(hours / 24)} days`;
}

/** A route param is `string | string[] | undefined` — take the first usable one. */
function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

type ControlPlaneHealthDevice = ControlPlaneHealthState['devices'][number];

/**
 * A device id is opaque and 30+ characters. Nobody reads one; the tail is enough
 * to tell two phones apart, and "This device" is the only label that matters.
 *
 * Same shape as House's `describeDevice`, in the Health voice: there is one
 * person here, so a device is never somebody's.
 */
export function describeHealthDevice(deviceId: string, isSelf: boolean): string {
  if (isSelf) return 'This device';
  const tail = deviceId.length > 8 ? deviceId.slice(-6) : deviceId;
  return `Device ${tail}`;
}

/**
 * What to say after a revoke, given what the rotation actually managed to do.
 *
 * `revokeHealthLocalFirstDeviceAndRotateKey` resolves in two materially
 * different ways, and a flat "Done" would hide the second one:
 *
 *  - every device that stays took the new key (`undelivered` empty) — settled,
 *    nothing outstanding;
 *  - the revoke and the rotation both succeeded, but one or more envelopes did
 *    not go out. Those devices are queued in `HEALTH_PENDING_KEY_DELIVERY_META`
 *    and `redeliverHealthHouseholdKey()` re-sends on the next sync round.
 *
 * The second case is reported plainly and WITHOUT alarm: the removed device is
 * locked out either way — that half is not in doubt — and the device still owed
 * the key repairs itself. Overstating it would push someone into setting a
 * device up again, which on a personal ledger means clearing it first
 * (`enrolThisDeviceInHealthHousehold` refuses a device holding rows) — i.e. the
 * copy would cause the loss it was warning about.
 */
export function describeHealthRevokeResult(outcome: HealthKeyDelivery): string {
  const sentences = ['Removed.', 'That device can no longer read anything you log from now on.'];
  const waiting = outcome.undelivered.length;

  if (waiting === 0) {
    if (outcome.delivered.length === 1) {
      sentences.push('Your other device already has the new key.');
    } else if (outcome.delivered.length > 1) {
      sentences.push('Your other devices already have the new key.');
    }
    return sentences.join(' ');
  }

  sentences.push(
    waiting === 1
      ? 'One of your other devices has not picked the new key up yet.'
      : `${waiting} of your other devices have not picked the new key up yet.`,
  );
  sentences.push(
    waiting === 1
      ? 'It catches up on its own the next time it syncs, and nothing is lost in the meantime.'
      : 'They catch up on their own the next time they sync, and nothing is lost in the meantime.',
  );
  return sentences.join(' ');
}

/**
 * The confirmation, verbatim. Destructive, and from the removed device's side
 * not undoable — so it leads with the two things that actually happen to it,
 * before it says anything about keys.
 *
 * An in-app panel, never an `Alert`: iOS renders `UIAlertController` in its own
 * window, which an app-window snapshot does not include, so an alert here would
 * be invisible to the check that has to prove the confirmation was shown. The
 * claim confirmation on this same screen is built the same way, for the same
 * reason.
 */
const HEALTH_REVOKE_CONFIRM = {
  title: 'Remove this device?',
  body: 'It stops getting anything you log from now on, and it leaves sync straight away. Your health data is locked with a new key that it never receives, so nothing written from here on can be read there. What is already on that device stays on it, and it can only come back by being set up again from scratch.',
} as const;

type DeviceGate = {
  /** The build ships the local-first ledger at all. */
  localFirstOn: boolean;
  /** The encrypted ledger is open on this device. */
  sessionOpen: boolean;
  /** Both of the above — safe to call the control plane. */
  ready: boolean;
  /** Claimed, but the household key has not arrived yet. Writes are paused. */
  awaiting: boolean;
  householdId: string | null;
  deviceId: string | null;
  /** Which invalidation this snapshot was taken at — a dependency for re-fetches. */
  revision: number;
};

/**
 * Where this device stands, re-read on every ledger change.
 *
 * Not a store: everything here is derived from the engine, and a second copy in
 * Zustand is a second thing to keep in step with a session that opens, closes
 * and rebinds under it. `revision` is bumped by the ledger subscription AND by
 * the poll below, because enrolment completes inside a sync run — nothing the
 * user does on this screen is the trigger.
 */
function useHealthDeviceGate(revision: number): DeviceGate {
  return useMemo<DeviceGate>(() => {
    const localFirstOn = isHealthLocalFirst();
    const sessionOpen = localFirstOn && isLocalHealthSessionOpen();
    if (!sessionOpen) {
      return {
        localFirstOn,
        sessionOpen: false,
        ready: false,
        awaiting: false,
        householdId: null,
        deviceId: null,
        revision,
      };
    }
    const ledger = getLocalHealthLedger();
    return {
      localFirstOn,
      sessionOpen: true,
      ready: true,
      awaiting: isAwaitingHealthEnrolment(),
      householdId: ledger.household.id,
      deviceId: ledger.deviceId,
      revision,
    };
  }, [revision]);
}

/**
 * User-facing copy for the two states in which this screen cannot do its job.
 * Returns null when it is good to go.
 */
function gateNotice(gate: DeviceGate): UserFacingError | null {
  if (!gate.localFirstOn) {
    return {
      title: 'Device sync is off in this build',
      // No mechanics, no flag name: the person reading this cannot change it,
      // and what they need to know is that nothing of theirs is missing.
      message:
        'This copy of Symply Health keeps your entries in your account rather than on your devices, so there is nothing to pair here. Everything you log keeps working exactly as it does now.',
      expected: true,
    };
  }
  if (!gate.sessionOpen) {
    return toUserFacingError(
      new HealthLocalNotReadyError(),
      'Your health data is still unlocking on this device. Give it a moment and try again — nothing is lost.',
    );
  }
  return null;
}

/** A titled block of user-facing copy — never a raw error string. */
function Notice({
  notice,
  testID,
  tone,
}: {
  notice: UserFacingError;
  testID: string;
  /** Defaults to the notice's own `expected` flag: expected reads muted. */
  tone?: 'muted' | 'warn' | 'error';
}) {
  const colors = useAppColors();
  const resolved = tone ?? (notice.expected ? 'muted' : 'error');
  const color =
    resolved === 'warn' ? colors.warning : resolved === 'error' ? colors.error : colors.textSecondary;
  return (
    <Card variant="filled" style={styles.block} testID={testID}>
      <Typography variant="footnote" weight="semibold" color={color}>
        {notice.title}
      </Typography>
      {splitSentences(notice.message).map((sentence) => (
        <Typography key={sentence} variant="caption1" color={color}>
          {sentence}
        </Typography>
      ))}
    </Card>
  );
}

/**
 * A label + a value the user reads out or copies, with the value on its own line
 * so a long link stays legible at any width.
 */
function ValueRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  const colors = useAppColors();
  return (
    <View style={[styles.valueRow, { borderColor: colors.borderColor }]}>
      <Typography variant="caption2" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="footnote" selectable testID={testID}>
        {value}
      </Typography>
    </View>
  );
}

export function HealthOtherDeviceScreen() {
  const colors = useAppColors();
  const params = useLocalSearchParams<{ id?: string; code?: string; secret?: string }>();
  const userId = useAuthStore((state) => state.user?.id ?? null);

  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  const gate = useHealthDeviceGate(revision);

  // Minting side.
  const [created, setCreated] = useState<CreatedHealthDeviceEnrolment | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<UserFacingError | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  // Claiming side.
  const [linkDraft, setLinkDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState<UserFacingError | null>(null);

  // Approving side.
  const [pending, setPending] = useState<PendingHealthDeviceEnrolment[]>([]);
  // Digits derived for each pending enrolment, keyed by invite. A missing entry
  // means this device cannot derive them — see `deriveHealthEnrolmentSas`.
  const [pendingSas, setPendingSas] = useState<Record<string, string>>({});
  // THIS device's digits after it claims, derived from its own enrolment keys.
  // Read to the person holding the first device, who approves only on a match.
  const [claimSas, setClaimSas] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<UserFacingError | null>(null);
  const [approveNote, setApproveNote] = useState<string | null>(null);

  // Roster + revoke side.
  const [devices, setDevices] = useState<ControlPlaneHealthDevice[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [rosterError, setRosterError] = useState<UserFacingError | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<UserFacingError | null>(null);
  const [revokeOutcome, setRevokeOutcome] = useState<HealthKeyDelivery | null>(null);

  /**
   * A second Symply ACCOUNT was refused. Held as its own flag rather than as a
   * notice built from the error, because `HealthSecondUserRefusedError.message`
   * carries the phase identifier (`… (claim)`) and this screen never puts an
   * identifier in front of anyone. The copy is the constant, verbatim.
   */
  const [refused, setRefused] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The ledger is the trigger for everything this screen cannot cause itself:
  // the key landing, a peer's history arriving, the session rebinding.
  useEffect(() => subscribeToHealthLedgerChanges(bump), [bump]);

  /**
   * Seed the claim field from the link that opened the app.
   *
   * Rebuilt through `buildHealthEnrolmentLink` rather than echoed back, so what
   * the user sees is the same `simplehealth://` link the QR encodes — and so a
   * malformed param set produces no claim affordance at all.
   */
  useEffect(() => {
    const code = firstParam(params.code);
    const secret = firstParam(params.secret);
    if (!code || !secret) return;
    setLinkDraft(
      buildHealthEnrolmentLink({ inviteId: firstParam(params.id), shortCode: code, secret }),
    );
  }, [params.code, params.id, params.secret]);

  /**
   * One pass over the control plane, feeding both panels.
   *
   * Two requests rather than one, and no longer avoidable: the device roster
   * comes from coordinator state, while a pending enrolment now has to carry the
   * claiming device's public keys and label — a join only the control plane's
   * own tables can do. Issued together so the six-second poll still costs one
   * round trip of latency.
   */
  const loadControlPlane = useCallback(async () => {
    if (!isHealthLocalFirst() || !isLocalHealthSessionOpen()) return;
    try {
      const [state, pendingEnrolments] = await Promise.all([
        fetchHealthControlPlaneState(getLocalHealthLedger().household.id),
        listPendingHealthDeviceEnrolments(),
      ]);
      if (!mounted.current) return;
      setPending(pendingEnrolments);
      // Derived here so a row never renders asking for a comparison before the
      // number it is about is on screen.
      const derived = await Promise.all(
        pendingEnrolments.map(
          async (enrolment) =>
            [enrolment.inviteId, await deriveHealthEnrolmentSas(enrolment)] as const,
        ),
      );
      if (!mounted.current) return;
      setPendingSas(Object.fromEntries(derived.filter(([, sas]) => sas !== null)) as Record<string, string>);
      setDevices(state.devices ?? []);
      setRosterLoaded(true);
      setRosterError(null);
    } catch (error) {
      // The claim / approve panels stay silent about this on purpose: it runs on
      // a timer, and a screen that turns red every six seconds on a train is
      // worse than one that keeps the last answer. `rosterError` is rendered
      // only where silence would itself be misleading — see the panel below.
      console.warn('[health.enrolment] could not read the control plane', error);
      if (!mounted.current) return;
      // A second ACCOUNT on this ledger is a security answer, not a network
      // blip: `fetchHealthControlPlaneState` fails closed on it, and what the
      // person needs to see is the single-account copy, not "could not load".
      if (error instanceof HealthSecondUserRefusedError) {
        setRefused(true);
        return;
      }
      setRosterError(
        toUserFacingError(
          error,
          'Could not check which devices are set up. That list lives on our servers, so it needs a connection — everything on this device keeps working offline.',
        ),
      );
    }
  }, []);

  useEffect(() => {
    void loadControlPlane();
  }, [loadControlPlane, revision]);

  /**
   * While this screen is open, keep asking.
   *
   * The sync run is what collects the household key for a device that has been
   * approved, so a device sitting on `pendingWrites` converges without the user
   * having to background and foreground the app.
   */
  useEffect(() => {
    if (!gate.ready) return undefined;
    const timer = setInterval(() => {
      void loadControlPlane();
      if (isAwaitingHealthEnrolment()) void runHealthLocalSync();
      bump();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [bump, gate.ready, loadControlPlane]);

  const handleCreate = useCallback(() => {
    setCreateError(null);
    setCopyNote(null);
    setRefused(false);
    setIsCreating(true);
    void (async () => {
      try {
        const enrolment = await createHealthDeviceEnrolment();
        if (__DEV__) {
          // The two-device suite plays the human messenger: it scrapes this line
          // off the Metro log and opens the link on the other simulator, so the
          // path under test stays the real one. No verification digits here —
          // they do not exist until the other device claims, and the suite reads
          // them off each screen, which is what a human does.
          console.log(
            `[E2E-INVITE] code=${enrolment.shortCode} secret=${enrolment.secret}`,
          );
        }
        if (mounted.current) setCreated(enrolment);
      } catch (error) {
        console.warn('[health.enrolment] could not create a device code', error);
        if (!mounted.current) return;
        setCreated(null);
        if (error instanceof HealthSecondUserRefusedError) {
          setRefused(true);
        } else {
          setCreateError(
            toUserFacingError(
              error,
              'Could not make a code just now. This one step needs a connection — everything else keeps working offline.',
            ),
          );
        }
      } finally {
        if (mounted.current) setIsCreating(false);
      }
    })();
  }, []);

  const handleCopyLink = useCallback((link: string) => {
    void (async () => {
      try {
        await Clipboard.setStringAsync(link);
        setCopyNote('Link copied.');
      } catch {
        setCopyNote('Could not copy the link — read the code out instead.');
      }
    })();
  }, []);

  const parsed = useMemo(() => parseHealthEnrolmentInput(linkDraft), [linkDraft]);
  const claimable = Boolean(parsed.shortCode && parsed.secret);

  const handleClaim = useCallback(() => {
    if (!parsed.shortCode || !parsed.secret || !userId) return;
    const shortCode = parsed.shortCode;
    const secret = parsed.secret;
    setClaimError(null);
    setRefused(false);
    setIsClaiming(true);
    void (async () => {
      try {
        const enrolled = await enrolThisDeviceInHealthHousehold({ userId, shortCode, secret });
        if (mounted.current) {
          setConfirming(false);
          setLinkDraft('');
          setClaimSas(enrolled.sas);
        }
        if (__DEV__) {
          // Scraped by the two-device suite, which then asserts the first device
          // shows the same digits. Derived here from THIS device's own keys.
          console.log(`[E2E-JOIN-SAS] sas=${enrolled.sas}`);
        }
        // Nothing arrives until a sync runs, and the next scheduled one may be
        // minutes away. Kick one so the approved key is picked up as soon as it
        // is deposited.
        void runHealthLocalSync();
      } catch (error) {
        console.warn('[health.enrolment] could not set this device up', error);
        if (!mounted.current) return;
        setConfirming(false);
        if (error instanceof HealthSecondUserRefusedError) {
          setRefused(true);
        } else if (error instanceof HealthEnrolmentWouldDiscardDataError) {
          setClaimError({
            title: 'There is already health data on this device',
            // The client refuses rather than merging, so this is a dead end the
            // user can act on — not a failure to retry.
            message: error.message,
            expected: true,
          });
        } else {
          setClaimError(
            toUserFacingError(
              error,
              'Could not set this device up with that code. Check it has not expired, and that the whole link was pasted.',
            ),
          );
        }
      } finally {
        if (mounted.current) setIsClaiming(false);
        bump();
      }
    })();
  }, [bump, parsed.secret, parsed.shortCode, userId]);

  const handleApprove = useCallback(
    (enrolment: PendingHealthDeviceEnrolment) => {
      setApproveError(null);
      setApproveNote(null);
      setRefused(false);
      setApprovingId(enrolment.inviteId);
      void (async () => {
        try {
          const result = await approveHealthDeviceEnrolment({ request: enrolment });
          // Approval is a control-plane entry; the OTHER device still cannot
          // read an op until the household key reaches it. Depositing it here —
          // rather than inside `approveHealthDeviceEnrolment` — keeps the
          // control-plane client free of a `sync/` import it would have to make
          // dynamic to avoid the cycle (House does exactly that at
          // `house/local/controlPlaneClient.ts:375`). Best effort: a failed
          // deposit leaves the peer paused, which the next approve or sync from
          // this device repairs.
          try {
            await depositHealthHdkForDevice({
              // The VERIFIED key, not the response's — the digits the two
              // screens matched were derived from this one.
              recipientDeviceId: enrolment.claimedDeviceId ?? result.approved.deviceId,
              recipientAgreementPublicKeyHex: enrolment.claimedAgreementPublicKey ?? '',
            });
          } catch (error) {
            console.warn('[health.enrolment] key handover after approval failed', error);
          }
          if (!mounted.current) return;
          setPending((current) => current.filter((e) => e.inviteId !== enrolment.inviteId));
          setApproveNote(
            'Approved. Your other device picks up the key on its next sync — usually within a minute.',
          );
        } catch (error) {
          console.warn('[health.enrolment] could not approve the device', error);
          if (!mounted.current) return;
          if (error instanceof HealthSecondUserRefusedError) {
            setRefused(true);
          } else {
            setApproveError(
              toUserFacingError(
                error,
                'That phrase did not match the one on your other device. Check it and tap the phrase actually shown there.',
              ),
            );
          }
        } finally {
          if (mounted.current) setApprovingId(null);
        }
      })();
    },
    [],
  );

  const handleRefreshDevices = useCallback(() => {
    setIsRefreshing(true);
    void (async () => {
      await loadControlPlane();
      if (mounted.current) setIsRefreshing(false);
    })();
  }, [loadControlPlane]);

  /**
   * Remove one of this person's OTHER devices.
   *
   * `revokeHealthLocalFirstDeviceAndRotateKey`, never the bare
   * `revokeHealthLocalFirstDevice`: the plain DELETE removes the control-plane
   * row and nothing else, and a device that already holds the household data key
   * keeps reading everything written afterwards. The rotation is what makes the
   * word "remove" true.
   *
   * The DELETE returns the post-revoke state, so the roster is repainted from
   * that response rather than from the next poll — the row flips to "Removed"
   * immediately instead of up to six seconds later.
   */
  const handleRevoke = useCallback((deviceId: string) => {
    setRevokeError(null);
    setRevokeOutcome(null);
    setRevokingId(deviceId);
    void (async () => {
      try {
        const result = await revokeHealthLocalFirstDeviceAndRotateKey(deviceId);
        if (!mounted.current) return;
        setDevices(result.state?.devices ?? []);
        setRosterLoaded(true);
        setConfirmRevokeId(null);
        setRevokeOutcome({ delivered: result.delivered, undelivered: result.undelivered });
        // A queued envelope is retried by `redeliverHealthHouseholdKey()` on the
        // next sync round. No reason to make someone wait for the scheduled one
        // while the screen is open in front of them.
        if (result.undelivered.length > 0) void runHealthLocalSync();
      } catch (error) {
        console.warn('[health.enrolment] could not remove the device', error);
        if (!mounted.current) return;
        // The confirmation deliberately stays up: nothing was removed, so this
        // is a retry rather than a dead end.
        setRevokeError(
          toUserFacingError(
            error,
            'Could not remove that device. This one step needs a connection — everything else keeps working offline.',
          ),
        );
      } finally {
        if (mounted.current) setRevokingId(null);
      }
    })();
  }, []);

  const notice = gateNotice(gate);
  const bodySentences = splitSentences(HEALTH_ENROLMENT_COPY.body);
  const refusedSentences = splitSentences(HEALTH_ENROLMENT_COPY.refused);
  const otherDevices = devices.filter((device) => device.deviceId !== gate.deviceId);
  const revokeSettled = revokeOutcome !== null && revokeOutcome.undelivered.length === 0;

  return (
    <HealthSettingsShell title={HEALTH_ENROLMENT_COPY.title} testID="health-other-device-screen">
      {bodySentences.map((sentence) => (
        <Typography key={sentence} variant="footnote" color={colors.textSecondary}>
          {sentence}
        </Typography>
      ))}

      {notice ? <Notice notice={notice} testID="health-other-device-gate-notice" /> : null}

      {refused ? (
        <Card variant="filled" style={styles.block} testID="health-other-device-refused">
          {refusedSentences.map((sentence) => (
            <Typography key={sentence} variant="footnote" color={colors.error}>
              {sentence}
            </Typography>
          ))}
        </Card>
      ) : null}

      {/* Status first: on a phone the answer to "did it work" must not be below
          the fold, and both of these are read far more often than they are
          acted on. */}
      {gate.ready && gate.awaiting ? (
        <Card variant="filled" style={styles.block} testID="health-other-device-pending">
          {/* WHOLE, not split — see the module header. */}
          <Typography variant="footnote" color={colors.warning}>
            {HEALTH_ENROLMENT_COPY.pendingWrites}
          </Typography>
          {claimSas ? (
            <>
              <Typography variant="caption2" color={colors.textSecondary}>
                Check this number against the one on your other device before approving there.
              </Typography>
              <Typography
                variant="title2"
                weight="semibold"
                style={styles.sas}
                testID="health-other-device-claim-sas"
              >
                {formatEnrolmentSas(claimSas)}
              </Typography>
            </>
          ) : null}
        </Card>
      ) : null}

      {gate.ready && !gate.awaiting ? (
        <Card variant="filled" style={styles.block} testID="health-other-device-enrolled">
          <Typography variant="footnote" weight="semibold">
            This device is set up
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            Your entries are stored here and stay in step with your other devices.
          </Typography>
        </Card>
      ) : null}

      {gate.ready && claimable ? (
        <Card variant="filled" style={styles.block} testID="health-other-device-claim-panel">
          <Typography variant="footnote" weight="semibold">
            Code from your other device
          </Typography>
          <ValueRow
            label="Code"
            value={parsed.shortCode ?? ''}
            testID="health-other-device-claim-code"
          />
          <View style={styles.block}>
            <GradientButton
              title={isClaiming ? 'Setting up…' : 'Set this device up'}
              disabled={isClaiming || gate.awaiting}
              onPress={() => setConfirming(true)}
              testID="health-other-device-claim"
            />
          </View>

          {confirming ? (
            <View style={styles.block} testID="health-other-device-claim-confirm-panel">
              <Typography variant="footnote" weight="semibold" color={colors.warning}>
                This replaces what is on this device
              </Typography>
              <Typography variant="caption1" color={colors.warning}>
                Everything here is replaced by the record your other device already has. If anything
                has been logged on this one, Symply Health stops and says so rather than replacing
                it.
              </Typography>
              <View style={styles.block}>
                <GradientButton
                  title={isClaiming ? 'Setting up…' : 'Continue'}
                  disabled={isClaiming}
                  onPress={handleClaim}
                  testID="health-other-device-claim-confirm"
                />
              </View>
              <View style={styles.blockTight}>
                <GradientButton
                  title="Cancel"
                  variant="secondary"
                  disabled={isClaiming}
                  onPress={() => setConfirming(false)}
                  testID="health-other-device-claim-cancel"
                />
              </View>
            </View>
          ) : null}
        </Card>
      ) : null}

      {claimError ? <Notice notice={claimError} testID="health-other-device-claim-error" /> : null}

      {gate.ready && pending.length > 0 ? (
        <Card variant="filled" style={styles.block} testID="health-other-device-approvals">
          <Typography variant="footnote" weight="semibold">
            {HEALTH_ENROLMENT_COPY.approveTitle}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            {HEALTH_ENROLMENT_COPY.approveBody}
          </Typography>
          {pending.map((enrolment) => (
            <View
              key={enrolment.inviteId}
              style={styles.block}
              testID={`health-other-device-approval-${enrolment.inviteId}`}
            >
              <Typography variant="caption2" color={colors.textSecondary}>
                {`${enrolment.claimedDeviceLabel ?? 'Unnamed device'} · code ${enrolment.shortCode}`}
              </Typography>
              {pendingSas[enrolment.inviteId] ? (
                <>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Check this number is the one showing on your other device.
                  </Typography>
                  <Typography
                    variant="title2"
                    weight="semibold"
                    style={styles.oob}
                    testID={`health-other-device-sas-${enrolment.inviteId}`}
                  >
                    {formatEnrolmentSas(pendingSas[enrolment.inviteId]!)}
                  </Typography>
                  <View style={styles.blockTight}>
                    <GradientButton
                      title="The numbers match — approve"
                      disabled={approvingId !== null}
                      onPress={() => handleApprove(enrolment)}
                      testID="health-other-device-approve-request"
                    />
                  </View>
                </>
              ) : (
                <Typography
                  variant="caption1"
                  color={colors.warning}
                  testID={`health-other-device-sas-missing-${enrolment.inviteId}`}
                >
                  This device cannot check that request — it did not create the code, or the code
                  has expired. Create a new one and set the other device up again.
                </Typography>
              )}
            </View>
          ))}
        </Card>
      ) : null}

      {approveError ? (
        <Notice notice={approveError} testID="health-other-device-approve-error" />
      ) : null}
      {approveNote ? (
        <Typography
          variant="caption1"
          color={colors.success}
          testID="health-other-device-approve-note"
        >
          {approveNote}
        </Typography>
      ) : null}

      {gate.ready ? (
        <View style={styles.block}>
          <GradientButton
            title={isCreating ? 'Making a code…' : 'Show the code for my other device'}
            disabled={isCreating}
            onPress={handleCreate}
            testID="health-other-device-create"
          />
        </View>
      ) : null}

      {createError ? (
        <Notice notice={createError} testID="health-other-device-create-error" />
      ) : null}

      {created ? (
        <Card variant="filled" style={styles.block} testID="health-other-device-code">
          <Typography variant="footnote" weight="semibold">
            {HEALTH_ENROLMENT_COPY.scanCta}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            No camera to hand? Open this link on the other device instead.
          </Typography>
          <ValueRow
            label="Link"
            value={created.enrolmentLink}
            testID="health-other-device-code-link"
          />
          <ValueRow
            label="Code"
            value={created.shortCode}
            testID="health-other-device-code-short"
          />
          <ValueRow
            label="Expires"
            value={describeHealthEnrolmentExpiry(created.expiresAt)}
            testID="health-other-device-code-expiry"
          />
          <View style={styles.block}>
            <GradientButton
              title="Copy link"
              variant="secondary"
              size="sm"
              onPress={() => handleCopyLink(created.enrolmentLink)}
              testID="health-other-device-copy-link"
            />
          </View>
          {copyNote ? (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-other-device-copy-note"
            >
              {copyNote}
            </Typography>
          ) : null}
          {/* Nothing to remember any more: the check is derived from the keys
              the other device enrols with, so it cannot exist until that device
              has claimed. Which is exactly what makes it a check on the device
              rather than on whoever is holding this screen. */}
          <Typography variant="caption1" color={colors.textSecondary}>
            When your other device asks to be approved, both screens will show a six-digit number.
            Approve only if they are the same.
          </Typography>
        </Card>
      ) : null}

      {gate.ready ? (
        <View style={styles.block}>
          <TextInput
            label="Or paste the link from your other device"
            placeholder={`${HEALTH_ENROLMENT_LINK_SCHEME}://lf-invite?…`}
            value={linkDraft}
            onChangeText={setLinkDraft}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            testID="health-other-device-link-input"
          />
        </View>
      ) : null}

      {/* The roster, LAST — see the module header. Settled state only: a device
          still waiting for the key cannot mint a new one, so a revoke button
          there would be offering a call that must fail. */}
      {gate.ready && !gate.awaiting ? (
        <Card variant="filled" style={styles.block} testID="health-other-device-devices">
          <Typography variant="footnote" weight="semibold">
            Your devices
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            Everything you log is kept in step across these.
          </Typography>

          <View style={styles.block}>
            <GradientButton
              title={isRefreshing ? 'Checking…' : 'Check again'}
              variant="secondary"
              size="sm"
              disabled={isRefreshing}
              onPress={handleRefreshDevices}
              testID="health-other-device-devices-refresh"
            />
          </View>

          {/* Shown only when there is no list to fall back on. With devices on
              screen the last good answer beats a panel that turns red on a
              six-second timer; with nothing on screen, staying quiet would read
              as "you have no other devices", which is a worse lie than "could
              not check". */}
          {rosterError && devices.length === 0 ? (
            <Notice notice={rosterError} testID="health-other-device-devices-error" />
          ) : null}

          {rosterLoaded && !rosterError && otherDevices.length === 0 ? (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.blockTight}
              testID="health-other-device-devices-empty"
            >
              This is the only device set up so far.
            </Typography>
          ) : null}

          {devices.map((device) => {
            const isSelf = device.deviceId === gate.deviceId;
            const revoked = device.status === 'revoked';
            return (
              <View
                key={device.deviceId}
                style={styles.deviceRow}
                testID={`health-other-device-row-${device.deviceId}`}
              >
                <Typography
                  variant="footnote"
                  weight={isSelf ? 'semibold' : 'regular'}
                  numberOfLines={1}
                  testID={
                    isSelf
                      ? 'health-other-device-this-device'
                      : `health-other-device-name-${device.deviceId}`
                  }
                >
                  {describeHealthDevice(device.deviceId, isSelf)}
                </Typography>
                <Typography variant="caption2" color={revoked ? colors.error : colors.textSecondary}>
                  {revoked ? 'Removed — no longer in sync' : 'In sync'}
                </Typography>

                {/* Never for THIS device. Rotating away from the device doing
                    the rotating would mint a key only it holds and then try to
                    deposit it from an identity the relay has just stopped
                    trusting — `hdkRotation` declines to rotate in that case, and
                    signing this device out is local teardown, not a revoke. */}
                {!isSelf && !revoked ? (
                  <View style={styles.blockTight}>
                    <GradientButton
                      title="Remove this device"
                      variant="secondary"
                      size="sm"
                      disabled={revokingId !== null}
                      onPress={() => {
                        setRevokeError(null);
                        setRevokeOutcome(null);
                        setConfirmRevokeId(device.deviceId);
                      }}
                      testID={`health-other-device-revoke-${device.deviceId}`}
                    />
                  </View>
                ) : null}

                {confirmRevokeId === device.deviceId ? (
                  <View style={styles.blockTight} testID="health-other-device-revoke-panel">
                    <Typography variant="footnote" weight="semibold" color={colors.warning}>
                      {HEALTH_REVOKE_CONFIRM.title}
                    </Typography>
                    {splitSentences(HEALTH_REVOKE_CONFIRM.body).map((sentence) => (
                      <Typography key={sentence} variant="caption1" color={colors.warning}>
                        {sentence}
                      </Typography>
                    ))}
                    <View style={styles.blockTight}>
                      <GradientButton
                        title={
                          revokingId === device.deviceId ? 'Removing…' : 'Remove and lock it out'
                        }
                        disabled={revokingId !== null}
                        onPress={() => handleRevoke(device.deviceId)}
                        testID="health-other-device-revoke-confirm"
                      />
                    </View>
                    <View style={styles.blockTight}>
                      <GradientButton
                        title="Keep this device"
                        variant="secondary"
                        disabled={revokingId !== null}
                        onPress={() => setConfirmRevokeId(null)}
                        testID="health-other-device-revoke-cancel"
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}

          {revokeError ? (
            <Notice notice={revokeError} testID="health-other-device-revoke-error" tone="error" />
          ) : null}

          {/* Two outcomes, two elements. A revoke that rotated the key but could
              not hand it to every device that stays is NOT the settled state,
              and reporting both through one "Done" would hide the only part of
              this that is still outstanding. */}
          {revokeOutcome && revokeSettled ? (
            <View style={styles.block} testID="health-other-device-revoke-note">
              {splitSentences(describeHealthRevokeResult(revokeOutcome)).map((sentence) => (
                <Typography key={sentence} variant="caption1" color={colors.success}>
                  {sentence}
                </Typography>
              ))}
            </View>
          ) : null}

          {revokeOutcome && !revokeSettled ? (
            <View style={styles.block} testID="health-other-device-revoke-partial">
              {splitSentences(describeHealthRevokeResult(revokeOutcome)).map((sentence) => (
                <Typography key={sentence} variant="caption1" color={colors.textSecondary}>
                  {sentence}
                </Typography>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}
    </HealthSettingsShell>
  );
}

const styles = StyleSheet.create({
  // Read aloud between two devices, so it is set wide rather than as body copy.
  sas: { letterSpacing: 2, marginTop: Spacing.xxs },
  block: { marginTop: Spacing.md },
  blockTight: { marginTop: Spacing.xs },
  deviceRow: { marginTop: Spacing.md },
  oob: { marginTop: Spacing.sm },
  valueRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
});
