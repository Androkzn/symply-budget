import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useState, useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  TouchableOpacity,
  Linking,
  Alert,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { FoundContractor } from '@api/contractor-search';
import { AppBackground, ScreenFooterGlass, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography, Button, Card, StarRating } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { ContractorsStackParamList } from '@navigation/types';
import { useAppColors } from '@theme';

// Helper to format contractor info for sharing
function formatContractorForShare(contractor: FoundContractor): string {
  const lines = [
    `📋 ${contractor.name}`,
    contractor.company_name && contractor.company_name !== contractor.name 
      ? `   Company: ${contractor.company_name}` 
      : null,
    `⭐ Rating: ${contractor.rating.toFixed(1)}/5 (${contractor.review_count} reviews)`,
    `🔧 Specialty: ${contractor.specialty}`,
    contractor.address ? `📍 ${contractor.address}` : null,
    contractor.phone ? `📞 ${contractor.phone}` : null,
    contractor.email ? `📧 ${contractor.email}` : null,
    contractor.website ? `🌐 ${contractor.website}` : null,
    contractor.highlights.length > 0 
      ? `\n✨ Highlights:\n${contractor.highlights.map(h => `   • ${h}`).join('\n')}`
      : null,
  ].filter(Boolean);
  
  return lines.join('\n');
}

function formatContractorsListForShare(
  contractors: FoundContractor[], 
  problemTitle: string
): string {
  const header = `🏠 Contractor Recommendations for: ${problemTitle}\n${'─'.repeat(40)}\n`;
  
  const contractorsList = contractors.map((c, i) => {
    const basic = [
      `\n${i + 1}. ${c.name}`,
      `   ⭐ ${c.rating.toFixed(1)}/5 (${c.review_count} reviews)`,
      c.phone ? `   📞 ${c.phone}` : null,
      c.email ? `   📧 ${c.email}` : null,
      c.website ? `   🌐 ${c.website}` : null,
    ].filter(Boolean).join('\n');
    return basic;
  }).join('\n');
  
  const footer = `\n\n${'─'.repeat(40)}\nFound via Simple House App`;
  
  return header + contractorsList + footer;
}

type ContractorSearchResultsRouteProp = RouteProp<ContractorsStackParamList, 'ContractorSearchResults'>;
type ContractorSearchResultsNavigationProp = NativeStackNavigationProp<ContractorsStackParamList>;

// Custom star rating display with review count
function StarRatingWithCount({ rating, reviewCount }: { rating: number; reviewCount: number }) {
  const colors = useAppColors();
  
  return (
    <View style={styles.ratingContainer}>
      <StarRating rating={rating} size={14} />
      <Typography variant="caption1" weight="medium" style={styles.ratingText}>
        {rating.toFixed(1)}
      </Typography>
      <Typography variant="caption2" color={colors.textSecondary}>
        ({reviewCount} reviews)
      </Typography>
    </View>
  );
}

interface ContractorResultCardProps {
  contractor: FoundContractor;
  isSelected: boolean;
  onToggleSelect: () => void;
  onCall: () => void;
  onEmail: () => void;
  onWebsite: () => void;
  onMaps: () => void;
  onShare: () => void;
}

