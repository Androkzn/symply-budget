import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AIAccessGate } from '@components/ai/AIAccessGate';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { BrandButton, GlassCard, GradientButton } from '@features/kaizen/brand';
import { AiCoachIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import {
  openCoachToolRoute,
  resolveCoachToolResults,
  type CoachToolResult,
} from '@features/kaizen/services/coachToolResolver';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { CornerRadius, GlassRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { KaizenScreen } from './common';

interface Message {
  id: string;
  body: string;
  sender: 'user' | 'coach';
}

export function CoachChatScreen() {
  const colors = useAppColors();
  const appColors = useAppColors();
  const iconState = useBrandIconState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const hasAIDisclosureAck = useKaizenStore(state => state.hasAIDisclosureAck);
  const setAIDisclosureAck = useKaizenStore(state => state.setAIDisclosureAck);
  const [disclosureAck, setDisclosureAck] = useState(() => hasAIDisclosureAck());
  const [sessionId, setSessionId] = useState<string>();
  const [memoryUpdates, setMemoryUpdates] = useState<
    Array<{ category: string; fact: string; sensitivity?: string }>
  >([]);
  const [toolResults, setToolResults] = useState<CoachToolResult[]>([]);
  const sendCoachMessage = useKaizenStore(state => state.sendCoachMessage);
  const upsertMemory = useKaizenStore(state => state.upsertMemory);
  const approveMemory = useKaizenStore(state => state.approveMemory);

  const send = async () => {
    const message = draft.trim();
    if (!message || isSending || !disclosureAck) return;
    setDraft('');
    setMessages(current => [...current, { id: `${Date.now()}-user`, body: message, sender: 'user' }]);
    setIsSending(true);
    try {
      const response = await sendCoachMessage(
        message,
        messages.map(item => ({
          role: item.sender === 'user' ? 'user' : 'assistant',
          content: item.body,
        })),
        disclosureAck,
        sessionId,
      );
      setSessionId(response.session_id);
      const body =
        (typeof response.assistant_message === 'string' && response.assistant_message) ||
        response.message?.content ||
        'Your coach received that. Check back shortly for feedback.';
      setMessages(current => [
        ...current,
        { id: `${Date.now()}-coach`, body, sender: 'coach' },
      ]);
      const resolved = await resolveCoachToolResults(
        (response.tool_results ?? []) as CoachToolResult[],
      );
      setToolResults(resolved);
      setMemoryUpdates(response.proposed_memory_updates ?? []);
    } catch {
      setMessages(current => [
        ...current,
        {
          id: `${Date.now()}-coach`,
          body: 'I could not reach the coach. Please try again.',
          sender: 'coach',
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const lastCoachMessage = [...messages].reverse().find(item => item.sender === 'coach');
  const nextBestStep = lastCoachMessage?.body ?? 'Review load balancing & scaling patterns';

  return (
    <KaizenScreen
      title="Guide"
      subtitle="Ask your coach for practical next steps."
      screenTestId="kaizen-guide-screen"
    >
      {/*
        Kaizen Master is a pure-AI surface — there is no manual equivalent of a
        coaching turn — so the whole screen sits behind the shared gate (same
        component House/Budget use). Every other Kaizen tool stays reachable
        without AI; only this one asks for PRO or a connected key. The
        disclosure ack below is a SEPARATE, additional consent: entitlement says
        whose key pays, disclosure says the user agreed to send context off-device.
      */}
      <AIAccessGate title="Unlock AI for Kaizen Master">
      <View style={styles.chatColumn} testID="kaizen-guide-chat">
        <View style={styles.messages} testID="kaizen-guide-messages">
          {!disclosureAck && (
            <Pressable
              testID="kaizen-guide-enable-ai"
              accessibilityRole="button"
              accessibilityLabel="Enable AI"
              onPress={() => {
                setDisclosureAck(true);
                setAIDisclosureAck(true);
              }}
            >
              <GlassCard strong radius={GlassRadius.cardTight}>
                <View style={styles.disclosureRow}>
                  <View
                    style={[
                      styles.disclosureIcon,
                      {
                        backgroundColor: appColors.pillBackground,
                        borderColor: appColors.glassBorder,
                      },
                    ]}
                  >
                    <AiCoachIcon size={22} state={iconState} />
                  </View>
                  <View style={styles.disclosureText}>
                    <Text style={[styles.disclosureTitle, { color: colors.primary }]}>
                      Enable AI
                    </Text>
                    <Text style={{ color: colors.textSecondary, lineHeight: 20 }}>
                      Your messages and selected Kaizen context will be sent to an AI coach.
                    </Text>
                  </View>
                </View>
              </GlassCard>
            </Pressable>
          )}
          {messages.length === 0 ? (
            <View style={styles.emptyState} testID="kaizen-guide-empty">
              <View
                style={[
                  styles.emptyIcon,
                  {
                    backgroundColor: appColors.pillBackground,
                    borderColor: appColors.glassBorder,
                  },
                ]}
              >
                <AiCoachIcon size={28} state={iconState} />
              </View>
              <Text style={[styles.emptyPrompt, { color: colors.textSecondary }]}>
                What would make today feel meaningfully better?
              </Text>
            </View>
          ) : (
            messages.map(item =>
              item.sender === 'user' ? (
                <View
                  key={item.id}
                  style={[
                    styles.bubble,
                    styles.userBubble,
                    { backgroundColor: appColors.chatUserBubble },
                  ]}
                >
                  <Text style={[styles.bubbleText, { color: appColors.white }]}>{item.body}</Text>
                </View>
              ) : (
                <View key={item.id} style={styles.coachRow}>
                  <View
                    style={[
                      styles.avatar,
                      {
                        backgroundColor: appColors.pillBackground,
                        borderColor: appColors.glassBorder,
                      },
                    ]}
                  >
                    <AiCoachIcon size={18} state={iconState} />
                  </View>
                  <View
                    style={[
                      styles.bubble,
                      styles.coachBubble,
                      { backgroundColor: appColors.chatAssistantBubble },
                    ]}
                  >
                    <Text style={[styles.bubbleText, { color: colors.textPrimary }]}>
                      {item.body}
                    </Text>
                  </View>
                </View>
              ),
            )
          )}
          {toolResults.map((result, index) => (
            <Pressable
              key={`${result.tool}-${index}`}
              style={[
                styles.chip,
                { backgroundColor: appColors.pillBackground, borderColor: appColors.glassBorder },
              ]}
              onPress={() => openCoachToolRoute(result)}
            >
              <Text style={[styles.chipTool, { color: colors.primary }]}>{result.tool}</Text>
              {result.result ? (
                <Text style={{ color: colors.textSecondary }}>{result.result}</Text>
              ) : null}
            </Pressable>
          ))}
          {memoryUpdates.map(update => (
            <GlassCard key={update.fact} padding={12} radius={GlassRadius.cardTight}>
              <View style={styles.memoryRow}>
                <View style={styles.memoryText}>
                  <Text style={{ color: colors.textPrimary }}>{update.fact}</Text>
                  <Text style={[styles.memoryCategory, { color: colors.textSecondary }]}>
                    {update.category}
                  </Text>
                </View>
                <Pressable
                  style={[styles.approvePill, { backgroundColor: appColors.surfaceSelected }]}
                  onPress={() =>
                    void upsertMemory(update)
                      .then(() => approveMemory(update.fact))
                      .then(() =>
                        setMemoryUpdates(current =>
                          current.filter(item => item.fact !== update.fact),
                        ),
                      )
                  }
                >
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>Approve</Text>
                </Pressable>
              </View>
            </GlassCard>
          ))}
        </View>
        {messages.length > 0 && (
          <GlassCard radius={GlassRadius.cardTight}>
            <Text style={[styles.nextLabel, { color: colors.primary }]}>NEXT BEST STEP</Text>
            <Text
              style={[styles.nextSuggestion, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {nextBestStep}
            </Text>
            <BrandButton title="Start practice" onPress={() => router.push('/kaizen/practice')} />
          </GlassCard>
        )}
        <View
          testID="kaizen-guide-composer"
          style={[
            styles.composer,
            {
              backgroundColor: appColors.chatInputBackground,
              borderColor: appColors.chatInputBorder,
            },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message your coach"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.textPrimary }]}
            editable={disclosureAck}
            onSubmitEditing={() => void send()}
          />
          <GradientButton
            onPress={() => void send()}
            disabled={!disclosureAck}
            accessibilityLabel="Send"
            style={[styles.sendButton, !disclosureAck && styles.sendButtonDisabled]}
          >
            {isSending ? (
              <ActivityIndicator color={appColors.white} />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            )}
          </GradientButton>
        </View>
        <Pressable style={styles.manageLink} onPress={() => router.push('/kaizen/memory')}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Manage memory →</Text>
        </Pressable>
      </View>
      </AIAccessGate>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  chatColumn: { gap: Spacing.md, marginTop: Spacing.md },
  messages: { gap: Spacing.smd },
  emptyState: {
    alignItems: 'flex-start',
    gap: Spacing.smd,
    paddingVertical: Spacing.sm,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  emptyPrompt: { fontSize: Typography.body.size, lineHeight: Typography.body.lineHeight },
  coachRow: {
    alignItems: 'flex-end',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.sm,
    maxWidth: '88%',
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText: { fontSize: Typography.body.size, lineHeight: Typography.body.lineHeight },
  coachBubble: { borderBottomLeftRadius: 6, flexShrink: 1 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 6, maxWidth: '82%' },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
    maxWidth: '92%',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.smd,
  },
  chipTool: { fontWeight: '700' },
  disclosureRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.md },
  disclosureIcon: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  disclosureText: { flex: 1, gap: Spacing.xxs },
  disclosureTitle: { fontSize: Typography.bodyMedium.size, fontWeight: '700' },
  memoryRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.md },
  memoryText: { flex: 1, gap: Spacing.xxs },
  memoryCategory: { fontSize: Typography.caption.size },
  approvePill: {
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  nextLabel: {
    fontSize: Typography.micro.size,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
  },
  nextSuggestion: {
    fontSize: Typography.bodyMedium.size,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  composer: {
    alignItems: 'center',
    borderRadius: GlassRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.sm - Spacing.xxs,
    paddingVertical: Spacing.sm - Spacing.xxs,
  },
  input: {
    flex: 1,
    fontSize: Typography.body.size,
    paddingVertical: Spacing.smd,
  },
  sendButton: { borderRadius: 22, height: 44, width: 44 },
  sendButtonDisabled: { opacity: 0.5 },
  manageLink: { marginTop: Spacing.md },
});
