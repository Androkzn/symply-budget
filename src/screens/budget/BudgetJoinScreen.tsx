import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { GradientButton, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { BudgetInviteQrScanner } from '@features/budget/components/BudgetInviteQrScanner';
import { BudgetJoinWaitingPanel } from '@features/budget/components/BudgetJoinWaitingPanel';
import { BudgetSyncProgressPanel } from '@features/budget/components/BudgetSyncProgressPanel';
import {
  joinLocalFirstHousehold,
  lookupLocalFirstInvite,
  parseInviteInput,
} from '@features/budget/local/controlPlaneClient';
import { isLocalBudgetSessionOpen, listLocalBudgetHouseholds } from '@features/budget/local/engine';
import {
  BudgetInviteExpiringError,
  BudgetLocalNotReadyError,
} from '@features/budget/local/errors';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { parseBudgetInviteLink } from '@features/budget/local/inviteLinkStore';
import { runBudgetLocalSync } from '@features/budget/local/sync/orchestrator';
import { useBudgetJoinWait } from '@features/budget/local/useBudgetJoinWait';
import type { BudgetStackParamList } from '@navigation/types';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

/** The household an invite code opens, as the control plane describes it. */
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
 * What this device keeps, said in one line however many households that is.
 *
 * Names the first — the active one, which is the household the member is
 * standing in and the only one they can picture — and COUNTS the rest. Listing
 * five names in a dialog that exists to be read in two seconds is how "nothing
 * is removed" stops being reassuring and starts being a wall of text.
 */
export function describeHeldHouseholds(names: readonly string[]): string | null {
  const [first, ...rest] = names;
  if (!first) return null;
  if (rest.length === 0) return first;
  return rest.length === 1 ? `${first} and 1 other` : `${first} and ${rest.length} others`;
}

/**
 * The last question before a join — which is a question, not a warning.
 *
 * It replaced a dialog headed "Replace this budget?" that opposed two named
 * households, one arriving and one being destroyed. That was right while the
 * engine could hold exactly one household. BR-016 removed the trade:
 * `adoptJoinedHousehold` adds a session beside the ones already open and clears
 * nothing, so the destructive half would now describe something that does not
 * happen — the worst kind of warning, because a member who believes it declines
 * a join that costs them nothing. What is left is the half that was always
 * load-bearing: NAMING the household this code lets them into.
 *
 * Still an in-app modal styled as an alert, deliberately, rather than
 * `Alert.alert`: iOS renders `UIAlertController` in its own window, which
 * XCUITest snapshots of the app window cannot see, so a native alert here would
 * be invisible to the two-device runs that guard this flow. And still a MODAL
 * rather than an inline panel — the inline version opened under the floating tab
 * bar, which has the higher z-order, so the confirm tap switched tab instead and
 * the join silently never ran.
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
  const joining = householdLabel(target?.householdName, 'their household');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onCancel}
      testID="budget-join-confirm-modal"
    >
      {/* Tapping the scrim cancels — the do-nothing answer, which is what an
          accidental tap outside a dialog should always be. */}
      <Pressable
        style={styles.scrim}
        onPress={busy ? undefined : onCancel}
        accessibilityLabel="Cancel joining"
        testID="budget-join-confirm-scrim"
      >
        <Pressable
          style={[styles.dialog, { backgroundColor: colors.backgroundMain }]}
          onPress={() => {}}
          // This Pressable exists ONLY to swallow taps so they do not reach the
          // scrim and cancel. Giving it an `onPress` makes iOS treat it as an
          // accessibility element, and an accessibility element HIDES its own
          // descendants — so the dialog became one opaque blob: "Join this
          // household" and "Cancel" were unreachable by VoiceOver, and absent
          // from the XCUITest tree entirely (the enrolment suite could see this
          // panel and then fail to find either button inside it).
          accessible={false}
          testID="budget-settings-join-confirm-panel"
        >
          {/* Content-sized under the dialog's own `maxHeight`, never `flex: 1`
              — inside an auto-height modal that collapses the scroller to zero
              and the dialog renders empty. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            bounces={false}
            style={styles.dialogScroll}
            contentContainerStyle={styles.dialogBody}
          >
            <View style={styles.dialogHeader}>
              {/* Not the orange alert glyph this dialog used to open with:
                  nothing here is destructive, and an alarm icon over "nothing is
                  removed" contradicts the sentence underneath it. */}
              <Icon name="people-outline" forceIonicons size={IconSize.xl} color={colors.primary} />
              <Typography variant="title3" weight="semibold" style={styles.dialogCentered}>
                Join this household?
              </Typography>
            </View>

            <View style={[styles.dialogRow, { borderColor: colors.borderColor }]}>
              <Icon name="download-outline" forceIonicons size={IconSize.md} color={colors.success} />
              <View style={styles.dialogRowText}>
                <Typography variant="caption2" color={colors.textSecondary}>
                  You will join
                </Typography>
                <Typography variant="footnote" weight="semibold" testID="budget-join-confirm-target">
                  {joining}
                </Typography>
              </View>
            </View>

            {/* The second row used to be the casualty list. It is now the
                reassurance, and only shown when there is something to reassure
                about: a device with no household yet has nothing to keep. */}
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
                  <Typography
                    variant="footnote"
                    weight="semibold"
                    testID="budget-join-confirm-keeping"
                  >
                    {keeping}
                  </Typography>
                </View>
              </View>
            ) : null}

            <Typography
              variant="caption1"
              color={colors.textSecondary}
              style={styles.dialogExplain}
              testID="budget-join-confirm-explain"
            >
              Nothing on this device is removed. {joining} is added alongside what is already here,
              and you can switch between them from Households. Their shared budget appears once
              someone in {joining} approves this device.
            </Typography>

            <GradientButton
              title={busy ? 'Joining…' : 'Join this household'}
              disabled={busy}
              fullWidth
              onPress={onConfirm}
              testID="budget-settings-join-confirm"
            />
            <GradientButton
              title="Cancel"
              variant="secondary"
              disabled={busy}
              fullWidth
              onPress={onCancel}
              testID="budget-settings-join-cancel"
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Budget → Invite & Household → **Join**. The invitee's half, on its own screen.
 *
 * Scanning is the headline act and everything below it is the fallback. Two
 * fields, and usually neither is typed: scanning fills both, tapping the invite
 * link fills both (the hub hands them over as route params), and pasting the
 * whole link — or a "CODE secret" pair — into the code field splits it in
 * place. The third field this used to have ("paste the invite link") asked the
 * invitee to know which half of the message was the link, which is a question
 * about our data format, not about their household.
 */