function ContractorResultCard({
  contractor,
  isSelected,
  onToggleSelect,
  onCall,
  onEmail,
  onWebsite,
  onMaps,
  onShare,
}: ContractorResultCardProps) {
  const { theme } = useTheme();
  const colors = useAppColors();

  return (
    <Card
      variant="outlined"
      style={[
        styles.contractorCard,
        isSelected && { borderColor: colors.primary, borderWidth: 2 },
      ]}
    >
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={onToggleSelect}
        activeOpacity={0.7}
      >
        <View style={[styles.selectCircle, { borderColor: colors.borderColor }]}>
          {isSelected && (
            <View style={[styles.selectCircleFilled, { backgroundColor: colors.primary }]}>
              <Icon name="checkmark" size={14} color={colors.white} />
            </View>
          )}
        </View>
        <View style={styles.headerContent}>
          <Typography variant="headline" weight="semibold" numberOfLines={1}>
            {contractor.name}
          </Typography>
          {contractor.company_name && contractor.company_name !== contractor.name && (
            <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
              {contractor.company_name}
            </Typography>
          )}
        </View>
        {contractor.reddit_mentions && (
          <View style={[styles.redditBadge, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="caption2" style={{ color: colors.warning }}>
              Reddit
            </Typography>
          </View>
        )}
      </TouchableOpacity>

      <StarRatingWithCount rating={contractor.rating} reviewCount={contractor.review_count} />

      <View style={styles.address}>
        <Icon name="location" size={14} color={colors.textSecondary} />
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          numberOfLines={2}
          style={styles.addressText}
        >
          {contractor.address}
        </Typography>
      </View>

      {contractor.highlights.length > 0 && (
        <View style={styles.highlightsContainer}>
          {contractor.highlights.slice(0, 2).map((highlight, index) => (
            <View key={index} style={styles.highlightItem}>
              <Icon name="checkmark" size={12} color={colors.textSecondary} />
              <Typography
                variant="caption2"
                color={colors.textSecondary}
                style={styles.highlightText}
              >
                {highlight}
              </Typography>
            </View>
          ))}
        </View>
      )}

      {contractor.reddit_mentions && (
        <View
          style={[
            styles.redditMentions,
            styles.redditMentionsRow,
            { backgroundColor: colors.backgroundSecondary },
          ]}
        >
          <Icon name="phone-portrait" size={12} color={colors.warning} />
          <Typography variant="caption2" style={{ color: colors.warning }}>
            Reddit: {contractor.reddit_mentions}
          </Typography>
        </View>
      )}

      <View style={styles.actionButtons}>
        {contractor.phone && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.pastel.teal + '20' }]}
            onPress={onCall}
          >
            <Icon name="call" size={13} color={theme.pastel.teal} />
            <Typography variant="caption1" color={theme.pastel.teal}>
              Call
            </Typography>
          </TouchableOpacity>
        )}
        {contractor.email && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.primary + '20' }]}
            onPress={onEmail}
          >
            <Icon name="mail" size={13} color={colors.primary} />
            <Typography variant="caption1" color={colors.primary}>
              Email
            </Typography>
          </TouchableOpacity>
        )}
        {contractor.website && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.backgroundSecondary }]}
            onPress={onWebsite}
          >
            <Icon name="globe" size={13} color={colors.info} />
            <Typography variant="caption1" color={colors.info}>
              Web
            </Typography>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.backgroundSecondary }]}
          onPress={onMaps}
        >
          <Icon name="location" size={13} color={colors.success} />
          <Typography variant="caption1" color={colors.success}>
            Maps
          </Typography>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.backgroundSecondary }]}
          onPress={onShare}
        >
          <Icon name="share-outline" size={13} color={colors.warning} />
          <Typography variant="caption1" color={colors.warning}>
            Share
          </Typography>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

