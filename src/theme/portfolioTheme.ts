import { useSyncExternalStore } from 'react';

// Keep this leaf module compatible with the native tsconfig (no DOM lib).
// This declaration emits no runtime code; every access is guarded by typeof.
type ThemeMessageEvent = {
  source: unknown;
  origin: string;
  data?: { type?: unknown; theme?: unknown } | null;
};
type ThemeWindow = {
  parent: ThemeWindow;
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', listener: (event: ThemeMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: ThemeMessageEvent) => void): void;
};
declare const window: ThemeWindow;

type PreviewTheme = 'light' | 'dark' | null;
const trustedOrigins = new Set(['https://andreitekhtelev.dev', 'http://localhost:3000']);
const listeners = new Set<() => void>();
let previewTheme: PreviewTheme = null;

function receive(event: ThemeMessageEvent) {
  if (event.source !== window.parent || !trustedOrigins.has(event.origin)) return;
  const data = event.data;
  if (!data || data.type !== 'portfolio:theme' || (data.theme !== 'light' && data.theme !== 'dark')) return;
  previewTheme = data.theme;
  listeners.forEach(listener => listener());
  window.parent.postMessage({ type: 'portfolio:theme-applied', theme: previewTheme }, event.origin);
}
function subscribe(listener: () => void) {
  if (typeof window === 'undefined' || !window.parent?.postMessage || window.parent === window || typeof window.addEventListener !== 'function') return () => {};
  if (listeners.size === 0) {
    window.addEventListener('message', receive);
    trustedOrigins.forEach(origin => window.parent.postMessage({ type: 'portfolio:theme-ready' }, origin));
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('message', receive);
      previewTheme = null;
    }
  };
}
// Embedded preview only: never persists or syncs the visitor's account settings.
export function usePortfolioTheme(): PreviewTheme {
  return useSyncExternalStore(subscribe, () => previewTheme, () => null);
}
