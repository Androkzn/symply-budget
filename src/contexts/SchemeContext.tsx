/**
 * SchemeContext — subtree override for the app color schema ("skin").
 *
 * NOTE (flat-skin migration): the app now uses a single flat, theme-following
 * background everywhere (white in light mode, dark in dark mode). Color
 * resolution in `appColors.ts` / `ThemeContext` no longer branches on the
 * schema, so `SchemeScope` is effectively vestigial — retained only so the
 * persisted `appStore.colorScheme` field and existing scheme-aware tests keep
 * resolving. New code should not rely on it to change appearance.
 *
 * This module intentionally imports ONLY React + `appStore` (no `@theme/*`) to
 * avoid the require cycle that `appColors.ts` documents and avoids.
 */
import React, { createContext, useContext } from 'react';

import { useAppStore, type ColorScheme } from '@stores/appStore';

// `null` = no explicit scope → consumers fall back to the persisted store value.
const SchemeScopeContext = createContext<ColorScheme | null>(null);

export function SchemeScope({
  scheme,
  children,
}: {
  scheme: ColorScheme;
  children: React.ReactNode;
}) {
  return (
    <SchemeScopeContext.Provider value={scheme}>
      {children}
    </SchemeScopeContext.Provider>
  );
}

/**
 * Effective color schema for the current subtree. An enclosing `<SchemeScope>`
 * wins; otherwise the persisted `appStore.colorScheme` is used.
 */
export function useAppColorScheme(): ColorScheme {
  const scoped = useContext(SchemeScopeContext);
  const stored = useAppStore((s) => s.colorScheme);
  return scoped ?? stored;
}
