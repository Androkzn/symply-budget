import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Animated, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import type { Household } from '@api/households';
import { SafeAreaView, AppBackground, ScreenHeader } from '@components/common';
import { Card, Typography, FloatingActionButton } from '@components/ui';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import {
  fetchControlPlaneState,
  houseHouseholdIsOnControlPlane,
  leaveHouseHousehold,
  syncLocalHouseholdToControlPlane,
} from '@features/house/local/controlPlaneClient';
import {
  activateLocalHouseProperty,
  createLocalHouseProperty,
  getActiveHouseholdId,
  getLocalHouseLedger,
  isLocalHouseSessionOpen,
  removeLocalHouseProperty,
  renameLocalHouseProperty,
} from '@features/house/local/engine';
import { syncHouseholdStoreFromLocalLedger } from '@features/house/local/ensureSession';
import { HouseLocalUnknownPropertyError } from '@features/house/local/errors';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { forgetHouseRoster } from '@features/house/local/householdRoster';
import type { SettingsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';

import { HouseOtherHouseholdsCard } from './HouseOtherHouseholdsCard';

/**
 * House → Invite & home → **Homes**. The homes this device holds.
 *
 * A home here is a SESSION in the local engine — created, activated, renamed and
 * removed on this device, with the control plane learning about it afterwards —
 * and enrolment happens on the Invite screen, where an invite is a code plus a
 * secret rather than an emailed link.
 *
 * Everything routes through the ENGINE, never through the shared households API.
 * Creating through the remote API writes a D1 row the engine never learns about,
 * which vanishes from the list on the next refresh while surviving on the
 * server; the engine mints its own `hh_local_*` id and the list is published
 * from the engine's own set.
 */

/**
 * Copy for the one removal the engine will not perform.
 *
 * `removeLocalHouseProperty` throws when it is asked to drop the last property:
 * the engine has no "no home" state to fall back into, so the last one stays.
 * The member meets that refusal twice — once as a pre-flight, BEFORE the
 * destructive confirmation rather than after it (asking "are you sure?" and then
 * saying no is how a member learns to distrust a confirm dialog), and once in
 * the catch, because the list on screen is a published copy while the engine's
 * own session count is the authority.
 */
const LAST_PROPERTY_TITLE = 'This is your only home';
const LAST_PROPERTY_MESSAGE =
  'Symply House always keeps one home open, so this one cannot be removed. Create another home first, then remove this one.';

/** The engine's refusal, matched on its message — it throws a plain `Error`. */
function isLastPropertyRefusal(error: unknown): boolean {
  return error instanceof Error && error.message.includes('cannot remove the last property');
}

/**
 * An error a member can act on, or the raw message when it already is one.
 *
 * `HouseLocalUnknownPropertyError` is the one worth translating: it means a card
 * is showing a home this device holds no ledger for — a row left in the
 * persisted store by a sign-out, or an id held across a switch — and "No local
 * ledger for property hh_local_9f…" names nothing the member can do.
 */
function memberFacingMessage(error: unknown, fallback: string): string {
  if (isLastPropertyRefusal(error)) return LAST_PROPERTY_MESSAGE;
  if (error instanceof HouseLocalUnknownPropertyError) {
    return 'This device no longer holds that home. Reopen this screen to refresh the list.';
  }
  return error instanceof Error ? error.message : fallback;
}

/**
 * What a home card says under its name.
 *
 * NOT `member_count`. That is a server-side count of rows in the shared
 * households table, and under local-first nothing reads or writes it — the
 * people who share this home are the DEVICES enrolled on the control plane. The
 * two disagreed on screen for real: a card reading "2 members" above a members
 * list reading "1", both from the server, neither counting the device that had
 * actually been enrolled.
 *
 * So the active home says what the control plane says, and only once it has said
 * it — a count that might be wrong is worse than no count. Any other home is a
 * row this device may not have a fresh answer for, so it gets its role and
 * nothing more.
 */
export function propertySubtitle(
  household: Pick<Household, 'my_role'>,
  isActive: boolean,
  enrolledDevices: number | null,
): string {
  const role = household.my_role ?? '';
  if (!isActive || enrolledDevices == null) return role;
  const devices = enrolledDevices === 1 ? '1 device' : `${enrolledDevices} devices`;
  return role ? `${devices} • ${role}` : devices;
}

interface PropertyCardProps {
  household: Household;
  isActive: boolean;
  /** Enrolled devices on the control plane — only known for the active one. */
  enrolledDevices: number | null;
  onManage: () => void;
  onSwitch: () => void;
  onEdit: () => void;
  swipeableRef: (ref: Swipeable | null) => void;
  onSwipeableOpen: () => void;
}

function PropertyCard({
  household,
  isActive,
  enrolledDevices,
  onManage,
  onSwitch,
  onEdit,
  swipeableRef,
  onSwipeableOpen,
}: PropertyCardProps) {
  const colors = useAppColors();

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const translateX = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [0, 80],
      extrapolate: 'clamp',
    });
    return (
      <Animated.View style={[styles.swipeActionsContainer, { transform: [{ translateX }] }]}>
        <TouchableOpacity
          onPress={onEdit}
          style={[styles.swipeAction, { backgroundColor: colors.primary }]}
          testID={`property-swipe-edit-${household.id}`}
        >
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            Edit
          </Typography>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
      onSwipeableWillOpen={onSwipeableOpen}
    >
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
        {/* Tapping the card opens member / invite management for it. */}
        <TouchableOpacity
          style={styles.cardContent}
          onPress={onManage}
          activeOpacity={0.7}
          testID={`property-card-${household.id}`}
        >
          <View style={[styles.avatar, { backgroundColor: colors.primary + '18' }]}>
            <Icon name="home" size={26} color={colors.primary} />
          </View>

          <View style={styles.cardInfo}>
            <Typography variant="body" weight="semibold">
              {household.name}
            </Typography>
            <Typography
              variant="caption2"
              color={colors.textTertiary}
              testID={`property-subtitle-${household.id}`}
            >
              {propertySubtitle(household, isActive, enrolledDevices)}
            </Typography>
          </View>

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
              testID={`property-switch-${household.id}`}
            >
              <Typography variant="caption2" weight="semibold" color={colors.primary}>
                Switch
              </Typography>
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.manageRow}
          onPress={onManage}
          activeOpacity={0.7}
          testID={`property-manage-members-${household.id}`}
        >
          <Icon name="person-add" size={16} color={colors.textSecondary} />
          <Typography variant="footnote" color={colors.textSecondary} style={styles.manageLabel}>
            Manage members &amp; invites
          </Typography>
          <Typography variant="footnote" color={colors.textTertiary}>
            ›
          </Typography>
        </TouchableOpacity>
      </Card>
    </Swipeable>
  );
}

