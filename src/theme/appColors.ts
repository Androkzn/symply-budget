/**
 * SimpleHouse Theme-Aware Colors (`useAppColors`)
 *
 * Hook-based equivalent of Step's `Color.AppColors.*` accessors. Returns a
 * complete semantic color set that resolves against the active theme
 * (light/dark) coming out of `ThemeContext`.
 *
 * Use this instead of:
 *   - hardcoded hex values
 *   - reaching into `theme.colors.*` / `useTheme().theme.colors` ad-hoc
 *
 * Dual API collapse (Phase 5 / `color-api-unify`):
 *   Canonical path = `useAppColors()` for all UI color. `useTheme()` stays for
 *   non-color theme (spacing, typography mode, scheme). Prefer not to add new
 *   `theme.colors.*` reads; migrate call sites gradually, then thin
 *   `Theme.colors` to a thin alias of `getAppColors()` or remove it.
 *
 * Companion: `designTokens.ts` for non-color tokens (Spacing, Radius, …).
 */

import { useMemo } from 'react';

import { useAppStore } from '@stores/appStore';
import {
  ACCENT_SCHEMES,
  getDefaultAccentScheme,
  type AccentSchemeId,
  type AccentSchemeSeed,
} from '@theme/accentSchemes';
import { getPalette, hexToRgba, mixHex } from '@theme/colors';
import { useIsDarkMode } from '@theme/useIsDarkMode';

// NOTE: We intentionally do NOT import `useTheme` from `@contexts/ThemeContext`.
// ThemeContext imports `darkTheme`/`lightTheme` from `@theme/index`, which
// re-exports this file — that creates a require cycle that leaves
// `TypographyTokens` (also re-exported through @theme/index) undefined for
// consumers loaded mid-cycle. Resolving the theme mode locally below keeps
// `appColors.ts` a leaf in the dependency graph.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppColors {
  // Brand
  primary: string;
  primaryDark: string;
  primaryLight: string;
  accent: string;
  accentTeal: string;

  // Semantic
  destructive: string;
  error: string;
  success: string;
  warning: string;
  info: string;

  // Backgrounds
  backgroundMain: string;
  backgroundSecondary: string;
  backgroundHeader: string;
  detailBackground: string;
  sheetBackground: string;
  messageInputBackground: string;

  // Surfaces
  card: string;
  cardBackground: string;
  cardSubtle: string;
  pillBackground: string;
  inputFieldBackground: string;
  secondaryButtonBackground: string;
  groupedListBackground: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  // Borders
  borderColor: string;
  divider: string;

  // Interactive
  socialLoginButtonBackground: string;
  bottomNavigationBackground: string;

  // Shadows
  shadowLight: string;
  shadowMedium: string;
  shadowDark: string;

  // System palette (passthrough)
  white: string;
  black: string;
  blue: string;
  green: string;
  yellow: string;
  orange: string;
  red: string;
  purple: string;
  pink: string;

  // Chat
  chatUserBubble: string;
  chatAssistantBubble: string;
  chatSuggestionBubble: string;
  chatInputBackground: string;
  chatInputBorder: string;

  // Status (task badges)
  statusSoon: string;
  statusSoonBg: string;
  statusOverdue: string;
  statusOverdueBg: string;
  statusPastDue: string;
  statusPastDueBg: string;
  statusComplete: string;
  statusCompleteBg: string;

  // Data-viz accents — used by chart bars/lines inside chat (AI coach visuals
  // in screenshots). Pair semantically: warm vs cool vs alert.
  chartWarm: string;        // orange — primary bars
  chartCool: string;        // cyan — secondary bars / lines
  chartAlert: string;       // coral red — emphasis
  chartNeutral: string;     // muted slate — gridlines
  /**
   * "Negative value" bar/fill color for sign-split charts (e.g. Budget's net
   * savings trend). Scheme-bound: pairs with `primary` as the accent scheme's
   * second color (coral / terracotta). Distinct from `error` — that stays the
   * fixed semantic red everywhere (validation, destructive actions, negative
   * amount text) regardless of scheme, so error recognizability never moves.
   */
  chartNegative: string;

  // Chat / media surfaces (overlays, placeholders — theme-aware tints)
  mediaOverlayScrim: string;       // over images, video controls, upload spinners
  mediaImagePlaceholder: string;  // under image previews & chip thumbs
  personaVideoPlaceholder: string; // behind persona video / default avatar
  /** Light red fill for low-emphasis destructive actions in chat (vs solid error) */
  destructiveSubtle: string;

  /** `ScreenHeader` — notification bell soft pill + hairline */
  headerNotificationBackground: string;
  headerNotificationBorder: string;

  /** Selected row/card tint (e.g. contractor pickers, category tiles) */
  surfaceSelected: string;
  /** Segmented-control / filter-tab active thumb — soft green highlight */
  segmentActiveBackground: string;
  /** Primary CTA in disabled / inactive state */
  actionDisabled: string;

  /** Full-screen dim behind modals / bottom sheets */
  modalBackdrop: string;
  /** Scrim on top of `BlurView` tab bars (light/dark) */
  tabBarBlurScrim: string;
  /** Mid-weight overlay (e.g. property switcher) — not full `modalBackdrop` */
  overlayDim: string;
}

