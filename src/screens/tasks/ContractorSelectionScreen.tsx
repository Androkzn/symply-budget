import { useNavigation, useRoute } from "expo-router/react-navigation";
import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput } from 'react-native';

import type { Contractor } from '@api/contractors';
import { tasksApi } from '@api/tasks';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useMemberFacingAlert } from '@features/house/local/useMemberFacingAlert';
import type { TasksStackScreenProps } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import {
  CornerRadius,
  EmptyState,
  Layout,
  LegacyTextVariant,
  Spacing,
  useAppColors,
} from '@theme';
import type { AppColors } from '@theme';
import { getContractorCategoryIcon } from '@utils/categoryIcons';
import { keyboardDismissScrollProps } from '@utils/keyboard';

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.backgroundSecondary,
    },
    scrollView: {
      flex: 1,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.backgroundSecondary,
    },
    loadingText: {
      marginTop: Spacing.md,
    },
    header: {
      padding: Spacing.lg,
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    backButton: {
      marginBottom: Spacing.md,
    },
    title: {
      marginBottom: Spacing.xs,
    },
    searchContainer: {
      padding: Spacing.base,
    },
    searchInput: {
      backgroundColor: colors.card,
      borderRadius: Spacing.smd,
      padding: Spacing.md,
      fontSize: LegacyTextVariant.callout.size,
      lineHeight: LegacyTextVariant.callout.lineHeight,
      borderWidth: 1,
      borderColor: colors.divider,
      color: colors.textPrimary,
    },
    descriptionContainer: {
      padding: Spacing.base,
      paddingTop: 0,
    },
    descriptionLabel: {
      marginBottom: Spacing.sm,
    },
    descriptionInput: {
      backgroundColor: colors.card,
      borderRadius: Spacing.smd,
      padding: Spacing.md,
      fontSize: LegacyTextVariant.callout.size,
      lineHeight: LegacyTextVariant.callout.lineHeight,
      borderWidth: 1,
      borderColor: colors.divider,
      minHeight: Layout.multilineFieldMinHeight,
      color: colors.textPrimary,
    },
    section: {
      padding: Spacing.base,
    },
    contractorCard: {
      backgroundColor: colors.card,
      borderRadius: CornerRadius.md,
      padding: Spacing.base,
      marginBottom: Spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: Spacing.xxs,
      borderColor: colors.divider,
    },
    contractorCardSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.surfaceSelected,
    },
    contractorInfo: {
      flex: 1,
    },
    contractorName: {
      marginBottom: Spacing.xs,
    },
    companyName: {
      marginBottom: Spacing.xs,
    },
    ratingRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    ratingText: {
      marginLeft: Spacing.xs,
    },
    checkbox: {
      width: Spacing.xl + Spacing.xs,
      height: Spacing.xl + Spacing.xs,
      borderRadius: (Spacing.xl + Spacing.xs) / 2,
      borderWidth: Spacing.xxs,
      borderColor: colors.divider,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: EmptyState.blockPaddingVertical,
    },
    emptyIcon: {
      marginBottom: Spacing.base,
    },
    emptyTitle: {
      marginBottom: Spacing.sm,
    },
    emptyText: {
      textAlign: 'center',
    },
    footer: {
      padding: Spacing.base,
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    requestButton: {
      backgroundColor: colors.accent,
      paddingVertical: Spacing.base,
      borderRadius: CornerRadius.md,
      alignItems: 'center',
    },
    requestButtonDisabled: {
      backgroundColor: colors.actionDisabled,
    },
  });
}

