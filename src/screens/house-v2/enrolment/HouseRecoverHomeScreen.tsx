/**
 * "Your home is not on this phone yet" — the screen for the two bootstrap
 * states that previously had nowhere to go.
 *
 * A device with no local copy of a home used to create one, silently, and the
 * member found out by noticing that their properties now held one empty home
 * where their real one had been (17 such homes on staging). The fix asks the
 * server first — and that answer produces two states no screen rendered:
 *
 *   `recover-this-home`   the account owns homes, this phone holds no key for
 *                         any of them;
 *   `undecided-offline`   the phone could not reach us, so nothing is known and
 *                         — deliberately — nothing was created.
 *
 * This screen is the whole of the member-facing half of that fix. It NAMES the
 * homes, because "you have a home you cannot open" is unbearable without being
 * told which one, and it offers only the two routes that actually work: another
 * phone approving this one, and a backup restored with its recovery phrase.
 *
 * Rendered ON TOP of the authenticated shell by `app/_layout.tsx`, never
 * instead of it — see `useHouseRecoveryGate` and `RECOVERY_ROUTES` below.
 */
import { router, usePathname } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { isHouseBrand } from '@brand';
import { AppBackground, SafeAreaView, screenScrollViewStyle } from '@components/common';
import { Card, GradientButton, Typography } from '@components/ui';
import { HouseJoinWaitingPanel } from '@features/house/components/HouseJoinWaitingPanel';
import {
  ensureHouseLocalSession,
  getHouseLocalBootstrapState,
  startNewHouseholdOnThisDevice,
  subscribeToHouseLocalBootstrapState,
  type HouseLocalBootstrapState,
} from '@features/house/local/ensureSession';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { useHouseJoinWait, type HouseJoinWait } from '@features/house/local/useHouseJoinWait';
import { Spacing, useAppColors } from '@theme';

/** The two bootstrap states this screen exists for. */
export type HouseRecoveryState = Extract<
  HouseLocalBootstrapState,
  { status: 'recover-this-home' } | { status: 'undecided-offline' }
>;

/**
 * The routes this screen sends a member to, and therefore the routes it must
 * step aside for.
 *
 * Both ways out are ordinary expo-router routes, and a route can only render
 * inside the `<Stack />` that hosts it — which is why `app/_layout.tsx` draws
 * this screen ABOVE the shell rather than in place of it. The consequence is
 * that a pushed route would otherwise open UNDERNEATH this card: the member
 * would tap "Set up from my other phone" and appear to land back here.
 */
const RECOVERY_ROUTES = ['/device-sync', '/house-backup'];

/**
 * Is this device stuck in one of the two states above?
 *
 * Exported because the mount decision is not made here — `app/_layout.tsx`
 * chooses what the whole app renders, and it must ask the same question this
 * screen answers, exactly as `usePropertyAddressCaptureGate` does for the
 * address form.
 *
 * Returns null on every other brand, on a server-backed House build, and in
 * every healthy state, so the root layout's extra render costs one comparison.
 */
export function useHouseRecoveryGate(): HouseRecoveryState | null {
  const [state, setState] = useState<HouseLocalBootstrapState>({ status: 'idle' });

  useEffect(() => {
    // Not a render-time guard: the flag and the brand are constants for the
    // process, and reading them inside the effect keeps the hook order fixed.
    if (!isHouseBrand() || !isHouseLocalFirst()) return undefined;
    // Re-read before subscribing — the session may have opened between this
    // component mounting and the effect running, and the publisher only ever
    // announces CHANGES.
    setState(getHouseLocalBootstrapState());
    return subscribeToHouseLocalBootstrapState(setState);
  }, []);

  if (state.status === 'recover-this-home' || state.status === 'undecided-offline') return state;
  return null;
}

/** A home the account owns and this phone cannot open. */
function HomeRow({ id, name }: { id: string; name: string }) {
  const colors = useAppColors();
  return (
    <View style={[styles.homeRow, { borderColor: colors.borderColor }]}>
      <Typography variant="footnote" weight="semibold" testID={`house-recover-home-${id}`}>
        {name.trim() || 'Your home'}
      </Typography>
      <Typography variant="caption2" color={colors.textSecondary}>
        Waiting for the key to this phone
      </Typography>
    </View>
  );
}

