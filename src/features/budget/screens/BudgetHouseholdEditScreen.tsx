import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { householdsApi, type Household } from '@api/households';
import {
  AppBackground,
  AttachmentSourceSheet,
  SafeAreaView,
  ScreenHeader,
  ScreenScrollEnd,
  screenScrollEndTestId,
  HeaderActionButton,
} from '@components/common';
import {
  AddressFields,
  EMPTY_ADDRESS,
  isAddressEmpty,
  type AddressFieldsValue,
} from '@components/common/AddressFields';
import { Card, GradientButton, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import { BudgetHouseholdMembersCard } from '@features/budget/components/BudgetHouseholdMembersCard';
import {
  budgetHouseholdIsOnControlPlane,
  leaveBudgetHousehold,
} from '@features/budget/local/controlPlaneClient';
import {
  activateLocalBudgetHousehold,
  createLocalBudgetHousehold,
  removeLocalBudgetHousehold,
  updateLocalHousehold,
  type LocalHouseholdEdits,
} from '@features/budget/local/engine';
import { syncHouseholdStoreFromLocalLedger } from '@features/budget/local/ensureSession';
import { BudgetLocalUnknownHouseholdError } from '@features/budget/local/errors';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import {
  deleteHouseholdImageLocal,
  resolveHouseholdImageUri,
  saveHouseholdImageLocal,
} from '@features/budget/local/householdMedia';
import type { SettingsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

/**
 * One household, everything about it — the page a household card opens.
 *
 * It replaces a swipe action. The household list used to hide "Edit" behind a
 * left-swipe on the card, which put the only way to rename a household in a
 * gesture that is invisible to the eye, to a screen reader and to a UI test, and
 * which the list's own intro copy had to explain in prose ("swipe one to rename
 * it"). Everything a household HAS now lives on a screen a tap opens: its
 * picture, its name, an address if it has one, the people in it, and the two
 * irreversible exits.
 *
 * The same screen creates one. A household created from a name-only sheet and
 * then edited here for its photo and address is two forms for one act; asking
 * once means a household can arrive complete, and it means there is exactly one
 * place in the app where a household's fields are laid out.
 *
 * Two backends behind it, as everywhere in Budget's household surface: under
 * local-first (BR-016) a household is a SESSION whose record lives in the sealed
 * identity blob on this device, so saving is `updateLocalHousehold` and the
 * photo's bytes stay in `documentDirectory`; without the flag it is the shared
 * households API and its D1 rows, where the photo is an R2 upload.
 */

const PHOTO_WIDTH = 1200;
const PHOTO_HEIGHT = 900;

/** The engine's refusal, matched on its message — it throws a plain `Error`. */
function isLastHouseholdRefusal(error: unknown): boolean {
  return error instanceof Error && error.message.includes('cannot remove the last household');
}

const LAST_HOUSEHOLD_TITLE = 'This is your only household';
const LAST_HOUSEHOLD_MESSAGE =
  'Symply Budget always keeps one household open, so this one cannot be removed. Create another household first, then remove this one.';

function memberFacingMessage(error: unknown, fallback: string): string {
  if (isLastHouseholdRefusal(error)) return LAST_HOUSEHOLD_MESSAGE;
  if (error instanceof BudgetLocalUnknownHouseholdError) {
    return 'This device no longer holds that household. Reopen the household list to refresh it.';
  }
  return error instanceof Error ? error.message : fallback;
}

/** The address fields of a stored household, as this form holds them. */
function addressFromHousehold(household: Household | null): AddressFieldsValue {
  if (!household) return EMPTY_ADDRESS;
  return {
    addressLine1: household.address_line1 ?? '',
    addressLine2: household.address_line2 ?? '',
    city: household.city ?? '',
    stateProvince: household.state_province ?? '',
    postalCode: household.postal_code ?? '',
    country: household.country === 'US' ? 'US' : 'CA',
  };
}

/**
 * The address, back in the record's shape.
 *
 * Empty fields are written as `null`, not `''`: a cleared address must be
 * indistinguishable from one that was never entered, or "no address" renders as
 * a household with a blank line under its name. `country` goes with them — a
 * country on its own is not an address, and keeping it would leave a household
 * that says "Canada" and nothing else.
 */
function addressToRecord(address: AddressFieldsValue): LocalHouseholdEdits {
  const blank = isAddressEmpty(address);
  const trimmed = (text: string) => text.trim() || null;
  return {
    address_line1: trimmed(address.addressLine1),
    address_line2: trimmed(address.addressLine2),
    city: trimmed(address.city),
    state_province: trimmed(address.stateProvince),
    postal_code: trimmed(address.postalCode),
    country: blank ? null : address.country,
  };
}

type EditRoute = RouteProp<SettingsStackParamList, 'BudgetHouseholdEdit'>;

export function BudgetHouseholdEditScreen() {
  const colors = useAppColors();
  const route = useRoute<EditRoute>();
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const { refreshActivePropertyData } = useData();
  const {
    households,
    currentHousehold,
    setCurrentHousehold,
    addHousehold,
    updateHousehold,
    removeHousehold,
    fetchHouseholds,
  } = useHouseholdStore();

  const isLocalFirst = isBudgetLocalFirst();
  const householdId = route.params?.householdId;

  /**
   * The household being edited, or null when this is a create.
   *
   * Read from the store rather than passed through route params: the record
   * changes underneath this screen (a sync lands, the roster republishes) and a
   * params copy would be a snapshot taken at push time. A named household that
   * is not in the store means it was removed while this screen was open —
   * handled below as an empty state rather than a crash.
   */
  const household = useMemo(
    () => households.find((entry) => entry.id === householdId) ?? null,
    [households, householdId],
  );
  const isCreate = !householdId;
  const missing = !isCreate && !household;
  const isActive = !!household && household.id === currentHousehold?.id;

  const [name, setName] = useState(() => household?.name ?? '');
  const [address, setAddress] = useState<AddressFieldsValue>(() =>
    addressFromHousehold(household),
  );
  /**
   * `undefined` means untouched, `null` means removed, a string is a newly
   * picked file. The three are genuinely different saves — leave the stored
   * photo alone, clear it, or replace it — and collapsing "untouched" into
   * "removed" is how an unrelated rename silently deletes a picture.
   */
  const [pickedPhoto, setPickedPhoto] = useState<string | null | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const storedPhotoUri = household
    ? resolveHouseholdImageUri(household.photo_key) ?? household.photo_url
    : null;
  const photoUri = pickedPhoto === undefined ? storedPhotoUri : pickedPhoto;

  /**
   * The household photo, from the app's one photo sheet.
   *
   * The `Alert` offered Take Photo and Choose from Library. A household photo
   * is exactly the kind of image that arrives from someone else — a listing
   * shot, a family picture in a shared Drive folder — so limiting it to what is
   * already on THIS device was the wrong two-thirds of the list.
   */
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const handlePhotoPress = useCallback(() => setPhotoSheetOpen(true), []);

  /**
   * The photo half of a local-first save.
   *
   * Copies the picked file into device storage and returns the record patch;
   * the old file is deleted only AFTER the record stops pointing at it, so a
   * failed copy leaves the household with the photo it already had rather than
   * with a key naming bytes that are gone.
   */
  const applyLocalPhoto = useCallback(async (): Promise<LocalHouseholdEdits> => {
    if (pickedPhoto === undefined) return {};
    if (pickedPhoto === null) return { photo_key: null, photo_url: null };
    const key = await saveHouseholdImageLocal(pickedPhoto);
    // `photo_url` mirrors the local file so anything rendering a household by
    // its URL — the switcher, a card in the list — needs no knowledge of keys.
    return { photo_key: key, photo_url: resolveHouseholdImageUri(key) };
  }, [pickedPhoto]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter a name for this household.');
      return;
    }
    setIsSaving(true);
    try {
      if (isLocalFirst) {
        const previousKey = household?.photo_key ?? null;
        const photoEdits = await applyLocalPhoto();
        const edits: LocalHouseholdEdits = {
          name: trimmedName,
          ...addressToRecord(address),
          ...photoEdits,
        };

        if (household) {
          const saved = await updateLocalHousehold(edits, household.id);
          updateHousehold(saved.id, saved);
          if (saved.id === currentHousehold?.id) setCurrentHousehold(saved);
          // The replaced file goes only once the record no longer names it.
          if (pickedPhoto !== undefined && previousKey && previousKey !== saved.photo_key) {
            void deleteHouseholdImageLocal(previousKey);
          }
          // Best-effort: hand the new name to the control plane so enrolled
          // peers pick it up. Offline is normal here, so a failure must not fail
          // the edit that already landed on disk.
          void import('@features/budget/local/controlPlaneClient')
            .then((module) => module.syncLocalHouseholdToControlPlane(saved.id))
            .catch(() => undefined);
        } else {
          // Created with everything the member entered, in the one op that mints
          // the household — see `createLocalBudgetHousehold`. Creating does not
          // activate (they are separate acts in the engine), but a member who
          // just named a household means to be in it, and it is empty until they
          // are, so landing there is what says the create worked.
          const created = await createLocalBudgetHousehold({
            displayName: trimmedName,
            details: edits,
          });
          await activateLocalBudgetHousehold(created.household.id);
          syncHouseholdStoreFromLocalLedger();
          await refreshActivePropertyData();
        }
        syncHouseholdStoreFromLocalLedger();
      } else if (household) {
        const fields = {
          name: trimmedName,
          address_line1: address.addressLine1.trim() || undefined,
          address_line2: address.addressLine2.trim() || undefined,
          city: address.city.trim() || undefined,
          state_province: address.stateProvince.trim() || undefined,
          postal_code: address.postalCode.trim() || undefined,
          country: isAddressEmpty(address) ? undefined : address.country,
        };
        const response = await householdsApi.update(household.id, fields);
        // The photo is a separate endpoint on the remote path — R2 upload first,
        // then the row carries the key it returns.
        if (pickedPhoto) {
          await householdsApi.uploadPhoto(household.id, pickedPhoto);
        } else if (pickedPhoto === null) {
          await householdsApi.deletePhoto(household.id);
        }
        updateHousehold(household.id, response.household);
        await fetchHouseholds();
      } else {
        const response = await householdsApi.create({
          name: trimmedName,
          address_line1: address.addressLine1.trim() || undefined,
          address_line2: address.addressLine2.trim() || undefined,
          city: address.city.trim() || undefined,
          state_province: address.stateProvince.trim() || undefined,
          postal_code: address.postalCode.trim() || undefined,
          country: isAddressEmpty(address) ? undefined : address.country,
        });
        if (pickedPhoto) {
          await householdsApi.uploadPhoto(response.household.id, pickedPhoto);
        }
        addHousehold(response.household);
        if (households.length === 0) {
          setCurrentHousehold(response.household);
          await refreshActivePropertyData();
        }
        await fetchHouseholds();
      }
      navigation.goBack();
    } catch (error) {
      Alert.alert(
        'Error',
        memberFacingMessage(error, 'Failed to save this household. Please try again.'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Switching is an ENGINE act under local-first, not a store assignment: it
   * hydrates that household's rows, moves the on-disk active pointer and emits a
   * whole-ledger change. Assigning `currentHousehold` alone would leave every
   * domain API called with an id the engine had not activated, and the local
   * facades throw on that mismatch.
   */
  const handleActivate = async () => {
    if (!household || isActive) return;
    try {
      if (isLocalFirst) {
        await activateLocalBudgetHousehold(household.id);
        syncHouseholdStoreFromLocalLedger();
      } else {
        setCurrentHousehold(household);
      }
      await refreshActivePropertyData();
    } catch (error) {
      Alert.alert(
        'Error',
        memberFacingMessage(error, 'Failed to switch to that household. Please try again.'),
      );
    }
  };

  /**
   * The server half of giving up a household: end this account's membership and
   * take every device it holds there off the household's record. Runs BEFORE the
   * local wipe, and the local wipe does not run without it — see the household
   * list screen, where this logic was born, for why that order is the safe one.
   */
  const endMembershipOnControlPlane = async (target: Household): Promise<boolean> => {
    if (!(await budgetHouseholdIsOnControlPlane(target.id))) return true;
    try {
      await leaveBudgetHousehold(target.id);
      return true;
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null
          ? (error as { response?: { status?: number } }).response?.status
          : undefined;
      if (status === 404) return true;
      if (status === 409) {
        Alert.alert(
          'Make someone else an owner first',
          `You are the last owner of "${target.name}". Make another member an owner, then leave — otherwise nobody left in the household could invite anyone or approve a device.`,
        );
        return false;
      }
      Alert.alert(
        'Could not leave',
        'We could not reach your household just now. Nothing has been deleted — try again when you are back online.',
      );
      return false;
    }
  };

  /**
   * Delete (owner) and Leave (member) are the same act under different words:
   * this account walks out of the household and this device erases its copy.
   * There is no server-side budget to delete — a peer keeps its own ledger — so
   * the confirmation must not promise the budget goes away for everyone.
   */
  const confirmExit = (mode: 'delete' | 'leave') => {
    if (!household) return;
    if (isLocalFirst && households.length <= 1) {
      Alert.alert(LAST_HOUSEHOLD_TITLE, LAST_HOUSEHOLD_MESSAGE);
      return;
    }
    const title = mode === 'delete' ? 'Delete Household' : 'Leave Household';
    const message =
      mode === 'delete'
        ? isLocalFirst
          ? `All data in "${household.name}" — its budget, planning, spending, savings and history — is PERMANENTLY DELETED from this phone and cannot be recovered. If anyone else shares this household you also leave it, and every device you hold there is removed from its record. They keep their own copy.`
          : `Are you sure you want to delete "${household.name}"? This shared budget will be removed for everyone. This cannot be undone.`
        : isLocalFirst
          ? `You leave "${household.name}" and every device you hold there is removed from its record. All data in it — budget, planning, spending, savings and history — is PERMANENTLY DELETED from this phone and cannot be recovered. You will need a fresh invite to get back in.`
          : `Are you sure you want to leave "${household.name}"? You'll lose access to this shared budget until you're invited back.`;

    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: mode === 'delete' ? 'Delete' : 'Leave',
        style: 'destructive',
        onPress: async () => {
          setIsSaving(true);
          try {
            if (isLocalFirst) {
              if (!(await endMembershipOnControlPlane(household))) return;
              await removeLocalBudgetHousehold(household.id);
              // Republish from the engine rather than dropping the row locally:
              // when the removed household was the active one the engine falls
              // back to its own first remaining SESSION, and a `currentHousehold`
              // that disagrees with the active session renders every local
              // domain screen empty over data that is on disk.
              syncHouseholdStoreFromLocalLedger();
              void deleteHouseholdImageLocal(household.photo_key);
              if (household.id === currentHousehold?.id) await refreshActivePropertyData();
            } else {
              if (mode === 'delete') await householdsApi.delete(household.id);
              else await householdsApi.leave(household.id);
              removeHousehold(household.id);
              if (household.id === currentHousehold?.id) {
                const next = households.find((entry) => entry.id !== household.id);
                if (next) {
                  setCurrentHousehold(next);
                  await refreshActivePropertyData();
                }
              }
            }
            navigation.goBack();
          } catch (error) {
            Alert.alert(
              'Error',
              memberFacingMessage(error, `Failed to ${mode} this household. Please try again.`),
            );
          } finally {
            setIsSaving(false);
          }
        },
      },
    ]);
  };

  if (missing) {
    return (
      <AppBackground opacity={0.5}>
        <ScreenHeader
          title="Household"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />
        <SafeAreaView edges={[]} testID="budget-household-edit-screen">
          <View style={styles.missing}>
            <Typography variant="body" color={colors.textSecondary} align="center">
              This household is no longer on this device.
            </Typography>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title={isCreate ? 'New Household' : 'Household'}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        rightElement={
          <HeaderActionButton
            label={isCreate ? 'Create' : 'Save'}
            onPress={() => void handleSave()}
            disabled={isSaving || !name.trim()}
            testID="household-save-btn"
          />
        }
      />
      <SafeAreaView edges={[]} testID="budget-household-edit-screen">
        <ScrollView
          {...keyboardDismissScrollProps}
          style={styles.flex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* The picture first: it is the only field that is a tap rather than
              typing, and it is what makes a list of households scannable. */}
          <TouchableOpacity
            style={[
              styles.photo,
              { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
            ]}
            onPress={handlePhotoPress}
            activeOpacity={0.8}
            accessibilityRole="button"
            /*
             * Labelled ONLY when there is a picture, because an explicit
             * `accessibilityLabel` REPLACES the label a container merges from
             * its children rather than adding to it. With a photo the tile's
             * children are one `Image` and there is nothing to merge, so a
             * label is the only thing standing between a screen reader and an
             * unnamed button. Empty, the tile already says "Add a photo
             * (optional)" in visible text — and a label saying something
             * ALMOST the same ("Add a household photo") would leave the words
             * a screen reader hears and the words a UI test matches
             * disagreeing, with nothing on screen to show which is which.
             */
            accessibilityLabel={photoUri ? 'Change household photo' : undefined}
            testID="household-photo-picker"
          >
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photoImage} resizeMode="cover" />
            ) : (
              <View style={styles.photoEmpty}>
                <Icon name="camera" size={IconSize.xl} color={colors.textTertiary} />
                <Typography variant="footnote" color={colors.textSecondary}>
                  Add a photo (optional)
                </Typography>
              </View>
            )}
          </TouchableOpacity>

          <TextInput
            label="Household name"
            placeholder="e.g., Family, Roommates"
            value={name}
            onChangeText={setName}
            autoFocus={isCreate}
            returnKeyType="done"
            testID="household-name-input"
          />
          <Typography variant="caption2" color={colors.textTertiary} style={styles.hint}>
            Everyone you invite to this household shares the same budget.
          </Typography>

          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            ADDRESS (OPTIONAL)
          </Typography>
          <AddressFields
            value={address}
            onChange={setAddress}
            testIDPrefix="household-address"
          />

          {/* Members, on the same screen as the name, because "who is in this?"
              and "which budget is this?" are one question about one household —
              they used to be answered two navigation trees apart. */}
          {!isCreate && (
            <>
              <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
                MEMBERS
              </Typography>
              {isActive ? (
                <>
                  <BudgetHouseholdMembersCard />
                  <TouchableOpacity
                    style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
                    onPress={() => navigation.navigate('BudgetInvite')}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    /* No explicit label: it would REPLACE the one this row
                       merges from its own text, so a screen reader would hear
                       "Manage members and invites" while the screen — and any
                       text selector — says "Invite someone, or approve a
                       device". The visible sentence is the better label. */
                    testID={`household-manage-members-${household?.id ?? ''}`}
                  >
                    <Icon name="person-add" size={IconSize.md} color={colors.primary} />
                    <Typography variant="body" style={styles.rowLabel}>
                      Invite someone, or approve a device
                    </Typography>
                    <Icon
                      name="chevron-forward"
                      forceIonicons
                      size={IconSize.md}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </>
              ) : (
                // The roster, the invite flow and every approval act on
                // whichever household the ENGINE has active — they take no
                // household argument. So rather than show one household's
                // people under another's name, this says what has to happen
                // first and offers to do it.
                <Card variant="filled" style={styles.inactiveCard}>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    Switch to this household to see who is in it and invite people.
                  </Typography>
                  <GradientButton
                    title="Switch to this household"
                    variant="teal"
                    size="md"
                    onPress={() => void handleActivate()}
                    fullWidth
                    testID="household-activate-btn"
                  />
                </Card>
              )}
            </>
          )}

          {!isCreate && household && (
            <>
              <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
                DANGER ZONE
              </Typography>
              <TouchableOpacity
                onPress={() => confirmExit(household.my_role === 'owner' ? 'delete' : 'leave')}
                style={[styles.destructive, { borderColor: colors.error }]}
                disabled={isSaving}
                accessibilityRole="button"
                testID="household-destructive-btn"
              >
                <Typography variant="body" weight="semibold" color={colors.error}>
                  {household.my_role === 'owner' ? 'Delete Household' : 'Leave Household'}
                </Typography>
              </TouchableOpacity>
            </>
          )}

          {isSaving && (
            <ActivityIndicator style={styles.saving} color={colors.primary} testID="household-saving" />
          )}
          <ScreenScrollEnd testID={screenScrollEndTestId('budget-household-edit-screen')} />
        </ScrollView>
      </SafeAreaView>

      <AttachmentSourceSheet
        visible={photoSheetOpen}
        onClose={() => setPhotoSheetOpen(false)}
        title="Household photo"
        testIDPrefix="budget-household-photo"
        rememberScope="household-photo"
        pickerOptions={{
          width: PHOTO_WIDTH,
          height: PHOTO_HEIGHT,
          cropping: true,
          cropperToolbarTitle: 'Crop Household Photo',
          compressImageQuality: 0.8,
          mediaType: 'photo',
        }}
        onPicked={([picked]) => {
          if (picked) setPickedPhoto(picked.uri);
        }}
        {...(photoUri
          ? {
              extraAction: {
                label: 'Remove photo',
                destructive: true,
                onPress: () => setPickedPhoto(null),
                testID: 'budget-household-photo-remove',
              },
            }
          : {})}
      />
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance + 48,
    gap: Spacing.sm,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  photo: {
    height: 160,
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoEmpty: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  hint: {
    marginTop: -Spacing.xs,
    marginBottom: Spacing.sm,
  },
  groupLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
  },
  rowLabel: { flex: 1 },
  inactiveCard: {
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    gap: Spacing.base,
  },
  destructive: {
    paddingVertical: 14,
    borderRadius: CornerRadius.lg,
    borderWidth: 2,
    alignItems: 'center',
  },
  saving: {
    marginTop: Spacing.base,
  },
});
