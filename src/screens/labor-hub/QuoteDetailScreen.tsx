import { useNavigation, useRoute, type RouteProp } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  quotesApi,
  type QuoteWithDetails,
  QUOTE_STATUS_INFO,
} from '@api/quotes';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useQuoteStore } from '@stores/quoteStore';
import { useAppColors } from '@theme';
import { getContractorCategoryIcon, type IoniconName } from '@utils/categoryIcons';
import { formatMoney, useDisplayCurrency } from '@utils/money';

type QuoteDetailRoute = RouteProp<ContractorsStackParamList, 'QuoteDetail'>;

// Format currency from cents in the user's display currency.
function formatCurrency(cents: number): string {
  return formatMoney(cents, { decimals: 2 });
}

// Format date for display
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// Info Row Component
interface InfoRowProps {
  icon: IoniconName;
  label: string;
  value: string | null;
  highlight?: boolean;
  onPress?: () => void;
}

function InfoRow({ icon, label, value, highlight, onPress }: InfoRowProps) {
  const colors = useAppColors();
  if (!value) return null;

  const content = (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: colors.groupedListBackground }]}>
        <Icon name={icon} size={18} color={colors.textSecondary} />
      </View>
      <View style={styles.infoContent}>
        <Typography variant="caption1" color="secondary">
          {label}
        </Typography>
        <Typography
          variant="subheadline"
          weight={highlight ? 'bold' : 'medium'}
          style={highlight ? { color: colors.primary } : undefined}
        >
          {value}
        </Typography>
      </View>
      {onPress && (
        <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

// Action Button Component
interface ActionButtonProps {
  icon: IoniconName;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
}

function ActionButton({ icon, label, color, onPress, disabled, fullWidth }: ActionButtonProps) {
  return (
    <TouchableOpacity
      style={[
        styles.actionButton,
        { backgroundColor: color + '15', opacity: disabled ? 0.5 : 1 },
        fullWidth && { flex: 1 },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <View style={[styles.actionIcon, { backgroundColor: color + '25' }]}>
        <Icon name={icon} size={20} color={color} />
      </View>
      <Typography variant="caption1" weight="medium" style={{ color, marginTop: 4 }}>
        {label}
      </Typography>
    </TouchableOpacity>
  );
}

// Main Screen Component
export function QuoteDetailScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const route = useRoute<QuoteDetailRoute>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const { updateQuote, removeQuote } = useQuoteStore();

  const [quote, setQuote] = useState<QuoteWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const { quoteId } = route.params;
  const householdId = currentHousehold?.id;

  const fetchQuote = useCallback(async () => {
    if (!householdId) return;

    setIsLoading(true);
    try {
      const response = await quotesApi.getOne(householdId, quoteId);
      setQuote(response.quote);
    } catch (error) {
      console.error('Error fetching quote:', error);
      Alert.alert('Error', 'Failed to load quote details');
    } finally {
      setIsLoading(false);
    }
  }, [householdId, quoteId]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  const handleAcceptQuote = async () => {
    if (!householdId || !quote) return;

    Alert.alert(
      'Accept Quote',
      `Are you sure you want to accept this quote from ${quote.contractor.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            setIsUpdating(true);
            try {
              const response = await quotesApi.accept(householdId, quoteId);
              setQuote(response.quote);
              updateQuote(quoteId, response.quote);

              // Offer to create a project
              Alert.alert(
                'Quote Accepted',
                'Would you like to create a project from this quote?',
                [
                  { text: 'Not Now', style: 'cancel' },
                  {
                    text: 'Create Project',
                    onPress: () => {
                      navigation.navigate('AddEditProject', {
                        contractorId: quote.contractor_id,
                        quoteId: quote.id,
                      });
                    },
                  },
                ]
              );
            } catch (error) {
              console.error('Error accepting quote:', error);
              Alert.alert('Error', 'Failed to accept quote');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const handleDeclineQuote = async () => {
    if (!householdId || !quote) return;

    Alert.alert(
      'Decline Quote',
      'Are you sure you want to decline this quote?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            setIsUpdating(true);
            try {
              const response = await quotesApi.decline(householdId, quoteId);
              setQuote(response.quote);
              updateQuote(quoteId, response.quote);
            } catch (error) {
              console.error('Error declining quote:', error);
              Alert.alert('Error', 'Failed to decline quote');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const handleMarkReceived = async () => {
    if (!householdId || !quote) return;

    setIsUpdating(true);
    try {
      const response = await quotesApi.markReceived(householdId, quoteId, {});
      setQuote(response.quote);
      updateQuote(quoteId, response.quote);
    } catch (error) {
      console.error('Error marking quote received:', error);
      Alert.alert('Error', 'Failed to update quote');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = () => {
    if (!householdId) return;

    Alert.alert(
      'Delete Quote',
      'Are you sure you want to delete this quote? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await quotesApi.delete(householdId, quoteId);
              removeQuote(quoteId);
              navigation.goBack();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete quote');
            }
          },
        },
      ]
    );
  };

  const handleCallContractor = () => {
    if (quote?.contractor.phone) {
      Linking.openURL(`tel:${quote.contractor.phone}`);
    }
  };

  const handleEmailContractor = () => {
    if (quote?.contractor.email) {
      Linking.openURL(`mailto:${quote.contractor.email}`);
    }
  };

  const handleViewContractor = () => {
    if (quote) {
      navigation.navigate('ContractorDetail', { contractorId: quote.contractor_id });
    }
  };

  const handleScheduleAppointment = () => {
    if (quote) {
      navigation.navigate('AddEditAppointment', {
        contractorId: quote.contractor_id,
        linkedQuoteId: quote.id,
      });
    }
  };

  const handleViewDocument = async () => {
    if (!quote?.document_key || !currentHousehold) return;

    try {
      const documentUrl = quotesApi.getDocumentUrl(currentHousehold.id, quote.id);

      // Note: The backend endpoint is ready, but full document viewing requires:
      // - expo-file-system for authenticated download
      // - expo-sharing or react-native-pdf for viewing
      // For now, show that the endpoint is accessible
      Alert.alert(
        'View Quote Document',
        'Document endpoint is ready at:\n' + documentUrl,
        [
          {
            text: 'OK',
            style: 'default',
          },
        ]
      );

      // TODO: Implement secure document viewing:
      // const { useAuthStore } = await import('@stores/authStore');
      // const token = useAuthStore.getState().token;
      // Use expo-file-system to download with headers: { Authorization: `Bearer ${token}` }
      // Then use expo-sharing or react-native-pdf to view the downloaded file

      console.log('[QuoteDetail] Document available at:', documentUrl);
    } catch (error) {
      console.error('Error accessing document:', error);
      Alert.alert('Error', 'Failed to access document');
    }
  };

  const renderScreenHeader = (rightElement?: React.ReactNode) => (
    <ScreenHeader
      title="Quote"
      showBackButton
      onBackPress={() => navigation.goBack()}
      showNotificationBell={false}
      showAvatar={false}
      rightElement={rightElement}
    />
  );

  if (isLoading) {
    return (
      <AppBackground>
        {renderScreenHeader()}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (!quote) {
    return (
      <AppBackground>
        {renderScreenHeader()}
        <View style={styles.errorContainer}>
          <Typography variant="headline" color="secondary">
            Quote not found
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const statusInfo = QUOTE_STATUS_INFO[quote.status] || QUOTE_STATUS_INFO.requested;

  const getAmountDisplay = () => {
    if (quote.amount_cents) {
      return formatCurrency(quote.amount_cents);
    }
    if (quote.amount_range_low_cents && quote.amount_range_high_cents) {
      return `${formatCurrency(quote.amount_range_low_cents)} - ${formatCurrency(quote.amount_range_high_cents)}`;
    }
    return 'Pending';
  };

  const canAccept = ['received', 'reviewing'].includes(quote.status);
  const canDecline = ['received', 'reviewing'].includes(quote.status);
  const canMarkReceived = quote.status === 'requested';
  const isActive = !['accepted', 'declined', 'expired'].includes(quote.status);

  return (
    <AppBackground>
      {renderScreenHeader(
        <TouchableOpacity onPress={handleDelete} style={styles.deleteButton}>
          <Icon name="trash-outline" size={24} color={colors.error} />
        </TouchableOpacity>
      )}

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
      >
        <AdaptiveContainer style={styles.stack}>
          {/* Header Card */}
          <View style={[styles.headerCard, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.headerRow}>
              <View style={[styles.typeIcon, { backgroundColor: colors.warning + '20' }]}>
                <Icon name="document-text" size={26} color={colors.warning} />
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
                <Typography variant="caption1" weight="semibold" style={{ color: statusInfo.color }}>
                  {statusInfo.label}
                </Typography>
              </View>
            </View>

            <Typography variant="title2" weight="bold" style={{ marginTop: 16 }}>
              {quote.title}
            </Typography>

            {quote.description && (
              <Typography variant="body" color="secondary" style={{ marginTop: 8 }}>
                {quote.description}
              </Typography>
            )}

            {/* Amount Display */}
            <View style={[styles.amountCard, { backgroundColor: colors.groupedListBackground }]}>
              <Typography variant="caption1" color="secondary">
                Quote Amount
              </Typography>
              <Typography variant="title1" weight="bold" style={{ color: colors.primary }}>
                {getAmountDisplay()}
              </Typography>
            </View>
          </View>

          {/* Quick Actions */}
          {isActive && (
            <View style={[styles.actionsCard, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
                Actions
              </Typography>
              <View style={styles.actionsRow}>
                {canMarkReceived && (
                  <ActionButton
                    icon="download"
                    label="Mark Received"
                    color={colors.primary}
                    onPress={handleMarkReceived}
                    disabled={isUpdating}
                  />
                )}
                {canAccept && (
                  <ActionButton
                    icon="checkmark"
                    label="Accept"
                    color={colors.success}
                    onPress={handleAcceptQuote}
                    disabled={isUpdating}
                  />
                )}
                {canDecline && (
                  <ActionButton
                    icon="close"
                    label="Decline"
                    color={colors.error}
                    onPress={handleDeclineQuote}
                    disabled={isUpdating}
                  />
                )}
                <ActionButton
                  icon="calendar"
                  label="Schedule"
                  color={colors.info}
                  onPress={handleScheduleAppointment}
                />
              </View>
            </View>
          )}

          {/* Accepted - Create Project Prompt */}
          {quote.status === 'accepted' && (
            <TouchableOpacity
              style={[styles.projectPrompt, { backgroundColor: colors.success + '15' }]}
              onPress={() => navigation.navigate('AddEditProject', {
                contractorId: quote.contractor_id,
                quoteId: quote.id,
              })}
            >
              <Icon name="hammer" size={20} color={colors.success} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Typography variant="subheadline" weight="semibold" style={{ color: colors.success }}>
                  Create Project
                </Typography>
                <Typography variant="caption1" color="secondary">
                  Start tracking this work as a project
                </Typography>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.success} />
            </TouchableOpacity>
          )}

          {/* Quote Details */}
          <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
              Details
            </Typography>

            {quote.estimated_duration && (
              <InfoRow icon="hourglass" label="Estimated Duration" value={quote.estimated_duration} />
            )}

            {quote.valid_until && (
              <InfoRow
                icon="calendar"
                label="Valid Until"
                value={formatDate(quote.valid_until)}
                highlight={quote.isExpiringSoon}
              />
            )}

            {quote.warranty_terms && (
              <InfoRow icon="shield-checkmark" label="Warranty" value={quote.warranty_terms} />
            )}

            {quote.document_key && (
              <InfoRow
                icon="document-text"
                label="Document"
                value="View Quote Document"
                onPress={handleViewDocument}
              />
            )}

            <InfoRow
              icon="calendar"
              label="Requested"
              value={formatDate(quote.created_at)}
            />
          </View>

          {/* Contractor Info */}
          <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
              Contractor
            </Typography>

            <TouchableOpacity
              style={styles.contractorCard}
              onPress={handleViewContractor}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.contractorIcon,
                  { backgroundColor: quote.contractor.specialtyInfo.color + '20' },
                ]}
              >
                <Icon
                  name={getContractorCategoryIcon(quote.contractor.specialty)}
                  size={24}
                  color={quote.contractor.specialtyInfo.color}
                />
              </View>
              <View style={styles.contractorInfo}>
                <Typography variant="subheadline" weight="semibold">
                  {quote.contractor.name}
                </Typography>
                {quote.contractor.company_name && (
                  <Typography variant="caption1" color="secondary">
                    {quote.contractor.company_name}
                  </Typography>
                )}
                <Typography
                  variant="caption2"
                  weight="medium"
                  style={{ color: quote.contractor.specialtyInfo.color }}
                >
                  {quote.contractor.specialtyInfo.label}
                </Typography>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <View style={styles.contactButtons}>
              {quote.contractor.phone && (
                <TouchableOpacity
                  style={[styles.contactButton, { backgroundColor: colors.groupedListBackground }]}
                  onPress={handleCallContractor}
                >
                  <Icon name="call" size={20} color={colors.success} />
                  <Typography variant="caption1" weight="medium" color="primary">
                    Call
                  </Typography>
                </TouchableOpacity>
              )}
              {quote.contractor.email && (
                <TouchableOpacity
                  style={[styles.contactButton, { backgroundColor: colors.groupedListBackground }]}
                  onPress={handleEmailContractor}
                >
                  <Icon name="mail" size={20} color={colors.primary} />
                  <Typography variant="caption1" weight="medium" color="primary">
                    Email
                  </Typography>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Notes */}
          {quote.notes && (
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
                Notes
              </Typography>
              <Typography variant="body" color="secondary">
                {quote.notes}
              </Typography>
            </View>
          )}
        </AdaptiveContainer>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    padding: 4,
    width: 32,
  },
  headerRightPlaceholder: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: {
    gap: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    padding: 4,
  },
  // Header Card
  headerCard: {
    borderRadius: 20,
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  typeIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  amountCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  // Actions
  actionsCard: {
    borderRadius: 20,
    padding: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    minWidth: 80,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Project Prompt
  projectPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
  },
  // Section
  section: {
    borderRadius: 20,
    padding: 16,
  },
  // Info Row
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoContent: {
    flex: 1,
    gap: 2,
  },
  // Contractor
  contractorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  contractorIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contractorInfo: {
    flex: 1,
    gap: 2,
  },
  contactButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
});

export default QuoteDetailScreen;
