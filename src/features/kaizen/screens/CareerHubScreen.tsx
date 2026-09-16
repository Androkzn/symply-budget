import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AssessIcon,
  BrandButton,
  CareerIcon,
  GlassCard,
  PracticeIcon,
  ProgressIcon,
} from '@features/kaizen/brand';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import { useKaizenInterviewPipeline } from '@features/kaizen/hooks/useKaizenInterviewPipeline';
import { useKaizenInterviewQuestions } from '@features/kaizen/hooks/useKaizenInterviewQuestions';
import { useKaizenSkills } from '@features/kaizen/hooks/useKaizenSkills';
import { selectCareerHubStats } from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { CornerRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';
import { useAppColors } from '@theme';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

export function CareerHubScreen() {
  const colors = useAppColors();
  const { data: skills = [] } = useKaizenSkills();
  const { data: questions = [] } = useKaizenInterviewQuestions();
  const { data: pipeline = [] } = useKaizenInterviewPipeline();
  const profile = useKaizenStore(state => state.profile);
  const hubStats = selectCareerHubStats({ skills, questions, pipeline });
  const [resume, setResume] = useState('');

  const statRows = [
    { value: hubStats.skills, label: 'Skills' },
    { value: hubStats.questions, label: 'Questions' },
    { value: hubStats.opportunities, label: 'Opportunities' },
  ];

  const tools = [
    ['Career progress', '/kaizen/career-progress', ProgressIcon],
    ['Interview pipeline', '/kaizen/pipeline', CareerIcon],
    ['Resume review', '/kaizen/resume-review', AssessIcon],
    ['Import questions', '/kaizen/question-import', PracticeIcon],
  ] as const;

  return (
    <KaizenScreen variant="root" title="Career" subtitle="Turn your next role into a focused plan." screenTestId="kaizen-career-screen">
      {profile?.career_setup_step !== 'complete' && (
        <CommandCenterCard tint={colors.primary}>
          <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 16 }}>
            Get started
          </Text>
          <Text style={{ color: colors.textSecondary, marginTop: 4, marginBottom: Spacing.base }}>
            Set a target role and import your resume to build a skill map.
          </Text>
          <BrandButton
            title="Start career setup"
            onPress={() => router.push('/kaizen/career-setup')}
          />
        </CommandCenterCard>
      )}

      <GlassCard>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>PROGRESS</Text>
        <View style={styles.statsRow}>
          {statRows.map((stat, index) => (
            <View key={stat.label} style={styles.statCell}>
              {index > 0 && (
                <View style={[styles.statDivider, { backgroundColor: colors.borderColor }]} />
              )}
              <View style={styles.statCol}>
                <Text style={[styles.statValue, { color: colors.textPrimary }]}>{stat.value}</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                  {stat.label}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </GlassCard>

      <View style={styles.area}>
        <Text style={[styles.areaLabel, { color: colors.textSecondary }]}>CAREER SETUP</Text>
        <GlassCard>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Set your target role</Text>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            Add a role, timeline, and your direction.
          </Text>
          <View style={styles.setupActions}>
            <KaizenImportUploadSection
              purpose="resume"
              navigateAfterImport={false}
              onImported={result => {
                if (result.resumeText) setResume(result.resumeText);
              }}
            />
            <TextInput
              multiline
              value={resume}
              onChangeText={setResume}
              placeholder="Or paste your resume"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.resume,
                {
                  color: colors.textPrimary,
                  borderColor: colors.borderColor,
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
            />
            <BrandButton
              title="Open resume review"
              disabled={!resume.trim()}
              onPress={() => router.push('/kaizen/resume-review')}
            />
          </View>
        </GlassCard>
      </View>

      <Section title="Skills">
        {skills.length === 0 ? (
          <EmptyState>Add a target role to generate your skill map.</EmptyState>
        ) : (
          skills.map(skill => (
            <View key={skill.id} style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}>
              <View style={kaizenStyles.rowText}>
                <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '500' }}>
                  {skill.name}
                </Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                  Level {skill.level_raw} · {skill.mastery_0_to_100 ?? 0}% mastery
                </Text>
              </View>
            </View>
          ))
        )}
      </Section>

      <Section title="Pipeline">
        {pipeline.length === 0 ? (
          <EmptyState>No opportunities tracked yet.</EmptyState>
        ) : (
          pipeline.map(item => (
            <View key={item.id} style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}>
              <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>{item.title}</Text>
              <Text style={{ color: colors.textSecondary }}>{item.stage}</Text>
            </View>
          ))
        )}
      </Section>

      <CommandCenterCard>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>CAREER TOOLS</Text>
        <View style={styles.tools}>
          {tools.map(([label, href, Icon]) => (
            <Pressable key={href} style={styles.toolRow} onPress={() => router.push(href)}>
              <Icon size={20} color={colors.primary} />
              <Text style={[styles.toolLabel, { color: colors.primary }]}>{label}</Text>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>→</Text>
            </Pressable>
          ))}
        </View>
      </CommandCenterCard>

      <Pressable style={styles.practice} onPress={() => router.push('/kaizen/banks')}>
        <PracticeIcon size={20} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Practice questions →</Text>
      </Pressable>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 40,
    marginRight: Spacing.xs,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  statValue: { fontSize: 28, fontWeight: '700', letterSpacing: -0.3 },
  statLabel: { fontSize: Typography.caption.size },
  area: { gap: 0 },
  areaLabel: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    textTransform: 'uppercase',
  },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  cardSubtitle: { fontSize: Typography.body.size, marginTop: Spacing.xs },
  setupActions: { gap: Spacing.md, marginTop: Spacing.base },
  resume: {
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    minHeight: 110,
    padding: Spacing.base,
    textAlignVertical: 'top',
    fontSize: Typography.body.size,
  },
  tools: { gap: Spacing.xs },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 44,
  },
  toolLabel: { flex: 1, fontSize: Typography.body.size, fontWeight: '700' },
  practice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    marginTop: Spacing.xs,
  },
});
