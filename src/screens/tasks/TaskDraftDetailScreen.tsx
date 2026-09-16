import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRouter } from 'expo-router';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl, Image, useWindowDimensions, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { reportsApi } from '@api/reports';
import { taskDraftsApi, TaskDraftWithRelations, ConvertDraftRequest } from '@api/task-drafts';
import { AppBackground, ScreenFooterGlass, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { PDFViewerModal } from '@components/reports/PDFViewerModal';
import { Typography, Button, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { TasksStackParamList } from '@navigation/types';
import { pdfCache } from '@services/pdfCache';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskDraftStore } from '@stores/taskDraftStore';
import {
  ButtonMetrics,
  CornerRadius,
  GradientButton as GradientButtonSizes,
  Layout,
  Spacing,
  useAppColors,
} from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

type TaskDraftDetailRouteProp = RouteProp<TasksStackParamList, 'TaskDraftDetail'>;
type TaskDraftDetailNavigationProp = NativeStackNavigationProp<TasksStackParamList, 'TaskDraftDetail'>;

// Category icons
const CATEGORY_ICONS: Record<string, string> = {
  roof: 'home-outline',
  foundation: 'layers-outline',
  electrical: 'flash-outline',
  plumbing: 'water-outline',
  hvac: 'thermometer-outline',
  exterior: 'business-outline',
  interior: 'grid-outline',
  safety: 'shield-checkmark-outline',
  appliances: 'cube-outline',
  drainage: 'rainy-outline',
  attic: 'arrow-up-circle-outline',
  basement: 'arrow-down-circle-outline',
  garage: 'car-outline',
  insulation: 'layers-outline',
  windows_doors: 'apps-outline',
  structure: 'construct-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

// Timeframe config
const TIMEFRAME_CONFIG: Record<string, { label: string; icon: string }> = {
  '0-30_days': { label: 'Immediate (0-30 days)', icon: 'alert-circle' },
  '3-6_months': { label: 'Within 3-6 months', icon: 'calendar' },
  '1_year': { label: 'Within 1 year', icon: 'calendar-outline' },
  '2-5_years': { label: '2-5 years', icon: 'time-outline' },
  '5-10_years': { label: '5-10 years', icon: 'hourglass-outline' },
};

// DIY difficulty labels (color resolved from tokens at render time)
const DIY_DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  professional_only: 'Professional Only',
};

// Format cost in the user's display currency
function formatCost(cents: number | null): string {
  if (!cents) return 'N/A';
  return formatMoney(cents, { decimals: 2 });
}

// Format cost range
function formatCostRange(min: number | null, max: number | null): string {
  if (!min && !max) return 'Cost estimate unavailable';
  if (min && max) return `${formatCost(min)} - ${formatCost(max)}`;
  return formatCost(min || max);
}

export function TaskDraftDetailScreen() {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<TaskDraftDetailNavigationProp>();
  const route = useRoute<TaskDraftDetailRouteProp>();
  const router = useRouter(); // For cross-tab navigation
  const { draftId } = route.params;
  const insets = useSafeAreaInsets();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const { updateDraft, removeDraft } = useTaskDraftStore();
  const { width: windowWidth } = useWindowDimensions();

  // Consistent layout padding
  const { content: containerPadding } = useLayoutPadding();

  const [draft, setDraft] = useState<TaskDraftWithRelations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [addRecurring, setAddRecurring] = useState(false);
  const [showDismissModal, setShowDismissModal] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  // PDF Viewer state
  const [pdfViewerVisible, setPdfViewerVisible] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [loadingPdf, setLoadingPdf] = useState(false);

  // Fetch draft details
  const fetchDraft = useCallback(async () => {
    if (!currentHousehold?.id || !draftId) return;

    setIsLoading(true);
    try {
      const data = await taskDraftsApi.get(currentHousehold.id, draftId);
      setDraft(data);
    } catch (error) {
      console.error('Failed to fetch task draft:', error);
      showToast('error', 'Failed to load task draft');
      navigation.goBack();
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id, draftId, navigation]);

  useEffect(() => {
    fetchDraft();
  }, [fetchDraft]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDraft();
    setRefreshing(false);
  }, [fetchDraft]);

  // Handle convert to task
  const handleConvert = useCallback(async () => {
    if (!currentHousehold?.id || !draft) return;

    setIsConverting(true);
    try {
      const request: ConvertDraftRequest = {
        add_recurring: addRecurring,
        frequency: draft.suggested_frequency || undefined,
      };

      const result = await taskDraftsApi.convert(currentHousehold.id, draft.id, request);

      updateDraft(draft.id, { status: 'converted', converted_to_task_id: result.taskId || null });
      showToast('success', 'Task created successfully');
      navigation.goBack();
    } catch (error) {
      console.error('Failed to convert draft:', error);
      showToast('error', 'Failed to create task');
    } finally {
      setIsConverting(false);
    }
  }, [currentHousehold?.id, draft, addRecurring, updateDraft, navigation]);

  // Handle dismiss
  const handleDismiss = useCallback(async (reason?: string) => {
    if (!currentHousehold?.id || !draft) return;

    setIsDismissing(true);
    try {
      await taskDraftsApi.dismiss(currentHousehold.id, draft.id, { reason });

      removeDraft(draft.id);
      showToast('success', 'Task draft dismissed');
      navigation.goBack();
    } catch (error) {
      console.error('Failed to dismiss draft:', error);
      showToast('error', 'Failed to dismiss task draft');
    } finally {
      setIsDismissing(false);
      setShowDismissModal(false);
    }
  }, [currentHousehold?.id, draft, removeDraft, navigation]);

  // Handle find contractors
  const handleFindContractors = useCallback(() => {
    if (!draft || !currentHousehold) return;

    // Build enhanced navigation params with all metadata
    const params: Record<string, string> = {
      screen: 'ContractorSearch',
      problemTitle: draft.title,
      problemDescription: draft.description || draft.title,
      systemCategory: draft.system_category || 'other',
      sourceType: 'task_draft',
      sourceId: draft.id,
      // Enhanced metadata for better AI search
      severity: draft.severity || 'informational',
      // Pass full property address for location-aware search
      propertyAddress: currentHousehold.address_line1 || '',
    };

    // Add contractor category if available (from finding or task draft metadata)
    // This helps AI find government/municipal departments, inspectors, etc.
    if (draft.system_category === 'inspection') {
      params.contractorCategory = 'inspector';
    } else if (draft.system_category === 'government') {
      params.contractorCategory = 'government department';
    } else if (draft.system_category === 'municipal') {
      params.contractorCategory = 'city/municipal department';
    }

    // Add urgency score if available (converted from priority_score)
    if (draft.priority_score !== undefined && draft.priority_score !== null) {
      // Convert 0-100 scale to 1-10 scale
      const urgencyScore = Math.max(1, Math.min(10, Math.round(draft.priority_score / 10)));
      params.urgencyScore = String(urgencyScore);
    }

    // Add source page numbers if available (as JSON string)
    if (draft.source_page_numbers && draft.source_page_numbers.length > 0) {
      params.sourcePageNumbers = JSON.stringify(draft.source_page_numbers);
    }

    // Add source quotes if available (as JSON string)
    if (draft.source_quotes && draft.source_quotes.length > 0) {
      params.sourceQuotes = JSON.stringify(draft.source_quotes);
    }

    router.push({
      pathname: '/contractors',
      params,
    });
  }, [draft, currentHousehold, router]);

  // Handle page number press - open PDF at specific page
  const handlePageNumberPress = useCallback(
    async (pageNumber: number) => {
      if (!currentHousehold?.id || !draft?.report_id) return;

      setLoadingPdf(true);
      try {
        // Check cache first
        const cachedPath = await pdfCache.getCachedPdf(draft.report_id);

        if (cachedPath) {
          console.log('[TaskDraft] Using cached PDF:', cachedPath);
          setPdfUrl(cachedPath);
          setSelectedPage(pageNumber);
          setPdfViewerVisible(true);
        } else {
          // Fetch PDF URL from backend
          const pdfData = await reportsApi.getPdfUrl(currentHousehold.id, draft.report_id);

          // Download and cache
          const localPath = await pdfCache.downloadAndCache(
            draft.report_id,
            pdfData.url,
            (bytesWritten, contentLength) => {
              const progress = Math.round((bytesWritten / contentLength) * 100);
              console.log(`[TaskDraft] Downloading PDF: ${progress}%`);
            }
          );

          console.log('[TaskDraft] PDF downloaded and cached:', localPath);
          setPdfUrl(localPath);
          setSelectedPage(pageNumber);
          setPdfViewerVisible(true);
        }
      } catch (error) {
        console.error('[TaskDraft] Failed to load PDF:', error);
        showToast('error', 'Failed to load PDF. Please try again.');
      } finally {
        setLoadingPdf(false);
      }
    },
    [currentHousehold?.id, draft?.report_id]
  );

  // Handle view in report - open PDF at first cited page
  const handleViewInReport = useCallback(() => {
    if (!draft || !currentHousehold?.id) return;

    // If there are cited pages, open PDF at first page
    if (draft.source_page_numbers && draft.source_page_numbers.length > 0) {
      handlePageNumberPress(draft.source_page_numbers[0]);
    } else {
      // Fallback: navigate to report detail screen
      router.push({
        pathname: '/reports',
        params: {
          screen: 'ReportDetail',
          reportId: draft.report_id,
          householdId: currentHousehold.id,
        },
      });
    }
  }, [draft, currentHousehold?.id, handlePageNumberPress, router]);

  if (isLoading) {
    return (
      <AppBackground>
        <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Typography variant="body" color="secondary" style={styles.loadingText}>
            Loading task draft...
          </Typography>
        </View>
      </AppBackground>
    );
  }

  if (!draft) {
    return (
      <AppBackground>
        <View style={[styles.errorContainer, { paddingTop: insets.top }]}>
          <Icon name="alert-circle-outline" size={64} color={colors.textSecondary} />
          <Typography variant="headline" color="secondary" style={styles.errorText}>
            Task draft not found
          </Typography>
          <Button title="Go Back" onPress={() => navigation.goBack()} />
        </View>
      </AppBackground>
    );
  }

  const severityColors: Record<string, string> = {
    critical: colors.error,
    major: colors.warning,
    minor: colors.warning,
    informational: colors.info,
  };
  const severityBgColors: Record<string, string> = {
    critical: colors.destructiveSubtle,
    major: colors.statusSoonBg,
    minor: colors.statusSoonBg,
    informational: colors.surfaceSelected,
  };
  const diyDifficultyColors: Record<string, string> = {
    easy: colors.success,
    medium: colors.warning,
    hard: colors.error,
    professional_only: colors.info,
  };

  const severityColor = severityColors[draft.severity] || colors.textSecondary;
  const severityBgColor = severityBgColors[draft.severity] || colors.backgroundSecondary;
  const categoryIcon = CATEGORY_ICONS[draft.system_category] || 'help-circle-outline';
  const timeframeConfig = draft.suggested_timeframe
    ? TIMEFRAME_CONFIG[draft.suggested_timeframe]
    : null;
  const diyConfig = draft.diy_difficulty
    ? {
        label: DIY_DIFFICULTY_LABELS[draft.diy_difficulty],
        color: diyDifficultyColors[draft.diy_difficulty] || colors.textSecondary,
      }
    : null;

  return (
    <AppBackground>
      <View style={styles.container}>
        {/* Header */}
        <ScreenHeader
        title="Task Draft"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

        <ScrollView
          style={[screenScrollViewStyle.scroll, styles.scrollView]}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingHorizontal: containerPadding,
              paddingBottom: insets.bottom + 120,
              maxWidth: Layout.readingMaxWidth,
              width: '100%',
              alignSelf: 'center',
            },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
        >
          {/* Title Section */}
          <View style={styles.titleSection}>
            <View style={styles.categoryRow}>
              <View style={[styles.categoryBadge, { backgroundColor: colors.backgroundSecondary }]}>
                <Icon name={categoryIcon as any} size={16} color={colors.textSecondary} />
                <Typography variant="caption1" color="secondary" style={styles.categoryText}>
                  {draft.system_category.replace('_', ' ')}
                </Typography>
              </View>
              <View style={[styles.severityBadge, { backgroundColor: severityBgColor }]}>
                <Typography variant="caption1" weight="semibold" style={{ color: severityColor }}>
                  {draft.severity.toUpperCase()}
                </Typography>
              </View>
            </View>

            <Typography variant="title2" weight="bold" style={styles.title}>
              {draft.title}
            </Typography>

            {timeframeConfig && (
              <View style={styles.timeframeRow}>
                <Icon name={timeframeConfig.icon as any} size={16} color={colors.primary} />
                <Typography variant="footnote" style={{ color: colors.primary, marginLeft: 6 }}>
                  {timeframeConfig.label}
                </Typography>
              </View>
            )}
          </View>

          {/* Images Section */}
          {draft.images && draft.images.length > 0 && (
            <View style={styles.section}>
              <Typography variant="headline" weight="semibold" style={styles.sectionTitle}>
                Images from Report
              </Typography>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.imagesContainer}
              >
                {draft.images.map((image, index) => (
                  <TouchableOpacity
                    key={image.id}
                    style={styles.imageWrapper}
                    onPress={() => setSelectedImageIndex(index)}
                  >
                    <Image
                      source={{ uri: image.image_key }}
                      style={styles.thumbnail}
                      resizeMode="cover"
                    />
                    {image.page_number && (
                      <View style={[styles.pageNumberBadge, { backgroundColor: colors.primary }]}>
                        <Typography variant="caption2" style={{ color: colors.white }}>
                          p. {image.page_number}
                        </Typography>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* What's the Issue Section */}
          <Card style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="headline" weight="semibold" style={styles.cardTitle}>
              What's the Issue?
            </Typography>
            <Typography variant="body" style={styles.cardText}>
              {draft.plain_language_summary || draft.description || 'No description available.'}
            </Typography>
          </Card>

          {/* Why It Matters Section */}
          {draft.description && draft.plain_language_summary && (
            <Card style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="headline" weight="semibold" style={styles.cardTitle}>
                Technical Details
              </Typography>
              <Typography variant="body" color="secondary" style={styles.cardText}>
                {draft.description}
              </Typography>
            </Card>
          )}

          {/* Evidence Section */}
          {(draft.source_page_numbers?.length > 0 || draft.source_quotes?.length > 0) && (
            <Card style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="headline" weight="semibold" style={styles.cardTitle}>
                From the Report
              </Typography>

              {draft.source_quotes?.length > 0 && (
                <View style={styles.quotesContainer}>
                  {draft.source_quotes.map((quote, index) => (
                    <View
                      key={index}
                      style={[styles.quoteBox, { borderLeftColor: colors.primary }]}
                    >
                      <Typography variant="body" style={styles.quoteText}>
                        "{quote}"
                      </Typography>
                    </View>
                  ))}
                </View>
              )}

              {draft.source_page_numbers?.length > 0 && (
                <View style={styles.pageNumbersRow}>
                  <Icon name="document-text-outline" size={16} color={colors.textSecondary} />
                  <Typography variant="footnote" color="secondary" style={{ marginLeft: 6 }}>
                    Pages:
                  </Typography>
                  <View style={styles.pageChipsContainer}>
                    {draft.source_page_numbers.map((page) => (
                      <TouchableOpacity
                        key={page}
                        onPress={() => handlePageNumberPress(page)}
                        disabled={loadingPdf}
                        style={[
                          styles.pageChip,
                          {
                            backgroundColor: colors.primary + '20',
                            borderColor: colors.primary,
                          },
                        ]}
                        activeOpacity={0.7}
                      >
                        <Typography variant="footnote" color="primary" weight="medium">
                          {page}
                        </Typography>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={[styles.viewReportButton, { backgroundColor: colors.primary + '15' }]}
                onPress={handleViewInReport}
              >
                <Icon name="eye-outline" size={18} color={colors.primary} />
                <Typography variant="subheadline" style={{ color: colors.primary, marginLeft: 8 }}>
                  View in Report
                </Typography>
              </TouchableOpacity>
            </Card>
          )}

          {/* Cost Estimate Section */}
          <Card style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="headline" weight="semibold" style={styles.cardTitle}>
              Cost Estimate
            </Typography>

            {/* Professional Cost */}
            <View style={styles.costRow}>
              <View style={styles.costLabel}>
                <Icon name="briefcase-outline" size={20} color={colors.textSecondary} />
                <Typography variant="body" style={{ marginLeft: 8 }}>
                  Professional
                </Typography>
              </View>
              <Typography variant="headline" weight="semibold">
                {formatCostRange(draft.estimated_cost_min, draft.estimated_cost_max)}
              </Typography>
            </View>

            {/* DIY Cost */}
            {draft.diy_possible && (
              <View style={styles.costRow}>
                <View style={styles.costLabel}>
                  <Icon name="hammer-outline" size={20} color={colors.primary} />
                  <Typography variant="body" style={{ marginLeft: 8, color: colors.primary }}>
                    DIY
                  </Typography>
                </View>
                <Typography variant="headline" weight="semibold" style={{ color: colors.primary }}>
                  {formatCostRange(draft.diy_cost_min, draft.diy_cost_max)}
                </Typography>
              </View>
            )}

            {/* DIY Assessment */}
            {draft.diy_possible !== null && (
              <View style={[styles.diyAssessment, { borderTopColor: colors.borderColor }]}>
                {draft.diy_possible ? (
                  <>
                    <View style={[styles.diyBadge, { backgroundColor: colors.primary + '20' }]}>
                      <Icon name="checkmark-circle" size={18} color={colors.primary} />
                      <Typography variant="subheadline" style={{ color: colors.primary, marginLeft: 6 }}>
                        DIY Possible
                      </Typography>
                    </View>
                    {diyConfig && (
                      <View style={[styles.difficultyBadge, { backgroundColor: diyConfig.color + '20' }]}>
                        <Typography variant="caption1" style={{ color: diyConfig.color }}>
                          {diyConfig.label}
                        </Typography>
                      </View>
                    )}
                  </>
                ) : (
                  <View style={[styles.diyBadge, { backgroundColor: colors.destructiveSubtle }]}>
                    <Icon name="close-circle" size={18} color={colors.error} />
                    <Typography variant="subheadline" style={{ color: colors.error, marginLeft: 6 }}>
                      Professional Recommended
                    </Typography>
                  </View>
                )}
              </View>
            )}

            {/* Find Contractors Button */}
            <TouchableOpacity
              style={[styles.findContractorsButton, { borderColor: colors.primary }]}
              onPress={handleFindContractors}
            >
              <Icon name="search-outline" size={20} color={colors.primary} />
              <Typography variant="body" weight="semibold" style={{ color: colors.primary, marginLeft: 8 }}>
                Find Contractors
              </Typography>
            </TouchableOpacity>
          </Card>

          {/* Recurring Suggestion */}
          {draft.is_recurring_suggestion && draft.suggested_frequency && (
            <Card style={[styles.card, { backgroundColor: colors.primary + '10' }]}>
              <View style={styles.recurringHeader}>
                <Icon name="repeat" size={24} color={colors.primary} />
                <View style={styles.recurringContent}>
                  <Typography variant="headline" weight="semibold">
                    Recurring Maintenance Suggested
                  </Typography>
                  <Typography variant="body" color="secondary">
                    This issue suggests a {draft.suggested_frequency} maintenance task
                  </Typography>
                </View>
              </View>
            </Card>
          )}
        </ScrollView>

        {/* Action Buttons */}
        <View
          style={[
            styles.actionsContainer,
            { paddingHorizontal: containerPadding, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <ScreenFooterGlass />
          {/* Add Recurring Toggle */}
          {draft.is_recurring_suggestion && (
            <TouchableOpacity
              style={styles.recurringToggle}
              onPress={() => setAddRecurring(!addRecurring)}
            >
              <Icon
                name={addRecurring ? 'checkbox' : 'square-outline'}
                size={24}
                color={colors.primary}
              />
              <Typography variant="subheadline" style={{ marginLeft: 8 }}>
                Also add as recurring maintenance
              </Typography>
            </TouchableOpacity>
          )}

          <View style={styles.buttonsRow}>
            {/* Dismiss Button */}
            <TouchableOpacity
              style={[styles.dismissButton, { borderColor: colors.borderColor }]}
              onPress={() => setShowDismissModal(true)}
              disabled={isDismissing}
            >
              {isDismissing ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Typography variant="body" color="secondary">
                  Dismiss
                </Typography>
              )}
            </TouchableOpacity>

            {/* Add to Tasks Button */}
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={handleConvert}
              disabled={isConverting}
            >
              {isConverting ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Icon name="add" size={22} color={colors.white} />
                  <Typography variant="body" weight="semibold" style={{ color: colors.white, marginLeft: 6 }}>
                    Add to Tasks
                  </Typography>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Dismiss Modal */}
        <Modal
          visible={showDismissModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowDismissModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="title3" weight="semibold" style={styles.modalTitle}>
                Dismiss Task Draft
              </Typography>
              <Typography variant="body" color="secondary" style={styles.modalText}>
                Are you sure you want to dismiss this task draft? You can optionally provide a reason.
              </Typography>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, { borderColor: colors.borderColor }]}
                  onPress={() => setShowDismissModal(false)}
                >
                  <Typography variant="body">Cancel</Typography>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonPrimary, { backgroundColor: colors.error }]}
                  onPress={() => handleDismiss()}
                >
                  <Typography variant="body" weight="semibold" style={{ color: colors.white }}>
                    Dismiss
                  </Typography>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Image Viewer Modal */}
        {selectedImageIndex !== null && draft.images && (
          <Modal
            visible={selectedImageIndex !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setSelectedImageIndex(null)}
          >
            <View style={styles.imageViewerOverlay}>
              <TouchableOpacity
                style={styles.imageViewerClose}
                onPress={() => setSelectedImageIndex(null)}
              >
                <Icon name="close" size={32} color={colors.white} />
              </TouchableOpacity>
              <Image
                source={{ uri: draft.images[selectedImageIndex].image_key }}
                style={{ width: windowWidth, height: windowWidth }}
                resizeMode="contain"
              />
              {draft.images[selectedImageIndex].caption && (
                <View style={styles.imageCaption}>
                  <Typography variant="body" style={{ color: colors.white }}>
                    {draft.images[selectedImageIndex].caption}
                  </Typography>
                </View>
              )}
            </View>
          </Modal>
        )}

        {/* PDF Viewer Modal */}
        {pdfUrl && (
          <PDFViewerModal
            visible={pdfViewerVisible}
            onClose={() => {
              setPdfViewerVisible(false);
              setPdfUrl(null);
            }}
            pdfUrl={pdfUrl}
            initialPage={selectedPage}
            reportTitle={draft.finding ? `Report - Page ${selectedPage}` : undefined}
            citedPages={draft.source_page_numbers || []}
          />
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  errorText: {
    marginTop: 8,
    marginBottom: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
  },
  titleSection: {
    marginBottom: 24,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  categoryText: {
    marginLeft: 6,
    textTransform: 'capitalize',
  },
  severityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  title: {
    marginBottom: 8,
  },
  timeframeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  imagesContainer: {
    gap: 12,
    paddingRight: 24,
  },
  imageWrapper: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
  },
  thumbnail: {
    width: 160,
    height: 120,
    borderRadius: 12,
  },
  pageNumberBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  card: {
    padding: 16,
    marginBottom: 16,
    borderRadius: 12,
  },
  cardTitle: {
    marginBottom: 12,
  },
  cardText: {
    lineHeight: 22,
  },
  quotesContainer: {
    gap: 12,
    marginBottom: 16,
  },
  quoteBox: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 4,
  },
  quoteText: {
    fontStyle: 'italic',
  },
  pageNumbersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  pageChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginLeft: 8,
  },
  pageChip: {
    paddingHorizontal: Spacing.smd + Spacing.xs,
    paddingVertical: Spacing.sm + Spacing.xxs,
    borderRadius: CornerRadius.xxl,
    borderWidth: 1,
    minWidth: ButtonMetrics.minTapTarget,
    minHeight: ButtonMetrics.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewReportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  costLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  diyAssessment: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 16,
    marginTop: 4,
    borderTopWidth: 1,
    gap: 12,
  },
  diyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  difficultyBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  findContractorsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  recurringHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recurringContent: {
    marginLeft: 12,
    flex: 1,
  },
  actionsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // Tall enough that the glass fade begins well above the buttons, so its
    // top edge reads as transparent rather than a hard line over the content.
    paddingTop: 32,
    overflow: 'hidden',
  },
  recurringToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dismissButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: GradientButtonSizes.lg.paddingV,
    borderRadius: 12,
    borderWidth: 1,
  },
  addButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: GradientButtonSizes.lg.paddingV,
    borderRadius: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    padding: 24,
    borderRadius: 16,
  },
  modalTitle: {
    marginBottom: 12,
  },
  modalText: {
    marginBottom: 24,
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  modalButtonPrimary: {
    borderWidth: 0,
  },
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageViewerClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  fullImage: {
    width: '100%',
    aspectRatio: 1,
  },
  imageCaption: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
  },
});

export default TaskDraftDetailScreen;