// ---------------------------------------------------------------------------
// Light / Dark resolvers
// ---------------------------------------------------------------------------

function buildLight(seed: AccentSchemeSeed): AppColors {
  const palette = getPalette(seed.id);
  return {
    // Brand — SimpleHouse pastel teal (Schedule button) is the primary
    // brand color across CTAs, focus states, and chat user bubbles.
    primary: palette.pastel.teal,           // #4ECDC4
    primaryLight: seed.primaryLight,
    primaryDark: palette.pastel.tealDark,   // #3DBDB5
    accent: palette.blue[500],              // #007AFF
    accentTeal: palette.pastel.teal,

    // Data viz
    chartWarm: '#FF8C42',
    chartCool: '#4ECDC4',
    chartAlert: '#E74C3C',
    chartNeutral: palette.gray[300],
    // classic's chart negative bar stays pixel-identical to today's `error` red;
    // non-classic schemes override it below to the scheme's `secondaryAccent`.
    chartNegative: palette.semantic.error,

    mediaOverlayScrim: 'rgba(0,0,0,0.45)',
    mediaImagePlaceholder: 'rgba(0,0,0,0.05)',
    personaVideoPlaceholder: '#F0E6D2',
    destructiveSubtle: '#FEE2E2',

    headerNotificationBackground: '#D4F5E9',
    headerNotificationBorder: 'rgba(255, 255, 255, 0.5)',

    surfaceSelected: 'rgba(0, 122, 255, 0.1)',
    // Teal tint of the brand color — stronger than a barely-there wash so the
    // active tab reads clearly against its unselected siblings, but well short
    // of the solid primary used on CTAs like the "Manage" button.
    segmentActiveBackground: '#B8EBE7',
    actionDisabled: '#C7C7CC',

    modalBackdrop: 'rgba(0, 0, 0, 0.5)',
    tabBarBlurScrim: 'rgba(255, 255, 255, 0.7)',
    overlayDim: 'rgba(0, 0, 0, 0.4)',

    // Semantic
    destructive: palette.semantic.error,
    error: palette.semantic.error,
    success: palette.semantic.success,
    warning: palette.semantic.warning,
    info: palette.semantic.info,

    // Backgrounds — premium light: #FFFFFF/#F8F8F8 sheets, white cards w/ shadow
    backgroundMain: palette.system.systemBackground,            // #FFFFFF
    backgroundSecondary: palette.system.secondarySystemBackground, // #F2F2F7
    backgroundHeader: palette.system.systemBackground,
    detailBackground: '#FAFAFA',
    sheetBackground: '#FFFFFF',
    messageInputBackground: '#F0F0F0',

    // Surfaces
    card: '#FFFFFF',
    cardBackground: '#FFFFFF',
    cardSubtle: 'rgba(0,0,0,0.03)',
    pillBackground: '#E8E8E8',
    inputFieldBackground: 'rgba(0,0,0,0.04)',
    secondaryButtonBackground: 'rgba(120,120,128,0.16)',
    groupedListBackground: palette.gray[100],

    // Text
    textPrimary: palette.system.label,             // #000000
    textSecondary: '#666666',
    textTertiary: palette.gray[400],

    // Borders
    borderColor: palette.system.opaqueSeparator,   // #C6C6C8
    divider: palette.gray[200],

    // Interactive
    socialLoginButtonBackground: palette.gray[100],
    bottomNavigationBackground: '#FFFFFFEE',

    // Shadows — light mode opacity 0.08 (premium, not harsh)
    shadowLight: 'rgba(0,0,0,0.08)',
    shadowMedium: 'rgba(0,0,0,0.10)',
    shadowDark: 'rgba(0,0,0,0.15)',

    // System palette
    white: palette.system.white,
    black: palette.system.black,
    blue: palette.blue[500],
    green: palette.semantic.success,
    yellow: '#FFCC00',
    orange: palette.semantic.warning,
    red: palette.semantic.error,
    purple: '#AF52DE',
    pink: '#FF2D55',

    // Chat — user bubble: pastel teal at 30%; assistant: subtle gray surface
    chatUserBubble: palette.pastel.teal,
    chatAssistantBubble: '#F2F2F7',
    chatSuggestionBubble: 'rgba(0,0,0,0.05)',
    chatInputBackground: '#F0F0F0',
    chatInputBorder: palette.system.opaqueSeparator,

    // Status — light tier
    statusSoon: palette.status.soon,
    statusSoonBg: palette.status.soonBg,
    statusOverdue: palette.status.overdue,
    statusOverdueBg: palette.status.overdueBg,
    statusPastDue: palette.status.pastDue,
    statusPastDueBg: palette.status.pastDueBg,
    statusComplete: palette.status.complete,
    statusCompleteBg: palette.status.completeBg,

    ...accentOverridesLight(seed),
  };
}

