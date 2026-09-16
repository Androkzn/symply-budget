import { useNavigation } from 'expo-router/react-navigation';
import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, FlatList, KeyboardAvoidingView, Platform, StyleSheet, TouchableOpacity } from 'react-native';

import { chatApi } from '@api/chat';
import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Typography, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatScreenProps {
  reportId?: string;
}

export function ChatScreen({ reportId }: ChatScreenProps) {  const colors = useAppColors();
  const navigation = useNavigation();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadSuggestions();
  }, [currentHousehold?.id, reportId]);

  const loadSuggestions = async () => {
    if (!currentHousehold?.id) return;
    try {
      const result = await chatApi.getSuggestions(currentHousehold.id, reportId);
      setSuggestions(result.suggestions);
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || !currentHousehold?.id || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      const response = await chatApi.sendMessage(currentHousehold.id, {
        message: text.trim(),
        report_id: reportId,
      });

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to send message:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionPress = (suggestion: string) => {
    sendMessage(suggestion);
    setSuggestions([]);
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View
        style={[
          styles.messageContainer,
          isUser ? styles.userMessageContainer : styles.assistantMessageContainer,
        ]}
      >
        <Card
          variant="filled"
          style={[
            styles.messageBubble,
            {
              backgroundColor: isUser
                ? colors.primary
                : colors.backgroundSecondary,
            },
          ]}
        >
          <Typography
            variant="body"
            color={isUser ? colors.white : colors.textPrimary}
          >
            {item.content}
          </Typography>
        </Card>
      </View>
    );
  };

  return (
    <AppBackground>
      <ScreenHeader
        title="Ask about your home"
        showBackButton={navigation.canGoBack()}
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <SafeAreaView edges={['bottom']} style={styles.flex}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.subtitle}>
            Get AI-powered answers about your inspection findings
          </Typography>

          <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.emptyText}
              >
                Ask me anything about your home inspection, maintenance tips, or
                cost estimates.
              </Typography>

              {suggestions.length > 0 && (
                <View style={styles.suggestionsContainer}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    style={styles.suggestionsLabel}
                  >
                    Suggested questions:
                  </Typography>
                  {suggestions.map((suggestion, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[
                        styles.suggestionButton,
                        { borderColor: colors.borderColor },
                      ]}
                      onPress={() => handleSuggestionPress(suggestion)}
                    >
                      <Typography variant="callout" color={colors.primary}>
                        {suggestion}
                      </Typography>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          }
        />

        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={styles.loadingText}
            >
              Thinking...
            </Typography>
          </View>
        )}

        <View
          style={[
            styles.inputContainer,
            { borderTopColor: colors.borderColor },
          ]}
        >
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundSecondary,
                color: colors.textPrimary,
              },
            ]}
            placeholder="Type your question..."
            placeholderTextColor={colors.textTertiary}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(inputText)}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              {
                backgroundColor:
                  inputText.trim() && !isLoading
                    ? colors.primary
                    : colors.borderColor,
              },
            ]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim() || isLoading}
          >
            <Typography
              variant="callout"
              weight="semibold"
              color={inputText.trim() && !isLoading ? colors.white : colors.textSecondary}
            >
              Send
            </Typography>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  subtitle: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  messagesList: {
    padding: 16,
    flexGrow: 1,
    backgroundColor: 'transparent',
  },
  messageContainer: {
    marginBottom: 12,
    maxWidth: '85%',
  },
  userMessageContainer: {
    alignSelf: 'flex-end',
  },
  assistantMessageContainer: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    padding: 12,
    borderRadius: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  emptyText: {
    textAlign: 'center',
    marginBottom: 24,
  },
  suggestionsContainer: {
    width: '100%',
  },
  suggestionsLabel: {
    marginBottom: 12,
    textAlign: 'center',
  },
  suggestionButton: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  loadingText: {
    marginLeft: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    ...scaledFont('body'),
  },
  sendButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ChatScreen;
