import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from "expo-router/react-navigation";
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { contractorsApi, type ContractorWithStats } from '@api/contractors';
import { quotesApi } from '@api/quotes';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useQuoteStore } from '@stores/quoteStore';
import { useAppColors, scaledFont } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type RequestQuoteRoute = RouteProp<ContractorsStackParamList, 'RequestQuote'>;

// Form Field Component
interface FormFieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}

function FormField({ label, required, children }: FormFieldProps) {
  return (
    <View style={styles.formField}>
      <Typography variant="caption1" color="secondary" style={styles.fieldLabel}>
        {label}
        {required && <Typography color="error"> *</Typography>}
      </Typography>
      {children}
    </View>
  );
}

// Contractor Selection Card Component
interface ContractorSelectCardProps {
  contractor: ContractorWithStats;
  isSelected: boolean;
  onToggle: () => void;
}

function ContractorSelectCard({ contractor, isSelected, onToggle }: ContractorSelectCardProps) {  const colors = useAppColors();

  return (
    <TouchableOpacity
      style={[
        styles.contractorCard,
        {
          backgroundColor: isSelected
            ? contractor.specialtyInfo.color + '15'
            : colors.backgroundSecondary,
          borderColor: isSelected ? contractor.specialtyInfo.color : 'transparent',
          borderWidth: 2,
        },
      ]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: isSelected ? contractor.specialtyInfo.color : 'transparent',
            borderColor: isSelected ? contractor.specialtyInfo.color : colors.borderColor,
          },
        ]}
      >
        {isSelected && <Icon name="checkmark" size={16} color={colors.white} />}
      </View>
      <View
        style={[
          styles.contractorIcon,
          { backgroundColor: contractor.specialtyInfo.color + '20' },
        ]}
      >
        <Icon
          name={contractor.specialtyInfo.icon as keyof typeof Ionicons.glyphMap}
          size={18}
          color={contractor.specialtyInfo.color}
        />
      </View>
      <View style={styles.contractorInfo}>
        <Typography variant="subheadline" weight="semibold" numberOfLines={1}>
          {contractor.name}
        </Typography>
        {contractor.company_name && (
          <Typography variant="caption2" color="secondary" numberOfLines={1}>
            {contractor.company_name}
          </Typography>
        )}
        <Typography
          variant="caption2"
          weight="medium"
          style={{ color: contractor.specialtyInfo.color }}
        >
          {contractor.specialtyInfo.label}
        </Typography>
      </View>
      {contractor.rating && (
        <View style={styles.ratingBadge}>
          <Typography variant="caption2" weight="semibold">
            ★ {contractor.rating.toFixed(1)}
          </Typography>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Main Screen Component
export function RequestQuoteScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const route = useRoute<RequestQuoteRoute>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const { addQuote } = useQuoteStore();

  const {
    contractorIds: preselectedIds,
    linkedReportId,
    linkedTaskId,
    problemTitle: initialTitle,
    problemDescription: initialDescription,
  } = route.params || {};

  // Form state
  const [title, setTitle] = useState(initialTitle || '');
  const [description, setDescription] = useState(initialDescription || '');
  const [selectedContractorIds, setSelectedContractorIds] = useState<Set<string>>(
    new Set(preselectedIds || [])
  );

  // Loading states
  const [contractors, setContractors] = useState<ContractorWithStats[]>([]);
  const [isLoadingContractors, setIsLoadingContractors] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const householdId = currentHousehold?.id;

  // Fetch contractors
  useEffect(() => {
    const fetchContractors = async () => {
      if (!householdId) return;

      setIsLoadingContractors(true);
      try {
        const response = await contractorsApi.getAll(householdId);
        setContractors(response.contractors);
      } catch (error) {
        console.error('Error fetching contractors:', error);
      } finally {
        setIsLoadingContractors(false);
      }
    };

    fetchContractors();
  }, [householdId]);

  const toggleContractor = (contractorId: string) => {
    const newSelected = new Set(selectedContractorIds);
    if (newSelected.has(contractorId)) {
      newSelected.delete(contractorId);
    } else {
      newSelected.add(contractorId);
    }
    setSelectedContractorIds(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedContractorIds.size === contractors.length) {
      setSelectedContractorIds(new Set());
    } else {
      setSelectedContractorIds(new Set(contractors.map((c) => c.id)));
    }
  };

  const handleSendRequests = async () => {
    if (!householdId) return;

    // Validation
    if (!title.trim()) {
      Alert.alert('Required', 'Please enter a title for the quote request');
      return;
    }
    if (selectedContractorIds.size === 0) {
      Alert.alert('Required', 'Please select at least one contractor');
      return;
    }

    setIsSending(true);
    try {
      const response = await quotesApi.requestQuotes(householdId, {
        contractor_ids: Array.from(selectedContractorIds),
        title: title.trim(),
        description: description.trim() || '',
        linked_report_id: linkedReportId,
        linked_task_id: linkedTaskId,
      });

      // Add all new quotes to store
      response.quotes.forEach((quote) => addQuote(quote));

      Alert.alert(
        'Quotes Requested',
        `Successfully sent quote requests to ${response.quotes.length} contractor(s).`,
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]
      );
    } catch (error) {
      console.error('Error sending quote requests:', error);
      Alert.alert('Error', 'Failed to send quote requests');
    } finally {
      setIsSending(false);
    }
  };

  const handleFindContractors = () => {
    navigation.navigate('ContractorSearch', {
      problemTitle: title,
      problemDescription: description,
      systemCategory: 'other',
      sourceType: 'task',
      sourceId: linkedTaskId || 'quote-request',
    });
  };

  return (
    <AppBackground>
      {/* Header */}
      <ScreenHeader
        title="Request Quote"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        {...keyboardDismissScrollProps}
      >
        <AdaptiveContainer style={styles.stack}>
          {/* Title */}
          <FormField label="What do you need?" required>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.groupedListBackground, color: colors.textPrimary },
              ]}
              placeholder="e.g., Kitchen faucet replacement"
              placeholderTextColor={colors.textSecondary}
              value={title}
              onChangeText={setTitle}
            />
          </FormField>

          {/* Description */}
          <FormField label="Description">
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                { backgroundColor: colors.groupedListBackground, color: colors.textPrimary },
              ]}
              placeholder="Describe the work needed, any specific requirements, or questions you have..."
              placeholderTextColor={colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
            />
          </FormField>

          {/* Linked Context */}
          {(linkedReportId || linkedTaskId) && (
            <View style={[styles.linkedContext, { backgroundColor: colors.groupedListBackground }]}>
              <Icon name="link" size={20} color={colors.primary} />
              <Typography variant="caption1" color="secondary" style={{ marginLeft: 8 }}>
                Linked to {linkedReportId ? 'report' : 'action item'}
              </Typography>
            </View>
          )}

          {/* Contractor Selection */}
          <View style={styles.contractorSection}>
            <View style={styles.contractorHeader}>
              <Typography variant="headline" weight="semibold">
                Select Contractors
                <Typography color="error"> *</Typography>
              </Typography>
              {contractors.length > 0 && (
                <TouchableOpacity onPress={handleSelectAll}>
                  <Typography variant="caption1" color="primary">
                    {selectedContractorIds.size === contractors.length
                      ? 'Deselect All'
                      : 'Select All'}
                  </Typography>
                </TouchableOpacity>
              )}
            </View>

            <Typography variant="caption1" color="secondary" style={{ marginBottom: 12 }}>
              Send the same request to multiple contractors to compare quotes
            </Typography>

            {isLoadingContractors ? (
              <View style={styles.loadingSmall}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : contractors.length === 0 ? (
              <View style={styles.emptyContractors}>
                <Typography variant="body" color="secondary" style={{ textAlign: 'center' }}>
                  No contractors yet.
                </Typography>
                <TouchableOpacity
                  style={[styles.findButton, { backgroundColor: colors.primary }]}
                  onPress={handleFindContractors}
                >
                  <Icon name="search" size={18} color={colors.white} />
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color="onPrimary"
                    style={{ marginLeft: 6 }}
                  >
                    Find Contractors
                  </Typography>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.contractorList}>
                {contractors.map((contractor) => (
                  <ContractorSelectCard
                    key={contractor.id}
                    contractor={contractor}
                    isSelected={selectedContractorIds.has(contractor.id)}
                    onToggle={() => toggleContractor(contractor.id)}
                  />
                ))}
              </View>
            )}

            {/* Find More Button */}
            {contractors.length > 0 && (
              <TouchableOpacity
                style={[styles.findMoreButton, { borderColor: colors.primary }]}
                onPress={handleFindContractors}
              >
                <Icon name="add" size={20} color={colors.primary} />
                <Typography variant="caption1" weight="medium" color="primary" style={{ marginLeft: 6 }}>
                  Find More Contractors
                </Typography>
              </TouchableOpacity>
            )}
          </View>

          {/* Selection Summary */}
          {selectedContractorIds.size > 0 && (
            <View style={[styles.summary, { backgroundColor: colors.groupedListBackground }]}>
              <Icon name="people" size={20} color={colors.primary} />
              <Typography variant="subheadline" weight="medium" style={{ marginLeft: 8 }}>
                {selectedContractorIds.size} contractor
                {selectedContractorIds.size !== 1 ? 's' : ''} selected
              </Typography>
            </View>
          )}

          {/* Send Button */}
          <TouchableOpacity
            style={[
              styles.sendButton,
              {
                backgroundColor:
                  selectedContractorIds.size > 0 ? colors.primary : colors.groupedListBackground,
              },
              isSending && { opacity: 0.6 },
            ]}
            onPress={handleSendRequests}
            disabled={isSending || selectedContractorIds.size === 0}
          >
            {isSending ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Icon
                  name="send"
                  size={20}
                  color={selectedContractorIds.size > 0 ? colors.white : colors.textSecondary}
                />
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  color={selectedContractorIds.size > 0 ? 'onPrimary' : 'secondary'}
                  style={{ marginLeft: 8 }}
                >
                  Send Quote Request
                  {selectedContractorIds.size > 1 ? 's' : ''}
                </Typography>
              </>
            )}
          </TouchableOpacity>
        </AdaptiveContainer>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: {
    gap: 8,
  },
  // Form Field
  formField: {
    marginBottom: 16,
  },
  fieldLabel: {
    marginBottom: 8,
  },
  // Input
  input: {
    borderRadius: 12,
    padding: 14,
    ...scaledFont('body'),
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  // Linked Context
  linkedContext: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  // Contractor Section
  contractorSection: {
    marginBottom: 8,
  },
  contractorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  contractorList: {
    gap: 12,
  },
  contractorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contractorIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contractorInfo: {
    flex: 1,
    gap: 2,
  },
  ratingBadge: {
    backgroundColor: 'rgba(255,180,0,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  // Empty & Find
  emptyContractors: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 16,
  },
  findButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  findMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 12,
  },
  loadingSmall: {
    padding: 20,
    alignItems: 'center',
  },
  // Summary
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 12,
  },
  // Send Button
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    marginTop: 8,
  },
});

export default RequestQuoteScreen;