function RecoverThisHome({
  households,
}: {
  households: Array<{ id: string; name: string }>;
}) {
  const colors = useAppColors();
  const [isStarting, setIsStarting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const handleStartNew = useCallback(() => {
    setNote(null);
    setIsStarting(true);
    void startNewHouseholdOnThisDevice()
      .catch(() =>
        setNote('That did not work. Close the app and open it again, then try once more.'),
      )
      .finally(() => setIsStarting(false));
  }, []);

  const many = households.length !== 1;

  return (
    <>
      <Card style={styles.card}>
        <Typography variant="title3" weight="semibold">
          {many ? 'Your homes are not on this phone yet' : 'Your home is not on this phone yet'}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.paragraph}>
          Everything in {many ? 'a home' : 'your home'} is scrambled so that only the phones you
          have set up can read it. This phone is new to {many ? 'them' : 'it'}, so it has not been
          given the key yet.
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.paragraph}>
          Nothing is lost, and nothing has been changed. {many ? 'They are' : 'It is'} safe where{' '}
          {many ? 'they are' : 'it is'} — this phone simply cannot open{' '}
          {many ? 'them' : 'it'} until one of your other phones lets it in, or you bring{' '}
          {many ? 'them' : 'it'} back from a backup.
        </Typography>

        <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
          ON YOUR ACCOUNT
        </Typography>
        {households.map((household) => (
          <HomeRow key={household.id} id={household.id} name={household.name} />
        ))}
      </Card>

      <Card style={styles.card}>
        <Typography variant="title3" weight="semibold">
          Use a phone that already has it
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.paragraph}>
          Open Symply House on your other phone, go to Device sync, and approve this one. It takes
          about a minute, and you need both phones with you.
        </Typography>
        <View style={styles.block}>
          <GradientButton
            title="Set up from my other phone"
            onPress={() => router.push('/device-sync')}
            testID="house-recover-device-sync"
          />
        </View>
      </Card>

      <Card style={styles.card}>
        <Typography variant="title3" weight="semibold">
          Restore from a backup
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.paragraph}>
          If you saved a backup and still have its recovery phrase, you can bring everything back
          on this phone by yourself — no second phone needed.
        </Typography>
        <View style={styles.block}>
          <GradientButton
            title="Restore from a backup"
            onPress={() => router.push('/house-backup')}
            testID="house-recover-restore-backup"
          />
        </View>
      </Card>

      {/*
        Last, quietest, and worded against the mistake it invites. Minting is
        still allowed — a member whose other phone is gone and who kept no
        backup has to be able to carry on — but it is the one act that produced
        the empty homes this whole screen exists to stop, so it may never read
        as "tap here to continue".
      */}
      <Card variant="filled" style={styles.card}>
        <Typography variant="footnote" weight="semibold">
          Not trying to get {many ? 'those' : 'that'} back?
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.paragraph}>
          Starting fresh does not bring back the {many ? 'homes' : 'home'} above. It makes a
          separate, empty home on this phone. The {many ? 'homes' : 'home'} above stay on your
          account, and you can still get {many ? 'them' : 'it'} back later from another phone or a
          backup.
        </Typography>
        <View style={styles.block}>
          <GradientButton
            title={isStarting ? 'Starting…' : 'Start a new, empty home'}
            variant="secondary"
            size="sm"
            disabled={isStarting}
            onPress={handleStartNew}
            testID="house-recover-start-new"
          />
        </View>
        {note ? (
          <Typography variant="caption1" color={colors.error} style={styles.paragraph}>
            {note}
          </Typography>
        ) : null}
      </Card>
    </>
  );
}

/**
 * No answer from the server, so we genuinely do not know.
 *
 * "Start a new home" is deliberately ABSENT here rather than merely secondary.
 * Offered as the only thing on screen it reads as the way forward, and taking
 * it is exactly how a member who was one signal bar away from their real home
 * ends up with a second empty one.
 */
function UndecidedOffline() {
  const colors = useAppColors();
  const [isRetrying, setIsRetrying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const handleRetry = useCallback(() => {
    setNote(null);
    setIsRetrying(true);
    void ensureHouseLocalSession()
      .then(() => {
        // Read the state the attempt left behind rather than assuming it
        // worked: this resolves normally when the network is still down, and
        // the screen would otherwise sit there looking successful.
        if (getHouseLocalBootstrapState().status === 'undecided-offline') {
          setNote('Still no answer. Check your connection and try again in a moment.');
        }
      })
      .catch(() => setNote('Still no answer. Check your connection and try again in a moment.'))
      .finally(() => setIsRetrying(false));
  }, []);

  return (
    <Card style={styles.card}>
      <Typography variant="title3" weight="semibold">
        We could not check your account
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary} style={styles.paragraph}>
        This phone could not reach us, so we do not know which homes are yours. Rather than guess,
        we have left everything alone — nothing has been created and nothing has been changed.
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary} style={styles.paragraph}>
        Connect to Wi-Fi or mobile data and try again. This also sorts itself out on its own the
        next time you open the app with a signal.
      </Typography>
      <View style={styles.block}>
        <GradientButton
          title={isRetrying ? 'Checking…' : 'Try again'}
          disabled={isRetrying}
          onPress={handleRetry}
          testID="house-recover-retry"
        />
      </View>
      {note ? (
        <Typography variant="caption1" color={colors.warning} style={styles.paragraph}>
          {note}
        </Typography>
      ) : null}
    </Card>
  );
}