export function ContractorSearchResultsScreen() {
  const navigation = useNavigation<ContractorSearchResultsNavigationProp>();
  const route = useRoute<ContractorSearchResultsRouteProp>();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { content: containerPadding } = useLayoutPadding();
  
  const { searchResult, problemTitle, problemDescription } = route.params;
  const [selectedContractors, setSelectedContractors] = useState<Set<number>>(new Set());

  const toggleSelection = useCallback((index: number) => {
    setSelectedContractors((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  }, []);

  const handleCall = useCallback((phone: string) => {
    Linking.openURL(`tel:${phone}`);
  }, []);

  const handleQuickEmail = useCallback((email: string) => {
    Linking.openURL(`mailto:${email}`);
  }, []);

  const handleWebsite = useCallback((website: string) => {
    Linking.openURL(website);
  }, []);

  const handleMaps = useCallback((url: string) => {
    Linking.openURL(url);
  }, []);

  const handleShareContractor = useCallback(async (contractor: FoundContractor) => {
    try {
      const message = formatContractorForShare(contractor);
      await Share.share({
        message,
        title: `Contractor: ${contractor.name}`,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  }, []);

  const handleShareAll = useCallback(async () => {
    try {
      const message = formatContractorsListForShare(searchResult.contractors, problemTitle);
      await Share.share({
        message,
        title: `Contractor Recommendations`,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  }, [searchResult.contractors, problemTitle]);

  const handleComposeEmail = useCallback(() => {
    if (selectedContractors.size === 0) {
      Alert.alert(
        'No Contractors Selected',
        'Please select at least one contractor to email.'
      );
      return;
    }

    const selected = Array.from(selectedContractors).map(
      (index) => searchResult.contractors[index]
    );

    navigation.navigate('ComposeContractorEmail', {
      contractors: selected,
      problemTitle,
      problemDescription,
    });
  }, [selectedContractors, searchResult.contractors, navigation, problemTitle, problemDescription]);

  const handleSelectAll = useCallback(() => {
    if (selectedContractors.size === searchResult.contractors.length) {
      setSelectedContractors(new Set());
    } else {
      setSelectedContractors(
        new Set(searchResult.contractors.map((_, i) => i))
      );
    }
  }, [selectedContractors.size, searchResult.contractors]);

  const handleDone = useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  const contractorsWithEmail = searchResult.contractors.filter((c) => c.email);

  return (
    <AppBackground>
      <View style={styles.container} testID="contractor-search-results-screen">
      <ScreenHeader
        title="Contractors Found"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          <TouchableOpacity onPress={handleDone} style={styles.doneButton}>
            <Typography variant="body" color={colors.primary}>Done</Typography>
          </TouchableOpacity>
        }
      />
      <AdaptiveContainer>
        <ScrollView
          style={[screenScrollViewStyle.scroll, styles.scrollView]}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Summary */}
          <View style={styles.summaryContainer}>
            <Typography variant="title3" weight="semibold">
              {searchResult.contractors.length} Contractors
            </Typography>
            <Typography
              variant="body"
              color={colors.textSecondary}
              style={styles.summaryText}
            >
              {searchResult.search_summary}
            </Typography>
            {searchResult.location_note && (
              <View style={styles.locationNote}>
                <Icon name="location" size={14} color={colors.textTertiary} />
                <Typography
                  variant="caption1"
                  color={colors.textTertiary}
                  style={styles.locationNoteText}
                >
                  {searchResult.location_note}
                </Typography>
              </View>
            )}
            {searchResult.contractors.length > 0 && (
              <TouchableOpacity
                style={[styles.shareAllButton, { backgroundColor: colors.backgroundSecondary }]}
                onPress={handleShareAll}
              >
                <Icon name="share-outline" size={16} color={colors.primary} />
                <Typography variant="subheadline" color={colors.primary}>
                  Share All Contractors
                </Typography>
              </TouchableOpacity>
            )}
          </View>

          {/* Select All */}
          {contractorsWithEmail.length > 0 && (
            <TouchableOpacity
              style={styles.selectAllRow}
              onPress={handleSelectAll}
            >
              <Typography variant="subheadline" color={colors.primary}>
                {selectedContractors.size === searchResult.contractors.length
                  ? 'Deselect All'
                  : 'Select All'}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {selectedContractors.size} selected
              </Typography>
            </TouchableOpacity>
          )}

          {/* Contractor Cards */}
          {searchResult.contractors.map((contractor, index) => (
            <ContractorResultCard
              key={index}
              contractor={contractor}
              isSelected={selectedContractors.has(index)}
              onToggleSelect={() => toggleSelection(index)}
              onCall={() => contractor.phone && handleCall(contractor.phone)}
              onEmail={() => contractor.email && handleQuickEmail(contractor.email)}
              onWebsite={() => contractor.website && handleWebsite(contractor.website)}
              onMaps={() => handleMaps(contractor.google_maps_url)}
              onShare={() => handleShareContractor(contractor)}
            />
          ))}

          {searchResult.contractors.length === 0 && (
            <View style={styles.emptyContainer}>
              <Icon
                name="search"
                size={48}
                color={colors.textSecondary}
                style={styles.emptyIcon}
              />
              <Typography variant="headline" weight="semibold">
                No Contractors Found
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.emptyText}
              >
                We couldn't find contractors in your area. Try adjusting your search or check back later.
              </Typography>
            </View>
          )}
        </ScrollView>

        {/* Bottom Action Bar */}
        {selectedContractors.size > 0 && (
          <View
            style={[
              styles.bottomBar,
              { paddingHorizontal: containerPadding, paddingBottom: insets.bottom + 16 },
            ]}
          >
            <ScreenFooterGlass />
            <View style={styles.bottomBarContent}>
              <Typography variant="subheadline" color={colors.textSecondary}>
                {selectedContractors.size} contractor{selectedContractors.size > 1 ? 's' : ''} selected
              </Typography>
              <Button
                title="Compose Email"
                leftIcon={<Icon name="mail" size={16} color={colors.white} />}
                onPress={handleComposeEmail}
                testID="contractor-search-compose-email"
              />
            </View>
          </View>
        )}
      </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  doneButton: {
    padding: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  summaryContainer: {
    marginBottom: 8,
  },
  summaryText: {
    marginTop: 4,
  },
  locationNote: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationNoteText: {
    flex: 1,
  },
  shareAllButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectAllRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  contractorCard: {
    padding: 16,
    marginBottom: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  selectCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCircleFilled: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContent: {
    flex: 1,
  },
  redditBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 8,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  stars: {
    flexDirection: 'row',
    marginRight: 4,
  },
  ratingText: {
    marginRight: 4,
  },
  address: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addressText: {
    flex: 1,
  },
  highlightsContainer: {
    marginBottom: 8,
    gap: 4,
  },
  highlightItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  highlightText: {
    flex: 1,
  },
  redditMentions: {
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  redditMentionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    marginTop: 8,
    textAlign: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // Tall enough that the glass fade begins well above the content, so its
    // top edge reads as transparent rather than a hard line over the list.
    paddingTop: 32,
    overflow: 'hidden',
  },
  bottomBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
