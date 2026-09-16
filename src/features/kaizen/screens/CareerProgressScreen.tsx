import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { ProgressIcon, TrendsIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import { useKaizenAttempts } from '@features/kaizen/hooks/useKaizenAttempts';
import { useKaizenInterviewQuestions } from '@features/kaizen/hooks/useKaizenInterviewQuestions';
import { useKaizenSkills } from '@features/kaizen/hooks/useKaizenSkills';
import { buildCareerProgressSnapshot } from '@features/kaizen/services/careerAnalytics';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

/** Brand-gradient progress bar over a hairline glass track (0–1 fraction). */
function GradientBar({ fraction }: { fraction: number }) {
  const { pillBackground, gradientAction } = useAppColors();
  const pct = Math.max(0, Math.min(1, fraction));
  return (
    <View style={[styles.track, { backgroundColor: pillBackground }]}>
      <LinearGradient
        colors={gradientAction.colors as [string, string, ...string[]]}
        locations={gradientAction.locations as [number, number, ...number[]]}
        start={gradientAction.start}
        end={gradientAction.end}
        style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 999 }}
      />
    </View>
  );
}

export function CareerProgressScreen() {
  const colors = useAppColors();  const accent = useBrandIconState(true);
  const { data: questions = [] } = useKaizenInterviewQuestions();
  const { data: attempts = [] } = useKaizenAttempts();
  const { data: skills = [] } = useKaizenSkills();
  const progress = buildCareerProgressSnapshot(questions, attempts, skills, 'month');
  const averageScore = progress.averageScore;
  return <KaizenScreen title="Career progress" subtitle="Your practice signal for the last 30 days.">
    <Section title="Practice">
      <View style={styles.metricRow}>
        <ProgressIcon size={22} state={accent} />
        <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>Reps completed</Text>
        <Text style={[styles.metricValue, { color: colors.textPrimary }]}>{progress.repsCompleted}</Text>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
      <View style={styles.metricBlock}>
        <View style={styles.metricHeader}>
          <TrendsIcon size={22} state={accent} />
          <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>Average score</Text>
          <Text style={[styles.metricValue, { color: colors.textPrimary }]}>{averageScore?.toFixed(0) ?? '—'}</Text>
        </View>
        <GradientBar fraction={(averageScore ?? 0) / 5} />
      </View>
    </Section>
    <Section title="Next recommended">{progress.nextRecommended.length ? progress.nextRecommended.map(question => <View key={question.id} style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}><Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>{question.prompt}</Text></View>) : <EmptyState>No due questions right now.</EmptyState>}</Section>
  </KaizenScreen>;
}

const styles = StyleSheet.create({
  metricRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 58,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.smd,
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.base },
  metricBlock: {
    gap: Spacing.smd,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
  },
  metricHeader: { alignItems: 'center', flexDirection: 'row', gap: Spacing.md },
  metricValue: { fontSize: Typography.body.size, fontWeight: '700' },
  track: { borderRadius: 999, height: 8, overflow: 'hidden', width: '100%' },
});
