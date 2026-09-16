import { useRouter } from 'expo-router';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';

import { taskDraftsApi } from '@api';
import { reportsApi, Report, ReportSummary, Finding, ActionPlan } from '@api/reports';
import { SafeAreaView, AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, screenScrollViewStyle } from '@components/common';
import { PDFViewerModal } from '@components/reports/PDFViewerModal';
import { Card, Typography, Button } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useIsModalSheet } from '@navigation/presentation';
import type { ReportsStackScreenProps } from '@navigation/types';
import { pdfCache } from '@services/pdfCache';
import { showToast } from '@services/toastManager';
import { CornerRadius, IconSize, Layout, Opacity, Spacing, useAppColors, type AppColors } from '@theme';
import { getSystemCategoryIcon, type IoniconName } from '@utils/categoryIcons';


/** Apply an alpha channel to a solid `#RRGGBB` color. */
function withAlpha(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return hex;
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type PersonaType = 'novice' | 'diy' | 'technical' | 'executive';

const PERSONA_CONFIG: Record<PersonaType, { label: string; icon: IoniconName; description: string }> = {
  novice: {
    label: 'Homeowner',
    icon: 'home',
    description: 'Simple explanations for first-time homeowners',
  },
  diy: {
    label: 'DIY',
    icon: 'construct',
    description: 'Detailed guidance with DIY options',
  },
  technical: {
    label: 'Technical',
    icon: 'settings',
    description: 'In-depth technical details',
  },
  executive: {
    label: 'Executive',
    icon: 'bar-chart',
    description: 'High-level summary and priorities',
  },
};

const getSeverityConfig = (
  colors: AppColors
): Record<string, { label: string; color: string; bgColor: string }> => ({
  critical: { label: 'Critical', color: colors.error, bgColor: colors.destructiveSubtle },
  major: { label: 'Major', color: colors.warning, bgColor: colors.warning + '22' },
  minor: { label: 'Minor', color: colors.warning, bgColor: colors.warning + '22' },
  informational: { label: 'Info', color: colors.info, bgColor: colors.info + '22' },
});

export function ReportDetailScreen({
  route,
  navigation,
}: ReportsStackScreenProps<'ReportDetail'>) {  const colors = useAppColors();
  // Registered with `useModalPresentation`, so this screen is a card on iPhone
  // and a form sheet on iPad — where its header must not re-apply the window's
  // status-bar inset inside the panel. Derived, never hardcoded (see the hook).
  const insideSheet = useIsModalSheet('card');
  const router = useRouter();
  const { householdId, reportId } = route.params;
  const SEVERITY_CONFIG = getSeverityConfig(colors);

  const [report, setReport] = useState<Report | null>(null);
  const [summaries, setSummaries] = useState<ReportSummary[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [actionPlans, setActionPlans] = useState<ActionPlan[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<PersonaType>('novice');
  const [activeTab, setActiveTab] = useState<'summary' | 'findings' | 'actions'>('summary');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskDraftsCount, setTaskDraftsCount] = useState(0);
  const [criticalDraftsCount, setCriticalDraftsCount] = useState(0);

  // PDF Viewer state
  const [pdfViewerVisible, setPdfViewerVisible] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const handleFindContractors = useCallback((item: { id: string; title: string; description: string }, systemCategory?: string) => {
    // Navigate to the Contractors tab's search screen using expo-router
    router.push({
      pathname: '/contractors',
      params: {
        screen: 'ContractorSearch',
        problemTitle: item.title,
        problemDescription: item.description || item.title,
        systemCategory: systemCategory || 'other',
        sourceType: 'task',
        sourceId: item.id,
      },
    });
  }, [router]);

  const handleViewTaskDrafts = useCallback(() => {
    // Navigate to TaskDrafts screen with this report's ID
    router.push({
      pathname: '/tasks',
      params: {
        screen: 'TaskDrafts',
        reportId: reportId,
      },
    });
  }, [router, reportId]);

  const handleViewFullReport = useCallback(async () => {
    if (!report) return;

    setLoadingPdf(true);
    try {
      // Check cache first
      const cachedPath = await pdfCache.getCachedPdf(reportId);

      if (cachedPath) {
        console.log('[ReportDetail] Using cached PDF:', cachedPath);
        setPdfUrl(cachedPath);
        setPdfViewerVisible(true);
      } else {
        // Fetch PDF URL from backend
        const pdfData = await reportsApi.getPdfUrl(householdId, reportId);

        // Show warning for large files
        if (report.file_size > 50 * 1024 * 1024) {
          const sizeMB = (report.file_size / (1024 * 1024)).toFixed(1);
          showToast(
            'info',
            `Large PDF (${sizeMB}MB) - download may take a moment`
          );
        }

        // Download and cache
        const localPath = await pdfCache.downloadAndCache(
          reportId,
          pdfData.url,
          (bytesWritten, contentLength) => {
            const progress = Math.round((bytesWritten / contentLength) * 100);
            if (progress % 20 === 0) {
              console.log(`[ReportDetail] Downloading PDF: ${progress}%`);
            }
          }
        );

        console.log('[ReportDetail] PDF downloaded and cached:', localPath);
        setPdfUrl(localPath);
        setPdfViewerVisible(true);
      }
    } catch (error) {
      console.error('[ReportDetail] Failed to load PDF:', error);
      showToast('error', 'Failed to load PDF. Please try again.');
    } finally {
      setLoadingPdf(false);
    }
  }, [report, reportId, householdId]);

  const loadReportData = useCallback(async () => {
    console.log('[ReportDetailScreen] Loading data for:', { householdId, reportId });
    try {
      setError(null);

      const [reportData, summariesData, findingsData, actionPlansData] = await Promise.all([
        reportsApi.get(householdId, reportId),
        reportsApi.getSummaries(householdId, reportId),
        reportsApi.getFindings(householdId, reportId),
        reportsApi.getActionPlans(householdId, reportId),
      ]);

      console.log('[ReportDetailScreen] Data loaded:', {
        report: reportData.report?.id,
        summaries: summariesData.summaries?.length,
        findings: findingsData.findings?.length,
        actionPlans: actionPlansData.action_plans?.length,
      });

      setReport(reportData.report);
      setSummaries(summariesData.summaries);
      setFindings(findingsData.findings);
      setActionPlans(actionPlansData.action_plans);

      // Fetch task drafts summary for this report
      try {
        const draftsData = await taskDraftsApi.getSummary(householdId, reportId);
        setTaskDraftsCount(draftsData.total);
        setCriticalDraftsCount(draftsData.by_severity?.critical || 0);
      } catch (draftsErr) {
        // Task drafts may not exist yet, don't fail the whole load
        console.log('[ReportDetailScreen] Task drafts not available:', draftsErr);
        setTaskDraftsCount(0);
        setCriticalDraftsCount(0);
      }
    } catch (err) {
      console.error('[ReportDetailScreen] Error loading data:', err);
      const message = err instanceof Error ? err.message : 'Failed to load report';
      setError(message);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [householdId, reportId]);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadReportData();
  };

  const selectedSummary = summaries.find((s) => s.summary_type === selectedPersona);

  const renderPersonaSelector = () => (
    <View style={styles.personaSelector}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.personaScrollContent}
      >
        {(Object.keys(PERSONA_CONFIG) as PersonaType[]).map((persona) => {
          const config = PERSONA_CONFIG[persona];
          const isSelected = selectedPersona === persona;

          return (
            <TouchableOpacity
              key={persona}
              onPress={() => setSelectedPersona(persona)}
              style={[
                styles.personaChip,
                {
                  backgroundColor: isSelected ? colors.primary : colors.backgroundSecondary,
                  borderColor: isSelected ? colors.primary : colors.borderColor,
                },
              ]}
            >
              <Icon
                name={config.icon}
                size={16}
                color={isSelected ? colors.white : colors.textPrimary}
              />
              <Typography
                variant="body"
                weight={isSelected ? 'semibold' : 'regular'}
                color={isSelected ? colors.white : colors.textPrimary}
              >
                {config.label}
              </Typography>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const renderSummary = () => {
    if (!selectedSummary) {
      return (
        <Card variant="outlined" style={styles.card}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            Summary not available for this view
          </Typography>
        </Card>
      );
    }

    return (
      <Card variant="outlined" style={styles.card}>
        {selectedSummary.overall_condition && (
          <View style={[styles.conditionBadge, { backgroundColor: colors.info + '22' }]}>
            <Typography variant="caption1" weight="semibold" color={colors.primary}>
              Overall Condition: {selectedSummary.overall_condition.toUpperCase()}
            </Typography>
          </View>
        )}

        <Typography variant="body" color={colors.textPrimary} style={styles.summaryText}>
          {selectedSummary.summary_text}
        </Typography>

        {selectedSummary.key_concerns && selectedSummary.key_concerns.length > 0 && (
          <View style={styles.section}>
            <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
              Key Concerns
            </Typography>
            {selectedSummary.key_concerns.map((concern, index) => (
              <View key={index} style={styles.bulletPoint}>
                <Typography variant="body" color={colors.textPrimary}>
                  • {concern}
                </Typography>
              </View>
            ))}
          </View>
        )}

        {selectedSummary.immediate_actions && selectedSummary.immediate_actions.length > 0 && (
          <View style={styles.section}>
            <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
              Immediate Attention
            </Typography>
            {selectedSummary.immediate_actions.map((action, index) => (
              <View key={index} style={styles.bulletPoint}>
                <Typography variant="body" color={colors.textPrimary}>
                  • {action}
                </Typography>
              </View>
            ))}
          </View>
        )}

      </Card>
    );
  };

  const renderFindings = () => {
    if (findings.length === 0) {
      return (
        <Card variant="outlined" style={styles.card}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            No findings available
          </Typography>
        </Card>
      );
    }

    const groupedFindings = findings.reduce((acc, finding) => {
      if (!acc[finding.system_category]) {
        acc[finding.system_category] = [];
      }
      acc[finding.system_category].push(finding);
      return acc;
    }, {} as Record<string, Finding[]>);

    return (
      <View style={styles.findingsContainer}>
        {Object.entries(groupedFindings).map(([category, categoryFindings]) => (
          <View key={category} style={styles.categorySection}>
            <View style={styles.categoryTitleRow}>
              <Icon name={getSystemCategoryIcon(category)} size={IconSize.sm} color={colors.textPrimary} />
              <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.categoryTitle}>
                {category.replace(/_/g, ' ').toUpperCase()}
              </Typography>
            </View>
            {categoryFindings.map((finding) => {
              const severityConfig = SEVERITY_CONFIG[finding.severity] || SEVERITY_CONFIG.informational;

              return (
                <Card key={finding.id} variant="outlined" style={styles.findingCard}>
                  <View style={styles.findingHeader}>
                    <View style={{ flex: 1 }}>
                      <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                        {finding.title}
                      </Typography>
                    </View>
                    <View
                      style={[
                        styles.severityBadge,
                        { backgroundColor: severityConfig.bgColor },
                      ]}
                    >
                      <Typography
                        variant="caption2"
                        weight="medium"
                        color={severityConfig.color}
                      >
                        {severityConfig.label}
                      </Typography>
                    </View>
                  </View>

                  {finding.plain_language_summary && (
                    <Typography
                      variant="body"
                      color={colors.textSecondary}
                      style={styles.findingDescription}
                    >
                      {finding.plain_language_summary}
                    </Typography>
                  )}

                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.findingDescription}
                  >
                    {finding.description}
                  </Typography>

                  {finding.evidence_page_numbers && finding.evidence_page_numbers.length > 0 && (
                    <View style={styles.evidencePagesRow}>
                      <Icon name="document-text-outline" size={14} color={colors.textSecondary} />
                      <Typography variant="caption1" color={colors.textSecondary}>
                        Pages: {finding.evidence_page_numbers.join(', ')}
                      </Typography>
                    </View>
                  )}
                </Card>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  const TIMEFRAME_CONFIG: Record<string, { label: string; icon: IoniconName }> = {
    '0-30_days': { label: 'Immediate (0-30 days)', icon: 'alert-circle' },
    '3-6_months': { label: '3-6 Months', icon: 'calendar' },
    '1_year': { label: 'Within 1 Year', icon: 'calendar' },
    '2-5_years': { label: '2-5 Years', icon: 'calendar-outline' },
    '5-10_years': { label: '5-10 Years', icon: 'home' },
  };

  const PRIORITY_CONFIG: Record<string, { color: string; bgColor: string }> = {
    critical: { color: colors.error, bgColor: colors.destructiveSubtle },
    high: { color: colors.warning, bgColor: colors.warning + '22' },
    medium: { color: colors.warning, bgColor: colors.warning + '22' },
    low: { color: colors.success, bgColor: colors.success + '22' },
  };

  const renderActionPlans = () => {
    if (actionPlans.length === 0) {
      return (
        <Card variant="outlined" style={styles.card}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            No action plans available yet
          </Typography>
        </Card>
      );
    }

    // Sort by timeframe order
    const timeframeOrder = ['0-30_days', '3-6_months', '1_year', '2-5_years', '5-10_years'];
    const sortedPlans = [...actionPlans].sort(
      (a, b) => timeframeOrder.indexOf(a.timeframe) - timeframeOrder.indexOf(b.timeframe)
    );

    return (
      <View style={styles.findingsContainer}>
        {sortedPlans.map((plan) => {
          const timeframeConfig =
            TIMEFRAME_CONFIG[plan.timeframe] || { label: plan.timeframe, icon: 'list' as IoniconName };

          return (
            <View key={plan.id} style={styles.categorySection}>
              <View style={styles.categoryTitleRow}>
                <Icon name={timeframeConfig.icon} size={IconSize.sm} color={colors.textPrimary} />
                <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.categoryTitle}>
                  {timeframeConfig.label}
                </Typography>
              </View>
              
              {plan.items.map((item) => {
                const priorityConfig = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
                
                return (
                  <Card key={item.id} variant="outlined" style={styles.findingCard}>
                    <View style={styles.findingHeader}>
                      <View style={{ flex: 1 }}>
                        <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                          {item.title}
                        </Typography>
                      </View>
                      <View
                        style={[
                          styles.severityBadge,
                          { backgroundColor: priorityConfig.bgColor },
                        ]}
                      >
                        <Typography
                          variant="caption2"
                          weight="medium"
                          color={priorityConfig.color}
                        >
                          {item.priority.toUpperCase()}
                        </Typography>
                      </View>
                    </View>
                    
                    <Typography
                      variant="body"
                      color={colors.textSecondary}
                      style={styles.findingDescription}
                    >
                      {item.description}
                    </Typography>
                    
                    {item.status && (
                      <Typography variant="caption1" color={colors.textSecondary}>
                        Status: {item.status}
                      </Typography>
                    )}

                    {/* Find Contractors Button */}
                    <TouchableOpacity
                      style={[
                        styles.findContractorsButton,
                        { backgroundColor: colors.primary + '15' },
                      ]}
                      onPress={() => handleFindContractors(item)}
                    >
                      <Icon name="search" size={14} color={colors.primary} />
                      <Typography variant="caption1" color={colors.primary}>
                        Find Contractors
                      </Typography>
                    </TouchableOpacity>
                  </Card>
                );
              })}
            </View>
          );
        })}
      </View>
    );
  };

  const renderTabSelector = () => (
    <View style={styles.tabSelector}>
      {(['summary', 'findings', 'actions'] as const).map((tab) => {
        const isSelected = activeTab === tab;
        const labels = {
          summary: 'Summary',
          findings: `Findings (${findings.length})`,
          actions: `Actions (${actionPlans.reduce((sum, p) => sum + p.items.length, 0)})`,
        };
        
        return (
          <TouchableOpacity
            key={tab}
            testID={`report-detail-tab-${tab}`}
            onPress={() => setActiveTab(tab)}
            style={[
              styles.tabButton,
              {
                backgroundColor: isSelected ? colors.primary : 'transparent',
                borderColor: isSelected ? colors.primary : colors.borderColor,
              },
            ]}
          >
            <Typography
              variant="subheadline"
              weight={isSelected ? 'semibold' : 'regular'}
              color={isSelected ? colors.white : colors.textPrimary}
            >
              {labels[tab]}
            </Typography>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (isLoading) {
    return (
      <AppBackground opacity={0.5}>
        <SafeAreaView>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Typography variant="body" color={colors.white} style={styles.loadingText}>
              Loading report...
            </Typography>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  if (error || !report) {
    return (
      <AppBackground opacity={0.5}>
        <SafeAreaView>
          <View style={styles.errorContainer}>
            <Typography variant="title3" weight="semibold" align="center" color={colors.white}>
              {error || 'Report not found'}
            </Typography>
            <Button
              title="Go Back"
              onPress={() => navigation.goBack()}
              style={styles.errorButton}
            />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView edges={[]}>
        <View style={styles.container} testID="report-detail-screen">
          <ScreenHeader
            title={report.filename}
            showBackButton
            onBackPress={() => navigation.goBack()}
            backButtonColor={colors.white}
            showNotificationBell={false}
            showAvatar={false}
            insideSheet={insideSheet}
            rightElement={
              <TouchableOpacity
                onPress={handleViewFullReport}
                disabled={loadingPdf}
                style={styles.pdfButton}
              >
                <Icon
                  name="document-text"
                  size={IconSize.lg}
                  color={loadingPdf ? withAlpha(colors.white, Opacity.onGradientDisabled) : colors.white}
                />
              </TouchableOpacity>
            }
          />

          <ScrollView
            style={[screenScrollViewStyle.scroll, styles.scrollView]}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
          >
            {renderTabSelector()}

            {/* Task Drafts Banner */}
            {taskDraftsCount > 0 && (
              <TouchableOpacity
                style={[
                  styles.taskDraftsBanner,
                  {
                    backgroundColor: criticalDraftsCount > 0
                      ? colors.destructiveSubtle
                      : colors.primary + '15',
                    borderColor: criticalDraftsCount > 0
                      ? colors.error
                      : colors.primary,
                  },
                ]}
                onPress={handleViewTaskDrafts}
              >
                <View style={styles.taskDraftsBannerContent}>
                  <View style={styles.taskDraftsBannerLeft}>
                    <View style={styles.taskDraftsTitleRow}>
                      <Icon
                        name={criticalDraftsCount > 0 ? 'alert-circle' : 'document-text'}
                        size={18}
                        color={criticalDraftsCount > 0 ? colors.error : colors.primary}
                      />
                      <Typography
                        variant="headline"
                        weight="semibold"
                        color={criticalDraftsCount > 0 ? colors.error : colors.primary}
                      >
                        {taskDraftsCount} Task Draft{taskDraftsCount !== 1 ? 's' : ''} Ready
                      </Typography>
                    </View>
                    <Typography
                      variant="caption1"
                      color={criticalDraftsCount > 0 ? colors.error : colors.textSecondary}
                    >
                      {criticalDraftsCount > 0
                        ? `${criticalDraftsCount} critical issue${criticalDraftsCount !== 1 ? 's' : ''} need attention`
                        : 'Review and add to your task list'}
                    </Typography>
                  </View>
                  <Icon
                    name="chevron-forward"
                    size={20}
                    color={criticalDraftsCount > 0 ? colors.error : colors.primary}
                  />
                </View>
              </TouchableOpacity>
            )}

            {activeTab === 'summary' && renderPersonaSelector()}

            <View style={styles.content}>
              {activeTab === 'summary' && (
                <>
                  <Typography variant="title2" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
                    AI Summary
                  </Typography>
                  {renderSummary()}
                </>
              )}

              {activeTab === 'findings' && (
                <>
                  <Typography variant="title2" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
                    Findings ({findings.length})
                  </Typography>
                  {renderFindings()}
                </>
              )}

              {activeTab === 'actions' && (
                <>
                  <Typography variant="title2" weight="semibold" color={colors.textPrimary} style={styles.sectionTitle}>
                    Action Plans
                  </Typography>
                  {renderActionPlans()}
                </>
              )}
            </View>
            <ScreenScrollEnd testID={screenScrollEndTestId('report-detail-screen')} />
          </ScrollView>
        </View>

        {/* PDF Viewer Modal */}
        {pdfUrl && (
          <PDFViewerModal
            visible={pdfViewerVisible}
            onClose={() => {
              setPdfViewerVisible(false);
              setPdfUrl(null);
            }}
            pdfUrl={pdfUrl}
            initialPage={1}
            reportTitle={report?.filename}
          />
        )}
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerInfo: {
    flex: 1,
  },
  pdfButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.sm,
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
    backgroundColor: 'transparent',
    maxWidth: Layout.readingMaxWidth,
    width: '100%',
    alignSelf: 'center',
  },
  personaSelector: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: Spacing.md,
  },
  personaScrollContent: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  personaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.xl,
    borderWidth: 1,
  },
  tabSelector: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  tabButton: {
    flex: 1,
    paddingVertical: Spacing.smd,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  taskDraftsBanner: {
    marginHorizontal: Spacing.xl,
    marginVertical: Spacing.md,
    paddingVertical: Spacing.md + Spacing.xxs,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  taskDraftsBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskDraftsBannerLeft: {
    flex: 1,
    gap: Spacing.xs,
  },
  taskDraftsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  content: {
    padding: Spacing.xl,
    backgroundColor: 'transparent',
  },
  sectionTitle: {
    marginBottom: Spacing.base,
  },
  card: {
    padding: Spacing.base,
    marginBottom: Spacing.xl,
  },
  conditionBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + Spacing.xxs,
    borderRadius: CornerRadius.sm,
    marginBottom: Spacing.base,
  },
  summaryText: {
    marginBottom: Spacing.base,
    lineHeight: 24,
  },
  section: {
    marginTop: Spacing.base,
  },
  bulletPoint: {
    marginTop: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  findingsContainer: {
    gap: Spacing.xl,
  },
  categorySection: {
    marginBottom: Spacing.sm,
  },
  categoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  categoryTitle: {},
  findingCard: {
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  evidencePagesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  findingHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  severityBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.xs,
  },
  findingDescription: {
    marginBottom: Spacing.sm,
    lineHeight: 20,
  },
  findContractorsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    marginTop: Spacing.smd,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.sm,
    alignSelf: 'flex-start',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.base,
  },
  loadingText: {
    marginTop: Spacing.sm,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
    gap: Spacing.xl,
  },
  errorButton: {
    minWidth: 160,
  },
});
