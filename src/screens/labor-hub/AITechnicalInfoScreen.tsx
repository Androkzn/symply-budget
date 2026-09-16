import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';

import { aihousekeeperApi } from '@api/aihousekeeper';
import type {
  AihousekeeperChatContentBlock,
  AihousekeeperChatMessage,
} from '@api/aihousekeeper';
import { AIAccessGate } from '@components/ai/AIAccessGate';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';

type Props = NativeStackScreenProps<ContractorsStackParamList, 'AITechnicalInfo'>;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Generic prompt suggestions (UI affordances, not fabricated answers). The real
// content of every reply comes from the backend assistant.
const STARTER_QUESTIONS = [
  'Why does this matter for my home?',
  'What should I ask the contractor?',
  'What are typical costs involved?',
  'Can I do this myself, or should I hire a pro?',
];

/** Flatten the assistant's content (string or content blocks) to plain text. */
function extractText(content: string | AihousekeeperChatContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter(
      (b): b is Extract<AihousekeeperChatContentBlock, { type: 'text' }> =>
        b.type === 'text'
    )
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export function AITechnicalInfoScreen({ navigation, route }: Props) {
  const { technicalTerm, context } = route.params;  const colors = useAppColors();
  const scrollViewRef = useRef<ScrollView>(null);
  const householdId = useHouseholdStore((s) => s.currentHousehold?.id);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Full turn history sent to the backend on each request (includes the hidden
  // initial "explain this term" prompt so follow-ups keep context).
  const [history, setHistory] = useState<AihousekeeperChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const humanTerm = useMemo(
    () => technicalTerm.replace(/_/g, ' '),
    [technicalTerm]
  );
  const termTitle = useMemo(
    () => humanTerm.replace(/\b\w/g, (c) => c.toUpperCase()),
    [humanTerm]
  );

  const initialPrompt = useMemo(() => {
    const parts = [
      `A homeowner is reviewing a contractor visit and wants to understand "${humanTerm}".`,
    ];
    if (context?.visitPurpose) parts.push(`The visit is about: ${context.visitPurpose}.`);
    if (context?.contractorSpecialty)
      parts.push(`The contractor specializes in ${context.contractorSpecialty}.`);
    if (context?.relatedIssue) parts.push(`Related issue: ${context.relatedIssue}.`);
    parts.push(
      'Explain what it is in plain language, why it matters for their home, and what they should ask the contractor. Keep it concise.'
    );
    return parts.join(' ');
  }, [humanTerm, context]);

  const scrollToEnd = () => {
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // Fetch the real explanation from the backend assistant on mount.
  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      if (!householdId) {
        setMessages([
          {
            id: 'no-household',
            role: 'assistant',
            content: 'Select a household on your iPhone to use the assistant.',
            timestamp: new Date(),
          },
        ]);
        return;
      }

      setIsLoading(true);
      const userTurn: AihousekeeperChatMessage = { role: 'user', content: initialPrompt };
      try {
        const res = await aihousekeeperApi.chat(householdId, 'contractor_context', [
          userTurn,
        ]);
        if (cancelled) return;
        const text = extractText(res.response.content);
        setHistory([userTurn, { role: 'assistant', content: res.response.content }]);
        setMessages([
          { id: 'a1', role: 'assistant', content: text || '…', timestamp: new Date() },
        ]);
      } catch {
        if (cancelled) return;
        setMessages([
          {
            id: 'err-initial',
            role: 'assistant',
            content:
              "Sorry — I couldn't reach the assistant just now. Check your connection and try again.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadInitial();
    return () => {
      cancelled = true;
    };
  }, [householdId, initialPrompt]);

  const handleSendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    if (!householdId) return;

    setShowSuggestions(false);
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    scrollToEnd();

    const userTurn: AihousekeeperChatMessage = { role: 'user', content: trimmed };
    const nextHistory: AihousekeeperChatMessage[] = [...history, userTurn];

    try {
      const res = await aihousekeeperApi.chat(
        householdId,
        'contractor_context',
        nextHistory
      );
      const replyText = extractText(res.response.content);
      setHistory([...nextHistory, { role: 'assistant', content: res.response.content }]);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: replyText || '…',
          timestamp: new Date(),
        },
      ]);
      scrollToEnd();
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: "Sorry — I couldn't reach the assistant just now. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    screenHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderColor,
    },
    header: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderColor,
    },
    termTitle: {
      color: colors.textPrimary,
    },
    contextText: {
      color: colors.textSecondary,
      marginTop: 4,
    },
    messagesContainer: {
      flex: 1,
    },
    messagesContent: {
      padding: 16,
      paddingBottom: 100,
    },
    messageBubble: {
      maxWidth: '85%',
      padding: 12,
      borderRadius: 16,
      marginBottom: 12,
    },
    userBubble: {
      alignSelf: 'flex-end',
      backgroundColor: colors.primary,
      borderBottomRightRadius: 4,
    },
    assistantBubble: {
      alignSelf: 'flex-start',
      backgroundColor: colors.backgroundSecondary,
      borderBottomLeftRadius: 4,
    },
    userText: {
      color: colors.white,
      lineHeight: 22,
    },
    assistantText: {
      color: colors.textPrimary,
      lineHeight: 22,
    },
    loadingBubble: {
      alignSelf: 'flex-start',
      backgroundColor: colors.backgroundSecondary,
      padding: 16,
      borderRadius: 16,
      borderBottomLeftRadius: 4,
    },
    suggestionsContainer: {
      padding: 16,
      paddingTop: 8,
    },
    suggestionsLabel: {
      color: colors.textSecondary,
      marginBottom: 8,
    },
    suggestionButton: {
      backgroundColor: colors.backgroundSecondary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 20,
      marginRight: 8,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.borderColor,
    },
    suggestionText: {
      color: colors.textPrimary,
    },
    suggestionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      padding: 12,
      paddingBottom: Platform.OS === 'ios' ? 24 : 12,
      borderTopWidth: 1,
      borderTopColor: colors.borderColor,
      backgroundColor: colors.backgroundMain,
    },
    textInput: {
      flex: 1,
      backgroundColor: colors.backgroundSecondary,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
      paddingTop: 10,
      ...scaledFont('body'),
      maxHeight: 100,
      color: colors.textPrimary,
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    sendButtonDisabled: {
      backgroundColor: colors.borderColor,
    },
    saveButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.backgroundSecondary,
      paddingVertical: 12,
      marginHorizontal: 16,
      marginTop: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.borderColor,
    },
    saveButtonText: {
      color: colors.primary,
      marginLeft: 8,
    },
  });

  return (
    <AIAccessGate title="Unlock AI technical help">
    <AppBackground>
      <ScreenHeader
        title="Technical Info"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <View style={styles.header}>
        <Typography variant="bodyLarge" weight="semibold" style={styles.termTitle}>
          {termTitle}
        </Typography>
        {context?.visitPurpose && (
          <Typography variant="bodySmall" style={styles.contextText}>
            Context: {context.visitPurpose}
          </Typography>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={[screenScrollViewStyle.scroll, styles.messagesContainer]}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map(message => (
            <View
              key={message.id}
              style={[
                styles.messageBubble,
                message.role === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Typography
                variant="labelRegular"
                style={message.role === 'user' ? styles.userText : styles.assistantText}
              >
                {message.content}
              </Typography>
            </View>
          ))}

          {isLoading && (
            <View style={styles.loadingBubble}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}

          {showSuggestions && STARTER_QUESTIONS.length > 0 && (
            <View style={styles.suggestionsContainer}>
              <Typography variant="caption" style={styles.suggestionsLabel}>
                Questions you might ask:
              </Typography>
              <View style={styles.suggestionsRow}>
                {STARTER_QUESTIONS.map((question, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.suggestionButton}
                    onPress={() => handleSendMessage(question)}
                  >
                    <Typography variant="bodySmall" style={styles.suggestionText}>
                      {question}
                    </Typography>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {messages.length > 1 && (
            <TouchableOpacity style={styles.saveButton}>
              <Icon name="bookmark-outline" size={18} color={colors.primary} />
              <Typography variant="bodySmall" style={styles.saveButtonText}>
                Save to Visit Notes
              </Typography>
            </TouchableOpacity>
          )}
        </ScrollView>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="Ask a follow-up question..."
            placeholderTextColor={colors.textSecondary}
            value={inputText}
            onChangeText={setInputText}
            multiline
            returnKeyType="send"
            onSubmitEditing={() => handleSendMessage(inputText)}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !inputText.trim() && styles.sendButtonDisabled,
            ]}
            onPress={() => handleSendMessage(inputText)}
            disabled={!inputText.trim() || isLoading}
          >
            <Icon
              name="send"
              size={18}
              color={inputText.trim() ? colors.white : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </AppBackground>
    </AIAccessGate>
  );
}
