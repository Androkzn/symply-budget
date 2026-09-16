import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

import { languageTutorApi, type TutorMessageRow } from '../api/languageTutor';

interface ChatMessage {
  id: string;
  fromUser: boolean;
  text: string;
}

function rowToMessage(row: TutorMessageRow): ChatMessage {
  return {
    id: row.id,
    fromUser: row.is_user === 1 || row.is_user === true,
    text: (row.content ?? row.text ?? '') as string,
  };
}

let localId = 0;
const nextLocalId = () => `local-${(localId += 1)}`;

export function LanguageTutorScreen() {  const colors = useAppColors();
  const { content: containerPadding } = useLayoutPadding();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [booting, setBooting] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const boot = useCallback(async () => {
    try {
      const session = await languageTutorApi.createSession();
      setSessionId(session.id);
      const rows = await languageTutorApi.getMessages(session.id);
      setMessages(rows.map(rowToMessage).filter((m) => m.text));
    } catch {
      setError('Could not start your tutor session. Check your connection and try again.');
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !sessionId || sending) return;
    setDraft('');
    setError(null);
    const userMsg: ChatMessage = { id: nextLocalId(), fromUser: true, text };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    scrollToEnd();
    try {
      const reply = await languageTutorApi.sendMessage({ sessionId, text });
      setMessages((prev) => [
        ...prev,
        { id: reply.teacherMessageId ?? nextLocalId(), fromUser: false, text: reply.message },
      ]);
      scrollToEnd();
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: nextLocalId(),
          fromUser: false,
          text: '⚠️ I couldn’t reply just now. Please try again in a moment.',
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [draft, sessionId, sending, scrollToEnd]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <View
        style={[
          styles.bubbleRow,
          { justifyContent: item.fromUser ? 'flex-end' : 'flex-start' },
        ]}
      >
        <View
          testID={item.fromUser ? 'language-tutor-user-message' : undefined}
          style={[
            styles.bubble,
            item.fromUser
              ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
              : { backgroundColor: colors.backgroundSecondary, borderBottomLeftRadius: 4 },
          ]}
        >
          <Typography
            variant="body"
            color={item.fromUser ? colors.white : colors.textPrimary}
          >
            {item.text}
          </Typography>
        </View>
      </View>
    ),
    [colors.primary, colors.white, colors.backgroundSecondary, colors.textPrimary],
  );

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="language-tutor-screen">
        <ScreenHeader title="Tutor" showNotificationBell={false} showPropertySwitcher={false} />

        {booting ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={90}
          >
            {messages.length === 0 && !error ? (
              <View style={styles.center}>
                <Icon name="teaching-chat" size={40} color={colors.textSecondary} />
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.emptyText}
                >
                  Ask your tutor anything — a word, a phrase, or “teach me a greeting”.
                </Typography>
              </View>
            ) : (
              <FlatList
                ref={listRef}
                testID="language-tutor-messages"
                data={messages}
                keyExtractor={(m) => m.id}
                renderItem={renderItem}
                contentContainerStyle={[
                  styles.listContent,
                  { paddingHorizontal: containerPadding },
                ]}
                onContentSizeChange={scrollToEnd}
                keyboardShouldPersistTaps="handled"
              />
            )}

            {error && (
              <Typography variant="footnote" color={colors.error} style={styles.errorText}>
                {error}
              </Typography>
            )}

            <View
              style={[
                styles.inputBar,
                { paddingHorizontal: containerPadding, borderTopColor: colors.borderColor },
              ]}
            >
              <TextInput
                testID="language-tutor-composer"
                value={draft}
                onChangeText={setDraft}
                placeholder="Message your tutor…"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: colors.borderColor,
                  },
                ]}
                multiline
                onSubmitEditing={() => void send()}
                editable={!!sessionId}
              />
              <Pressable
                onPress={() => void send()}
                disabled={!draft.trim() || sending || !sessionId}
                style={[
                  styles.sendBtn,
                  {
                    backgroundColor:
                      !draft.trim() || sending || !sessionId
                        ? colors.borderColor
                        : colors.primary,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Icon name="arrow-up" size={20} color={colors.white} />
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyText: { textAlign: 'center', maxWidth: 280 },
  listContent: { paddingTop: Spacing.base, paddingBottom: Spacing.base, gap: Spacing.sm },
  bubbleRow: { flexDirection: 'row', width: '100%' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.lg,
  },
  errorText: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.xs },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingBottom: Layout.bottomTabBarClearance,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    fontSize: 16,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
