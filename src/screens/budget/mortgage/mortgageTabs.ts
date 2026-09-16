import type { FilterTab } from '@components/ui';

/**
 * The Mortgage strip's tab catalog + layout resolver.
 *
 * The user can reorder the strip and hide tabs they don't use (Mortgage
 * settings → "Customize tabs"). A saved layout only ever stores ids, so this
 * catalog stays the single source of truth for labels, icons and which tabs
 * navigate away — renaming a tab or shipping a new one never needs a migration.
 */

export type MortgageTabId =
  | 'overview'
  | 'payments'
  | 'equity'
  | 'forecast'
  | 'schedule'
  | 'renewal'
  | 'statements'
  | 'renew'
  | 'history';

export interface MortgageTabDef {
  id: MortgageTabId;
  label: string;
  /**
   * BASE Ionicon glyph — `mortgageTabIcon` adds the `-outline` suffix. These
   * are literal Ionicons: the customizer draws them with `forceIonicons`
   * because the brand kit's aliases map "card"/"pie-chart"/"trending-up" to
   * spending/savings glyphs that mean the wrong thing on this screen.
   * Destination tabs render it in the strip (it marks them as "this pushes a
   * screen"); content tabs use it only in the customizer, so the strip keeps
   * its label-only segmented look.
   */
  icon: string;
  /**
   * Pushes its own screen (Statements list / Renew wizard / change History)
   * instead of switching the inline content below, and so never becomes the
   * highlighted `activeTab`.
   */
  destination?: boolean;
  /** Overview is the guaranteed fallback view — reorderable, never hideable. */
  locked?: boolean;
}

/** Factory order — also the order new-to-you tabs are appended in. */
export const MORTGAGE_TABS: readonly MortgageTabDef[] = [
  { id: 'overview', label: 'Overview', icon: 'home', locked: true },
  { id: 'payments', label: 'Payments', icon: 'card' },
  { id: 'equity', label: 'Equity', icon: 'pie-chart' },
  { id: 'forecast', label: 'Forecast', icon: 'trending-up' },
  { id: 'schedule', label: 'Schedule', icon: 'list' },
  { id: 'renewal', label: 'Renewal', icon: 'calendar' },
  { id: 'statements', label: 'Statements', icon: 'documents', destination: true },
  { id: 'renew', label: 'Renew', icon: 'refresh', destination: true },
  { id: 'history', label: 'History', icon: 'time', destination: true },
];

/** The one tab that can never be hidden, and the fallback when a view vanishes. */
export const REQUIRED_MORTGAGE_TAB: MortgageTabId = 'overview';

export const DEFAULT_MORTGAGE_TAB_ORDER: MortgageTabId[] = MORTGAGE_TABS.map((t) => t.id);

const TAB_BY_ID = new Map<string, MortgageTabDef>(MORTGAGE_TABS.map((t) => [t.id, t]));

export function getMortgageTab(id: string): MortgageTabDef | undefined {
  return TAB_BY_ID.get(id);
}

/**
 * Turn a persisted layout into the two lists the strip and the customizer need.
 *
 * Tolerant by design — a layout saved by an older build must never strand the
 * user on an empty strip:
 *  - ids no longer in the catalog (and duplicates) are dropped;
 *  - catalog tabs missing from the saved order are appended, visible;
 *  - the locked tab is forced back into `shown` however it was persisted.
 */
export function resolveMortgageTabs(
  order?: readonly string[] | null,
  hiddenIds?: readonly string[] | null
): { shown: MortgageTabDef[]; hidden: MortgageTabDef[] } {
  const seen = new Set<string>();
  const ordered: MortgageTabDef[] = [];

  for (const id of order ?? []) {
    const def = TAB_BY_ID.get(id);
    if (!def || seen.has(id)) continue;
    seen.add(id);
    ordered.push(def);
  }
  for (const def of MORTGAGE_TABS) {
    if (!seen.has(def.id)) ordered.push(def);
  }

  const hiddenSet = new Set(hiddenIds ?? []);
  return {
    shown: ordered.filter((t) => t.locked || !hiddenSet.has(t.id)),
    hidden: ordered.filter((t) => !t.locked && hiddenSet.has(t.id)),
  };
}

/** The outline Ionicon actually drawn for a tab. */
export function mortgageTabIcon(tab: MortgageTabDef): string {
  return `${tab.icon}-outline`;
}

/**
 * Strip view model. Content tabs stay label-only (their icon is customizer-only)
 * so the segmented row reads the same as before customization existed;
 * destination tabs keep their outline glyph.
 */
export function toMortgageFilterTabs(shown: readonly MortgageTabDef[]): FilterTab[] {
  return shown.map((t) => ({
    id: t.id,
    label: t.label,
    ...(t.destination ? { icon: mortgageTabIcon(t) } : {}),
  }));
}

/** The visible tabs that render inline content — i.e. the ones `activeSubTab` may point at. */
export function visibleContentTabs(shown: readonly MortgageTabDef[]): MortgageTabDef[] {
  return shown.filter((t) => !t.destination);
}

/** Stable signature of a layout, for dirty-tracking in the customizer. */
export function mortgageTabsSignature(
  shown: readonly MortgageTabDef[],
  hidden: readonly MortgageTabDef[]
): string {
  return `${shown.map((t) => t.id).join(',')}|${hidden.map((t) => t.id).join(',')}`;
}
