import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity, Platform } from 'react-native';

import { Icon } from '@components/ui/Icon';
import {
  CornerRadius,
  Elevation,
  Opacity,
  Spacing,
  Toast as ToastLayout,
  TypographyTokens,
  ZIndex,
  useAppColors,
} from '@theme';

import { Typography as Typo } from './Typography';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
  onDismiss?: () => void;
  action?: {
    label: string;
    onPress: () => void;
  };
  /**
   * Makes the ENTIRE banner the tap target, not just the action label.
   *
   * A toast is a small strip at the top of the screen that a member has a few
   * seconds to hit; asking them to land on a label inside it wastes most of the
   * surface they can already see. The label stays as the visible affordance
   * (see `action`), but it and the body do the same thing.
   */
  onPress?: () => void;
}

export function Toast({
  message,
  type = 'info',
  duration = 3000,
  onDismiss,
  action,
  onPress,
}: ToastProps) {
  const colors = useAppColors();
  const translateY = useRef(new Animated.Value(-ToastLayout.offsetHidden)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 10,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      dismiss();
    }, duration);

    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -ToastLayout.offsetHidden,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss?.();
    });
  };

  const getBackgroundColor = () => {
    switch (type) {
      case 'success':
        return colors.success;
      case 'error':
        return colors.error;
      case 'info':
      default:
        return colors.textPrimary;
    }
  };

  const getIcon = (): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'success':
        return 'checkmark-circle';
      case 'error':
        return 'close-circle';
      case 'info':
      default:
        return 'information-circle';
    }
  };

  const topOffset = Platform.OS === 'ios' ? ToastLayout.offsetTopIOS : ToastLayout.offsetTopAndroid;

  /**
   * Navigate FIRST, then animate out. Waiting for the 200ms exit would make a
   * tap on a six-second banner feel like it missed, and the banner sliding away
   * over the screen it just opened reads as one movement rather than two.
   */
  const handlePress = () => {
    onPress?.();
    dismiss();
  };

  const row = (
    <>
      <Icon
        name={getIcon()}
        size={TypographyTokens.bodyLarge.size}
        color={colors.white}
        style={styles.icon}
      />

      <Typo
        variant="body"
        weight="medium"
        color={colors.white}
        style={styles.message}
        numberOfLines={2}
      >
        {message}
      </Typo>

      {action && (
        <TouchableOpacity onPress={action.onPress} style={styles.actionButton}>
          <Typo variant="body" weight="semibold" color={colors.white}>
            {action.label}
          </Typo>
        </TouchableOpacity>
      )}

      {/* A tappable toast with no action label would look identical to a
          plain one, so the chevron is what says "this goes somewhere". */}
      {onPress && !action && (
        <Icon
          name="chevron-forward"
          size={TypographyTokens.bodyLarge.size}
          color={colors.white}
          style={styles.chevron}
        />
      )}
    </>
  );

  // The padding lives on the row rather than the container so that a tappable
  // toast's target covers the whole banner, edge to edge — tapping the gap
  // beside the text has to work, or the "tappable" promise is only true over
  // the glyphs.
  const inner = onPress ? (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityRole="button"
      style={styles.content}
      testID="toast-pressable"
    >
      {row}
    </TouchableOpacity>
  ) : (
    <View style={styles.content}>{row}</View>
  );

  const body = (
    <Animated.View
      // A message with nowhere to go must not sit between the member and the
      // screen it is reporting on — the toast host is full-screen now, so this
      // is what keeps a plain toast as untouchable as it has always been.
      pointerEvents={onPress || action ? 'auto' : 'none'}
      style={[
        styles.container,
        {
          backgroundColor: getBackgroundColor(),
          transform: [{ translateY }],
          opacity,
          top: topOffset,
          left: Spacing.base,
          right: Spacing.base,
        },
        Platform.select({
          ios: {
            shadowColor: colors.black,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: Opacity.toast,
            shadowRadius: 8,
          },
          android: {
            elevation: Elevation.overlay,
          },
        }),
      ]}
    >
      {inner}
    </Animated.View>
  );

  return body;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    borderRadius: CornerRadius.md,
    zIndex: ZIndex.modal,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
  },
  icon: {
    marginRight: Spacing.sm,
  },
  message: {
    flex: 1,
  },
  actionButton: {
    marginLeft: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  chevron: {
    marginLeft: Spacing.sm,
  },
});
