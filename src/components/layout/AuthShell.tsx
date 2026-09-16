import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { brand } from '@brand';
import { getLogoSplashForScheme } from '@brand/assets';
import { SafeAreaView } from '@components/common';
import { Typography } from '@components/ui';
import { useAppStore } from '@stores/appStore';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type AuthShellProps = {
  children: React.ReactNode;
  /** Override default splash logo */
  logoSource?: ImageSourcePropType;
  title?: string;
  subtitle?: string;
  /** When false, omit the logo block (forms that draw their own header) */
  showLogo?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Shared auth chrome — logo/title from the active brand pack over a flat,
 * theme-following background (white in light mode, dark in dark mode). The
 * legacy brand-splash ("aurora") variant was retired for a single consistent
 * look. Login / Register wrap their forms in this shell; do not fork per brand.
 */
export function AuthShell({
  children,
  logoSource,
  title,
  subtitle,
  showLogo = true,
  contentStyle,
}: AuthShellProps) {
  const colors = useAppColors();
  const accentScheme = useAppStore((s) => s.accentScheme);
  const logo = logoSource ?? getLogoSplashForScheme(brand.id, accentScheme);

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundMain }]}>
      <SafeAreaView style={styles.safe}>
        {/* Every sign-in / sign-up / reset form in the app is `children` here,
            so this scroller is the one that has to reveal their fields. It used
            to be a `KeyboardAvoidingView` with `behavior="padding"` — which only
            SHRINKS the viewport and never moves the content, the exact trap
            documented in `@utils/keyboard`. The email and password fields sit
            mid-screen, so the keypad opened straight over them. */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, contentStyle]}
          showsVerticalScrollIndicator={false}
          {...keyboardDismissScrollProps}
        >
          {showLogo ? (
            <View style={styles.logoContainer}>
              <Image source={logo} style={styles.logo} resizeMode="contain" />
            </View>
          ) : null}
          {(title || subtitle) && (
            <View style={styles.header}>
              {title ? (
                <Typography
                  variant="heading"
                  weight="bold"
                  color={colors.textPrimary}
                  style={styles.title}
                >
                  {title}
                </Typography>
              ) : null}
              {subtitle ? (
                <Typography
                  variant="labelRegular"
                  color={colors.textSecondary}
                  style={styles.subtitle}
                >
                  {subtitle}
                </Typography>
              ) : null}
            </View>
          )}
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** Default subtitle for login using the active brand display name. */
export function authContinueSubtitle(): string {
  return `Sign in to continue to ${brand.displayName}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 180,
    height: 72,
  },
  header: {
    marginBottom: 24,
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
  },
});
