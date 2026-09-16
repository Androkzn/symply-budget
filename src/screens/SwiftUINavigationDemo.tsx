import {
  Host,
  Button,
  VStack,
  HStack,
  Text,
  GlassEffectContainer,
  Section,
  Divider,
  Spacer,
} from '@expo/ui/swift-ui';
import { buttonStyle, tint } from '@expo/ui/swift-ui/modifiers';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppColors } from '@theme';

/**
 * SwiftUI Navigation Demo Screen
 *
 * Demonstrates complete SwiftUI-based navigation with:
 * - Navigation bar (header) with buttons
 * - Glass effect buttons
 * - Bottom sheet menu
 * - Context-aware UI
 */
export function SwiftUINavigationDemo() {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {/* SwiftUI Navigation Bar */}
      <Host
        style={[
          styles.navBarHost,
          { paddingTop: insets.top, backgroundColor: 'rgba(255, 255, 255, 0.03)' },
        ]}
      >
        <VStack spacing={0}>
          <HStack spacing={16} alignment="center">
            {/* Left Navigation Button */}
            <Button
              systemImage="chevron.left"
              onPress={() => console.log('Back')}
              label="Back"
              modifiers={[buttonStyle('plain'), tint(colors.primary)]}
            />

            <Spacer />

            {/* Title */}
            <Text>Navigation Demo</Text>

            <Spacer />

            {/* Right Navigation Button */}
            <Button
              systemImage="ellipsis.circle"
              onPress={() => setShowMenu(!showMenu)}
              modifiers={[buttonStyle('plain'), tint(colors.primary)]}
            />
          </HStack>
          <Divider />
        </VStack>
      </Host>

      {/* Main Content with SwiftUI Components */}
      <Host style={styles.contentHost}>
        <VStack spacing={20}>
          <Section>
            <Text>Glass Effect Navigation</Text>

            {/* Glass Button Group */}
            <GlassEffectContainer spacing={12}>
              <HStack spacing={12}>
                <Button
                  systemImage="house.fill"
                  onPress={() => console.log('Home')}
                  label="Home"
                  modifiers={[buttonStyle('glass'), tint(colors.primary)]}
                />
                <Button
                  systemImage="gearshape.fill"
                  onPress={() => console.log('Settings')}
                  label="Settings"
                  modifiers={[buttonStyle('glass'), tint(colors.textTertiary)]}
                />
              </HStack>
            </GlassEffectContainer>
          </Section>

          <Divider />

          <Section>
            <Text>Button Variants</Text>

            <VStack spacing={12}>
              {/* Default Button */}
              <Button
                systemImage="star.fill"
                onPress={() => console.log('Bordered')}
                label="Bordered Button"
                modifiers={[buttonStyle('bordered')]}
              />

              {/* Prominent Button */}
              <Button
                systemImage="heart.fill"
                onPress={() => console.log('Prominent')}
                label="Prominent Button"
                modifiers={[buttonStyle('borderedProminent'), tint(colors.error)]}
              />

              {/* Glass Prominent (iOS 26+) */}
              <Button
                systemImage="sparkles"
                onPress={() => console.log('Glass Prominent')}
                label="Glass Prominent"
                modifiers={[buttonStyle('glassProminent'), tint(colors.primary)]}
              />

              {/* Plain Button */}
              <Button
                systemImage="info.circle"
                onPress={() => console.log('Plain')}
                label="Plain Button"
                modifiers={[buttonStyle('plain')]}
              />
            </VStack>
          </Section>
        </VStack>
      </Host>

      {/* Bottom Menu Sheet (SwiftUI) */}
      {showMenu && (
        <View style={[styles.menuOverlay, { paddingBottom: insets.bottom + 16 }]}>
          <Host style={styles.menuHost}>
            <GlassEffectContainer spacing={8}>
              <VStack spacing={8}>
                <Button
                  systemImage="square.and.arrow.up"
                  onPress={() => {
                    console.log('Share');
                    setShowMenu(false);
                  }}
                  label="Share"
                  modifiers={[buttonStyle('glass')]}
                />
                <Button
                  systemImage="bookmark"
                  onPress={() => {
                    console.log('Bookmark');
                    setShowMenu(false);
                  }}
                  label="Bookmark"
                  modifiers={[buttonStyle('glass')]}
                />
                <Button
                  systemImage="trash"
                  onPress={() => {
                    console.log('Delete');
                    setShowMenu(false);
                  }}
                  role="destructive"
                  label="Delete"
                  modifiers={[buttonStyle('glass'), tint(colors.error)]}
                />
              </VStack>
            </GlassEffectContainer>
          </Host>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navBarHost: {
    height: 100,
    alignSelf: 'stretch',
  },
  contentHost: {
    flex: 1,
    padding: 20,
  },
  menuOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  menuHost: {
    minHeight: 200,
    alignSelf: 'stretch',
  },
});
