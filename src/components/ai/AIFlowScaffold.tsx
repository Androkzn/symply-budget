/**
 * AIFlowScaffold — the shared branded chrome for the BYOK "connect your AI"
 * flow so every step (choose provider → connect key → choose model) shares one
 * premium layout: the app's `AppBackground`, a compact top bar with back / skip,
 * an iPad-safe reading column, a scrolling body, and a sticky footer CTA.
 *
 * Deliberately no step progress bar. These screens are reached from Settings /
 * More as often as from first run, and each one stands on its own (a member
 * accepting a shared key never sees steps 2–3 at all), so a "1 of 3" bar
 * promised a wizard the flow does not actually run.
 *
 * Brand-neutral: it pulls colours from the active theme, so House / Budget /
 * Kaizen / Health each render it in their own palette.
 */

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppBackground,
  BackButton,
  SafeAreaView,
  ScreenFooterGlass,
  ScreenScrollEnd,
  screenScrollEndTestId,
} from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

interface AIFlowScaffoldProps {
  /** Big in-body title (the native header is hidden for a full-bleed look). */
  title?: string;
  /** Sub-title under the title. */
  subtitle?: string;
  /** Show a "Skip" affordance in the top-right (first-run onboarding only). */
  onSkip?: () => void;
  /** Sticky footer content (usually the primary CTA). */
  footer?: React.ReactNode;
  /** Whether tapping back is allowed (default true). */
  canGoBack?: boolean;
  /** Optional root testID for Maestro (e.g. ai-access-screen). */
  screenTestID?: string;
  children: React.ReactNode;
}

export function AIFlowScaffold({
  title,
  subtitle,
  onSkip,
  footer,
  canGoBack = true,
  screenTestID,
  children,
}: AIFlowScaffoldProps) {
  const colors = useAppColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { content: containerPadding } = useLayoutPadding();

  // Height of the floating footer so the scroll body can flow all the way under
  // it (nothing is permanently hidden behind the CTA — it just fades out).
  const [footerHeight, setFooterHeight] = useState(0);

  return (
    <AppBackground opacity={0.5}>
      {/* Top inset only. The footer glass is bottom-anchored and must reach the
          PHYSICAL bottom edge: with `edges={['top','bottom']}` the safe area
          padded this container, so `bottom: 0` landed above the home indicator
          and left a strip of bare background showing under the CTA — the footer
          read as transparent instead of as the app's standard bottom material.
          Every other pinned-CTA screen (TaskDrafts, MaintenanceSetup, …) paints
          its glass to the edge and pays the inset as footer padding; so does
          this one now, and the scroll body adds it back when there is no
          footer to do it. */}
      <SafeAreaView style={styles.safe} edges={['top']} testID={screenTestID}>
        {/* Standard header: back (left) · centered title · optional skip (right).
            The side columns are equal fixed widths so the title stays optically
            centered regardless of whether Skip is shown.

            The leading control is the shared `BackButton`, not a local circular
            Pressable: these screens are reachable from the More list alongside
            screens that draw `ScreenHeader`, and a second back affordance with
            its own fill, size and test id made that one list lead to two
            different-looking headers. One component, one `nav-back-button`. */}
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {canGoBack ? <BackButton onPress={() => router.back()} size="md" /> : null}
          </View>

          <View style={styles.headerCenter}>
            {title ? (
              <Typography
                variant="headline"
                weight="semibold"
                numberOfLines={1}
                align="center"
                color={colors.textPrimary}
              >
                {title}
              </Typography>
            ) : null}
          </View>

          <View style={[styles.headerSide, styles.headerSideRight]}>
            {onSkip ? (
              <Pressable onPress={onSkip} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip">
                <Typography variant="footnote" weight="medium" color={colors.textSecondary}>
                  Skip
                </Typography>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* `style={styles.scrollColumn}` (flex: 1) is required: AdaptiveContainer
            defaults to `flexBasis: 'auto'` (content-sizing, for when it sits
            INSIDE a ScrollView). Here it is the PARENT of the ScrollView, which
            needs a bounded height — without this override the container grows to
            the full content height and nothing scrolls. */}
        <AdaptiveContainer width="reading" padding={0} style={styles.scrollColumn}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingHorizontal: containerPadding },
              // Leave room so the last item can scroll clear of the floating CTA
              // (whose own height already covers the bottom inset). Without a
              // footer the body owes that inset itself.
              footer
                ? { paddingBottom: footerHeight + 16 }
                : { paddingBottom: insets.bottom + 24 },
            ]}
            // The BYOK steps host the API-key field, which sits well down the
            // body: `keyboardShouldPersistTaps` alone let the keypad open ON TOP
            // of it. `automaticallyAdjustKeyboardInsets` (bundled here) is the
            // half that actually scrolls the focused field back into view.
            {...keyboardDismissScrollProps}
            showsVerticalScrollIndicator={false}
          >
            {/* The screen title now lives in the centered header above; the
                subtitle reads as the first body paragraph under it. */}
            {subtitle ? (
              <Typography variant="body" color={colors.textSecondary} style={styles.subtitle}>
                {subtitle}
              </Typography>
            ) : null}

            {children}
            <ScreenScrollEnd testID={screenScrollEndTestId('ai-flow-scaffold')} />
          </ScrollView>
        </AdaptiveContainer>

        {footer ? (
          <View
            style={styles.footerOverlay}
            pointerEvents="box-none"
            testID="ai-flow-footer"
            onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
          >
            {/* Shared bottom-glass scrim — the same blur + `surface`-token
                gradient recipe as the floating tab bar, so every sticky footer
                in the app reads identically to the bottom nav. The blur band
                grows with the home-indicator inset so the frosted part still
                sits under the button rather than stopping short of it. */}
            <ScreenFooterGlass blurHeight={56 + insets.bottom} />
            <AdaptiveContainer width="reading" padding={0}>
              <View
                style={[
                  styles.footer,
                  { paddingHorizontal: containerPadding, paddingBottom: insets.bottom + 12 },
                ]}
              >
                {footer}
              </View>
            </AdaptiveContainer>
          </View>
        ) : null}
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    minHeight: 44,
  },
  // Equal fixed side columns keep the centered title optically centered whether
  // or not the Skip affordance is present.
  headerSide: {
    width: 60,
    justifyContent: 'center',
  },
  headerSideRight: {
    alignItems: 'flex-end',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 8,
  },
  scrollColumn: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    // The progress bar used to supply the gap under the header; without it the
    // subtitle crowded the title, so the body pays that spacing itself.
    paddingTop: 16,
    paddingBottom: 24,
    gap: 14,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 4,
    lineHeight: 22,
  },
  footerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Tall enough that the fade begins well above the CTA, so the top edge of
    // the blur reads as transparent rather than a hard line over the content.
    paddingTop: 32,
    overflow: 'hidden',
  },
  // `paddingBottom` is applied inline (safe-area inset) — see the footer above.
  footer: {
    paddingTop: 12,
    gap: 12,
  },
});
