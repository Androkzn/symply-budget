import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@components/ui';
import {
  CompleteIcon,
  InboxIcon,
  InterviewIcon,
  PendingIcon,
  useBrandIconState,
} from '@features/kaizen/brand/iconset';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import { KaizenFileUploadPanel } from '@features/kaizen/components/KaizenFileUploadPanel';
import {
  useInvalidateKaizenInterviewQuestions,
  useKaizenInterviewQuestions,
} from '@features/kaizen/hooks/useKaizenInterviewQuestions';
import { selectPendingInterviewQuestions } from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { CornerRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { readUploadFileText } from '@features/kaizen/upload/readUploadFileText';
import { KAIZEN_DRIVE_SCOPES } from '@features/kaizen/upload/rememberScopes';
import { useRequireAIAccess } from '@hooks/useRequireAIAccess';
import { consumeE2EQuestionImportResult, peekE2EQuestionImportResult } from '@services/e2e-question-import';
import { useAuthStore } from '@stores/authStore';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

export function QuestionImportScreen() {
  const { e2eText } = useLocalSearchParams<{ e2eText?: string | string[] }>();
  const e2eTextParam = typeof e2eText === 'string' ? e2eText : e2eText?.[0];
  const colors = useAppColors();
  const appColors = useAppColors();
  const userId = useAuthStore(state => state.user?.id);
  const uploadIconState = useBrandIconState(true);
  const { data: questions = [] } = useKaizenInterviewQuestions();
  const invalidateQuestions = useInvalidateKaizenInterviewQuestions();
  const importQuestionsFromText = useKaizenStore(state => state.importQuestionsFromText);
  const approveQuestion = useKaizenStore(state => state.approveQuestion);
  const rejectQuestion = useKaizenStore(state => state.rejectQuestion);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [importedCount, setImportedCount] = useState(() => {
    const pending = consumeE2EQuestionImportResult();
    return pending != null && pending > 0 ? pending : 0;
  });
  const [importSourceName, setImportSourceName] = useState<string | null>(null);
  const pending = selectPendingInterviewQuestions(questions);
  const pendingE2ECount = __DEV__ ? peekE2EQuestionImportResult() : null;
  const successCount = importedCount > 0 ? importedCount : (pendingE2ECount ?? 0);

  useEffect(() => {
    if (!__DEV__ || typeof e2eTextParam !== 'string' || !e2eTextParam.trim()) return;
    let decoded = e2eTextParam;
    try {
      decoded = decodeURIComponent(e2eTextParam);
    } catch {
      decoded = e2eTextParam;
    }
    setText(decoded);
    void (async () => {
      setLoading(true);
      try {
        const count = await importQuestionsFromText(decoded.trim());
        setImportedCount(count);
        setText('');
        if (userId) await invalidateQuestions(userId);
      } catch {
        // Keep pasted text when import fails.
      } finally {
        setLoading(false);
      }
    })();
  }, [e2eTextParam, importQuestionsFromText, invalidateQuestions, userId]);

  useFocusEffect(
    useCallback(() => {
      const imported = consumeE2EQuestionImportResult();
      if (imported == null || imported <= 0) return;
      setImportedCount(imported);
      setText('');
    }, []),
  );

  useEffect(() => {
    if (!__DEV__) return;
    const timer = setInterval(() => {
      const pending = peekE2EQuestionImportResult();
      if (pending == null || pending <= 0) return;
      setImportedCount(pending);
      setText('');
      consumeE2EQuestionImportResult();
    }, 250);
    return () => clearInterval(timer);
  }, []);

  const refreshQuestions = async () => {
    if (userId) {
      await invalidateQuestions(userId);
    }
  };

  // Import is the AI path (a model extracts questions from free text/a file).
  // Adding questions BY HAND on the banks screen needs no AI and is offered as
  // the alternative below, so the bank itself is never blocked.
  const { canUseAI, ensureCanUseAI } = useRequireAIAccess();

  const importFromFile = async (file: { uri: string; name: string }) => {
    if (!ensureCanUseAI()) return;
    setLoading(true);
    try {
      const content = await readUploadFileText(file);
      setText(content);
      setImportSourceName(file.name);
      const count = await importQuestionsFromText(content);
      setImportedCount(count);
      setText('');
      await refreshQuestions();
    } catch {
      // Keep pasted text when import fails.
    } finally {
      setLoading(false);
    }
  };
  const importQuestions = async () => {
    if (!ensureCanUseAI()) return;
    setLoading(true);
    try {
      const devPrefill =
        __DEV__ && typeof e2eTextParam === 'string' && e2eTextParam.trim()
          ? (() => {
              try {
                return decodeURIComponent(e2eTextParam).trim();
              } catch {
                return e2eTextParam.trim();
              }
            })()
          : '';
      const payload = text.trim() || devPrefill;
      if (!payload) return;
      const count = await importQuestionsFromText(payload);
      setImportedCount(count);
      setText('');
      await refreshQuestions();
    } catch {
      // Keep pasted text when import fails.
    } finally {
      setLoading(false);
    }
  };

  return (
    <KaizenScreen
      title="Import questions"
      subtitle="Paste a question list, then approve or reject each item before it enters practice."
      showBackButton
    >
      <KaizenFileUploadPanel
        title="Upload question list"
        subtitle="Import from camera, gallery, files, or Google Drive — questions scope remembers its own Drive folder."
        rememberScope={KAIZEN_DRIVE_SCOPES.questions}
        allowAllFileTypes
        loading={loading}
        selectedFileName={importSourceName}
        onClearSelection={() => setImportSourceName(null)}
        onFileSelected={file => void importFromFile(file)}
        headerIcon={
          <InterviewIcon size={26} state={uploadIconState} color={colors.primary} />
        }
      />

      <CommandCenterCard tint={colors.primary}>
        <View style={styles.cardHeader}>
          <InboxIcon size={24} color={colors.primary} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>QUESTION TEXT</Text>
        </View>
        <View style={styles.form}>
          <TextInput
            testID="kaizen-import-question-input"
            multiline
            value={text}
            onChangeText={setText}
            placeholder="One interview question per line"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              {
                borderColor: appColors.glassBorder,
                backgroundColor: appColors.inputFieldBackground,
                color: colors.textPrimary,
              },
            ]}
          />
          <Pressable
            testID="kaizen-import-for-review"
            accessibilityRole="button"
            accessibilityLabel="Import for review"
            accessibilityState={{ disabled: loading }}
            style={[
              styles.importButton,
              {
                borderColor: colors.primary,
                opacity: loading ? 0.5 : 1,
              },
            ]}
            disabled={loading}
            onPress={() => {
              if (!text.trim() || loading) return;
              void importQuestions();
            }}
          >
            {loading ? (
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Importing…</Text>
            ) : (
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Import for review</Text>
            )}
          </Pressable>
          {!canUseAI ? (
            <Text testID="kaizen-import-manual-hint" style={{ color: colors.textSecondary }}>
              Importing reads your list with AI. Without it you can still add
              questions one at a time in Question banks — nothing here is locked away.
            </Text>
          ) : null}
          {successCount > 0 ? (
            <Text
              testID="kaizen-import-success"
              accessibilityLabel={`Imported ${successCount} question${successCount === 1 ? '' : 's'} for review.`}
              style={{ color: colors.textSecondary }}
            >
              Imported {successCount} question{successCount === 1 ? '' : 's'} for review.
            </Text>
          ) : null}
        </View>
      </CommandCenterCard>
      <Section title={`Pending review (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState>No pending imports. Approved questions live in Question banks.</EmptyState>
        ) : (
          pending.map(question => (
            <View
              key={question.id}
              style={[kaizenStyles.row, { alignItems: 'flex-start', borderBottomColor: colors.borderColor }]}
            >
              <View style={styles.rowIcon}><PendingIcon size={22} color={colors.warning} /></View>
              <View style={kaizenStyles.rowText}>
                <Text style={{ color: colors.textPrimary, fontWeight: '500' }}>{question.prompt}</Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                  {question.question_bank}
                </Text>
              </View>
              <Pressable
                style={[styles.approvePill, { backgroundColor: appColors.surfaceSelected }]}
                onPress={() =>
                  void approveQuestion(question.id)
                    .then(() => refreshQuestions())
                    .catch(() => undefined)
                }
              >
                <CompleteIcon size={16} color={colors.primary} />
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Approve</Text>
              </Pressable>
              <Pressable
                style={styles.rejectPill}
                onPress={() =>
                  void rejectQuestion(question.id)
                    .then(() => refreshQuestions())
                    .catch(() => undefined)
                }
              >
                <Text style={{ color: colors.error, fontWeight: '600' }}>Reject</Text>
              </Pressable>
            </View>
          ))
        )}
      </Section>
      <View style={styles.footer}>
        <Button title="Open question banks" variant="outline" onPress={() => router.push('/kaizen/banks')} />
      </View>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  label: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  form: { gap: Spacing.md },
  input: {
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    minHeight: 200,
    padding: Spacing.md,
    textAlignVertical: 'top',
    fontSize: Typography.body.size,
  },
  importButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: CornerRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  rowIcon: { marginTop: 2 },
  approvePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 36,
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.md,
  },
  rejectPill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: Spacing.sm,
  },
  footer: { marginTop: Spacing.base, paddingHorizontal: Spacing.xs },
});