function buildDark(seed: AccentSchemeSeed): AppColors {
  const palette = getPalette(seed.id);
  return {
    primary: palette.pastel.teal,
    primaryLight: seed.primaryLight,
    primaryDark: palette.pastelDark.tealDark,
    accent: palette.blue[400],
    accentTeal: palette.pastel.teal,

    // Data viz — vibrant, premium-feeling on dark
    chartWarm: '#FF8C42',
    chartCool: '#5AC8FA',
    chartAlert: '#FF453A',
    chartNeutral: '#3A3A3C',
    chartNegative: palette.semantic.error,

    mediaOverlayScrim: 'rgba(0,0,0,0.45)',
    mediaImagePlaceholder: 'rgba(255,255,255,0.06)',
    personaVideoPlaceholder: '#2A2620',
    destructiveSubtle: 'rgba(255, 69, 58, 0.22)',

    headerNotificationBackground: 'rgba(48, 209, 88, 0.22)',
    headerNotificationBorder: 'rgba(255, 255, 255, 0.12)',

    surfaceSelected: 'rgba(10, 132, 255, 0.2)',
    // Muted brand teal (#4ECDC4) — stronger than the light-mode wash equivalent
    // so the active tab reads clearly, short of a solid CTA fill.
    segmentActiveBackground: 'rgba(78, 205, 196, 0.4)',
    actionDisabled: '#48484A',

    modalBackdrop: 'rgba(0, 0, 0, 0.5)',
    tabBarBlurScrim: 'rgba(0, 0, 0, 0.3)',
    overlayDim: 'rgba(0, 0, 0, 0.4)',

    destructive: palette.semantic.error,
    error: palette.semantic.error,
    success: palette.semantic.success,
    warning: palette.semantic.warning,
    info: palette.semantic.info,

    backgroundMain: palette.systemDark.systemBackground,            // #000000
    backgroundSecondary: palette.systemDark.secondarySystemBackground, // #1C1C1E
    backgroundHeader: palette.systemDark.systemBackground,
    detailBackground: '#202124',
    sheetBackground: '#1C1C1E',
    messageInputBackground: '#171717',

    card: '#202632',
    cardBackground: 'rgba(255,255,255,0.06)',
    cardSubtle: 'rgba(255,255,255,0.05)',
    pillBackground: '#292B2F',
    inputFieldBackground: 'rgba(255,255,255,0.06)',
    secondaryButtonBackground: 'rgba(120,120,128,0.32)',
    groupedListBackground: 'rgba(255,255,255,0.06)',

    textPrimary: palette.systemDark.label,         // #FFFFFF
    textSecondary: '#9CA3AF',
    textTertiary: palette.gray[500],

    borderColor: palette.systemDark.opaqueSeparator, // #38383A
    divider: '#38383A',

    socialLoginButtonBackground: '#1C1C1E',
    bottomNavigationBackground: 'rgba(28,28,30,0.92)',

    shadowLight: 'rgba(0,0,0,0.30)',
    shadowMedium: 'rgba(0,0,0,0.20)',
    shadowDark: 'rgba(0,0,0,0.50)',

    white: palette.system.white,
    black: palette.system.black,
    blue: palette.blue[400],
    green: '#30D158',
    yellow: '#FFD60A',
    orange: '#FF9F0A',
    red: '#FF453A',
    purple: '#BF5AF2',
    pink: '#FF375F',

    // Chat:
    //   user bubble: pastel teal at low opacity (warm glow shows through)
    //   assistant: subtle translucent white panel on dark
    //   input: dark pill with hairline border
    chatUserBubble: 'rgba(78,205,196,0.30)',          // pastel.teal × 30%
    chatAssistantBubble: 'rgba(255,255,255,0.06)',
    chatSuggestionBubble: 'rgba(255,255,255,0.08)',
    chatInputBackground: 'rgba(255,255,255,0.06)',
    chatInputBorder: 'rgba(255,255,255,0.12)',

    statusSoon: palette.statusDark.soon,
    statusSoonBg: palette.statusDark.soonBg,
    statusOverdue: palette.statusDark.overdue,
    statusOverdueBg: palette.statusDark.overdueBg,
    statusPastDue: palette.statusDark.pastDue,
    statusPastDueBg: palette.statusDark.pastDueBg,
    statusComplete: palette.statusDark.complete,
    statusCompleteBg: palette.statusDark.completeBg,

    ...accentOverridesDark(seed),
  };
}

