import { BlurView } from 'expo-blur';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useCallback, useState, useRef } from 'react';
import { StyleSheet, View, FlatList, TouchableOpacity, RefreshControl, Alert, Modal, Animated, Platform, Pressable } from 'react-native';
import { Swipeable, TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';

import { reportsApi, Report } from '@api/reports';
import { CloudFilePicker } from '@components/cloud-storage';
import { AppBackground, ScreenHeader, AIDisclaimerModal, hasAcceptedAIDisclaimer, ScreenScrollEnd, screenScrollEndTestId, SettingsGearButton } from '@components/common';
import { PropertyBadge } from '@components/common/house';
import { AdaptiveContainer, SplitView } from '@components/layout';
import { Card, FloatingActionButton, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import { useTheme } from '@contexts/ThemeContext';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useRequireAIAccess } from '@hooks/useRequireAIAccess';
import { useResponsiveValue } from '@hooks/useResponsiveValue';
import type { ReportsStackScreenProps } from '@navigation/types';
import type { CloudProvider } from '@services/cloud-storage';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useReportStore } from '@stores/reportStore';
import type { AppColors } from '@theme';
import { useAppColors } from '@theme';
import { palette } from '@theme/colors';
import type { IoniconName } from '@utils/categoryIcons';


// Status label + semantic-token keys. Actual colors are resolved at render time
// from useAppColors() (see getStatusConfig) so they stay theme-aware.
const STATUS_CONFIG: Record<
  string,
  { label: string; colorKey: keyof AppColors; bgKey: keyof AppColors }
> = {
  pending_upload: { label: 'Pending', colorKey: 'textSecondary', bgKey: 'backgroundSecondary' },
  uploaded: { label: 'Uploaded', colorKey: 'accent', bgKey: 'backgroundSecondary' },
  processing: { label: 'Processing', colorKey: 'warning', bgKey: 'backgroundSecondary' },
  completed: { label: 'Ready', colorKey: 'success', bgKey: 'backgroundSecondary' },
  failed: { label: 'Failed', colorKey: 'error', bgKey: 'destructiveSubtle' },
};

// Shown after an upload made while no AI provider is available. Storing and
// reading documents is core; analysis is the paid/BYOK part.
const REPORT_SAVED_WITHOUT_AI_MESSAGE =
  'Report saved. Open it any time to read or download it. To extract findings and action plans, connect an AI provider or subscribe, then tap “Analyze with AI”.';

// Third-party brand logo colors (Google Drive, Dropbox). These are fixed brand
// identities, not theme tokens, so they intentionally stay as raw hex.
const BRAND_COLORS = {
  // eslint-disable-next-line no-restricted-syntax
  googleBlue: '#4285F4',
  // eslint-disable-next-line no-restricted-syntax
  googleYellow: '#FBBC04',
  // eslint-disable-next-line no-restricted-syntax
  googleGreen: '#34A853',
  // eslint-disable-next-line no-restricted-syntax
  dropboxBlue: '#0061FF',
} as const;

// User-friendly processing stage labels with descriptions
const PROCESSING_STAGE_CONFIG: Record<string, { label: string; description: string; icon: IoniconName }> = {
  downloading_pdf: {
    label: 'Downloading',
    description: 'Getting your PDF ready for analysis',
    icon: 'cloud-download',
  },
  converting_to_base64: {
    label: 'Preparing',
    description: 'Preparing document for AI analysis',
    icon: 'document-text',
  },
  extracting_findings: {
    label: 'AI Analysis',
    description: 'AI is reading and analyzing your report',
    icon: 'sparkles',
  },
  storing_findings: {
    label: 'Saving',
    description: 'Saving findings to your account',
    icon: 'save',
  },
  generating_summaries: {
    label: 'Summarizing',
    description: 'Creating easy-to-read summaries',
    icon: 'create',
  },
  generating_action_plans: {
    label: 'Action Plans',
    description: 'Building personalized action plans',
    icon: 'checkmark-circle',
  },
  complete: {
    label: 'Finishing',
    description: 'Almost done!',
    icon: 'ribbon',
  },
  delegating_to_lambda: {
    label: 'Processing',
    description: 'Large file - using enhanced processing',
    icon: 'flash',
  },
  queued_for_lambda: {
    label: 'In Queue',
    description: 'Your report is queued for processing',
    icon: 'hourglass',
  },
  processing_in_lambda: {
    label: 'Deep Analysis',
    description: 'AI is performing detailed analysis',
    icon: 'search',
  },
};

const getProcessingStageConfig = (
  stage: string | null | undefined
): { label: string; description: string; icon: IoniconName } => {
  if (!stage) return { label: 'Processing', description: 'Processing your report...', icon: 'hourglass' };
  return (
    PROCESSING_STAGE_CONFIG[stage] || {
      label: 'Processing',
      description: 'Working on your report...',
      icon: 'cog',
    }
  );
};

