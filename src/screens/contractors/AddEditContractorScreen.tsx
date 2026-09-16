import { useNavigation, useRoute, RouteProp } from "expo-router/react-navigation";
import React, { useState, useMemo, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, TextInput, Alert, Image } from 'react-native';

import {
  contractorsApi,
  type ContractorSpecialty,
  SPECIALTY_INFO,
  CONTRACTOR_SPECIALTIES,
} from '@api/contractors';
import { AttachmentSourceSheet, AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography, FloatingActionButton, StarPicker, FavoriteStar } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useRequireAIAccess } from '@hooks/useRequireAIAccess';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';
import { getContractorCategoryIcon } from '@utils/categoryIcons';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type RouteParams = {
  AddEditContractor: {
    contractorId?: string;
    contractor?: {
      id: string;
      name: string;
      company_name: string | null;
      specialty: ContractorSpecialty;
      phone: string | null;
      email: string | null;
      website: string | null;
      address: string | null;
      notes: string | null;
      rating: number | null;
      is_favorite: boolean;
    };
  };
};

function SpecialtyPicker({
  specialty,
  onChange,
}: {
  specialty: ContractorSpecialty;
  onChange: (specialty: ContractorSpecialty) => void;
}) {
  const colors = useAppColors();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.specialtyScrollContent}
      style={[screenScrollViewStyle.scroll, styles.specialtyScrollView]}
    >
      {CONTRACTOR_SPECIALTIES.map((s) => {
        const info = SPECIALTY_INFO[s];
        const isSelected = specialty === s;
        return (
          <TouchableOpacity
            key={s}
            style={[
              styles.specialtyOption,
              {
                backgroundColor: isSelected ? info.color + '20' : colors.backgroundSecondary,
                borderColor: isSelected ? info.color : colors.borderColor,
              },
            ]}
            onPress={() => onChange(s)}
          >
            <Icon name={getContractorCategoryIcon(s)} size={20} color={info.color} />
            <Typography
              variant="caption1"
              weight={isSelected ? 'semibold' : 'regular'}
              style={{ color: isSelected ? info.color : colors.textPrimary, marginTop: 4 }}
              numberOfLines={1}
            >
              {info.label}
            </Typography>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export function AddEditContractorScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'AddEditContractor'>>();
  const { currentHousehold } = useHouseholdStore();
  const { ensureCanUseAI } = useRequireAIAccess();

  const existingContractor = route.params?.contractor;
  const isEditing = !!existingContractor;

  // Store initial values for change detection
  const initialValues = useMemo(() => ({
    name: existingContractor?.name || '',
    companyName: existingContractor?.company_name || '',
    specialty: (existingContractor?.specialty || 'general') as ContractorSpecialty,
    phone: existingContractor?.phone || '',
    email: existingContractor?.email || '',
    website: existingContractor?.website || '',
    address: existingContractor?.address || '',
    notes: existingContractor?.notes || '',
    rating: existingContractor?.rating || null,
    isFavorite: existingContractor?.is_favorite || false,
    photoUri: null as string | null,
  }), [existingContractor]);

  const [name, setName] = useState(initialValues.name);
  const [companyName, setCompanyName] = useState(initialValues.companyName);
  const [specialty, setSpecialty] = useState<ContractorSpecialty>(
    initialValues.specialty as ContractorSpecialty
  );
  const [phone, setPhone] = useState(initialValues.phone);
  const [email, setEmail] = useState(initialValues.email);
  const [website, setWebsite] = useState(initialValues.website);
  const [address, setAddress] = useState(initialValues.address);
  const [notes, setNotes] = useState(initialValues.notes);
  const [rating, setRating] = useState<number | null>(initialValues.rating);
  const [isFavorite, setIsFavorite] = useState(initialValues.isFavorite);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(initialValues.photoUri);

  // Track changes against the loaded contractor (or an empty draft when new) so
  // Save stays disabled until there is something to persist, and a successful
  // save shows a toast then closes. See [[useUnsavedChanges]].
  const { isDirty, isSaving, save, confirmDiscard } = useUnsavedChanges({
    values: { name, companyName, specialty, phone, email, website, address, notes, rating, isFavorite, photoUri },
    baseline: initialValues,
    successMessage: isEditing ? 'Changes saved' : 'Contractor added',
    onClose: () => navigation.goBack(),
    onSave: async () => {
      if (!currentHousehold?.id) return false;

      if (!name.trim()) {
        Alert.alert('Error', 'Please enter a name for the contractor');
        return false;
      }

      const data = {
        name: name.trim(),
        company_name: companyName.trim() || undefined,
        specialty,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        website: website.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        rating: rating || undefined,
        is_favorite: isFavorite,
      };

      if (isEditing && existingContractor) {
        await contractorsApi.update(currentHousehold.id, existingContractor.id, data);
      } else {
        await contractorsApi.create(currentHousehold.id, data);
      }
      return;
    },
  });

  // Handle back navigation with unsaved changes warning
  const handleBack = useCallback(() => {
    confirmDiscard();
  }, [confirmDiscard]);

  /**
   * The contractor's photo, from the app's one photo sheet.
   *
   * The `ActionSheetIOS` menu offered Take Photo and Choose from Library and
   * nothing else — so a logo a member had saved from the contractor's website
   * into Files, or one kept in the household's Drive, could not be used.
   * Remove keeps its place under the four tiles.
   */
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const showImagePickerOptions = () => setPhotoSheetOpen(true);

  const handleAILookup = async () => {
    if (!ensureCanUseAI()) return;
    if (!currentHousehold?.id) return;
    
    const searchTerm = companyName.trim() || name.trim();
    if (!searchTerm) {
      Alert.alert('Error', 'Please enter a contractor or company name first');
      return;
    }

    setIsLookingUp(true);
    setLookupMessage(null);

    try {
      const result = await contractorsApi.aiLookup(currentHousehold.id, searchTerm);

      if (!result.success || !result.contractor) {
        setLookupMessage(result.error || 'Cannot find information about this company');
        return;
      }

      // Fill in the form with the found data
      const data = result.contractor;
      
      if (data.name && !name.trim()) setName(data.name);
      if (data.company_name) setCompanyName(data.company_name);
      if (data.phone) setPhone(data.phone);
      if (data.email) setEmail(data.email);
      if (data.website) setWebsite(data.website);
      if (data.address) setAddress(data.address);
      
      // Build notes from additional info
      const additionalNotes: string[] = [];
      if (data.business_type) additionalNotes.push(`Business Type: ${data.business_type}`);
      if (data.license_number) additionalNotes.push(`License: ${data.license_number}`);
      if (data.years_in_business) additionalNotes.push(`Years in Business: ${data.years_in_business}`);
      if (data.service_area) additionalNotes.push(`Service Area: ${data.service_area}`);
      if (data.business_hours) additionalNotes.push(`Hours: ${data.business_hours}`);
      if (data.notes) additionalNotes.push(data.notes);
      
      if (additionalNotes.length > 0) {
        const existingNotes = notes.trim();
        const newNotes = additionalNotes.join('\n');
        setNotes(existingNotes ? `${existingNotes}\n\n${newNotes}` : newNotes);
      }

      // Set specialty if valid
      if (data.specialty && CONTRACTOR_SPECIALTIES.includes(data.specialty as ContractorSpecialty)) {
        setSpecialty(data.specialty as ContractorSpecialty);
      }

      const confidence = result.confidence ? Math.round(result.confidence * 100) : 0;
      setLookupMessage(`Found! (${confidence}% confidence)`);
    } catch (err) {
      console.error('AI lookup error:', err);
      setLookupMessage('Failed to lookup contractor. Please try again.');
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Contractor',
      'Are you sure you want to delete this contractor? This will also delete all visit history and documents.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!currentHousehold?.id || !existingContractor?.id) return;
            setIsDeleting(true);
            try {
              await contractorsApi.delete(currentHousehold.id, existingContractor.id);
              // Go back twice to return to the contractors list
              navigation.goBack();
              navigation.goBack();
            } catch (err) {
              Alert.alert('Error', 'Failed to delete contractor');
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.backgroundSecondary,
      color: colors.textPrimary,
      borderColor: colors.borderColor,
    },
  ];

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="contractor-form-screen">
      <ScreenHeader
        title={isEditing ? 'Edit Contractor' : 'Add Contractor'}
        showBackButton
        onBackPress={handleBack}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          <TouchableOpacity
            onPress={() => setIsFavorite(!isFavorite)}
            style={styles.favoriteHeaderButton}
            activeOpacity={0.7}
          >
            <FavoriteStar isFavorite={isFavorite} interactive={false} size={28} />
          </TouchableOpacity>
        }
      />
      <ScrollView
        {...keyboardDismissScrollProps}
        style={[screenScrollViewStyle.scroll, styles.container, { backgroundColor: colors.backgroundMain }]}
        contentContainerStyle={styles.content}
      >
        {/* Photo */}
        <View style={styles.photoSection}>
          <TouchableOpacity
            style={styles.photoWrapper}
            onPress={showImagePickerOptions}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.photoContainer,
                { 
                  backgroundColor: colors.groupedListBackground,
                  borderColor: colors.borderColor,
                },
              ]}
            >
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photo} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Icon
                    name="camera"
                    size={34}
                    color={colors.textSecondary}
                    style={{ opacity: 0.4 }}
                  />
                  <Typography variant="caption1" color="secondary" style={{ marginTop: 8 }}>
                    Add Photo
                  </Typography>
                </View>
              )}
            </View>
            <View style={[styles.photoBadge, { backgroundColor: theme.pastel.teal }]}>
              <Icon name={photoUri ? 'pencil' : 'add'} size={14} color={colors.white} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Name */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Name *
          </Typography>
          <TextInput
            testID="contractor-form-name"
            style={inputStyle}
            value={name}
            onChangeText={(text) => {
              setName(text);
              setLookupMessage(null);
            }}
            placeholder="Contractor name"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* Company Name */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Company Name
          </Typography>
          <TextInput
            style={inputStyle}
            value={companyName}
            onChangeText={(text) => {
              setCompanyName(text);
              setLookupMessage(null);
            }}
            placeholder="Company name (optional)"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* AI Find and Fill Button - shows when there's a name or company name */}
        {(name.trim() || companyName.trim()) && !isEditing && (
          <View style={styles.aiLookupContainer}>
            <TouchableOpacity
              style={[
                styles.aiLookupButton,
                {
                  backgroundColor: theme.pastel.purple + '20',
                  borderColor: theme.pastel.purple,
                },
              ]}
              onPress={handleAILookup}
              disabled={isLookingUp}
              testID="contractor-form-ai-lookup"
            >
              {isLookingUp ? (
                <ActivityIndicator size="small" color={theme.pastel.purple} />
              ) : (
                <Typography variant="body" weight="semibold" style={{ color: theme.pastel.purple }}>
                  Find and Fill
                </Typography>
              )}
            </TouchableOpacity>
            {lookupMessage && (
              <Typography
                variant="caption1"
                style={{
                  color: lookupMessage.includes('Found') ? theme.pastel.green : colors.textSecondary,
                  marginTop: 8,
                  textAlign: 'center',
                }}
              >
                {lookupMessage}
              </Typography>
            )}
          </View>
        )}

        {/* Specialty */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Specialty *
          </Typography>
          <SpecialtyPicker specialty={specialty} onChange={setSpecialty} />
        </View>

        {/* Phone */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Phone
          </Typography>
          <TextInput
            style={inputStyle}
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone number"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
          />
        </View>

        {/* Email */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Email
          </Typography>
          <TextInput
            style={inputStyle}
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Website */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Website
          </Typography>
          <TextInput
            style={inputStyle}
            value={website}
            onChangeText={setWebsite}
            placeholder="https://example.com"
            placeholderTextColor={colors.textSecondary}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Address */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Address
          </Typography>
          <TextInput
            style={[inputStyle, styles.multilineInput]}
            value={address}
            onChangeText={setAddress}
            placeholder="Business address"
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={2}
          />
        </View>

        {/* Notes */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Notes
          </Typography>
          <TextInput
            style={[inputStyle, styles.multilineInput, { minHeight: 100 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Additional notes about this contractor..."
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={4}
          />
        </View>

        {/* Rating */}
        <View style={styles.field}>
          <Typography variant="subheadline" weight="semibold" style={styles.label}>
            Rating
          </Typography>
          <StarPicker rating={rating} onChange={setRating} />
        </View>

        {/* Delete Button - only shown when editing */}
        {isEditing && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDelete}
            disabled={isDeleting}
            testID="contractor-form-delete"
          >
            <Typography variant="body" color={colors.error}>
              {isDeleting ? 'Deleting...' : 'Delete Contractor'}
            </Typography>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Floating Save Button - always rendered, disabled until there are changes */}
      {/* Shared floating pill — same component as every other floating CTA in
          the app (replaces a hardcoded, non-theme-aware white scrim). */}
      <FloatingActionButton
        testID="contractor-form-save"
        title={isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Contractor'}
        variant="teal"
        onPress={save}
        disabled={isSaving || isDeleting || !isDirty || !name.trim()}
        bottomOffset={80}
      />
    </SafeAreaView>

    <AttachmentSourceSheet
      visible={photoSheetOpen}
      onClose={() => setPhotoSheetOpen(false)}
      title="Contractor photo"
      testIDPrefix="contractor-photo"
      rememberScope="contractor-photo"
      pickerOptions={{
        cropping: true,
        cropperToolbarTitle: 'Crop Contractor Photo',
        compressImageQuality: 0.8,
        mediaType: 'photo',
        freeStyleCropEnabled: false,
      }}
      onPicked={([picked]) => {
        if (picked) setPhotoUri(picked.uri);
      }}
      {...(photoUri
        ? {
            extraAction: {
              label: 'Remove photo',
              destructive: true,
              onPress: () => setPhotoUri(null),
              testID: 'contractor-photo-remove',
            },
          }
        : {})}
    />
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  header: {
    marginBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginRight: -8,
  },
  favoriteHeaderButton: {
    padding: 12,
  },
  photoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  photoWrapper: {
    position: 'relative',
  },
  photoContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderStyle: 'dashed',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photo: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'rgba(0,0,0,1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    marginBottom: 8,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...scaledFont('body'),
    borderWidth: 1,
  },
  multilineInput: {
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  specialtyScrollView: {
    marginHorizontal: -16,
  },
  specialtyScrollContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  specialtyOption: {
    width: 100,
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  starPicker: {
    flexDirection: 'row',
    gap: 8,
  },
  starButton: {
    padding: 4,
  },
  deleteButton: {
    alignItems: 'center',
    padding: 16,
    marginTop: 24,
    marginBottom: 80,
  },
  aiLookupContainer: {
    marginBottom: 20,
    alignItems: 'center',
  },
  aiLookupButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 150,
    alignItems: 'center',
  },
});
