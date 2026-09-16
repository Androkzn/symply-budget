import { useFocusEffect } from "expo-router/react-navigation";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Animated, ScrollView, StyleSheet, TextInput, TouchableOpacity, View, Image, Platform, NativeModules } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import { householdsApi, type Household } from '@api/households';
import { AppBackground, SafeAreaView, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, screenScrollViewStyle } from '@components/common';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { HousePropertyPhoto } from '@components/house-v2/HousePropertyPhoto';
import { Card, Typography, FloatingActionButton } from '@components/ui';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import type { SettingsStackScreenProps } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

// Infer an image content type from a local file URI (defaults to JPEG, which
// is what the crop picker emits).
function getContentTypeFromUri(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase().split('?')[0];
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    default:
      return 'image/jpeg';
  }
}

// US States
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

// Canadian Provinces
const CA_PROVINCES = [
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
];

// Get default country from device locale
const getDefaultCountry = (): 'CA' | 'US' => {
  // Use React Native's built-in locale detection
  const locale = Platform.OS === 'ios'
    ? NativeModules.SettingsManager?.settings?.AppleLocale ||
      NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
    : NativeModules.I18nManager?.localeIdentifier;
  
  // Check if locale contains Canada region code
  const isCanada = locale?.includes('_CA') || locale?.includes('-CA');
  return isCanada ? 'CA' : 'US';
};

interface HouseholdItemProps {
  household: Household;
  /** Position in the list, used for a stable testID E2E flows can tap. */
  index: number;
  isActive: boolean;
  /** Open the tabbed property detail (assessment, tax, members, insights). */
  onOpen: () => void;
  onEdit: () => void;
  swipeableRef: (ref: Swipeable | null) => void;
  onSwipeableOpen: () => void;
}

function HouseholdItem({ household, index, isActive, onOpen, onEdit, swipeableRef, onSwipeableOpen }: HouseholdItemProps) {
  const colors = useAppColors();

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const translateX = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [0, 80],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View
        style={[
          styles.swipeActionsContainer,
          {
            transform: [{ translateX }],
          },
        ]}
      >
        <TouchableOpacity
          onPress={onEdit}
          style={[styles.swipeAction, { backgroundColor: colors.primary }]}
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
          styles.householdItem,
          {
            backgroundColor: isActive ? colors.primary + '20' : colors.backgroundSecondary,
            borderColor: isActive ? colors.primary : 'transparent',
            borderWidth: isActive ? 2 : 0,
          },
        ]}
      >
        {/* Tapping anywhere on the card opens the property's detail screen,
            where members / assessment / property tax / insights live.
            The positional testID is what E2E flows tap — before it existed they
            reached this card by screen coordinate. */}
        <TouchableOpacity
          testID={`household-card-${index}`}
          style={styles.householdContent}
          onPress={onOpen}
          activeOpacity={0.7}
        >
          {/* Property Photo — URL, H6 descriptor or nothing; see the component. */}
          <HousePropertyPhoto
            household={household}
            width={HOUSEHOLD_CARD_PHOTO_SIZE}
            borderRadius={12}
            iconSize={28}
            style={styles.householdPhoto}
            testID={`household-photo-${index}`}
          />
          <View style={styles.householdInfo}>
            <View style={styles.householdNameRow}>
              <Typography variant="body" weight="semibold">
                {household.name}
              </Typography>
              {isActive && (
                <View style={[styles.activeBadge, { backgroundColor: colors.primary + '22' }]}>
                  <Typography variant="caption2" weight="semibold" color={colors.primary}>
                    Active
                  </Typography>
                </View>
              )}
            </View>
            {household.address_line1 && (
              <Typography variant="footnote" color={colors.textSecondary}>
                {household.address_line1}
              </Typography>
            )}
            {household.city && household.state_province && (
              <Typography variant="footnote" color={colors.textSecondary}>
                {household.city}, {household.state_province}
              </Typography>
            )}
            <Typography variant="caption2" color={colors.textTertiary}>
              {household.member_count} {household.member_count === 1 ? 'member' : 'members'} • {household.my_role}
            </Typography>
          </View>
          <Typography variant="title3" color={colors.textTertiary}>
            ›
          </Typography>
        </TouchableOpacity>
      </Card>
    </Swipeable>
  );
}