export function BudgetJoinScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<BudgetStackParamList, 'BudgetJoin'>>();

  const [scannerVisible, setScannerVisible] = useState(false);
  const [joinCodeDraft, setJoinCodeDraft] = useState('');
  const [joinSecretDraft, setJoinSecretDraft] = useState('');
  const [joinStatus, setJoinStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isResolvingInvite, setIsResolvingInvite] = useState(false);
  // The join, held until the person has been shown WHICH household they are
  // about to be let into. `target` is null only while the lookup runs.
  const [joinConfirm, setJoinConfirm] = useState<{
    code: string;
    secret: string;
    target: JoinTarget | null;
  } | null>(null);

  const wait = useBudgetJoinWait();

  /**
   * Pull to re-ask what happened to this device's claim.
   *
   * This is the screen somebody is looking at while they wait, and the one they
   * reach for when the wait feels stuck — which, until the socket and the timer
   * behind this landed, it genuinely could be, permanently. Keeping the gesture
   * is what lets a person confirm that for themselves rather than take it on
   * faith.
   */
  const [pulling, setPulling] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await wait.refresh();
    } finally {
      setPulling(false);
    }
  }, [wait]);

  /**
   * What this device already holds — and, since BR-016, keeps.
   *
   * Read from the engine on every render rather than held in state: joining
   * adds a household and activates it underneath this screen, so a set captured
   * on mount would be one short from the moment the join lands.
   * `listLocalBudgetHouseholds` is synchronous and reads only cold-session
   * fields, which is what makes it safe on a render path.
   */
  const keepingSummary = describeHeldHouseholds(
    (isBudgetLocalFirst() && isLocalBudgetSessionOpen() ? listLocalBudgetHouseholds() : [])
      .slice()
      .sort((a, b) => Number(b.isActive) - Number(a.isActive))
      .map((household) => householdLabel(household.name, 'this device’s budget')),
  );

  /**
   * Ask the control plane whose household this code opens, then ask the person.
   *
   * The lookup happens BEFORE the confirmation and not after, because the
   * confirmation is worthless without its answer: a dialog that says "you will
   * join their household" names nothing, and naming is the entire job here.
   *
   * It also catches the two failures that would otherwise surface only after
   * the confirm tap — a code that does not exist, and one already spent — and
   * answers them where the code was typed.
   */
  const requestJoin = useCallback((code: string, secret: string) => {
    setJoinStatus(null);
    setIsResolvingInvite(true);
    // Opened immediately with `target: null` so the dialog is on screen while
    // the lookup runs: an app that goes quiet for a second after a scan reads
    // as an app that missed the scan.
    setJoinConfirm({ code, secret, target: null });
    void (async () => {
      try {
        const resolved = await lookupLocalFirstInvite(code);
        if (resolved.status !== 'active' && resolved.status !== 'claimed') {
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
        console.warn('[budget-invite] invite lookup failed', error);
        // Not fatal: the join itself re-resolves the code, so an unreachable
        // lookup must not block someone standing in front of the person who
        // invited them. The dialog simply cannot name the household.
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
   * invitee to do is the one thing they must do knowingly: agree to the
   * household the link names. So the confirmation is opened for them, and
   * nothing is claimed until they tap it — a link forwarded into a group chat
   * must not enrol whoever tapped it first.
   *
   * Consumed once per set of params. The route object is stable across the
   * screen's life, so without the ref a re-render would reopen a dialog the
   * person had just dismissed.
   */
  const consumedParams = useRef<string | null>(null);
  useEffect(() => {
    const code = route.params?.code;
    const secret = route.params?.secret;
    if (!code || !secret) return;
    const key = `${code}:${secret}`;
    if (consumedParams.current === key) return;
    consumedParams.current = key;
    setJoinCodeDraft(code);
    setJoinSecretDraft(secret);
    requestJoin(code, secret);
  }, [route.params?.code, route.params?.secret, requestJoin]);

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
      const linked = parseBudgetInviteLink(payload);
      const typed = parseInviteInput(payload);
      const code = linked?.code ?? typed.shortCode;
      const secret = linked?.secret ?? typed.secret;
      if (!code || !secret) {
        setJoinConfirm(null);
        setJoinStatus({
          ok: false,
          text: 'That QR code is not a Symply Budget invite. Ask them for the one under Invite & Household → Invite → Generate QR code.',
        });
        return;
      }
      setJoinCodeDraft(code);
      setJoinSecretDraft(secret);
      // Straight to the confirmation, because scanning is an act of intent — but
      // never past it: a camera pointed at a phone showing several codes reads
      // whichever one it locked onto first, and the dialog is the only place the
      // household behind that code is ever named.
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
   * No `activateLocalBudgetHousehold` call here, and that is not an oversight:
   * `joinLocalFirstHousehold` ends in `adoptJoinedHousehold`, which registers
   * the new session, flips the active household, writes both on-disk pointers
   * and emits a whole-ledger change. What the screen owes the member instead is
   * the SAS — which is why this function's only real job after the await is
   * putting six digits on screen.
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
          text: 'Request sent. Read the number below to the household owner — this household is added to the ones on this device once they confirm it matches.',
        });
        void runBudgetLocalSync('after-join');
      } catch (error) {
        console.error('Join household failed', error);
        setJoinConfirm(null);
        // Claiming needs an open local ledger, and when there isn't one the
        // failure has nothing to do with the invite. Reporting it as "check the
        // code and secret" sends the member off to re-read a perfectly good
        // code — observed against an invite minted sixty seconds earlier.
        const notReady =
          error instanceof BudgetLocalNotReadyError ||
          (error instanceof Error && error.name === 'BudgetLocalNotReadyError');
        // Refused for being minutes from expiry: the code and the secret were
        // both RIGHT, and the generic "check the code" would send somebody to
        // re-read something that is not wrong. The control plane refuses these
        // because the owner cannot approve in the time left — the only useful
        // instruction is to ask for another invite.
        const expiring =
          error instanceof BudgetInviteExpiringError ||
          (error instanceof Error && error.name === 'BudgetInviteExpiringError');
        setJoinStatus({
          ok: false,
          text: notReady
            ? 'This device is still setting up its budget. Wait a moment and try again — if it keeps happening, sign out and back in.'
            : expiring
              ? 'That invite is about to run out, so it cannot be claimed. Ask them to send a new one.'
              : 'Could not join. Check the invite has not expired, that the code and secret are right, and that it was sent to this account.',
        });
      } finally {
        setIsJoining(false);
      }
    })();
  };

  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID="budget-join-screen">
        <ScreenHeader
          title="Join a household"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <ScrollView
          {...keyboardDismissScrollProps}
          style={styles.flex}
          contentContainerStyle={styles.content}
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={onPullRefresh}
              tintColor={colors.textSecondary}
            />
          }
        >
          {/* This device's own wait, above the form that started it. */}
          <BudgetJoinWaitingPanel {...wait} />
          {/* And what happens AFTER the wait ends: the household's history is a
              download, not an instant, and this is the screen the person is
              still standing on when it starts. */}
          <BudgetSyncProgressPanel />

          <Typography variant="caption1" color={colors.textSecondary} style={styles.intro}>
            Their household is ADDED to this device — nothing already here is removed, and you
            switch between them from Households.
          </Typography>

          <View testID="budget-settings-join-panel">
            <GradientButton
              title="Scan QR code"
              fullWidth
              disabled={wait.awaiting}
              onPress={() => {
                setJoinStatus(null);
                setScannerVisible(true);
              }}
              testID="budget-settings-scan-invite"
            />
            <Typography variant="caption2" color={colors.textSecondary} style={styles.scanHint}>
              Point your camera at the QR code on their phone. Or tap the invite link they sent —
              these fill in for you — otherwise paste or type the code and secret.
            </Typography>
            <TextInput
              label="Invite code"
              placeholder="5LSKVC"
              value={joinCodeDraft}
              onChangeText={handleJoinCodeChange}
              autoCapitalize="characters"
              autoCorrect={false}
              testID="budget-settings-join-code"
            />
            <View style={styles.fieldGap} />
            <TextInput
              label="Secret"
              value={joinSecretDraft}
              onChangeText={setJoinSecretDraft}
              autoCapitalize="none"
              autoCorrect={false}
              testID="budget-settings-join-secret"
            />
            <View style={styles.fieldGap} />
            <GradientButton
              title={wait.awaiting ? 'Waiting for approval…' : 'Join household'}
              variant="secondary"
              disabled={isJoining || wait.awaiting}
              onPress={() => {
                // A link pasted straight into the code field still wins: it
                // carries both halves and cannot be transcribed wrong.
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
              testID="budget-settings-join-household"
            />
            {joinStatus ? (
              <View style={styles.statusPanel}>
                <Typography
                  variant="caption1"
                  color={joinStatus.ok ? colors.success : colors.error}
                  testID="budget-settings-join-status"
                >
                  {joinStatus.text}
                </Typography>
              </View>
            ) : null}
          </View>
        </ScrollView>

        <BudgetInviteQrScanner
          visible={scannerVisible}
          onClose={() => setScannerVisible(false)}
          onScanned={handleScannedCode}
        />
        {/* Asked, not warned about. Joining adds a household (BR-016 B6), so
            the dialog's job is to name the one arriving — not the one that used
            to be destroyed getting there. */}
        <JoinAddDialog
          visible={joinConfirm !== null}
          target={joinConfirm?.target ?? null}
          keeping={keepingSummary}
          busy={isJoining || isResolvingInvite}
          onConfirm={handleJoin}
          onCancel={() => setJoinConfirm(null)}
        />
      </SafeAreaView>
    </AppBackground>
  );
}

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
