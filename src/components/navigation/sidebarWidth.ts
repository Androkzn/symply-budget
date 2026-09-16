import { Layout } from '@theme';

/**
 * Sidebar width helpers, extracted from `SidebarTabBar` so foundational code
 * (e.g. the `useLayoutPadding` hook, imported by `@components/common`) can
 * reserve sidebar space WITHOUT importing the full `SidebarTabBar` component.
 *
 * `SidebarTabBar` pulls in `@components/aihousekeeper` -> tasks -> `@api/client`
 * -> `@config/env`; when that chain is dragged into the `@components/common`
 * barrel it forms a circular import that leaves `ENV` `undefined` at module
 * init and crashes the app on launch ("Cannot read property '…' of undefined").
 * Keeping these pure constants/functions dependency-free avoids that cycle.
 */
export const SIDEBAR_FULL_WIDTH = Layout.sidebarWidth; // 320
export const SIDEBAR_COMPACT_WIDTH = 92;

export function getSidebarWidth(windowWidth: number): number {
  // A full sidebar looks heavy in portrait even on large iPads. Keep labels
  // for wide landscape/fullscreen layouts and use the compact rail elsewhere.
  return windowWidth >= 1180 ? SIDEBAR_FULL_WIDTH : SIDEBAR_COMPACT_WIDTH;
}
