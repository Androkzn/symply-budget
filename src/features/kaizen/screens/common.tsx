import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader, ScreenScrollEnd, screenScrollEndTestId } from '@components/common';
import { BrandBackground, GlassCard } from '@features/kaizen/brand';
import { Layout, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

/** Shared test id for KaizenScreen's primary vertical scroll container. */
export const KAIZEN_SCREEN_SCROLL_TEST_ID = 'kaizen-screen-scroll';

/** ScrollView must flex within the header + tab bar column or content won't scroll on device. */
export const kaizenScrollViewStyle = StyleSheet.create({
  scroll: { flex: 1 },
  contentGrow: { flexGrow: 1 },
});

/** Approximate tab bar content height; safe-area bottom is added separately. */
const TAB_BAR_CONTENT_HEIGHT = 64;

export function KaizenScreen({
  title,
  subtitle,
  children,
  variant = 'detail',
  showBackButton = false,
  onBackPress,
  showHeaderActions = true,
  headerTitle,
  screenTestId,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /**
   * `detail` (default) → a standard centered header carrying the screen title
   * plus a back button, matching the rest of the app; no large in-body title.
   * `root` → a bottom-tab dashboard: the home-variant header (logo + avatar /
   * bell) with the title kept as the large in-body hero heading.
   */
  variant?: 'root' | 'detail';
  showBackButton?: boolean;
  /** Custom back handler; defaults to `router.back()` when the back button shows. */
  onBackPress?: () => void;
  /** When false, hides notification + profile (e.g. on those destination screens). */
  showHeaderActions?: boolean;
  /** Optional compact title in the sticky header bar. Defaults to brand label. */
  headerTitle?: string;
  /** Maestro / Detox root id for hub screens (e.g. `kaizen-more-screen`). */
  screenTestId?: string;
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { isTablet } = useDeviceType();
  const { sidebarInset } = useLayoutPadding();

  const isDetail = variant === 'detail';
  // Detail screens surface the title in the centered header (an explicit
  // `headerTitle` still wins if a shorter label is wanted); root dashboards keep
  // the header title-less and show the large in-body hero heading instead.
  const effectiveHeaderTitle = headerTitle ?? (isDetail ? title : undefined);
  // Avoid the "Profile / Profile" duplication: show the big body heading only
  // when the header carries no title (i.e. root dashboards).
  const showBodyTitle = !effectiveHeaderTitle;
  // Pushed detail screens always get a back button; roots keep the tab
  // dashboard's logo/avatar chrome and no back affordance.
  const showBack = isDetail ? true : showBackButton;
  // Bell + avatar belong to the tab dashboards; a pushed detail screen uses the
  // clean centered-title-only header (matching the app's settings sub-screens).
  const actionsVisible = isDetail ? false : showHeaderActions;

  return (
    <BrandBackground>
      <View testID={screenTestId} style={[styles.screenRoot, { paddingLeft: sidebarInset }]}>
      <ScreenHeader
        title={effectiveHeaderTitle}
        showBackButton={showBack}
        // ScreenHeader renders the back arrow only when it also has a handler, so
        // always supply one (defaulting to router.back) when the button is on.
        onBackPress={
          showBack ? onBackPress ?? (() => router.back()) : undefined
        }
        showNotificationBell={actionsVisible}
        showAvatar={actionsVisible}
        onNotificationPress={() => router.push('/kaizen/notifications')}
        onProfilePress={() => router.push('/profile')}
      />
      <ScrollView
        testID={KAIZEN_SCREEN_SCROLL_TEST_ID}
        style={kaizenScrollViewStyle.scroll}
        contentContainerStyle={[
          styles.content,
          kaizenScrollViewStyle.contentGrow,
          isTablet && styles.readingWidth,
          {
            paddingBottom: Spacing.xxl + insets.bottom + TAB_BAR_CONTENT_HEIGHT,
          },
        ]}
        // "handled" alone only fixes dismissal — it never MOVES the focused
        // field, so a form low on a Kaizen screen stayed behind the keypad.
        // `automaticallyAdjustKeyboardInsets` (bundled here) is the half that
        // actually scrolls it back into view. See `@utils/keyboard`.
        {...keyboardDismissScrollProps}
        showsVerticalScrollIndicator={false}
      >
        {showBodyTitle ? (
          <Text
            style={[
              styles.title,
              {
                color: colors.textPrimary,
                fontSize: Typography.display.size,
                lineHeight: Typography.display.lineHeight,
                fontWeight: Typography.display.weight,
                letterSpacing: Typography.display.letterSpacing,
              },
            ]}
          >
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text
            style={[
              styles.subtitle,
              {
                color: colors.textSecondary,
                fontSize: Typography.body.size,
                lineHeight: Typography.body.lineHeight,
              },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
        {children}
        <ScreenScrollEnd testID={screenScrollEndTestId(screenTestId ?? 'kaizen-screen')} />
      </ScrollView>
      </View>
    </BrandBackground>
  );
}

export function Section({
  title,
  children,
  testID,
}: {
  title: string;
  children: ReactNode;
  /** Maestro anchor for below-the-fold section headers (title renders uppercase). */
  testID?: string;
}) {
  const colors = useAppColors();
  const sectionHeaderLabel = title.toUpperCase();
  return (
    <View style={styles.section} testID={testID}>
      <Text
        accessibilityRole="header"
        accessibilityLabel={sectionHeaderLabel}
        style={[styles.sectionTitle, { color: colors.textSecondary }]}
      >
        {title}
      </Text>
      <GlassCard padding={0} radius={20}>
        {children}
      </GlassCard>
    </View>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  const colors = useAppColors();
  return <Text style={[styles.empty, { color: colors.textSecondary }]}>{children}</Text>;
}

export function parseSystems(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export const kaizenStyles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 58,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.smd,
  },
  rowText: { flex: 1, fontSize: Typography.body.size, fontWeight: '500' },
  detail: { fontSize: Typography.caption.size, marginTop: 3 },
  badge: { borderRadius: 10, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});

const styles = StyleSheet.create({
  screenRoot: { flex: 1 },
  content: { padding: Layout.pageMargin, width: '100%', gap: Spacing.md },
  /** iPad: cap reading width so forms/chips aren't a stretched iPhone layout. */
  readingWidth: {
    maxWidth: Layout.readingMaxWidth,
    alignSelf: 'center',
  },
  title: { marginBottom: 0 },
  subtitle: { marginTop: Spacing.sm - Spacing.xxs, marginBottom: Spacing.xs },
  section: { marginTop: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    textTransform: 'uppercase',
  },
  empty: {
    fontSize: Typography.label.size,
    lineHeight: Typography.body.lineHeight,
    padding: Spacing.base,
    textAlign: 'center',
  },
});
