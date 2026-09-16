/**
 * SimpleHouse Design Tokens
 *
 * Single source of truth for theme-independent design constants:
 * Spacing, CornerRadius, Typography ramp, ButtonMetrics, Animation,
 * Shadow, HeroImage, Avatar, Layout, Chat, etc.
 *
 * Theme-aware **colors** live in `useAppColors()` (./appColors).
 *
 * Values are in points. Use these instead of raw literals.
 */

import type { TextStyle } from 'react-native';

// ---------------------------------------------------------------------------
// Spacing — 8pt-based scale
// ---------------------------------------------------------------------------

export const Spacing = {
  /** 2pt — Hairline gaps */
  xxs: 2,
  /** 4pt — Minimal gaps */
  xs: 4,
  /** 8pt — Tight spacing */
  sm: 8,
  /** 10pt — Between sm and md (compact rows, header bottom) */
  smd: 10,
  /** 3pt — Segmented control inner inset (FilterTabs) */
  inset3: 3,
  /** 5pt — Tight row gap (FilterTabs) */
  gapTight5: 5,
  /** 12pt — Card gaps, internal padding */
  md: 12,
  /** 16pt — Card internal padding */
  base: 16,
  /** 20pt — Page margins */
  lg: 20,
  /** 24pt — Header spacing */
  xl: 24,
  /** 32pt — Major section spacing */
  xxl: 32,
} as const;

// ---------------------------------------------------------------------------
// Global header (ScreenHeader, stack chrome)
// ---------------------------------------------------------------------------

/**
 * Single source of truth for the diameter of every circular header control —
 * the persona avatar, the icon-only action button ("…"), and the notification
 * bell. Keeping them on one token guarantees they stay the same size.
 */
// 40pt matches the circular back button (BackButtonChrome.md) so every header
// control — back, bell, avatar, icon-only action + gear — reads as one size.
const CIRCLE_BUTTON_SIZE = 40;

export const Header = {
  /** Extra top inset on top of safe-area (points) */
  safeAreaTopExtra: Spacing.xs + Spacing.xxs,
  /**
   * Top padding for a header inside a sheet-presented screen. The sheet card
   * already starts below the status bar, so it replaces the safe-area inset
   * outright instead of adding to it.
   */
  sheetTopPadding: Spacing.md,
  paddingHorizontal: Spacing.base,
  paddingBottom: Spacing.smd,
  /** Min width for back / right columns so title centers */
  sideColumnWidth: 60,
  rightIconGap: Spacing.xs,
  centerGap: Spacing.sm,
  propertySwitcherMarginH: Spacing.sm,
  /** Header logo (small) / compact icon area */
  logoHeight: 36,
  /** Diameter of circular header controls (avatar, icon-only action, bell) */
  circleButtonSize: CIRCLE_BUTTON_SIZE,
  /** Radius for circular header controls (half the diameter) */
  circleButtonRadius: CIRCLE_BUTTON_SIZE / 2,
  /** Notification bell; unified with the shared circle-button size */
  iconButtonSize: CIRCLE_BUTTON_SIZE,
  /** Absolute header overlays on map/canvas surfaces */
  overlayZIndex: 20,
  /** Gap between multiple right-side header actions */
  actionGap: Spacing.sm,
  /** Compact action pill height (shares the circle-button size) */
  actionHeight: CIRCLE_BUTTON_SIZE,
  /** Compact action pill min width */
  actionMinWidth: 54,
  /** Icon size inside compact header action pills — matches the notification
      bell (IconSize.lg, 24pt) so every circular header control fills its 40pt
      chip with tight, consistent padding. */
  actionIconSize: 24,
  /** Compact action pill horizontal padding */
  actionPaddingHorizontal: Spacing.sm + Spacing.xxs,
  /** Disabled/loading opacity for compact header actions */
  actionDisabledOpacity: 0.55,
  /** Press opacity for compact header actions */
  actionActiveOpacity: 0.8,
  /** Compact action pill radius (shares the circle-button radius) */
  actionBorderRadius: CIRCLE_BUTTON_SIZE / 2,
} as const;

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

