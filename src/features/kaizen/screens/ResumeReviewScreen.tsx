import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { AIAccessGate } from '@components/ai/AIAccessGate';
import { Button } from '@components/ui';
import { BrandButton } from '@features/kaizen/brand';
import { ReportsIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';

import { KaizenScreen, Section } from './common';

export function ResumeReviewScreen() {
  const colors = useAppColors();
  const { white, glassBorder, inputFieldBackground } = useAppColors();
  const accent = useBrandIconState(true);
  const analyzeResume = useKaizenStore(state => state.analyzeResume);
  const addSkill = useKaizenStore(state => state.addSkill);
  const saveCareerSetup = useKaizenStore(state => state.saveCareerSetup);
  const [resume, setResume] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const review = async () => {
    setLoading(true);
    try {
      const response = await analyzeResume(resume);
      setSummary(response.summary ?? 'No summary was returned.');
      setSkills((response.suggested_skills ?? []).map(item => item.name).filter(Boolean));
      setRoles(response.target_roles ?? []);
    } catch {
      // Stay on the review screen when analysis fails.
    } finally {
      setLoading(false);
    }
  };

  const applyToCareer = async () => {
    setApplying(true);
    try {
      for (const skill of skills.slice(0, 12)) await addSkill(skill);
      await saveCareerSetup({
        targetRoles: roles.length ? roles : ['Software engineer'],
        goalTypes: ['interview_prep'],
        resumeSummary: summary ?? undefined,
        step: 'complete',
      });
    } catch {
      // Keep career setup unchanged when apply fails.
    } finally {
      setApplying(false);
    }
  };

  return (
    <KaizenScreen
      title="Resume review"
      subtitle="Get an AI-assisted summary, suggested skills, and target roles before you tailor your resume."
      showBackButton
    >
      {/*
        Every action on this screen is a model call (analyze → summary, skills,
        roles), so the whole screen sits behind the shared gate. Career setup
        itself stays fully manual without AI — Career → Setup takes typed skills,
        roles and questions directly.
      */}
      <AIAccessGate title="Unlock AI for resume review">
      <KaizenImportUploadSection
        purpose="resume"
        navigateAfterImport={false}
        onImported={result => {
          if (result.resumeText) setResume(result.resumeText);
          if (result.resumeSummary) setSummary(result.resumeSummary);
        }}
      />

      <Section title="Your resume" testID="kaizen-section-your-resume">
        <View style={{ gap: 12, padding: 16 }}>
          <TextInput
            multiline
            value={resume}
            onChangeText={setResume}
            placeholder="Paste resume text"
            placeholderTextColor={colors.textSecondary}
            style={{
              borderWidth: 1,
              borderRadius: 14,
              borderColor: glassBorder,
              backgroundColor: inputFieldBackground,
              color: colors.textPrimary,
              minHeight: 180,
              padding: 12,
              textAlignVertical: 'top',
            }}
          />
          <BrandButton
            title="Review resume"
            loading={loading}
            disabled={!resume.trim()}
            testID="kaizen-review-resume"
            icon={<ReportsIcon size={20} color={white} />}
            onPress={() => void review()}
          />
        </View>
      </Section>
      {summary ? (
        <Section title="Summary">
          <View style={{ gap: 12, padding: 16 }}>
            <ReportsIcon size={24} state={accent} />
            <Text style={{ color: colors.textPrimary, lineHeight: 22 }}>{summary}</Text>
          </View>
        </Section>
      ) : null}
      {roles.length > 0 ? (
        <Section title="Suggested roles">
          <View style={{ gap: 8, padding: 16 }}>
            {roles.map(role => (
              <Text key={role} style={{ color: colors.textPrimary }}>
                • {role}
              </Text>
            ))}
          </View>
        </Section>
      ) : null}
      {skills.length > 0 ? (
        <Section title="Suggested skills">
          <View style={{ gap: 8, padding: 16 }}>
            {skills.map(skill => (
              <Text key={skill} style={{ color: colors.textPrimary }}>
                • {skill}
              </Text>
            ))}
            <Button
              title="Apply skills & roles to career setup"
              loading={applying}
              onPress={() => void applyToCareer()}
            />
          </View>
        </Section>
      ) : null}
      </AIAccessGate>
    </KaizenScreen>
  );
}
