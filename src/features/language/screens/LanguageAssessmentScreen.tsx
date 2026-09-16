import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import {
  languageAssessmentApi,
  type AdaptiveQuestion,
  type ProficiencyProfile,
} from '../api/languageAssessment';

type Phase = 'loading' | 'question' | 'grading' | 'complete' | 'error';

export function LanguageAssessmentScreen() {  const colors = useAppColors();
  const router = useRouter();
  const { content: containerPadding } = useLayoutPadding();

  const sessionRef = useRef<string | null>(null);
  const kindRef = useRef<string>('initial');

  const [phase, setPhase] = useState<Phase>('loading');
  const [question, setQuestion] = useState<AdaptiveQuestion | null>(null);
  const [qNumber, setQNumber] = useState(0);
  const [qTotal, setQTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [profile, setProfile] = useState<ProficiencyProfile | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadNext = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    setSelected(null);
    setTyped('');
    const next = await languageAssessmentApi.nextQuestion(sessionId, kindRef.current);
    if (next.isComplete || !next.question) {
      setPhase('grading');
      const res = await languageAssessmentApi.complete(sessionId);
      setProfile(res.profile);
      setPhase('complete');
      return;
    }
    setQuestion(next.question);
    setQNumber(next.questionNumber);
    setQTotal(next.totalQuestions);
    setPhase('question');
  }, []);

  const boot = useCallback(async () => {
    try {
      setPhase('loading');
      const status = await languageAssessmentApi.getStatus().catch(() => null);
      kindRef.current = status?.kind ?? 'initial';
      const start = await languageAssessmentApi.start();
      sessionRef.current = start.sessionId;
      await loadNext();
    } catch {
      setErrorMsg('Could not start the assessment. Check your connection and try again.');
      setPhase('error');
    }
  }, [loadNext]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const submit = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || !question) return;
    const responseText = selected ?? typed.trim();
    if (!responseText) return;
    setPhase('grading');
    try {
      await languageAssessmentApi.submitAnswer({
        sessionId,
        questionId: question.id,
        responseText,
        inputMode: selected ? 'tap' : 'type',
        kind: kindRef.current,
      });
      await loadNext();
    } catch {
      setErrorMsg('Could not submit your answer. Please try again.');
      setPhase('error');
    }
  }, [question, selected, typed, loadNext]);

  const progress = qTotal > 0 ? Math.min(1, qNumber / qTotal) : 0;
  const canSubmit = !!(selected ?? typed.trim());

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="language-assessment-screen">
        <ScreenHeader
          title="Placement assessment"
          showBackButton
          onBackPress={() => router.back()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingHorizontal: containerPadding }]}
          {...keyboardDismissScrollProps}
        >
          <AdaptiveContainer width="reading" style={styles.stack}>
            {(phase === 'loading' || phase === 'grading') && (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
                <Typography variant="footnote" color={colors.textSecondary} style={styles.centerText}>
                  {phase === 'grading' ? 'Checking your answer…' : 'Preparing your assessment…'}
                </Typography>
              </View>
            )}

            {phase === 'error' && (
              <View style={styles.center}>
                <Icon name="cloud-offline-outline" size={40} color={colors.textSecondary} />
                <Typography variant="body" color={colors.textPrimary} style={styles.centerText}>
                  {errorMsg}
                </Typography>
                <Pressable
                  testID="language-assessment-retry"
                  onPress={() => void boot()}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                >
                  <Typography variant="body" weight="semibold" color={colors.white}>
                    Try again
                  </Typography>
                </Pressable>
              </View>
            )}

            {phase === 'question' && question && (
              <>
                <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                  <View
                    style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.primary }]}
                  />
                </View>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.qMeta} testID="language-assessment-question-meta">
                  Question {qNumber} of {qTotal} · {question.category}
                </Typography>

                <Card variant="filled" style={[styles.qCard, { backgroundColor: colors.backgroundSecondary }]}>
                  <Typography variant="title3" weight="semibold" color={colors.textPrimary}>
                    {question.text}
                  </Typography>
                  {question.requiresVoice && (
                    <Typography variant="caption1" color={colors.warning} style={styles.voiceHint}>
                      Speaking question — type your spoken answer for now.
                    </Typography>
                  )}
                </Card>

                {question.suggestedAnswers && question.suggestedAnswers.length > 0 ? (
                  <View style={styles.options}>
                    {question.suggestedAnswers.map((opt, i) => {
                      const active = selected === opt;
                      return (
                        <Pressable
                          key={opt}
                          testID={`language-assessment-option-${i}`}
                          onPress={() => setSelected(opt)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                          style={[
                            styles.option,
                            {
                              borderColor: active ? colors.primary : colors.borderColor,
                              backgroundColor: active ? colors.primary + '1F' : colors.backgroundSecondary,
                            },
                          ]}
                        >
                          <Typography variant="body" color={colors.textPrimary}>
                            {opt}
                          </Typography>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <TextInput
                    testID="language-assessment-input"
                    value={typed}
                    onChangeText={setTyped}
                    placeholder="Type your answer…"
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      styles.input,
                      { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
                    ]}
                    multiline
                  />
                )}

                <Pressable
                  onPress={() => void submit()}
                  disabled={!canSubmit}
                  testID="language-assessment-submit"
                  style={[
                    styles.primaryBtn,
                    { backgroundColor: canSubmit ? colors.primary : colors.borderColor },
                  ]}
                >
                  <Typography variant="body" weight="semibold" color={colors.white}>
                    Submit
                  </Typography>
                </Pressable>
              </>
            )}

            {phase === 'complete' && profile && (
              <View style={styles.results}>
                <View style={[styles.levelBadge, { backgroundColor: colors.primary + '1F' }]}>
                  <Typography variant="largeTitle" weight="bold" color={colors.primary}>
                    {profile.cefrLevel ?? '—'}
                  </Typography>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    Your estimated level
                  </Typography>
                </View>

                <Card variant="filled" style={[styles.qCard, { backgroundColor: colors.backgroundSecondary }]}>
                  <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
                    OVERALL PROFICIENCY
                  </Typography>
                  <Typography variant="title2" weight="bold" color={colors.textPrimary}>
                    {Math.round((profile.overallProficiency ?? 0) * (profile.overallProficiency <= 1 ? 100 : 1))}%
                  </Typography>
                </Card>

                {!!profile.strengths?.length && (
                  <Card variant="filled" style={[styles.qCard, { backgroundColor: colors.backgroundSecondary }]}>
                    <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
                      STRENGTHS
                    </Typography>
                    {profile.strengths.slice(0, 4).map((s) => (
                      <Typography key={s} variant="body" color={colors.textPrimary}>
                        • {s}
                      </Typography>
                    ))}
                  </Card>
                )}

                <Pressable
                  testID="language-assessment-continue"
                  onPress={() => router.back()}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                >
                  <Typography variant="body" weight="semibold" color={colors.white}>
                    Continue to my plan
                  </Typography>
                </Pressable>
              </View>
            )}
          </AdaptiveContainer>
        </ScrollView>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  content: { paddingTop: Spacing.base, paddingBottom: Layout.bottomSafeArea + Spacing.xl },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: { gap: Spacing.base },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  centerText: { textAlign: 'center', maxWidth: 280 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  qMeta: { marginTop: Spacing.xs },
  qCard: { padding: Spacing.base, gap: Spacing.xs },
  voiceHint: { marginTop: Spacing.xxs },
  options: { gap: Spacing.sm },
  option: { borderWidth: 1, borderRadius: CornerRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  input: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    borderRadius: CornerRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  results: { gap: Spacing.base },
  levelBadge: { alignItems: 'center', padding: Spacing.lg, borderRadius: CornerRadius.lg, gap: Spacing.xxs },
  sectionLabel: { letterSpacing: 0.6 },
});
