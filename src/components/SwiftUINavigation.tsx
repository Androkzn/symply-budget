import { Host, Button, VStack, HStack, Text, Divider } from '@expo/ui/swift-ui';
import { background, buttonStyle, tint } from '@expo/ui/swift-ui/modifiers';
import React from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'sf-symbols-typescript';

import { useAppColors } from '@theme';

// SwiftUI Navigation Bar (Header)
interface NavigationBarProps {
  title: string;
  leftButton?: {
    icon: SFSymbol;
    label?: string;
    onPress: () => void;
  };
  rightButton?: {
    icon: SFSymbol;
    label?: string;
    onPress: () => void;
  };
  transparent?: boolean;
}

export function NavigationBar({
  title,
  leftButton,
  rightButton,
  transparent = false,
}: NavigationBarProps) {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();

  return (
    <Host style={[styles.navBarHost, { paddingTop: insets.top }]}>
      <VStack spacing={0}>
        <HStack
          spacing={12}
          alignment="center"
          modifiers={transparent ? undefined : [background('#FFFFFF08')]}
        >
          {/* Left Button */}
          {leftButton ? (
            <Button
              systemImage={leftButton.icon}
              onPress={leftButton.onPress}
              label={leftButton.label}
              modifiers={[buttonStyle('plain'), tint(colors.primary)]}
            />
          ) : (
            <Host style={styles.spacer}>{null}</Host>
          )}

          {/* Title */}
          <Text modifiers={[{ $type: 'fontWeight', weight: 'semibold' }]}>
            {title}
          </Text>

          {/* Right Button */}
          {rightButton ? (
            <Button
              systemImage={rightButton.icon}
              onPress={rightButton.onPress}
              label={rightButton.label}
              modifiers={[buttonStyle('plain'), tint(colors.primary)]}
            />
          ) : (
            <Host style={styles.spacer}>{null}</Host>
          )}
        </HStack>

        {!transparent && <Divider />}
      </VStack>
    </Host>
  );
}

// SwiftUI Glass Navigation Button
interface GlassNavButtonProps {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  variant?: 'glass' | 'glassProminent' | 'bordered' | 'plain';
  active?: boolean;
}

export function GlassNavButton({
  icon,
  label,
  onPress,
  variant = 'glass',
  active = false,
}: GlassNavButtonProps) {
  const colors = useAppColors();
  return (
    <Host style={styles.glassButtonHost}>
      <Button
        systemImage={icon}
        onPress={onPress}
        label={label}
        modifiers={[buttonStyle(variant), tint(active ? colors.accent : colors.textSecondary)]}
      />
    </Host>
  );
}

// SwiftUI Context Menu Button
interface ContextMenuButtonProps {
  icon: SFSymbol;
  label?: string;
  variant?: 'glass' | 'bordered' | 'plain';
  children?: React.ReactNode;
}

export function ContextMenuButton({
  icon,
  label,
  variant = 'plain',
}: ContextMenuButtonProps) {
  const colors = useAppColors();
  // Note: Full ContextMenu support requires the ContextMenu component from @expo/ui
  return (
    <Host style={styles.contextMenuHost}>
      <Button
        systemImage={icon}
        label={label}
        modifiers={[buttonStyle(variant), tint(colors.primary)]}
      />
    </Host>
  );
}

// SwiftUI Bottom Sheet Navigation
interface BottomSheetNavProps {
  isPresented: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}

export function BottomSheetNav({
  isPresented,
  onDismiss: _onDismiss,
  children,
}: BottomSheetNavProps) {
  if (!isPresented) return null;

  return (
    <Host style={styles.bottomSheetHost}>
      <VStack spacing={16}>{children}</VStack>
    </Host>
  );
}

const styles = StyleSheet.create({
  navBarHost: {
    height: 100,
    alignSelf: 'stretch',
  },
  spacer: {
    width: 44,
  },
  glassButtonHost: {
    height: 44,
  },
  contextMenuHost: {
    height: 44,
  },
  bottomSheetHost: {
    minHeight: 200,
    alignSelf: 'stretch',
  },
});
