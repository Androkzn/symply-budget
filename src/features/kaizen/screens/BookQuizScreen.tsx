import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@components/ui';
import type { BookAnswerMistake, SpokenPronunciationWord } from '@features/kaizen/api/kaizen';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { CornerRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { VoiceRecordingService } from '@services/voice-recording';

import { EmptyState, KaizenScreen } from './common';

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface SpokenPronunciation {
  overall_score?: number;
  words?: SpokenPronunciationWord[];
  breakdown?: Record<string, unknown>;
}

const MAX_RECORDING_MS = 120000;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function BookQuizScreen() {
  const colors = useAppColors();
  const params = useLocalSearchParams<{ chapterId?: string }>();
  const chapterId = firstParam(params.chapterId);  const appColors = useAppColors();

  const allQuestions = useKaizenStore(state => state.bookQuestions);
  const bookAttempts = useKaizenStore(state => state.bookAttempts);
  const submitAttempt = useKaizenStore(state => state.submitBookAttempt);
  const submitSpokenAttempt = useKaizenStore(state => state.submitSpokenBookAttempt);

  const questions = useMemo(
    () =>
      allQuestions
        .filter(q => q.chapter_id === chapterId && !q.deleted_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [allQuestions, chapterId],
  );

  const [index, setIndex] = useState(0);
  const [answerText, setAnswerText] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Spoken-answer recording state.
  const [typeInstead, setTypeInstead] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(
    () => () => {
      // Clean up the elapsed timer and release the mic if we unmount mid-recording.
      if (timerRef.current) clearInterval(timerRef.current);
      void VoiceRecordingService.cancelRecording();
    },
    [],
  );

  const question = questions[index];

  const latestAttempt = useMemo(() => {
    if (!revealed || !question) return undefined;
    return bookAttempts
      .filter(a => a.question_id === question.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  }, [revealed, question, bookAttempts]);

  if (questions.length === 0) {
    return (
      <KaizenScreen title="Comprehension check" showBackButton>
        <EmptyState>No questions yet — generate a check for this chapter first.</EmptyState>
      </KaizenScreen>
    );
  }

  if (index >= questions.length) {
    return (
      <KaizenScreen title="Chapter complete" subtitle="Nice work." showBackButton>
        <CommandCenterCard tint={colors.primary}>
          <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '600' }}>
            You answered all {questions.length} questions.
          </Text>
          <Text style={{ color: colors.textSecondary, marginTop: 6 }}>
            Weaker answers will resurface for review at the right time.
          </Text>
        </CommandCenterCard>
        <Button title="Back to book" onPress={() => router.back()} style={{ marginTop: Spacing.md }} />
      </KaizenScreen>
    );
  }

  const options = parseJson<string[]>(question.options, []);
  const isSpoken = question.type === 'spoken';
  const usingText = isSpoken && typeInstead;
  const canSubmit =
    question.type === 'mcq'
      ? selectedIndex !== null
      : isSpoken && !usingText
        ? recordedUri !== null
        : answerText.trim().length > 0;

  const onStartRecording = async () => {
    const granted = await VoiceRecordingService.requestPermission();
    // requestPermission() surfaces its own Alert when microphone access is denied.
    if (!granted) return;
    const started = await VoiceRecordingService.startRecording({ maxDuration: MAX_RECORDING_MS });
    if (!started) return;
    setRecordedUri(null);
    setRecordedDurationMs(null);
    setElapsedMs(0);
    setRecording(true);
    const startedAt = Date.now();
    stopTimer();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
  };

  const onStopRecording = async () => {
    stopTimer();
    setRecording(false);
    const result = await VoiceRecordingService.stopRecording();
    if (result) {
      setRecordedUri(result.uri);
      setRecordedDurationMs(Math.round(result.duration * 1000));
      setElapsedMs(Math.round(result.duration * 1000));
    }
  };

  const onToggleTypeInstead = () => {
    if (recording) {
      stopTimer();
      setRecording(false);
      void VoiceRecordingService.cancelRecording();
    }
    setTypeInstead(v => !v);
  };

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      if (isSpoken && !usingText && recordedUri) {
        await submitSpokenAttempt(question.id, {
          uri: recordedUri,
          // recordedDurationMs is always set alongside recordedUri in onStopRecording,
          // so the ?? fallback below is unreachable.
          durationMs: /* istanbul ignore next */ recordedDurationMs ?? undefined,
        });
      } else {
        await submitAttempt(
          question.id,
          question.type === 'mcq'
            ? { selectedIndex: selectedIndex ?? -1 }
            : { answerText: answerText.trim() },
        );
      }
      setRevealed(true);
    } catch {
      // Stay on the question when submit fails.
    } finally {
      setSubmitting(false);
    }
  };

  const onNext = () => {
    stopTimer();
    setIndex(i => i + 1);
    setAnswerText('');
    setSelectedIndex(null);
    setRevealed(false);
    setTypeInstead(false);
    setRecording(false);
    setElapsedMs(0);
    setRecordedUri(null);
    setRecordedDurationMs(null);
  };

  const mistakes = parseJson<BookAnswerMistake[]>(latestAttempt?.mistakes, []);
  const pronunciation = isSpoken
    ? parseJson<SpokenPronunciation | null>(latestAttempt?.pronunciation, null)
    : null;
  const problemWords = pronunciation?.words?.filter(w => w.is_problem) ?? [];
  const isLast = index === questions.length - 1;

  return (
    <KaizenScreen
      title="Comprehension check"
      subtitle={`Question ${index + 1} of ${questions.length}`}
      showBackButton
    >
      <CommandCenterCard>
        <View style={styles.typeRow}>
          <View style={[styles.typeBadge, { backgroundColor: appColors.pillBackground }]}>
            <Text style={[styles.typeBadgeText, { color: colors.primary }]}>
              {question.type === 'mcq'
                ? 'Multiple choice'
                : question.type === 'spoken'
                  ? 'Speak your answer'
                  : 'Open answer'}
            </Text>
          </View>
        </View>
        <Text style={[styles.prompt, { color: colors.textPrimary }]}>{question.prompt}</Text>

        {question.type === 'mcq' ? (
          <View style={styles.options}>
            {options.map((opt, i) => {
              const selected = selectedIndex === i;
              const isCorrect = revealed && i === question.answer_index;
              const isWrongPick = revealed && selected && i !== question.answer_index;
              const bg = isCorrect
                ? appColors.surfaceSelected
                : isWrongPick
                  ? appColors.pillBackground
                  : selected
                    ? appColors.surfaceSelected
                    : appColors.pillBackground;
              return (
                <Pressable
                  key={i}
                  disabled={revealed}
                  onPress={() => setSelectedIndex(i)}
                  style={[styles.option, { backgroundColor: bg, borderColor: selected ? colors.primary : 'transparent' }]}
                >
                  <Text style={{ color: colors.textPrimary, flex: 1 }}>{opt}</Text>
                  {isCorrect ? (
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>✓</Text>
                  ) : isWrongPick ? (
                    <Text style={{ color: colors.error, fontWeight: '700' }}>✕</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : isSpoken && !usingText ? (
          <View style={styles.recordArea}>
            {recording ? (
              <>
                <View style={[styles.recordingBar, { backgroundColor: appColors.pillBackground }]}>
                  <View style={[styles.recordingDot, { backgroundColor: colors.error }]} />
                  <Text style={{ color: colors.textPrimary, fontWeight: '600', flex: 1 }}>
                    Recording…
                  </Text>
                  <Text
                    style={{ color: colors.textSecondary, fontVariant: ['tabular-nums'] }}
                  >
                    {formatDuration(elapsedMs)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => void onStopRecording()}
                  style={[styles.recordButton, { backgroundColor: colors.error }]}
                >
                  <Text style={styles.recordButtonText}>Stop</Text>
                </Pressable>
              </>
            ) : recordedUri ? (
              <>
                <View style={[styles.recordingBar, { backgroundColor: appColors.pillBackground }]}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '600', flex: 1 }}>
                    Recorded answer
                  </Text>
                  <Text
                    style={{ color: colors.textSecondary, fontVariant: ['tabular-nums'] }}
                  >
                    {/* recordedDurationMs is always set alongside recordedUri, so the ?? fallback is unreachable. */}
                    {formatDuration(/* istanbul ignore next */ recordedDurationMs ?? 0)}
                  </Text>
                </View>
                <View style={styles.recordActions}>
                  <Pressable
                    onPress={() => void VoiceRecordingService.playVoiceNote(recordedUri)}
                    style={[styles.recordChip, { backgroundColor: appColors.pillBackground }]}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>▶ Play</Text>
                  </Pressable>
                  {!revealed ? (
                    <Pressable
                      onPress={() => void onStartRecording()}
                      style={[styles.recordChip, { backgroundColor: appColors.pillBackground }]}
                    >
                      <Text style={{ color: colors.primary, fontWeight: '600' }}>
                        Re-record
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : (
              <Pressable
                disabled={revealed}
                onPress={() => void onStartRecording()}
                style={[styles.recordButton, { backgroundColor: colors.primary }]}
              >
                <Text style={styles.recordButtonText}>● Record answer</Text>
              </Pressable>
            )}
            {!revealed ? (
              <Pressable onPress={onToggleTypeInstead} hitSlop={8}>
                <Text style={[styles.linkText, { color: colors.textSecondary }]}>
                  Type instead
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <TextInput
              value={answerText}
              onChangeText={setAnswerText}
              editable={!revealed}
              placeholder="Explain the concept in your own words…"
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[
                styles.answerInput,
                {
                  color: colors.textPrimary,
                  borderColor: appColors.glassBorder,
                  backgroundColor: appColors.inputFieldBackground,
                },
              ]}
            />
            {isSpoken && !revealed ? (
              <Pressable onPress={onToggleTypeInstead} hitSlop={8} style={{ marginTop: Spacing.sm }}>
                <Text style={[styles.linkText, { color: colors.textSecondary }]}>
                  Record instead
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </CommandCenterCard>

      {revealed && latestAttempt ? (
        <CommandCenterCard tint={colors.primary}>
          {question.type !== 'mcq' ? (
            <Text style={[styles.scoreLine, { color: colors.textPrimary }]}>
              Understanding: {Math.round((latestAttempt.content_score ?? 0) * 100)}%
              {'   ·   '}Overall: {Math.round((latestAttempt.overall_score ?? 0) * 100)}%
            </Text>
          ) : (
            <Text style={[styles.scoreLine, { color: colors.textPrimary }]}>
              {latestAttempt.is_correct ? 'Correct ✓' : 'Not quite ✕'}
            </Text>
          )}
          {latestAttempt.feedback ? (
            <Text style={{ color: colors.textSecondary, marginTop: 6 }}>
              {latestAttempt.feedback}
            </Text>
          ) : null}

          {isSpoken && latestAttempt.transcription ? (
            <Text style={[styles.transcription, { color: colors.textSecondary }]}>
              You said: “{latestAttempt.transcription}”
            </Text>
          ) : null}

          {mistakes.length > 0 ? (
            <View style={styles.mistakes}>
              <Text style={[styles.mistakesTitle, { color: colors.textSecondary }]}>
                THINGS TO WORK ON
              </Text>
              {mistakes.map((m, i) => (
                <View key={i} style={styles.mistakeRow}>
                  <Text style={{ color: colors.error, textDecorationLine: 'line-through' }}>
                    {m.text}
                  </Text>
                  {m.correction ? (
                    <Text style={{ color: colors.primary, fontWeight: '600' }}>
                      {'  → '}
                      {m.correction}
                    </Text>
                  ) : null}
                  {m.explanation ? (
                    <Text style={{ color: colors.textSecondary, fontSize: Typography.caption.size }}>
                      {m.explanation}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {isSpoken && pronunciation ? (
            <View style={styles.mistakes}>
              <Text style={[styles.mistakesTitle, { color: colors.textSecondary }]}>
                PRONUNCIATION
                {typeof pronunciation.overall_score === 'number'
                  ? ` · ${Math.round(pronunciation.overall_score * 100)}%`
                  : ''}
              </Text>
              {problemWords.length > 0 ? (
                problemWords.map((w, i) => (
                  <View key={i} style={styles.mistakeRow}>
                    <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{w.word}</Text>
                    {w.tip ? (
                      <Text
                        style={{
                          color: colors.textSecondary,
                          fontSize: Typography.caption.size,
                        }}
                      >
                        {w.tip}
                      </Text>
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={{ color: colors.textSecondary }}>
                  Clear pronunciation — nothing flagged.
                </Text>
              )}
            </View>
          ) : null}
        </CommandCenterCard>
      ) : null}

      {revealed ? (
        <Button
          title={isLast ? 'Finish' : 'Next question'}
          onPress={onNext}
          style={{ marginTop: Spacing.md }}
        />
      ) : (
        <Button
          title="Submit answer"
          loading={submitting}
          disabled={!canSubmit}
          onPress={() => void onSubmit()}
          style={{ marginTop: Spacing.md }}
        />
      )}
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  typeRow: { flexDirection: 'row', marginBottom: Spacing.sm },
  typeBadge: { borderRadius: CornerRadius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xxs },
  typeBadgeText: { fontSize: Typography.caption.size, fontWeight: '700' },
  prompt: { fontSize: 18, fontWeight: '600', lineHeight: 26 },
  options: { gap: Spacing.sm, marginTop: Spacing.base },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: CornerRadius.md,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 48,
  },
  answerInput: {
    marginTop: Spacing.base,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    fontSize: Typography.body.size,
    minHeight: 120,
    padding: Spacing.md,
    textAlignVertical: 'top',
  },
  scoreLine: { fontSize: 16, fontWeight: '700' },
  mistakes: { marginTop: Spacing.base, gap: Spacing.sm },
  mistakesTitle: { fontSize: Typography.caption.size, fontWeight: '700', letterSpacing: 0.4 },
  mistakeRow: { gap: 2 },
  recordArea: { marginTop: Spacing.base, gap: Spacing.md, alignItems: 'stretch' },
  recordButton: {
    borderRadius: CornerRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  recordButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: CornerRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 48,
  },
  recordingDot: { width: 12, height: 12, borderRadius: 6 },
  recordActions: { flexDirection: 'row', gap: Spacing.sm },
  recordChip: {
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  linkText: {
    fontSize: Typography.caption.size,
    fontWeight: '600',
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  transcription: { marginTop: Spacing.base, fontStyle: 'italic', lineHeight: 20 },
});
