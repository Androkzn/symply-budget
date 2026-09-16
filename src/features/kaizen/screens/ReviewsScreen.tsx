import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { BrandButton, GlassCard } from '@features/kaizen/brand';
import { CalendarIcon } from '@features/kaizen/brand/iconset';
import { useInvalidateKaizenWeeklyReviews, useKaizenWeeklyReviews } from '@features/kaizen/hooks/useKaizenWeeklyReviews';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { useAuthStore } from '@stores/authStore';
import { useAppColors } from '@theme';

import { EmptyState, KaizenScreen, kaizenStyles } from './common';

export function ReviewsScreen() {
  const colors = useAppColors();
  const userId = useAuthStore(state => state.user?.id);
  const { data: reviews = [] } = useKaizenWeeklyReviews();
  const invalidateReviews = useInvalidateKaizenWeeklyReviews();
  const saveWeeklyReview = useKaizenStore(state => state.saveWeeklyReview);
  const [wins, setWins] = useState('');
  const [improvements, setImprovements] = useState('');
  const [onePercentChange, setOnePercentChange] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await saveWeeklyReview({ wins, improvements, onePercentChange });
      setWins('');
      setImprovements('');
      setOnePercentChange('');
      if (userId) {
        await invalidateReviews(userId);
      }
    } catch {
      // Keep form values when offline / sync fails.
    } finally {
      setSaving(false);
    }
  };
  return (
    <KaizenScreen title="Reviews" subtitle="Pause weekly to notice what is working.">
      <View style={styles.section}>
        <GlassCard padding={0} radius={20}>
          <View style={styles.header}>
            <CalendarIcon size={20} color={colors.primary} />
            <Text style={[styles.headerTitle, { color: colors.textSecondary }]}>Weekly reviews</Text>
          </View>
          <View style={styles.form}>
            <TextInput value={wins} onChangeText={setWins} placeholder="What went well?" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderColor }]} />
            <TextInput value={improvements} onChangeText={setImprovements} placeholder="What would you improve?" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderColor }]} />
            <TextInput value={onePercentChange} onChangeText={setOnePercentChange} placeholder="Your 1% change next week" placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderColor }]} />
            <BrandButton title="Save review" loading={saving} onPress={() => void save()} />
          </View>
          {reviews.length === 0 ? <EmptyState>No reviews yet. Your first weekly reflection starts here.</EmptyState> : reviews.map(review => (
            <View key={review.id} style={[kaizenStyles.row, { alignItems: 'flex-start', borderBottomColor: colors.borderColor }]}>
              <CalendarIcon size={20} color={colors.primary} />
              <View style={kaizenStyles.rowText}>
                <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '600' }}>Week of {review.week_start}</Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>{review.wins ?? review.one_percent_change ?? 'Reflection saved'}</Text>
              </View>
            </View>
          ))}
        </GlassCard>
      </View>
    </KaizenScreen>
  );
}
const styles = StyleSheet.create({
  section: { marginTop: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.base, paddingTop: Spacing.base, paddingBottom: Spacing.xs },
  headerTitle: { fontSize: Typography.caption.size, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  form: { gap: 12, padding: 16 },
  input: { borderBottomWidth: 1, fontSize: 16, paddingVertical: 10 },
});
