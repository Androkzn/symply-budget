import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

import {
  languageDialoguesApi,
  type DialogueScenario,
  type GeneratedDialogue,
} from '../api/languageExtras';

const SCENARIOS: Array<{ id: DialogueScenario; label: string; icon: string }> = [
  { id: 'restaurant', label: 'Restaurant', icon: 'restaurant-outline' },
  { id: 'doctor', label: 'Doctor', icon: 'medkit-outline' },
  { id: 'workplace', label: 'Workplace', icon: 'briefcase-outline' },
  { id: 'airport', label: 'Airport', icon: 'airplane-outline' },
  { id: 'hotel', label: 'Hotel', icon: 'bed-outline' },
];

export function LanguageDialogueScreen() {  const colors = useAppColors();
  const router = useRouter();
  const { content: containerPadding } = useLayoutPadding();

  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<DialogueScenario | null>(null);
  const [dialogue, setDialogue] = useState<GeneratedDialogue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (scenario: DialogueScenario) => {
    setActive(scenario);
    setLoading(true);
    setError(null);
    setDialogue(null);
    try {
      const result = await languageDialoguesApi.generate(scenario);
      setDialogue(result);
    } catch {
      setError('Could not generate a dialogue right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="language-dialogue-screen">
        <ScreenHeader
          title="Conversation practice"
          showBackButton
          onBackPress={() => router.back()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingHorizontal: containerPadding }]}
        >
          <AdaptiveContainer width="reading" style={styles.stack}>
            <Typography variant="body" color={colors.textSecondary}>
              Pick a scene and practice a real conversation — with translations and tips.
            </Typography>

            <View style={styles.scenarioRow}>
              {SCENARIOS.map((s) => {
                const on = active === s.id;
                return (
                  <Pressable
                    key={s.id}
                    testID={`language-dialogue-scenario-${s.id}`}
                    onPress={() => void generate(s.id)}
                    style={[
                      styles.scenario,
                      { borderColor: on ? colors.primary : colors.borderColor, backgroundColor: on ? colors.primary + '1F' : colors.backgroundSecondary },
                    ]}
                  >
                    <Icon name={s.icon} size={22} color={on ? colors.primary : colors.textSecondary} />
                    <Typography variant="caption1" weight={on ? 'semibold' : 'regular'} color={colors.textPrimary}>
                      {s.label}
                    </Typography>
                  </Pressable>
                );
              })}
            </View>

            {loading && (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
                <Typography variant="footnote" color={colors.textSecondary} style={styles.centerText}>
                  Writing your scene…
                </Typography>
              </View>
            )}

            {error && (
              <Typography variant="body" color={colors.error} style={styles.centerText}>
                {error}
              </Typography>
            )}

            {dialogue && !loading && (
              <>
                <View testID="language-dialogue-generated">
                {!!dialogue.context && (
                  <Typography variant="footnote" color={colors.textSecondary} style={styles.contextText}>
                    {dialogue.context}
                  </Typography>
                )}

                {dialogue.exchanges?.map((ex, i) => (
                  <View
                    key={i}
                    style={[styles.bubbleRow, { justifyContent: ex.speaker === 'user' ? 'flex-end' : 'flex-start' }]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        ex.speaker === 'user'
                          ? { backgroundColor: colors.primary }
                          : { backgroundColor: colors.backgroundSecondary },
                      ]}
                    >
                      <Typography variant="body" color={ex.speaker === 'user' ? colors.white : colors.textPrimary}>
                        {ex.text}
                      </Typography>
                      {!!ex.translation && (
                        <Typography
                          variant="caption1"
                          color={ex.speaker === 'user' ? colors.white : colors.textSecondary}
                          style={styles.translation}
                        >
                          {ex.translation}
                        </Typography>
                      )}
                    </View>
                  </View>
                ))}

                {!!dialogue.vocabulary?.length && (
                  <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
                    <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                      KEY VOCABULARY
                    </Typography>
                    <Typography variant="body" color={colors.textPrimary}>
                      {dialogue.vocabulary.join(' · ')}
                    </Typography>
                  </Card>
                )}

                {!!dialogue.tips?.length && (
                  <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
                    <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
                      TIPS
                    </Typography>
                    {dialogue.tips.map((t, i) => (
                      <Typography key={i} variant="body" color={colors.textPrimary}>
                        • {t}
                      </Typography>
                    ))}
                  </Card>
                )}
                </View>
              </>
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
  stack: { gap: Spacing.md },
  scenarioRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  scenario: {
    width: 92,
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  center: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  centerText: { textAlign: 'center' },
  contextText: { fontStyle: 'italic', marginBottom: Spacing.xs },
  bubbleRow: { flexDirection: 'row', width: '100%' },
  bubble: { maxWidth: '85%', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: CornerRadius.lg, gap: Spacing.xxs },
  translation: { opacity: 0.85 },
  card: { padding: Spacing.base, gap: Spacing.xs, marginTop: Spacing.xs },
  label: { letterSpacing: 0.6 },
});
