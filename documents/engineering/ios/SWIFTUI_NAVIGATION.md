# SwiftUI Navigation with @expo/ui

This guide explains how to implement complete SwiftUI-based navigation in your React Native app using `@expo/ui`.

## Overview

The `@expo/ui` package provides native SwiftUI components that run on iOS 26+. This enables you to create modern, performant UIs with native liquid glass effects, buttons, and layouts.

## Installation

```bash
npx expo install @expo/ui
npm install sf-symbols-typescript
```

## Available SwiftUI Components

### Layout Components
- `Host` - Required container for all SwiftUI views
- `VStack` - Vertical stack layout
- `HStack` - Horizontal stack layout
- `ZStack` - Layered stack layout
- `Group` - Logical grouping without visual effects
- `Spacer` - Flexible space

### UI Components
- `Button` - Native SwiftUI button with variants
- `Text` - Native text rendering
- `Image` - Native image views
- `Divider` - Visual separators
- `Section` - Content sections
- `GlassEffectContainer` - iOS 26 liquid glass container

### Button Variants
- `glass` - Liquid glass button (iOS 26+)
- `glassProminent` - Prominent glass button (iOS 26+)
- `bordered` - Light filled button
- `borderedProminent` - Prominent filled button
- `borderless` - No background/border
- `plain` - Minimal styling
- `default` - System default

## Navigation Patterns

### 1. Tab Bar Navigation

```tsx
import { Host, Button, GlassEffectContainer, HStack } from '@expo/ui/swift-ui';
import type { SFSymbol } from 'sf-symbols-typescript';

function NativeTabBar() {
  return (
    <View style={styles.container}>
      <Host style={styles.host}>
        <GlassEffectContainer spacing={8}>
          <HStack spacing={8}>
            <Button
              variant="glass"
              systemImage="house.fill"
              onPress={() => navigate('Home')}
              color="#007AFF"
            >
              Home
            </Button>
            <Button
              variant="glass"
              systemImage="gearshape.fill"
              onPress={() => navigate('Settings')}
              color="#8E8E93"
            >
              Settings
            </Button>
          </HStack>
        </GlassEffectContainer>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: insets.bottom + 8,
  },
  host: {
    height: 60,
    alignSelf: 'stretch',
  },
});
```

### 2. Navigation Bar (Header)

```tsx
import { Host, Button, VStack, HStack, Text, Divider, Spacer } from '@expo/ui/swift-ui';

function NavigationBar({ title, onBack, onMenu }) {
  const insets = useSafeAreaInsets();

  return (
    <Host style={[styles.navBarHost, { paddingTop: insets.top }]}>
      <VStack spacing={0}>
        <HStack spacing={16} alignment="center">
          {/* Left Button */}
          <Button
            variant="plain"
            systemImage="chevron.left"
            onPress={onBack}
            color="#007AFF"
          >
            Back
          </Button>

          <Spacer />

          {/* Title */}
          <Text>{title}</Text>

          <Spacer />

          {/* Right Button */}
          <Button
            variant="plain"
            systemImage="ellipsis.circle"
            onPress={onMenu}
            color="#007AFF"
          />
        </HStack>
        <Divider />
      </VStack>
    </Host>
  );
}
```

### 3. Bottom Sheet Menu

```tsx
function BottomSheetMenu({ isVisible, onClose }) {
  const insets = useSafeAreaInsets();

  if (!isVisible) return null;

  return (
    <View style={[styles.overlay, { paddingBottom: insets.bottom + 16 }]}>
      <Host style={styles.menuHost}>
        <GlassEffectContainer spacing={8}>
          <VStack spacing={8}>
            <Button
              variant="glass"
              systemImage="square.and.arrow.up"
              onPress={() => {
                handleShare();
                onClose();
              }}
            >
              Share
            </Button>
            <Button
              variant="glass"
              systemImage="bookmark"
              onPress={() => {
                handleBookmark();
                onClose();
              }}
            >
              Bookmark
            </Button>
            <Button
              variant="glass"
              systemImage="trash"
              onPress={() => {
                handleDelete();
                onClose();
              }}
              color="#FF3B30"
              role="destructive"
            >
              Delete
            </Button>
          </VStack>
        </GlassEffectContainer>
      </Host>
    </View>
  );
}
```

