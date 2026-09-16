import { type ReactNode, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BrandButton } from '@features/kaizen/brand';
import { AddIcon, CompleteIcon, HabitsIcon, StreaksIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import {
  selectHabitStackActionIdsForStack,
  selectHabitStackStepsForStack,
} from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { GlassRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

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

export function HabitStackScreen() {
  const colors = useAppColors();
  const appColors = useAppColors();
  const brandedIcon = useBrandIconState(true);
  const stacks = useKaizenStore(state => state.habitStacks);
  const steps = useKaizenStore(state => state.habitStackSteps);
  const actions = useKaizenStore(state => state.dailyCore);
  const upsertHabitStack = useKaizenStore(state => state.upsertHabitStack);
  const deleteHabitStack = useKaizenStore(state => state.deleteHabitStack);
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const actionById = useMemo(
    () => Object.fromEntries(actions.map(action => [action.id, action])),
    [actions],
  );

  const toggleAction = (id: string) => {
    setSelectedIds(current =>
      current.includes(id) ? current.filter(item => item !== id) : [...current, id],
    );
  };

  const moveStep = (id: string, direction: -1 | 1) => {
    setSelectedIds(current => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy;
    });
  };

  const beginEdit = (stackId: string) => {
    const ordered = selectHabitStackActionIdsForStack(steps, stackId);
    const stack = stacks.find(item => item.id === stackId);
    setEditingId(stackId);
    setName(stack?.name ?? '');
    setSelectedIds(ordered);
  };

  const save = async () => {
    if (!name.trim() || !selectedIds.length) return;
    await upsertHabitStack(name.trim(), selectedIds, editingId ?? undefined);
    setName('');
    setSelectedIds([]);
    setEditingId(null);
  };

  return (
    <KaizenScreen
      title="Habit stacks"
      subtitle="Group daily actions into repeatable sequences you can run in order."
      showBackButton
    >
      {stacks.length > 0 ? (
        <CommandCenterCard tint={colors.primary}>
          <View style={styles.summaryRow}>
            <StreaksIcon size={26} state={brandedIcon} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 17 }}>
                {stacks.length} {stacks.length === 1 ? 'stack' : 'stacks'}
              </Text>
              <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                {steps.length} steps ready to run
              </Text>
            </View>
          </View>
        </CommandCenterCard>
      ) : null}

      <Section title={editingId ? 'Edit stack' : 'Create stack'}>
        <View style={{ gap: Spacing.md, padding: Spacing.base }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Morning reset"
            placeholderTextColor={colors.textSecondary}
            style={{
              backgroundColor: appColors.inputFieldBackground,
              borderColor: appColors.glassBorder,
              borderRadius: GlassRadius.button,
              borderWidth: StyleSheet.hairlineWidth,
              color: colors.textPrimary,
              fontSize: 16,
              paddingHorizontal: Spacing.md,
              paddingVertical: Spacing.md,
            }}
          />
          <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>
            Choose steps ({selectedIds.length})
          </Text>
          {actions.map(action => {
            const selected = selectedIds.includes(action.id);
            return (
              <Pressable
                key={action.id}
                onPress={() => toggleAction(action.id)}
                style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}
              >
                {selected ? (
                  <CompleteIcon size={22} state={brandedIcon} />
                ) : (
                  <View style={[styles.bullet, { borderColor: colors.borderColor }]} />
                )}
                <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>
                  {action.title}
                </Text>
                <View
                  style={[
                    styles.tag,
                    {
                      backgroundColor: selected ? appColors.surfaceSelected : appColors.pillBackground,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: selected ? colors.primary : colors.textSecondary,
                      fontSize: 13,
                      fontWeight: '700',
                    }}
                  >
                    {selected ? 'Added' : 'Add'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {selectedIds.length > 0 && (
            <View style={{ gap: Spacing.sm }}>
              <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Order</Text>
              {selectedIds.map((id, index) => (
                <View
                  key={id}
                  style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}
                >
                  <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>
                    {index + 1}. {actionById[id]?.title ?? id}
                  </Text>
                  <Pressable
                    onPress={() => moveStep(id, -1)}
                    style={[
                      styles.iconButton,
                      { borderColor: appColors.glassBorder, backgroundColor: appColors.glassFill },
                    ]}
                  >
                    <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '700' }}>
                      ↑
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => moveStep(id, 1)}
                    style={[
                      styles.iconButton,
                      { borderColor: appColors.glassBorder, backgroundColor: appColors.glassFill },
                    ]}
                  >
                    <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '700' }}>
                      ↓
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <BrandButton
            title={editingId ? 'Save stack' : 'Create stack'}
            disabled={!name.trim() || !selectedIds.length}
            onPress={() => void save()}
            icon={<AddIcon size={20} state="inactive-dark" color="#FFFFFF" />}
          />
          {editingId ? (
            <GlassSecondaryButton
              title="Cancel edit"
              onPress={() => {
                setEditingId(null);
                setName('');
                setSelectedIds([]);
              }}
            />
          ) : null}
        </View>
      </Section>

      <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>Your stacks</Text>
      {stacks.length === 0 ? (
        <CommandCenterCard>
          <EmptyState>Create a stack from your daily core actions.</EmptyState>
        </CommandCenterCard>
      ) : (
        stacks.map(stack => {
          const stackSteps = selectHabitStackStepsForStack(steps, stack.id);
          return (
            <CommandCenterCard key={stack.id}>
              <View style={[kaizenStyles.row, { borderBottomWidth: 0, paddingHorizontal: 0 }]}>
                <HabitsIcon size={24} state={brandedIcon} />
                <View style={kaizenStyles.rowText}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{stack.name}</Text>
                  <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                    {stackSteps.length} steps
                  </Text>
                </View>
                <Pressable onPress={() => beginEdit(stack.id)} style={styles.textAction}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => void deleteHabitStack(stack.id)} style={styles.textAction}>
                  <Text style={{ color: colors.error, fontWeight: '600' }}>
                    Delete
                  </Text>
                </Pressable>
              </View>
              {stackSteps.map((step, index) => (
                <View key={step.id} style={styles.stepRow}>
                  <CompleteIcon size={18} state={brandedIcon} />
                  <Text style={{ color: colors.textSecondary, flex: 1 }}>
                    {index + 1}.{' '}
                    {(step.action_id && actionById[step.action_id]?.title) ||
                      step.action_id ||
                      'Action'}
                  </Text>
                </View>
              ))}
            </CommandCenterCard>
          );
        })
      )}
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
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
  summaryRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.md },
  bullet: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  tag: {
    borderRadius: GlassRadius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + Spacing.xxs,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: GlassRadius.button,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  textAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: Spacing.sm,
  },
  stepRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
    paddingLeft: Spacing.xs,
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
