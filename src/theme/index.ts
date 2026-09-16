import {
  Theme,
  ThemeColors,
  PastelColors,
  StatusColors,
  CategoryColors,
} from '../types';

import { getDefaultAccentScheme, type AccentSchemeId } from './accentSchemes';
import { getPalette } from './colors';

const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 20,
  full: 9999,
} as const;

const typography = {
  fontFamily: {
    regular: 'System',
    medium: 'System',
    bold: 'System',
  },
  fontSize: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 28,
  },
} as const;

function buildThemeSet(schemeId: AccentSchemeId) {
  const palette = getPalette(schemeId);

const lightColors: ThemeColors = {
  // Brand accent is the mint-teal (`palette.pastel.teal`, matching
  // `useAppColors().primary`). The legacy theme previously pointed `primary` at
  // iOS blue, which made links/labels ("See All", "View all", …) render blue and
  // clash with the teal brand — unified to teal so interactive labels are green.
  primary: palette.pastel.teal,
  primaryLight: palette.clean.highlight,
  secondary: palette.pastel.tealDark,
  background: palette.system.systemBackground,
  surface: palette.system.secondarySystemBackground,
  surfaceSecondary: palette.gray[100],
  error: palette.semantic.error,
  success: palette.semantic.success,
  warning: palette.semantic.warning,
  text: palette.system.label,
  textSecondary: palette.gray[500],
  textTertiary: palette.gray[400],
  border: palette.system.opaqueSeparator,
  disabled: palette.gray[400],
  placeholder: palette.gray[400],
  backdrop: 'rgba(0, 0, 0, 0.5)',
  notification: palette.semantic.error,
};

// "Clean" schema — light surface re-tinted so cards/panels don't disappear as
// pure white on the solid-white app background (see `palette.clean`).
const cleanColors: ThemeColors = {
  ...lightColors,
  background: palette.clean.background,           // #FFFFFF
  surface: palette.clean.surface,                 // #F7FAFA
  surfaceSecondary: palette.clean.surfaceSecondary, // #F2F8F7
  border: palette.clean.border,                   // #DDEBE9
};

const darkColors: ThemeColors = {
  // See lightColors — unified onto the mint-teal brand accent.
  primary: palette.pastel.teal,
  primaryLight: 'rgba(78, 205, 196, 0.22)',
  secondary: palette.pastel.tealLight,
  background: palette.systemDark.systemBackground,
  surface: palette.systemDark.secondarySystemBackground,
  surfaceSecondary: palette.gray[800],
  error: palette.semantic.error,
  success: palette.semantic.success,
  warning: palette.semantic.warning,
  text: palette.systemDark.label,
  textSecondary: palette.gray[400],
  textTertiary: palette.gray[500],
  border: palette.systemDark.opaqueSeparator,
  disabled: palette.gray[600],
  placeholder: palette.gray[500],
  backdrop: 'rgba(0, 0, 0, 0.7)',
  notification: palette.semantic.error,
};

// iOS 26 Pastel colors
const lightPastel: PastelColors = {
  skyBlue: palette.pastel.skyBlue,
  teal: palette.pastel.teal,
  tealLight: palette.pastel.tealLight,
  tealDark: palette.pastel.tealDark,
  softWhite: palette.pastel.softWhite,
  warmGray: palette.pastel.warmGray,
  cloudBlue: palette.pastel.cloudBlue,
  cream: palette.pastel.cream,
  purple: '#C4B5FD',
  green: '#86EFAC',
  orange: '#FED7AA',
};

const darkPastel: PastelColors = {
  skyBlue: palette.pastelDark.skyBlue,
  teal: palette.pastelDark.teal,
  tealLight: palette.pastelDark.tealLight,
  tealDark: palette.pastelDark.tealDark,
  softWhite: palette.pastelDark.softWhite,
  warmGray: palette.pastelDark.warmGray,
  cloudBlue: palette.pastelDark.cloudBlue,
  cream: palette.pastelDark.cream,
  purple: '#8B5CF6',
  green: '#22C55E',
  orange: '#FB923C',
};

// Status badge colors
const lightStatus: StatusColors = {
  soon: palette.status.soon,
  soonBg: palette.status.soonBg,
  overdue: palette.status.overdue,
  overdueBg: palette.status.overdueBg,
  pastDue: palette.status.pastDue,
  pastDueBg: palette.status.pastDueBg,
  complete: palette.status.complete,
  completeBg: palette.status.completeBg,
};

const darkStatus: StatusColors = {
  soon: palette.statusDark.soon,
  soonBg: palette.statusDark.soonBg,
  overdue: palette.statusDark.overdue,
  overdueBg: palette.statusDark.overdueBg,
  pastDue: palette.statusDark.pastDue,
  pastDueBg: palette.statusDark.pastDueBg,
  complete: palette.statusDark.complete,
  completeBg: palette.statusDark.completeBg,
};

// Category colors
const lightCategory: CategoryColors = {
  hvac: palette.category.hvac,
  hvacBg: palette.category.hvacBg,
  cleaning: palette.category.cleaning,
  cleaningBg: palette.category.cleaningBg,
  safety: palette.category.safety,
  safetyBg: palette.category.safetyBg,
  plumbing: palette.category.plumbing,
  plumbingBg: palette.category.plumbingBg,
  electrical: palette.category.electrical,
  electricalBg: palette.category.electricalBg,
  exterior: palette.category.exterior,
  exteriorBg: palette.category.exteriorBg,
  general: palette.category.general,
  generalBg: palette.category.generalBg,
};

const darkCategory: CategoryColors = {
  hvac: palette.categoryDark.hvac,
  hvacBg: palette.categoryDark.hvacBg,
  cleaning: palette.categoryDark.cleaning,
  cleaningBg: palette.categoryDark.cleaningBg,
  safety: palette.categoryDark.safety,
  safetyBg: palette.categoryDark.safetyBg,
  plumbing: palette.categoryDark.plumbing,
  plumbingBg: palette.categoryDark.plumbingBg,
  electrical: palette.categoryDark.electrical,
  electricalBg: palette.categoryDark.electricalBg,
  exterior: palette.categoryDark.exterior,
  exteriorBg: palette.categoryDark.exteriorBg,
  general: palette.categoryDark.general,
  generalBg: palette.categoryDark.generalBg,
};

  const lightTheme: Theme = {
    dark: false,
    colors: lightColors,
    pastel: lightPastel,
    status: lightStatus,
    category: lightCategory,
    spacing,
    borderRadius,
    typography,
  };

  const darkTheme: Theme = {
    dark: true,
    colors: darkColors,
    pastel: darkPastel,
    status: darkStatus,
    category: darkCategory,
    spacing,
    borderRadius,
    typography,
  };

  // Default app-content skin — always light, off-white surfaces.
  const cleanTheme: Theme = {
    dark: false,
    colors: cleanColors,
    pastel: lightPastel,
    status: lightStatus,
    category: lightCategory,
    spacing,
    borderRadius,
    typography,
  };

  return { light: lightTheme, dark: darkTheme, clean: cleanTheme };
}

