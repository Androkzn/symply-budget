import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { wishesApi, type WishStatus, type WishWithMeta } from '@api/wishes';
import { FilterTabs, Typography, type FilterTab } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import type { BudgetStackParamList } from '@navigation/types';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

import { AddWishModal } from './AddWishModal';

type Nav = NativeStackNavigationProp<BudgetStackParamList>;

const SUB_TABS: FilterTab[] = [
  { id: 'active', label: 'Dreaming' },
  { id: 'achieved', label: 'Achieved' },
  { id: 'archived', label: 'Archived' },
];

/** Cents → '$1,200' (no cents shown when whole). */
function formatCost(cents: number): string {
  return formatMoney(cents, { decimals: cents % 100 === 0 ? 0 : 2 });
}

/** "3 photos · 2 notes" style summary of a wish's feed. */
function feedSummary(wish: WishWithMeta): string {
  const photos = wish.image_count;
  const others = wish.entry_count - wish.image_count;
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} photo${photos === 1 ? '' : 's'}`);
  if (others > 0) parts.push(`${others} note${others === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * The "Wishes" tab of the Budget screen: a feed of long-term dreams. Renders
 * WITHOUT its own ScrollView — BudgetScreen owns the outer scroll (see
 * [[budget_savings_scroll_and_import]]).
 */
export function WishesView() {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<Nav>();
  const { currentHousehold } = useHouseholdStore();
  const dataRevision = useBudgetStore((s) => s.dataRevision);
  const householdId = currentHousehold?.id;

  const [status, setStatus] = useState<WishStatus>('active');
  const [wishes, setWishes] = useState<WishWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) {
      // No household yet — show the empty state rather than a stuck spinner.
      setWishes([]);
      setIsLoading(false);
      return;
    }
    try {
      const result = await wishesApi.list(householdId, status);
      setWishes(result);
    } catch (error) {
      console.error('[WishesView] load failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [householdId, status]);

  useEffect(() => {
    if (dataRevision > 0) load();
  }, [dataRevision, load]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load();
    }, [load])
  );

  // Dev/E2E: `simplebudget://e2e-wish-draft` opens the add sheet (tap can miss).
  useEffect(() => {
    if (!__DEV__) return;
    const openFromDraft = () => {
      const { consumeE2EOpenWishAdd } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Development-only lazy hook.
        require('@services/e2e-wish-draft') as typeof import('@services/e2e-wish-draft');
      if (consumeE2EOpenWishAdd()) setShowAdd(true);
    };
    openFromDraft();
    const timer = setInterval(openFromDraft, 400);
    return () => clearInterval(timer);
  }, []);

  const emptyCopy = useMemo(() => {
    switch (status) {
      case 'achieved':
        return { title: 'Nothing achieved yet', body: 'Wishes you make happen will land here.' };
      case 'archived':
        return { title: 'Nothing archived', body: 'Wishes you set aside will land here.' };
      default:
        return {
          title: 'Dream a little',
          body: 'A boat, a kitchen remodel, a big trip — add the things you’re saving toward someday.',
        };
    }
  }, [status]);

  return (
    <View style={styles.wrap} testID="wishes-view">
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Typography variant="footnote" color={colors.textSecondary}>
            Long-term dreams for your home & life
          </Typography>
        </View>
        <TouchableOpacity
          style={[styles.newButton, { backgroundColor: colors.primary }]}
          onPress={() => setShowAdd(true)}
          testID="wishes-new-button"
          accessibilityLabel="New wish"
        >
          <Icon name="add" size={IconSize.md} color={colors.white} />
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            New
          </Typography>
        </TouchableOpacity>
      </View>

      <FilterTabs
        tabs={SUB_TABS}
        activeTab={status}
        onTabChange={(id) => setStatus(id as WishStatus)}
        showActiveIndicator={false}
      />

      <View style={styles.list}>
        {isLoading ? (
          <View style={styles.centered} testID="wishes-loading">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : wishes.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSelected }]}>
              <Icon name="sparkles-outline" size={IconSize.lg} color={colors.primary} />
            </View>
            <Typography variant="headline" weight="semibold" style={styles.emptyTitle}>
              {emptyCopy.title}
            </Typography>
            <Typography variant="subheadline" color={colors.textSecondary} style={styles.emptyBody}>
              {emptyCopy.body}
            </Typography>
            {status === 'active' && (
              <TouchableOpacity
                style={[styles.emptyCta, { backgroundColor: colors.primary }]}
                onPress={() => setShowAdd(true)}
              >
                <Typography variant="callout" weight="semibold" color={colors.white}>
                  Add your first wish
                </Typography>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          wishes.map((wish, index) => {
            const summary = feedSummary(wish);
            return (
              <TouchableOpacity
                key={wish.id}
                activeOpacity={0.85}
                style={[styles.card, { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}
                onPress={() => navigation.navigate('WishDetail', { wishId: wish.id })}
                testID={index === 0 ? 'wishes-first-card' : `wish-card-${wish.id}`}
                accessible
                accessibilityRole="button"
                accessibilityLabel={wish.title}
              >
                <View style={[styles.cover, { backgroundColor: colors.mediaImagePlaceholder }]}>
                  {wish.cover_image_key ? (
                    <Image
                      source={{ uri: `${ENV.API_BASE_URL}/files/${wish.cover_image_key}` }}
                      style={styles.coverImage}
                      contentFit="cover"
                      transition={150}
                    />
                  ) : (
                    <View style={styles.coverPlaceholder}>
                      <Icon name="sparkles-outline" size={IconSize.lg} color={colors.textTertiary} />
                    </View>
                  )}
                  {wish.status === 'achieved' && (
                    <View style={[styles.badge, { backgroundColor: colors.success }]}>
                      <Icon name="checkmark" size={IconSize.sm} color={colors.white} />
                      <Typography variant="caption2" weight="semibold" color={colors.white}>
                        Achieved
                      </Typography>
                    </View>
                  )}
                </View>

                <View style={styles.cardBody}>
                  <Typography variant="headline" weight="semibold" numberOfLines={1}>
                    {wish.title}
                  </Typography>
                  {!!wish.notes && (
                    <Typography
                      variant="subheadline"
                      color={colors.textSecondary}
                      numberOfLines={2}
                      style={styles.cardNotes}
                    >
                      {wish.notes}
                    </Typography>
                  )}
                  <View style={styles.metaRow}>
                    {wish.estimated_cost_cents != null && (
                      <View style={[styles.pill, { backgroundColor: colors.surfaceSelected }]}>
                        <Icon name="pricetag-outline" size={IconSize.sm} color={colors.primary} />
                        <Typography variant="caption1" weight="medium" color={colors.textPrimary}>
                          {formatCost(wish.estimated_cost_cents)}
                        </Typography>
                      </View>
                    )}
                    {!!summary && (
                      <Typography variant="caption1" color={colors.textTertiary}>
                        {summary}
                      </Typography>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      <AddWishModal
        visible={showAdd}
        householdId={householdId ?? ''}
        onClose={() => setShowAdd(false)}
        onSaved={() => {
          setShowAdd(false);
          void load();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.base },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  headerText: { flex: 1 },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.full,
  },
  list: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Spacing.base },
  centered: { width: '100%', paddingVertical: Spacing.xxl, alignItems: 'center' },
  card: {
    width: '48%',
    borderRadius: CornerRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cover: { width: '100%', aspectRatio: 16 / 9 },
  coverImage: { height: '100%', width: '100%' },
  coverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.full,
  },
  cardBody: { padding: Spacing.base, gap: Spacing.xs },
  cardNotes: { marginTop: Spacing.xxs },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xxs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.full,
  },
  emptyCard: {
    width: '100%',
    borderRadius: CornerRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  emptyTitle: { textAlign: 'center' },
  emptyBody: { textAlign: 'center' },
  emptyCta: {
    marginTop: Spacing.base,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: CornerRadius.full,
  },
});
