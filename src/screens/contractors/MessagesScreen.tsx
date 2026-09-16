import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, TextInput } from 'react-native';

import { SPECIALTY_INFO, type ContractorSpecialty } from '@api/contractors';
import { messagesApi, type ConversationSummary } from '@api/messages';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useMessageStore } from '@stores/messageStore';
import { CornerRadius, Layout, Spacing, useAppColors, scaledFont } from '@theme';
import { getContractorCategoryIcon } from '@utils/categoryIcons';
import { keyboardDismissScrollProps } from '@utils/keyboard';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface ConversationCardProps {
  conversation: ConversationSummary;
  onPress: () => void;
}

function ConversationCard({ conversation, onPress }: ConversationCardProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const specialtyInfo = SPECIALTY_INFO[conversation.contractor_specialty as ContractorSpecialty] ||
    SPECIALTY_INFO.other;

  return (
    <TouchableOpacity
      style={[
        styles.conversationCard,
        { backgroundColor: colors.backgroundSecondary },
        conversation.unread_count > 0 && [
          styles.unreadCard,
          { borderLeftColor: colors.primary },
        ],
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      testID={`messages-conversation-${conversation.contractor_id}`}
    >
      <View style={styles.cardLeft}>
        <View
          style={[
            styles.avatarContainer,
            { backgroundColor: specialtyInfo.color + '20' },
          ]}
        >
          <Icon
            name={getContractorCategoryIcon(conversation.contractor_specialty)}
            size={24}
            color={specialtyInfo.color}
          />
        </View>
      </View>

      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Typography
            variant="headline"
            weight={conversation.unread_count > 0 ? 'semibold' : 'regular'}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {conversation.contractor_name}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            {formatDate(conversation.last_message.created_at)}
          </Typography>
        </View>

        {conversation.contractor_company && (
          <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
            {conversation.contractor_company}
          </Typography>
        )}

        <View style={styles.messagePreview}>
          {conversation.last_message.direction === 'outbound' && (
            <Typography variant="caption1" color={colors.textSecondary}>
              You:{' '}
            </Typography>
          )}
          <Typography
            variant="subheadline"
            color={conversation.unread_count > 0 ? colors.textPrimary : colors.textSecondary}
            weight={conversation.unread_count > 0 ? 'medium' : 'regular'}
            numberOfLines={2}
            style={{ flex: 1 }}
          >
            {conversation.last_message.body}
          </Typography>
        </View>
      </View>

      <View style={styles.cardRight}>
        {conversation.unread_count > 0 && (
          <View style={[styles.unreadBadge, { backgroundColor: theme.pastel.teal }]}>
            <Typography variant="caption2" color={colors.white} weight="semibold">
              {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
            </Typography>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export function MessagesScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<ContractorsStackParamList>>();
  const { isTablet } = useDeviceType();
  const { currentHousehold } = useHouseholdStore();
  const { conversations, setConversations, setLoading, isLoading, totalUnreadCount } = useMessageStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Consistent layout padding
  const { content: containerPadding } = useLayoutPadding();

  const loadData = useCallback(async () => {
    if (!currentHousehold?.id) return;

    try {
      setError(null);
      setLoading(true);
      const data = await messagesApi.getConversations(currentHousehold.id);
      setConversations(data.conversations);
    } catch (err) {
      console.error('Error loading conversations:', err);
      setError('Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, [currentHousehold?.id, setConversations, setLoading]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handleConversationPress = (conversation: ConversationSummary) => {
    navigation.navigate('Conversation', {
      contractorId: conversation.contractor_id,
      contractorName: conversation.contractor_name,
    });
  };

  // Filter conversations by search query
  const filteredConversations = conversations.filter((conv) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      conv.contractor_name.toLowerCase().includes(query) ||
      (conv.contractor_company?.toLowerCase().includes(query) ?? false) ||
      conv.last_message.body.toLowerCase().includes(query)
    );
  });

  if (isLoading && conversations.length === 0) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            title="Messages"
            showBackButton
            onBackPress={handleGoBack}
            showNotificationBell={false}
            showAvatar={false}
          />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.white} />
          </View>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="messages-screen">
        <ScreenHeader
          title="Messages"
          showBackButton
          onBackPress={handleGoBack}
          showNotificationBell={false}
          showAvatar={false}
          rightElement={
            totalUnreadCount > 0 ? (
              <View style={[styles.headerBadge, { backgroundColor: theme.pastel.teal }]}>
                <Typography variant="caption2" color={colors.white} weight="semibold">
                  {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
                </Typography>
              </View>
            ) : undefined
          }
        />

        <AdaptiveContainer maxWidth={isTablet ? 800 : undefined} padding={containerPadding}>
          <ScrollView {...keyboardDismissScrollProps}
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={theme.pastel.teal}
              />
            }
          >
            {/* Search Bar */}
            <View style={[styles.searchContainer, { backgroundColor: colors.backgroundSecondary }]}>
              <Icon
                name="search"
                size={18}
                color={colors.textSecondary}
                style={styles.searchIcon}
              />
              <TextInput
                style={[styles.searchInput, { color: colors.textPrimary }]}
                placeholder="Search messages..."
                placeholderTextColor={colors.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                testID="messages-search-input"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Icon name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Conversations List */}
            {filteredConversations.length === 0 ? (
              <View style={styles.emptyState} testID="messages-empty-state">
                <Icon
                  name="chatbubbles"
                  size={40}
                  color={colors.textSecondary}
                  style={{ marginBottom: 8 }}
                />
                <Typography variant="headline" weight="semibold" style={{ marginBottom: 4 }}>
                  {searchQuery ? 'No matching conversations' : 'No messages yet'}
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={{ textAlign: 'center' }}
                >
                  {searchQuery
                    ? 'Try a different search term'
                    : 'Start a conversation with a contractor from their profile'}
                </Typography>
              </View>
            ) : (
              filteredConversations.map((conversation) => (
                <ConversationCard
                  key={conversation.contractor_id}
                  conversation={conversation}
                  onPress={() => handleConversationPress(conversation)}
                />
              ))
            )}

            {error && (
              <View style={styles.errorContainer}>
                <Typography variant="body" color={colors.error}>
                  {error}
                </Typography>
              </View>
            )}
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.smd,
    marginBottom: Spacing.base,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...scaledFont('body'),
    padding: 0,
  },
  conversationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  unreadCard: {
    borderLeftWidth: 3,
  },
  cardLeft: {
    marginRight: Spacing.md,
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xxs,
  },
  messagePreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: Spacing.xs,
  },
  cardRight: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs + Spacing.xxs,
  },
  headerBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.gapTight5,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: Spacing.xxl,
  },
  errorContainer: {
    marginTop: Spacing.base,
    padding: Spacing.md,
    alignItems: 'center',
  },
});
