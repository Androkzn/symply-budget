import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Platform, Image, Animated, ColorValue } from 'react-native';

import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { useAppColors, type AppColors } from '@theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** True when the icon prop is an Ionicon glyph name rather than an emoji. */
function isIoniconName(icon: string): icon is IoniconName {
  return icon in Ionicons.glyphMap;
}

interface WidgetCardProps {
  icon: string;
  title: string;
  onPress?: () => void;
  onLongPress?: () => void;
  backgroundColor?: string;
  gradientColors?: string[];
  iconImage?: number;
  isEditMode?: boolean;
  isAddButton?: boolean;
  delayLongPress?: number;
  /** Optional status pill shown under the title (e.g. "Not set up", "♻️ Thu"). */
  badge?: string;
  /**
   * Render the card as a non-interactive visual (no wrapping TouchableOpacity).
   * Used inside the sortable edit grid where the parent owns the drag/tap
   * gestures — a nested touchable would otherwise fight the drag gesture.
   */
  staticRender?: boolean;
}

export function WidgetCard({
  icon,
  title,
  onPress,
  onLongPress,
  backgroundColor,
  gradientColors,
  iconImage,
  isEditMode = false,
  isAddButton = false,
  delayLongPress = 500,
  badge,
  staticRender = false,
}: WidgetCardProps) {
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bgColor = backgroundColor || colors.cardBackground;
  const isColoredCard = !!backgroundColor || !!gradientColors;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  // Dark, near-opaque pill with white text — legible on light glass cards,
  // gradients, and solid cards alike (the old translucent-white pill vanished
  // on the light Liquid Glass background).
  const badgeNode = badge ? (
    <View style={styles.badge}>
      <Typography
        variant="caption1"
        weight="bold"
        numberOfLines={1}
        style={styles.badgeText}
      >
        {badge}
      </Typography>
    </View>
  ) : null;

  const content = (
    <>
      {/* Decorative bubbles for colored cards - Liquid Glass style */}
      {isColoredCard && !isAddButton && (
        <>
          <View style={[styles.bubble, styles.bubbleTopRight]} />
          <View style={[styles.bubble, styles.bubbleBottomLeft]} />
          <View style={[styles.bubble, styles.bubbleCenter]} />
        </>
      )}

      {/* Glass overlay effect */}
      {!isAddButton && <View style={styles.glassOverlay} />}

      <View style={styles.iconContainer}>
        {iconImage ? (
          <Image source={iconImage} style={styles.iconImage} resizeMode="contain" />
        ) : (
          <View style={[
            styles.iconWrapper,
            isColoredCard && styles.iconWrapperColored,
            isAddButton && styles.iconWrapperAdd,
          ]}>
            {isIoniconName(icon) ? (
              <Icon
                name={icon}
                size={isAddButton ? 28 : 36}
                color={
                  isAddButton
                    ? colors.textSecondary
                    : isColoredCard
                      ? colors.white
                      : colors.primary
                }
              />
            ) : (
              <Typography variant="title1" style={[
                styles.iconEmoji,
                isAddButton && styles.addButtonIcon,
              ]}>
                {icon}
              </Typography>
            )}
          </View>
        )}
      </View>
      <Typography
        variant="callout"
        weight="semibold"
        align="center"
        numberOfLines={2}
        style={[
          styles.title,
          isColoredCard && styles.titleWhite,
          isAddButton && styles.addButtonTitle,
        ]}
      >
        {title}
      </Typography>
      {badgeNode}
    </>
  );

  // The visual body of the card, independent of how it's wrapped (interactive
  // touchable vs. static for the sortable grid).
  let visual: React.ReactNode;
  if (isLiquidGlassAvailable()) {
    visual = (
      <GlassView
        style={styles.widgetGlass}
        glassEffectStyle="regular"
        isInteractive={!isEditMode && !staticRender}
      >
        <View style={styles.iconContainer}>
          {iconImage ? (
            <Image source={iconImage} style={styles.iconImage} resizeMode="contain" />
          ) : (
            <View style={[styles.iconWrapper, styles.iconWrapperGlass]}>
              {isIoniconName(icon) ? (
                <Icon name={icon} size={36} color={colors.primary} />
              ) : (
                <Typography variant="title1" style={styles.iconEmoji}>
                  {icon}
                </Typography>
              )}
            </View>
          )}
        </View>
        <Typography
          variant="callout"
          weight="semibold"
          align="center"
          numberOfLines={2}
          style={styles.title}
        >
          {title}
        </Typography>
        {badgeNode}
      </GlassView>
    );
  } else if (gradientColors && gradientColors.length >= 2) {
    visual = (
      <LinearGradient
        colors={gradientColors as unknown as readonly [ColorValue, ColorValue, ...ColorValue[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.widget, styles.widgetGradient]}
      >
        {content}
      </LinearGradient>
    );
  } else {
    visual = (
      <View style={[styles.widget, styles.widgetSolid, { backgroundColor: bgColor }]}>
        {content}
      </View>
    );
  }

  // Static: parent (sortable grid) owns gestures — render the visual only.
  if (staticRender) {
    return <View style={styles.touchable}>{visual}</View>;
  }

  return (
    <TouchableOpacity
      style={styles.touchable}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      delayLongPress={delayLongPress}
    >
      <Animated.View style={[styles.fill, { transform: [{ scale: scaleAnim }] }]}>
        {visual}
      </Animated.View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  touchable: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  widget: {
    flex: 1,
    borderRadius: 28,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  widgetGradient: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  widgetSolid: {
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.04)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  glassOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  bubble: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  bubbleTopRight: {
    top: -20,
    right: -20,
  },
  bubbleBottomLeft: {
    bottom: -30,
    left: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  bubbleCenter: {
    top: 50,
    right: -40,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  iconContainer: {
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  iconWrapperColored: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  iconWrapperGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  widgetGlass: {
    flex: 1,
    borderRadius: 28,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconImage: {
    width: 52,
    height: 52,
  },
  iconEmoji: {
    fontSize: 36,
  },
  title: {
    marginTop: 6,
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  titleWhite: {
    color: colors.white,
  },
  badge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'center',
    maxWidth: '100%',
    backgroundColor: 'rgba(17, 24, 39, 0.78)',
  },
  badgeText: {
    color: colors.white,
  },
  iconWrapperAdd: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderStyle: 'dashed',
    borderWidth: 2,
  },
  addButtonIcon: {
    color: colors.textSecondary,
    fontSize: 28,
  },
  addButtonTitle: {
    color: colors.textSecondary,
  },
});
