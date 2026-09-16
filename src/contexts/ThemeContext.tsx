import React, { createContext, useContext, useMemo } from 'react';

import { useAppStore } from '@stores/appStore';
import { getTheme, Theme } from '@theme/index';
import { useIsDarkMode } from '@theme/useIsDarkMode';

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setThemeMode: (mode: 'light' | 'dark' | 'system') => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const setThemeModeAction = useAppStore((state) => state.setThemeMode);
  const isDark = useIsDarkMode();
  const accentScheme = useAppStore((state) => state.accentScheme);

  const theme = useMemo(
    () => getTheme(accentScheme, isDark ? 'dark' : 'clean'),
    [accentScheme, isDark]
  );

  const toggleTheme = () => {
    setThemeModeAction(isDark ? 'light' : 'dark');
  };

  const setThemeMode = (mode: 'light' | 'dark' | 'system') => {
    setThemeModeAction(mode);
  };

  const value = useMemo(
    () => ({
      theme,
      isDark,
      toggleTheme,
      setThemeMode,
    }),
    [theme, isDark]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export { useIsDarkMode } from '@theme/useIsDarkMode';