export type ThemeVariant = 'light' | 'dark' | 'clean';

const THEME_CACHE = new Map<AccentSchemeId, ReturnType<typeof buildThemeSet>>();

function getThemeSet(schemeId: AccentSchemeId) {
  let set = THEME_CACHE.get(schemeId);
  if (!set) {
    set = buildThemeSet(schemeId);
    THEME_CACHE.set(schemeId, set);
  }
  return set;
}

/** Scheme-aware `Theme` (legacy `theme.colors.*` / `theme.pastel.*` shape). Memoized per scheme. */
export function getTheme(schemeId: AccentSchemeId, variant: ThemeVariant): Theme {
  return getThemeSet(schemeId)[variant];
}

// Back-compat static exports (this brand's default scheme) for callers that
// import `lightTheme`/`darkTheme`/`cleanTheme` directly instead of the
// scheme-aware `getTheme()` — e.g. static fixtures in tests.
const DEFAULT_THEME_SET = getThemeSet(getDefaultAccentScheme());
export const lightTheme = DEFAULT_THEME_SET.light;
export const darkTheme = DEFAULT_THEME_SET.dark;
export const cleanTheme = DEFAULT_THEME_SET.clean;

export {
  ACCENT_SCHEMES,
  ACCENT_SCHEME_ORDER,
  getDefaultAccentScheme,
  hasMultipleAccentSchemes,
  type AccentSchemeId,
  type AccentSchemeSeed,
} from './accentSchemes';
export {
  palette,
  getPalette,
  hexToRgba,
  mixHex,
  AVATAR_HASH_BACKGROUNDS,
  REPORT_SEVERITY,
  AI_DISCLAIMER,
} from './colors';
export type { Theme, ThemeColors } from '../types';

// SimpleHouse design system (tokens + theme-aware colors + typography helpers).
// See: documents/Design and UX/DesignSystem.md
export {
  Tokens,
  Spacing,
  Layout,
  Header,
  ZIndex,
  Opacity,
  Elevation,
  LegacyTextVariant,
  UIFoundation,
  CornerRadius,
  ButtonMetrics,
  BackButtonChrome,
  BackButtonFill,
  GradientButton,
  Shadow,
  HeroImage,
  Avatar,
  EmptyState,
  Picker,
  Animation,
  FloatingControl,
  Chat,
  IconSize,
  TabBar,
  Toast,
  Blur,
  Sheet,
  Accessibility,
  Typography as TypographyTokens,
  type FontToken,
  type TypographyVariant,
  type DesignTokens,
} from './designTokens';

export { useAppColors, getAppColors, type AppColors } from './appColors';
export {
  categoryRampColor,
  seriesColor,
  chatSliceColor,
  chatSliceColorFromTheme,
} from './chartPalette';
export {
  getButtonGradientColors,
  type ButtonGradientVariant,
} from './buttonGradients';
export { useIsDarkMode } from './useIsDarkMode';

export { scaledFont, TypographyV2, type TypographyV2Props } from './typography';
