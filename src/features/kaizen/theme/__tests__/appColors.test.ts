/**
 * Symply Life (brand `symply-kaizen`) — appColors shim tests.
 *
 * The shim derives Liquid-Glass + brand-gradient keys from the ecosystem tokens.
 * The two ecosystem hooks it composes (`@theme/appColors`, `@contexts/ThemeContext`)
 * are mocked so we can drive both `isDark` branches of the glass keys and confirm
 * the base tokens pass through untouched.
 */
import { useTheme } from '@contexts/ThemeContext';
import { useAppColors as useEcosystemAppColors } from '@theme/appColors';
import { getButtonGradientColors } from '@theme/buttonGradients';

import {
  GRADIENT_ACTION_DESCRIPTOR,
  GRADIENT_BRAND_DESCRIPTOR,
  KAIZEN_GRADIENT_ACTION,
  KAIZEN_GRADIENT_BRAND,
  useAppColors,
} from '../appColors';

jest.mock('@theme/appColors', () => ({ useAppColors: jest.fn() }));
jest.mock('@contexts/ThemeContext', () => ({ useTheme: jest.fn() }));

const mockEcosystemColors = useEcosystemAppColors as jest.Mock;
const mockUseTheme = useTheme as jest.Mock;

const base = {
  cardBackground: '#111',
  borderColor: '#222',
  primary: '#5B7CFF',
  textPrimary: '#fff', // arbitrary extra key to prove `...base` spreads through
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEcosystemColors.mockReturnValue(base);
});

describe('exported gradient constants', () => {
  it('exposes the brand and action gradient stops', () => {
    expect(KAIZEN_GRADIENT_BRAND).toEqual(['#6EE7C7', '#4ECDC4', '#5B7CFF', '#8B7CFF']);
    // Action CTA follows the shared brand gradients.cta ramp.
    expect(KAIZEN_GRADIENT_ACTION).toEqual(getButtonGradientColors('primary'));
  });

  it('wraps the stops in <LinearGradient> descriptors', () => {
    expect(GRADIENT_BRAND_DESCRIPTOR).toEqual({
      colors: KAIZEN_GRADIENT_BRAND,
      locations: [0, 0.35, 0.7, 1],
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    });
    expect(GRADIENT_ACTION_DESCRIPTOR).toEqual({
      colors: KAIZEN_GRADIENT_ACTION,
      locations: [0, 1],
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
    });
  });
});

describe('useAppColors', () => {
  it('spreads the base tokens and maps the theme-independent glass keys', () => {
    mockUseTheme.mockReturnValue({ isDark: false });

    const colors = useAppColors();

    expect(colors.textPrimary).toBe('#fff');
    expect(colors.glassFill).toBe(base.cardBackground);
    expect(colors.glassBorder).toBe(base.borderColor);
    expect(colors.glassTint).toBe(base.primary);
    expect(colors.gradientBrand).toBe(GRADIENT_BRAND_DESCRIPTOR);
    expect(colors.gradientAction).toBe(GRADIENT_ACTION_DESCRIPTOR);
  });

  it('uses the light-surface glass values when isDark is false', () => {
    mockUseTheme.mockReturnValue({ isDark: false });

    const colors = useAppColors();

    expect(colors.glassFillStrong).toBe('rgba(255,255,255,0.78)');
    expect(colors.glassShadow).toBe('rgba(15,23,42,0.10)');
  });

  it('uses the dark-surface glass values when isDark is true', () => {
    mockUseTheme.mockReturnValue({ isDark: true });

    const colors = useAppColors();

    expect(colors.glassFillStrong).toBe('rgba(255,255,255,0.10)');
    expect(colors.glassShadow).toBe('rgba(0,0,0,0.50)');
  });
});
