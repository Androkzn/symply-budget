import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, TextInput, ScrollView } from 'react-native';

import { contractorSearchApi } from '@api/contractor-search';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography, Button } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import {scaledFont, useAppColors } from '@theme';
import { getSystemCategoryIcon } from '@utils/categoryIcons';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type ContractorSearchRouteProp = RouteProp<ContractorsStackParamList, 'ContractorSearch'>;
type ContractorSearchNavigationProp = NativeStackNavigationProp<ContractorsStackParamList>;

// Common service categories for quick selection
const SERVICE_CATEGORIES = [
  { id: 'plumbing', label: 'Plumbing', systemCategory: 'plumbing' },
  { id: 'electrical', label: 'Electrical', systemCategory: 'electrical' },
  { id: 'hvac', label: 'HVAC', systemCategory: 'hvac' },
  { id: 'roofing', label: 'Roofing', systemCategory: 'roofing' },
  { id: 'landscaping', label: 'Landscaping', systemCategory: 'landscaping' },
  { id: 'cleaning', label: 'Cleaning', systemCategory: 'cleaning' },
  { id: 'painting', label: 'Painting', systemCategory: 'painting' },
  { id: 'general', label: 'General', systemCategory: 'other' },
];

export function ContractorSearchScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<ContractorSearchNavigationProp>();
  const route = useRoute<ContractorSearchRouteProp>();
  const { currentHousehold } = useHouseholdStore();
  
  // Safely destructure params with defaults
  const params: Partial<NonNullable<ContractorsStackParamList['ContractorSearch']>> = route.params ?? {};
  const problemTitleParam = params.problemTitle ?? '';
  const problemDescriptionParam = params.problemDescription ?? '';
  const systemCategoryParam = params.systemCategory ?? 'other';
  const sourceType = params.sourceType ?? 'task';
  const sourceId = params.sourceId ?? '';

  // Enhanced metadata params with safe JSON parsing
  const contractorCategoryParam = params.contractorCategory;
  const severityParam = params.severity;
  const urgencyScoreParam = params.urgencyScore ? parseInt(params.urgencyScore, 10) : undefined;
  const propertyAddressParam = params.propertyAddress;

  // Safe JSON parsing with error handling
  const sourcePageNumbersParam = React.useMemo(() => {
    if (!params.sourcePageNumbers) return undefined;
    try {
      return JSON.parse(params.sourcePageNumbers) as number[];
    } catch (error) {
      console.error('[ContractorSearch] Failed to parse sourcePageNumbers:', error);
      return undefined;
    }
  }, [params.sourcePageNumbers]);

  const sourceQuotesParam = React.useMemo(() => {
    if (!params.sourceQuotes) return undefined;
    try {
      return JSON.parse(params.sourceQuotes) as string[];
    } catch (error) {
      console.error('[ContractorSearch] Failed to parse sourceQuotes:', error);
      return undefined;
    }
  }, [params.sourceQuotes]);

  const subtasksParam = React.useMemo(() => {
    if (!params.subtasks) return undefined;
    try {
      return JSON.parse(params.subtasks) as string[];
    } catch (error) {
      console.error('[ContractorSearch] Failed to parse subtasks:', error);
      return undefined;
    }
  }, [params.subtasks]);

  // Determine if we have context from a task/action item
  const hasExternalContext = Boolean(problemTitleParam);
  
  // Form state for manual input
  const [manualTitle, setManualTitle] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  const [status, setStatus] = useState<'input' | 'searching' | 'error'>(
    hasExternalContext ? 'searching' : 'input'
  );
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [searchProgress, setSearchProgress] = useState<string>('Preparing search...');
  const [isNetworkError, setIsNetworkError] = useState(false);
  
  // Use ref to prevent multiple searches
  const hasSearched = useRef(false);

  // Perform search with given parameters
  const performSearch = useCallback(async (title: string, description: string, category: string) => {
    if (!currentHousehold) {
      setStatus('error');
      setErrorMessage('No property selected');
      setIsNetworkError(false);
      return;
    }

    // Check if household has location info
    if (!currentHousehold.city || !currentHousehold.state_province) {
      setStatus('error');
      setErrorMessage('Your property address is incomplete. Please update your property city and state/province in Settings to find nearby contractors.');
      setIsNetworkError(false);
      return;
    }

    try {
      setStatus('searching');
      setIsNetworkError(false);
      const city = currentHousehold.city;
      const state = currentHousehold.state_province;
      
      setSearchProgress(`AI is researching contractors in ${city}, ${state}...`);

      // Generate a temporary UUID for manual searches (React Native compatible)
      const tempSourceId = sourceId || `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // Build enhanced search request with all available metadata
      const searchRequest: Parameters<typeof contractorSearchApi.search>[1] = {
        problem_title: title,
        problem_description: description || title,
        system_category: category,
        location: {
          city,
          state,
          address: propertyAddressParam || `${currentHousehold.address_line1 || ''}, ${city}, ${state}`.trim(),
        },
        source_type: sourceType,
        source_id: tempSourceId,
      };

      // Add enhanced metadata if available
      if (contractorCategoryParam) {
        searchRequest.contractor_category = contractorCategoryParam;
      }
      if (severityParam) {
        searchRequest.severity = severityParam;
      }
      if (urgencyScoreParam) {
        searchRequest.urgency_score = urgencyScoreParam;
      }
      if (sourcePageNumbersParam) {
        searchRequest.source_page_numbers = sourcePageNumbersParam;
      }
      if (sourceQuotesParam) {
        searchRequest.source_quotes = sourceQuotesParam;
      }
      if (subtasksParam && subtasksParam.length > 0) {
        searchRequest.subtasks = subtasksParam;
      }

      const result = await contractorSearchApi.search(currentHousehold.id, searchRequest);
      
      // Navigate to results
      navigation.replace('ContractorSearchResults', {
        searchResult: result,
        problemTitle: title,
        problemDescription: description || title,
      });
      
    } catch (error) {
      console.error('Search error:', error);
      setStatus('error');
      setErrorMessage('Failed to search for contractors. Please check your connection and try again.');
      setIsNetworkError(true);
    }
  }, [currentHousehold, sourceId, propertyAddressParam, sourceType, contractorCategoryParam, severityParam, urgencyScoreParam, sourcePageNumbersParam, sourceQuotesParam, subtasksParam, navigation]);

  // Auto-search when we have external context
  useEffect(() => {
    if (!hasExternalContext) return;
    if (hasSearched.current) return;
    hasSearched.current = true;

    performSearch(problemTitleParam, problemDescriptionParam, systemCategoryParam);
  }, [hasExternalContext, problemTitleParam, problemDescriptionParam, systemCategoryParam, performSearch]);

  const handleManualSearch = () => {
    if (!manualTitle.trim()) return;
    
    const category = selectedCategory 
      ? SERVICE_CATEGORIES.find(c => c.id === selectedCategory)?.systemCategory || 'other'
      : 'other';
    
    performSearch(manualTitle.trim(), manualDescription.trim(), category);
  };

  const handleRetry = () => {
    if (hasExternalContext) {
      // Retry with original params
      hasSearched.current = false;
      setStatus('searching');
      setErrorMessage('');
      setSearchProgress('Retrying search...');
      performSearch(problemTitleParam, problemDescriptionParam, systemCategoryParam);
    } else {
      // Go back to input form
      setStatus('input');
      setErrorMessage('');
    }
  };

  const handleCancel = () => {
    navigation.goBack();
  };

  const currentProblemTitle = hasExternalContext ? problemTitleParam : manualTitle;

  return (
    <AppBackground>
      <ScreenHeader
        title="Find Contractors"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      
      {/* No `KeyboardAvoidingView`: it only shrinks the viewport, leaving the
          focused field behind the keyboard. The ScrollView's
          `automaticallyAdjustKeyboardInsets` is what scrolls it back into view
          — see `src/utils/keyboard.ts`. */}
      <View style={styles.keyboardView} testID="contractor-search-screen">
        <AdaptiveContainer>
          {status === 'input' ? (
            <ScrollView
              {...keyboardDismissScrollProps}
              style={[screenScrollViewStyle.scroll, styles.scrollView]}
              contentContainerStyle={styles.inputContainer}
            >
              {/* Header */}
              <View style={styles.inputHeader}>
                <Icon
                  name="search"
                  size={48}
                  color={colors.primary}
                  style={styles.inputIcon}
                />
                <Typography
                  variant="headline"
                  weight="semibold"
                  style={styles.inputTitle}
                >
                  What do you need help with?
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.inputSubtitle}
                >
                  Describe your issue and we'll find the best contractors near you
                </Typography>
              </View>

              {/* Category Selection */}
              <View style={styles.categorySection}>
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  style={styles.sectionLabel}
                >
                  Category (optional)
                </Typography>
                <View style={styles.categoryGrid}>
                  {SERVICE_CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category.id}
                      style={[
                        styles.categoryChip,
                        { 
                          backgroundColor: selectedCategory === category.id 
                            ? colors.primary + '20' 
                            : colors.groupedListBackground,
                          borderColor: selectedCategory === category.id 
                            ? colors.primary 
                            : 'transparent',
                        },
                      ]}
                      onPress={() => setSelectedCategory(
                        selectedCategory === category.id ? null : category.id
                      )}
                    >
                      <Icon
                        name={getSystemCategoryIcon(
                          category.systemCategory === 'roofing' ? 'roof' : category.systemCategory
                        )}
                        size={16}
                        color={
                          selectedCategory === category.id
                            ? colors.primary
                            : colors.textPrimary
                        }
                      />
                      <Typography
                        variant="caption1"
                        weight={selectedCategory === category.id ? 'semibold' : 'regular'}
                        style={{
                          color: selectedCategory === category.id
                            ? colors.primary
                            : colors.textPrimary,
                          marginLeft: 4,
                        }}
                      >
                        {category.label}
                      </Typography>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Title Input */}
              <View style={styles.inputSection}>
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  style={styles.sectionLabel}
                >
                  What's the issue? *
                </Typography>
                <TextInput
                  style={[
                    styles.textInput,
                    { 
                      backgroundColor: colors.groupedListBackground,
                      color: colors.textPrimary,
                    },
                  ]}
                  placeholder="e.g., Leaky faucet in kitchen"
                  placeholderTextColor={colors.textTertiary}
                  value={manualTitle}
                  onChangeText={setManualTitle}
                  maxLength={200}
                  testID="contractor-search-title-input"
                />
              </View>

              {/* Description Input */}
              <View style={styles.inputSection}>
                <Typography
                  variant="subheadline"
                  weight="semibold"
                  style={styles.sectionLabel}
                >
                  More details (optional)
                </Typography>
                <TextInput
                  style={[
                    styles.textInput,
                    styles.textInputMultiline,
                    { 
                      backgroundColor: colors.groupedListBackground,
                      color: colors.textPrimary,
                    },
                  ]}
                  placeholder="Add any additional details that might help..."
                  placeholderTextColor={colors.textTertiary}
                  value={manualDescription}
                  onChangeText={setManualDescription}
                  multiline
                  numberOfLines={4}
                  maxLength={1000}
                  textAlignVertical="top"
                />
              </View>

              {/* Search Button */}
              <Button
                title="Search for Contractors"
                onPress={handleManualSearch}
                disabled={!manualTitle.trim()}
                style={styles.searchButton}
                testID="contractor-search-submit"
              />
            </ScrollView>
          ) : status === 'error' ? (
            <View style={styles.container}>
              <View style={styles.errorContainer}>
                <Icon
                  name="warning"
                  size={48}
                  color={colors.warning}
                  style={styles.errorIcon}
                />
                <Typography
                  variant="headline"
                  weight="semibold"
                  style={styles.errorTitle}
                >
                  Unable to Search
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.errorMessage}
                >
                  {errorMessage}
                </Typography>
                <View style={styles.buttonContainer}>
                  {isNetworkError && (
                    <Button
                      title="Try Again"
                      onPress={handleRetry}
                      style={styles.retryButton}
                    />
                  )}
                  <Button
                    title={isNetworkError ? "Cancel" : "Go Back"}
                    variant="secondary"
                    onPress={isNetworkError ? handleCancel : handleRetry}
                    style={styles.cancelButton}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.container}>
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Typography
                  variant="headline"
                  weight="semibold"
                  style={styles.loadingTitle}
                >
                  Finding Contractors
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.loadingMessage}
                >
                  {searchProgress}
                </Typography>
                <View style={[styles.problemInfo, { backgroundColor: colors.groupedListBackground }]}>
                  <Typography
                    variant="caption1"
                    color={colors.textTertiary}
                    style={styles.problemLabel}
                  >
                    Searching for help with:
                  </Typography>
                  <Typography
                    variant="subheadline"
                    weight="medium"
                    numberOfLines={2}
                    style={styles.problemText}
                  >
                    {currentProblemTitle}
                  </Typography>
                </View>
              </View>
            </View>
          )}
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  inputContainer: {
    padding: 24,
    paddingBottom: 48,
  },
  inputHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  inputIcon: {
    marginBottom: 16,
  },
  inputTitle: {
    textAlign: 'center',
    marginBottom: 8,
  },
  inputSubtitle: {
    textAlign: 'center',
    lineHeight: 22,
  },
  categorySection: {
    marginBottom: 24,
  },
  sectionLabel: {
    marginBottom: 12,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
  },
  inputSection: {
    marginBottom: 20,
  },
  textInput: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...scaledFont('body'),
  },
  textInputMultiline: {
    minHeight: 100,
    paddingTop: 14,
  },
  searchButton: {
    marginTop: 16,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingTitle: {
    marginTop: 24,
    textAlign: 'center',
  },
  loadingMessage: {
    marginTop: 8,
    textAlign: 'center',
  },
  problemInfo: {
    marginTop: 32,
    padding: 16,
    borderRadius: 12,
    width: '100%',
    maxWidth: 300,
  },
  problemLabel: {
    marginBottom: 4,
  },
  problemText: {
    textAlign: 'center',
  },
  errorContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  errorIcon: {
    marginBottom: 16,
  },
  errorTitle: {
    textAlign: 'center',
  },
  errorMessage: {
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonContainer: {
    marginTop: 32,
    width: '100%',
    maxWidth: 280,
    gap: 12,
  },
  retryButton: {
    width: '100%',
  },
  cancelButton: {
    width: '100%',
  },
});
