import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

import { languageCardsApi, type CardRow } from '../api/languageCards';
import { languageReviewsApi, type ReviewRating } from '../api/languageReviews';

const RATINGS: Array<{ rating: ReviewRating; label: string; color: string }> = [
  { rating: 1, label: 'Again', color: '#FF3B30' },
  { rating: 2, label: 'Hard', color: '#FF9F0A' },
  { rating: 3, label: 'Good', color: '#34C759' },
  { rating: 4, label: 'Easy', color: '#4ECDC4' },
];

function cardFront(card: CardRow): string {
  return (card.front_content ?? card.word ?? '') as string;
}
function cardBack(card: CardRow): string {
  return (card.back_content ?? card.translation ?? card.context ?? '') as string;
}

export function LanguageReviewScreen() {  const colors = useAppColors();
  const router = useRouter();
  const { content: containerPadding } = useLayoutPadding();

  const [queue, setQueue] = useState<CardRow[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewedCount, setReviewedCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { dueCards } = await languageCardsApi.due();
      setQueue(dueCards);
      setIndex(0);
      setRevealed(false);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = queue[index];

  const rate = useCallback(
    async (rating: ReviewRating) => {
      if (!current) return;
      // Optimistically advance; fire the review in the background.
      void languageReviewsApi.submit({ cardId: current.id, rating }).catch(() => undefined);
      setReviewedCount((n) => n + 1);
      setRevealed(false);
      setIndex((i) => i + 1);
    },
    [current],
  );

  const done = !loading && (queue.length === 0 || index >= queue.length);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="language-review-screen">
        <ScreenHeader
          title="Review"
          showBackButton
          onBackPress={() => router.back()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <View style={[styles.body, { paddingHorizontal: containerPadding }]}>
          <AdaptiveContainer width="reading">
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : done ? (
              <View style={styles.center}>
                <Icon
                  name={reviewedCount > 0 ? 'checkmark-circle' : 'sparkles-outline'}
                  size={48}
                  color={colors.primary}
                />
                <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.centerText}>
                  {reviewedCount > 0 ? 'Review complete' : 'Nothing due right now'}
                </Typography>
                <Typography variant="body" color={colors.textSecondary} style={styles.centerText}>
                  {reviewedCount > 0
                    ? `You reviewed ${reviewedCount} card${reviewedCount === 1 ? '' : 's'}. Come back later for more.`
                    : 'New cards appear here as you learn. Check back after some practice.'}
                </Typography>
                {/* State-suffixed so a test can tell the "reviewed N cards" exit
                    from the "nothing was due" exit — both render from this one
                    code path (see LANG-REVIEW-028). */}
                <Pressable
                  testID={reviewedCount > 0 ? 'language-review-done-complete' : 'language-review-done-empty'}
                  onPress={() => router.back()}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                >
                  <Typography variant="body" weight="semibold" color={colors.white}>
                    Done
                  </Typography>
                </Pressable>
              </View>
            ) : current ? (
              <>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.counter}>
                  {index + 1} / {queue.length} due
                </Typography>

                <Pressable
                  testID="language-review-flashcard"
                  onPress={() => setRevealed(true)}
                  disabled={revealed}
                >
                  <Card variant="filled" style={[styles.flashcard, { backgroundColor: colors.backgroundSecondary }]}>
                    <Typography variant="title1" weight="bold" color={colors.textPrimary} style={styles.cardText}>
                      {cardFront(current)}
                    </Typography>
                    {revealed ? (
                      <>
                        <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
                        <Typography variant="title3" color={colors.textPrimary} style={styles.cardText}>
                          {cardBack(current)}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="footnote" color={colors.textSecondary} style={styles.tapHint}>
                        Tap to reveal
                      </Typography>
                    )}
                  </Card>
                </Pressable>

                {revealed && (
                  <View style={styles.ratings}>
                    {RATINGS.map((r) => (
                      <Pressable
                        key={r.rating}
                        testID={`language-review-rating-${r.rating}`}
                        onPress={() => void rate(r.rating)}
                        style={[styles.ratingBtn, { borderColor: r.color }]}
                      >
                        <Typography variant="subheadline" weight="semibold" color={r.color}>
                          {r.label}
                        </Typography>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            ) : null}
          </AdaptiveContainer>
        </View>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  body: { flex: 1, paddingTop: Spacing.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingBottom: Layout.bottomSafeArea },
  centerText: { textAlign: 'center', maxWidth: 300 },
  counter: { textAlign: 'center', marginBottom: Spacing.sm },
  flashcard: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.md, minHeight: 220, justifyContent: 'center' },
  cardText: { textAlign: 'center' },
  tapHint: { marginTop: Spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  ratings: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  ratingBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: CornerRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  primaryBtn: { borderRadius: CornerRadius.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, alignItems: 'center', marginTop: Spacing.base },
});
