import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import type { HouseholdMember } from '@api/households';
import { Avatar, Card, Chip, GradientButton, Typography } from '@components/ui';
import {
  removeBudgetHouseholdMember,
  setBudgetMemberRole,
  type ControlPlaneState,
} from '@features/budget/local/controlPlaneClient';
import {
  getActiveBudgetHouseholdId,
  isAwaitingHouseholdEnrolment,
  subscribeToLedgerChanges,
} from '@features/budget/local/engine';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import {
  budgetMemberName,
  publishBudgetRoster,
  refreshBudgetHouseholdRoster,
} from '@features/budget/local/householdRoster';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';

/**
 * The household whose members this card is naming, re-read when the engine
 * switches.
 *
 * The active household is a module variable, not a React store, so a switch is
 * invisible here until something else re-renders — and this card would keep
 * showing one household's people while the screen around it describes another.
 * The id is the snapshot rather than the ledger revision: a roster changes when
 * the control plane says so, never when an expense lands.
 */
function useActiveBudgetHouseholdId(): string | null {
  return useSyncExternalStore(
    subscribeToLedgerChanges,
    getActiveBudgetHouseholdId,
    getActiveBudgetHouseholdId,
  );
}

/**
 * Who shares this budget — by face and name.
 *
 * Budget V2 had no such list at all. A household was represented by its DEVICES
 * (Device Sync) and by whoever happened to be waiting at the door (the pending
 * join requests on this screen), so the one question a shared budget raises
 * first — "who else is in this?" — had no answer anywhere in the app, and every
 * surface that had to name a peer said "Household member".
 *
 * The roster is read from the store rather than fetched here, because it is
 * published from three places that all know more than a card does: session
 * open, every sync run, and a change to your own profile
 * (`householdRoster.ts`). This component adds the fourth trigger that only a
 * screen can know about — being looked at — so opening the list is itself a
 * refresh. BR-016 adds a fifth, for the same reason: the active household
 * changing under an already-open list.
 *
 * Never renders empty. You are always in your own household, so a blank list
 * here would mean a failed fetch, and it would read as "nobody is here".
 *
 * The owner also ADMINISTERS the household from here, because this is the only
 * place the household is a list of people rather than a list of devices. Until
 * these buttons existed a household was a one-way door: an owner could let
 * someone in and could revoke a device, but could not end a membership — and
 * revoking devices did not do it, because the membership survived and the
 * person could enrol a new device and walk straight back in.
 */
