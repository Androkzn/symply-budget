/**
 * Shared outline CTA for Apple / Google auth on Login + Register.
 * Keeps social button chrome in one place across the fleet.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';

import { GoogleIcon, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

export type SocialAuthProvider = 'apple' | 'google';

interface SocialAuthButtonProps {
  provider: SocialAuthProvider;
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SocialAuthButton({
  provider,
  title,
  onPress,
  loading = false,
  disabled = false,
  style,
  testID,
}: SocialAuthButtonProps) {
  const colors = useAppColors();
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.button,
        {
          backgroundColor: colors.card,
          borderColor: colors.borderColor,
          opacity: isDisabled ? 0.6 : 1,
        },
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {loading ? (
        <ActivityIndicator color={colors.textSecondary} size="small" />
      ) : (
        <>
          <View style={styles.icon}>
            {provider === 'apple' ? (
              <Icon name="logo-apple" size={20} color={colors.textPrimary} />
            ) : (
              <GoogleIcon size={20} />
            )}
          </View>
          <Typography variant="callout" weight="semibold" color={colors.textPrimary}>
            {title}
          </Typography>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 50,
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
  },
  icon: {
    marginRight: Spacing.smd,
  },
});