interface AddEditModalProps {
  visible: boolean;
  household: Household | null;
  onClose: () => void;
  onSave: (data: HouseholdFormData) => void;
  onDelete: () => void;
  onLeave: () => void;
  isLoading: boolean;
}

interface HouseholdFormData {
  name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: 'CA' | 'US';
  description?: string;
  /** Local path after pick; `null` = removed; `undefined` = unchanged (edit only). */
  photo_uri?: string | null;
}

const PROPERTY_PHOTO_WIDTH = 1200;
const PROPERTY_PHOTO_HEIGHT = 900; // 4:3 standard photo ratio
/** The square thumbnail on a property card — matches `styles.householdPhoto`. */
const HOUSEHOLD_CARD_PHOTO_SIZE = 64;

function AddEditModal({ visible, household, onClose, onSave, onDelete, onLeave, isLoading }: AddEditModalProps) {
  const colors = useAppColors();
  const [showStatePicker, setShowStatePicker] = useState(false);
  const [formData, setFormData] = useState<HouseholdFormData>({
    name: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state_province: '',
    postal_code: '',
    country: getDefaultCountry(),
    description: '',
    photo_uri: undefined,
  });

  // Update form data when household changes (for editing)
  useEffect(() => {
    if (visible) {
      setFormData({
        name: household?.name || '',
        address_line1: household?.address_line1 || '',
        address_line2: household?.address_line2 || '',
        city: household?.city || '',
        state_province: household?.state_province || '',
        postal_code: household?.postal_code || '',
        country: household?.country || getDefaultCountry(),
        description: '',
        photo_uri: undefined,
      });
    }
  }, [visible, household]);

  const handleSave = () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter a property name');
      return;
    }
    onSave(formData);
  };

  /**
   * A picked file, or the saved URL — the two things an `<Image>` can take.
   *
   * Deliberately does NOT fall back to a local-first property's photo: those
   * have no URL at all (the bytes are sealed, `photo_blob` is what opens them),
   * and `photo_url` on such a row is either null or signed from the synthetic
   * `lf-blob/` key and therefore dead. `HousePropertyPhoto` renders that case.
   */
  const displayPhotoUri =
    formData.photo_uri === undefined
      ? household?.photo_url
      : formData.photo_uri ?? undefined;

  /**
   * The sealed photo currently on the property, when there is one and the member
   * has not replaced or cleared it in this sheet.
   *
   * `photo_uri === undefined` means "untouched" — a picked file (`string`) or a
   * removal (`null`) both take precedence, exactly as they do for the URL above.
   */
  const savedBlobPhoto =
    formData.photo_uri === undefined && household?.photo_blob ? household : undefined;

  /**
   * Measured, because `HouseBlobImage` needs real numbers and this banner is
   * `width: '100%'` with a 4:3 aspect ratio. One layout pass, and the fallback
   * icon renders in the meantime.
   */
  const [photoBoxWidth, setPhotoBoxWidth] = useState(0);

  /**
   * The property photo's four sources, from the shared hook.
   *
   * Library, camera and Files were three hand-written pickers here; Drive was
   * missing, which for a property photo is the common case — the listing shot
   * from the estate agent arrives by email and gets filed in the household's
   * Drive folder, never in anyone's camera roll.
   */
  const { sourceHandlers, drivePicker, driveOpen } = useAttachmentSources({
    rememberScope: 'property-photo',
    pickerOptions: {
      width: PROPERTY_PHOTO_WIDTH,
      height: PROPERTY_PHOTO_HEIGHT,
      cropping: true,
      cropperToolbarTitle: 'Crop Property Photo',
      compressImageQuality: 0.8,
      mediaType: 'photo',
      freeStyleCropEnabled: false,
    },
    onPicked: ([picked]) => {
      if (picked) setFormData({ ...formData, photo_uri: picked.uri });
    },
  });

  const handlePhotoPress = () => {
    Alert.alert('Add Property Photo', 'Choose how to add a photo', [
      { text: 'Take Photo', onPress: sourceHandlers.onCamera },
      { text: 'Choose from Library', onPress: sourceHandlers.onGallery },
      { text: 'Choose from Files', onPress: sourceHandlers.onFile },
      { text: 'Choose from Drive', onPress: sourceHandlers.onDrive },
      // `savedBlobPhoto` as well as the URL: a local-first property's photo has
      // no URL, so keying only on that hid Remove Photo for exactly the members
      // whose photo this device sealed.
      ...(displayPhotoUri || savedBlobPhoto ? [{ text: 'Remove Photo', onPress: () => setFormData({ ...formData, photo_uri: null }), style: 'destructive' as const }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const handleCountryChange = (country: 'CA' | 'US') => {
    setFormData({ ...formData, country, state_province: '' });
  };

  const stateProvinceOptions = formData.country === 'CA' ? CA_PROVINCES : US_STATES;

  return (
    <>
      <BottomSheet
        // Hidden while Drive browses — one full-screen surface at a time.
        visible={visible && !driveOpen}
        onClose={onClose}
        height="tall"
        title={household ? 'Edit Property' : 'Add Property'}
        showCloseButton
        headerAction={{
          label: household ? 'Save' : 'Add',
          onPress: handleSave,
          loading: isLoading,
          testID: 'property-sheet-save',
        }}
      >
        <ScrollView
        style={screenScrollViewStyle.scroll}
        showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.sheetContent}
          {...keyboardDismissScrollProps}>
          {/* Photo Upload */}
          <TouchableOpacity
            style={[
              styles.photoUpload,
              {
                borderColor: colors.borderColor,
                borderStyle: displayPhotoUri || savedBlobPhoto ? 'solid' : 'dashed',
              },
            ]}
            onPress={handlePhotoPress}
            activeOpacity={0.7}
            onLayout={(event) => setPhotoBoxWidth(event.nativeEvent.layout.width)}
          >
            {displayPhotoUri ? (
              <Image source={{ uri: displayPhotoUri }} style={styles.photoPreview} />
            ) : savedBlobPhoto && photoBoxWidth > 0 ? (
              // A photo that came from another member, or one this device sealed
              // on a previous save. `always`, not the metered default: the member
              // has deliberately opened the editor for this property, and a
              // "tap to download" placeholder where their own photo should be
              // reads as the photo having been lost.
              <HousePropertyPhoto
                household={savedBlobPhoto}
                width={photoBoxWidth}
                height={(photoBoxWidth * 3) / 4}
                borderRadius={12}
                fetchPolicy="always"
                testID="household-form-photo"
              />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Icon name="camera" size={32} color={colors.textSecondary} />
                <Typography variant="footnote" color={colors.textSecondary}>
                  Add Property Photo
                </Typography>
              </View>
            )}
          </TouchableOpacity>

          {/* Property Name */}
          <View style={styles.formField}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
              Property Name *
            </Typography>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="e.g., Main Home, Beach House"
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          {/* Country Selection with Flags */}
          <View style={styles.formField}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
              Country
            </Typography>
            <View style={styles.countryButtonsFlag}>
              <TouchableOpacity
                onPress={() => handleCountryChange('US')}
                style={[
                  styles.countryButtonFlag,
                  {
                    backgroundColor: formData.country === 'US' ? colors.primary + '20' : colors.backgroundSecondary,
                    borderColor: formData.country === 'US' ? colors.primary : colors.borderColor,
                  },
                ]}
              >
                <Typography variant="title3">🇺🇸</Typography>
                <Typography
                  variant="footnote"
                  weight={formData.country === 'US' ? 'semibold' : 'regular'}
                  color={formData.country === 'US' ? colors.primary : colors.textPrimary}
                >
                  United States
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleCountryChange('CA')}
                style={[
                  styles.countryButtonFlag,
                  {
                    backgroundColor: formData.country === 'CA' ? colors.primary + '20' : colors.backgroundSecondary,
                    borderColor: formData.country === 'CA' ? colors.primary : colors.borderColor,
                  },
                ]}
              >
                <Typography variant="title3">🇨🇦</Typography>
                <Typography
                  variant="footnote"
                  weight={formData.country === 'CA' ? 'semibold' : 'regular'}
                  color={formData.country === 'CA' ? colors.primary : colors.textPrimary}
                >
                  Canada
                </Typography>
              </TouchableOpacity>
            </View>
          </View>

          {/* Address Line 1 */}
          <View style={styles.formField}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
              Street Address
            </Typography>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
              value={formData.address_line1}
              onChangeText={(text) => setFormData({ ...formData, address_line1: text })}
              placeholder="123 Main Street"
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          {/* Address Line 2 */}
          <View style={styles.formField}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
              Unit / Apt / Suite
            </Typography>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
              value={formData.address_line2}
              onChangeText={(text) => setFormData({ ...formData, address_line2: text })}
              placeholder="Apt 4B (optional)"
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          {/* City and State/Province */}
          <View style={styles.formRow}>
            <View style={[styles.formField, { flex: 1.2 }]}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                City
              </Typography>
              <TextInput
                style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                value={formData.city}
                onChangeText={(text) => setFormData({ ...formData, city: text })}
                placeholder="City"
                placeholderTextColor={colors.textTertiary}
              />
            </View>

            <View style={[styles.formField, { flex: 0.8 }]}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                {formData.country === 'CA' ? 'Province' : 'State'}
              </Typography>
              <TouchableOpacity
                style={[styles.input, styles.pickerButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
                onPress={() => setShowStatePicker(true)}
              >
                <Typography
                  variant="body"
                  color={formData.state_province ? colors.textPrimary : colors.textTertiary}
                >
                  {formData.state_province || 'Select'}
                </Typography>
                <Typography variant="caption2" color={colors.textSecondary}>▼</Typography>
              </TouchableOpacity>
            </View>
          </View>

          {/* Postal Code — one field for both countries, so it keeps the DEFAULT
              keyboard. A US ZIP is digits, but a Canadian postal code is half
              letters ("K1A 0B1") and a numeric keypad would lock it out. */}
          <View style={styles.formField}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
              {formData.country === 'CA' ? 'Postal Code' : 'ZIP Code'}
            </Typography>
            <TextInput
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
              value={formData.postal_code}
              onChangeText={(text) => setFormData({ ...formData, postal_code: text })}
              placeholder={formData.country === 'CA' ? 'A1A 1A1' : '12345'}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
            />
          </View>

          {/* Description */}
          <View style={styles.formField}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
              Description
            </Typography>
            <TextInput
              style={[styles.input, styles.textArea, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}
              value={formData.description}
              onChangeText={(text) => setFormData({ ...formData, description: text })}
              placeholder="Add notes about this property (optional)"
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Delete Button - only show when editing and user is owner */}
          {household && (household as any).my_role === 'owner' && (
            <TouchableOpacity
              onPress={() => {
                onClose();
                setTimeout(() => onDelete(), 300);
              }}
              style={[styles.deleteButton, { borderColor: colors.error }]}
              disabled={isLoading}
            >
              <Typography variant="body" weight="semibold" color={colors.error}>
                Delete Property
              </Typography>
            </TouchableOpacity>
          )}

          {/* Leave Button - only show when editing and user is a member */}
          {household && (household as any).my_role === 'member' && (
            <TouchableOpacity
              onPress={() => {
                onClose();
                setTimeout(() => onLeave(), 300);
              }}
              style={[styles.deleteButton, { borderColor: colors.error }]}
              disabled={isLoading}
            >
              <Typography variant="body" weight="semibold" color={colors.error}>
                Leave Property
              </Typography>
            </TouchableOpacity>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </BottomSheet>

      {/* State/Province Picker Bottom Sheet */}
      <BottomSheet
        visible={showStatePicker}
        onClose={() => setShowStatePicker(false)}
        height="tall"
        title={formData.country === 'CA' ? 'Select Province' : 'Select State'}
        showCloseButton
      >
        <ScrollView
        style={screenScrollViewStyle.scroll}
        showsVerticalScrollIndicator={false}>
          <View style={styles.statePickerGrid}>
            {stateProvinceOptions.map((option) => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.statePickerItem,
                  {
                    backgroundColor: formData.state_province === option ? colors.primary + '20' : colors.backgroundSecondary,
                    borderColor: formData.state_province === option ? colors.primary : colors.borderColor,
                  },
                ]}
                onPress={() => {
                  setFormData({ ...formData, state_province: option });
                  setShowStatePicker(false);
                }}
              >
                <Typography
                  variant="body"
                  weight={formData.state_province === option ? 'semibold' : 'regular'}
                  color={formData.state_province === option ? colors.primary : colors.textPrimary}
                >
                  {option}
                </Typography>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </BottomSheet>
      {drivePicker}
    </>
  );
}

export function HouseholdManagementScreen({ navigation, route }: SettingsStackScreenProps<'HouseholdManagement'>) {
  // The sibling components in this file (`HouseholdItem`, `AddEditModal`) each
  // call this hook; the screen itself never did, while its body reads
  // `colors.*` in eight places. Every render threw
  // `ReferenceError: Property 'colors' doesn't exist`, so the screen red-boxed
  // rather than rendering — Settings → Household Management was unreachable.
  const colors = useAppColors();
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

  // Refetch households when screen is focused so floor_plan_count and other counts are up to date
  useFocusEffect(
    useCallback(() => {
      fetchHouseholds();
    }, [fetchHouseholds])
  );

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingHousehold, setEditingHousehold] = useState<Household | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  const closeOtherSwipeables = useCallback((openId: string) => {
    Object.entries(swipeableRefs.current).forEach(([id, ref]) => {
      if (id !== openId) {
        ref?.close();
      }
    });
  }, []);

  const handleOpenDetail = (household: Household) => {
    navigation.navigate('PropertyDetail', { householdId: household.id });
  };

  const handleAddHousehold = () => {
    setEditingHousehold(null);
    setIsModalVisible(true);
  };

  const handleEditHousehold = useCallback((household: Household) => {
    setEditingHousehold(household);
    setIsModalVisible(true);
  }, []);

  // The PropertyDetail "Edit details" action deep-links back here with the
  // property to edit — auto-open the edit sheet, then clear the param so it
  // doesn't re-fire on the next focus.
  useEffect(() => {
    const editId = route.params?.editHouseholdId;
    if (!editId) return;
    const target = households.find((h) => h.id === editId);
    if (target) {
      handleEditHousehold(target);
      navigation.setParams({ editHouseholdId: undefined });
    }
  }, [route.params?.editHouseholdId, households, handleEditHousehold, navigation]);

  const handleDeleteHousehold = (household: Household) => {
    Alert.alert(
      'Delete Property',
      `Are you sure you want to delete "${household.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              await householdsApi.delete(household.id);
              removeHousehold(household.id);

              // If deleted household was active, switch to first available
              if (household.id === currentHousehold?.id && households.length > 1) {
                const nextHousehold = households.find((h) => h.id !== household.id);
                if (nextHousehold) {
                  setCurrentHousehold(nextHousehold);
                  await refreshActivePropertyData();
                }
              }

              Alert.alert('Success', 'Property deleted successfully');
            } catch (error) {
              console.error('Error deleting household:', error);
              Alert.alert(
                'Error',
                error instanceof Error
                  ? error.message
                  : 'Failed to delete property. Please try again.'
              );
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleLeaveHousehold = (household: Household) => {
    Alert.alert(
      'Leave Property',
      `Are you sure you want to leave "${household.name}"? You'll lose access until you're invited back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              await householdsApi.leave(household.id);
              removeHousehold(household.id);

              // If we left the active household, switch to another one.
              if (household.id === currentHousehold?.id) {
                const nextHousehold = households.find((h) => h.id !== household.id);
                if (nextHousehold) {
                  setCurrentHousehold(nextHousehold);
                  await refreshActivePropertyData();
                }
              }

              Alert.alert('Success', 'You have left the property');
            } catch (error) {
              console.error('Error leaving household:', error);
              Alert.alert(
                'Error',
                error instanceof Error
                  ? error.message
                  : 'Failed to leave property. Please try again.'
              );
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleSaveHousehold = async (data: HouseholdFormData) => {
    const TAG = '[handleSaveHousehold]';
    setIsLoading(true);
    try {
      const newPhotoUri = typeof data.photo_uri === 'string' ? data.photo_uri : undefined;
      const photoRemoved = data.photo_uri === null;
      console.log(`${TAG} start`, {
        editing: !!editingHousehold,
        editingId: editingHousehold?.id,
        hasNewPhoto: !!newPhotoUri,
        photoRemoved,
        newPhotoUri,
      });

      if (editingHousehold) {
        const response = await householdsApi.update(editingHousehold.id, data);
        updateHousehold(editingHousehold.id, response.household);
        console.log(`${TAG} update ok`, { id: response.household.id });

        if (newPhotoUri) {
          console.log(`${TAG} uploading photo for`, editingHousehold.id);
          const up = await householdsApi.uploadPhoto(
            editingHousehold.id,
            newPhotoUri,
            getContentTypeFromUri(newPhotoUri)
          );
          console.log(`${TAG} uploadPhoto result`, up);
        } else if (photoRemoved) {
          console.log(`${TAG} deleting photo for`, editingHousehold.id);
          await householdsApi.deletePhoto(editingHousehold.id);
        } else {
          console.log(`${TAG} no photo changes`);
        }
        // Refetch so the derived photo_url (and counts) reflect the upload.
        await fetchHouseholds();
        const refreshed = useHouseholdStore
          .getState()
          .households.find((h) => h.id === editingHousehold.id);
        console.log(`${TAG} after refetch photo_url=`, refreshed?.photo_url);
        Alert.alert('Success', 'Property updated successfully');
      } else {
        const response = await householdsApi.create(data);
        addHousehold(response.household);
        console.log(`${TAG} create ok`, { id: response.household.id });

        if (newPhotoUri) {
          console.log(`${TAG} uploading photo for`, response.household.id);
          const up = await householdsApi.uploadPhoto(
            response.household.id,
            newPhotoUri,
            getContentTypeFromUri(newPhotoUri)
          );
          console.log(`${TAG} uploadPhoto result`, up);
        }

        // If this is the first household, make it active
        if (households.length === 0) {
          setCurrentHousehold(response.household);
          await refreshActivePropertyData();
        }

        await fetchHouseholds();
        Alert.alert('Success', 'Property added successfully');
      }
      setIsModalVisible(false);
      setEditingHousehold(null);
    } catch (error: any) {
      console.error(`${TAG} Error saving household:`, {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
        error,
      });
      Alert.alert(
        'Error',
        error instanceof Error
          ? error.message
          : 'Failed to save property. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppBackground opacity={0.5}>
      <View testID="household-management-screen" style={{ flex: 1 }}>
      <ScreenHeader
        title="My Properties"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <SafeAreaView edges={[]}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          testID="household-management-scroll"
        >
          <View style={styles.subtitleSection}>
            <Typography variant="body" color={colors.textSecondary}>
              Manage your properties and switch between them
            </Typography>
            {households.length === 0 && (
              <View style={styles.gettingStartedInfo}>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.infoText}>
                  • Track maintenance tasks, contractors, and expenses
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.infoText}>
                  • Upload floor plans and manage spaces
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.infoText}>
                  • Monitor utility bills and home warranties
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.infoText}>
                  • Share access with family members
                </Typography>
              </View>
            )}
          </View>

          {households.length === 0 ? (
            <Card
              variant="filled"
              style={[styles.emptyState, { backgroundColor: colors.backgroundSecondary }]}
            >
              <Icon
                name="home"
                size={48}
                color={colors.textSecondary}
                style={styles.emptyIcon}
              />
              <Typography variant="headline" weight="semibold" style={styles.emptyTitle}>
                No properties yet
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.emptyText}
              >
                Add your first property to get started with managing your home
              </Typography>
            </Card>
          ) : (
            <View style={styles.householdsList}>
              {households.map((household, index) => (
                <HouseholdItem
                  key={household.id}
                  household={household}
                  index={index}
                  isActive={household.id === currentHousehold?.id}
                  onOpen={() => handleOpenDetail(household)}
                  onEdit={() => handleEditHousehold(household)}
                  swipeableRef={(ref) => { swipeableRefs.current[household.id] = ref; }}
                  onSwipeableOpen={() => closeOtherSwipeables(household.id)}
                />
              ))}
            </View>
          )}

          <ScreenScrollEnd testID={screenScrollEndTestId('household-management-screen')} />
        </ScrollView>

        {/* Floating Add Button */}
        <FloatingActionButton
          title="Add New Property"
          icon="+"
          onPress={handleAddHousehold}
          testID="household-add-property"
        />
      </SafeAreaView>

      <AddEditModal
        visible={isModalVisible}
        household={editingHousehold}
        onClose={() => {
          setIsModalVisible(false);
          setEditingHousehold(null);
        }}
        onSave={handleSaveHousehold}
        onDelete={() => editingHousehold && handleDeleteHousehold(editingHousehold)}
        onLeave={() => editingHousehold && handleLeaveHousehold(editingHousehold)}
        isLoading={isLoading}
      />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 100,
  },
  subtitleSection: {
    marginBottom: 24,
  },
  gettingStartedInfo: {
    marginTop: 16,
    gap: 8,
  },
  infoText: {
    lineHeight: 20,
  },
  householdsList: {
    marginBottom: 24,
  },
  householdItem: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
  },
  householdContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  householdPhoto: {
    width: 64,
    height: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  householdPhotoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  householdInfo: {
    flex: 1,
  },
  householdNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  householdActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
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
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    marginBottom: 24,
  },
  formField: {
    marginBottom: 16,
  },
  formFieldHalf: {
    flex: 1,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
  },
  label: {
    marginBottom: 8,
  },
  input: {
    ...scaledFont('buttonLabel'),
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  countryButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  countryButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  countryButtonsFlag: {
    flexDirection: 'row',
    gap: 12,
  },
  countryButtonFlag: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 2,
    gap: 8,
  },
  sheetContent: {
    paddingHorizontal: 4,
    paddingBottom: 40,
  },
  photoUpload: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    overflow: 'hidden',
    marginBottom: 20,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  pickerButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  textArea: {
    height: 90,
    paddingTop: 12,
  },
  deleteButton: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
  },
  statePickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 40,
  },
  statePickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 70,
    alignItems: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  modalButton: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 200,
  },
  loadingText: {
    marginTop: 16,
  },
  swipeActionsContainer: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  swipeAction: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    marginLeft: 8,
  },
});
