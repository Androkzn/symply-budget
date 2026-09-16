import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Platform,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography, Avatar } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useProfile } from '@contexts/ProfileContext';
import { useTheme } from '@contexts/ThemeContext';
import { useHouseholdStore } from '@stores/householdStore';
import { useNotificationStore } from '@stores/notificationStore';
import {
  ButtonMetrics,
  Chat as ChatTokens,
  Header,
  IconSize,
  Opacity,
  Spacing,
  TypographyTokens,
  useAppColors,
} from '@theme';
import { brandSupportsNotifications } from '@utils/notificationVisibility';

import { BackButton } from './BackButton';
import { HeaderLogo } from './HeaderLogo';
import { PropertySwitcher } from './PropertySwitcher';

function hexToRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ScreenHeaderProps {
  title?: string;
  /**
   * Renders IN PLACE OF the centered `title` text — for headers whose title is
   * itself a control (e.g. the Mortgage property dropdown). Own the type ramp
   * inside it (`headline` / `semibold`) so it still reads as a header title.
   * Ignored when `titleAlign` is `left`.
   */
  titleElement?: React.ReactNode;
  titleLeadingElement?: React.ReactNode;
  /**
   * `center` (default) keeps the title in the centered column. `left` groups
   * the title next to `titleLeadingElement` in the leading column so an avatar
   * sits flush against its label (e.g. the Mira chat header).
   */
  titleAlign?: 'center' | 'left';
  showBackButton?: boolean;
  onBackPress?: () => void;
  /**
   * Glyph for the leading button — `chevron-back` (default) for push nav, or
   * `close` for modal/embedded screens. Forwarded to `BackButton`.
   */
  backIcon?: 'chevron-back' | 'close';
  /** Forwarded to `BackButton` (default `nav-back-button`). */
  backButtonTestID?: string;
  backButtonColor?: string;
  onNotificationPress?: () => void;
  onProfilePress?: () => void;
  rightElement?: React.ReactNode;
  showNotificationBell?: boolean;
  showAvatar?: boolean;
  showPropertySwitcher?: boolean;
  topInsetExtra?: number;
  /**
   * Set on screens presented as an iOS sheet (`modal` / `pageSheet`). The sheet
   * card starts *below* the status bar, but `useSafeAreaInsets` reports window
   * insets, so re-applying `insets.top` here renders as a blank band above the
   * title. Inside a sheet the inset is dropped for a flat sheet top padding.
   */
  insideSheet?: boolean;
}

