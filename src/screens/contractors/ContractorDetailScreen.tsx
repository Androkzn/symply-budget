import { useNavigation, useRoute, RouteProp, useFocusEffect } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, Linking, Alert, Animated } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import {
  contractorsApi,
  type ContractorDetail,
  type ContractorVisit,
  type ContractorDocument,
  SPECIALTY_INFO,
  type ContractorSpecialty,
} from '@api/contractors';
import { AppBackground, SafeAreaView, ScreenFooterGlass, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { DocumentViewerModal } from '@components/contractors/DocumentViewerModal';
import { ReceiptRequestModal } from '@components/contractors/ReceiptRequestModal';
import { Typography, GradientButton, StarRating, FavoriteStar, Toggle } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Opacity, Spacing, useAppColors } from '@theme';
import { getContractorCategoryIcon } from '@utils/categoryIcons';
import { formatMoney, useDisplayCurrency } from '@utils/money';

/** Apply an alpha channel to a solid `#RRGGBB` color. */
function withAlpha(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return hex;
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type AppColors = ReturnType<typeof useAppColors>;

type RouteParams = {
  ContractorDetail: {
    contractorId: string;
  };
};

// Format currency from cents, compactly ("CA$1.2k") in the display currency.
function formatCurrency(cents: number): string {
  return formatMoney(cents, { abbreviate: true });
}

function getVisitStatusColors(colors: AppColors): Record<string, { bg: string; text: string }> {
  return {
    scheduled: { bg: colors.accent + '20', text: colors.accent },
    completed: { bg: colors.success + '20', text: colors.success },
    cancelled: { bg: colors.error + '20', text: colors.error },
  };
}

type TabType = 'overview' | 'visits' | 'documents';

export function ContractorDetailScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const { theme } = useTheme();
  const colors = useAppColors();
  const visitStatusColors = getVisitStatusColors(colors);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'ContractorDetail'>>();
  const { currentHousehold } = useHouseholdStore();
  const { content: containerPadding } = useLayoutPadding();
  const contractorId = route.params?.contractorId;

  const [contractor, setContractor] = useState<ContractorDetail | null>(null);
  const [visits, setVisits] = useState<ContractorVisit[]>([]);
  const [documents, setDocuments] = useState<ContractorDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [error, setError] = useState<string | null>(null);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const [selectedDocument, setSelectedDocument] = useState<ContractorDocument | null>(null);
  const [showDocumentViewer, setShowDocumentViewer] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedVisitForReceipt, setSelectedVisitForReceipt] = useState<ContractorVisit | null>(null);
  const [updatingReceiptStatus, setUpdatingReceiptStatus] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!currentHousehold?.id || !contractorId) return;

    try {
      setError(null);
      const [contractorData, visitsData, documentsData] = await Promise.all([
        contractorsApi.getOne(currentHousehold.id, contractorId),
        contractorsApi.getContractorVisits(currentHousehold.id, contractorId),
        contractorsApi.getContractorDocuments(currentHousehold.id, contractorId),
      ]);
      setContractor(contractorData.contractor);
      setVisits(visitsData.visits.map((v) => ({ ...v, contractor: undefined })) as ContractorVisit[]);
      setDocuments(documentsData.documents);
    } catch (err) {
      console.error('Error loading contractor:', err);
      setError('Failed to load contractor details');
    }
  }, [currentHousehold?.id, contractorId]);

  useEffect(() => {
    setIsLoading(true);
    loadData().finally(() => setIsLoading(false));
  }, [loadData]);

  // Refresh data when screen comes into focus (e.g., after adding a visit)
  useFocusEffect(
    useCallback(() => {
      if (!isLoading) {
        loadData();
      }
    }, [loadData, isLoading])
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleCall = () => {
    if (contractor?.phone) {
      Linking.openURL(`tel:${contractor.phone}`);
    }
  };

  const handleEmail = () => {
    if (contractor?.email) {
      Linking.openURL(`mailto:${contractor.email}`);
    }
  };

  const handleWebsite = () => {
    if (contractor?.website) {
      Linking.openURL(contractor.website);
    }
  };

  const handleEdit = () => {
    (navigation as any).navigate('AddEditContractor', { contractor });
  };

  const handleAddVisit = () => {
    (navigation as any).navigate('AddVisit', { contractorId });
  };

  const handleEditVisit = (visit: ContractorVisit) => {
    (navigation as any).navigate('AddVisit', { 
      contractorId,
      visitId: visit.id,
      visit: {
        id: visit.id,
        visit_date: visit.visit_date,
        description: visit.description,
        cost: visit.cost,
        status: visit.status,
        notes: visit.notes,
        rating: visit.rating,
      },
    });
  };

  const handleToggleFavorite = async () => {
    if (!currentHousehold?.id || !contractor) return;
    try {
      await contractorsApi.toggleFavorite(currentHousehold.id, contractor.id, !contractor.is_favorite);
      await loadData();
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  };

  const handleReceiptToggle = async (visit: ContractorVisit, received: boolean) => {
    if (!currentHousehold?.id) return;
    setUpdatingReceiptStatus(visit.id);
    try {
      await contractorsApi.markReceiptReceived(currentHousehold.id, visit.id, received);
      
      // If marking as not received and no reminder task exists, offer to create one
      if (!received && !visit.receipt_reminder_task_id) {
        Alert.alert(
          'Create Reminder?',
          'Would you like to create a daily reminder task to request the receipt?',
          [
            { text: 'No', style: 'cancel' },
            {
              text: 'Yes',
              onPress: async () => {
                try {
                  await contractorsApi.createReceiptReminderTask(currentHousehold.id, visit.id);
                  Alert.alert('Success', 'Daily reminder created');
                } catch (err) {
                  console.error('Error creating reminder:', err);
                }
                await loadData();
              },
            },
          ]
        );
      }
      await loadData();
    } catch (err) {
      console.error('Error updating receipt status:', err);
      Alert.alert('Error', 'Failed to update receipt status');
    } finally {
      setUpdatingReceiptStatus(null);
    }
  };

  const handleRequestReceipt = (visit: ContractorVisit) => {
    setSelectedVisitForReceipt(visit);
    setShowReceiptModal(true);
  };

  const handleReceiptRequestSent = async () => {
    setShowReceiptModal(false);
    setSelectedVisitForReceipt(null);
    await loadData();
    Alert.alert('Success', 'Receipt request prepared. You can now send it via email or message.');
  };

  const handleCreateReceiptReminder = async (visit: ContractorVisit) => {
    if (!currentHousehold?.id) return;
    try {
      const result = await contractorsApi.createReceiptReminderTask(currentHousehold.id, visit.id);
      Alert.alert('Success', result.message);
      await loadData();
    } catch (err) {
      console.error('Error creating reminder:', err);
      Alert.alert('Error', 'Failed to create reminder task');
    }
  };

  if (isLoading) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]}>
          <View style={[styles.loadingContainer, { backgroundColor: colors.backgroundMain }]}>
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  if (!contractor) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]}>
          <View style={[styles.loadingContainer, { backgroundColor: colors.backgroundMain }]}>
            <Typography variant="body" color={colors.error}>
              Contractor not found
            </Typography>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  const specialtyInfo = SPECIALTY_INFO[contractor.specialty as ContractorSpecialty] || SPECIALTY_INFO.other;

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="contractor-detail-screen">
      <ScreenHeader
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          <View style={styles.headerActions}>
            <View style={styles.actionButton}>
              <FavoriteStar isFavorite={contractor.is_favorite} onToggle={handleToggleFavorite} size={28} />
            </View>
            <TouchableOpacity onPress={handleEdit} style={styles.actionButton}>
              <Typography variant="body" color={theme.pastel.teal}>
                Edit
              </Typography>
            </TouchableOpacity>
          </View>
        }
      />
      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.container, { backgroundColor: colors.backgroundMain }]}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.pastel.teal}
          />
        }
      >
        {/* Profile Card */}
        <View style={[styles.profileCard, { backgroundColor: colors.backgroundSecondary }]}>
          <View style={[styles.specialtyBadge, { backgroundColor: specialtyInfo.color + '20' }]}>
            <Icon
              name={getContractorCategoryIcon(contractor.specialty)}
              size={32}
              color={specialtyInfo.color}
            />
          </View>
          <Typography variant="title1" weight="bold" style={styles.contractorName}>
            {contractor.name}
          </Typography>
          {contractor.company_name && (
            <Typography variant="headline" color={colors.textSecondary}>
              {contractor.company_name}
            </Typography>
          )}
          <View style={[styles.specialtyLabel, { backgroundColor: specialtyInfo.color + '15' }]}>
            <Typography variant="subheadline" style={{ color: specialtyInfo.color }}>
              {specialtyInfo.label}
            </Typography>
          </View>
          <StarRating rating={contractor.rating} size={20} />
        </View>

        {/* Quick Stats */}
        <View style={[styles.statsCard, { backgroundColor: theme.pastel.teal }]}>
          <View style={styles.statItem}>
            <Typography variant="title2" weight="bold" color={colors.white}>
              {contractor.totalVisits}
            </Typography>
            <Typography
              variant="caption1"
              style={[styles.statLabel, { color: withAlpha(colors.white, Opacity.onColorLabel) }]}
            >
              Visits
            </Typography>
          </View>
          <View style={[styles.statDivider, { backgroundColor: withAlpha(colors.white, Opacity.onColorDivider) }]} />
          <View style={styles.statItem}>
            <Typography variant="title2" weight="bold" color={colors.white}>
              {formatCurrency(contractor.totalSpent)}
            </Typography>
            <Typography
              variant="caption1"
              style={[styles.statLabel, { color: withAlpha(colors.white, Opacity.onColorLabel) }]}
            >
              Total Spent
            </Typography>
          </View>
          <View style={[styles.statDivider, { backgroundColor: withAlpha(colors.white, Opacity.onColorDivider) }]} />
          <View style={styles.statItem}>
            <Typography variant="title2" weight="bold" color={colors.white}>
              {contractor.documentCount}
            </Typography>
            <Typography
              variant="caption1"
              style={[styles.statLabel, { color: withAlpha(colors.white, Opacity.onColorLabel) }]}
            >
              Documents
            </Typography>
          </View>
        </View>

        {/* Contact Actions */}
        <View style={styles.contactActions}>
          {contractor.phone && (
            <TouchableOpacity
              style={[styles.contactButton, { backgroundColor: colors.backgroundSecondary }]}
              onPress={handleCall}
            >
              <Icon name="call" size={22} color={theme.pastel.teal} />
              <Typography variant="caption1" color={colors.textSecondary}>
                Call
              </Typography>
            </TouchableOpacity>
          )}
          {contractor.email && (
            <TouchableOpacity
              style={[styles.contactButton, { backgroundColor: colors.backgroundSecondary }]}
              onPress={handleEmail}
            >
              <Icon name="mail" size={22} color={theme.pastel.teal} />
              <Typography variant="caption1" color={colors.textSecondary}>
                Email
              </Typography>
            </TouchableOpacity>
          )}
          {contractor.website && (
            <TouchableOpacity
              style={[styles.contactButton, { backgroundColor: colors.backgroundSecondary }]}
              onPress={handleWebsite}
            >
              <Icon name="globe" size={22} color={theme.pastel.teal} />
              <Typography variant="caption1" color={colors.textSecondary}>
                Website
              </Typography>
            </TouchableOpacity>
          )}
        </View>

        {/* Tabs */}
        <View style={[styles.tabsContainer, { backgroundColor: colors.backgroundSecondary }]}>
          {(['overview', 'visits', 'documents'] as TabType[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.tab,
                activeTab === tab && { borderBottomColor: theme.pastel.teal, borderBottomWidth: 2 },
              ]}
              onPress={() => setActiveTab(tab)}
            >
              <Typography
                variant="subheadline"
                weight={activeTab === tab ? 'semibold' : 'regular'}
                color={activeTab === tab ? theme.pastel.teal : colors.textSecondary}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Typography>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <View style={styles.tabContent}>
            {contractor.phone && (
              <View style={[styles.infoRow, { backgroundColor: colors.backgroundSecondary }]}>
                <Icon name="call" size={18} color={colors.textSecondary} />
                <View style={styles.infoContent}>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Phone
                  </Typography>
                  <Typography variant="body">{contractor.phone}</Typography>
                </View>
              </View>
            )}
            {contractor.email && (
              <View style={[styles.infoRow, { backgroundColor: colors.backgroundSecondary }]}>
                <Icon name="mail" size={18} color={colors.textSecondary} />
                <View style={styles.infoContent}>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Email
                  </Typography>
                  <Typography variant="body">{contractor.email}</Typography>
                </View>
              </View>
            )}
            {contractor.address && (
              <View style={[styles.infoRow, { backgroundColor: colors.backgroundSecondary }]}>
                <Icon name="location" size={18} color={colors.textSecondary} />
                <View style={styles.infoContent}>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Address
                  </Typography>
                  <Typography variant="body">{contractor.address}</Typography>
                </View>
              </View>
            )}
            {contractor.notes && (
              <View style={[styles.notesCard, { backgroundColor: colors.backgroundSecondary }]}>
                <Typography variant="subheadline" weight="semibold" style={{ marginBottom: 8 }}>
                  Notes
                </Typography>
                <Typography variant="body" color={colors.textSecondary}>
                  {contractor.notes}
                </Typography>
              </View>
            )}
          </View>
        )}

        {activeTab === 'visits' && (
          <View style={styles.tabContent}>
            {visits.length === 0 ? (
              <View style={styles.emptyState}>
                <Typography variant="body" color={colors.textSecondary}>
                  No visits recorded yet
                </Typography>
              </View>
            ) : (
              visits.map((visit) => {
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
                        onPress={() => {
                          swipeableRefs.current.get(visit.id)?.close();
                          handleEditVisit(visit);
                        }}
                        style={[styles.swipeAction, { backgroundColor: theme.pastel.teal }]}
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
                    key={visit.id}
                    ref={(ref) => {
                      if (ref) {
                        swipeableRefs.current.set(visit.id, ref);
                      } else {
                        swipeableRefs.current.delete(visit.id);
                      }
                    }}
                    renderRightActions={renderRightActions}
                    overshootRight={false}
                    friction={2}
                  >
                    <TouchableOpacity 
                      style={[styles.visitCard, { backgroundColor: colors.backgroundSecondary }]}
                      onPress={() => handleEditVisit(visit)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.visitHeader}>
                        <Typography variant="subheadline" weight="semibold">
                          {new Date(visit.visit_date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </Typography>
                        <View style={styles.visitHeaderRight}>
                          <View
                            style={[
                              styles.statusBadge,
                              { backgroundColor: visitStatusColors[visit.status]?.bg || colors.borderColor },
                            ]}
                          >
                            <Typography
                              variant="caption2"
                              weight="medium"
                              style={{ color: visitStatusColors[visit.status]?.text || colors.textSecondary }}
                            >
                              {visit.status}
                            </Typography>
                          </View>
                        </View>
                      </View>
                      {visit.description && (
                        <Typography variant="body" color={colors.textSecondary} numberOfLines={2}>
                          {visit.description}
                        </Typography>
                      )}
                      <View style={styles.visitFooter}>
                        {visit.cost && (
                          <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
                            {formatCurrency(visit.cost)}
                          </Typography>
                        )}
                        {visit.rating && <StarRating rating={visit.rating} size={12} />}
                      </View>

                      {/* Receipt Tracking Section - Only show for completed visits */}
                      {visit.status === 'completed' && (
                        <View style={[styles.receiptSection, { borderTopColor: colors.borderColor }]}>
                          <View style={styles.receiptRow}>
                            <View style={styles.receiptCheckbox}>
                              <Toggle
                                value={visit.receipt_received}
                                onValueChange={(value) => handleReceiptToggle(visit, value)}
                                disabled={updatingReceiptStatus === visit.id}
                              />
                              <Typography 
                                variant="caption1" 
                                color={visit.receipt_received ? theme.pastel.teal : colors.textSecondary}
                                style={{ marginLeft: 8 }}
                              >
                                {visit.receipt_received ? 'Receipt received' : 'Receipt pending'}
                              </Typography>
                            </View>
                            
                            {!visit.receipt_received && (
                              <View style={styles.receiptWarning}>
                                <Icon
                                  name="warning-outline"
                                  size={14}
                                  color={colors.warning}
                                />
                              </View>
                            )}
                          </View>

                          {/* Receipt Actions - Only show if receipt not received */}
                          {!visit.receipt_received && (
                            <View style={styles.receiptActions}>
                              <TouchableOpacity
                                style={[styles.receiptActionButton, { backgroundColor: theme.pastel.teal + '20' }]}
                                onPress={(e) => {
                                  e.stopPropagation();
                                  handleRequestReceipt(visit);
                                }}
                              >
                                <Icon name="mail-outline" size={14} color={theme.pastel.teal} />
                                <Typography variant="caption2" color={theme.pastel.teal} style={{ marginLeft: 4 }}>
                                  Request Receipt
                                </Typography>
                              </TouchableOpacity>

                              {!visit.receipt_reminder_task_id && (
                                <TouchableOpacity
                                  style={[styles.receiptActionButton, { backgroundColor: colors.warning + '20' }]}
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    handleCreateReceiptReminder(visit);
                                  }}
                                >
                                  <Icon name="alarm-outline" size={14} color={colors.warning} />
                                  <Typography variant="caption2" color={colors.warning} style={{ marginLeft: 4 }}>
                                    Add Reminder
                                  </Typography>
                                </TouchableOpacity>
                              )}

                              {visit.receipt_reminder_task_id && (
                                <View style={[styles.receiptReminderBadge, { backgroundColor: colors.success + '20' }]}>
                                  <Icon name="checkmark-circle-outline" size={12} color={colors.success} />
                                  <Typography variant="caption2" color={colors.success} style={{ marginLeft: 4 }}>
                                    Reminder active
                                  </Typography>
                                </View>
                              )}
                            </View>
                          )}

                          {visit.receipt_requested_at && !visit.receipt_received && (
                            <Typography variant="caption2" color={colors.textSecondary} style={{ marginTop: 4 }}>
                              Last requested: {new Date(visit.receipt_requested_at).toLocaleDateString()}
                            </Typography>
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  </Swipeable>
                );
              })
            )}
          </View>
        )}

        {activeTab === 'documents' && (
          <View style={styles.tabContent}>
            {documents.length === 0 ? (
              <View style={styles.emptyState}>
                <Typography variant="body" color={colors.textSecondary}>
                  No documents uploaded yet
                </Typography>
              </View>
            ) : (
              <View style={styles.documentsList}>
                {documents.map((doc) => {
                  // Find linked visit
                  const linkedVisit = doc.visit_id 
                    ? visits.find(v => v.id === doc.visit_id) 
                    : null;
                  
                  return (
                    <TouchableOpacity 
                      key={doc.id} 
                      style={[styles.documentRow, { backgroundColor: colors.backgroundSecondary }]}
                      onPress={() => {
                        setSelectedDocument(doc);
                        setShowDocumentViewer(true);
                      }}
                    >
                      <View style={[styles.documentIcon, { backgroundColor: colors.backgroundSecondary }]}>
                        <Icon
                          name={
                            doc.type === 'receipt'
                              ? 'receipt-outline'
                              : doc.type === 'invoice'
                              ? 'document-text'
                              : doc.type === 'photo'
                              ? 'image'
                              : 'attach'
                          }
                          size={28}
                          color={colors.textSecondary}
                        />
                      </View>
                      <View style={styles.documentInfo}>
                        <Typography variant="subheadline" weight="semibold" numberOfLines={1}>
                          {doc.title}
                        </Typography>
                        <View style={styles.documentMeta}>
                          <Typography variant="caption1" color={colors.textSecondary}>
                            {doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
                          </Typography>
                          {linkedVisit && (
                            <>
                              <Typography variant="caption1" color={colors.textSecondary}> • </Typography>
                              <Typography variant="caption1" color={theme.pastel.teal}>
                                Visit {new Date(linkedVisit.visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </Typography>
                            </>
                          )}
                        </View>
                        {doc.document_date && (
                          <Typography variant="caption2" color={colors.textSecondary}>
                            {new Date(doc.document_date).toLocaleDateString()}
                          </Typography>
                        )}
                      </View>
                      {doc.amount && (
                        <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
                          {formatCurrency(doc.amount)}
                        </Typography>
                      )}
                      <Typography variant="body" color={colors.textSecondary} style={{ marginLeft: 8 }}>
                        ›
                      </Typography>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {error && (
          <View style={styles.errorContainer}>
            <Typography variant="body" color={colors.error}>
              {error}
            </Typography>
          </View>
        )}
      </ScrollView>

      {/* Floating Add Visit Button. The shared bottom-glass scrim (same blur +
          `surface`-token gradient as the tab bar / iPad sidebar) sits behind the
          CTA so it reads as one material with the bottom nav; the container's
          upward shadow is preserved (no `overflow: 'hidden'`). */}
      <View style={[styles.floatingButtonContainer, { paddingHorizontal: containerPadding, shadowColor: colors.black }]}>
        <ScreenFooterGlass />
        <GradientButton
          title="Add Visit"
          variant="blue"
          size="lg"
          onPress={handleAddVisit}
          style={styles.floatingButton}
          fullWidth
        />
      </View>

      {/* Document Viewer Modal */}
      <DocumentViewerModal
        visible={showDocumentViewer}
        document={selectedDocument}
        onClose={() => {
          setShowDocumentViewer(false);
          setSelectedDocument(null);
        }}
      />

      {/* Receipt Request Modal */}
      {contractor && selectedVisitForReceipt && (
        <ReceiptRequestModal
          visible={showReceiptModal}
          visit={selectedVisitForReceipt}
          contractor={contractor}
          householdId={currentHousehold?.id || ''}
          onClose={() => {
            setShowReceiptModal(false);
            setSelectedVisitForReceipt(null);
          }}
          onSuccess={handleReceiptRequestSent}
        />
      )}
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
    paddingBottom: 120,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.base,
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing.base,
  },
  actionButton: {
    padding: Spacing.xs,
  },
  profileCard: {
    alignItems: 'center',
    padding: Spacing.xl,
    borderRadius: CornerRadius.lg,
    marginBottom: Spacing.base,
  },
  specialtyBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  contractorName: {
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  specialtyLabel: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  starContainer: {
    flexDirection: 'row',
    marginTop: Spacing.xs,
  },
  statsCard: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    marginBottom: Spacing.base,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    marginTop: Spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 32,
  },
  contactActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.base,
  },
  contactButton: {
    flex: 1,
    alignItems: 'center',
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
  },
  tabsContainer: {
    flexDirection: 'row',
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.base,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  tabContent: {
    marginBottom: Spacing.base,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  infoContent: {
    flex: 1,
  },
  notesCard: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginTop: Spacing.sm,
  },
  visitCard: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.sm,
  },
  swipeActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    height: '100%',
    borderRadius: CornerRadius.md,
    marginLeft: Spacing.sm,
  },
  visitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.sm,
  },
  visitFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  documentsList: {
    gap: Spacing.sm,
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
  },
  documentIcon: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  documentInfo: {
    flex: 1,
  },
  documentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xxs,
  },
  emptyState: {
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  visitHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  receiptSection: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  receiptWarning: {
    padding: Spacing.xs,
  },
  receiptActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    flexWrap: 'wrap',
  },
  receiptActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.xs + Spacing.xxs,
    borderRadius: CornerRadius.sm,
  },
  receiptReminderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.xs + Spacing.xxs,
  },
  floatingButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  floatingButton: {
    width: '100%',
  },
  errorContainer: {
    marginTop: Spacing.base,
    padding: Spacing.md,
    alignItems: 'center',
  },
});
