/**
 * Shared floating chat button — a circular, bottom-right FAB that opens an app's
 * household chat. Mounted app-wide for apps that present chat as a FAB (e.g.
 * Budget) rather than a tab. It floats above the tab bar and shows an unread
 * badge sourced from the app's chat store. Which chat it opens + counts is
 * driven entirely by the {@link ChatConfig}; colors come from the brand theme.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@components/ui/Icon';
import { useAppStore } from '@stores/appStore';
import { getButtonGradientColors, hexToRgba, useAppColors } from '@theme';

import type { ChatConfig } from './ChatConfig';
import { selectTotalUnread } from './createChatStore';

export function ChatFab({ config }: { config: ChatConfig }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const accentScheme = useAppStore((s) => s.accentScheme);
  const unread = config.store(selectTotalUnread);

  return (
    <View
      // Sits above the floating tab-bar capsule (which hugs the bottom-center)
      // on the right edge. `box-none` so only the button itself is tappable.
      style={[styles.container, { bottom: insets.bottom + 92 }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => router.push(config.route.host)}
        testID="budget-chat-fab"
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? `Open chat, ${unread} unread` : 'Open chat'}
        style={({ pressed }) => [
          styles.fab,
          {
            shadowColor: colors.primaryDark ?? colors.primary ?? colors.textPrimary,
            opacity: pressed ? 0.92 : 1,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          },
        ]}
      >
        {/* Main brand CTA gradient (left → right), clipped to the circle. */}
        <LinearGradient
          colors={getButtonGradientColors('primary', { schemeId: accentScheme })}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        />
        <Icon name="chat" filled size={26} testID="budget-chat-fab-icon" />
        {unread > 0 && (
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.error, borderColor: hexToRgba(colors.white, 0.9) },
            ]}
          >
            <Text style={[styles.badgeText, { color: colors.white }]} numberOfLines={1}>
              {unread > 99 ? '99+' : unread}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 18,
    zIndex: 10000,
    // Keep above the tab-bar's own zIndex (9999) so it's always tappable.
    elevation: 10,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    // Stronger, brand-tinted shadow so the FAB lifts off any tab/background.
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 14,
  },
  gradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 28,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});
