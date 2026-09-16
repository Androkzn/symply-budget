import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { HealthChallengeTodayEntry } from '@api/health';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthSectionScreen } from '../components';
import {
  CHALLENGE_CATEGORY_META,
  CHALLENGE_CATEGORY_OPTIONS,
  challengeDisplayColor,
  challengeDisplayIcon,
  createChallenge,
  deleteChallenge,
  isEmojiIcon,
  loadChallengeProgressToday,
  loadChallenges,
  updateChallenge,
  type HealthChallengeCategory,
  type HealthChallengeFrequency,
  type HealthFoodChallenge,
  type HealthFoodChallengeWrite,
} from '../healthChallengesStorage';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

const FREQUENCY_OPTIONS: ReadonlyArray<{ value: HealthChallengeFrequency; label: string }> = [
  { value: 'daily', label: 'Per day' },
  { value: 'weekly', label: 'Per week' },
];

interface ChallengeDraft {
  name: string;
  category: HealthChallengeCategory;
  targetFoodName: string;
  targetGrams: string;
  frequency: HealthChallengeFrequency;
  isActive: boolean;
}

const EMPTY_DRAFT: ChallengeDraft = {
  name: '',
  category: 'vegetables',
  targetFoodName: '',
  targetGrams: '',
  frequency: 'daily',
  isActive: true,
};

function draftFromChallenge(challenge: HealthFoodChallenge): ChallengeDraft {
  return {
    name: challenge.name,
    category: challenge.category,
    targetFoodName: challenge.target_food_name ?? '',
    targetGrams: String(challenge.target_grams),
    frequency: challenge.frequency,
    isActive: challenge.is_active,
  };
}

function draftToWrite(draft: ChallengeDraft): HealthFoodChallengeWrite | null {
  const name = draft.name.trim();
  const grams = Number(draft.targetGrams);
  if (name.length === 0 || !Number.isFinite(grams) || grams <= 0) return null;
  return {
    name,
    category: draft.category,
    target_food_name: draft.category === 'custom_ingredient' ? draft.targetFoodName.trim() || null : null,
    target_grams: grams,
    frequency: draft.frequency,
    is_active: draft.isActive,
  };
}

/**
 * Manage food challenges — donor `ChallengesSettingsView`, reached from the
 * Home "Food challenges" widget's pencil icon and its empty-state button.
 *
 * A challenge is a target amount (e.g. "500g vegetables") measured daily or
 * weekly; the server matches logged foods against the category (or a custom
 * ingredient name) to compute progress. This screen owns create / edit /
 * pause / delete; the Home widget only ever reads the weekly rollup.
 */