export function ContractorSelectionScreen() {
  const navigation = useNavigation<TasksStackScreenProps<'ContractorSelection'>['navigation']>();
  const route = useRoute<TasksStackScreenProps<'ContractorSelection'>['route']>();
  const { taskId, category } = route.params;
  const colors = useAppColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const showError = useMemberFacingAlert();

  const [loading, setLoading] = useState(true);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [quoteDescription, setQuoteDescription] = useState('');

  const { currentHousehold } = useHouseholdStore();

  useEffect(() => {
  const loadContractors = async () => {
    if (!currentHousehold) return;

    try {
      setLoading(true);

      const { apiClient } = await import('@api/client');
      const response = await apiClient.get(
        `/households/${currentHousehold.id}/contractors`,
        {
          params: {
            specialty: category,
          },
        }
      );

      setContractors(response.data.contractors || []);
    } catch (error) {
      console.error('Failed to load contractors:', error);
      Alert.alert('Error', 'Failed to load contractors');
    } finally {
      setLoading(false);
    }
  };

    void loadContractors();
  }, [currentHousehold, category]);

  const toggleContractor = (contractorId: string) => {
    setSelectedIds((prev) =>
      prev.includes(contractorId)
        ? prev.filter((id) => id !== contractorId)
        : [...prev, contractorId]
    );
  };

  const handleRequestQuotes = async () => {
    if (selectedIds.length === 0) {
      Alert.alert('No Contractors Selected', 'Please select at least one contractor');
      return;
    }

    if (!currentHousehold) return;

    try {
      await tasksApi.requestTaskQuotes(currentHousehold.id, taskId, {
        contractor_ids: selectedIds,
        description: quoteDescription || undefined,
      });

      Alert.alert('Success', `Requested quotes from ${selectedIds.length} contractor(s)`);
      navigation.goBack();
    } catch (error) {
      /**
       * DoD H7, positive half. `requestTaskQuotes` is P4 on a local-first
       * build: sending a job out means sharing home details with contractors
       * through our servers, which private mode deliberately prevents, and
       * `unsupportedCopy.ts` says so — including what the member can do
       * instead (contact saved contractors directly). 'Failed to request
       * quotes' told them none of that and implied a fault.
       */
      showError(error, 'Failed to request quotes');
    }
  };

  const filteredContractors = contractors.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.company_name && c.company_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer} testID="contractor-selection-screen">
        <ActivityIndicator size="large" color={colors.primary} />
        <Typography variant="body" color={colors.textTertiary} style={styles.loadingText}>
          Loading contractors...
        </Typography>
      </View>
    );
  }

  return (
    <AppBackground>
    <SafeAreaView edges={[]} style={styles.container} testID="contractor-selection-screen">
      <ScreenHeader
        title="Select Contractors"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <ScrollView {...keyboardDismissScrollProps} style={[screenScrollViewStyle.scroll, styles.scrollView]}>
        <Typography variant="body" color={colors.textTertiary} >
          {selectedIds.length} selected
        </Typography>

        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search contractors..."
            placeholderTextColor={colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <View style={styles.descriptionContainer}>
          <Typography
            variant="bodySmall"
            weight="semibold"
            color={colors.textPrimary}
            style={styles.descriptionLabel}
          >
            Quote Request Description (Optional)
          </Typography>
          <TextInput
            style={styles.descriptionInput}
            placeholder="Describe the work needed..."
            placeholderTextColor={colors.textTertiary}
            value={quoteDescription}
            onChangeText={setQuoteDescription}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          {filteredContractors.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon
                name={getContractorCategoryIcon(category)}
                size={EmptyState.iconSize}
                color={colors.textTertiary}
                style={styles.emptyIcon}
              />
              <Typography
                variant="titleSmall"
                weight="semibold"
                color={colors.textPrimary}
                style={styles.emptyTitle}
              >
                No Contractors Found
              </Typography>
              <Typography variant="body" color={colors.textTertiary} style={styles.emptyText}>
                {searchQuery
                  ? 'Try adjusting your search'
                  : 'Add contractors to your property first'}
              </Typography>
            </View>
          ) : (
            filteredContractors.map((contractor) => {
              const isSelected = selectedIds.includes(contractor.id);
              return (
                <TouchableOpacity
                  key={contractor.id}
                  style={[styles.contractorCard, isSelected && styles.contractorCardSelected]}
                  onPress={() => toggleContractor(contractor.id)}
                >
                  <View style={styles.contractorInfo}>
                    <Typography
                      variant="bodyLarge"
                      weight="semibold"
                      color={colors.textPrimary}
                      style={styles.contractorName}
                    >
                      {contractor.name}
                    </Typography>
                    {contractor.company_name && (
                      <Typography
                        variant="bodySmall"
                        color={colors.textTertiary}
                        style={styles.companyName}
                      >
                        {contractor.company_name}
                      </Typography>
                    )}
                    {contractor.rating && (
                      <View style={styles.ratingRow}>
                        {Array.from({ length: Math.round(contractor.rating) }).map((_, i) => (
                          <Icon key={i} name="star" size={14} color={colors.warning} />
                        ))}
                        <Typography
                          variant="bodySmall"
                          color={colors.textPrimary}
                          style={styles.ratingText}
                        >
                          ({contractor.rating}/5)
                        </Typography>
                      </View>
                    )}
                  </View>
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <Icon name="checkmark" size={18} color={colors.white} />}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.requestButton, selectedIds.length === 0 && styles.requestButtonDisabled]}
          onPress={handleRequestQuotes}
          disabled={selectedIds.length === 0}
          testID="contractor-selection-request"
        >
          <Typography variant="bodyLarge" weight="semibold" color={colors.white}>
            Request Quotes ({selectedIds.length})
          </Typography>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
    </AppBackground>
  );
}
