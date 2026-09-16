import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Platform, Text, ScrollView } from 'react-native';

import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import {
  Chat,
  CornerRadius,
  Elevation,
  Opacity,
  Spacing,
  TypographyTokens,
  useAppColors,
} from '@theme';

import { Typography as Typo } from './Typography';

/** True when the icon is an Ionicon glyph name rather than an emoji. */
function isIoniconName(icon: string): icon is keyof typeof Ionicons.glyphMap {
  return icon in Ionicons.glyphMap;
}

export interface FilterTab {
  id: string;
  label: string;
  /** Optional leading icon — an Ionicon glyph name (preferred) or an emoji. */
  icon?: string;
  /** Optional count badge */
  count?: number;
}

interface FilterTabsProps {
  tabs: FilterTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  /** Show active indicator dot for first tab when active (default: true) */
  showActiveIndicator?: boolean;
  /** Active color for indicator and count badge (defaults to theme.pastel.teal) */
  activeColor?: string;
  /** Enable horizontal scrolling for many tabs (default: false) */
  scrollable?: boolean;
}

/**
 * Reusable segmented filter tabs component
 * Provides consistent styling across the app for filter controls
 */
export function FilterTabs({
  tabs,
  activeTab,
  onTabChange,
  showActiveIndicator = true,
  activeColor,
  scrollable = false,
}: FilterTabsProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const accentColor = activeColor || theme.pastel.teal;

  const activeTabShadow = Platform.select({
    ios: {
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: Opacity.tabThumb,
      shadowRadius: 4,
    },
    android: {
      elevation: Elevation.floating,
    },
  });

  /**
   * Scrollable mode used to leave the strip hugging its labels on the left of a
   * wide screen. Flex alone cannot fix that: a horizontal ScrollView measures
   * its content on an UNBOUNDED main axis, so there is no free space for
   * `flexGrow` to hand out and every tab stays at its natural width no matter
   * what it asks for. The only thing that reaches Yoga is an explicit width —
   * hence the measurement below.
   *
   * `viewport` is what the ScrollView offers; `measured` is the strip's natural
   * width. When the tabs FIT we pin the row to the viewport and let them share
   * it; when they don't we leave it alone and it scrolls, which is the whole
   * point of scrollable mode.
   *
   * The measurement is keyed by a signature of the TABS ALONE — never by the
   * viewport. `onContentSizeChange` fires once, before `onLayout` has reported
   * a viewport; folding the viewport into the key invalidates that reading the
   * moment layout lands, and nothing ever re-measures because the content size
   * itself has not changed. Keyed on the tabs, a rotation just re-decides
   * against the width already on file.
   */
  const [viewport, setViewport] = useState(0);
  const [measured, setMeasured] = useState<{ signature: string; width: number } | null>(null);

  const signature = tabs
    .map((t) => `${t.id}~${t.label}~${t.icon ?? ''}~${t.count ?? ''}`)
    .join(',');
  const naturalWidth = measured?.signature === signature ? measured.width : null;
  const stretch = scrollable && viewport > 0 && naturalWidth !== null && naturalWidth <= viewport;

  const renderTabs = () => (
    <View
      testID="filter-tabs-row"
      style={[
        styles.container,
        { backgroundColor: colors.secondaryButtonBackground },
        scrollable && styles.containerScrollable,
        stretch && { width: viewport },
      ]}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab;
        const showDot = showActiveIndicator && index === 0 && isActive && !tab.icon;

        return (
          <TouchableOpacity
            key={tab.id}
            testID={`filter-tab-${tab.id}`}
            style={[
              styles.tab,
              scrollable && (stretch ? styles.tabStretched : styles.tabScrollable),
              isActive && { backgroundColor: colors.segmentActiveBackground, ...activeTabShadow },
            ]}
            onPress={() => onTabChange(tab.id)}
            activeOpacity={0.7}
          >
            {showDot && (
              <View style={[styles.indicatorDot, { backgroundColor: accentColor }]} />
            )}

            {tab.icon &&
              (isIoniconName(tab.icon) ? (
                <Icon
                  name={tab.icon}
                  size={TypographyTokens.bodySmall.size + 2}
                  color={isActive ? colors.textPrimary : colors.textSecondary}
                />
              ) : (
                <Text style={styles.icon}>{tab.icon}</Text>
              ))}

            <Typo
              variant="caption1"
              weight={isActive ? 'semibold' : 'medium'}
              color={isActive ? colors.textPrimary : colors.textSecondary}
              // Full-width segmented tabs share the row via flex:1, so a long
              // label ("Overview", "Payments") must stay on one line and shrink
              // to fit rather than wrap mid-word. In scrollable mode the tab is
              // content-sized, so this is a no-op there.
              numberOfLines={1}
              adjustsFontSizeToFit={!scrollable}
              minimumFontScale={0.8}
              style={scrollable ? styles.tabLabelNoWrap : undefined}
            >
              {tab.label}
            </Typo>

            {tab.count !== undefined && tab.count > 0 && (
              <View
                style={[
                  styles.countBadge,
                  {
                    backgroundColor: isActive
                      ? `${accentColor}25`
                      : colors.secondaryButtonBackground,
                  },
                ]}
              >
                <Typo
                  variant="caption2"
                  weight="bold"
                  color={isActive ? accentColor : colors.textTertiary}
                >
                  {tab.count}
                </Typo>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          setViewport((prev) => (Math.abs(prev - w) < 1 ? prev : w));
        }}
        onContentSizeChange={(w) => {
          // Once stretched, the content IS the viewport — recording that would
          // overwrite the natural width with the answer instead of the input.
          if (stretch) return;
          setMeasured((prev) =>
            prev && prev.signature === signature && Math.abs(prev.width - w) < 1
              ? prev
              : { signature, width: w }
          );
        }}
      >
        {renderTabs()}
      </ScrollView>
    );
  }

  return renderTabs();
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: Spacing.smd,
    padding: Spacing.inset3,
  },
  containerScrollable: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
  },
  scrollContent: {
    flexGrow: 1,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.sm,
    borderRadius: CornerRadius.sm,
    gap: Spacing.gapTight5,
  },
  tabScrollable: {
    flex: 0,
    paddingHorizontal: Spacing.smd + Spacing.xs,
  },
  /** Only ever applied once the row has a measured, definite width (see
   *  `stretch`): natural label width as the floor, leftover shared equally, so
   *  a tab can never be squeezed below its own label. */
  tabStretched: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    paddingHorizontal: Spacing.smd + Spacing.xs,
  },
  tabLabelNoWrap: {
    flexShrink: 0,
  },
  icon: {
    fontSize: TypographyTokens.bodySmall.size,
  },
  indicatorDot: {
    width: Chat.assistantPriorityDotSize,
    height: Chat.assistantPriorityDotSize,
    borderRadius: Chat.assistantPriorityDotSize / 2,
  },
  countBadge: {
    paddingHorizontal: Chat.compactGap,
    paddingVertical: Spacing.xxs,
    borderRadius: Spacing.smd,
    minWidth: Spacing.lg,
    alignItems: 'center',
  },
});