export function HealthChallengesScreen() {
  const colors = useAppColors();
  const [challenges, setChallenges] = useState<HealthFoodChallenge[]>([]);
  const [today, setToday] = useState<HealthChallengeTodayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChallengeDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const hydrate = useCallback(async () => {
    const [list, progress] = await Promise.all([loadChallenges(), loadChallengeProgressToday()]);
    setChallenges(list);
    setToday(progress?.challenges ?? []);
    setLoading(false);
  }, []);

  // Hydrates on mount AND every subsequent focus (leave-and-return) — a plain
  // mount-only `useEffect` would be redundant with this, since `useFocusEffect`
  // already fires immediately when the screen is focused on first render.
  useFocusEffect(
    useCallback(() => {
      void hydrate();
    }, [hydrate]),
  );
  // Also re-hydrate the instant a HealthKit sync lands while already on this
  // tab — the background observer/catch-up paths don't wait for a nav event.
  useHealthKitSyncHydration(hydrate);

  const todayById = useMemo(() => {
    const map = new Map<string, HealthChallengeTodayEntry>();
    for (const entry of today) map.set(entry.id, entry);
    return map;
  }, [today]);

  const active = useMemo(() => challenges.filter((c) => c.is_active), [challenges]);
  const paused = useMemo(() => challenges.filter((c) => !c.is_active), [challenges]);

  const openCreateForm = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormOpen(true);
  };

  const openEditForm = (challenge: HealthFoodChallenge) => {
    setEditingId(challenge.id);
    setDraft(draftFromChallenge(challenge));
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleSubmit = async () => {
    const write = draftToWrite(draft);
    if (!write || saving) return;
    setSaving(true);
    try {
      const next = editingId ? await updateChallenge(editingId, write) : await createChallenge(write);
      setChallenges(next);
      closeForm();
      const progress = await loadChallengeProgressToday();
      setToday(progress?.challenges ?? []);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (challenge: HealthFoodChallenge) => {
    setChallenges(await updateChallenge(challenge.id, { is_active: !challenge.is_active }));
  };

  const performDelete = (challenge: HealthFoodChallenge) => {
    void deleteChallenge(challenge.id).then((next) => {
      setChallenges(next);
      if (editingId === challenge.id) closeForm();
    });
  };

  const handleDelete = (challenge: HealthFoodChallenge) => {
    Alert.alert('Delete challenge', `Remove "${challenge.name}"? This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => performDelete(challenge) },
    ]);
  };

  const renderChallenge = (challenge: HealthFoodChallenge) => {
    const color = challengeDisplayColor(challenge);
    const icon = challengeDisplayIcon(challenge);
    const progress = todayById.get(challenge.id);
    return (
      <Card
        key={challenge.id}
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID={`health-challenge-${challenge.id}`}
      >
        <View style={styles.row}>
          <View style={[styles.glyphWrap, { backgroundColor: color + '1F' }]}>
            {isEmojiIcon(icon) ? (
              <Typography variant="body">{icon}</Typography>
            ) : (
              <Icon name={icon} size={18} color={color} />
            )}
          </View>
          <Pressable
            onPress={() => openEditForm(challenge)}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${challenge.name}`}
            testID={`health-challenge-open-${challenge.id}`}
            style={styles.flex}
          >
            <Typography variant="body" weight="medium" color={colors.textPrimary}>
              {challenge.name}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {challenge.target_grams}g {challenge.frequency === 'daily' ? 'per day' : 'per week'}
              {progress ? ` · ${Math.round(progress.consumed_grams)}g today` : ''}
            </Typography>
          </Pressable>
          <Pressable
            onPress={() => void handleToggleActive(challenge)}
            accessibilityRole="button"
            accessibilityLabel={challenge.is_active ? 'Pause challenge' : 'Resume challenge'}
            testID={`health-challenge-toggle-${challenge.id}`}
            hitSlop={8}
          >
            <Icon
              name={challenge.is_active ? 'pause' : 'play'}
              size={18}
              color={challenge.is_active ? colors.textSecondary : colors.success}
            />
          </Pressable>
          <Pressable
            onPress={() => handleDelete(challenge)}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${challenge.name}`}
            testID={`health-challenge-delete-${challenge.id}`}
            hitSlop={8}
          >
            <Icon name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      </Card>
    );
  };

  return (
    <HealthSectionScreen title="Food Challenges" testID="health-challenges-screen" loading={loading}>
      {active.length === 0 && paused.length === 0 ? (
        <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
          <Typography variant="body" color={colors.textSecondary} testID="health-challenges-empty">
            No challenges yet. Set a food goal like "500g vegetables daily" below.
          </Typography>
        </Card>
      ) : (
        active.map(renderChallenge)
      )}

      {paused.length > 0 ? (
        <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            PAUSED ({paused.length})
          </Typography>
          {paused.map(renderChallenge)}
        </Card>
      ) : null}

      {formOpen ? (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-challenge-form"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {editingId ? 'EDIT CHALLENGE' : 'NEW CHALLENGE'}
          </Typography>

          <TextInput
            value={draft.name}
            onChangeText={(text) => setDraft((d) => ({ ...d, name: text }))}
            placeholder="e.g. Eat more vegetables"
            placeholderTextColor={colors.textSecondary}
            testID="health-challenge-name-input"
            style={[
              styles.input,
              { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
            ]}
          />

          <View style={styles.chipRow}>
            {CHALLENGE_CATEGORY_OPTIONS.map((option) => {
              const selected = draft.category === option.value;
              const meta = CHALLENGE_CATEGORY_META[option.value];
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setDraft((d) => ({ ...d, category: option.value }))}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`health-challenge-category-${option.value}`}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? meta.color : 'transparent',
                      borderColor: selected ? meta.color : colors.borderColor,
                    },
                  ]}
                >
                  <Typography variant="caption1" color={selected ? colors.white : colors.textSecondary}>
                    {option.label}
                  </Typography>
                </Pressable>
              );
            })}
          </View>

          {draft.category === 'custom_ingredient' ? (
            <TextInput
              value={draft.targetFoodName}
              onChangeText={(text) => setDraft((d) => ({ ...d, targetFoodName: text }))}
              placeholder="Ingredient name, e.g. Avocado"
              placeholderTextColor={colors.textSecondary}
              testID="health-challenge-ingredient-input"
              style={[
                styles.input,
                { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
              ]}
            />
          ) : null}

          <View style={styles.addRow}>
            <TextInput
              value={draft.targetGrams}
              onChangeText={(text) => setDraft((d) => ({ ...d, targetGrams: text.replace(/[^0-9]/g, '') }))}
              placeholder="Target grams"
              placeholderTextColor={colors.textSecondary}
              keyboardType="number-pad"
              testID="health-challenge-grams-input"
              style={[
                styles.input,
                styles.flex,
                { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
              ]}
            />
            <View style={[styles.freqToggle, { borderColor: colors.borderColor }]}>
              {FREQUENCY_OPTIONS.map((option) => {
                const selectedFreq = draft.frequency === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setDraft((d) => ({ ...d, frequency: option.value }))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedFreq }}
                    testID={`health-challenge-frequency-${option.value}`}
                    style={[styles.freqOption, selectedFreq && { backgroundColor: colors.primary }]}
                  >
                    <Typography
                      variant="footnote"
                      weight="semibold"
                      color={selectedFreq ? colors.white : colors.textSecondary}
                    >
                      {option.label}
                    </Typography>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.formActions}>
            <Pressable
              onPress={closeForm}
              accessibilityRole="button"
              testID="health-challenge-form-cancel"
              style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
            >
              <Typography variant="footnote" color={colors.textSecondary}>
                Cancel
              </Typography>
            </Pressable>
            <Pressable
              onPress={() => void handleSubmit()}
              disabled={draftToWrite(draft) === null || saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: draftToWrite(draft) === null || saving }}
              testID="health-challenge-form-submit"
              style={[
                styles.primaryButton,
                { backgroundColor: draftToWrite(draft) !== null && !saving ? colors.success : colors.borderColor },
              ]}
            >
              <Typography variant="footnote" weight="semibold" color={colors.white}>
                {editingId ? 'Save' : 'Add challenge'}
              </Typography>
            </Pressable>
          </View>
        </Card>
      ) : (
        <Pressable
          onPress={openCreateForm}
          accessibilityRole="button"
          accessibilityLabel="Add a food challenge"
          testID="health-challenges-add"
          style={[styles.addChallengeButton, { backgroundColor: colors.success }]}
        >
          <Icon name="add" size={18} color={colors.white} />
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            Add Challenge
          </Typography>
        </Pressable>
      )}
    </HealthSectionScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  flex: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  glyphWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.xxl,
    borderWidth: 1,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  freqToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  freqOption: {
    paddingHorizontal: Spacing.md,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
  },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: CornerRadius.sm,
  },
  addChallengeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 48,
    borderRadius: CornerRadius.sm,
  },
});