interface EditSheetProps {
  visible: boolean;
  household: Household | null;
  onClose: () => void;
  onSave: (name: string) => void;
  onDelete: () => void;
  onLeave: () => void;
  isLoading: boolean;
}

function EditSheet({
  visible,
  household,
  onClose,
  onSave,
  onDelete,
  onLeave,
  isLoading,
}: EditSheetProps) {
  const colors = useAppColors();
  const [name, setName] = useState('');

  React.useEffect(() => {
    if (visible) setName(household?.name ?? '');
  }, [visible, household]);

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a name for this home.');
      return;
    }
    onSave(name.trim());
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="standard"
      title={household ? 'Edit home' : 'New home'}
      showCloseButton
      headerAction={{
        label: household ? 'Save' : 'Create',
        onPress: handleSave,
        loading: isLoading,
        testID: 'property-save-btn',
      }}
    >
      <View style={styles.sheetContent}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
          Home name *
        </Typography>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.textPrimary,
              backgroundColor: colors.backgroundSecondary,
              borderColor: colors.borderColor,
            },
          ]}
          value={name}
          onChangeText={setName}
          testID="property-name-input"
          placeholder="e.g., Home, The cottage"
          placeholderTextColor={colors.textTertiary}
          autoFocus={!household}
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />
        <Typography variant="caption2" color={colors.textTertiary} style={styles.hint}>
          Everyone you invite to this home shares everything in it.
        </Typography>

        {household && household.my_role === 'owner' && (
          <TouchableOpacity
            onPress={() => {
              onClose();
              setTimeout(onDelete, 300);
            }}
            style={[styles.destructiveButton, { borderColor: colors.error }]}
            disabled={isLoading}
          >
            <Typography variant="body" weight="semibold" color={colors.error}>
              Delete home
            </Typography>
          </TouchableOpacity>
        )}

        {household && household.my_role === 'member' && (
          <TouchableOpacity
            onPress={() => {
              onClose();
              setTimeout(onLeave, 300);
            }}
            style={[styles.destructiveButton, { borderColor: colors.error }]}
            disabled={isLoading}
          >
            <Typography variant="body" weight="semibold" color={colors.error}>
              Leave home
            </Typography>
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  );
}

