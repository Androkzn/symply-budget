# SwiftUI Components Troubleshooting

## Current Issue: ViewManagerAdapter Error

### Error Message
```
Unimplemented component ViewManagerAdapter
```

### What This Means

The `@expo/ui` SwiftUI components require additional native configuration that isn't automatically set up. This is likely because:

1. **Expo Router Integration Required**: `@expo/ui` may require Expo Router for proper SwiftUI bridging
2. **Additional Native Setup**: SwiftUI view managers need specific configuration in the native iOS project
3. **New Architecture**: While we have New Architecture enabled, there may be additional setup needed for SwiftUI components

### Current Workaround

The tab bar is currently falling back to the `BlurTabBar` implementation using `@react-native-community/blur`. This provides a similar visual effect until we can properly configure SwiftUI components.

**Location**: [MainNavigator.tsx:132-138](../src/navigation/MainNavigator.tsx#L132-L138)

```tsx
function LiquidGlassTabBar(props: BottomTabBarProps) {
  // Temporary fallback until SwiftUI components are configured
  return <BlurTabBar {...props} />;
}
```

## Solutions to Try

### Option 1: Use Expo Router (Recommended)

`@expo/ui` is designed to work best with Expo Router. To properly use SwiftUI components:

1. **Migrate to Expo Router**:
   ```bash
   npx expo install expo-router
   ```

2. **Update app structure** to use file-based routing

3. **Re-enable SwiftUI components** in the tab bar

### Option 2: Manual Native Configuration

If staying with React Navigation:

1. **Check ExpoUI module registration** in `AppDelegate.swift`
2. **Verify podspec** is properly configured
3. **Review** [Expo modules documentation](https://docs.expo.dev/modules/overview/)

### Option 3: Alternative SwiftUI Integration

Use different SwiftUI integration approaches:

1. **`react-native-swift`** - Alternative SwiftUI bridge
2. **Custom TurboModules** - Build custom SwiftUI view managers
3. **`@callstack/liquid-glass`** - Continue using current implementation (already works)

## What Works Now

✅ **Blur Tab Bar** - Using `@react-native-community/blur`
✅ **`@callstack/liquid-glass`** - Native liquid glass views
✅ **Navigation** - React Navigation working properly
✅ **SF Symbols** - Can still use via custom native views

## What Doesn't Work

❌ **`@expo/ui` SwiftUI Components** - ViewManagerAdapter error
❌ **Native SwiftUI Buttons** - Requires working SwiftUI bridge
❌ **GlassEffectContainer** - Requires SwiftUI context

## Files Affected

- **MainNavigator.tsx** - Tab bar implementation (currently using fallback)
- **SwiftUINavigation.tsx** - Helper components (won't work until SwiftUI is configured)
- **SwiftUINavigationDemo.tsx** - Demo screen (won't work until SwiftUI is configured)

## Next Steps

### Short Term
- [x] Use BlurTabBar fallback (working)
- [ ] Investigate Expo Router migration
- [ ] Check Expo modules documentation

### Long Term
- [ ] Migrate to Expo Router for proper SwiftUI support
- [ ] Re-enable SwiftUI components
- [ ] Create custom TurboModules if Expo Router isn't feasible

## Resources

- [Expo UI Documentation](https://docs.expo.dev/versions/latest/sdk/ui/)
- [Expo Router](https://docs.expo.dev/router/introduction/)
- [Expo Modules](https://docs.expo.dev/modules/overview/)
- [@callstack/liquid-glass](https://github.com/callstack/liquid-glass) (current working solution)

## Testing SwiftUI Components

To test if SwiftUI components start working:

1. Uncomment the SwiftUI implementation in `MainNavigator.tsx:140-171`
2. Uncomment the imports at the top: `Host`, `Button`, `GlassEffectContainer`, `HStack`
3. Uncomment the `tabIcons` constant
4. Rebuild the iOS app
5. Check if the ViewManagerAdapter error is gone

If it still fails, Expo Router migration is likely required.
