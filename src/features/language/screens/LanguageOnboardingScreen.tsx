import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, HeaderLogo, SafeAreaView, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { OnboardingProgress } from '@components/onboarding';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { OnboardingStackParamList } from '@navigation/types';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

import { languageProfileApi } from '../api/languageProfile';

type LanguageOnboardingScreenNavigationProp = NativeStackNavigationProp<
  OnboardingStackParamList,
  'LanguageOnboarding'
>;

const NATIVE_LANGUAGES = ['Spanish', 'French', 'German', 'Portuguese', 'Russian', 'Chinese', 'Japanese', 'Arabic', 'Hindi', 'Other'];
const MOTIVATIONS = [
  { id: 'travel', label: 'Travel' },
  { id: 'work', label: 'Work & career' },
  { id: 'study', label: 'Study / exams' },
  { id: 'family', label: 'Family & friends' },
  { id: 'culture', label: 'Culture & media' },
];

export function LanguageOnboardingScreen() {  const colors = useAppColors();
  const navigation = useNavigation<LanguageOnboardingScreenNavigationProp>();
  const { content: containerPadding } = useLayoutPadding();

  const [nativeLanguage, setNativeLanguage] = useState<string | null>(null);
  const [motivations, setMotivations] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggleMotivation = (id: string) =>
    setMotivations((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));

  const finish = useCallback(async () => {
    if (!nativeLanguage) return;
    setSaving(true);
    try {
      await languageProfileApi.updateLearnerProfile({ nativeLanguage, motivations });
    } catch {
      // Non-blocking: onboarding still completes locally; profile syncs later.
    } finally {
      setSaving(false);
      // Onboarding finishes on the far side of EssentialPermissions, not here —
      // see that screen's `onDone: 'complete'` handling.
      navigation.navigate('EssentialPermissions', { onDone: 'complete' });
    }
  }, [nativeLanguage, motivations, navigation]);

  return (
    <AppBackground opacity={0.6}>
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <OnboardingProgress currentStep={0} totalSteps={2} stepLabel="Welcome" />
      </SafeAreaView>
      <ScrollView
        testID="language-onboarding-screen"
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={[styles.content, { paddingHorizontal: containerPadding }]}
        keyboardShouldPersistTaps="handled">
        <AdaptiveContainer width="reading" style={styles.stack}>
          <View style={styles.brandLockup}>
            <Typography
              variant="largeTitle"
              weight="bold"
              color={colors.textPrimary}
              align="center"
              style={styles.welcomePrefix}
            >
              Welcome to
            </Typography>
            <HeaderLogo orientation="vertical" height={92} />
          </View>
          <Typography variant="body" color={colors.textSecondary} align="center" style={styles.subtitle}>
            A couple of quick questions so your tutor and plan fit you.
          </Typography>

          <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
              MY NATIVE LANGUAGE
            </Typography>
            <View style={styles.chips}>
              {NATIVE_LANGUAGES.map((lang) => {
                const active = nativeLanguage === lang;
                return (
                  <Pressable
                    key={lang}
                    testID={`language-onboarding-native-${lang.toLowerCase()}`}
                    onPress={() => setNativeLanguage(lang)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.chip,
                      { borderColor: active ? colors.primary : colors.borderColor, backgroundColor: active ? colors.primary + '1F' : colors.backgroundMain },
                    ]}
                  >
                    <Typography variant="subheadline" weight={active ? 'semibold' : 'regular'} color={colors.textPrimary}>
                      {lang}
                    </Typography>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
              WHY I&apos;M LEARNING (optional)
            </Typography>
            <View style={styles.chips}>
              {MOTIVATIONS.map((m) => {
                const active = motivations.includes(m.id);
                return (
                  <Pressable
                    key={m.id}
                    testID={`language-onboarding-motivation-${m.id}`}
                    onPress={() => toggleMotivation(m.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active, selected: active }}
                    style={[
                      styles.chip,
                      { borderColor: active ? colors.primary : colors.borderColor, backgroundColor: active ? colors.primary + '1F' : colors.backgroundMain },
                    ]}
                  >
                    <Typography variant="subheadline" weight={active ? 'semibold' : 'regular'} color={colors.textPrimary}>
                      {m.label}
                    </Typography>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Pressable
            testID="language-onboarding-start"
            onPress={() => void finish()}
            disabled={!nativeLanguage || saving}
            style={[styles.primaryBtn, { backgroundColor: nativeLanguage ? colors.primary : colors.borderColor }]}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Typography variant="body" weight="semibold" color={colors.white}>
                Start learning
              </Typography>
            )}
          </Pressable>
        </AdaptiveContainer>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  headerSafeArea: { flex: 0 },
  content: { paddingTop: Spacing.md, paddingBottom: Layout.bottomSafeArea + Spacing.xl },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: { gap: Spacing.base },
  brandLockup: { alignItems: 'center', marginTop: Spacing.xl, gap: Spacing.sm },
  welcomePrefix: {},
  subtitle: { marginBottom: Spacing.sm },
  card: { padding: Spacing.base, gap: Spacing.sm },
  label: { letterSpacing: 0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { borderWidth: 1, borderRadius: CornerRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  primaryBtn: { borderRadius: CornerRadius.md, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.base },
});
