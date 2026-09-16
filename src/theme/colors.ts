// iOS 26+ inspired color palette with modern design system
// Brand primary colors come from the active accent scheme (`classic` mirrors
// the active brand pack `@brand`; see `accentSchemes.ts`).

import { ACCENT_SCHEMES, getDefaultAccentScheme, type AccentSchemeId, type AccentSchemeSeed } from './accentSchemes';

/** Converts a `#RRGGBB` token to an `rgba()` string at the given alpha (0-1). */
export function hexToRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Mixes a `#RRGGBB` hex toward a target `#RRGGBB` by `t` (0-1) and returns a
 * solid `#RRGGBB`. Used to derive tint/shade ramps from a single brand token
 * (e.g. a family of teal shades from `pastel.teal`) so related UI reads as one
 * color at different intensities. `t=0` returns `hex`, `t=1` returns `target`.
 */
export function mixHex(hex: string, target: string, t: number): string {
  const parse = (h: string): [number, number, number] => {
    const s = h.replace('#', '');
    return [
      parseInt(s.substring(0, 2), 16),
      parseInt(s.substring(2, 4), 16),
      parseInt(s.substring(4, 6), 16),
    ];
  };
  const clamped = Math.max(0, Math.min(1, t));
  const [r1, g1, b1] = parse(hex);
  const [r2, g2, b2] = parse(target);
  const channel = (a: number, b: number) =>
    Math.round(a + (b - a) * clamped)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r1, r2)}${channel(g1, g2)}${channel(b1, b2)}`;
}

// Today's exact "clean schema" surface tints (see AppearanceScreen) — kept as
// literal constants (not derived) so the `classic` scheme renders byte-
// identical to the app before accent schemes existed. Alternate schemes
// derive their own surfaces from the seed's `primary` via `mixHex` below —
// one formula reused for every non-classic scheme, instead of hand-tuning
// each tint per scheme.
const CLASSIC_CLEAN_SURFACES = {
  surface: '#F7FAFA',
  surfaceSecondary: '#F2F8F7',
  highlight: '#EAF7F5',
  border: '#DDEBE9',
} as const;

function accentCleanSurfaces(primary: string) {
  return {
    surface: mixHex('#FFFFFF', primary, 0.03),
    surfaceSecondary: mixHex('#FFFFFF', primary, 0.06),
    highlight: mixHex('#FFFFFF', primary, 0.1),
    border: mixHex('#FFFFFF', primary, 0.2),
  };
}

function buildPalette(seed: AccentSchemeSeed) {
  const { primary, primaryDark, primaryLight, primaryOnDark, primaryDarkOnDark } = seed;
  const cleanSurfaces = seed.id === 'classic' ? CLASSIC_CLEAN_SURFACES : accentCleanSurfaces(primary);

  return {
  // Primary colors
  blue: {
    50: '#EBF5FF',
    100: '#D6EBFF',
    200: '#ADD6FF',
    300: '#85C2FF',
    400: '#5CADFF',
    500: '#007AFF', // iOS primary blue
    600: '#0066D6',
    700: '#0052AD',
    800: '#003D85',
    900: '#00295C',
  },

  // Grayscale
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
  },

  // Semantic colors
  semantic: {
    success: '#34C759',
    warning: '#FF9500',
    error: '#FF3B30',
    info: '#5856D6',
  },

  // iOS 26 Pastel M3 Colors (Light Mode) — teal slots are brand primary
  pastel: {
    skyBlue: '#E8F4FD', // Light background
    teal: primary, // Primary accent (Schedule button)
    tealLight: primaryLight, // Lighter brand
    tealDark: primaryDark, // Darker brand
    softWhite: '#FAFBFC', // Card backgrounds
    warmGray: '#F5F5F7', // Section backgrounds
    cloudBlue: '#87CEEB', // Header gradient
    cream: '#FFFEF5', // Warm white variant
  },

  // "Clean" schema surfaces — always-light skin tuned for the brand primary.
  // Pure-white cards vanish on a white app background, so cards and
  // panels use warm/cool off-whites for separation. See AppearanceScreen.
  clean: {
    background: '#FFFFFF',              // Main app background — clean white base
    surface: cleanSurfaces.surface,           // Cards / sections — very light, slightly cool
    surfaceSecondary: cleanSurfaces.surfaceSecondary, // Secondary panels — subtle accent tint, still clean
    highlight: cleanSurfaces.highlight,       // Highlight background — connected to the accent primary
    subtle: '#F5F5F2',                  // Disabled / subtle blocks — warm off-white, less clinical
    border: cleanSurfaces.border,             // Borders / dividers — soft visible border, no harsh gray
  },

  // Button gradient colors
  button: {
    teal: primary,
    tealDark: primaryDark,
    // Hue-spanning ramp (bright azure-cyan → deep royal blue) so the blue
    // secondary CTA reads as rich as the brand `cta` gradient's green→teal
    // travel, not a near-flat single-hue fill.
    blue: '#3FC4F0',
    blueMid: '#2E86E0',
    blueDark: '#2A5BD0',
    orange: '#FFB74D',
    orangeDark: '#FF9500',
  },

  // iOS 26 Pastel M3 Colors (Dark Mode)
  pastelDark: {
    skyBlue: '#1A2634',
    teal: primaryOnDark,
    tealLight: primary,
    tealDark: primaryDarkOnDark,
    softWhite: '#1C1C1E',
    warmGray: '#2C2C2E',
    cloudBlue: '#2A4A5E',
    cream: '#1E1D1A',
  },

  // Task Status Badge Colors (Light Mode)
  status: {
    soon: '#FFB800', // Yellow "Soon" badge text
    soonBg: '#FFF8E1', // Yellow "Soon" badge background
    overdue: '#FF6B35', // Orange "Overdue" badge text
    overdueBg: '#FFEBE5', // Orange "Overdue" badge background
    pastDue: '#DC3545', // Red "Past Due" badge text
    pastDueBg: '#FFE5E8', // Red "Past Due" badge background
    complete: '#34C759', // Green "Complete" badge text
    completeBg: '#E8F8ED', // Green "Complete" badge background
  },

  // Task Status Badge Colors (Dark Mode)
  statusDark: {
    soon: '#FFD54F',
    soonBg: '#3D3520',
    overdue: '#FF8A65',
    overdueBg: '#3D2520',
    pastDue: '#EF5350',
    pastDueBg: '#3D2020',
    complete: '#66BB6A',
    completeBg: '#203D25',
  },

  // Task Category Icon Colors
  category: {
    hvac: primary, // Brand primary for HVAC
    hvacBg: '#E0F7F5',
    cleaning: '#FF9500', // Orange for cleaning/gutters
    cleaningBg: '#FFF3E0',
    safety: '#FF3B30', // Red for smoke detectors/safety
    safetyBg: '#FFEBEE',
    plumbing: '#007AFF', // Blue for plumbing
    plumbingBg: '#E3F2FD',
    electrical: '#FFD600', // Yellow for electrical
    electricalBg: '#FFFDE7',
    exterior: '#8BC34A', // Green for exterior
    exteriorBg: '#F1F8E9',
    general: '#9E9E9E', // Gray for general
    generalBg: '#F5F5F5',
  },

  // Task Category Icon Colors (Dark Mode)
  categoryDark: {
    hvac: primary,
    hvacBg: '#1A3533',
    cleaning: '#FFB74D',
    cleaningBg: '#3D2E1A',
    safety: '#EF5350',
    safetyBg: '#3D1A1A',
    plumbing: '#5CADFF',
    plumbingBg: '#1A2A3D',
    electrical: '#FFEE58',
    electricalBg: '#3D3D1A',
    exterior: '#AED581',
    exteriorBg: '#2A3D1A',
    general: '#BDBDBD',
    generalBg: '#2A2A2A',
  },

  // iOS system colors
  system: {
    white: '#FFFFFF',
    black: '#000000',
    clear: 'transparent',
    systemBackground: '#FFFFFF',
    secondarySystemBackground: '#F2F2F7',
    tertiarySystemBackground: '#FFFFFF',
    systemGroupedBackground: '#F2F2F7',
    secondarySystemGroupedBackground: '#FFFFFF',
    tertiarySystemGroupedBackground: '#F2F2F7',
    label: '#000000',
    secondaryLabel: '#3C3C43',
    tertiaryLabel: '#3C3C43',
    quaternaryLabel: '#3C3C43',
    separator: '#3C3C43',
    opaqueSeparator: '#C6C6C8',
  },

  // iOS dark mode system colors
  systemDark: {
    systemBackground: '#000000',
    secondarySystemBackground: '#1C1C1E',
    tertiarySystemBackground: '#2C2C2E',
    systemGroupedBackground: '#000000',
    secondarySystemGroupedBackground: '#1C1C1E',
    tertiarySystemGroupedBackground: '#2C2C2E',
    label: '#FFFFFF',
    secondaryLabel: '#EBEBF5',
    tertiaryLabel: '#EBEBF5',
    quaternaryLabel: '#EBEBF5',
    separator: '#38383A',
    opaqueSeparator: '#38383A',
  },
  } as const;
}

const PALETTE_CACHE = new Map<AccentSchemeId, ReturnType<typeof buildPalette>>();

/**
 * Scheme-aware palette. Memoized — 3 schemes max, built once each. Falls back
 * to `classic` for an unrecognized/missing id (e.g. a test's hand-rolled
 * `@stores/appStore` mock that predates this field, or a not-yet-hydrated
 * persisted value) rather than throwing — `accentScheme` flows in from
 * persisted storage and mocks, so it isn't guaranteed valid at runtime the
 * way the type suggests.
 */
export function getPalette(schemeId: AccentSchemeId = getDefaultAccentScheme()) {
  const resolvedId = ACCENT_SCHEMES[schemeId] ? schemeId : 'classic';
  let cached = PALETTE_CACHE.get(resolvedId);
  if (!cached) {
    cached = buildPalette(ACCENT_SCHEMES[resolvedId]);
    PALETTE_CACHE.set(resolvedId, cached);
  }
  return cached;
}

/**
 * Static default-scheme palette, for the rare module-scope caller that can't
 * take a scheme (e.g. inside `StyleSheet.create`). Resolves to `classic` for
 * every brand except Budget (whose default is `tealCoral`) — safe because the
 * only static importers left (grepped during the accent-scheme rollout) read
 * brand-neutral fields (`gray`, `system`, `semantic`) that don't vary by
 * scheme. Prefer `useAppColors()` / `getPalette(schemeId)` wherever the active
 * user selection matters.
 */
export const palette = getPalette();

/**
 * User initials avatar backgrounds (hash pick). Centralized; use from Avatar only.
 */
export const AVATAR_HASH_BACKGROUNDS: readonly string[] = [
  palette.pastel.teal,
  '#FF6B6B',
  palette.pastel.tealLight,
  '#45B7D1',
  '#FFA07A',
  '#98D8C8',
  '#6C5CE7',
  '#A29BFE',
];

/** Report finding severity (badges) — not theme-flipped; use for card chips only. */
export const REPORT_SEVERITY = {
  critical: { text: '#DC2626' as const, bg: '#FEE2E2' as const },
  major: { text: '#D97706' as const, bg: '#FEF3C7' as const },
  minor: { text: '#2563EB' as const, bg: '#DBEAFE' as const },
  informational: { text: '#6B7280' as const, bg: '#F3F4F6' as const },
} as const;

/** AI disclaimer warning strip (static contrast pair) */
export const AI_DISCLAIMER = {
  warningBg: '#FEF3C7',
  warningBorder: '#F59E0B',
  warningText: '#92400E',
} as const;

export type Palette = ReturnType<typeof buildPalette>;
export type { AccentSchemeId, AccentSchemeSeed } from './accentSchemes';
