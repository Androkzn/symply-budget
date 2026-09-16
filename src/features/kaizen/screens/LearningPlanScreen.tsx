import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandButton } from '@features/kaizen/brand';
import { CompleteIcon, PendingIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import { useKaizenSkills } from '@features/kaizen/hooks/useKaizenSkills';
import {
  buildOfflinePlan,
  buildSkillLearningPlan,
  isLearningTaskComplete,
  toggleLearningTaskComplete,
  type LearningPlan,
} from '@features/kaizen/services/learningPlan';
import { selectSkillById } from '@features/kaizen/stores/kaizenSelectors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { useAIEntitlement } from '@hooks/useAIEntitlement';
import { useAppColors } from '@theme';

import { KaizenScreen, Section } from './common';

export function LearningPlanScreen() {
  const colors = useAppColors();  const completeState = useBrandIconState(true);
  const pendingState = useBrandIconState(false);
  const { skillId } = useLocalSearchParams<{ skillId: string }>();
  const { data: skills = [] } = useKaizenSkills();
  const skill = selectSkillById(skills, skillId ?? '');
  const [plan, setPlan] = useState<LearningPlan | null>(null);
  const [tick, setTick] = useState(0);
  // The plan itself is a core feature: `buildOfflinePlan` derives a real
  // sequence from the placement alone. When AI is unavailable we build it
  // locally instead of firing a request we know the backend will refuse — the
  // member sees a plan immediately, with no round-trip and no error state.
  const { canUseAI, isLoading: aiLoading } = useAIEntitlement();
  useEffect(() => {
    if (!skill || aiLoading) return;
    const result = {
      skillId: skill.id,
      assessedAt: new Date().toISOString(),
      questionCount: 0,
      score0to100: skill.mastery_0_to_100 ?? 0,
      placedBand: skill.concept_band ?? 'foundation',
      strengthConceptIds: [],
      gapConceptIds: [],
      summary: '',
    };
    if (!canUseAI) {
      setPlan(buildOfflinePlan(result));
      return;
    }
    void buildSkillLearningPlan(skill.name, result).then(setPlan).catch(() => undefined);
  }, [skill, canUseAI, aiLoading]);
  const toggle = (kind: 'practice' | 'review' | 'concept', task: string) => {
    toggleLearningTaskComplete(skillId, kind, task);
    setTick(value => value + 1);
  };
  void tick;

  const renderTask = (kind: 'practice' | 'review' | 'concept', task: string) => {
    const done = isLearningTaskComplete(skillId, kind, task);
    return (
      <Pressable key={task} style={styles.task} onPress={() => toggle(kind, task)}>
        {done ? (
          <CompleteIcon size={20} state={completeState} />
        ) : (
          <PendingIcon size={20} state={pendingState} />
        )}
        <Text
          style={[
            styles.taskLabel,
            { color: done ? colors.textSecondary : colors.textPrimary },
          ]}
        >
          {task}
        </Text>
      </Pressable>
    );
  };

  return (
    <KaizenScreen title="Learning plan" subtitle={skill?.name ?? ''}>
      <Section title="Concepts">
        <View style={styles.list}>
          {(plan?.concept_sequence ?? []).map(task => renderTask('concept', task))}
        </View>
      </Section>
      <Section title="Next steps">
        <View style={styles.list}>
          {(plan?.practice_queue ?? []).map(task => renderTask('practice', task))}
        </View>
      </Section>
      <Section title="Review focus">
        <View style={styles.list}>
          {(plan?.review_focus ?? []).map(item => renderTask('review', item))}
        </View>
      </Section>
      <BrandButton
        title="Back to skill"
        style={styles.action}
        onPress={() => router.back()}
      />
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.sm, padding: Spacing.base },
  task: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 44,
  },
  taskLabel: {
    flex: 1,
    fontSize: Typography.body.size,
    lineHeight: Typography.body.lineHeight,
  },
  action: { marginTop: Spacing.base },
});
