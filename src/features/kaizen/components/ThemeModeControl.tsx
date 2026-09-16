/**
 * Symply Life — theme-mode control (feature-local).
 *
 * The donor imported `@components/settings/ThemeModeControl`, which the ecosystem does not
 * expose as a component. This is a functional equivalent over the ecosystem ThemeContext.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { CornerRadius, Spacing } from '@features/kaizen/theme/designTokens';

const MODES: Array<{ key: 'system' | 'light' | 'dark'; label: string }> = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export function ThemeModeControl() {
  const { setThemeMode } = useTheme();
  const c = useAppColors();
  return (
    <View style={styles.row}>
      {MODES.map(mode => (
        <Pressable
          key={mode.key}
          onPress={() => setThemeMode(mode.key)}
          style={[styles.pill, { backgroundColor: c.pillBackground }]}
        >
          <Text style={[styles.label, { color: c.textPrimary }]}>{mode.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  pill: {
    flex: 1,
    paddingVertical: Spacing.smd,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
  },
  label: { fontSize: 15, fontWeight: '600' },
});
