import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import { CalendarIcon, brandIconState } from '@features/kaizen/brand/iconset';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';

import { KaizenScreen, Section } from './common';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function WeeklyRotationScreen() {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const { glassBorder, inputFieldBackground, surfaceSelected } = useAppColors();
  const todayWeekday = ((new Date().getDay() + 6) % 7) + 1;
  const rotations = useKaizenStore(state => state.rotations);
  const save = useKaizenStore(state => state.saveWeeklyRotation);
  const [values, setValues] = useState(() => Object.fromEntries(days.map((_, index) => [index + 1, rotations.find(rotation => rotation.weekday === index + 1)?.focus_title ?? ''])));
  return <KaizenScreen title="Weekly rotation" subtitle="Set a focus for each day."><Section title="Focus by day">{days.map((day, index) => {
    const isToday = index + 1 === todayWeekday;
    return <View key={day} style={[styles.row, index > 0 && { borderTopColor: colors.borderColor, borderTopWidth: StyleSheet.hairlineWidth }, isToday && { backgroundColor: surfaceSelected }]}>
      <View style={styles.iconWrap}><CalendarIcon size={22} state={brandIconState(isDark, isToday)} /></View>
      <View style={styles.field}>
        <Text style={[styles.day, { color: isToday ? colors.primary : colors.textPrimary }]}>{day}</Text>
        <TextInput value={values[index + 1]} onChangeText={text => setValues(current => ({ ...current, [index + 1]: text }))} onBlur={() => void save(index + 1, values[index + 1])} placeholder="Focus" placeholderTextColor={colors.textSecondary} style={[styles.input, { backgroundColor: inputFieldBackground, borderColor: glassBorder, color: colors.textPrimary }]} />
      </View>
    </View>;
  })}</Section></KaizenScreen>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
  },
  iconWrap: { paddingTop: Spacing.xs },
  field: { flex: 1, gap: Spacing.sm },
  day: { fontSize: Typography.label.size, fontWeight: '600' },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: Typography.body.size,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
});
