import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@features/kaizen/brand';
import {
  AssessIcon,
  InProgressIcon,
  OnHoldIcon,
  ProgressIcon,
  SkillsIcon,
  SkippedIcon,
  useBrandIconState,
} from '@features/kaizen/brand/iconset';
import { useKaizenSkills } from '@features/kaizen/hooks/useKaizenSkills';
import { selectSkillById } from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { KaizenScreen } from './common';

export function SkillDetailScreen() {
  const colors = useAppColors();  const { gradientAction } = useAppColors();
  const iconState = useBrandIconState(true);
  const { skillId } = useLocalSearchParams<{ skillId: string }>();
  const { data: skills = [] } = useKaizenSkills();
  const skill = selectSkillById(skills, skillId ?? '');
  const activate = useKaizenStore(state => state.activateSkillForTraining);
  const pause = useKaizenStore(state => state.pauseSkill);
  const backlog = useKaizenStore(state => state.backlogSkill);
  if (!skill)
    return (
      <KaizenScreen title="Skill" subtitle="This skill is unavailable.">
        <GlassCard>
          <Text style={{ color: colors.textSecondary }}>
            Choose an assessable skill to continue.
          </Text>
        </GlassCard>
      </KaizenScreen>
    );
  const mastery = skill.mastery_0_to_100 ?? 0;
  return (
    <KaizenScreen title={skill.name} subtitle={`${skill.activation_state} · ${mastery}% mastery`}>
      <GlassCard strong>
        <View style={styles.heroRow}>
          <SkillsIcon size={30} state={iconState} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroLabel, { color: colors.textSecondary }]}>MASTERY</Text>
            <Text style={[styles.heroValue, { color: colors.textPrimary }]}>{mastery}%</Text>
          </View>
        </View>
        <View style={[styles.track, { backgroundColor: colors.backgroundSecondary }]}>
          <LinearGradient
            colors={[...gradientAction.colors] as [string, string, ...string[]]}
            locations={[...gradientAction.locations] as [number, number, ...number[]]}
            start={gradientAction.start}
            end={gradientAction.end}
            style={{ height: '100%', width: `${mastery}%` }}
          />
        </View>
      </GlassCard>

      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>TRAINING</Text>
      <GlassCard padding={0}>
        <Pressable
          style={styles.row}
          onPress={() => router.push(`/kaizen/skill-assessment?skillId=${skill.id}`)}
        >
          <AssessIcon size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.primary }]}>Run assessment</Text>
          <Text style={[styles.chevron, { color: colors.primary }]}>→</Text>
        </Pressable>
        <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
        <Pressable
          style={styles.row}
          onPress={() => router.push(`/kaizen/learning-plan?skillId=${skill.id}`)}
        >
          <ProgressIcon size={22} color={colors.primary} />
          <Text style={[styles.rowLabel, { color: colors.primary }]}>Open learning plan</Text>
          <Text style={[styles.chevron, { color: colors.primary }]}>→</Text>
        </Pressable>
        <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
        <Pressable style={styles.row} onPress={() => void activate(skill.id)}>
          <InProgressIcon size={22} color={colors.textSecondary} />
          <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Activate for training</Text>
        </Pressable>
        <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
        <Pressable style={styles.row} onPress={() => void pause(skill.id)}>
          <OnHoldIcon size={22} color={colors.textSecondary} />
          <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Pause</Text>
        </Pressable>
        <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
        <Pressable style={styles.row} onPress={() => void backlog(skill.id)}>
          <SkippedIcon size={22} color={colors.textSecondary} />
          <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Move to backlog</Text>
        </Pressable>
      </GlassCard>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  heroLabel: { fontSize: Typography.caption.size, fontWeight: '700', letterSpacing: 0.4 },
  heroValue: { fontSize: Typography.title.size, fontWeight: '800', letterSpacing: -0.3 },
  track: { borderRadius: 4, height: 8, marginTop: Spacing.md, overflow: 'hidden' },
  sectionLabel: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    textTransform: 'uppercase',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 52,
    paddingHorizontal: Spacing.base,
  },
  rowLabel: { flex: 1, fontSize: Typography.body.size, fontWeight: '600' },
  chevron: { fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.base },
});
