/**
 * User-selectable accent color schemes (Settings → Appearance → Color Scheme).
 *
 * `classic` always mirrors the active brand's own tokens (`brand.colors.*`),
 * so it renders byte-identical to today's app for every brand — switching to
 * it is a true no-op. The remaining entries are Symply Budget-specific
 * alternate identities; `hasMultipleAccentSchemes` gates the Settings UI so
 * other brands (which only ever have `classic`) never see a picker.
 *
 * Leaf module — imports only `../brand`, no `@theme/*` or `@stores/*> — so it
 * can be imported from `appStore.ts` (which feeds the persisted selection)
 * without creating a require cycle. See `useIsDarkMode.ts` for the same
 * leaf-module discipline applied to dark-mode resolution.
 */
import { brand } from '../brand';

export type AccentSchemeId = 'classic' | 'tealCoral' | 'sageTerracotta';

export interface AccentSchemeSeed {
  id: AccentSchemeId;
  label: string;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  primaryOnDark: string;
  primaryDarkOnDark: string;
  /** Chart "negative value" bar fill — paired with `primary` in the Settings swatch. */
  secondaryAccent: string;
}

// `brand` is always fully populated in the real app. The `?? ` fallbacks below
// exist only because this leaf now loads transitively from `appStore.ts` —
// imported by nearly everything — and many existing test files mock `@brand`
// with just the one or two exports they need (e.g. `{ hasBrandCapability }`),
// trusting (correctly, before this feature) that nothing else reads
// `brand.colors`. Without the fallback, `ACCENT_SCHEMES.classic` would throw
// on module load in every one of those suites.
const FALLBACK_CLASSIC_COLORS = {
  primary: '#2BB673',
  primaryDark: '#239A61',
  primaryLight: '#5FD49A',
  primaryOnDark: '#239A61',
  primaryDarkOnDark: '#1B7A4C',
} as const;

export const ACCENT_SCHEMES: Record<AccentSchemeId, AccentSchemeSeed> = {
  classic: {
    id: 'classic',
    label: 'Classic Green',
    primary: brand?.colors?.primary ?? FALLBACK_CLASSIC_COLORS.primary,
    primaryDark: brand?.colors?.primaryDark ?? FALLBACK_CLASSIC_COLORS.primaryDark,
    primaryLight: brand?.colors?.primaryLight ?? FALLBACK_CLASSIC_COLORS.primaryLight,
    primaryOnDark: brand?.colors?.primaryOnDark ?? FALLBACK_CLASSIC_COLORS.primaryOnDark,
    primaryDarkOnDark: brand?.colors?.primaryDarkOnDark ?? FALLBACK_CLASSIC_COLORS.primaryDarkOnDark,
    // Matches palette.semantic.error exactly, so the classic scheme's chart
    // negative-bar color is pixel-identical to today's `colors.error` red.
    secondaryAccent: '#FF3B30',
  },
  tealCoral: {
    id: 'tealCoral',
    label: 'Teal & Coral',
    primary: '#14B8A6',
    primaryDark: '#0D9488',
    primaryLight: '#65D0C5',
    primaryOnDark: '#37C2B3',
    primaryDarkOnDark: '#0A756C',
    secondaryAccent: '#F97316',
  },
  sageTerracotta: {
    id: 'sageTerracotta',
    label: 'Sage & Terracotta',
    primary: '#84A98C',
    primaryDark: '#6B8F71',
    primaryLight: '#AEC7B4',
    primaryOnDark: '#96B69D',
    primaryDarkOnDark: '#55715A',
    secondaryAccent: '#D85D3D',
  },
};

export const ACCENT_SCHEME_ORDER: AccentSchemeId[] = ['classic', 'tealCoral', 'sageTerracotta'];

/** Only Budget ships alternate schemes today; every other brand stays `classic`-only. */
export function hasMultipleAccentSchemes(brandId: string = brand?.id ?? ''): boolean {
  return brandId === 'symply-budget';
}

/** Pure function of `brandId` (not live store state) so it's deterministic for static callers/tests. */
export function getDefaultAccentScheme(brandId: string = brand?.id ?? ''): AccentSchemeId {
  return brandId === 'symply-budget' ? 'tealCoral' : 'classic';
}