/**
 * Waiting on an approval this device ASKED for — not a home it lost.
 *
 * A member who signs up to an invite has exactly one property, and it is
 * key-less until the owner taps approve, so `recover-this-home` fires for them
 * too. (It could not before: sign-up minted a home of their own, which is
 * precisely the home nobody asked for that the mint was removed to stop.) The
 * derived state is right — this phone holds no key — but every route the
 * recovery card offers is wrong for them: they have no other phone with this
 * home on it and no backup to restore, and the thing they actually need is the
 * six digits to read back to whoever invited them.
 */
function WaitingToBeLetIn({ wait }: { wait: HouseJoinWait }) {
  const colors = useAppColors();
  return (
    <>
      <Card style={styles.card}>
        <Typography variant="title3" weight="semibold">
          Waiting to be let in
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.paragraph}>
          Everything in a home is scrambled so that only the phones that have been let in can read
          it. You have asked to join; whoever invited you approves this phone, and then it can
          open the home.
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.paragraph}>
          Read them the number below. It is worked out on this phone from this phone&apos;s own
          keys, so the two matching is what proves nobody has come between you.
        </Typography>
      </Card>
      <HouseJoinWaitingPanel {...wait} />
    </>
  );
}

export function HouseRecoverHomeScreen({ state }: { state: HouseRecoveryState }) {
  const pathname = usePathname();
  // Before the early return, so the hook order is fixed: this is the invitee's
  // own claim, and it is what separates "let me back into my home" from "let me
  // into yours".
  const wait = useHouseJoinWait();
  // See `RECOVERY_ROUTES`: the member is standing on one of the two ways out,
  // and this card is drawn above the navigator rendering it.
  if (RECOVERY_ROUTES.includes(pathname)) return null;

  /**
   * The invitee branch needs the DIGITS, not just the waiting flag.
   *
   * `wait.awaiting` and `wait.sas` come from two independent sources —
   * `awaiting` is the engine's `session.awaitingKeys`, `sas` is a claim record
   * this device persisted when it claimed an invite — so `awaiting && !sas` is
   * an ordinary state, not a paradox. It happens on EVERY mount, because
   * `recallJoinSas()` is async and `claim` starts null; and it happens
   * PERMANENTLY for a device that is awaiting keys without having claimed an
   * invite here — a member row that arrived with the account, a reinstall, a
   * cleared store.
   *
   * Keyed on `awaiting` alone, that state rendered `WaitingToBeLetIn`, whose
   * card says "Read them the number below" above a `HouseJoinWaitingPanel` that
   * returns null without a SAS. The result was a full-screen `absoluteFill`
   * gate containing one paragraph, no number, and NO CONTROLS — and because it
   * had taken the branch away from `RecoverThisHome`, it also hid the only two
   * ways out of this state (`/device-sync`, `/house-backup`). Reproduced on
   * House-A: `my_role: 'member'`, no key, no claim record, no escape but
   * force-quitting.
   *
   * Requiring the SAS makes the fallback `RecoverThisHome`, which names the
   * homes and offers both routes. It is the strictly better answer in every
   * case: a member with no digits to read has nothing to gain from the waiting
   * card, and everything to gain from a door.
   */
  const waitingOnAnInvite =
    state.status === 'recover-this-home' &&
    ((wait.awaiting && wait.sas !== null) || wait.outcome !== null);

  return (
    <View style={StyleSheet.absoluteFill} testID="house-recover-home-screen">
      <AppBackground>
        <SafeAreaView edges={['top', 'bottom']}>
          <ScrollView
            style={screenScrollViewStyle.scroll}
            contentContainerStyle={styles.content}
          >
            {waitingOnAnInvite ? (
              <WaitingToBeLetIn wait={wait} />
            ) : state.status === 'recover-this-home' ? (
              <RecoverThisHome households={state.households} />
            ) : (
              <UndecidedOffline />
            )}
          </ScrollView>
        </SafeAreaView>
      </AppBackground>
    </View>
  );
}

export default HouseRecoverHomeScreen;

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  card: { marginBottom: Spacing.lg },
  paragraph: { marginTop: Spacing.xs },
  block: { marginTop: Spacing.md },
  groupLabel: { marginTop: Spacing.lg, marginBottom: Spacing.xs },
  homeRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.sm,
  },
});
