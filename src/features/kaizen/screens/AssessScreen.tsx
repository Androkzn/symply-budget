import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@features/kaizen/brand';
import { CommandCenterCard, ProgressRing } from '@features/kaizen/components/CommandCenter';
import { useKaizenSkills } from '@features/kaizen/hooks/useKaizenSkills';
import {
  selectAssessableSkills,
  selectAverageAssessableMastery,
} from '@features/kaizen/stores/kaizenSelectors';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing } from '@features/kaizen/theme/designTokens';

import { EmptyState, KaizenScreen, kaizenStyles } from './common';

export function AssessScreen() {
  const colors = useAppColors();  const { gradientAction } = useAppColors();
  const { data: skills = [] } = useKaizenSkills();
  const assessable = selectAssessableSkills(skills);
  const avgMastery = selectAverageAssessableMastery(skills);

  return (
    <KaizenScreen variant="root" title="Assess" subtitle="See where practice will have the most impact." screenTestId="kaizen-assess-screen">
      <CommandCenterCard tint={colors.primary}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>SKILL MASTERY</Text>
        <View style={styles.ringWrap}>
          <ProgressRing progress={avgMastery / 100} size={120} stroke={12} />
        </View>
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
          {assessable.length} assessable skill{assessable.length === 1 ? '' : 's'}
        </Text>
      </CommandCenterCard>

      {assessable.length === 0 ? (
        <CommandCenterCard>
          <EmptyState>Your skill assessments will appear here.</EmptyState>
        </CommandCenterCard>
      ) : (
        assessable.map(skill => {
          const mastery = skill.mastery_0_to_100 ?? 0;
          return (
            <GlassCard key={skill.id}>
              <Pressable onPress={() => router.push(`/kaizen/skill?skillId=${skill.id}`)}>
                <View style={styles.skillHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '600' }}>
                      {skill.name}
                    </Text>
                    <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                      {skill.activation_state}
                    </Text>
                  </View>
                  <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{mastery}%</Text>
                </View>
                <View
                  style={[styles.track, { backgroundColor: colors.backgroundSecondary }]}
                >
                  <LinearGradient
                    colors={[...gradientAction.colors] as [string, string, ...string[]]}
                    locations={[...gradientAction.locations] as [number, number, ...number[]]}
                    start={gradientAction.start}
                    end={gradientAction.end}
                    style={{ height: '100%', width: `${mastery}%` }}
                  />
                </View>
              </Pressable>
              <Pressable
                style={styles.assessBtn}
                onPress={() => router.push(`/kaizen/skill-assessment?skillId=${skill.id}`)}
              >
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Assess →</Text>
              </Pressable>
            </GlassCard>
          );
        })
      )}

      <Pressable style={styles.footer} onPress={() => router.push('/kaizen-career')}>
        <Text style={{ color: colors.primary, fontWeight: '700' }}>View all skills →</Text>
      </Pressable>
      <Pressable style={styles.footer} onPress={() => router.push('/kaizen/banks')}>
        <Text style={{ color: colors.primary, fontWeight: '700' }}>
          Practice interview questions →
        </Text>
      </Pressable>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.sm,
    opacity: 0.7,
  },
  ringWrap: { alignItems: 'center', paddingVertical: Spacing.sm },
  skillHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  track: { borderRadius: 4, height: 8, marginTop: 10, overflow: 'hidden' },
  assessBtn: { marginTop: Spacing.md, minHeight: 44, justifyContent: 'center' },
  footer: { marginTop: Spacing.xs, minHeight: 44, justifyContent: 'center' },
});
