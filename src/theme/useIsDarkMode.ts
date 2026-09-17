import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { useAppStore } from '@stores/appStore';
import { usePortfolioTheme } from './portfolioTheme';

/**
 * Single source of truth for resolved dark mode.
 *
 * Leaf module — no imports from `@theme/index` or `ThemeContext` — so
 * `appColors`, `ThemeContext`, and `Icon` can share one implementation
 * without a require cycle.
 */
export function useIsDarkMode(): boolean {
  const previewTheme = usePortfolioTheme();
  const themeMode = useAppStore((s) => s.themeMode);
  const systemScheme = useColorScheme();
  return useMemo(() => {
    if (previewTheme) return previewTheme === 'dark';
    if (themeMode === 'system') return systemScheme === 'dark';
    return themeMode === 'dark';
  }, [themeMode, systemScheme, previewTheme]);
}
