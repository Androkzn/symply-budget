import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AchievementsIcon, StreaksIcon, TrendsIcon } from '@features/kaizen/brand/iconset';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import { useKaizenAttempts } from '@features/kaizen/hooks/useKaizenAttempts';
import { useKaizenGtd } from '@features/kaizen/hooks/useKaizenGtd';
import { useKaizenInterviewQuestions } from '@features/kaizen/hooks/useKaizenInterviewQuestions';
import { useKaizenSkills } from '@features/kaizen/hooks/useKaizenSkills';
import {
  selectActiveSkillsSorted,
  selectAverageAssessedMastery,
  selectCompletedTodayActionLogs,
  selectDueInterviewQuestions,
  selectGtdInboxItems,
  selectPrioritySkills,
} from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { KaizenScreen } from './common';

export function InsightsScreen() {
  const colors = useAppColors();  const { gradientAction } = useAppColors();
  const { data: skills = [] } = useKaizenSkills();
  const { data: questions = [] } = useKaizenInterviewQuestions();
  const { data: gtd = [] } = useKaizenGtd();
  const { data: attempts = [] } = useKaizenAttempts();
  const todayLogs = useKaizenStore(state => state.todayLogs);
  const average = selectAverageAssessedMastery(skills);
  const priority = selectPrioritySkills(skills).length;
  const dueQuestionCount = selectDueInterviewQuestions(questions).length;
  const completedTodayCount = selectCompletedTodayActionLogs(todayLogs).length;
  const gtdInboxCount = selectGtdInboxItems(gtd).length;
  const activeSkills = selectActiveSkillsSorted(skills);
  return (
    <KaizenScreen title="Insights" subtitle="A small read on your current momentum.">
      <CommandCenterCard tint="hero">
        <PanelHeader icon={<TrendsIcon size={20} color={colors.primary} />} title="Mastery" />
        <View style={styles.stats}>
          <Stat label="Average mastery" value={`${average}%`} color={colors.primary} />
          <Stat label="Due questions" value={`${dueQuestionCount}`} color={colors.primary} />
          <Stat label="Completed today" value={`${completedTodayCount}`} color={colors.primary} />
        </View>
        <View style={[styles.stats, styles.statsRowGap]}>
          <Stat label="GTD inbox" value={`${gtdInboxCount}`} color={colors.primary} />
          <Stat label="Priorities" value={`${priority}`} color={colors.primary} />
        </View>
      </CommandCenterCard>

      <CommandCenterCard>
        <PanelHeader icon={<StreaksIcon size={20} color={colors.primary} />} title="Skills" />
        <View style={styles.skillList}>
          {activeSkills.map(skill => {
            const mastery = skill.mastery_0_to_100 ?? 0;
            return (
              <View key={skill.id} style={styles.skill}>
                <View style={styles.skillLabel}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{skill.name}</Text>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>{mastery}%</Text>
                </View>
                <View style={[styles.bar, { backgroundColor: colors.backgroundSecondary }]}>
                  <LinearGradient
                    colors={[...gradientAction.colors] as [string, string, ...string[]]}
                    start={gradientAction.start}
                    end={gradientAction.end}
                    style={[styles.barFill, { width: `${mastery}%` }]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </CommandCenterCard>

      <CommandCenterCard>
        <PanelHeader icon={<AchievementsIcon size={20} color={colors.primary} />} title="Achievements" />
        <View style={styles.achievements}>
          <Text style={{ color: colors.textPrimary }}>{attempts.length >= 1 ? '✓ First practice completed' : '○ Complete your first practice'}</Text>
          <Text style={{ color: colors.textPrimary }}>{attempts.length >= 5 ? '✓ Five practice reps' : `○ ${Math.max(0, 5 - attempts.length)} reps to five`}</Text>
          <Text style={{ color: colors.textPrimary }}>{skills.some(skill => (skill.mastery_0_to_100 ?? 0) > 50) ? '✓ Skill mastery above 50%' : '○ Reach 50% mastery'}</Text>
        </View>
      </CommandCenterCard>
    </KaizenScreen>
  );
}

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.panelHeader}>
      {icon}
      <Text style={[styles.panelTitle, { color: colors.textSecondary }]}>{title}</Text>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const colors = useAppColors();
  return <View style={styles.stat}><Text style={[styles.value, { color }]}>{value}</Text><Text style={{ color: colors.textSecondary }}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  panelTitle: { fontSize: Typography.caption.size, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  stats: { flexDirection: 'row', gap: Spacing.md },
  statsRowGap: { marginTop: Spacing.base },
  stat: { flex: 1, gap: 5 },
  value: { fontSize: 28, fontWeight: '800' },
  skillList: { gap: Spacing.md },
  skill: { gap: 7 },
  skillLabel: { flexDirection: 'row', justifyContent: 'space-between' },
  bar: { borderRadius: 4, height: 8, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  achievements: { gap: Spacing.sm },
});