export function ReportsScreen({ navigation }: ReportsStackScreenProps<'ReportsMain'>) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const router = useRouter();
  const { isTablet, isLandscape, columns, shouldUseSplitView } = useDeviceType();
  const fabMaxWidth = useResponsiveValue({
    phone: 600,
    tablet: 800,
    tabletLandscape: 1000,
    default: 600,
  });
  const { isLoading: isDataLoading } = useData();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const { reports, setReports, isLoading, setLoading, setError } = useReportStore();
  // Reports work WITHOUT AI: uploading, storing, opening and downloading a
  // document are core (and un-gated server-side). Only the extraction pass
  // (findings / summaries / action plans) needs an AI provider, so `canUseAI`
  // decides whether we auto-analyze after an upload, and `ensureCanUseAI`
  // guards the explicit "Analyze" action.
  const { ensureCanUseAI, canUseAI } = useRequireAIAccess();
  const [refreshing, setRefreshing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [retryingReportId, setRetryingReportId] = useState<string | null>(null);
  const [showUploadSourceModal, setShowUploadSourceModal] = useState(false);
  const [showCloudPicker, setShowCloudPicker] = useState(false);
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>('google-drive');
  const [showAIDisclaimer, setShowAIDisclaimer] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  // Consistent layout padding
  const { content: containerPadding, cardGap } = useLayoutPadding();
  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? null;

  // Resolve a status entry into theme-aware label/color/bgColor.
  const getStatusConfig = (status: string) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending_upload;
    return {
      label: config.label,
      color: colors[config.colorKey],
      bgColor: colors[config.bgKey],
    };
  };

  const loadReports = useCallback(async () => {
    if (!currentHousehold) return;

    try {
      setLoading(true);
      const response = await reportsApi.list(currentHousehold.id);
      setReports(response.reports);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load reports';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [currentHousehold, setReports, setLoading, setError]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!shouldUseSplitView) return;
    if (!reports.length) {
      setSelectedReportId(null);
      return;
    }
    if (!selectedReportId || !reports.some((report) => report.id === selectedReportId)) {
      setSelectedReportId(reports[0].id);
    }
  }, [reports, selectedReportId, shouldUseSplitView]);

  // Auto-refresh for processing reports
  useEffect(() => {
    if (!currentHousehold) return;

    // Check if any reports are processing
    const hasProcessingReports = reports.some(
      (report) => report.status === 'processing'
    );

    if (!hasProcessingReports) return;

    // Poll every 5 seconds while processing
    const interval = setInterval(() => {
      loadReports();
    }, 5000);

    return () => clearInterval(interval);
  }, [currentHousehold, reports, loadReports]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadReports();
    setRefreshing(false);
  };

  const handleUploadButtonPress = async () => {
    // No AI gate here — storing a document is a core feature. Without AI the
    // file is uploaded and kept as-is; the disclaimer is only relevant when we
    // are about to send the document to an AI provider.
    if (!canUseAI) {
      setShowUploadSourceModal(true);
      return;
    }
    // Check if user has accepted the AI disclaimer
    const hasAccepted = await hasAcceptedAIDisclaimer();
    if (!hasAccepted) {
      pendingActionRef.current = () => setShowUploadSourceModal(true);
      setShowAIDisclaimer(true);
      return;
    }
    setShowUploadSourceModal(true);
  };

  const handleDisclaimerAccept = useCallback(() => {
    setShowAIDisclaimer(false);
    // Execute the pending action after disclaimer is accepted
    if (pendingActionRef.current) {
      setTimeout(() => {
        pendingActionRef.current?.();
        pendingActionRef.current = null;
      }, 300);
    }
  }, []);

  const handleDisclaimerDecline = useCallback(() => {
    setShowAIDisclaimer(false);
    pendingActionRef.current = null;
    showToast('error', 'Disclaimer Required: You must accept the disclaimer to use AI-powered report analysis.');
  }, []);

  const handleUploadFromDevice = async () => {
    setShowUploadSourceModal(false);
    // Small delay to let modal close smoothly
    setTimeout(() => handleUpload(), 300);
  };

  const handleUploadFromGoogleDrive = async () => {
    setShowUploadSourceModal(false);
    // Small delay to let modal close smoothly
    setTimeout(() => {
      setCloudProvider('google-drive');
      setShowCloudPicker(true);
    }, 300);
  };

  const handleUploadFromDropbox = async () => {
    setShowUploadSourceModal(false);
    // Small delay to let modal close smoothly
    setTimeout(() => {
      setCloudProvider('dropbox');
      setShowCloudPicker(true);
    }, 300);
  };

  const handleCloudFileSelected = async (file: { uri: string; name: string; size: number }) => {
    if (!currentHousehold) {
      Alert.alert('Error', 'Please select a home first');
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);
      setUploadStatus('Getting upload URL...');

      // Step 1: Get upload URL from backend
      const uploadUrlResponse = await reportsApi.getUploadUrl(currentHousehold.id, {
        filename: file.name,
        file_size: file.size,
        content_type: 'application/pdf',
      });

      setUploadStatus('Uploading file...');

      // Step 2: Read the file and upload
      const response = await fetch(file.uri);
      const blob = await response.blob();

      await reportsApi.uploadFile(
        uploadUrlResponse.upload_url,
        blob,
        (progress) => setUploadProgress(progress)
      );

      setUploadStatus('Confirming upload...');
      setUploadProgress(100);

      // Step 3: Confirm upload
      await reportsApi.confirmUpload(
        currentHousehold.id,
        uploadUrlResponse.report_id
      );

      // Step 4: analysis is the only AI part — without a provider the report is
      // simply stored and can be opened, shared and analyzed later.
      if (canUseAI) {
        setUploadStatus('Starting processing...');
        await new Promise<void>(resolve => setTimeout(() => resolve(), 100));

        try {
          await reportsApi.initiateEnhancedProcessing(
            currentHousehold.id,
            uploadUrlResponse.report_id
          );
        } catch (processingError) {
          console.error('Failed to initiate processing:', processingError);
          Alert.alert(
            'Upload Complete',
            'File uploaded successfully, but processing could not be started automatically. Please try processing the report manually.',
            [{ text: 'OK' }]
          );
        }
      }

      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');

      // Refresh the reports list
      await loadReports();

      Alert.alert(
        'Success',
        canUseAI
          ? 'Report uploaded successfully! AI processing will begin shortly.'
          : REPORT_SAVED_WITHOUT_AI_MESSAGE,
        [{ text: 'OK' }]
      );
    } catch (error) {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');

      const isNetworkError = error instanceof Error && 
        (error.message.includes('Network') || error.message.includes('timeout') || error.message.includes('connection'));
      
      Alert.alert(
        'Upload Failed',
        isNetworkError 
          ? 'Unable to connect. Please check your internet connection and try again.'
          : 'Something went wrong. Please try again.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Retry', 
            onPress: () => {
              if (cloudProvider) {
                setShowCloudPicker(true);
              }
            }
          },
        ]
      );
    }
  };

  const handleUpload = async () => {
    if (!currentHousehold) {
      Alert.alert('Error', 'Please select a home first');
      return;
    }

    try {
      // Pick a PDF document
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const file = result.assets[0];

      if (!file.uri || !file.name || !file.size) {
        Alert.alert('Error', 'Invalid file selected');
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);
      setUploadStatus('Getting upload URL...');

      // Step 1: Get upload URL from backend
      const uploadUrlResponse = await reportsApi.getUploadUrl(currentHousehold.id, {
        filename: file.name,
        file_size: file.size,
        content_type: 'application/pdf',
      });

      setUploadStatus('Uploading file...');

      // Step 2: Upload file to the URL
      const response = await fetch(file.uri);
      const blob = await response.blob();

      await reportsApi.uploadFile(
        uploadUrlResponse.upload_url,
        blob,
        (progress) => setUploadProgress(progress)
      );

      setUploadStatus('Confirming upload...');
      setUploadProgress(100);

      // Step 3: Confirm upload (changes status from pending_upload to uploaded)
      console.log(`[Upload] Step 3: Confirming upload for report ${uploadUrlResponse.report_id}`);
      try {
        await reportsApi.confirmUpload(
          currentHousehold.id,
          uploadUrlResponse.report_id
        );
        console.log(`[Upload] Step 3: Upload confirmed successfully for report ${uploadUrlResponse.report_id}`);
      } catch (confirmError) {
        console.error(`[Upload] Step 3: Confirm upload failed:`, confirmError);
        throw confirmError;
      }

      // Step 4: analysis is the only AI part. Without a provider the document
      // is stored and stays fully usable (open, download, share, delete) — the
      // user can analyze it later from the report card.
      if (canUseAI) {
        setUploadStatus('Starting processing...');
        console.log(`[Upload] Step 4: Starting enhanced processing for report ${uploadUrlResponse.report_id}`);

        // Add a small delay to ensure confirm upload is fully processed
        await new Promise<void>(resolve => setTimeout(() => resolve(), 100));

        try {
          const processingResponse = await reportsApi.initiateEnhancedProcessing(
            currentHousehold.id,
            uploadUrlResponse.report_id
          );
          console.log(`[Upload] Step 4: Enhanced processing initiated successfully:`, JSON.stringify(processingResponse));
        } catch (processingError) {
          console.error(`[Upload] Step 4: Failed to initiate processing:`, {
            error: processingError instanceof Error ? processingError.message : String(processingError),
            stack: processingError instanceof Error ? processingError.stack : undefined,
            name: processingError instanceof Error ? processingError.name : 'UnknownError',
          });
          // Don't throw - allow upload to complete even if processing initiation fails
          // The user can manually trigger processing later
          Alert.alert(
            'Upload Complete',
            'File uploaded successfully, but processing could not be started automatically. Please try processing the report manually.',
            [{ text: 'OK' }]
          );
        }
      }

      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');

      // Refresh the reports list
      await loadReports();

      Alert.alert(
        'Success',
        canUseAI
          ? 'Report uploaded successfully! AI processing will begin shortly. You can track progress in the reports list.'
          : REPORT_SAVED_WITHOUT_AI_MESSAGE,
        [{ text: 'OK' }]
      );
    } catch (error) {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');

      if (error instanceof Error) {
        console.error('Upload error:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
        });
      } else {
        console.error('Upload error (unknown):', error);
      }
      
      const isNetworkError = error instanceof Error && 
        (error.message.includes('Network') || error.message.includes('timeout') || error.message.includes('connection'));
      
      Alert.alert(
        'Upload Failed',
        isNetworkError 
          ? 'Unable to connect. Please check your internet connection and try again.'
          : 'Something went wrong. Please try again.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: () => handleUpload() },
        ]
      );
    }
  };

  const handleReportPress = (report: Report) => {
    if (!currentHousehold) {
      showToast('info', 'Select a property first.');
      return;
    }

    // In iPad split view, first select for detail preview.
    if (shouldUseSplitView) {
      setSelectedReportId(report.id);
      return;
    }

    // The document itself is readable as soon as it is stored — AI analysis only
    // adds the findings/summary tabs. So every report that finished uploading
    // opens, whether or not it has been analyzed.
    if (report.status === 'pending_upload') {
      showToast('info', 'This report is still uploading.');
      return;
    }

    try {
      navigation.navigate('ReportDetail', {
        householdId: currentHousehold.id,
        reportId: report.id,
      });
    } catch (error) {
      console.error('[ReportsScreen] Navigation error:', error);
      showToast('error', 'Could not open that report. Please try again.');
    }
  };

  const handleDeleteReport = useCallback((report: Report) => {
    if (!currentHousehold) return;

    // Prevent double-tap by checking if already deleting
    if (deletingReportId) return;

    // Close the swipeable
    swipeableRefs.current.get(report.id)?.close();

    Alert.alert(
      'Delete Report',
      `Are you sure you want to delete "${report.filename}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Double-check we're not already deleting
            if (deletingReportId) return;

            try {
              setDeletingReportId(report.id);
              await reportsApi.delete(currentHousehold.id, report.id);
              await loadReports();
              showToast('success', 'Report deleted successfully');
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to delete report';
              showToast('error', message);
            } finally {
              setDeletingReportId(null);
            }
          },
        },
      ]
    );
  }, [currentHousehold, loadReports, deletingReportId]);

  const handleRetryProcessing = useCallback(async (report: Report) => {
    if (!ensureCanUseAI()) return;
    if (!currentHousehold) return;
    if (retryingReportId) return;

    try {
      setRetryingReportId(report.id);

      await reportsApi.initiateEnhancedProcessing(
        currentHousehold.id,
        report.id
      );

      // Refresh the reports list to show processing status
      await loadReports();

      Alert.alert(
        'Processing Started',
        'Your report is being processed again. This may take a few minutes.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry processing';
      Alert.alert('Retry Failed', message);
    } finally {
      setRetryingReportId(null);
    }
  }, [currentHousehold, loadReports, retryingReportId, ensureCanUseAI]);

  /**
   * Analyze a report that was stored without AI (uploaded while no provider was
   * connected). Same processing call as retry, but this is the first time the
   * document would leave the app, so the AI disclaimer is asked for here.
   */
  const handleAnalyzeReport = useCallback(async (report: Report) => {
    if (!ensureCanUseAI()) return;
    if (!currentHousehold) return;
    if (retryingReportId) return;

    const runAnalysis = async () => {
      try {
        setRetryingReportId(report.id);
        await reportsApi.initiateEnhancedProcessing(currentHousehold.id, report.id);
        await loadReports();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start analysis';
        showToast('error', message);
      } finally {
        setRetryingReportId(null);
      }
    };

    const hasAccepted = await hasAcceptedAIDisclaimer();
    if (!hasAccepted) {
      pendingActionRef.current = () => {
        void runAnalysis();
      };
      setShowAIDisclaimer(true);
      return;
    }
    await runAnalysis();
  }, [currentHousehold, loadReports, retryingReportId, ensureCanUseAI]);

  const renderRightActions = useCallback((
    progress: Animated.AnimatedInterpolation<number>,
    _dragX: Animated.AnimatedInterpolation<number>,
    report: Report
  ) => {
    const translateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [80, 0],
    });

    const isDeleting = deletingReportId === report.id;

    return (
      <Animated.View style={[styles.deleteAction, { transform: [{ translateX }] }]}>
        <TouchableOpacity
          style={[
            styles.deleteButton,
            { backgroundColor: colors.error },
            isDeleting && styles.deleteButtonDisabled,
          ]}
          onPress={() => handleDeleteReport(report)}
          disabled={isDeleting || deletingReportId !== null}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Icon name="trash" size={20} color={colors.white} />
          )}
          <Typography
            variant="caption1"
            weight="semibold"
            color={colors.white}
            style={styles.deleteButtonLabel}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Typography>
        </TouchableOpacity>
      </Animated.View>
    );
  }, [handleDeleteReport, deletingReportId, colors.error, colors.white]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderReport = ({ item, index: _index }: { item: Report; index?: number }) => {
    const statusConfig = getStatusConfig(item.status);

    // iPad-optimized card padding and sizing
    const cardPadding = isTablet ? (isLandscape ? 24 : 20) : 16;
    const iconSize = isTablet ? (isLandscape ? 64 : 56) : 48;
    const iconMargin = isTablet ? (isLandscape ? 20 : 16) : 12;

    return (
      <Swipeable
        ref={(ref) => {
          if (ref) {
            swipeableRefs.current.set(item.id, ref);
          } else {
            swipeableRefs.current.delete(item.id);
          }
        }}
        renderRightActions={(progress, dragX) => renderRightActions(progress, dragX, item)}
        overshootRight={false}
        friction={2}
      >
        <GHTouchableOpacity 
          onPress={() => handleReportPress(item)}
          activeOpacity={0.7}
        >
          <Card variant="outlined" style={[styles.reportCard, { padding: cardPadding }]}>
            <View style={styles.reportHeader}>
              <View 
                style={[
                  styles.reportIcon, 
                  { 
                    backgroundColor: colors.groupedListBackground,
                    width: iconSize,
                    height: iconSize,
                    borderRadius: isTablet ? 12 : 8,
                    marginRight: iconMargin,
                  }
                ]}
              >
                <Icon name="document-text" size={isTablet ? 28 : 24} color={colors.primary} />
              </View>
              <View style={styles.reportInfo}>
                <Typography variant="headline" weight="semibold" numberOfLines={1} color={colors.textPrimary}>
                  {item.filename}
                </Typography>
                <View style={styles.reportSubtitleRow}>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {formatDate(item.created_at)} • {formatFileSize(item.file_size)}
                  </Typography>
                  <PropertyBadge 
                    householdId={(item as any)._householdId || item.household_id} 
                    householdName={(item as any)._householdName} 
                    size="sm" 
                  />
                </View>
              </View>
              <View
                style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}
              >
                <Typography
                  variant="caption2"
                  weight="medium"
                  color={statusConfig.color}
                >
                  {statusConfig.label}
                </Typography>
              </View>
            </View>

            {item.property_address && (
              <View style={[styles.reportMeta, styles.reportMetaRow]}>
                <Icon name="location" size={14} color={colors.textSecondary} />
                <Typography variant="footnote" color={colors.textSecondary}>
                  {item.property_address}
                </Typography>
              </View>
            )}

            {item.status === 'processing' && (() => {
              const stageConfig = getProcessingStageConfig(item.processing_stage);
              return (
                <View style={[styles.processingContainer, { backgroundColor: theme.dark ? 'rgba(78, 205, 196, 0.1)' : colors.backgroundSecondary }]}>
                  <View style={styles.processingHeader}>
                    <View style={styles.processingIconContainer}>
                      <Icon name={stageConfig.icon} size={20} color={colors.primary} />
                    </View>
                    <View style={styles.processingTextContainer}>
                      <View style={styles.processingTitleRow}>
                        <Typography variant="subheadline" weight="semibold" color={colors.primary}>
                          {stageConfig.label}
                        </Typography>
                        <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
                      </View>
                      <Typography variant="caption1" color={colors.textSecondary} style={{ marginTop: 2 }}>
                        {stageConfig.description}
                      </Typography>
                    </View>
                  </View>
                  {item.processing_progress != null && item.processing_progress > 0 && (
                    <View style={styles.progressSection}>
                      <View style={[styles.progressBarSmall, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.1)' : colors.backgroundSecondary }]}>
                        <View
                          style={[
                            styles.progressFillSmall,
                            { width: `${item.processing_progress}%`, backgroundColor: colors.primary },
                          ]}
                        />
                      </View>
                      <Typography variant="caption2" weight="medium" color={colors.primary}>
                        {item.processing_progress}%
                      </Typography>
                    </View>
                  )}
                </View>
              );
            })()}

            {item.status === 'uploaded' && (
              <View style={styles.reportActions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleAnalyzeReport(item)}
                  disabled={retryingReportId !== null}
                  testID={`report-analyze-${item.id}`}
                >
                  {retryingReportId === item.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Typography variant="caption1" color={colors.primary}>
                      Analyze with AI
                    </Typography>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {item.status === 'completed' && (
              <View style={styles.reportActions}>
                <TouchableOpacity style={styles.actionButton}>
                  <Typography variant="caption1" color={colors.primary}>
                    View Findings
                  </Typography>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionButton}>
                  <Typography variant="caption1" color={colors.primary}>
                    Action Plans
                  </Typography>
                </TouchableOpacity>
              </View>
            )}

            {item.status === 'failed' && (
              <View style={[styles.failedContainer, { backgroundColor: colors.destructiveSubtle }]}>
                <View style={styles.failedContent}>
                  <View style={styles.failedIconContainer}>
                    <Icon name="warning" size={20} color={colors.error} />
                  </View>
                  <View style={styles.failedTextContainer}>
                    <Typography variant="subheadline" weight="semibold" color={colors.error}>
                      Processing Failed
                    </Typography>
                    {item.error_message && (
                      <Typography variant="caption1" color={colors.error} style={{ marginTop: 2, opacity: 0.8 }}>
                        {item.error_message}
                      </Typography>
                    )}
                  </View>
                </View>
                <TouchableOpacity
                  style={[
                    styles.retryButton,
                    { backgroundColor: colors.primary },
                    retryingReportId === item.id && styles.retryButtonDisabled,
                  ]}
                  onPress={() => handleRetryProcessing(item)}
                  disabled={retryingReportId !== null}
                >
                  {retryingReportId === item.id ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <View style={styles.retryButtonContent}>
                      <Icon name="refresh" size={14} color={colors.white} />
                      <Typography variant="caption1" weight="semibold" color={colors.white}>
                        Retry
                      </Typography>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </Card>
        </GHTouchableOpacity>
      </Swipeable>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer} testID="reports-empty-state">
      <View style={styles.emptyIcon}>
        <Icon name="document-text-outline" size={40} color={colors.textSecondary} />
      </View>
      <Typography variant="title3" weight="semibold" align="center" color={colors.textPrimary}>
        No Reports Yet
      </Typography>
      <Typography
        variant="body"
        color={colors.textSecondary}
        align="center"
        style={styles.emptyText}
      >
        Upload your first home inspection report to get started
      </Typography>
    </View>
  );

  // FlatList's numColumns can't change on an already-mounted instance ("Changing
  // numColumns on the fly is not supported") — isTablet/isLandscape/columns/
  // shouldUseSplitView can all shift after mount (rotation, Split View/Stage
  // Manager resize), so the list gets a `key` tied to its own effective column
  // count to force a fresh mount instead of an in-place prop change.
  const reportsListNumColumns = isTablet && isLandscape && !shouldUseSplitView ? Math.min(columns, 2) : 1;

  const renderReportsList = () => (
    <FlatList
      key={`reports-list-${reportsListNumColumns}`}
      data={reports}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => renderReport({ item })}
      contentContainerStyle={[
        styles.listContent,
        {
          paddingBottom: 100,
          gap: cardGap,
        },
      ]}
      numColumns={reportsListNumColumns}
      columnWrapperStyle={
        isTablet && isLandscape && !shouldUseSplitView ? [styles.row, { gap: cardGap }] : undefined
      }
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
      ListEmptyComponent={!isLoading ? renderEmpty : null}
      ListFooterComponent={
        () => <ScreenScrollEnd testID={screenScrollEndTestId('reports-screen')} />
      }
    />
  );

  const renderDetailPanel = () => {
    if (!selectedReport) {
      return (
        <View style={[styles.detailPanelEmpty, { borderColor: colors.divider }]}>
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            Select a report
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.detailPanelEmptyText}>
            Tap a report from the list to preview details and open findings.
          </Typography>
        </View>
      );
    }

    const statusConfig = getStatusConfig(selectedReport.status);
    return (
      <View style={[styles.detailPanelCard, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="title3" weight="bold" color={colors.textPrimary}>
          {selectedReport.filename}
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.detailMeta}>
          {formatDate(selectedReport.created_at)} • {formatFileSize(selectedReport.file_size)}
        </Typography>
        {selectedReport.property_address ? (
          <View style={[styles.detailMeta, styles.detailMetaRow]}>
            <Icon name="location" size={14} color={colors.textSecondary} />
            <Typography variant="footnote" color={colors.textSecondary}>
              {selectedReport.property_address}
            </Typography>
          </View>
        ) : null}
        <View style={[styles.detailStatus, { backgroundColor: statusConfig.bgColor }]}>
          <Typography variant="caption1" weight="semibold" style={{ color: statusConfig.color }}>
            {statusConfig.label}
          </Typography>
        </View>
        <TouchableOpacity
          style={[
            styles.detailActionButton,
            { backgroundColor: selectedReport.status === 'completed' ? colors.primary : colors.divider },
          ]}
          onPress={() => handleReportPress(selectedReport)}
          disabled={selectedReport.status !== 'completed'}
          activeOpacity={0.8}
        >
          <Typography variant="body" weight="semibold" color={colors.white}>
            {selectedReport.status === 'completed' ? 'Open Report Details' : 'Report Still Processing'}
          </Typography>
        </TouchableOpacity>
      </View>
    );
  };

  const renderUploadModal = () => (
    <Modal
      visible={isUploading}
      transparent
      animationType="fade"
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.backgroundSecondary }]}>
          <Typography variant="title3" weight="semibold" align="center" color={colors.textPrimary}>
            Uploading Report
          </Typography>
          <Typography
            variant="body"
            color={colors.textSecondary}
            align="center"
            style={styles.modalText}
          >
            {uploadStatus}
          </Typography>
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { backgroundColor: colors.borderColor }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${uploadProgress}%`, backgroundColor: colors.primary },
                ]}
              />
            </View>
            <Typography variant="caption1" color={colors.textSecondary}>
              {uploadProgress}%
            </Typography>
          </View>
        </View>
      </View>
    </Modal>
  );

  const handleOptionPress = (handler: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handler();
  };

  const renderUploadSourceModal = () => (
    <Modal
      visible={showUploadSourceModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setShowUploadSourceModal(false)}
    >
      <View style={styles.uploadSourceModalOverlay}>
        {/* Blur background */}
        {Platform.OS === 'ios' && (
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={60}
            tint={theme.dark ? 'dark' : 'light'}
          />
        )}
        
        {/* Tap to dismiss overlay */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowUploadSourceModal(false);
          }}
        />
        
        {/* Modal content */}
        <Animated.View 
          style={[
            styles.uploadSourceModalContent,
            {
              backgroundColor: theme.dark 
                ? 'rgba(30, 30, 30, 0.95)' 
                : 'rgba(255, 255, 255, 0.98)',
            }
          ]}
        >
          {/* Handle bar - iOS style */}
          <View style={styles.uploadSourceModalHandle} />
          
          {/* Header with icon */}
          <View style={styles.uploadSourceModalHeader}>
            <View style={[
              styles.uploadSourceHeaderIcon,
              { 
                backgroundColor: theme.dark 
                  ? 'rgba(78, 205, 196, 0.2)' 
                  : 'rgba(78, 205, 196, 0.15)'
              }
            ]}>
              <LinearGradient
                colors={[colors.primary, colors.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.uploadSourceHeaderIconGradient}
              >
                <Icon name="cloud-upload" size={24} color={colors.white} />
              </LinearGradient>
            </View>
            <Typography 
              variant="title2" 
              weight="bold" 
              align="center" 
              color={colors.textPrimary}
              style={styles.uploadSourceModalTitle}
            >
              Upload Report
            </Typography>
            <Typography 
              variant="subheadline" 
              color={colors.textSecondary} 
              align="center"
              style={styles.uploadSourceModalSubtitle}
            >
              Select a source to upload your PDF
            </Typography>
          </View>

          {/* Upload options - iOS 26 style cards */}
          <View style={styles.uploadSourceOptions}>
            {/* From Device - Primary option */}
            <Pressable 
              style={({ pressed }) => [
                styles.uploadSourceOptionModern,
                {
                  backgroundColor: theme.dark 
                    ? 'rgba(255, 255, 255, 0.08)' 
                    : 'rgba(0, 0, 0, 0.03)',
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  opacity: pressed ? 0.9 : 1,
                }
              ]}
              onPress={() => handleOptionPress(handleUploadFromDevice)}
              testID="reports-source-device"
            >
              <View style={[
                styles.uploadSourceIconModern,
                { backgroundColor: 'rgba(78, 205, 196, 0.15)' }
              ]}>
                <LinearGradient
                  colors={[colors.primary, colors.primaryDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.uploadSourceIconGradient}
                >
                  <Icon name="phone-portrait" size={22} color={colors.white} />
                </LinearGradient>
              </View>
              <View style={styles.uploadSourceTextContainer}>
                <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                  From Device
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Browse local files & iCloud
                </Typography>
              </View>
              <View style={styles.uploadSourceChevron}>
                <Icon name="chevron-forward" size={20} color={colors.textTertiary} />
              </View>
            </Pressable>

            {/* Divider with "or connect" label */}
            <View style={styles.uploadSourceDivider}>
              <View style={[styles.uploadSourceDividerLine, { backgroundColor: colors.borderColor }]} />
              <Typography
                variant="overline"
                color={colors.textTertiary}
                style={styles.uploadSourceDividerText}
              >
                OR CONNECT
              </Typography>
              <View style={[styles.uploadSourceDividerLine, { backgroundColor: colors.borderColor }]} />
            </View>

            {/* Cloud options row */}
            <View style={styles.uploadSourceCloudRow}>
              {/* Google Drive */}
              <Pressable 
                style={({ pressed }) => [
                  styles.uploadSourceCloudOption,
                  {
                    backgroundColor: theme.dark 
                      ? 'rgba(255, 255, 255, 0.06)' 
                      : 'rgba(0, 0, 0, 0.02)',
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                    opacity: pressed ? 0.9 : 1,
                  }
                ]}
                testID="reports-source-google-drive"
                onPress={() => handleOptionPress(handleUploadFromGoogleDrive)}
              >
                <View style={[
                  styles.uploadSourceCloudIcon,
                  { backgroundColor: 'rgba(66, 133, 244, 0.12)' }
                ]}>
                  <View style={styles.googleDriveIcon}>
                    <View style={[styles.gDriveTriangle, { backgroundColor: BRAND_COLORS.googleBlue }]} />
                    <View style={[styles.gDriveTriangle, styles.gDriveYellow, { borderBottomColor: BRAND_COLORS.googleYellow }]} />
                    <View style={[styles.gDriveTriangle, styles.gDriveGreen, { borderBottomColor: BRAND_COLORS.googleGreen }]} />
                  </View>
                </View>
                <Typography 
                  variant="caption1" 
                  weight="medium" 
                  color={colors.textPrimary}
                  style={styles.uploadSourceCloudLabel}
                >
                  Google Drive
                </Typography>
              </Pressable>

              {/* Dropbox */}
              <Pressable 
                style={({ pressed }) => [
                  styles.uploadSourceCloudOption,
                  {
                    backgroundColor: theme.dark 
                      ? 'rgba(255, 255, 255, 0.06)' 
                      : 'rgba(0, 0, 0, 0.02)',
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                    opacity: pressed ? 0.9 : 1,
                  }
                ]}
                testID="reports-source-dropbox"
                onPress={() => handleOptionPress(handleUploadFromDropbox)}
              >
                <View style={[
                  styles.uploadSourceCloudIcon,
                  { backgroundColor: 'rgba(0, 97, 255, 0.12)' }
                ]}>
                  <View style={styles.dropboxIcon}>
                    <View style={[styles.dropboxDiamond, { backgroundColor: BRAND_COLORS.dropboxBlue }]} />
                  </View>
                </View>
                <Typography 
                  variant="caption1" 
                  weight="medium" 
                  color={colors.textPrimary}
                  style={styles.uploadSourceCloudLabel}
                >
                  Dropbox
                </Typography>
              </Pressable>
            </View>
          </View>

          {/* Cancel button - iOS style */}
          <Pressable 
            testID="reports-upload-cancel"
            style={({ pressed }) => [
              styles.uploadSourceCancelButton,
              {
                backgroundColor: theme.dark 
                  ? 'rgba(255, 255, 255, 0.1)' 
                  : 'rgba(0, 0, 0, 0.05)',
                opacity: pressed ? 0.7 : 1,
              }
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowUploadSourceModal(false);
            }}
          >
            <Typography variant="body" weight="semibold" color={colors.primary}>
              Cancel
            </Typography>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );

  // Show loading state while data is being fetched
  if (isDataLoading) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            showBackButton={router.canGoBack()}
            onBackPress={() => router.back()}
            rightElement={<SettingsGearButton />}
            onNotificationPress={() => router.push('/notifications')}
            onProfilePress={() => router.push('/profile')}
          />
          <View style={styles.noHouseholdContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Typography
              variant="body"
              align="center"
              style={styles.emptyText}
              color={colors.textSecondary}
            >
              Loading...
            </Typography>
          </View>
        </View>
      </AppBackground>
    );
  }

  if (!currentHousehold) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            showBackButton={router.canGoBack()}
            onBackPress={() => router.back()}
            rightElement={<SettingsGearButton />}
            onNotificationPress={() => router.push('/notifications')}
            onProfilePress={() => router.push('/profile')}
          />
          <View style={styles.noHouseholdContainer}>
            <Typography variant="title3" weight="semibold" align="center" color={colors.textPrimary}>
              No Home Selected
            </Typography>
            <Typography
              variant="body"
              align="center"
              style={styles.emptyText}
              color={colors.textSecondary}
            >
              Create or select a home to view reports
            </Typography>
          </View>
        </View>
      </AppBackground>
    );
  }

  return (
      <AppBackground opacity={0.5}>
      <View style={styles.container} testID="reports-screen">
          <ScreenHeader
            showBackButton={router.canGoBack()}
            onBackPress={() => router.back()}
            rightElement={<SettingsGearButton />}
            onNotificationPress={() => router.push('/notifications')}
            onProfilePress={() => router.push('/profile')}
          />

        <AdaptiveContainer maxWidth={isTablet ? 1400 : undefined} padding={containerPadding}>
          {shouldUseSplitView ? (
            <SplitView
              master={renderReportsList()}
              detail={<View style={styles.detailPanel}>{renderDetailPanel()}</View>}
              masterRatio={0.46}
              masterMinWidth={420}
              masterMaxWidth={620}
            />
          ) : (
            renderReportsList()
          )}
        </AdaptiveContainer>

        <FloatingActionButton
          title="Upload Report"
          onPress={handleUploadButtonPress}
          disabled={isUploading}
          maxWidth={fabMaxWidth}
          testID="reports-upload-fab"
        />

        {renderUploadModal()}
        {renderUploadSourceModal()}

        {/* Cloud File Picker */}
        <CloudFilePicker
          visible={showCloudPicker}
          provider={cloudProvider}
          mimeTypeFilter="application/pdf"
          onClose={() => setShowCloudPicker(false)}
          onFileSelected={handleCloudFileSelected}
        />

        {/* AI Disclaimer Modal - One-time consent */}
        <AIDisclaimerModal
          visible={showAIDisclaimer}
          onAccept={handleDisclaimerAccept}
          onDecline={handleDisclaimerDecline}
          feature="report_analysis"
        />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  listContent: {
    paddingTop: 0,
    flexGrow: 1,
    backgroundColor: 'transparent',
  },
  row: {
    gap: 16,
  },
  detailPanel: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  detailPanelEmpty: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  detailPanelEmptyText: {
    marginTop: 8,
    lineHeight: 22,
  },
  detailPanelCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  detailMeta: {
    marginTop: 6,
  },
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailStatus: {
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  detailActionButton: {
    marginTop: 20,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportCard: {
    minHeight: 120,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reportIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  reportInfo: {
    flex: 1,
  },
  reportSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  reportMeta: {
    marginTop: 12,
    marginLeft: 60,
  },
  reportMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reportActions: {
    flexDirection: 'row',
    marginTop: 12,
    marginLeft: 60,
    gap: 16,
  },
  actionButton: {
    paddingVertical: 4,
  },
  processingContainer: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    gap: 10,
  },
  processingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  processingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(78, 205, 196, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  processingTextContainer: {
    flex: 1,
  },
  processingTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  progressBarSmall: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFillSmall: {
    height: '100%',
    borderRadius: 3,
  },
  failedContainer: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    gap: 12,
  },
  failedContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  failedIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  failedTextContainer: {
    flex: 1,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  retryButtonDisabled: {
    opacity: 0.5,
  },
  retryButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    marginTop: 8,
  },
  noHouseholdContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    padding: 24,
    borderRadius: 16,
  },
  modalText: {
    marginTop: 8,
    marginBottom: 16,
  },
  progressContainer: {
    alignItems: 'center',
    gap: 8,
  },
  progressBar: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  deleteAction: {
    width: 80,
    marginLeft: 8,
  },
  deleteButton: {
    flex: 1,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButtonDisabled: {
    opacity: 0.5,
  },
  deleteButtonLabel: {
    marginTop: 4,
  },
  // Upload Source Modal Styles - iOS 26 Modern
  uploadSourceModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  uploadSourceModalContent: {
    width: '100%',
    maxWidth: 500,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: palette.system.black,
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
      },
      android: {
        elevation: 24,
      },
    }),
  },
  uploadSourceModalHandle: {
    width: 40,
    height: 5,
    backgroundColor: 'rgba(128, 128, 128, 0.4)',
    borderRadius: 2.5,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  uploadSourceModalHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  uploadSourceHeaderIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  uploadSourceHeaderIconGradient: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadSourceModalTitle: {
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  uploadSourceModalSubtitle: {
    opacity: 0.7,
  },
  uploadSourceOptions: {
    gap: 12,
  },
  uploadSourceOptionModern: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.1)',
  },
  uploadSourceIconModern: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  uploadSourceIconGradient: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadSourceTextContainer: {
    flex: 1,
    gap: 2,
  },
  uploadSourceChevron: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadSourceDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 16,
  },
  uploadSourceDividerLine: {
    flex: 1,
    height: 1,
  },
  uploadSourceDividerText: {
    marginHorizontal: 12,
    letterSpacing: 1,
  },
  uploadSourceCloudRow: {
    flexDirection: 'row',
    gap: 12,
  },
  uploadSourceCloudOption: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.08)',
  },
  uploadSourceCloudIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  uploadSourceCloudLabel: {
    textAlign: 'center',
  },
  // Google Drive icon styles
  googleDriveIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gDriveTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    position: 'absolute',
  },
  gDriveYellow: {
    backgroundColor: 'transparent',
    transform: [{ rotate: '120deg' }, { translateX: 4 }],
  },
  gDriveGreen: {
    backgroundColor: 'transparent',
    transform: [{ rotate: '240deg' }, { translateX: -4 }],
  },
  // Dropbox icon styles
  dropboxIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropboxDiamond: {
    width: 16,
    height: 16,
    transform: [{ rotate: '45deg' }],
    borderRadius: 3,
  },
  uploadSourceCancelButton: {
    marginTop: 20,
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
});
