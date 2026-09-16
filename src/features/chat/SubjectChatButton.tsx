/**
 * "Chat" on a project or a material — the one control both screens use.
 *
 * Header-mounted rather than a section inside the screen, and that is a
 * deliberate call rather than a shortcut. A chat is a scrolling, keyboard-owning
 * surface; embedding one in a hub that already scrolls nine sections puts two
 * scroll views and a keyboard in a fight the keyboard always wins. Surface
 * Studio is its own screen for the same reason. What the hub owes the member is
 * a way IN that is visible from every section, plus the fact that someone has
 * said something — which is the badge.
 *
 * The badge is the point. Without it, a chat attached to a material is a room
 * nobody visits: there is no reason to tap a bubble that might be empty. With
 * it, the project hub tells you where the conversation is happening.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { HeaderActionButton } from '@components/common';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { Header, Spacing, useAppColors } from '@theme';

import type { ChatConfig } from './ChatConfig';
import type { ChatRoom } from './types';
import { useSubjectChat, type SubjectChatTarget } from './useSubjectChat';

interface SubjectChatButtonProps {
  config: ChatConfig;
  /** What this chat is about. Null disables the button (nothing loaded yet). */
  target: SubjectChatTarget | null;
  /** Called with the opened room — the caller decides where to navigate. */
  onOpened: (room: ChatRoom) => void;
  testID?: string;
  accessibilityLabel?: string;
}

export function SubjectChatButton({
  config,
  target,
  onOpened,
  testID = 'subject-chat-button',
  accessibilityLabel = 'Open chat',
}: SubjectChatButtonProps) {
  const colors = useAppColors();
  const { unreadCount, isOpening, open } = useSubjectChat(config, target);

  return (
    <View style={styles.wrap}>
      <HeaderActionButton
        iconOnly
        disabled={!target || isOpening}
        onPress={async () => {
          const room = await open();
          if (room) onOpened(room);
        }}
        testID={testID}
        accessibilityLabel={
          unreadCount > 0 ? `${accessibilityLabel}, ${unreadCount} unread` : accessibilityLabel
        }
      >
        {isOpening ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Icon
            name="chatbubbles-outline"
            size={Header.actionIconSize}
            color={colors.primary}
          />
        )}
      </HeaderActionButton>
      {unreadCount > 0 && !isOpening && (
        <View
          testID={`${testID}-unread`}
          pointerEvents="none"
          style={[
            styles.badge,
            // Ringed in the header's own colour so the badge reads as sitting
            // ON the button rather than merging into its tinted circle.
            { backgroundColor: colors.primary, borderColor: colors.backgroundHeader },
          ]}
        >
          <Typography variant="caption2" color={colors.white} weight="bold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </Typography>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -Spacing.xxs,
    right: -Spacing.xxs,
    minWidth: Spacing.base,
    height: Spacing.base,
    borderRadius: Spacing.base / 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: Spacing.xxs,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SubjectChatButton;