export function BudgetHouseholdMembersCard() {
  const colors = useAppColors();
  const members = useHouseholdStore((s) => s.currentHouseholdMembers);
  // Which household the store's member list was published FOR. `householdStore`
  // is a one-member-list surface (`householdRoster.publishBudgetRoster` only
  // ever writes the ACTIVE household's roster into it), so this is how the card
  // tells "these are your people" from "these are the people of the household
  // you just left, still on screen until the swap lands".
  const membersHouseholdId = useHouseholdStore((s) => s.currentHousehold?.id ?? null);
  const selfUserId = useAuthStore((s) => s.user?.id);
  const activeHouseholdId = useActiveBudgetHouseholdId();
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Which row is mid-request. A role change is a round trip plus a republish,
  // and a removal adds a key rotation on top — seconds on a slow link, with
  // nothing on screen to say so. Same reason the device list tracks it: an
  // untouched-looking row after a destructive confirm reads as "the tap
  // missed", and the answer to that is always to tap again.
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Looking at the list refreshes it, and so does switching household while it
  // is being looked at. Offline-safe: a failure leaves whatever the last
  // successful sync published, which is the honest last-known answer.
  //
  // The household is NAMED rather than left to default — `refreshBudgetHouseholdRoster`
  // resolves the active one across an await, and a switch mid-fetch would
  // publish this household's members as the other's.
  useFocusEffect(
    useCallback(() => {
      if (!isBudgetLocalFirst() || !activeHouseholdId) return;
      let alive = true;
      setIsRefreshing(true);
      void refreshBudgetHouseholdRoster(activeHouseholdId).finally(() => {
        if (alive) setIsRefreshing(false);
      });
      return () => {
        alive = false;
      };
    }, [activeHouseholdId]),
  );

  // Persisted store slice: a payload written before this field existed
  // rehydrates as undefined.
  //
  // Held back when it belongs to a household this card is no longer showing.
  // `ensureSession` republishes the roster on the very same ledger event this
  // component subscribes to, so the gap is normally a single render — but a
  // member list is the one place cross-household bleed is legible as such
  // ("who are these people?"), and the empty branch below already says the
  // truthful thing while the real answer is on its way. The guard only applies
  // once the engine HAS an active household: with local-first off there is none
  // to compare against, and the store is the only source there is.
  const showsActiveHousehold =
    activeHouseholdId === null || membersHouseholdId === activeHouseholdId;
  // A household this device has claimed but not been let into has no roster it
  // is entitled to: every read of it is answered 403 until the owner approves,
  // so the store holds only the self-row seed. Showing that seed listed the
  // waiting member alone, as OWNER, under "IN THIS HOUSEHOLD" — a household
  // they are not yet in, owned by somebody else. Held back until there is a
  // real answer; the branch below says what is actually true.
  const awaitingEnrolment = activeHouseholdId !== null && isAwaitingHouseholdEnrolment(activeHouseholdId);
  const roster = showsActiveHousehold && !awaitingEnrolment ? (members ?? []) : [];

  // Read off the roster rather than off anything remembered: the role can be
  // taken away by another owner while this screen is open, and the buttons
  // must go with it. The server is the authority either way — this only decides
  // whether to OFFER an action, never whether it is allowed.
  const isSelfOwner = roster.some((m) => m.user_id === selfUserId && m.role === 'owner');

  /**
   * Run one member action and adopt the registry it answers with.
   *
   * The response IS the new roster, so it is published rather than re-fetched:
   * a round trip that ends by asking the same question again is a second chance
   * for the list to show the old role, which is precisely the state the owner
   * just tapped to leave.
   */
  const runMemberAction = async (
    member: HouseholdMember,
    act: () => Promise<ControlPlaneState>,
  ) => {
    const householdId = activeHouseholdId;
    setBusyUserId(member.user_id);
    try {
      const state = await act();
      publishBudgetRoster(state, householdId ?? undefined);
    } catch (error) {
      console.error('[budget.local] member action failed', error);
      const status =
        typeof error === 'object' && error !== null
          ? (error as { response?: { status?: number } }).response?.status
          : undefined;
      if (status === 404) {
        // They are already out — somebody else's owner got there first. Say so
        // and re-read, rather than leaving a row on screen that no longer
        // exists anywhere but here.
        void refreshBudgetHouseholdRoster(householdId ?? undefined);
      }
      const [title, text] = memberActionAlert(status);
      Alert.alert(title, text);
    } finally {
      setBusyUserId(null);
    }
  };

  const confirmRemove = (member: HouseholdMember) => {
    const name = budgetMemberName(member);
    Alert.alert(
      `Remove ${name}?`,
      // Every half of what removal costs. The DELETION is said first because it
      // is the irreversible one and the one the owner is answering for: ending
      // the membership erases this household's copy on the other person's
      // phones (`membershipWatch`), not merely cuts it off. The key rotation is
      // the part nobody expects and the part that cannot be undone by re-adding
      // them: getting back in means a fresh invite and a fresh device approval.
      `This household's budget is deleted from every device ${name} holds — permanently — those devices are removed from the household's record, and the household keys rotate. To let ${name} back in you would have to invite them again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void runMemberAction(member, () =>
              removeBudgetHouseholdMember({
                userId: member.user_id,
                householdId: activeHouseholdId ?? undefined,
              }),
            );
          },
        },
      ],
    );
  };

  const confirmPromote = (member: HouseholdMember) => {
    const name = budgetMemberName(member);
    Alert.alert(
      `Make ${name} an owner?`,
      // Said plainly because it is mutual: an owner can remove the owner who
      // promoted them, and nothing in the app takes that back afterwards.
      'Owners can invite people, approve their devices, and remove members — including you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make owner',
          onPress: () => {
            void runMemberAction(member, () =>
              setBudgetMemberRole({
                userId: member.user_id,
                role: 'OWNER',
                householdId: activeHouseholdId ?? undefined,
              }),
            );
          },
        },
      ],
    );
  };

  /**
   * The menu. Two actions rather than two buttons per row: a member list is
   * read far more often than it is administered, and a row carrying a live
   * "Remove" is a row one mistap away from an irreversible act.
   */
  const openMemberActions = (member: HouseholdMember) => {
    const name = budgetMemberName(member);
    const isOwner = member.role === 'owner';
    Alert.alert(name, 'What would you like to change?', [
      isOwner
        ? {
            // A demotion takes nothing away that the person can see in the
            // budget and is undone by promoting them again, so it applies on
            // the tap — the confirm is spent where it is worth something.
            text: 'Make member',
            onPress: () => {
              void runMemberAction(member, () =>
                setBudgetMemberRole({
                  userId: member.user_id,
                  role: 'ADULT',
                  householdId: activeHouseholdId ?? undefined,
                }),
              );
            },
          }
        : { text: 'Make owner', onPress: () => confirmPromote(member) },
      {
        text: 'Remove from household',
        style: 'destructive' as const,
        onPress: () => confirmRemove(member),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return (
    <>
      <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
        IN THIS HOUSEHOLD
      </Typography>
      <Card style={styles.card} testID="budget-household-members">
        {roster.length === 0 ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="budget-household-members-empty"
          >
            {/* A roster held back for belonging to another household counts as
                loading, not as a failure: the refresh for this one is queued
                behind this very render, and "we could not reach your household"
                would be a false alarm every time the member switches. */}
            {awaitingEnrolment
              ? 'Your household members will appear as this device receives the household data.'
              : isRefreshing || !showsActiveHousehold
                ? 'Loading the people who share this budget…'
                : 'We could not reach your household just now. This list updates on the next sync.'}
          </Typography>
        ) : (
          roster.map((member, index) => {
            const isSelf = member.user_id === selfUserId;
            const name = budgetMemberName(member);
            // Never your own row: ending or demoting your own membership is
            // refused by the control plane (it is what keeps a household with
            // an owner in it), so offering the button would only produce an
            // error. Leaving is a different act with a different door — Settings
            // → Households → Leave — because it erases this device's copy too,
            // which is not a decision to hand somebody a one-tap Manage menu for.
            const canManage = isSelfOwner && !isSelf;
            return (
              <View
                key={member.id}
                style={[
                  styles.row,
                  index > 0 ? { borderTopColor: colors.borderColor, ...styles.divider } : null,
                ]}
                testID={`budget-household-member-${member.user_id}`}
              >
                <Avatar
                  user={{
                    display_name: member.display_name,
                    avatar_url: member.avatar_url,
                    email: member.email,
                  }}
                  size="sm"
                />
                <View style={styles.text}>
                  <View style={styles.nameRow}>
                    <Typography
                      variant="footnote"
                      weight="semibold"
                      numberOfLines={1}
                      style={styles.name}
                      testID={`budget-household-member-name-${member.user_id}`}
                    >
                      {name}
                    </Typography>
                    {isSelf ? (
                      <Typography variant="caption2" weight="semibold" color={colors.primary}>
                        You
                      </Typography>
                    ) : null}
                    {/* The role as a badge rather than a word trailing the
                        address. It is the one thing on this row that decides
                        what somebody may DO, and buried mid-sentence after an
                        email it read as part of the address. */}
                    <Chip
                      label={roleLabel(member.role)}
                      variant={member.role === 'owner' ? 'primary' : 'secondary'}
                      size="sm"
                      // `secondary` fills with `groupedListBackground`, which is
                      // the card's own colour — a filled Member badge on this
                      // card is an invisible badge. The outline gives it the
                      // capsule edge the Owner badge gets from its tint.
                      outlined={member.role !== 'owner'}
                      testID={`budget-household-member-role-${member.user_id}`}
                    />
                  </View>
                  {/* The address only when it is not already the name — repeating
                      `ada` under `ada` is a row of noise. */}
                  {member.email && member.email !== name ? (
                    <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
                      {member.email}
                    </Typography>
                  ) : null}
                </View>
                {busyUserId === member.user_id ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary}
                    testID={`budget-household-member-busy-${member.user_id}`}
                  />
                ) : canManage ? (
                  <GradientButton
                    title="Manage"
                    variant="secondary"
                    size="sm"
                    disabled={busyUserId !== null}
                    onPress={() => openMemberActions(member)}
                    testID={`budget-household-member-manage-${member.user_id}`}
                  />
                ) : null}
              </View>
            );
          })
        )}
      </Card>
    </>
  );
}

/** Plain words, never the control plane's `OWNER` / `ADULT`. */
function roleLabel(role: string): string {
  return role === 'owner' ? 'Owner' : 'Member';
}

/**
 * What to say when a member action is refused.
 *
 * Every one of these is a rule the SERVER enforces, and a rule stated is worth
 * more than a generic failure the owner is invited to retry — the buttons are
 * owner-only and self-excluded, but a role can change between render and tap,
 * and two owners can act on the same person at once.
 */
function memberActionAlert(status: number | undefined): [string, string] {
  if (status === 403) {
    return ['Owner only', 'Only an owner of this household can change who is in it.'];
  }
  if (status === 409) {
    return [
      'Not your own membership',
      'You cannot change or remove yourself here — a household always keeps an owner.',
    ];
  }
  if (status === 404) {
    return ['Already gone', 'They are no longer in this household. The list has been refreshed.'];
  }
  return ['Error', 'Could not update that member. Check you are online and try again.'];
}

const styles = StyleSheet.create({
  groupLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  card: { padding: Spacing.base, borderRadius: CornerRadius.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.xs },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  name: { flexShrink: 1 },
});