export const ZIndex = {
  /** Sync banners, toasts */
  raised: 100,
  /** Modals, sheets */
  modal: 1000,
  /** Launch / splash screen above root */
  splash: 999,
} as const;

/** Opacity multipliers for fills and shadows (non-color) */
export const Opacity = {
  /** ScreenHeader bar drop shadow on iOS */
  headerBarShadow: 0.06,
  textFieldSubtle: 0.05,
  buttonRaised: 0.1,
  toast: 0.25,
  tabThumb: 0.12,
  /** Bottom sheet, modal sheet shadow (iOS) */
  sheetRaised: 0.25,
  /** Inactive / secondary icon in tab bar */
  tabIconInactive: 0.6,
  /** `GradientButton` / elevated pill shadow (iOS) */
  gradientButton: 0.2,
  /** `BackButton` subtle drop shadow (iOS) */
  backButton: 0.08,
  /** White label on gradient when `disabled` */
  onGradientDisabled: 0.6,
  /** Secondary white label on a colored/gradient surface (e.g. summary card) */
  onColorLabel: 0.8,
  /** Hairline divider drawn in white on a colored/gradient surface */
  onColorDivider: 0.3,
  /** Translucent white fill/pill on a colored/gradient surface (e.g. timer badge) */
  onColorFill: 0.2,
} as const;

/** Android `elevation` — approximates iOS shadow tiers */
export const Elevation = {
  input: 1,
  floating: 2,
  card: 3,
  cardRaised: 4,
  /** Toasts, floating banners */
  overlay: 5,
  /** Prominent floating action (Android) */
  fab: 8,
} as const;

// ---------------------------------------------------------------------------
// iOS 11-style text styles used by <Typography> (mapped to one source of truth)
// ---------------------------------------------------------------------------

