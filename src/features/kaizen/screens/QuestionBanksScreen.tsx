import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@components/ui';
import { BrandButton } from '@features/kaizen/brand';
import {
  InboxIcon,
  InterviewIcon,
  LibraryIcon,
  PracticeIcon,
  useBrandIconState,
} from '@features/kaizen/brand/iconset';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import { useKaizenInterviewQuestions } from '@features/kaizen/hooks/useKaizenInterviewQuestions';
import {
  selectApprovedInterviewQuestionsOrdered,
  selectDueInterviewQuestions,
  selectIsInterviewQuestionDue,
  selectPendingInterviewQuestions,
} from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { CornerRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';
import { useRequireAIAccess } from '@hooks/useRequireAIAccess';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

export function QuestionBanksScreen() {
  const colors = useAppColors();  const appColors = useAppColors();
  const { data: questions = [] } = useKaizenInterviewQuestions();
  const addInterviewQuestion = useKaizenStore(state => state.addInterviewQuestion);
  const generateIdealAnswerForQuestion = useKaizenStore(state => state.generateIdealAnswerForQuestion);
  const [prompt, setPrompt] = useState('');
  const [bank, setBank] = useState<'technical' | 'behavioral'>('technical');
  const [saving, setSaving] = useState(false);
  // Building and practising banks is fully manual. Only "Ideal answer" spends a
  // model call, so it is the single action here that needs entitlement — and it
  // routes to the unlock hub rather than swallowing the denial.
  const { ensureCanUseAI } = useRequireAIAccess();
  const generateIdealAnswer = (questionId: string) => {
    if (!ensureCanUseAI()) return;
    void generateIdealAnswerForQuestion(questionId).catch(() => undefined);
  };
  const add = async () => {
    if (!prompt.trim()) return;
    setSaving(true);
    try {
      await addInterviewQuestion(prompt.trim(), bank);
      setPrompt('');
    } catch {
      // Keep the prompt when add fails.
    } finally {
      setSaving(false);
    }
  };
  const ordered = selectApprovedInterviewQuestionsOrdered(questions);
  const pending = selectPendingInterviewQuestions(questions);
  const dueCount = selectDueInterviewQuestions(questions).length;

  const heroIconState = useBrandIconState(true);
  const techIconState = useBrandIconState(bank === 'technical');
  const behavioralIconState = useBrandIconState(bank === 'behavioral');

  return (
    <KaizenScreen title="Question banks" subtitle="Practice the questions that build recall." showBackButton>
      <CommandCenterCard tint={colors.primary}>
        <View style={styles.heroRow}>
          <PracticeIcon size={26} state={heroIconState} />
          <View style={styles.heroText}>
            <Text style={[styles.heroTitle, { color: colors.textPrimary }]}>Ready to practice</Text>
            <Text style={[styles.heroMeta, { color: colors.textSecondary }]}>
              {dueCount} due · {ordered.length} approved
            </Text>
          </View>
          {dueCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: appColors.pillBackground }]}>
              <Text style={[styles.badgeText, { color: colors.warning }]}>{dueCount} due</Text>
            </View>
          ) : null}
        </View>
        <BrandButton
          title="Start practice"
          style={styles.heroCta}
          onPress={() => router.push('/kaizen/practice')}
        />
      </CommandCenterCard>

      <CommandCenterCard>
        <Text style={[styles.label, { color: colors.textSecondary }]}>ADD QUESTION</Text>
        <View style={styles.form}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Interview question"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.textPrimary, borderColor: appColors.glassBorder, backgroundColor: appColors.inputFieldBackground }]}
          />
          <View style={styles.banks} testID="kaizen-bank-picker">
            <Pressable
              testID="kaizen-bank-technical"
              accessibilityLabel="Technical"
              style={[styles.bankPill, { backgroundColor: bank === 'technical' ? appColors.surfaceSelected : appColors.pillBackground }]}
              onPress={() => setBank('technical')}
            >
              <LibraryIcon size={20} state={techIconState} />
              <Text style={[styles.bankLabel, { color: bank === 'technical' ? colors.primary : colors.textSecondary }]}>Technical</Text>
            </Pressable>
            <Pressable
              testID="kaizen-bank-behavioral"
              accessibilityLabel="Behavioral"
              style={[styles.bankPill, { backgroundColor: bank === 'behavioral' ? appColors.surfaceSelected : appColors.pillBackground }]}
              onPress={() => setBank('behavioral')}
            >
              <InterviewIcon size={20} state={behavioralIconState} />
              <Text style={[styles.bankLabel, { color: bank === 'behavioral' ? colors.primary : colors.textSecondary }]}>Behavioral</Text>
            </Pressable>
          </View>
          <Button title="Add question" loading={saving} disabled={!prompt.trim()} testID="kaizen-add-question" onPress={() => void add()} />
        </View>
      </CommandCenterCard>

      <Section title="Import questions">
        <KaizenImportUploadSection purpose="questions" />
      </Section>

      <Pressable style={styles.importLink} onPress={() => router.push('/kaizen/question-import')}>
        <InboxIcon size={20} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Import questions →</Text>
      </Pressable>

      {pending.length > 0 ? (
        <Section title={`Pending review (${pending.length})`}>
          <Pressable style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]} onPress={() => router.push('/kaizen/question-import')}>
            <InboxIcon size={22} color={colors.primary} />
            <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>{pending.length} imported questions need approval</Text>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Review</Text>
          </Pressable>
        </Section>
      ) : null}
      <Section title="Approved questions">
        {ordered.length === 0 ? <EmptyState>Imported and generated questions will appear here.</EmptyState> : ordered.map(question => {
          const BankIcon = question.question_bank === 'behavioral' ? InterviewIcon : LibraryIcon;
          const isDue = selectIsInterviewQuestionDue(question);
          return (
            <Pressable key={question.id} style={[kaizenStyles.row, { alignItems: 'flex-start', borderBottomColor: colors.borderColor }]} onPress={() => router.push({ pathname: '/kaizen/practice', params: { questionId: question.id } })}>
              <View style={styles.rowIcon}><BankIcon size={22} color={colors.primary} /></View>
              <View style={kaizenStyles.rowText}>
                <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '500' }}>{question.prompt}</Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                  {question.question_bank} · Due {question.due_at ? new Date(question.due_at).toLocaleDateString() : 'not scheduled'}
                </Text>
              </View>
              <View style={styles.rowActions}>
                {isDue ? (
                  <View style={[styles.badge, { backgroundColor: appColors.pillBackground }]}>
                    <Text style={[styles.badgeText, { color: colors.warning }]}>Due</Text>
                  </View>
                ) : null}
                <Pressable onPress={() => generateIdealAnswer(question.id)}><Text style={{ color: colors.primary, fontWeight: '700' }}>{question.ideal_answer ? 'Refresh ideal' : 'Ideal answer'}</Text></Pressable>
                <Text style={{ color: colors.primary }}>Practice</Text>
              </View>
            </Pressable>
          );
        })}
      </Section>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  heroText: { flex: 1 },
  heroTitle: { fontSize: 17, fontWeight: '700' },
  heroMeta: { marginTop: 2, fontSize: Typography.caption.size },
  heroCta: { marginTop: Spacing.base },
  label: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
  },
  form: { gap: Spacing.md },
  input: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    fontSize: Typography.body.size,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  banks: { flexDirection: 'row', gap: Spacing.sm },
  bankPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.md,
  },
  bankLabel: { fontSize: Typography.body.size, fontWeight: '700' },
  importLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    marginTop: Spacing.sm,
  },
  rowIcon: { marginTop: 2 },
  rowActions: { alignItems: 'flex-end', gap: Spacing.sm },
  badge: { borderRadius: CornerRadius.full, paddingHorizontal: Spacing.smd, paddingVertical: Spacing.xxs },
  badgeText: { fontSize: Typography.caption.size, fontWeight: '700' },
});