/**
 * "Clean" schema — always-light skin used for app content (tabs). Built on the
 * light surface, then re-tinted so cards/panels never sit as pure white on the
 * solid-white app background (which vanishes next to the #4ECDC4 mint accent).
 * All surface/border values come from `palette.clean.*` — see AppearanceScreen.
 */
function buildClean(seed: AccentSchemeSeed): AppColors {
  const palette = getPalette(seed.id);
  return {
    ...buildLight(seed),

    // Backgrounds — solid white base, off-white panels
    backgroundMain: palette.clean.background,            // #FFFFFF
    backgroundSecondary: palette.clean.surface,          // #F7FAFA
    backgroundHeader: palette.clean.background,
    detailBackground: palette.clean.surfaceSecondary,    // #F2F8F7
    sheetBackground: palette.clean.surfaceSecondary,
    messageInputBackground: palette.clean.surfaceSecondary,

    // Surfaces — cards/sections use the off-white surface, not #FFFFFF
    card: palette.clean.surface,                         // #F7FAFA
    cardBackground: palette.clean.surface,
    cardSubtle: palette.clean.subtle,                    // #F5F5F2
    pillBackground: palette.clean.highlight,             // #EAF7F5
    inputFieldBackground: palette.clean.surfaceSecondary,
    secondaryButtonBackground: palette.clean.surfaceSecondary,
    groupedListBackground: palette.clean.surface,

    // Borders / dividers — soft mint-gray, visible without harsh gray
    borderColor: palette.clean.border,                   // #DDEBE9
    divider: palette.clean.border,

    // Selected / highlight tint keeps the accent feeling connected
    surfaceSelected: palette.clean.highlight,            // #EAF7F5
    headerNotificationBackground: palette.clean.highlight,
    // segmentActiveBackground: inherited from the `...buildLight(seed)` spread
    // above (same value there today; scheme-derived for non-classic schemes).

    // Chat surfaces align to the clean palette
    chatAssistantBubble: palette.clean.surfaceSecondary,
    chatSuggestionBubble: palette.clean.subtle,
    chatInputBackground: palette.clean.surfaceSecondary,
    chatInputBorder: palette.clean.border,

    socialLoginButtonBackground: palette.clean.surface,
  };
}

