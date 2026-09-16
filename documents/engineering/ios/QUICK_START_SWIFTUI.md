# Quick Start: SwiftUI Navigation

## What Changed

Your app now uses **native SwiftUI components** from `@expo/ui` instead of JavaScript-based liquid glass components.

## Current Tab Bar Implementation

Location: [`src/navigation/MainNavigator.tsx:131-174`](../src/navigation/MainNavigator.tsx#L131-L174)

```tsx
// Native SwiftUI Liquid Glass Tab Bar
function LiquidGlassTabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.liquidGlassContainer}>
      <Host style={styles.swiftUIHost}>
        <GlassEffectContainer spacing={8}>
          <HStack spacing={8}>
            {state.routes.map((route, index) => (
              <Button
                key={route.key}
                variant="glass"
                systemImage={isFocused ? 'house.fill' : 'house'}
                onPress={handlePress}
                color={isFocused ? '#007AFF' : '#8E8E93'}
              >
                {label}
              </Button>
            ))}
          </HStack>
        </GlassEffectContainer>
      </Host>
    </View>
  );
}
```

## Key Components

### 1. **Host** - Required Container
Every SwiftUI component must be wrapped in `<Host>`:

```tsx
<Host style={{ height: 60 }}>
  {/* SwiftUI components here */}
</Host>
```

### 2. **Button** - Native Glass Buttons
Available variants:
- `glass` - Liquid glass (iOS 26+) ⭐
- `glassProminent` - Prominent glass (iOS 26+)
- `bordered` - Standard bordered
- `plain` - Minimal

```tsx
<Button
  variant="glass"
  systemImage="star.fill"
  onPress={() => console.log('Pressed')}
  color="#007AFF"
>
  Favorite
</Button>
```

### 3. **GlassEffectContainer** - Groups Glass Elements
```tsx
<GlassEffectContainer spacing={8}>
  <HStack spacing={8}>
    <Button variant="glass">Button 1</Button>
    <Button variant="glass">Button 2</Button>
  </HStack>
</GlassEffectContainer>
```

### 4. **Layout Components**
- `VStack` - Vertical stack
- `HStack` - Horizontal stack
- `ZStack` - Layered stack

## SF Symbols Reference

The tab bar now uses SF Symbols instead of emojis:

| Tab | Symbol (Inactive) | Symbol (Active) |
|-----|------------------|-----------------|
| Home | `house` | `house.fill` |
| Tasks | `checkmark.circle` | `checkmark.circle.fill` |
| Contractors | `person.2` | `person.2.fill` |
| Reports | `doc.text` | `doc.text.fill` |
| Notifications | `bell` | `bell.fill` |
| Settings | `ellipsis` | `ellipsis` |

[Browse all SF Symbols](https://developer.apple.com/sf-symbols/)

## Testing the Changes

Once the build completes:

1. **Open the app on iOS 26 simulator** (iPhone 17 Pro)
2. **Check the tab bar** - should see native glass pill buttons
3. **Tap different tabs** - icons should change between filled/outlined
4. **Compare with Apple Music** - similar glass effect styling

## Adding More SwiftUI Navigation

### Add a Navigation Bar (Header)

Use the pre-built component:

```tsx
import { NavigationBar } from '@components/SwiftUINavigation';

function MyScreen() {
  return (
    <>
      <NavigationBar
        title="My Screen"
        leftButton={{
          icon: 'chevron.left',
          label: 'Back',
          onPress: () => navigation.goBack(),
        }}
        rightButton={{
          icon: 'ellipsis.circle',
          onPress: () => setShowMenu(true),
        }}
      />
      {/* Screen content */}
    </>
  );
}
```

### Add Glass Buttons to a Screen

```tsx
import { Host, Button, GlassEffectContainer, HStack } from '@expo/ui/swift-ui';

function MyComponent() {
  return (
    <Host style={{ height: 50 }}>
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
    </Host>
  );
}
```

## Demo Screen

Check out the full demo: [`src/screens/SwiftUINavigationDemo.tsx`](../src/screens/SwiftUINavigationDemo.tsx)

Shows examples of:
- Navigation bar with buttons
- Glass button groups
- All button variants
- Bottom sheet menu
- SF Symbols usage

## Troubleshooting

### Glass buttons not showing
✅ **Check:** Are you running on iOS 26 simulator?
✅ **Check:** Is `Host` wrapping your SwiftUI components?
✅ **Check:** Did the build complete successfully?

### SF Symbols not displaying
✅ **Check:** Is `sf-symbols-typescript` installed?
✅ **Check:** Are you using valid SF Symbol names?
✅ **Tip:** Use the SF Symbols app to browse available icons

### Build still running
The initial build with @expo/ui takes 5-10 minutes. Subsequent builds are much faster.

## Resources

- [Full SwiftUI Navigation Guide](./SWIFTUI_NAVIGATION.md)
- [SwiftUI Navigation Components](../src/components/SwiftUINavigation.tsx)
- [Demo Screen](../src/screens/SwiftUINavigationDemo.tsx)
- [@expo/ui Docs](https://docs.expo.dev/versions/latest/sdk/ui/)
- [SF Symbols App](https://developer.apple.com/sf-symbols/)

## Next Steps

1. ✅ Wait for build to complete
2. ✅ Test the new glass tab bar
3. ⬜ Add SwiftUI navigation bars to screens
4. ⬜ Replace custom buttons with glass buttons
5. ⬜ Explore modifiers and advanced layouts

---

**Note:** The app automatically falls back to the blur tab bar on iOS versions older than 26.
