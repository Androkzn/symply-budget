import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from "expo-router/react-navigation";
import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, ScrollView, Image, TouchableOpacity, Animated } from 'react-native';

import { gardenPlansApi, type GardenPlanType } from '@api/garden-plans';
import { AppBackground, ScreenHeader } from '@components/common';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { AdaptiveContainer } from '@components/layout';
import { Typography, FloatingActionButton } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { TextInput } from '@components/ui/TextInput';
import { useTheme } from '@contexts/ThemeContext';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { GardeningStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useGardenPlanStore } from '@stores/gardenPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

const PLAN_TYPE_LABELS: Record<GardenPlanType, string> = {
  front_yard: 'Front yard',
  back_yard: 'Back yard',
  garden: 'Garden',
  bed: 'Garden bed',
  other_outdoor: 'Other',
};

/** The picked plan, in the shape the upload call reads it back out in. */
type SelectedGardenPlanFile = {
  uri: string;
  filename: string;
  size: number;
  mime: string;
  path: string;
};

/** What a yard plan may be: a photo, a scan, or a surveyor's PDF. */
const GARDEN_PLAN_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/pdf',
];

export function GardenPlanUploadScreen() {
  // Typed rather than bare `useNavigation()`: this screen now pushes
  // `GardenPlanMapWizard` with params, and an untyped navigator resolves
  // `navigate` to `never`, which fails at the call site rather than here.
  const navigation =
    useNavigation<NativeStackNavigationProp<GardeningStackParamList, 'GardenPlanUpload'>>();
  const route = useRoute<RouteProp<GardeningStackParamList, 'GardenPlanUpload'>>();
  const { isDark } = useTheme();
  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();
  const { content: contentPadding } = useLayoutPadding();
  const { setUploadProgress, addGardenPlan } = useGardenPlanStore();

  const [planType, setPlanType] = useState<GardenPlanType>(
    route.params?.defaultPlanType ?? 'front_yard'
  );
  const [label, setLabel] = useState<string>(PLAN_TYPE_LABELS[planType]);
  const [selectedFile, setSelectedFile] =
    useState<SelectedGardenPlanFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressValue, setUploadProgressValue] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.02, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [fadeAnim, slideAnim, pulseAnim]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: uploadProgressValue,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [uploadProgressValue, progressAnim]);

  /**
   * Where a yard plan comes from — all four sources, from the shared hook.
   *
   * The three chips below were three hand-written pickers with three different
   * error messages, and Drive was missing entirely: a household that keeps its
   * survey PDF in Drive had to download it to the device first. The chips keep
   * this screen's own styling; only the behaviour behind them is now shared.
   */
  const { sourceHandlers, drivePicker } = useAttachmentSources({
    rememberScope: 'garden-plan',
    mimeTypes: GARDEN_PLAN_MIME_TYPES,
    pickerOptions: {
      cropping: true,
      cropperToolbarTitle: 'Crop yard plan',
      compressImageQuality: 1,
      mediaType: 'photo',
      freeStyleCropEnabled: true,
    },
    onPicked: ([picked]) => {
      if (!picked) return;
      setSelectedFile({
        uri: picked.uri,
        filename: picked.name || 'yard-plan.jpg',
        size: picked.size || 0,
        mime: picked.mime || 'image/jpeg',
        path: picked.uri,
      });
    },
  });

  const handleUpload = async () => {
    if (!currentHousehold || !selectedFile) return;
    try {
      setUploading(true);
      setUploadProgressValue(0);

      const uploadData = await gardenPlansApi.getUploadUrl(currentHousehold.id, {
        filename: selectedFile.filename || 'yard-plan.jpg',
        file_size: selectedFile.size || 1000000,
        content_type: (selectedFile.mime || 'image/jpeg') as
          | 'application/pdf'
          | 'image/jpeg'
          | 'image/png',
        plan_type: planType,
        label: label || undefined,
      });

      setUploadProgressValue(20);

      const fileBlob = await fetch(selectedFile.uri || selectedFile.path).then((r) => r.blob());
      await gardenPlansApi.uploadFile(uploadData.upload_url, fileBlob, (progress) => {
        setUploadProgress(progress);
        setUploadProgressValue(20 + progress * 0.6);
      });

      setUploadProgressValue(85);

      const confirmed = await gardenPlansApi.confirmUpload(
        currentHousehold.id,
        uploadData.garden_plan_id,
        { plan_type: planType, label: label || undefined }
      );

      setUploadProgressValue(100);
      addGardenPlan(confirmed.garden_plan);
      showToast('success', 'Yard plan saved');
      navigation.goBack();
    } catch (error) {
      console.error('Upload failed:', error);
      showToast('error', 'Failed to upload yard plan');
    } finally {
      setUploading(false);
      setUploadProgressValue(0);
    }
  };

  const removeSelectedFile = () => setSelectedFile(null);
  const canUpload = selectedFile && !uploading;

  const renderUploadArea = () => {
    if (selectedFile) {
      return (
        <View style={styles.previewContainer}>
          <Image source={{ uri: selectedFile.uri }} style={styles.previewImage} resizeMode="cover" />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.previewOverlay}>
            <View style={styles.previewInfo}>
              <View style={styles.previewTextContainer}>
                <Icon name="checkmark-circle" size={20} color={colors.primary} />
                <Typography
                  variant="caption1"
                  color={colors.white}
                  style={styles.previewFileName}
                  numberOfLines={1}
                >
                  {selectedFile.filename || 'Image'}
                </Typography>
              </View>
              <TouchableOpacity
                style={styles.removeButton}
                onPress={removeSelectedFile}
                activeOpacity={0.7}
              >
                <Icon name="close-circle" size={28} color={colors.error} />
              </TouchableOpacity>
            </View>
          </LinearGradient>
          <View style={styles.previewActions}>
            <TouchableOpacity
              style={[styles.previewActionButton, { backgroundColor: 'rgba(255,255,255,0.95)' }]}
              onPress={sourceHandlers.onGallery}
              activeOpacity={0.8}
            >
              <Icon name="images" size={20} color={colors.primary} />
              <Typography
                variant="caption1"
                weight="medium"
                color={colors.textPrimary}
                style={{ marginLeft: 6 }}
              >
                Change
              </Typography>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        {/* The map route is offered FIRST and as the primary action.

            Two reasons, and the second is the load-bearing one. It produces a
            better plan — real measurements, real areas, a boundary you can pin
            tasks inside — where a photo produces a picture. And under
            local-first it is the only route that works at all: the upload path
            below ends at `getUploadUrl`, which throws for every local-first
            household because there is no bucket to presign into. See
            `GardenPlanMapWizardScreen` for the full account. */}
        <TouchableOpacity
          style={[
            styles.mapCard,
            {
              backgroundColor: isDark ? 'rgba(78, 205, 196, 0.16)' : 'rgba(78, 205, 196, 0.12)',
              borderColor: colors.primary,
            },
          ]}
          onPress={() =>
            navigation.navigate('GardenPlanMapWizard', {
              defaultPlanType: planType,
              label: label || null,
            })
          }
          activeOpacity={0.85}
          testID="garden-plan-source-map"
        >
          <View style={[styles.mapCardIcon, { backgroundColor: colors.primary }]}>
            <Icon name="map" size={24} color={colors.white} />
          </View>
          <View style={styles.mapCardText}>
            <Typography variant="body" weight="semibold" color={colors.textPrimary}>
              Draw on the map
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              Trace your lot on satellite imagery, mark the front and back yard, then drop
              in the shed, pool and trees.
            </Typography>
          </View>
          <Icon name="chevron-forward" size={20} color={colors.primary} />
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.borderColor }]} />
          <Typography variant="caption2" color={colors.textSecondary} style={styles.dividerLabel}>
            or use a file
          </Typography>
          <View style={[styles.dividerLine, { backgroundColor: colors.borderColor }]} />
        </View>

        <TouchableOpacity
          style={[
            styles.uploadDropZone,
            {
              backgroundColor: isDark ? 'rgba(78, 205, 196, 0.08)' : 'rgba(78, 205, 196, 0.06)',
              borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
            },
          ]}
          onPress={sourceHandlers.onGallery}
          activeOpacity={0.8}
        >
          <View
            style={[
              styles.uploadIconContainer,
              {
                backgroundColor: isDark ? 'rgba(78, 205, 196, 0.2)' : 'rgba(78, 205, 196, 0.15)',
              },
            ]}
          >
            <Icon name="leaf-outline" size={40} color={colors.primary} />
          </View>
          <Typography
            variant="body"
            weight="semibold"
            style={[styles.uploadTitle, { color: colors.textPrimary }]}
          >
            Add yard or garden plan
          </Typography>
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            style={styles.uploadSubtitle}
          >
            Use a site photo, aerial, or hand sketch to pin watering, mowing, and repairs
          </Typography>
          <View style={styles.uploadOptionsRow}>
            <TouchableOpacity
              style={[
                styles.uploadOptionChip,
                {
                  backgroundColor: isDark
                    ? 'rgba(78, 205, 196, 0.2)'
                    : 'rgba(255, 255, 255, 0.9)',
                  borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
                },
              ]}
              onPress={sourceHandlers.onGallery}
              activeOpacity={0.7}
            >
              <Icon name="images-outline" size={18} color={colors.primary} />
              <Typography
                variant="caption1"
                weight="semibold"
                color={colors.primary}
                style={{ marginLeft: 6 }}
              >
                Gallery
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.uploadOptionChip,
                {
                  backgroundColor: isDark
                    ? 'rgba(78, 205, 196, 0.2)'
                    : 'rgba(255, 255, 255, 0.9)',
                  borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
                },
              ]}
              onPress={sourceHandlers.onCamera}
              activeOpacity={0.7}
              testID="garden-plan-source-camera"
            >
              <Icon name="camera-outline" size={18} color={colors.primary} />
              <Typography
                variant="caption1"
                weight="semibold"
                color={colors.primary}
                style={{ marginLeft: 6 }}
              >
                Camera
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.uploadOptionChip,
                {
                  backgroundColor: isDark
                    ? 'rgba(78, 205, 196, 0.2)'
                    : 'rgba(255, 255, 255, 0.9)',
                  borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
                },
              ]}
              onPress={sourceHandlers.onFile}
              activeOpacity={0.7}
              testID="garden-plan-source-file"
            >
              <Icon name="folder-outline" size={18} color={colors.primary} />
              <Typography
                variant="caption1"
                weight="semibold"
                color={colors.primary}
                style={{ marginLeft: 6 }}
              >
                Files
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.uploadOptionChip,
                {
                  backgroundColor: isDark
                    ? 'rgba(78, 205, 196, 0.2)'
                    : 'rgba(255, 255, 255, 0.9)',
                  borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
                },
              ]}
              onPress={sourceHandlers.onDrive}
              activeOpacity={0.7}
              testID="garden-plan-source-drive"
            >
              <Icon name="cloud-outline" size={18} color={colors.primary} />
              <Typography
                variant="caption1"
                weight="semibold"
                color={colors.primary}
                style={{ marginLeft: 6 }}
              >
                Drive
              </Typography>
            </TouchableOpacity>
          </View>
          <Typography
            variant="caption2"
            color={colors.textSecondary}
            style={styles.supportedFormatsText}
          >
            Supported formats: JPEG, PNG, PDF
          </Typography>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderProgressBar = () => {
    if (!uploading) return null;
    const progressWidth = progressAnim.interpolate({
      inputRange: [0, 100],
      outputRange: ['0%', '100%'],
    });
    return (
      <View style={styles.progressContainer}>
        <View
          style={[
            styles.progressTrack,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' },
          ]}
        >
          <Animated.View
            style={[styles.progressFill, { width: progressWidth, backgroundColor: colors.primary }]}
          />
        </View>
        <View style={styles.progressTextRow}>
          <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
          <Typography variant="caption1" color={colors.textSecondary}>
            Uploading... {Math.round(uploadProgressValue)}%
          </Typography>
        </View>
      </View>
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title="Add yard plan"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer>
          <ScrollView {...keyboardDismissScrollProps}
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingHorizontal: contentPadding }]}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
            >
              <View style={styles.section}>
                {renderUploadArea()}
                {renderProgressBar()}
              </View>

              <View
                style={[
                  styles.section,
                  styles.infoSection,
                  {
                    backgroundColor: isDark
                      ? 'rgba(255,255,255,0.05)'
                      : 'rgba(255,255,255,0.9)',
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                  },
                ]}
              >
                <View style={styles.sectionHeader}>
                  <View
                    style={[
                      styles.sectionIconContainer,
                      {
                        backgroundColor: isDark
                          ? 'rgba(90, 200, 250, 0.15)'
                          : 'rgba(90, 200, 250, 0.1)',
                      },
                    ]}
                  >
                    <Icon name="leaf-outline" size={20} color={colors.info} />
                  </View>
                  <Typography
                    variant="headline"
                    weight="semibold"
                    style={{ color: colors.textPrimary }}
                  >
                    Area
                  </Typography>
                </View>

                <View style={styles.chipsRow}>
                  {(Object.keys(PLAN_TYPE_LABELS) as GardenPlanType[]).map((key) => {
                    const active = planType === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: active
                              ? 'rgba(78, 205, 196, 0.25)'
                              : isDark
                                ? 'rgba(255,255,255,0.06)'
                                : 'rgba(0,0,0,0.04)',
                            borderColor: active ? colors.primary : 'transparent',
                          },
                        ]}
                        onPress={() => {
                          setPlanType(key);
                          setLabel(PLAN_TYPE_LABELS[key]);
                        }}
                        activeOpacity={0.7}
                      >
                        <Typography
                          variant="caption1"
                          weight={active ? 'semibold' : 'regular'}
                          color={active ? colors.textPrimary : colors.textSecondary}
                        >
                          {PLAN_TYPE_LABELS[key]}
                        </Typography>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.inputGroup}>
                  <View style={styles.inputWrapper}>
                    <View style={styles.inputLabelRow}>
                      <Icon
                        name="pricetag-outline"
                        size={16}
                        color={colors.textSecondary}
                      />
                      <Typography
                        variant="caption1"
                        weight="medium"
                        color={colors.textSecondary}
                        style={styles.inputLabel}
                      >
                        Label (Optional)
                      </Typography>
                    </View>
                    <TextInput
                      value={label}
                      onChangeText={setLabel}
                      placeholder="e.g. North bed"
                      style={styles.input}
                      testID="garden-plan-label-input"
                    />
                  </View>
                </View>
              </View>
            </Animated.View>
          </ScrollView>
        </AdaptiveContainer>

        {/* Shared floating pill (same component as every other floating CTA in
            the app) — clears the tab bar via bottomOffset. */}
        <FloatingActionButton
          title={uploading ? 'Uploading...' : 'Save Yard Plan'}
          variant="teal"
          onPress={handleUpload}
          disabled={!canUpload}
          bottomOffset={80}
        />
      </View>
      {drivePicker}
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  content: { paddingTop: 16, paddingBottom: 120 },
  section: { marginBottom: 24 },
  mapCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 16,
  },
  mapCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCardText: { flex: 1, marginHorizontal: 12, gap: 2 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerLabel: { marginHorizontal: 10 },
  infoSection: { borderRadius: 20, padding: 20, borderWidth: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  uploadDropZone: {
    borderRadius: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 220,
  },
  uploadIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  uploadTitle: { marginBottom: 6 },
  uploadSubtitle: { marginBottom: 20, textAlign: 'center' },
  uploadOptionsRow: { flexDirection: 'row', gap: 5 },
  supportedFormatsText: { marginTop: 16, textAlign: 'center' },
  uploadOptionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: 'rgba(0,0,0,1)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  previewContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    height: 220,
    position: 'relative',
  },
  previewImage: { width: '100%', height: '100%' },
  previewOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16 },
  previewInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  previewFileName: { marginLeft: 8, flex: 1 },
  removeButton: { padding: 4 },
  previewActions: { position: 'absolute', top: 12, right: 12 },
  previewActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    shadowColor: 'rgba(0,0,0,1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  progressContainer: { marginTop: 16 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  inputGroup: { gap: 16 },
  inputWrapper: {},
  inputLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  inputLabel: { marginLeft: 6 },
  input: {},
});
