import { isLiquidGlassSupported } from '@callstack/liquid-glass';
import { Host, Button, HStack, Text, Spacer, Divider, VStack } from '@expo/ui/swift-ui';
import { buttonStyle, tint } from '@expo/ui/swift-ui/modifiers';
import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'sf-symbols-typescript';

import { useAppColors } from '@theme';

interface NavigationButton {
  icon: SFSymbol;
  label?: string;
  onPress: () => void;
}

interface SwiftUINavigationBarProps {
  title: string;
  leftButton?: NavigationButton;
  rightButton?: NavigationButton;
  transparent?: boolean;
}

export function SwiftUINavigationBar({
  title,
  leftButton,
  rightButton,
  transparent = false,
}: SwiftUINavigationBarProps) {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const useSwiftUI = Platform.OS === 'ios' && isLiquidGlassSupported;

  if (!useSwiftUI) {
    return null; // Fallback to default navigation or custom header
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Host style={styles.hostContainer}>
        <VStack spacing={0}>
          <HStack spacing={12} alignment="center">
            {/* Left Button */}
            {leftButton ? (
              <Button
                systemImage={leftButton.icon}
                onPress={leftButton.onPress}
                label={leftButton.label}
                modifiers={[buttonStyle('plain'), tint(colors.primary)]}
              />
            ) : (
              <Spacer />
            )}

            {/* Title */}
            <Text>{title}</Text>

            <Spacer />

            {/* Right Button */}
            {rightButton ? (
              <Button
                systemImage={rightButton.icon}
                onPress={rightButton.onPress}
                label={rightButton.label}
                modifiers={[buttonStyle('plain'), tint(colors.primary)]}
              />
            ) : (
              <Spacer />
            )}
          </HStack>

          {!transparent && <Divider />}
        </VStack>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  hostContainer: {
    height: 44,
    alignSelf: 'stretch',
  },
});
