import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTapOutsideContext } from '@contexts/TapOutsideContext';

interface TapOutsideWrapperProps {
  children: React.ReactNode;
}

/**
 * Root-level tap-outside host. Wrap the navigation tree once so every screen
 * can register dismiss callbacks via `useTapOutside`.
 *
 * MUST be a plain `View`, never a `Pressable` / `Touchable*`. Under the New
 * Architecture on iOS, a parent `Pressable` around the app tree fights every
 * nested `ScrollView` for the pan gesture — taps still reach buttons, but
 * drags often never become scrolls (RN #56879). That is exactly the
 * "every screen, no location pattern" failure mode.
 *
 * Keyboard dismiss on empty-space tap used to ride on that `Pressable`'s
 * `onPress`. Screens that need it already use `keyboardDismissMode` /
 * `keyboardShouldPersistTaps` on their own scroll containers; registered
 * `useTapOutside` callbacks stay available for callers that invoke
 * `dismissAll` explicitly.
 */
export function TapOutsideWrapper({ children }: TapOutsideWrapperProps) {
  // Keep the context subscription so the provider stays "live" for registrants
  // even though this wrapper no longer fires dismiss on every background tap.
  useTapOutsideContext();

  return <View style={styles.container}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
