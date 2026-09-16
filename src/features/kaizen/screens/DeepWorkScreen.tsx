import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { BrandButton } from '@features/kaizen/brand';
import { AddIcon, FocusIcon, TimerIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import { CommandCenterCard, ProgressRing } from '@features/kaizen/components/CommandCenter';
import { focusModeHint, openSystemFocusSettings } from '@features/kaizen/services/focusMode';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { GlassRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

/** Daily deep-work capacity — the store caps the day at two focus blocks. */
const DAILY_BLOCK_LIMIT = 2;

/** Glass secondary action — pairs with the gradient BrandButton without competing. */
function GlassSecondaryButton({
  title,
  icon,
  onPress,
}: {
  title: string;
  icon?: ReactNode;
  onPress?: () => void;
}) {  const appColors = useAppColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondary,
        {
          borderColor: appColors.glassBorder,
          backgroundColor: appColors.glassFill,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {icon}
      <Text style={{ color: appColors.primary, fontWeight: '700', fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}

export function DeepWorkScreen() {
  const colors = useAppColors();
  const appColors = useAppColors();
  const brandedIcon = useBrandIconState(true);
  const deepWork = useKaizenStore(state => state.deepWork);
  const addDeepWorkBlock = useKaizenStore(state => state.addDeepWorkBlock);
  const [topic, setTopic] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [suggestFocusMode, setSuggestFocusMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const todayBlocks = deepWork.filter(block => block.date === today);
  const atLimit = todayBlocks.length >= DAILY_BLOCK_LIMIT;
  const focusProgress = Math.min(1, todayBlocks.length / DAILY_BLOCK_LIMIT);

  const save = async () => {
    if (!topic.trim() || todayBlocks.length >= 2) return;
    setSaving(true);
    try {
      await addDeepWorkBlock(
        topic.trim(),
        startTime.trim() || undefined,
        endTime.trim() || undefined,
        suggestFocusMode,
      );
      setTopic('');
      setStartTime('');
      setEndTime('');
      if (suggestFocusMode) await openSystemFocusSettings();
    } catch {
      // Keep the topic when add fails.
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    backgroundColor: appColors.inputFieldBackground,
    borderColor: appColors.glassBorder,
    borderRadius: GlassRadius.button,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.textPrimary,
  } as const;

  return (
    <KaizenScreen
      title="Deep work"
      subtitle={
        atLimit
          ? 'You have reached today’s two-block limit.'
          : 'Protect time for the work that matters.'
      }
      showBackButton
    >
      <CommandCenterCard tint={colors.primary}>
        <View style={styles.heroHeader}>
          <View style={styles.heroTitle}>
            <FocusIcon size={20} state={brandedIcon} />
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 17 }}>
              Focus today
            </Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>
            {todayBlocks.length}/{DAILY_BLOCK_LIMIT}
          </Text>
        </View>
        <View style={styles.ringWrap}>
          <ProgressRing
            progress={focusProgress}
            size={132}
            stroke={12}
            label={`${todayBlocks.length} of ${DAILY_BLOCK_LIMIT} blocks`}
          />
        </View>
        {atLimit ? (
          <View style={[styles.pill, { backgroundColor: `${colors.success}22` }]}>
            <Text style={{ color: colors.success, fontWeight: '600' }}>
              Deep work booked for today
            </Text>
          </View>
        ) : null}
      </CommandCenterCard>

      <Section title="Add a block">
        <View style={styles.form}>
          <TextInput
            value={topic}
            onChangeText={setTopic}
            placeholder="What will you focus on?"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, inputStyle]}
          />
          <View style={styles.times}>
            <TextInput
              value={startTime}
              onChangeText={setStartTime}
              placeholder="Start (e.g. 09:00)"
              placeholderTextColor={colors.textSecondary}
              style={[styles.time, inputStyle]}
            />
            <TextInput
              value={endTime}
              onChangeText={setEndTime}
              placeholder="End"
              placeholderTextColor={colors.textSecondary}
              style={[styles.time, inputStyle]}
            />
          </View>
          <View style={[kaizenStyles.row, { borderBottomWidth: 0, paddingHorizontal: 0 }]}>
            <View style={kaizenStyles.rowText}>
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>Suggest Focus Mode</Text>
              <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                {focusModeHint(suggestFocusMode)}
              </Text>
            </View>
            <Switch value={suggestFocusMode} onValueChange={setSuggestFocusMode} />
          </View>
          <BrandButton
            title="Add block"
            loading={saving}
            disabled={!topic.trim() || todayBlocks.length >= 2}
            onPress={() => void save()}
            icon={<AddIcon size={20} state="inactive-dark" color="#FFFFFF" />}
          />
          <GlassSecondaryButton
            title="Open Focus settings"
            icon={<TimerIcon size={18} color={colors.primary} />}
            onPress={() => void openSystemFocusSettings()}
          />
        </View>
      </Section>

      <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>Today</Text>
      {todayBlocks.length === 0 ? (
        <CommandCenterCard>
          <EmptyState>No deep work blocks yet.</EmptyState>
        </CommandCenterCard>
      ) : (
        todayBlocks.map(block => (
          <CommandCenterCard key={block.id}>
            <View style={[kaizenStyles.row, { borderBottomWidth: 0, paddingHorizontal: 0 }]}>
              <FocusIcon size={22} state={brandedIcon} />
              <View style={kaizenStyles.rowText}>
                <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                  {block.topic ?? 'Focus block'}
                </Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                  {[block.start_time, block.end_time].filter(Boolean).join(' – ') || 'Unscheduled'}
                  {block.suggest_focus_mode ? ' · Focus suggested' : ''}
                </Text>
              </View>
            </View>
          </CommandCenterCard>
        ))
      )}
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.md, padding: Spacing.base },
  input: { fontSize: 16, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  times: { flexDirection: 'row', gap: Spacing.smd },
  time: { flex: 1, fontSize: 14, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  secondary: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: GlassRadius.button,
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: Spacing.lg,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  heroTitle: { alignItems: 'center', flexDirection: 'row', gap: Spacing.sm },
  ringWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  pill: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  groupTitle: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: -Spacing.xs,
    marginLeft: Spacing.xs,
    marginTop: Spacing.xs,
    textTransform: 'uppercase',
  },
});