// ---------------------------------------------------------------------------
// Accent-scheme overrides — the handful of literal tints that are supposed to
// track the brand accent but were hand-picked hex (see colors.ts's
// CLASSIC_CLEAN_SURFACES for the same pattern). `classic` keeps them as
// literals (byte-identical to the app before accent schemes existed);
// non-classic schemes derive them from the seed via the shared mixHex/
// hexToRgba helpers — one formula, not three hand-tuned sets.
// ---------------------------------------------------------------------------

function accentOverridesLight(seed: AccentSchemeSeed): Partial<AppColors> {
  if (seed.id === 'classic') return {};
  return {
    chartNegative: seed.secondaryAccent,
    chartCool: seed.primary,
    segmentActiveBackground: mixHex('#FFFFFF', seed.primary, 0.4),
    headerNotificationBackground: mixHex('#FFFFFF', seed.primary, 0.14),
    chatUserBubble: seed.primary,
  };
}

function accentOverridesDark(seed: AccentSchemeSeed): Partial<AppColors> {
  if (seed.id === 'classic') return {};
  return {
    chartNegative: seed.secondaryAccent,
    chartCool: seed.primaryLight,
    segmentActiveBackground: hexToRgba(seed.primary, 0.4),
    chatUserBubble: hexToRgba(seed.primary, 0.3),
  };
}

// ---------------------------------------------------------------------------
// Cache — memoized per accent scheme (3 schemes max today, built once each).
// ---------------------------------------------------------------------------

const COLOR_CACHE = new Map<AccentSchemeId, { light: AppColors; dark: AppColors; clean: AppColors }>();

function getColorSet(schemeId: AccentSchemeId) {
  // Falls back to `classic` for an unrecognized/missing id — see getPalette's
  // doc comment in colors.ts for why this can legitimately happen at runtime.
  const resolvedId = ACCENT_SCHEMES[schemeId] ? schemeId : 'classic';
  let set = COLOR_CACHE.get(resolvedId);
  if (!set) {
    const seed = ACCENT_SCHEMES[resolvedId];
    set = { light: buildLight(seed), dark: buildDark(seed), clean: buildClean(seed) };
    COLOR_CACHE.set(resolvedId, set);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the active theme's semantic color surface.
 *
 * Components and screens should prefer this over `theme.colors.*`. It mirrors
 * the iOS reference (`Color.AppColors.*`) so the same tokens work in both
 * codebases when porting screens.
 *
 * Resolves dark mode via the shared `useIsDarkMode` leaf hook (same logic as
 * `ThemeContext`), and the accent scheme via `appStore` directly (not
 * `useTheme()`) to avoid a require cycle through `@theme/index → ./appColors
 * → ThemeContext`.
 */
export function useAppColors(): AppColors {
  const isDark = useIsDarkMode();
  const accentScheme = useAppStore((s) => s.accentScheme);
  // Unified flat skin: the app follows light/dark everywhere. Light mode uses
  // the clean off-white surfaces; dark mode uses the true-dark surfaces. The
  // legacy `house`/`clean` schema no longer affects color resolution.
  return useMemo(() => {
    const set = getColorSet(accentScheme);
    return isDark ? set.dark : set.clean;
  }, [isDark, accentScheme]);
}

/**
 * Static accessors for cases where a hook can't be called (e.g. inside a
 * StyleSheet.create at module scope). Resolves against the **light** theme
 * and the brand's default accent scheme by default — pass `mode`/`schemeId`
 * to opt into another combination.
 *
 * Prefer `useAppColors()` whenever possible; this is an escape hatch.
 */
export function getAppColors(
  mode: 'light' | 'dark' | 'clean' = 'light',
  schemeId: AccentSchemeId = getDefaultAccentScheme()
): AppColors {
  const set = getColorSet(schemeId);
  if (mode === 'clean') return set.clean;
  return mode === 'dark' ? set.dark : set.light;
}
