import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, TextInput, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  messagesApi,
  type MessageWithContractor,
  type MessageChannel,
} from '@api/messages';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
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
import { CornerRadius, Opacity, scaledFont, Spacing, useAppColors } from '@theme';

/** Apply an alpha channel to a solid `#RRGGBB` color. */
function withAlpha(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return hex;
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shouldShowDateSeparator(current: string, previous?: string): boolean {
  if (!previous) return true;
  const currentDate = new Date(current).toDateString();
  const previousDate = new Date(previous).toDateString();
  return currentDate !== previousDate;
}

interface MessageBubbleProps {
  message: MessageWithContractor;
  isOwn: boolean;
}

function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const { theme } = useTheme();
  const colors = useAppColors();

  return (
    <View
      style={[
        styles.messageBubbleContainer,
        isOwn ? styles.ownMessageContainer : styles.otherMessageContainer,
      ]}
    >
      <View
        style={[
          styles.messageBubble,
          isOwn
            ? [styles.ownBubble, { backgroundColor: theme.pastel.teal }]
            : [styles.otherBubble, { backgroundColor: colors.backgroundSecondary }],
        ]}
      >
        {message.subject && (
          <Typography
            variant="caption1"
            weight="semibold"
            color={isOwn ? colors.white : colors.textPrimary}
            style={styles.messageSubject}
          >
            {message.subject}
          </Typography>
        )}
        <Typography
          variant="body"
          color={isOwn ? colors.white : colors.textPrimary}
        >
          {message.body}
        </Typography>
        <View style={styles.messageFooter}>
          <Typography
            variant="caption2"
            color={isOwn ? withAlpha(colors.white, Opacity.onColorLabel) : colors.textSecondary}
          >
            {formatTime(message.created_at)}
          </Typography>
          {isOwn && message.status && (
            <View style={styles.messageStatus}>
              {(message.status === 'delivered' || message.status === 'read') && (
                <Icon
                  name="checkmark-done"
                  size={13}
                  color={withAlpha(colors.white, Opacity.onColorLabel)}
                />
              )}
              {message.status === 'sent' && (
                <Icon
                  name="checkmark"
                  size={13}
                  color={withAlpha(colors.white, Opacity.onColorLabel)}
                />
              )}
              {message.status === 'failed' && (
                <Icon
                  name="warning"
                  size={13}
                  color={withAlpha(colors.white, Opacity.onColorLabel)}
                />
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

export function ConversationScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<ContractorsStackParamList>>();
  const route = useRoute<RouteProp<ContractorsStackParamList, 'Conversation'>>();
  const insets = useSafeAreaInsets();
  const { isTablet } = useDeviceType();
  const { currentHousehold } = useHouseholdStore();
  const {
    currentConversation,
    setCurrentConversation,
    setSelectedContractorId,
    addMessage,
    markConversationAsRead,
    isSending,
    setSending,
  } = useMessageStore();

  const { contractorId, contractorName } = route.params;
  const scrollViewRef = useRef<ScrollView>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Consistent layout padding
  const { content: containerPadding } = useLayoutPadding();

  const loadData = useCallback(async () => {
    if (!currentHousehold?.id) return;

    try {
      setError(null);
      const data = await messagesApi.getConversation(currentHousehold.id, contractorId);
      setCurrentConversation(data.messages);
      setSelectedContractorId(contractorId);

      // Mark conversation as read
      await messagesApi.markConversationAsRead(currentHousehold.id, contractorId);
      markConversationAsRead(contractorId);
    } catch (err) {
      console.error('Error loading conversation:', err);
      setError('Failed to load messages');
    }
  }, [currentHousehold?.id, contractorId, setCurrentConversation, setSelectedContractorId, markConversationAsRead]);

  useEffect(() => {
    setIsLoading(true);
    loadData().finally(() => setIsLoading(false));

    return () => {
      setSelectedContractorId(null);
      setCurrentConversation([]);
    };
  }, [loadData, setSelectedContractorId, setCurrentConversation]);

  useEffect(() => {
    // Scroll to bottom when messages change
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [currentConversation.length]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleSendMessage = async () => {
    if (!currentHousehold?.id || !messageText.trim() || isSending) return;

    const text = messageText.trim();
    setMessageText('');
    Keyboard.dismiss();
    setSending(true);

    try {
      const result = await messagesApi.create(currentHousehold.id, {
        contractor_id: contractorId,
        channel: 'in_app' as MessageChannel,
        body: text,
      });

      addMessage(result.message);
    } catch (err) {
      console.error('Error sending message:', err);
      setMessageText(text); // Restore message text on error
      setError('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleBack = () => {
    navigation.goBack();
  };

  const renderScreenHeader = (showInfo = false) => (
    <ScreenHeader
      title={contractorName}
      titleAlign="left"
      showBackButton
      onBackPress={handleBack}
      showNotificationBell={false}
      showAvatar={false}
      rightElement={
        showInfo ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('ContractorDetail', { contractorId })}
            style={styles.profileButton}
          >
            <Icon name="information-circle" size={22} color={colors.primary} />
          </TouchableOpacity>
        ) : undefined
      }
    />
  );

  if (isLoading) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          {renderScreenHeader()}
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.white} />
          </View>
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        testID="conversation-screen"
      >
        {renderScreenHeader(true)}

        <AdaptiveContainer maxWidth={isTablet ? 800 : undefined} padding={0}>
          <ScrollView keyboardShouldPersistTaps="handled"
            ref={scrollViewRef}
            style={[screenScrollViewStyle.scroll, styles.scrollView]}
            contentContainerStyle={[styles.messagesContent, { paddingHorizontal: containerPadding }]}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={theme.pastel.teal}
              />
            }
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: false })}
          >
            {currentConversation.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon
                  name="chatbubbles"
                  size={40}
                  color={colors.textSecondary}
                  style={{ marginBottom: 8 }}
                />
                <Typography variant="headline" weight="semibold" style={{ marginBottom: 4 }}>
                  Start the conversation
                </Typography>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={{ textAlign: 'center' }}
                >
                  Send a message to {contractorName}
                </Typography>
              </View>
            ) : (
              currentConversation.map((message, index) => {
                const previousMessage = index > 0 ? currentConversation[index - 1] : undefined;
                const showDateSeparator = shouldShowDateSeparator(
                  message.created_at,
                  previousMessage?.created_at
                );

                return (
                  <React.Fragment key={message.id}>
                    {showDateSeparator && (
                      <View style={styles.dateSeparator}>
                        <Typography
                          variant="caption1"
                          color={colors.textSecondary}
                          weight="medium"
                        >
                          {formatDate(message.created_at)}
                        </Typography>
                      </View>
                    )}
                    <MessageBubble
                      message={message}
                      isOwn={message.direction === 'outbound'}
                    />
                  </React.Fragment>
                );
              })
            )}

            {error && (
              <View style={styles.errorContainer}>
                <Typography variant="caption1" color={colors.error}>
                  {error}
                </Typography>
              </View>
            )}
          </ScrollView>

          {/* Message Input */}
          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: colors.backgroundSecondary,
                paddingBottom: insets.bottom + 8,
              },
            ]}
          >
            <View style={[styles.inputWrapper, { backgroundColor: colors.backgroundMain }]}>
              <TextInput
                style={[styles.textInput, { color: colors.textPrimary }]}
                placeholder="Type a message..."
                placeholderTextColor={colors.textSecondary}
                value={messageText}
                onChangeText={setMessageText}
                multiline
                maxLength={2000}
                editable={!isSending}
                testID="conversation-input"
              />
            </View>
            <TouchableOpacity
              onPress={handleSendMessage}
              disabled={!messageText.trim() || isSending}
              style={[
                styles.sendButton,
                (!messageText.trim() || isSending) && styles.sendButtonDisabled,
              ]}
              testID="conversation-send"
            >
              {isSending ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <LinearGradient
                  colors={
                    messageText.trim()
                      ? [colors.primary, colors.primaryDark]
                      : [colors.textTertiary, colors.textSecondary]
                  }
                  style={styles.sendButtonGradient}
                >
                  <Icon name="send" size={18} color={colors.white} />
                </LinearGradient>
              )}
            </TouchableOpacity>
          </View>
        </AdaptiveContainer>
      </KeyboardAvoidingView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerContent: {
    flex: 1,
  },
  profileButton: {
    padding: Spacing.sm,
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  messagesContent: {
    paddingVertical: Spacing.base,
    paddingBottom: Spacing.base,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateSeparator: {
    alignItems: 'center',
    marginVertical: Spacing.base,
  },
  messageBubbleContainer: {
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  ownMessageContainer: {
    alignItems: 'flex-end',
  },
  otherMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: CornerRadius.lg,
    padding: Spacing.md,
  },
  ownBubble: {
    borderBottomRightRadius: CornerRadius.xs,
  },
  otherBubble: {
    borderBottomLeftRadius: CornerRadius.xs,
  },
  messageSubject: {
    marginBottom: Spacing.xs,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: Spacing.xs,
  },
  messageStatus: {
    marginLeft: Spacing.xs,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: Spacing.xxl,
  },
  errorContainer: {
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    alignItems: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  inputWrapper: {
    flex: 1,
    borderRadius: CornerRadius.xl,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.smd,
    marginRight: Spacing.sm,
    minHeight: 40,
    maxHeight: 120,
  },
  textInput: {
    ...scaledFont('body'),
    padding: 0,
    lineHeight: 22,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.xl,
    overflow: 'hidden',
    marginBottom: Spacing.xxs,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
