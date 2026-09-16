/**
 * House V2 → Invite & home → **Join**. The invitee's half.
 *
 * Scanning is the headline act and everything below it is the fallback. Two
 * fields, and usually neither is typed: scanning fills both, tapping the invite
 * link fills both (the hub hands them over as route params), and pasting the
 * whole link — or a "CODE secret" pair — into the code field splits it in place.
 *
 * The `lf-join-*` ids are a CONTRACT with the two-device suite's runner
 * (`scripts/e2e/run-house-multi-member-sync.sh`) — do not rename them without
 * changing it. `lf-join-link` is the field that accepts a whole pasted link,
 * which is what that suite types.
 */
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { GradientButton, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { HouseInviteQrScanner } from '@features/house/components/HouseInviteQrScanner';
import { HouseJoinWaitingPanel } from '@features/house/components/HouseJoinWaitingPanel';
import {
  joinLocalFirstHousehold,
  lookupLocalFirstInvite,
  parseInviteInput,
} from '@features/house/local/controlPlaneClient';
import { isLocalHouseSessionOpen, listLocalHouseProperties } from '@features/house/local/engine';
import { HouseInviteExpiringError, HouseLocalNotReadyError } from '@features/house/local/errors';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { parseHouseInviteLink } from '@features/house/local/inviteLinkStore';
import { runHouseLocalSync } from '@features/house/local/sync/orchestrator';
import { useHouseJoinWait } from '@features/house/local/useHouseJoinWait';
import type { SettingsStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';

import { NoticeCard, gateNotice, useEnrolmentGate, type EnrolmentGate } from './enrolmentShared';

/** The home an invite code opens, as the control plane describes it. */
type JoinTarget = {
  householdId: string;
  /** Display name from the control plane; null on an older Worker. */
  householdName: string | null;
};

/** Never an id. A name nobody chose is still better than `hh_local_9f3a…`. */
function householdLabel(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/**
 * What this device keeps, said in one line however many homes that is.
 *
 * Names the first — the active one, which is the home the member is standing in
 * and the only one they can picture — and COUNTS the rest. Listing five names in
 * a dialog that exists to be read in two seconds is how "nothing is removed"
 * stops being reassuring and starts being a wall of text.
 */
export function describeHeldProperties(names: readonly string[]): string | null {
  const [first, ...rest] = names;
  if (!first) return null;
  if (rest.length === 0) return first;
  return rest.length === 1 ? `${first} and 1 other` : `${first} and ${rest.length} others`;
}

/**
 * The last question before a join — which is a question, not a warning.
 *
 * It replaced a panel headed "This replaces what is on this device", which
 * opposed two homes, one arriving and one being destroyed. That was right while
 * the engine could hold exactly one property. `adoptJoinedHousehold` now adds a
 * session beside the ones already open and clears nothing, so the destructive
 * half would describe something that does not happen — the worst kind of
 * warning, because a member who believes it declines a join that costs them
 * nothing. What is left is the half that was always load-bearing: NAMING the
 * home this code lets them into.
 *
 * Still an in-app modal styled as an alert, deliberately, rather than
 * `Alert.alert`: iOS renders `UIAlertController` in its own window, which
 * XCUITest snapshots of the app window cannot see, so a native alert here would
 * be invisible to the two-device runs that guard this flow. And still a MODAL
 * rather than an inline panel — an inline version opens under the floating tab
 * bar, which has the higher z-order, so the confirm tap switches tab instead and
 * the join silently never runs.
 */
function JoinAddDialog({
  visible,
  target,
  keeping,
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  target: JoinTarget | null;
  /** What this device already holds and keeps; null before a session is open. */
  keeping: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const colors = useAppColors();
  const joining = householdLabel(target?.householdName, 'their home');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onCancel}
      testID="house-join-confirm-modal"
    >
      {/* Tapping the scrim cancels — the do-nothing answer, which is what an
          accidental tap outside a dialog should always be. */}
      <Pressable
        style={styles.scrim}
        onPress={busy ? undefined : onCancel}
        accessibilityLabel="Cancel joining"
        testID="house-join-confirm-scrim"
      >
        <Pressable
          style={[styles.dialog, { backgroundColor: colors.backgroundMain }]}
          onPress={() => {}}
          // This Pressable exists ONLY to swallow taps so they do not reach the
          // scrim and cancel. Giving it an `onPress` makes iOS treat it as an
          // accessibility element, and an accessibility element HIDES its own
          // descendants — so the dialog becomes one opaque blob: the buttons
          // unreachable by VoiceOver, and absent from the XCUITest tree.
          accessible={false}
          testID="lf-join-confirm-panel"
        >
          {/* Content-sized under the dialog's own `maxHeight`, never `flex: 1` —
              inside an auto-height modal that collapses the scroller to zero and
              the dialog renders empty. */}
          <ScrollView bounces={false} style={styles.dialogScroll} contentContainerStyle={styles.dialogBody}>
            <View style={styles.dialogHeader}>
              {/* Not an alert glyph: nothing here is destructive, and an alarm
                  icon over "nothing is removed" contradicts the sentence
                  underneath it. */}
              <Icon name="home-outline" forceIonicons size={IconSize.xl} color={colors.primary} />
              <Typography variant="title3" weight="semibold" style={styles.dialogCentered}>
                Join this home?
              </Typography>
            </View>

            <View style={[styles.dialogRow, { borderColor: colors.borderColor }]}>
              <Icon name="download-outline" forceIonicons size={IconSize.md} color={colors.success} />
              <View style={styles.dialogRowText}>
                <Typography variant="caption2" color={colors.textSecondary}>
                  You will join
                </Typography>
                <Typography variant="footnote" weight="semibold" testID="house-join-confirm-target">
                  {joining}
                </Typography>
              </View>
            </View>

            {/* The second row used to be the casualty list. It is now the
                reassurance, and only shown when there is something to reassure
                about: a device with no home yet has nothing to keep. */}
            {keeping ? (
              <View style={[styles.dialogRow, { borderColor: colors.borderColor }]}>
                <Icon
                  name="checkmark-circle-outline"
                  forceIonicons
                  size={IconSize.md}
                  color={colors.success}
                />
                <View style={styles.dialogRowText}>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    This device keeps
                  </Typography>
                  <Typography variant="footnote" weight="semibold" testID="house-join-confirm-keeping">
                    {keeping}
                  </Typography>
                </View>
              </View>
            ) : null}

            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.dialogExplain}
              testID="house-join-confirm-explain"
            >
              Nothing on this device is removed. {joining} is added alongside what is already here,
              and you can switch between them from Homes. Everything in {joining} appears once
              someone there approves this device.
            </Typography>

            <GradientButton
              title={busy ? 'Joining…' : 'Join this home'}
              disabled={busy}
              fullWidth
              onPress={onConfirm}
              testID="lf-join-confirm"
            />
            <GradientButton
              title="Cancel"
              variant="secondary"
              disabled={busy}
              fullWidth
              onPress={onCancel}
              testID="lf-join-cancel"
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function HouseJoinBody({
  gate,
  route,
  onJoined,
}: {
  gate: EnrolmentGate;
  /** Code + secret handed over by a tapped invite link. */
  route?: { code?: string; secret?: string };
  /**
   * Called once a claim has actually been sent, for the caller that needs to do
   * something afterwards. From Settings nobody does — the home is simply added
   * to a device that already has one. From onboarding this is the moment the
   * member stops being someone with no home, and the screen behind them still
   * says "Set Up Your Home".
   *
   * Deliberately NOT a navigation: the success panel puts a six-digit SAS on
   * screen that the member has to read back to whoever invited them, so leaving
   * here automatically would take away the one thing this screen exists to show.
   */
  onJoined?: () => void;
}) {
  const colors = useAppColors();

  const [scannerVisible, setScannerVisible] = useState(false);
  const [joinCodeDraft, setJoinCodeDraft] = useState('');
  const [joinSecretDraft, setJoinSecretDraft] = useState('');
  const [joinStatus, setJoinStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isResolvingInvite, setIsResolvingInvite] = useState(false);
  // The join, held until the person has been shown WHICH home they are about to
  // be let into. `target` is null only while the lookup runs.
  const [joinConfirm, setJoinConfirm] = useState<{
    code: string;
    secret: string;
    target: JoinTarget | null;
  } | null>(null);

  const wait = useHouseJoinWait();

  /**
   * What this device already holds — and keeps.
   *
   * Read from the engine on every render rather than held in state: joining adds
   * a property and activates it underneath this screen, so a set captured on
   * mount would be one short from the moment the join lands.
   * `listLocalHouseProperties` is synchronous and reads only cold-session
   * fields, which is what makes it safe on a render path.
   */
  const keepingSummary = describeHeldProperties(
    (isHouseLocalFirst() && isLocalHouseSessionOpen() ? listLocalHouseProperties() : [])
      .slice()
      .sort((a, b) => Number(b.isActive) - Number(a.isActive))
      .map((property) => householdLabel(property.name, 'this device’s home')),
  );

  /**
   * Ask the control plane whose home this code opens, then ask the person.
   *
   * The lookup happens BEFORE the confirmation and not after, because the
   * confirmation is worthless without its answer: a dialog that says "you will
   * join their home" names nothing, and naming is the entire job here.
   *
   * It also catches the two failures that would otherwise surface only after the
   * confirm tap — a code that does not exist, and one already spent — and
   * answers them where the code was typed.
   */
  const requestJoin = useCallback((code: string, secret: string) => {
    setJoinStatus(null);
    setIsResolvingInvite(true);
    // Opened immediately with `target: null` so the dialog is on screen while
    // the lookup runs: an app that goes quiet for a second after a scan reads as
    // an app that missed the scan.
    setJoinConfirm({ code, secret, target: null });
    void (async () => {
      try {
        const resolved = await lookupLocalFirstInvite(code);
        const usable = resolved.status === 'active' || resolved.status === 'claimed';
        // The CLOCK as well as the status. An invite the sweep has not retired
        // yet still reads `active`, and letting it through spends the member's
        // confirm tap on a claim the control plane is about to refuse — with a
        // message about the code rather than about the time.
        const ranOut = Date.parse(resolved.expiresAt) <= Date.now();
        if (!usable || ranOut) {
          setJoinConfirm(null);
          setJoinStatus({
            ok: false,
            text:
              resolved.status === 'revoked'
                ? 'That invite was cancelled by the person who sent it. Ask them for a new one.'
                : 'That invite has expired or has already been used. Ask them for a new one.',
          });
          return;
        }
        setJoinConfirm({
          code,
          secret,
          target: {
            householdId: resolved.householdId,
            householdName: resolved.householdName ?? null,
          },
        });
      } catch (error) {
        console.warn('[house-invite] invite lookup failed', error);
        // Not fatal: the join itself re-resolves the code, so an unreachable
        // lookup must not block someone standing in front of the person who
        // invited them. The dialog simply cannot name the home.
        setJoinConfirm({ code, secret, target: null });
      } finally {
        setIsResolvingInvite(false);
      }
    })();
  }, []);

  /**
   * A tapped invite link, handed over by the hub as route params.
   *
   * The link carries the code and the secret, so the only thing left for the
   * invitee to do is the one thing they must do knowingly: agree to the home the
   * link names. So the confirmation is opened for them, and nothing is claimed
   * until they tap it — a link forwarded into a group chat must not enrol
   * whoever tapped it first.
   *
   * Consumed once per set of params. The route object is stable across the
   * screen's life, so without the ref a re-render would reopen a dialog the
   * person had just dismissed.
   */
  const consumedParams = useRef<string | null>(null);
  const routeCode = route?.code;
  const routeSecret = route?.secret;
  useEffect(() => {
    if (!routeCode || !routeSecret) return;
    const key = `${routeCode}:${routeSecret}`;
    if (consumedParams.current === key) return;
    consumedParams.current = key;
    setJoinCodeDraft(routeCode);
    setJoinSecretDraft(routeSecret);
    requestJoin(routeCode, routeSecret);
  }, [routeCode, routeSecret, requestJoin]);

  /**
   * A QR read by THIS app's camera — the same payload the phone camera would
   * hand to the OS, minus the round trip through it.
   *
   * Parsed with the link reader first (that is what our own codes are), then
   * with the field parser, which also accepts a bare "CODE secret" pair. A code
   * that is neither is answered plainly instead of silently doing nothing:
   * "nothing happened" after pointing a camera at something is indistinguishable
   * from a camera that did not work.
   */
  const handleScannedCode = useCallback(
    (payload: string) => {
      setScannerVisible(false);
      const linked = parseHouseInviteLink(payload);
      const typed = parseInviteInput(payload);
      const code = linked?.code ?? typed.shortCode;
      const secret = linked?.secret ?? typed.secret;
      if (!code || !secret) {
        setJoinConfirm(null);
        setJoinStatus({
          ok: false,
          text: 'That QR code is not a Symply House invite. Ask them for the one under Invite & home → Invite → Generate QR code.',
        });
        return;
      }
      setJoinCodeDraft(code);
      setJoinSecretDraft(secret);
      // Straight to the confirmation, because scanning is an act of intent — but
      // never past it: a camera pointed at a phone showing several codes reads
      // whichever one it locked onto first, and the dialog is the only place the
      // home behind that code is ever named.
      requestJoin(code, secret);
    },
    [requestJoin],
  );

  const handleJoinCodeChange = useCallback((text: string) => {
    // A pasted link or "CODE secret" pair fills both fields — the invitee is
    // pasting what they were sent, not typing a code, and splitting it by hand
    // is exactly the transcription this flow exists to avoid.
    const parsed = parseInviteInput(text);
    if (parsed.shortCode && parsed.secret) {
      setJoinCodeDraft(parsed.shortCode);
      setJoinSecretDraft(parsed.secret);
      return;
    }
    setJoinCodeDraft(text);
  }, []);

  /**
   * Claim the invite, then wait to be let in.
   *
   * No activation call here, and that is not an oversight:
   * `joinLocalFirstHousehold` ends in `adoptJoinedHousehold`, which registers the
   * new session, flips the active property, writes both on-disk pointers and
   * emits a whole-ledger change. What the screen owes the member instead is the
   * SAS — which is why this function's only real job after the await is putting
   * six digits on screen.
   */
  const handleJoin = () => {
    const { code, secret } = joinConfirm ?? { code: '', secret: '' };
    void (async () => {
      setIsJoining(true);
      try {
        await joinLocalFirstHousehold({ shortCode: code, secret });
        setJoinCodeDraft('');
        setJoinSecretDraft('');
        setJoinConfirm(null);
        setJoinStatus({
          ok: true,
          text: 'Request sent. Read the number below to whoever invited you — this home is added to the ones on this device once they confirm it matches.',
        });
        // Re-read the claim we have just written, so the SAS actually appears.
        // The status above promises "the number below"; on a device that was
        // already awaiting keys before it claimed, nothing else re-reads the
        // record and that promise goes unkept.
        void wait.refresh();
        void runHouseLocalSync('after-join');
        onJoined?.();
      } catch (error) {
        console.error('Join home failed', error);
        setJoinConfirm(null);
        // Claiming needs an open local ledger, and when there isn't one the
        // failure has nothing to do with the invite. Reporting it as "check the
        // code and secret" sends the member off to re-read a perfectly good code.
        const notReady =
          error instanceof HouseLocalNotReadyError ||
          (error instanceof Error && error.name === 'HouseLocalNotReadyError');
        // Refused for being minutes from expiry: the code and the secret were
        // both RIGHT, and the generic "check the code" would send somebody to
        // re-read something that is not wrong. The control plane refuses these
        // because the owner cannot approve in the time left — the only useful
        // instruction is to ask for another invite.
        const expiring =
          error instanceof HouseInviteExpiringError ||
          (error instanceof Error && error.name === 'HouseInviteExpiringError');
        setJoinStatus({
          ok: false,
          text: notReady
            ? 'This device is still opening your home. Wait a moment and try again — if it keeps happening, sign out and back in.'
            : expiring
              ? 'That invite is about to run out, so it cannot be claimed. Ask them to send a new one.'
              : 'Could not join. Check the invite has not expired, that the code and secret are right, and that it was sent to this account.',
        });
      } finally {
        setIsJoining(false);
      }
    })();
  };

  // The one enrolment screen a device with no home may still use: joining is
  // how somebody who was invited gets their first one, and since sign-up mints
  // nothing that is the ordinary way to arrive here.
  const notice = gateNotice(gate, { worksWithoutAHome: true });
  if (notice) {
    return <NoticeCard notice={notice} testID="lf-join-gate-notice" />;
  }

  return (
    <View testID="lf-join-panel">
      {/* This device's own wait, above the form that started it. */}
      <HouseJoinWaitingPanel {...wait} />

      <Typography variant="caption1" color={colors.textSecondary} style={styles.intro}>
        Their home is ADDED to this device — nothing already here is removed, and you switch between
        them from Homes.
      </Typography>

      <GradientButton
        title="Scan QR code"
        fullWidth
        disabled={wait.awaiting}
        onPress={() => {
          setJoinStatus(null);
          setScannerVisible(true);
        }}
        testID="house-settings-scan-invite"
      />
      <Typography variant="caption2" color={colors.textSecondary} style={styles.scanHint}>
        Point your camera at the QR code on their phone. Or tap the invite link they sent — these
        fill in for you — otherwise paste or type the code and secret.
      </Typography>
      <TextInput
        label="Invite code"
        placeholder="5LSKVC"
        value={joinCodeDraft}
        onChangeText={handleJoinCodeChange}
        autoCapitalize="characters"
        autoCorrect={false}
        testID="lf-join-link"
      />
      <View style={styles.fieldGap} />
      <TextInput
        label="Secret"
        value={joinSecretDraft}
        onChangeText={setJoinSecretDraft}
        autoCapitalize="none"
        autoCorrect={false}
        testID="lf-join-secret"
      />
      <View style={styles.fieldGap} />
      <GradientButton
        title={wait.awaiting ? 'Waiting for approval…' : 'Join this home'}
        variant="secondary"
        disabled={isJoining || wait.awaiting}
        onPress={() => {
          // A link pasted straight into the code field still wins: it carries
          // both halves and cannot be transcribed wrong.
          const pasted = parseInviteInput(joinCodeDraft);
          const code = pasted.shortCode ?? joinCodeDraft.trim();
          const secret = pasted.secret ?? joinSecretDraft.trim();
          if (!code || !secret) {
            setJoinConfirm(null);
            setJoinStatus({
              ok: false,
              text: 'Enter the code and the secret from the invite you were sent.',
            });
            return;
          }
          requestJoin(code, secret);
        }}
        testID="lf-join-submit"
      />
      {joinStatus ? (
        <View style={styles.statusPanel}>
          <Typography
            variant="caption1"
            color={joinStatus.ok ? colors.success : colors.error}
            testID="lf-join-status"
          >
            {joinStatus.text}
          </Typography>
        </View>
      ) : null}

      <HouseInviteQrScanner
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScanned={handleScannedCode}
      />
      {/* Asked, not warned about. Joining ADDS a home, so the dialog's job is to
          name the one arriving — not the one that used to be destroyed getting
          there. */}
      <JoinAddDialog
        visible={joinConfirm !== null}
        target={joinConfirm?.target ?? null}
        keeping={keepingSummary}
        busy={isJoining || isResolvingInvite}
        onConfirm={handleJoin}
        onCancel={() => setJoinConfirm(null)}
      />
    </View>
  );
}

export function HouseJoinScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<SettingsStackParamList, 'HouseJoin'>>();
  const gate = useEnrolmentGate();
  const wait = useHouseJoinWait();

  /**
   * Pull to re-ask what happened to this device's claim.
   *
   * This is the screen somebody is looking at while they wait, and the one they
   * reach for when the wait feels stuck. Keeping the gesture is what lets a
   * person confirm for themselves that it is not, rather than take it on faith.
   */
  /**
   * Reached from onboarding rather than from the settings hub.
   *
   * The difference is what happens after a successful claim. From Settings the
   * member already has a home and the screen just goes back to the hub. From
   * onboarding there IS no hub — the stack behind this screen is "Set Up Your
   * Home" — so unless onboarding is finished the member is returned to a form
   * asking them to create the home they have just joined.
   */
  const fromOnboarding = route.params?.fromOnboarding === true;
  const completeOnboarding = useAuthStore(s => s.completeOnboarding);
  const [joined, setJoined] = useState(false);

  const [pulling, setPulling] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await wait.refresh();
    } finally {
      setPulling(false);
    }
  }, [wait]);

  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID="lf-join-screen">
        <ScreenHeader
          title="Join Household"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={onPullRefresh}
              tintColor={colors.textSecondary}
            />
          }
        >
          <HouseJoinBody
            gate={gate}
            route={{ code: route.params?.code, secret: route.params?.secret }}
            onJoined={fromOnboarding ? () => setJoined(true) : undefined}
          />
          {/*
            Shown only once the claim is actually in, and only from onboarding.
            Finishing automatically would be worse than it sounds: the panel
            above now holds the six-digit number the member has to read back to
            whoever invited them, and completing onboarding swaps this whole
            stack out from under it. So the exit is theirs to take, once they
            have read it.
          */}
          {fromOnboarding && joined ? (
            <GradientButton
              title="Continue"
              variant="teal"
              size="lg"
              fullWidth
              onPress={completeOnboarding}
              testID="lf-join-onboarding-continue"
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

export default HouseJoinScreen;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance + 48 },
  intro: { marginBottom: Spacing.lg },
  scanHint: { marginTop: Spacing.sm, marginBottom: Spacing.base },
  fieldGap: { height: Spacing.base },
  statusPanel: { marginTop: Spacing.base },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.base,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    borderRadius: CornerRadius.xl,
    overflow: 'hidden',
  },
  dialogScroll: { flexGrow: 0 },
  dialogBody: { padding: Spacing.lg, gap: Spacing.base },
  dialogHeader: { alignItems: 'center', gap: Spacing.sm },
  dialogCentered: { textAlign: 'center' },
  dialogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.base,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.lg,
  },
  dialogRowText: { flex: 1, gap: 2 },
  dialogExplain: { textAlign: 'center' },
});