export function HousePropertiesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const colors = useAppColors();
  const { households, currentHousehold, setCurrentHousehold, updateHousehold } =
    useHouseholdStore();

  const isLocalFirst = isHouseLocalFirst();

  /**
   * How many devices actually share the active home.
   *
   * Null until the control plane answers, and null again if it cannot be reached
   * — the card then says nothing about size rather than repeating the server's
   * `member_count`, which is the number that was wrong.
   */
  const [enrolledDevices, setEnrolledDevices] = useState<number | null>(null);

  /** Which home `enrolledDevices` is a count of. */
  const enrolledDevicesFor = useRef<string | null>(null);

  /**
   * Read the ACTIVE home's device roster.
   *
   * The count belongs to ONE home and `propertySubtitle` hangs it on whichever
   * card is active, so it has to move when the active home does — carried across
   * a switch it would state home A's size under home B's name, the same class of
   * wrong number as the server `member_count` this replaced. Hence the home this
   * count is FOR, tracked alongside it: it blanks the number on a move (and only
   * on a move — clearing on every focus would flicker the subtitle back to the
   * bare role each visit) and discards an answer that arrives after the member
   * has already switched away.
   */
  const refreshEnrolledDevices = useCallback(async () => {
    if (!isLocalFirst || !isLocalHouseSessionOpen()) {
      enrolledDevicesFor.current = null;
      setEnrolledDevices(null);
      return;
    }
    const householdId = getLocalHouseLedger().household.id;
    if (enrolledDevicesFor.current !== householdId) {
      enrolledDevicesFor.current = householdId;
      setEnrolledDevices(null);
    }
    try {
      const state = await fetchControlPlaneState(householdId);
      if (enrolledDevicesFor.current !== householdId) return;
      setEnrolledDevices(state.devices.filter((device) => device.status === 'active').length);
    } catch (error) {
      console.warn('[house-properties] could not read the device roster', error);
      if (enrolledDevicesFor.current === householdId) setEnrolledDevices(null);
    }
  }, [isLocalFirst]);

  useFocusEffect(
    useCallback(() => {
      // Under local-first the home list belongs to the ENGINE, not to D1. This
      // publishes the engine's real set: synchronous, and it decrypts nothing,
      // because a cold home's name and role are already in the session registry.
      if (isLocalFirst && isLocalHouseSessionOpen()) syncHouseholdStoreFromLocalLedger();
      void refreshEnrolledDevices();
    }, [isLocalFirst, refreshEnrolledDevices]),
  );

  // Show the most recently created home first — a freshly created one lands at
  // the bottom of a long list otherwise, off-screen on iOS where an automated
  // check cannot reliably scroll a RN ScrollView to reveal it.
  const orderedHouseholds = useMemo(
    () => [...households].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
    [households],
  );

  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const [editingHousehold, setEditingHousehold] = useState<Household | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const closeOtherSwipeables = useCallback((openId: string) => {
    Object.entries(swipeableRefs.current).forEach(([id, ref]) => {
      if (id !== openId) ref?.close();
    });
  }, []);

  /**
   * Open the enrolment hub for the tapped home.
   *
   * The hub mints, lists and approves against whichever home the ENGINE has
   * active. So a tap on a background card has to move the session first, or the
   * member would be handing out an invite to home A while reading home B's name
   * off the row they tapped. Activating is what they meant — they addressed that
   * home.
   *
   * BACK to the hub, not forward to it: this screen is reached FROM Invite &
   * home, so pushing it again would stack a second copy of the screen the member
   * came from. `navigate` is the fallback for entry points that do not come
   * through the hub, where there is nothing to go back to.
   */
  const handleManage = async (household: Household) => {
    if (isLocalFirst && household.id !== currentHousehold?.id) {
      try {
        await activateLocalHouseProperty(household.id);
      } catch (error) {
        Alert.alert(
          'Error',
          memberFacingMessage(error, 'Failed to open that home. Please try again.'),
        );
        return;
      }
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('HouseInvite');
  };

  /**
   * Switching is an ENGINE act, not a store assignment.
   *
   * `activateLocalHouseProperty` hydrates that home's rows (once — a hydrated
   * session keeps them, so switching back and forth is free), moves the on-disk
   * active pointer and emits a whole-ledger change, which is what repaints every
   * House screen and republishes `householdStore`. Assigning `currentHousehold`
   * on its own would leave every domain API called with an id the engine had not
   * activated, and the local facades throw on that mismatch: screens render
   * empty over data that is on disk, decrypted, one id away.
   */
  const handleSwitch = async (household: Household) => {
    if (household.id === currentHousehold?.id) return;
    try {
      if (isLocalFirst) {
        await activateLocalHouseProperty(household.id);
        // `ensureSession` already follows ledger changes and republishes the
        // store, so this is a second belt on the same trousers — deliberately.
        // A badge left on the previous card is the one failure a member reads as
        // "the switch didn't work".
        syncHouseholdStoreFromLocalLedger();
        void refreshEnrolledDevices();
      } else {
        setCurrentHousehold(household);
      }
    } catch (error) {
      Alert.alert('Error', memberFacingMessage(error, 'Failed to switch home. Please try again.'));
    }
  };

  const handleAdd = () => {
    setEditingHousehold(null);
    setIsSheetVisible(true);
  };

  const handleEdit = (household: Household) => {
    setEditingHousehold(household);
    setIsSheetVisible(true);
  };

  const handleSave = async (name: string) => {
    setIsLoading(true);
    try {
      if (editingHousehold) {
        // Rename the home this CARD belongs to, not "the active one":
        // `renameLocalHouseProperty(name)` defaults to the active session, so a
        // rename swiped on a background card would have retitled the home the
        // member is looking at.
        const renamed = await renameLocalHouseProperty(name, editingHousehold.id);
        updateHousehold(renamed.id, renamed);
        if (renamed.id === currentHousehold?.id) setCurrentHousehold(renamed);
        // Best-effort: hand the new name to the control plane so enrolled peers
        // pick it up. Offline is normal here, so a failure must not fail the
        // rename that already landed on disk. Named explicitly, because the
        // renamed home need not be the active one.
        void syncLocalHouseholdToControlPlane(renamed.id).catch(() => undefined);
      } else {
        const created = await createLocalHouseProperty({ displayName: name });
        // Creating deliberately does not activate (they are separate acts in the
        // engine), but a member who just named a home means to be in it, and it
        // is empty until they are — so there is nothing to lose by landing
        // there, and the moved "Active" badge is what says the create worked.
        await activateLocalHouseProperty(created.household.id);
        syncHouseholdStoreFromLocalLedger();
        void refreshEnrolledDevices();
        // Registered with the control plane so its Tier-B endpoints authorise
        // and its peers can find this device. A home nobody shares still needs
        // the row: House's server-backed features authorise against it.
        void syncLocalHouseholdToControlPlane(created.household.id).catch(() => undefined);
      }
      setIsSheetVisible(false);
      setEditingHousehold(null);
    } catch (error) {
      Alert.alert('Error', memberFacingMessage(error, 'Failed to save home. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * The server half of giving up a home: end this account's membership and take
   * every device it holds there off the home's record.
   *
   * Runs BEFORE the local wipe, and the local wipe does not run without it.
   * Leaving purely locally — the phone erases its copy and the person stays on
   * the roster with all their devices listed as trusted — is the opposite of
   * what "leave" promises. Doing it in this order means the worst case is a
   * member who is out server-side and still holds a local copy they can delete
   * again, rather than one who has destroyed their data and is still in the home.
   *
   * A home with no control-plane row was never shared with anybody — there is no
   * membership to end, and the local copy is the whole of it.
   *
   * Returns whether the caller may go on to erase this device's copy.
   */
  const endMembershipOnControlPlane = async (household: Household): Promise<boolean> => {
    if (!(await houseHouseholdIsOnControlPlane(household.id))) return true;
    try {
      await leaveHouseHousehold(household.id);
      return true;
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null
          ? (error as { response?: { status?: number } }).response?.status
          : undefined;
      // Already out — an owner removed this account while the phone was offline.
      // That is not a failed leave; it is one that already happened, and the
      // local copy still has to go.
      if (status === 404) return true;
      if (status === 409) {
        Alert.alert(
          'Make someone else an owner first',
          `You are the last owner of "${household.name}". Open Invite & home, make another member an owner, then leave — otherwise nobody left in the home could invite anyone or approve a device.`,
        );
        return false;
      }
      // Deliberately refuses rather than wiping anyway: erasing the local copy
      // while the membership stands is the exact half-done state this path
      // exists to stop producing.
      Alert.alert(
        'Could not leave',
        'We could not reach your home just now. Nothing has been deleted — try again when you are back online.',
      );
      return false;
    }
  };

  /**
   * Delete (owner) and Leave (member) are the same act under different words:
   * this account walks out of the home and this device erases its copy.
   *
   * `removeLocalHouseProperty` is the ONLY path that clears a home's rows, and it
   * clears nobody else's — there is no server-side home to delete. So the
   * confirmation must not promise that the home goes away "for everyone": a peer
   * that shares it keeps its own ledger, its own key epoch and every op it holds.
   * What it must promise, because it is true and irreversible, is that everything
   * here is gone.
   */
  const handleDelete = (household: Household) => {
    if (households.length <= 1) {
      Alert.alert(LAST_PROPERTY_TITLE, LAST_PROPERTY_MESSAGE);
      return;
    }
    Alert.alert(
      'Delete home',
      `Everything in "${household.name}" — its tasks, spaces, appliances, projects, documents and history — is PERMANENTLY DELETED from this phone and cannot be recovered. If anyone else shares this home you also leave it, and every device you hold there is removed from its record. They keep their own copy.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              if (!(await endMembershipOnControlPlane(household))) return;
              await removeLocalHouseProperty(household.id);
              forgetHouseRoster(household.id);
              // Republish from the engine rather than dropping the row locally:
              // when the removed home was the active one the engine falls back
              // to its own first remaining SESSION, while the store would fall
              // back to its first ROW, and the two need not be the same home. A
              // `currentHousehold` that disagrees with the active session is not
              // a stale label — every local facade throws on a mismatch.
              syncHouseholdStoreFromLocalLedger();
              if (household.id === getActiveHouseholdId()) void refreshEnrolledDevices();
            } catch (error) {
              Alert.alert(
                'Error',
                memberFacingMessage(error, 'Failed to delete home. Please try again.'),
              );
            } finally {
              setIsLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleLeave = (household: Household) => {
    if (households.length <= 1) {
      Alert.alert(LAST_PROPERTY_TITLE, LAST_PROPERTY_MESSAGE);
      return;
    }
    Alert.alert(
      'Leave home',
      // Both halves, because both are irreversible: the membership ends for
      // everyone, and the copy on this phone is destroyed.
      `You leave "${household.name}" and every device you hold there is removed from its record. Everything in it — tasks, spaces, appliances, projects, documents and history — is PERMANENTLY DELETED from this phone and cannot be recovered. You will need a fresh invite to get back in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              if (!(await endMembershipOnControlPlane(household))) return;
              await removeLocalHouseProperty(household.id);
              forgetHouseRoster(household.id);
              syncHouseholdStoreFromLocalLedger();
              if (household.id === getActiveHouseholdId()) void refreshEnrolledDevices();
            } catch (error) {
              Alert.alert(
                'Error',
                memberFacingMessage(error, 'Failed to leave home. Please try again.'),
              );
            } finally {
              setIsLoading(false);
            }
          },
        },
      ],
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Homes"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />
      <SafeAreaView edges={[]} testID="house-properties-screen">
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.subtitleSection}>
            <Typography variant="body" color={colors.textSecondary}>
              Create a home and invite people to share it. Switch between homes anytime — swipe one
              to rename it.
            </Typography>
            {households.length === 0 && (
              <View style={styles.gettingStarted}>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.bullet}>
                  • Everyone in a home shares everything in it
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.bullet}>
                  • Invite people with a QR code or an invite code
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.bullet}>
                  • Switch between homes anytime
                </Typography>
              </View>
            )}
          </View>

          {households.length === 0 ? (
            <Card
              variant="filled"
              style={[styles.emptyState, { backgroundColor: colors.backgroundSecondary }]}
            >
              <Icon name="home" size={48} color={colors.textSecondary} style={styles.emptyIcon} />
              <Typography variant="headline" weight="semibold" style={styles.emptyTitle}>
                No homes yet
              </Typography>
              <Typography variant="body" color={colors.textSecondary} style={styles.emptyText}>
                Create your first home to start sharing it with others
              </Typography>
            </Card>
          ) : (
            <View style={styles.list}>
              {orderedHouseholds.map((household) => (
                <PropertyCard
                  key={household.id}
                  household={household}
                  isActive={household.id === currentHousehold?.id}
                  enrolledDevices={enrolledDevices}
                  onManage={() => {
                    void handleManage(household);
                  }}
                  onSwitch={() => {
                    void handleSwitch(household);
                  }}
                  onEdit={() => handleEdit(household)}
                  swipeableRef={(ref) => {
                    swipeableRefs.current[household.id] = ref;
                  }}
                  onSwipeableOpen={() => closeOtherSwipeables(household.id)}
                />
              ))}
            </View>
          )}

          {/* Below the homes this device HOLDS, because that is the list the
              member came for. It renders nothing at all unless the account owns
              homes this device has no ledger for — the state in which "No homes
              yet" above is a lie. */}
          <HouseOtherHouseholdsCard />
        </ScrollView>

        <FloatingActionButton
          title="Add new home"
          icon="+"
          onPress={handleAdd}
          testID="fab-add-property"
        />
      </SafeAreaView>

      <EditSheet
        visible={isSheetVisible}
        household={editingHousehold}
        onClose={() => {
          setIsSheetVisible(false);
          setEditingHousehold(null);
        }}
        onSave={handleSave}
        onDelete={() => editingHousehold && handleDelete(editingHousehold)}
        onLeave={() => editingHousehold && handleLeave(editingHousehold)}
        isLoading={isLoading}
      />
    </AppBackground>
  );
}

export default HousePropertiesScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingBottom: 100 },
  subtitleSection: { marginBottom: 24 },
  gettingStarted: { marginTop: 16, gap: 8 },
  bullet: { lineHeight: 20 },
  list: { marginBottom: 24 },
  card: { marginBottom: 12, padding: 16, borderRadius: 12 },
  cardContent: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardInfo: { flex: 1, gap: 2 },
  activeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  switchButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
    gap: 8,
  },
  manageLabel: { flex: 1 },
  emptyState: { padding: 32, alignItems: 'center', marginBottom: 24, borderRadius: 12 },
  emptyIcon: { marginBottom: 16 },
  emptyTitle: { marginBottom: 8, textAlign: 'center' },
  emptyText: { textAlign: 'center' },
  sheetContent: { paddingHorizontal: 4, paddingBottom: 24 },
  label: { marginBottom: 8 },
  input: {
    ...scaledFont('buttonLabel'),
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  hint: { marginTop: 8 },
  destructiveButton: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
  },
  swipeActionsContainer: { flexDirection: 'row', marginBottom: 12 },
  swipeAction: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    marginLeft: 8,
  },
});