export const LegacyTextVariant = {
  largeTitle: { size: 34, lineHeight: 41, fontWeight: '700' as const },
  title1: { size: 28, lineHeight: 34, fontWeight: '700' as const },
  title2: { size: 22, lineHeight: 28, fontWeight: '700' as const },
  title3: { size: 20, lineHeight: 25, fontWeight: '600' as const },
  headline: { size: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { size: 17, lineHeight: 22, fontWeight: '400' as const },
  callout: { size: 16, lineHeight: 21, fontWeight: '400' as const },
  subheadline: { size: 15, lineHeight: 20, fontWeight: '400' as const },
  footnote: { size: 13, lineHeight: 18, fontWeight: '400' as const },
  caption1: { size: 12, lineHeight: 16, fontWeight: '400' as const },
  caption2: { size: 11, lineHeight: 13, fontWeight: '400' as const },
} as const;

// ---------------------------------------------------------------------------
// Baseline <Text> defaults (iOS / SF defaults)
// ---------------------------------------------------------------------------

export const UIFoundation = {
  /** Base letter spacing on body text from legacy app shell */
  textLetterSpacing: 0.3,
} as const;

// ---------------------------------------------------------------------------
// Main tab bar (CustomTabBar in MainTabNavigator)
// ---------------------------------------------------------------------------

/** Global toast (banner) placement and motion */
export const Toast = {
  offsetTopIOS: 60,
  offsetTopAndroid: 20,
  /** Hidden Y before/after show animation */
  offsetHidden: 100,
} as const;

/** `expo-blur` intensity and bottom-sheet chrome */
export const Blur = {
  /** Default material intensity for `BlurView` (tab bar, etc.) */
  tabBarMaterialIntensity: 60,
} as const;

/** Dismissable sheet (BottomSheet) geometry */
export const Sheet = {
  topCornerRadius: 20,
  handleWidth: 40,
  handleHeight: Spacing.xs,
  handleRadius: Spacing.xxs,
  heightFractionShort: 0.35,
  heightFractionStandard: 0.5,
  heightFractionTall: 0.75,
  heightFractionFull: 0.95,
  /** Swipe-to-dismiss: min vertical move before pan captures */
  panMoveMinY: 30,
  panVelocityMin: 0.2,
  panDismissDistance: 100,
  panDismissVelocity: 0.5,
  dismissAnimDurationMs: 250,
  spring: { tension: 65, friction: 11 } as const,
} as const;

export const TabBar = {
  /** Emoji / system icon size in the tab bar */
  iconSize: 22,
  /** 20pt — Bottom navigation and full-width CTA corner radius */
  cornerRadius: 20,
  /** Content row: top + horizontal insets (matches 8pt scale) */
  contentPadding: Spacing.sm,
  /** Single tab vertical padding */
  tabPaddingVertical: Spacing.sm,
  /** Label under icon */
  labelMarginTop: 3,
  labelLetterSpacing: -0.1,
} as const;

// ---------------------------------------------------------------------------
// Layout — named layout constants
// ---------------------------------------------------------------------------

export const Layout = {
  /** 20pt — Standard horizontal padding for screens */
  pageMargin: 20,
  /** 32pt — Vertical space between major content groups */
  sectionSpacing: 32,
  /** 12pt — Space between cards in a list/grid */
  cardSpacing: 12,
  /** 32pt — Bottom padding when no floating tab bar */
  bottomSafeArea: 32,
  /** 116pt — Bottom clearance for the floating tab-bar overlay. The glass
   * capsule (68pt) sits ~6pt above the home indicator, so its top reaches
   * ~108pt up on a device with a ~34pt bottom inset; 88pt left interactive
   * controls (e.g. the Mira/chat composer) tucked under the bar. */
  bottomTabBarClearance: 116,
  /** 26pt — Distance from floating CTA to home indicator */
  floatingButtonBottom: 26,
  /** 100pt — Scroll padding behind a floating CTA */
  floatingButtonClearance: 100,
  /** 24pt — Spacing below the navigation header */
  headerBottom: 24,
  /** 100pt — Default min height for multiline quote/notes fields */
  multilineFieldMinHeight: 100,
  /** 280pt — Max readable width for home empty states / help copy */
  emptyStateCopyMaxWidth: 280,
  /** Logo width as fraction of screen for splash (centered) */
  splashLogoWidthFraction: 0.7,
  /** 350pt — Max width/height of splash mark */
  splashLogoMax: 350,
  /** 720pt — Cap reading column width on iPad / wide windows (Apple HIG ~70-80 chars) */
  readingMaxWidth: 720,
  /** 540pt — Form sheet width on iPad (matches iOS form-sheet preferred width) */
  formSheetWidth: 540,
  /** 320pt — Permanent sidebar width on iPad regular */
  sidebarWidth: 320,
  /** 92pt — Icon-only compact sidebar width (width < 1180pt landscape) */
  sidebarCompactWidth: 92,
  /** 1024pt — Width threshold for three-column / split-view layouts */
  splitViewBreakpoint: 1024,
  /** 768pt — Width threshold for sidebar / regular-width layouts */
  sidebarBreakpoint: 768,
} as const;

// ---------------------------------------------------------------------------
// CornerRadius
// ---------------------------------------------------------------------------

export const CornerRadius = {
  /** 4pt — Progress bars, thin elements */
  xs: 4,
  /** 8pt — Small cards, pills */
  sm: 8,
  /** 12pt — Standard cards, input fields */
  md: 12,
  /** 16pt — Large cards, message bubbles */
  lg: 16,
  /** 20pt — Large buttons, large cards */
  xl: 20,
  /** 24pt — List items, glass cards */
  listItem: 24,
  /** 25pt — Buttons (capsule), sheets */
  xxl: 25,
  /** 26pt — Member cards, activity rows */
  card: 26,
  /** 32pt — Sheet top corners */
  sheet: 32,
  /** 9999 — Full pill / circle */
  full: 9999,
} as const;

// ---------------------------------------------------------------------------
// Button Metrics
// ---------------------------------------------------------------------------

export const ButtonMetrics = {
  /** 56pt — Primary/Secondary button height */
  primaryHeight: 56,
  /** Primary/full-width CTA corner radius; matches bottom navigation */
  primaryCornerRadius: TabBar.cornerRadius,
  /** 36pt — Icon button visual size (Back, Close) */
  iconButtonSize: 36,
  /** 44pt — Minimum tappable area (HIG) */
  minTapTarget: 44,
  /** 0.95 — Press scale for standard buttons */
  pressScaleStandard: 0.95,
  /** 0.97 — Press scale for cards */
  pressScaleCard: 0.97,
  /** 0.98 — Press scale for small interactive elements */
  pressScaleSmall: 0.98,
  /** 1.0 — Press opacity standard */
  pressOpacityStandard: 1.0,
  /** 0.9 — Press opacity for cards */
  pressOpacityCard: 0.9,
  /** 0.5 — Disabled/pressed opacity */
  pressOpacityDisabled: 0.5,
} as const;

/** `BackButton` (chevron) hit area + icon */
export const BackButtonChrome = {
  sm: { size: 36, icon: 20 },
  md: { size: 40, icon: 24 },
  lg: { size: 48, icon: 28 },
} as const;

/** `BackButton` fill treatment */
export const BackButtonFill = {
  translucentAlphaHex: '33',
} as const;

/** `GradientButton` per size ramp */
export const GradientButton = {
  sm: { paddingV: 10, paddingH: 16, radius: 10, icon: 16 },
  md: { paddingV: 14, paddingH: 24, radius: 14, icon: 18 },
  lg: { paddingV: 18, paddingH: 28, radius: 16, icon: 22 },
} as const;

// ---------------------------------------------------------------------------
// Shadow tiers
//
// Use with `useAppColors().shadowLight/Medium/Dark` for the color, plus
// `radius`, `offset.x`, `offset.y` from these tokens.
// ---------------------------------------------------------------------------

export const Shadow = {
  light: {
    radius: 4,
    offsetX: 0,
    offsetY: 2,
    opacityDark: 0.3,
    opacityLight: 0.08,
  },
  medium: {
    radius: 4,
    offsetX: 0,
    offsetY: 2,
    opacityDark: 0.2,
    opacityLight: 0.1,
  },
  dark: {
    radius: 8,
    offsetX: 0,
    offsetY: 4,
    opacityDark: 0.5,
    opacityLight: 0.15,
  },
} as const;

// ---------------------------------------------------------------------------
// Hero Image
// ---------------------------------------------------------------------------

export const HeroImage = {
  /** 320pt — Fixed height for hero header */
  height: 320,
  /** 20pt — Bottom corner rounding */
  bottomCornerRadius: 20,
  /** Floating control padding from safe area edges */
  controlPaddingTop: 20,
  controlPaddingLeading: 15,
  controlPaddingTrailing: 15,
  controlPaddingBottom: 20,
} as const;

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export const Avatar = {
  /** 48pt — Header profile button */
  headerSize: 48,
  /** 48pt — Member list row avatar */
  memberListSize: 48,
  /** 36pt — Compact card avatar */
  cardSize: 36,
  /** 32pt — Inline header avatar (chat title) */
  inlineSize: 32,
  /** 2pt — Standard avatar ring stroke */
  borderWidth: 2,
  /** 96pt — Hero circle art */
  heroSize: 96,
  /** 0.15 — Initial-letter fallback fill opacity */
  initialFillOpacity: 0.15,
} as const;

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

export const EmptyState = {
  /** 64pt — Large icon size */
  iconSize: 64,
  /** 0.4 — Icon opacity */
  iconOpacity: 0.4,
  /** 60pt — Vertical padding around empty-state copy blocks */
  blockPaddingVertical: 60,
} as const;

export const Picker = {
  /** 100pt — Category tile in contractor specialty picker (square) */
  contractorCategoryTile: 100,
} as const;

// ---------------------------------------------------------------------------
// Animation — spring over easing, exits faster than entrances
// ---------------------------------------------------------------------------

export const Animation = {
  /** 0.3s — Entrance duration */
  entranceDuration: 300,
  /** 0.2s — Exit duration (faster than entrance) */
  exitDuration: 200,
  /** 0.3s — Image fade-in transition */
  imageFadeIn: 300,
  /** Spring config (Reanimated / Animated) */
  spring: { damping: 18, stiffness: 220, mass: 1 },
} as const;

// ---------------------------------------------------------------------------
// Floating Control (overlays on video / hero)
// ---------------------------------------------------------------------------

export const FloatingControl = {
  /** Dark tint opacity layered under the material */
  tintOpacity: 0.25,
  /** Material opacity (1 = fully opaque blur) */
  materialOpacity: 0.5,
  /** Corner radius for floating control backgrounds */
  cornerRadius: 20,
  /** 32pt — Size for circular floating controls */
  circleButtonSize: 32,
  /** 0.6 — Strong scrim opacity (edges) */
  scrimOpacityStrong: 0.6,
  /** 0.3 — Mid scrim opacity (transition) */
  scrimOpacityMid: 0.3,
  /** 120pt — Height of top gradient scrim */
  topScrimHeight: 120,
  /** 160pt — Height of bottom gradient scrim */
  bottomScrimHeight: 160,
} as const;

// ---------------------------------------------------------------------------
// Icons (Ionicons / system) — keep sizes on-scale
// ---------------------------------------------------------------------------

export const IconSize = {
  sm: 16,
  md: 20,
  /** 24pt — Prominent action icons (header document, camera) */
  lg: 24,
  /** 28pt — Hero glyphs sitting inside a bubble/tile (encouragement banner) */
  xl: 28,
} as const;

// ---------------------------------------------------------------------------
// Chat — Aihousekeeper & generic AI chat surfaces
// ---------------------------------------------------------------------------

export const Chat = {
  /** 16pt — Bubble corner radius */
  bubbleRadius: CornerRadius.lg,
  /** 4pt — Tail corner (top-{leading|trailing}) for the speaker side */
  bubbleTailRadius: 4,
  /** 14pt — Bubble horizontal padding */
  bubblePaddingHorizontal: 14,
  /** 10pt — Bubble vertical padding */
  bubblePaddingVertical: 10,
  /** 0.85 — Default max bubble width as fraction of row */
  bubbleMaxWidthRatio: 0.85,
  /** 0.96 — Wide bubble (for inline UI cards) max width ratio */
  bubbleWideMaxWidthRatio: 0.96,
  /** 10pt — Vertical spacing between bubble rows */
  bubbleRowSpacing: 10,
  /** 12pt — Padding around the input row */
  inputRowPadding: 12,
  /** 8pt — Spacing between input row controls */
  inputRowGap: 8,
  /** 44pt — Square action buttons (attach, voice) */
  actionButtonSize: 44,
  /** 12pt — Action button corner radius */
  actionButtonRadius: 12,
  /** 44pt — Min input height */
  inputMinHeight: 44,
  /** 120pt — Max input height before scrolling */
  inputMaxHeight: 120,
  /** 240pt — Square preview for image messages */
  imagePreviewSize: 240,
  /** 64pt — Square preview for attachment chips */
  chipPreviewSize: 64,
  /** 280pt — Welcome avatar/video size */
  welcomeAvatarSize: 280,
  /** 0.08 — Translucent white bubble fill (AI/assistant on dark) */
  assistantBubbleOpacity: 0.08,
  /** 0.3 — Translucent primary fill for user bubble */
  userBubbleOpacity: 0.3,
  /** 6pt — Tight inline gaps (image stack, voice bar, assistant UI block) */
  compactGap: 6,
  /** 72pt — Min width for the chat Send button (Figma) */
  sendButtonMinWidth: 72,
  /** 200pt — Truncate filename labels in the attachment chip tray */
  chipLabelMaxWidth: 200,
  /** 18pt — Hit target for the chip “remove” control */
  chipRemoveHitSize: 18,
  /** 6pt — Vertical padding for “Review approvals” link chip */
  parkedLinkPaddingVertical: 6,
  /** 2pt — Tight title-to-meta spacing in generative cards */
  metaSpacingTight: 2,
  /** 240pt — Generative task/action cards: min width before wrap */
  assistantUiCardMinWidth: 240,
  /** 8pt — Priority indicator dot in compact task/action cards */
  assistantPriorityDotSize: 8,
  /** 32pt — Emoji / icon in AI recommendation badge header */
  aiRecommendationIconSize: 32,
} as const;

// ---------------------------------------------------------------------------
// Chart — shared bar-chart geometry (AppBarChart)
//
// Single source of truth for the vertical bar chart used across budget, savings
// and utilities. Colors stay in `useAppColors()`; these are the theme-independent
// metrics so every chart reads identically.
// ---------------------------------------------------------------------------

export const Chart = {
  /** 180pt — default plot height */
  height: 180,
  /** 14pt — narrowest a bar may render (auto-scaled down to this) */
  barMinWidth: 14,
  /** 28pt — widest a bar may render (auto-scaled up to this) */
  barMaxWidth: 28,
  /** Plot-width divisor that sets the target bar width before clamping */
  barWidthDivisor: 1.8,
  /** Plot-width divisor that sets the gap between bars before clamping */
  barSpacingDivisor: 2.4,
  /** 8pt — minimum gap between bars */
  barMinSpacing: Spacing.sm,
  /** 4 — horizontal gridline sections above the x-axis */
  sections: 4,
  /** Above this many bars, per-bar value labels overlap — use the y-axis instead */
  maxLabelledBars: 7,
  /** 46pt — fixed value-label box so compact values ("-$3.2k") stay on one line */
  valueLabelWidth: 46,
  /** 20pt — downward nudge applied to a negative bar's value label. gifted-charts
   * already centers the (rotated) label on the bar's bottom tip, so this small
   * clearance is all that's needed to drop it clear below the bar instead of
   * colliding with the zero-line x-axis labels. */
  divergingLabelClearance: 20,
  /** 44pt — width reserved for the formatted y-axis labels */
  yAxisLabelWidth: 44,
  /** ~15% headroom above the tallest bar so its value label never clips */
  axisHeadroom: 1.15,
  /** 10pt — y-axis numeric label size (chart-library <Text>, not the Typography ramp) */
  yAxisFontSize: 10,
  /** 9pt — x-axis label size (chart-library <Text>, not the Typography ramp) */
  xAxisFontSize: 9,
  /** 9pt — per-point value label size on a line chart's opt-in "show values" mode */
  pointValueFontSize: 9,
  /** -10pt — lifts a line chart's per-point value label clear above its dot */
  pointValueShiftY: -10,
  /** 14pt — drops a line chart's per-point value label clear below its dot,
   * for a chart whose top gridlines already crowd the plotted line */
  pointValueShiftYBelow: 14,
} as const;

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

export const Accessibility = {
  /** 44pt — Minimum tappable area (WCAG / HIG) */
  minTapTarget: 44,
  /** 4.5:1 — Body contrast ratio */
  bodyContrastRatio: 4.5,
  /** 3.0:1 — Large text contrast ratio */
  largeTextContrastRatio: 3.0,
} as const;

// ---------------------------------------------------------------------------
// Typography — semantic ramp
//
// Each token captures size, weight, lineHeight, and letter spacing. Use via
// the `<TypographyV2>` component or by spreading into a `Text` style.
// ---------------------------------------------------------------------------

export interface FontToken {
  /** Font size in points */
  size: number;
  /** RN font weight string */
  weight: TextStyle['fontWeight'];
  /** Line height in points (~1.2–1.4× size) */
  lineHeight: number;
  /** Letter spacing — positive widens, negative tightens */
  letterSpacing?: number;
  /** Whether to uppercase the text */
  uppercase?: boolean;
}

export const Typography = {
  /** 34pt bold — Hero numbers, stat values */
  display: { size: 34, weight: '700', lineHeight: 41, letterSpacing: -0.5 },
  /** 28pt semibold — Screen-level titles */
  heading: { size: 28, weight: '600', lineHeight: 34, letterSpacing: -0.3 },
  /** 24pt semibold — Card titles, section headings */
  title: { size: 24, weight: '600', lineHeight: 30, letterSpacing: -0.13 },
  /** 20pt medium — Sub-section titles */
  titleSmall: { size: 20, weight: '500', lineHeight: 25 },
  /** 18pt semibold — Emphasized body */
  bodyLarge: { size: 18, weight: '600', lineHeight: 24 },
  /** 17pt semibold — Primary button labels, CTAs */
  buttonLabel: { size: 17, weight: '600', lineHeight: 22 },
  /** 16pt regular — Default body text */
  body: { size: 16, weight: '400', lineHeight: 22 },
  /** 16pt medium — Emphasized callouts */
  bodyMedium: { size: 16, weight: '500', lineHeight: 22 },
  /** 15pt medium — Card titles (small), tags, badges */
  label: { size: 15, weight: '500', lineHeight: 20 },
  /** 15pt regular — Feature descriptions */
  labelRegular: { size: 15, weight: '400', lineHeight: 20 },
  /** 14pt regular — Card descriptions, secondary body */
  bodySmall: { size: 14, weight: '400', lineHeight: 19 },
  /** 14pt medium — Card action labels */
  bodySmallMedium: { size: 14, weight: '500', lineHeight: 19 },
  /** 14pt semibold — Avatar initials, emphasized small */
  bodySmallSemibold: { size: 14, weight: '600', lineHeight: 19 },
  /** 13pt regular — Footnotes, timestamps */
  caption: { size: 13, weight: '400', lineHeight: 18 },
  /** 12pt regular — Small metadata */
  captionSmall: { size: 12, weight: '400', lineHeight: 16 },
  /** 12pt bold — Bold small labels */
  captionBold: { size: 12, weight: '700', lineHeight: 16 },
  /** 11pt medium UPPERCASE — Section markers */
  overline: { size: 11, weight: '500', lineHeight: 14, letterSpacing: 1.0, uppercase: true },
  /** 10pt medium — Tab bar labels, tiny badges */
  micro: { size: 10, weight: '500', lineHeight: 13 },
} as const satisfies Record<string, FontToken>;

export type TypographyVariant = keyof typeof Typography;

// ---------------------------------------------------------------------------
// Aggregate export — `Tokens.spacing.lg`, `Tokens.radius.lg`, etc.
// ---------------------------------------------------------------------------

export const Tokens = {
  spacing: Spacing,
  layout: Layout,
  header: Header,
  zIndex: ZIndex,
  opacity: Opacity,
  elevation: Elevation,
  legacyText: LegacyTextVariant,
  uiFoundation: UIFoundation,
  radius: CornerRadius,
  button: ButtonMetrics,
  backButton: BackButtonChrome,
  gradientButton: GradientButton,
  shadow: Shadow,
  hero: HeroImage,
  avatar: Avatar,
  emptyState: EmptyState,
  picker: Picker,
  animation: Animation,
  floatingControl: FloatingControl,
  chat: Chat,
  chart: Chart,
  tabBar: TabBar,
  icon: IconSize,
  toast: Toast,
  blur: Blur,
  sheet: Sheet,
  accessibility: Accessibility,
  typography: Typography,
} as const;

export type DesignTokens = typeof Tokens;
