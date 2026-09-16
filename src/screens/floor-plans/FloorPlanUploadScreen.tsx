import * as DocumentPicker from 'expo-document-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from "expo-router/react-navigation";
import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, ScrollView, Image, TouchableOpacity, Animated } from 'react-native';

import { floorPlansApi } from '@api/floor-plans';
import { CloudFilePicker } from '@components/cloud-storage/CloudFilePicker';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography, FloatingActionButton, GoogleIcon } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import ImageCropPicker from '@services/image-picker-compat';
import { showToast } from '@services/toastManager';
import { useFloorPlanStore } from '@stores/floorPlanStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';

const FLOOR_PLAN_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/** Cloud picker returns a name but no mime — derive from extension. */
function inferFloorPlanMime(name: string): 'application/pdf' | 'image/jpeg' | 'image/png' {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    default:
      return 'image/jpeg';
  }
}

export function FloorPlanUploadScreen() {
  const navigation = useNavigation();
  const { isDark } = useTheme();
  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();
  const { content: contentPadding } = useLayoutPadding();
  const { setUploadProgress, addFloorPlan } = useFloorPlanStore();
  // Adding a floor plan is a core feature — the screen is never AI-gated. AI
  // only powers the automatic room detection that runs after the upload.
  const { canUseAI } = useAIEntitlement();

  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressValue, setUploadProgressValue] = useState(0);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse animation for upload area
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.02,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, []);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: uploadProgressValue,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [uploadProgressValue]);


  const pickImage = async () => {
    try {
      const image = await ImageCropPicker.openPicker({
        cropping: true,
        cropperToolbarTitle: 'Crop Floor Plan',
        cropperActiveWidgetColor: colors.primary,
        cropperStatusBarColor: colors.black,
        cropperToolbarColor: colors.black,
        cropperToolbarWidgetColor: colors.white,
        compressImageQuality: 1,
        mediaType: 'photo',
        freeStyleCropEnabled: true,
      });

      setSelectedFile({
        uri: image.path,
        filename: image.filename || 'floor-plan.jpg',
        size: image.size || 0,
        mime: image.mime || 'image/jpeg',
        path: image.path,
      });
    } catch (error: any) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('library');
      } else if (error.code !== 'E_PICKER_CANCELLED') {
        console.error('Image picker error:', error);
        showToast('error', 'Failed to pick image');
      }
    }
  };

  const takePhoto = async () => {
    try {
      const image = await ImageCropPicker.openCamera({
        cropping: true,
        cropperToolbarTitle: 'Crop Floor Plan',
        cropperActiveWidgetColor: colors.primary,
        cropperStatusBarColor: colors.black,
        cropperToolbarColor: colors.black,
        cropperToolbarWidgetColor: colors.white,
        compressImageQuality: 1,
        freeStyleCropEnabled: true,
      });

      setSelectedFile({
        uri: image.path,
        filename: image.filename || 'floor-plan.jpg',
        size: image.size || 0,
        mime: image.mime || 'image/jpeg',
        path: image.path,
      });
    } catch (error: any) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if (error.code !== 'E_PICKER_CANCELLED') {
        console.error('Camera error:', error);
        showToast('error', 'Failed to take photo');
      }
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedFile({
          uri: asset.uri,
          filename: asset.name || 'floor-plan',
          size: asset.size || 0,
          mime: asset.mimeType || 'image/jpeg',
          path: asset.uri,
        });
      }
    } catch (error) {
      console.error('Document picker error:', error);
      showToast('error', 'Failed to pick file');
    }
  };

  const handleDriveFileSelected = (file: { uri: string; name: string; size: number }) => {
    setShowDrivePicker(false);
    const filename = file.name || 'floor-plan';
    setSelectedFile({
      uri: file.uri,
      filename,
      size: file.size || 0,
      mime: inferFloorPlanMime(filename),
      path: file.uri,
    });
  };

  const [uploadStage, setUploadStage] = useState<'idle' | 'uploading' | 'analyzing'>('idle');

  const handleUpload = async () => {
    if (!currentHousehold || !selectedFile) return;

    try {
      setUploading(true);
      setUploadStage('uploading');
      setUploadProgressValue(0);
      
      // Get upload URL
      const uploadData = await floorPlansApi.getUploadUrl(currentHousehold.id, {
        filename: selectedFile.filename || 'floor-plan.jpg',
        file_size: selectedFile.size || 1000000, // Default size if not available
        content_type: (selectedFile.mime || 'image/jpeg') as 'application/pdf' | 'image/jpeg' | 'image/png',
        building_name: currentHousehold.name,
      });

      setUploadProgressValue(20);

      // Upload file
      const fileBlob = await fetch(selectedFile.uri || selectedFile.path).then(r => r.blob());
      await floorPlansApi.uploadFile(uploadData.upload_url, fileBlob, (progress) => {
        setUploadProgress(progress);
        setUploadProgressValue(20 + (progress * 0.3));
      });

      setUploadProgressValue(50);

      // Confirm upload
      const confirmed = await floorPlansApi.confirmUpload(
        currentHousehold.id,
        uploadData.floor_plan_id,
        {
          building_name: currentHousehold.name,
        }
      );

      setUploadProgressValue(60);
      addFloorPlan(confirmed.floor_plan);

      // Storing and viewing a floor plan is core; only room extraction needs a
      // provider. Without AI the plan is saved as-is and can be analyzed later.
      if (!canUseAI) {
        setUploadProgressValue(100);
        showToast(
          'success',
          'Floor plan saved. Connect AI later to detect rooms automatically.'
        );
        navigation.goBack();
        return;
      }

      // Auto-trigger AI analysis
      setUploadStage('analyzing');
      showToast('info', 'Analyzing floor plan with AI...');

      try {
        const analysisResponse = await floorPlansApi.triggerAnalysis(
          currentHousehold.id,
          uploadData.floor_plan_id
        );

        setUploadProgressValue(70);

        // Pipeline: layout in background, then process one region per request
        const maxPolls = 90;
        let finalStatus = analysisResponse.status;
        for (let i = 0; i < maxPolls; i++) {
          try {
            const step = await floorPlansApi.processPendingRegions(
              currentHousehold.id,
              uploadData.floor_plan_id
            );
            finalStatus = step.status;
            const progress = Math.min(95, 70 + Math.round(((i + 1) / maxPolls) * 25));
            setUploadProgressValue(progress);
            if (step.status === 'completed' || (step.remaining === 0 && (step.regions?.length ?? 0) > 0)) {
              finalStatus = 'completed';
              break;
            }
            if (step.remaining < 0) {
              await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), 3000);
              });
            }
          } catch (stepErr) {
            console.warn('[FloorPlanUpload] process-pending step failed:', stepErr);
            const statusRes = await floorPlansApi.getAnalysis(
              currentHousehold.id,
              uploadData.floor_plan_id
            );
            finalStatus = statusRes.status;
            if (finalStatus === 'completed' || finalStatus === 'failed') break;
          }
        }

        if (finalStatus === 'completed') {
          try {
            for (let i = 0; i < 12; i++) {
              const { regions } = await floorPlansApi.listRegions(
                currentHousehold.id,
                uploadData.floor_plan_id
              );
              const pending = regions.some(
                (r) => r.status === 'pending' || r.status === 'processing'
              );
              if (!pending) break;
              await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), 2500);
              });
            }
          } catch {
            // Region polling is best-effort
          }
          setUploadProgressValue(100);
          showToast('success', 'Floor plan uploaded and analyzed!');
        } else if (finalStatus === 'processing') {
          setUploadProgressValue(100);
          showToast('success', 'Floor plan uploaded! Analysis still running...');
        } else {
          setUploadProgressValue(100);
          showToast('info', 'Upload complete. Analysis failed — you can retry later.');
        }
      } catch (analysisError) {
        console.error('Analysis failed:', analysisError);
        showToast('info', 'Upload complete. Analysis failed - you can retry later.');
      }

      navigation.goBack();
    } catch (error) {
      console.error('Upload failed:', error);
      showToast('error', 'Failed to upload floor plan');
    } finally {
      setUploading(false);
      setUploadStage('idle');
      setUploadProgressValue(0);
    }
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
  };

  const canUpload = selectedFile && !uploading;

  const renderUploadArea = () => {
    if (selectedFile) {
      return (
        <View style={styles.previewContainer}>
          <Image
            source={{ uri: selectedFile.uri }}
            style={styles.previewImage}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.previewOverlay}
          >
            <View style={styles.previewInfo}>
              <View style={styles.previewTextContainer}>
                <Icon name="checkmark-circle" size={20} color={colors.primary} />
                <Typography variant="caption1" color={colors.white} style={styles.previewFileName} numberOfLines={1}>
                  {selectedFile.filename || selectedFile.uri?.split('/').pop() || 'Image'}
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

          {/* Action buttons overlay */}
          <View style={styles.previewActions}>
            <TouchableOpacity
              style={[styles.previewActionButton, { backgroundColor: 'rgba(255,255,255,0.95)', shadowColor: colors.black }]}
              onPress={pickImage}
              activeOpacity={0.8}
            >
              <Icon name="images" size={20} color={colors.primary} />
              <Typography variant="caption1" weight="medium" style={{ marginLeft: 6 }} color={colors.textSecondary}>
                Change
              </Typography>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <TouchableOpacity
          style={[
            styles.uploadDropZone,
            { 
              backgroundColor: isDark ? 'rgba(78, 205, 196, 0.08)' : 'rgba(78, 205, 196, 0.06)',
              borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
            }
          ]}
          onPress={pickImage}
          activeOpacity={0.8}
        >
          <View style={[styles.uploadIconContainer, { backgroundColor: isDark ? 'rgba(78, 205, 196, 0.2)' : 'rgba(78, 205, 196, 0.15)' }]}>
            <Icon name="cloud-upload-outline" size={40} color={colors.primary} />
          </View>
          <Typography variant="body" weight="semibold" style={[styles.uploadTitle, { color: colors.textPrimary }]}>
            Upload Floor Plan
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.uploadSubtitle}>
            Tap to select from gallery, files, camera, or Google Drive
          </Typography>
          
          <View style={styles.uploadOptionsRow}>
            <TouchableOpacity
              style={[styles.uploadOptionChip, {
                backgroundColor: isDark ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.9)',
                borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
                shadowColor: colors.black,
              }]}
              onPress={pickImage}
              activeOpacity={0.7}
            >
              <Icon name="images-outline" size={18} color={colors.primary} />
              <Typography variant="caption1" weight="semibold" color={colors.primary} style={{ marginLeft: 6 }}>
                Gallery
              </Typography>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.uploadOptionChip, {
                backgroundColor: isDark ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.9)',
                borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
                shadowColor: colors.black,
              }]}
              onPress={takePhoto}
              activeOpacity={0.7}
              testID="floor-plan-source-camera"
            >
              <Icon name="camera-outline" size={18} color={colors.primary} />
              <Typography variant="caption1" weight="semibold" color={colors.primary} style={{ marginLeft: 6 }}>
                Camera
              </Typography>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.uploadOptionChip, {
                backgroundColor: isDark ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.9)',
                borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
                shadowColor: colors.black,
              }]}
              onPress={pickDocument}
              activeOpacity={0.7}
              testID="floor-plan-source-file"
            >
              <Icon name="folder-outline" size={18} color={colors.primary} />
              <Typography variant="caption1" weight="semibold" color={colors.primary} style={{ marginLeft: 6 }}>
                Files
              </Typography>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.uploadOptionChip, {
                backgroundColor: isDark ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.9)',
                borderColor: isDark ? 'rgba(78, 205, 196, 0.4)' : 'rgba(78, 205, 196, 0.5)',
                shadowColor: colors.black,
              }]}
              onPress={() => setShowDrivePicker(true)}
              activeOpacity={0.7}
            >
              <GoogleIcon size={16} />
              <Typography variant="caption1" weight="semibold" color={colors.primary} style={{ marginLeft: 6 }}>
                Drive
              </Typography>
            </TouchableOpacity>
          </View>

          <Typography variant="captionSmall" color={colors.textSecondary} style={styles.supportedFormatsText}>
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

    const stageText = uploadStage === 'analyzing' 
      ? 'Analyzing with AI...' 
      : `Uploading... ${Math.round(uploadProgressValue)}%`;

    return (
      <View style={styles.progressContainer}>
        <View style={[styles.progressTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: progressWidth,
                backgroundColor: uploadStage === 'analyzing' ? colors.info : colors.primary,
              },
            ]}
          />
        </View>
        <View style={styles.progressTextRow}>
          {uploadStage === 'analyzing' && (
            <ActivityIndicator size="small" color={colors.info} style={{ marginRight: 8 }} />
          )}
          <Typography variant="caption1" color={colors.textSecondary}>
            {stageText}
          </Typography>
        </View>
      </View>
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container}>
        <ScreenHeader
          title="Add Floor Plan"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingHorizontal: contentPadding }]}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              style={{
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              }}
            >
              {/* Upload Area - Primary Focus */}
              <View style={styles.section}>
                {renderUploadArea()}
                {renderProgressBar()}
              </View>

            </Animated.View>
          </ScrollView>

        </AdaptiveContainer>

        {/* Shared floating pill — same component as every other floating CTA in
            the app; clears the tab bar via bottomOffset. */}
        <FloatingActionButton
          title={
            uploadStage === 'analyzing'
              ? 'Analyzing...'
              : uploading
                ? 'Uploading...'
                : 'Upload Floor Plan'
          }
          variant="teal"
          onPress={handleUpload}
          disabled={!canUpload}
          bottomOffset={80}
        />

        <CloudFilePicker
          visible={showDrivePicker}
          provider="google-drive"
          mimeTypeFilter={[...FLOOR_PLAN_MIMES]}
          rememberScope="floor-plans"
          onClose={() => setShowDrivePicker(false)}
          onFileSelected={handleDriveFileSelected}
        />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: 16,
    paddingBottom: 120,
  },
  section: {
    marginBottom: 24,
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
  uploadTitle: {
    marginBottom: 6,
  },
  uploadSubtitle: {
    marginBottom: 20,
    textAlign: 'center',
  },
  uploadOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  supportedFormatsText: {
    marginTop: 16,
    textAlign: 'center',
  },
  uploadOptionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
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
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  previewInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  previewFileName: {
    marginLeft: 8,
    flex: 1,
  },
  removeButton: {
    padding: 4,
  },
  previewActions: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  previewActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  progressContainer: {
    marginTop: 16,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
});