export function ScreenHeader({
  title,
  titleElement,
  titleLeadingElement,
  titleAlign = 'center',
  showBackButton = false,
  onBackPress,
  backIcon = 'chevron-back',
  backButtonTestID,
  backButtonColor,
  onNotificationPress,
  onProfilePress,
  rightElement,
  showNotificationBell = true,
  showAvatar = true,
  showPropertySwitcher = true,
  topInsetExtra = Header.safeAreaTopExtra,
  insideSheet = false,
}: ScreenHeaderProps) {
  const { user } = useProfile();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = useAppColors();
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const households = useHouseholdStore((state) => state.households);
  /**
   * The switcher slot is brand-neutral, and since BR-016 that is load-bearing
   * rather than incidental.
   *
   * Under Budget local-first this was always false: `householdStore.households`
   * was forced to `[ledger.household]` on every focus, because a device held one
   * ledger. The engine now keeps a session per household and `ensureSession`
   * publishes the real list, so a Budget member with two households gets exactly
   * the header control a House member with two properties gets — no brand gate
   * needed here, and none wanted.
   *
   * What the two brands get from it still differs: Budget's switcher SELECTS one
   * household (its engine activates exactly one session at a time), while House
   * also offers the "all properties" AGGREGATE. That split lives in
   * `PropertySwitcher` and in `SettingsScreen`'s MULTI-PROPERTY section, not here.
   */
  const hasMultipleProperties = households.length > 1;

  const headerContainerChrome = useMemo(
    () => ({
      borderBottomColor: colors.divider,
      ...Platform.select({
        ios: {
          shadowColor: colors.shadowDark,
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: Opacity.headerBarShadow,
          shadowRadius: 12,
        },
        android: {
          elevation: 4,
        },
      }),
    }),
    [colors.divider, colors.shadowDark]
  );

  const iconButtonShadow = useMemo(
    () =>
      Platform.select({
        ios: {
          shadowColor: colors.primary,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 6,
        },
        android: {
          elevation: 2,
        },
      }),
    [colors.primary]
  );

  const iconButtonNotification = useMemo(
    () => [
      styles.iconButton,
      iconButtonShadow,
      {
        // Brand-tinted chip matching the circular back button's fill (pastel
        // teal @ 0x33 ≈ 20%), so every circular header control reads as one set.
        backgroundColor: hexToRgba(colors.primary, 0.2),
        borderWidth: 1,
        borderColor: colors.headerNotificationBorder,
      },
    ],
    [iconButtonShadow, colors.primary, colors.headerNotificationBorder]
  );

  const notificationBadge = useMemo(
    () => [
      styles.notificationBadge,
      {
        backgroundColor: colors.error,
        borderColor: colors.headerNotificationBackground,
      },
    ],
    [colors.error, colors.headerNotificationBackground]
  );

  const badgeTextStyle: TextStyle = useMemo(
    () => ({
      color: colors.white,
      fontSize: TypographyTokens.micro.size,
      lineHeight: TypographyTokens.micro.lineHeight,
      fontWeight: TypographyTokens.captionBold.weight,
    }),
    [colors.white]
  );

  const topPad = insideSheet ? Header.sheetTopPadding : insets.top + topInsetExtra;
  const blurTint = theme.dark ? 'dark' : 'light';
  // Header chrome uses the same surface as cards/sections (`backgroundSecondary`)
  // so it blends with the content behind it. Clean → #F7FAFA; house light/dark
  // keep their existing #F2F2F7 / #1C1C1E values (identical to the old scrim).
  const headerSurface = colors.backgroundSecondary;
  const headerOverlayScrim = headerSurface;
  const headerGradientColors = [
    hexToRgba(headerSurface, 0.95),
    hexToRgba(headerSurface, 0),
  ] as const;

  // Nested screen header with back button and title
  if (showBackButton || title || titleElement) {
    const nestedHeaderContent = (
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad,
            paddingHorizontal: Header.paddingHorizontal,
            paddingBottom: Header.paddingBottom,
          },
        ]}
      >
        <View
          style={[
            styles.headerLeft,
            titleAlign === 'left' ? styles.headerLeftFlex : styles.headerLeftFixed,
            { gap: Header.centerGap },
          ]}
        >
          {showBackButton && onBackPress && (
            <BackButton
              onPress={onBackPress}
              size="md"
              icon={backIcon}
              color={backButtonColor}
              testID={backButtonTestID}
            />
          )}
          {/* Leading element (e.g. persona avatar) lives in the left column so
              it sits flush against the leading edge instead of after the empty
              back-button gap. */}
          {titleLeadingElement}
          {/* Left-aligned title sits directly beside the leading element so an
              avatar reads as a label pair rather than a floating centered title. */}
          {titleAlign === 'left' && title && (
            <Typography
              variant="headline"
              weight="semibold"
              numberOfLines={1}
              style={styles.headerTitleLeft}
            >
              {title}
            </Typography>
          )}
        </View>

        {titleAlign === 'center' && (
          <View
            style={[
              styles.headerCenter,
              { gap: Header.centerGap },
            ]}
          >
            {titleElement ? (
              <View style={styles.headerTitleSlot}>{titleElement}</View>
            ) : (
              title && (
                <View style={styles.headerTitleSlot}>
                  <Typography
                    variant="headline"
                    weight="semibold"
                    numberOfLines={1}
                    align="center"
                    style={styles.headerTitleText}
                  >
                    {title}
                  </Typography>
                </View>
              )
            )}
          </View>
        )}

        <View style={[styles.headerRightNested, { gap: Header.rightIconGap }]}>
          {rightElement}
          {showNotificationBell && brandSupportsNotifications && onNotificationPress && (
            <TouchableOpacity
              style={iconButtonNotification}
              onPress={onNotificationPress}
              testID="header-notifications"
              accessibilityLabel="Notifications"
            >
              <Icon name="notifications" active size={IconSize.lg} />
              {unreadCount > 0 && (
                <View style={notificationBadge}>
                  <Typography variant="caption2" style={badgeTextStyle}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Typography>
                </View>
              )}
            </TouchableOpacity>
          )}
          {/* Avatar is opt-in in the nested (titled) branch: only the main tab
              headers pass `onProfilePress`, so detail/drill-in screens that pass
              a title keep their clean back+title layout. */}
          {showAvatar && onProfilePress && (
            <TouchableOpacity
              style={styles.avatarButton}
              onPress={onProfilePress}
              activeOpacity={0.7}
              testID="header-profile"
              accessibilityLabel="Profile"
            >
              <Avatar
                user={user ?? undefined}
                size={Header.circleButtonSize}
                borderColor={colors.primary}
                borderWidth={1}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );

    if (isLiquidGlassAvailable()) {
      return (
        <GlassView style={styles.headerContainerGlass} glassEffectStyle="regular">
          <LinearGradient
            colors={headerGradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {nestedHeaderContent}
        </GlassView>
      );
    }

    return (
      <View style={[styles.headerContainer, headerContainerChrome]}>
        <BlurView style={StyleSheet.absoluteFill} intensity={80} tint={blurTint} />
        <View
          style={[styles.overlay, { backgroundColor: headerOverlayScrim }]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={headerGradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.headerContent}>{nestedHeaderContent}</View>
      </View>
    );
  }

  const headerContent = (
    <View
      style={[
        styles.header,
        {
          paddingTop: topPad,
          paddingHorizontal: Header.paddingHorizontal,
          paddingBottom: Header.paddingBottom,
        },
      ]}
    >
      {showPropertySwitcher && hasMultipleProperties ? (
        <View
          style={[
            styles.propertySwitcherContainer,
            { marginRight: Header.rightIconGap },
          ]}
        >
          <PropertySwitcher />
        </View>
      ) : showPropertySwitcher ? (
        // Single household: no property to switch, so surface the app brand in
        // the same left slot instead of leaving it empty. HeaderLogo now renders
        // a theme-aware gradient wordmark (not the old light-only PNG), so it
        // reads on both light and dark surfaces.
        <View
          style={[
            styles.headerLogoContainer,
            { marginRight: Header.rightIconGap },
          ]}
        >
          <HeaderLogo height={Header.logoHeight} />
        </View>
      ) : (
        <View style={styles.headerLeftSpacer} />
      )}

      <View
        style={[
          styles.headerRight,
          { gap: Header.rightIconGap },
        ]}
      >
        {rightElement}
        {showNotificationBell && brandSupportsNotifications && (
          <TouchableOpacity
            style={iconButtonNotification}
            onPress={onNotificationPress}
            testID="header-notifications"
            accessibilityLabel="Notifications"
          >
            <Icon name="notifications" active size={IconSize.lg} />
            {unreadCount > 0 && (
              <View style={notificationBadge}>
                <Typography variant="caption2" style={badgeTextStyle}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Typography>
              </View>
            )}
          </TouchableOpacity>
        )}
        {showAvatar && (
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={onProfilePress}
            activeOpacity={0.7}
            testID="header-profile"
            accessibilityLabel="Profile"
          >
            <Avatar user={user ?? undefined} size={Header.circleButtonSize} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={styles.headerContainerGlass} glassEffectStyle="regular">
        <LinearGradient
          colors={headerGradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {headerContent}
      </GlassView>
    );
  }

  return (
    <View style={[styles.headerContainer, headerContainerChrome]}>
      <BlurView style={StyleSheet.absoluteFill} intensity={80} tint={blurTint} />
      <View
        style={[styles.overlay, { backgroundColor: headerOverlayScrim }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={headerGradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.headerContent}>{headerContent}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerContainerGlass: {
    overflow: 'hidden',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  headerContent: {
    position: 'relative',
    zIndex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  iconButton: {
    width: Header.circleButtonSize,
    height: Header.circleButtonSize,
    borderRadius: Header.circleButtonRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarButton: {
    width: ButtonMetrics.minTapTarget,
    height: ButtonMetrics.minTapTarget,
    borderRadius: ButtonMetrics.minTapTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: -Spacing.xs,
    right: -Spacing.xs,
    minWidth: ChatTokens.chipRemoveHitSize,
    height: ChatTokens.chipRemoveHitSize,
    borderRadius: ChatTokens.chipRemoveHitSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Spacing.xxs,
    paddingHorizontal: Spacing.xxs,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  headerLeftFixed: {
    // Fixed width so the centered title stays optically centered.
    width: Header.sideColumnWidth,
  },
  headerLeftFlex: {
    // Left-aligned title mode: take the available row width so the title can
    // sit beside the leading element and truncate instead of being clipped.
    flex: 1,
    minWidth: 0,
  },
  headerTitleLeft: {
    flexShrink: 1,
  },
  headerRightNested: {
    flexDirection: 'row',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: Header.sideColumnWidth,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  headerTitleSlot: {
    flex: 1,
    minWidth: 0,
  },
  headerTitleText: {
    width: '100%',
  },
  propertySwitcherContainer: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerLogoContainer: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerLeftSpacer: {
    flex: 1,
  },
});
