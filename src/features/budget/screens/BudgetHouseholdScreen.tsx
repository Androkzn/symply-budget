import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { type Household } from '@api/households';
import {
  SafeAreaView,
  AppBackground,
  HeaderActionButton,
  ScreenHeader,
  ScreenScrollEnd,
  screenScrollEndTestId,
} from '@components/common';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import { fetchControlPlaneState } from '@features/budget/local/controlPlaneClient';
import {
  activateLocalBudgetHousehold,
  getLocalLedger,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
} from '@features/budget/local/engine';
import { syncHouseholdStoreFromLocalLedger } from '@features/budget/local/ensureSession';
import { BudgetLocalUnknownHouseholdError } from '@features/budget/local/errors';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import type { SettingsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { IconSize, Layout, useAppColors } from '@theme';

/**
 * Budget-native household manager — the LIST.
 *
 * It is now only a list: the households on this device, which one is active,
 * and a way to add one. Everything ABOUT a household — its photo, name,
 * optional address, the people in it, and the exits — is `BudgetHouseholdEdit`,
 * a screen of its own that a card taps through to.
 *
 * That split replaced a swipe. Renaming used to be a swipe-left on a card
 * revealing an Edit button that opened a bottom sheet, and a swipe is the worst
 * available home for a screen's primary action: invisible until performed,
 * unreachable by a screen reader, undiscovered by most members, and — on the
 * Maestro side — a gesture whose failure looks exactly like a stale assertion.
 * A card that opens the thing it names needs no instructions.
 *
 * Two backends behind one surface. Under local-first (BR-016) a household is a
 * SESSION in the local engine — created, activated and removed on this device,
 * with the control plane learning about it afterwards — and enrolment happens on
 * Budget's own `BudgetInvite` screen, where an invite is a code plus a secret
 * rather than an emailed link. Without the flag it is still the shared
 * households API and its D1 rows. Every handler below forks once, at the top,
 * and the copy forks with it wherever the two models promise different things.
 */

/**
 * An error a member can act on, or the raw message when it already is one.
 *
 * `BudgetLocalUnknownHouseholdError` is the one worth translating: it means a
 * card is showing a household this device holds no ledger for — a row left in
 * the persisted store by a sign-out, or an id held across a switch — and "No
 * local ledger for household hh_local_9f…" names nothing the member can do.
 */
function memberFacingMessage(error: unknown, fallback: string): string {
  if (error instanceof BudgetLocalUnknownHouseholdError) {
    return 'This device no longer holds that household. Reopen this screen to refresh the list.';
  }
  return error instanceof Error ? error.message : fallback;
}

/**
 * What a household card says under its name.
 *
 * NOT `member_count`. That is a server-side count of rows in the shared
 * households table, and under Budget V2 nothing reads or writes it — the people
 * who share this budget are the DEVICES enrolled on the control plane. The two
 * disagreed on screen for real: a card reading "2 members" above a members list
 * reading "Active Members (1)", both from the server, neither counting the
 * device that had actually been enrolled.
 *
 * So the active household says what the control plane says, and only once it
 * has said it — a count that might be wrong is worse than no count. Any other
 * household is a server row this device does not hold a ledger for, so it gets
 * its role and nothing more.
 */
export function householdSubtitle(
  household: Pick<Household, 'my_role'>,
  isActive: boolean,
  enrolledDevices: number | null,
  awaitingEnrolment = false,
): string {
  // Said BEFORE the device count, because while this device is unenrolled the
  // count is the wrong answer to the member's actual question. A household
  // adopted on a fresh install renders exactly like a working one — real name,
  // "Active" pill, a plausible device count — while every write is silently
  // refused. This line is the only thing on the screen that says why, and what
  // ends it.
  // Not "…on your other device": the roster may hold only a ghost — a previous
  // install, still `active`, with the SAME label as the device reading this —
  // so naming an approver can send a member to a device that cannot act. The
  // banner on Home carries the route to Device Sync, where the real list is.
  if (awaitingEnrolment) return 'Waiting for household data';
  const role = household.my_role ?? '';
  if (!isActive || enrolledDevices == null) return role;
  const devices = enrolledDevices === 1 ? '1 device' : `${enrolledDevices} devices`;
  return role ? `${devices} • ${role}` : devices;
}

interface HouseholdCardProps {
  household: Household;
  isActive: boolean;
  /** Enrolled devices on the control plane — only known for the active one. */
  enrolledDevices: number | null;
  /** This device holds the household but not its key — writes are refused. */
  awaitingEnrolment: boolean;
  /** Open this household's own page. */
  onOpen: () => void;
  onSwitch: () => void;
}

/**
 * One household, as a row that opens it.
 *
 * The whole card is the tap target and it leads to exactly one place —
 * `BudgetHouseholdEdit` for THIS household. It used to lead to two, neither of
 * them the household: the body opened the invite hub (after silently switching
 * the engine to the card you tapped) and a "Manage members & invites" strip
 * underneath opened the same hub again. Those both live on the household's own
 * page now, where the members are.
 *
 * Switch stays a button of its own, because it is the one act on this screen
 * that changes something rather than navigating: tapping a card to LOOK at a
 * household must not move the budget the member is in.
 */
function HouseholdCard({
  household,
  isActive,
  enrolledDevices,
  awaitingEnrolment,
  onOpen,
  onSwitch,
}: HouseholdCardProps) {
  const colors = useAppColors();

  return (
    <Card
      variant="filled"
      style={[
        styles.card,
        {
          backgroundColor: isActive ? colors.primary + '20' : colors.backgroundSecondary,
          borderColor: isActive ? colors.primary : 'transparent',
          borderWidth: isActive ? 2 : 0,
        },
      ]}
    >
      {/* No `accessibilityLabel`, deliberately. `TouchableOpacity` is accessible
          by default, so its children MERGE into one label — "Sweet Home", the
          device/role subtitle, then "Active" or "Switch" — and that merged
          string is what `budget-household-switch.yaml` matches on
          (`.*E2E Switch HH.*Active.*` and the unterminated `.*E2E Switch HH.*Switch`).
          An explicit label REPLACES the merge, so a well-meant "Open this
          household" silently breaks both assertions and the flow's only way of
          telling which household is active. The role is what says it is
          tappable; the merged label is what says which household it is. */}
      <TouchableOpacity
        style={styles.cardContent}
        onPress={onOpen}
        activeOpacity={0.7}
        accessibilityRole="button"
        testID={`household-card-${household.id}`}
      >
        <View style={[styles.avatar, { backgroundColor: colors.primary + '18' }]}>
          <Icon name="people" size={26} color={colors.primary} />
        </View>

        <View style={styles.cardInfo}>
          <Typography variant="body" weight="semibold">
            {household.name}
          </Typography>
          <Typography
            variant="caption2"
            color={colors.textTertiary}
            testID={`household-subtitle-${household.id}`}
          >
            {householdSubtitle(household, isActive, enrolledDevices, awaitingEnrolment)}
          </Typography>
        </View>

        {/* LAST, and nothing after it. `budget-household-switch.yaml` asserts
            the pill with an unterminated regex (`.*E2E Switch HH.*Switch`),
            which only holds while the badge-or-pill is the final thing in the
            card's merged label — so a trailing chevron, however tempting as an
            "opens something" cue, would silently break that assertion. The
            card's accessibility label says where it goes instead. */}
        {isActive ? (
          <View style={[styles.activeBadge, { backgroundColor: colors.primary + '22' }]}>
            <Typography variant="caption2" weight="semibold" color={colors.primary}>
              Active
            </Typography>
          </View>
        ) : (
          <TouchableOpacity
            onPress={onSwitch}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.switchButton, { borderColor: colors.primary }]}
            testID={`household-switch-${household.id}`}
          >
            <Typography variant="caption2" weight="semibold" color={colors.primary}>
              Switch
            </Typography>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Card>
  );
}

/**
 * Takes no props, deliberately.
 *
 * It used to be typed `SettingsStackScreenProps<'HouseholdManagement'>` while
 * ignoring the argument, and that pinned the component to ONE route name in ONE
 * stack — so registering it as `BudgetHouseholds` (the row that now pushes it
 * from Invite & Household) would not typecheck in either navigator. A screen
 * that reads neither `route` nor the prop's `navigation` should not claim to.
 */
export function BudgetHouseholdScreen() {
  // The stack's own navigation type rather than the screen prop's composite
  // one: `CompositeScreenProps` resolves a param-less route's params to `never`
  // here (see the pre-existing constraint errors on this file's param lists),
  // so `navigate('BudgetInvite')` will not typecheck through the prop.
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const colors = useAppColors();
  const { refreshActivePropertyData } = useData();
  const { households, currentHousehold, setCurrentHousehold, fetchHouseholds } =
    useHouseholdStore();

  /**
   * Multi-household is live (BR-016), so every affordance here is again real.
   *
   * The engine now holds one SESSION per household — rows, op log, key epoch,
   * checkpoint watermark and sync cursors all partitioned by `household_id` —
   * so create, switch and remove go to the engine and never to `householdsApi`.
   * That routing is the whole fix: creating through the remote API wrote a D1
   * row the engine never learned about, which vanished from the list on the
   * next refresh while surviving on the server (the orphaning that failed
   * `budget-households` and `budget-household-switch` on "the new household is
   * still visible"). The interim guards that hid the Add FAB, Delete and Leave
   * are gone with the bug they were standing in for.
   *
   * The remote path below is untouched — it is still the whole story for a
   * brand that does not run the local-first engine.
   */
  const isLocalFirst = isBudgetLocalFirst();

  /**
   * How many devices actually share the active budget.
   *
   * Null until the control plane answers, and null again if it cannot be
   * reached — the card then says nothing about size rather than repeating the
   * server's `member_count`, which is the number that was wrong.
   */
  const [enrolledDevices, setEnrolledDevices] = useState<number | null>(null);

  /** Which household `enrolledDevices` is a count of. */
  const enrolledDevicesFor = useRef<string | null>(null);

  /**
   * The households this device holds but has no key for.
   *
   * Read from the ENGINE, not from `householdStore`: the store carries the
   * server's household record, which looks identical whether or not this device
   * can decrypt it. `awaitingEnrolment` only exists on the local session, and it
   * is the difference between a household that works and one that silently
   * refuses every write. Recomputed on focus with the rest of this screen —
   * enrolment completes during a sync, so a value read once at mount goes stale
   * exactly when it matters.
   */
  const awaitingHouseholdIds = (() => {
    if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return new Set<string>();
    return new Set(
      listLocalBudgetHouseholds()
        .filter((summary) => summary.awaitingEnrolment)
        .map((summary) => summary.householdId),
    );
  })();

  /**
   * Read the ACTIVE household's device roster.
   *
   * The count belongs to ONE household and `householdSubtitle` hangs it on
   * whichever card is active, so it has to move when the active household does
   * — carried across a switch it would state household A's size under household
   * B's name, the same class of wrong number as the server `member_count` this
   * replaced. Hence the household this count is FOR, tracked alongside it: it
   * blanks the number on a move (and only on a move — clearing on every focus
   * would flicker the subtitle back to the bare role each visit) and discards an
   * answer that arrives after the member has already switched away.
   */
  const refreshEnrolledDevices = useCallback(async () => {
    if (!isLocalFirst || !isLocalBudgetSessionOpen()) {
      enrolledDevicesFor.current = null;
      setEnrolledDevices(null);
      return;
    }
    const householdId = getLocalLedger().household.id;
    if (enrolledDevicesFor.current !== householdId) {
      enrolledDevicesFor.current = householdId;
      setEnrolledDevices(null);
    }
    try {
      const state = await fetchControlPlaneState(householdId);
      if (enrolledDevicesFor.current !== householdId) return;
      setEnrolledDevices(state.devices.filter((device) => device.status === 'active').length);
    } catch (error) {
      console.warn('[budget-household] could not read the device roster', error);
      if (enrolledDevicesFor.current === householdId) setEnrolledDevices(null);
    }
  }, [isLocalFirst]);

  useFocusEffect(
    useCallback(() => {
      if (isLocalFirst && isLocalBudgetSessionOpen()) {
        // Under local-first the household list belongs to the ENGINE, not to
        // D1. `fetchHouseholds()` still collapses it to the active ledger's one
        // household (`householdStore.ts`) — precisely the refresh that used to
        // delete a just-created household from the list moments after it
        // appeared. This publishes the real set instead: synchronous, and it
        // decrypts nothing, because a cold household's name and role are
        // already in the session registry.
        syncHouseholdStoreFromLocalLedger();
      } else {
        // Also the path that OPENS the local session when local-first is on but
        // the engine has not started yet: `fetchHouseholds` awaits
        // `ensureBudgetLocalSession()` before it publishes anything.
        fetchHouseholds();
      }
      void refreshEnrolledDevices();
    }, [fetchHouseholds, isLocalFirst, refreshEnrolledDevices])
  );

  // Show the most recently created household first. The shared households API
  // appends new rows, so a freshly created household lands at the bottom of a
  // long list — off-screen on iOS, where Maestro can't reliably scroll a RN
  // ScrollView to reveal it. Newest-first keeps a just-created household above
  // the fold (and is the more useful ordering for a "My Households" list).
  const orderedHouseholds = useMemo(
    () =>
      [...households].sort((a, b) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? '')
      ),
    [households]
  );

  /**
   * Open a household's own page.
   *
   * Deliberately does NOT activate it first. The previous version of this tap
   * did — it moved the engine to whichever card you touched and then opened the
   * invite hub, because that hub acts on "the active household" and takes no id
   * — so LOOKING at a household silently changed the budget you were in.
   * `BudgetHouseholdEdit` is addressed: it edits, renames, re-photographs and
   * removes the household it was handed, active or not, and offers switching as
   * a button rather than performing it behind a tap.
   */
  const handleOpen = (household: Household) => {
    navigation.navigate('BudgetHouseholdEdit', { householdId: household.id });
  };

  /**
   * Switching is an ENGINE act under local-first, not a store assignment.
   *
   * `activateLocalBudgetHousehold` hydrates that household's rows (once — a
   * hydrated session keeps them, so switching back and forth is free), moves
   * the on-disk active pointer and emits a whole-ledger change, which is what
   * repaints every budget screen and republishes `householdStore`. Assigning
   * `currentHousehold` on its own would leave every domain API called with an
   * id the engine had not activated, and the local facades throw on that
   * mismatch: Savings, Mortgage and Loans render empty over data that is on
   * disk, decrypted, one id away.
   */
  const handleSwitch = async (household: Household) => {
    if (household.id === currentHousehold?.id) return;
    try {
      if (isLocalFirst) {
        await activateLocalBudgetHousehold(household.id);
        // `ensureSession` already follows ledger changes and republishes the
        // store, so this is a second belt on the same trousers — deliberately.
        // The engine is the authority on which household is active, and a badge
        // left on the previous card is the one failure a member reads as "the
        // switch didn't work", which is worse than a redundant synchronous call
        // over state that is already in memory.
        syncHouseholdStoreFromLocalLedger();
        // The device count on the card is now the wrong household's — see
        // `refreshEnrolledDevices`.
        void refreshEnrolledDevices();
      } else {
        setCurrentHousehold(household);
      }
      await refreshActivePropertyData();
    } catch (error) {
      Alert.alert(
        'Error',
        memberFacingMessage(error, 'Failed to switch household. Please try again.')
      );
    }
  };

  /**
   * A new household is the SAME screen, with nothing to load.
   *
   * `BudgetHouseholdEdit` without a `householdId` is the create form, so a
   * household is named, pictured and addressed in one save. It used to be a
   * name-only sheet here, which meant every new household began life needing a
   * second, separate edit for everything else about it.
   */
  const handleAdd = () => {
    navigation.navigate('BudgetHouseholdEdit');
  };

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        // Matches the row that pushes it on Invite & Household. A row labelled
        // "Households" that opens a screen titled "My Households" reads, for a
        // moment, like two different places.
        title="Households"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        // Add lives in the header rather than a floating pill over the list. The
        // FAB sat above the tab bar and covered the last card once a member had
        // enough households to scroll — the one moment the list matters most.
        rightElement={
          <HeaderActionButton
            iconOnly
            onPress={handleAdd}
            testID="fab-add-household"
            accessibilityLabel="Add a new household"
          >
            <Icon name="add" size={IconSize.lg} active />
          </HeaderActionButton>
        }
      />
      {/* The screen's own id. Only the ScrollEnd carried the name
          `budget-households-screen`, so nothing could wait for THIS screen to
          arrive — a flow deep-linking here had to guess at a child, and an
          assertion on the screen itself simply never resolved. */}
      <SafeAreaView edges={[]} testID="budget-households-screen">
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.subtitleSection}>
            {/* Creating and switching are both true again (BR-016), so the copy
                says so — it spent the interim single-household release claiming
                only the one thing the screen could still do. */}
            <Typography variant="body" color={colors.textSecondary}>
              Create a household and invite people to share the same budget. Switch between
              households anytime — tap one to open it.
            </Typography>
            {households.length === 0 && (
              <View style={styles.gettingStarted}>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.bullet}>
                  • Everyone in a household shares one budget
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.bullet}>
                  {/* Local-first shares a budget by ENROLLING A DEVICE — an
                      invite is a code plus a secret, handed over as a QR — so
                      the email/link line would name a flow Budget cannot honour. */}
                  {isLocalFirst
                    ? '• Invite people with a QR code or an invite code'
                    : '• Invite people by email or a shareable link'}
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.bullet}>
                  • Switch between households anytime
                </Typography>
              </View>
            )}
          </View>

          {households.length === 0 ? (
            <Card variant="filled" style={[styles.emptyState, { backgroundColor: colors.backgroundSecondary }]}>
              <Icon name="people" size={48} color={colors.textSecondary} style={styles.emptyIcon} />
              <Typography variant="headline" weight="semibold" style={styles.emptyTitle}>
                No households yet
              </Typography>
              <Typography variant="body" color={colors.textSecondary} style={styles.emptyText}>
                Create your first household to start sharing a budget with others
              </Typography>
            </Card>
          ) : (
            <View style={styles.list}>
              {orderedHouseholds.map((household) => (
                <HouseholdCard
                  key={household.id}
                  household={household}
                  isActive={household.id === currentHousehold?.id}
                  enrolledDevices={enrolledDevices}
                  awaitingEnrolment={awaitingHouseholdIds.has(household.id)}
                  onOpen={() => handleOpen(household)}
                  onSwitch={() => {
                    void handleSwitch(household);
                  }}
                />
              ))}
            </View>
          )}
          <ScreenScrollEnd testID={screenScrollEndTestId('budget-households-screen')} />
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    // Was a hand-tuned 100 to clear the FAB. With the action in the header the
    // only thing left to clear is the floating tab bar, so use the shared
    // constant every other Budget screen does.
    paddingBottom: Layout.bottomTabBarClearance,
  },
  subtitleSection: {
    marginBottom: 24,
  },
  gettingStarted: {
    marginTop: 16,
    gap: 8,
  },
  bullet: {
    lineHeight: 20,
  },
  list: {
    marginBottom: 24,
  },
  card: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  activeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  switchButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
    borderRadius: 12,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    textAlign: 'center',
  },
});