### 4. Context Menu Buttons

```tsx
function ContextMenuButton() {
  return (
    <Host>
      <Button
        variant="plain"
        systemImage="ellipsis"
        color="#007AFF"
      />
    </Host>
  );
}
```

## SF Symbols

Use SF Symbols for native iOS icons:

```tsx
// Common Navigation Icons
'house' | 'house.fill'                    // Home
'gearshape' | 'gearshape.fill'           // Settings
'bell' | 'bell.fill'                     // Notifications
'person' | 'person.fill'                 // Profile
'magnifyingglass'                        // Search
'plus' | 'plus.circle.fill'              // Add
'chevron.left' | 'chevron.right'         // Navigation
'ellipsis' | 'ellipsis.circle'           // More menu
'square.and.arrow.up'                    // Share
'bookmark' | 'bookmark.fill'             // Bookmark
'trash' | 'trash.fill'                   // Delete
'checkmark.circle' | 'checkmark.circle.fill' // Complete
```

See [SF Symbols](https://developer.apple.com/sf-symbols/) for the full list.

## Modifiers

Apply SwiftUI modifiers to components:

```tsx
import { foregroundStyle, padding, cornerRadius } from '@expo/ui/swift-ui/modifiers';

<Button
  variant="glass"
  systemImage="star"
  modifiers={[
    padding({ all: 16 }),
    cornerRadius(12),
    foregroundStyle('#007AFF'),
  ]}
>
  Styled Button
</Button>
```

## Best Practices

1. **Always use Host** - Wrap all SwiftUI components in `<Host>`
2. **Prefer Glass Variants** - On iOS 26+, use `glass` and `glassProminent` for modern UI
3. **Use SF Symbols** - Native icons integrate better than custom images
4. **Container Spacing** - Use `GlassEffectContainer` with `spacing` prop for glass buttons
5. **Safe Areas** - Always handle safe area insets for navigation bars and tab bars
6. **Fallback UI** - Provide fallback for older iOS versions

## Example: Complete Screen

```tsx
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Host,
  Button,
  VStack,
  HStack,
  Text,
  GlassEffectContainer,
  Divider,
  Spacer,
} from '@expo/ui/swift-ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function MyScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <View style={styles.container}>
      {/* Navigation Bar */}
      <Host style={[styles.navBar, { paddingTop: insets.top }]}>
        <VStack spacing={0}>
          <HStack spacing={16} alignment="center">
            <Button
              variant="plain"
              systemImage="chevron.left"
              onPress={() => navigation.goBack()}
              color="#007AFF"
            >
              Back
            </Button>
            <Spacer />
            <Text>My Screen</Text>
            <Spacer />
            <Button
              variant="plain"
              systemImage="ellipsis.circle"
              onPress={() => setShowMenu(true)}
              color="#007AFF"
            />
          </HStack>
          <Divider />
        </VStack>
      </Host>

      {/* Content */}
      <Host style={styles.content}>
        <VStack spacing={20}>
          <GlassEffectContainer spacing={12}>
            <HStack spacing={12}>
              <Button variant="glass" systemImage="star.fill">
                Favorite
              </Button>
              <Button variant="glass" systemImage="square.and.arrow.up">
                Share
              </Button>
            </HStack>
          </GlassEffectContainer>
        </VStack>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  navBar: {
    height: 100,
    alignSelf: 'stretch',
  },
  content: {
    flex: 1,
    padding: 20,
  },
});
```

## Troubleshooting

### SwiftUI components not showing
- Ensure `Host` wraps all SwiftUI components
- Check that you're running on iOS 26+ for glass effects
- Verify `@expo/ui` is installed and linked

### Glass effects not working
- Requires iOS 26+ and Xcode 26+
- Check `isLiquidGlassSupported` from `@callstack/liquid-glass`
- Provide fallback UI for older iOS versions

### SF Symbols not displaying
- Install `sf-symbols-typescript`
- Use valid SF Symbol names
- Check iOS version compatibility (some symbols are iOS 16+)

## Resources

- [@expo/ui Documentation](https://docs.expo.dev/versions/latest/sdk/ui/)
- [SF Symbols App](https://developer.apple.com/sf-symbols/)
- [SwiftUI Documentation](https://developer.apple.com/documentation/swiftui)
