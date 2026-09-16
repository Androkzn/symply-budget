/**
 * Canonical money rendering for the whole ecosystem (House, Budget, Kaizen,
 * Language, Health).
 *
 * Every screen that prints an amount MUST go through here. Before this module
 * ~50 screens each defined their own `formatCurrency` with a hard-coded "$",
 * so Settings → Currency only ever changed the handful of Budget screens that
 * happened to read the store — utilities, labor-hub, contractors, mortgage,
 * pension and the savings screens stayed on dollars forever.
 *
 * Two rules make the preference actually take effect:
 *   1. Format through `formatMoney` / `moneySymbol` — never a literal "$".
 *   2. Call `useDisplayCurrency()` once in any component that renders money, so
 *      React re-renders it when the preference changes. The formatters read the
 *      store imperatively (they are plain functions, callable from helpers and
 *      chart renderers), which keeps values correct but does NOT by itself
 *      schedule a re-render.
 *
 * This is a *display* swap only — amounts stay in the currency they were
 * entered in and are never converted (see @config/currencies).
 */
import {
  resolveCurrency,
  type CurrencyCode,
  type CurrencyOption,
} from '@config/currencies';
import { useAppStore } from '@stores/appStore';

/** The selected display currency, read imperatively (safe outside React). */
export function currentCurrency(): CurrencyOption {
  return resolveCurrency(useAppStore.getState().currency);
}

/**
 * Subscribe to the display-currency preference.
 *
 * Call this in every component that renders money — the return value is usually
 * unused; the point is the subscription, which re-renders the component when
 * the user picks a different currency in Settings.
 */
export function useDisplayCurrency(): CurrencyCode {
  return useAppStore((state) => state.currency);
}

/**
 * Imperative subscription to the display-currency preference, for the surfaces
 * that render money OUTSIDE React and therefore cannot use the hook above — the
 * iOS home-screen widget and the Watch face, which read a JSON snapshot the app
 * pushes into the App Group.
 *
 * Those snapshots carry the currency as data, so a preference change has to be
 * re-published or the widget keeps formatting last week's code (it has no view
 * of the store and no reason to reload). Returns an unsubscribe.
 */
export function subscribeToDisplayCurrency(
  onChange: (code: CurrencyCode) => void,
): () => void {
  let previous = useAppStore.getState().currency;
  return useAppStore.subscribe((state) => {
    if (state.currency === previous) return;
    previous = state.currency;
    onChange(state.currency);
  });
}

/** Glyph for the selected currency (or an explicit code), e.g. "$", "CA$", "€". */
export function moneySymbol(code?: string | null): string {
  return code === undefined ? currentCurrency().symbol : resolveCurrency(code).symbol;
}

export interface MoneyFormatOptions {
  /**
   * Force a specific ISO code instead of the user's preference. For the few
   * amounts that carry their own currency as data (a savings entry, a project
   * budget) rather than inheriting the display preference.
   */
  code?: string | null;
  /**
   * Fraction digits. Defaults to 0 (whole units — the ecosystem default, since
   * a rounded "$9,456" reads better on cards than "$9,456.00"). Clamped to the
   * currency's own precision, so JPY never renders "¥1,200.00".
   */
  decimals?: number;
  /** Render magnitudes >= 1000 compactly: "$1.2k", "$12k". For tight chart labels. */
  abbreviate?: boolean;
  /** Rendered when the value is null/undefined. Defaults to a zero amount. */
  fallback?: string;
}

/**
 * Hermes ships a reduced Intl and throws on a tag it can't build rather than
 * degrading, so each locale is probed once and the verdict cached — money is
 * formatted per row in long lists and per label in charts.
 */
const localeSupport = new Map<string, string | undefined>();

function groupingLocale(option: CurrencyOption): string | undefined {
  const cached = localeSupport.get(option.locale);
  if (cached !== undefined || localeSupport.has(option.locale)) return cached;
  let supported: string | undefined;
  try {
    (1234.5).toLocaleString(option.locale);
    supported = option.locale;
  } catch {
    supported = undefined;
  }
  localeSupport.set(option.locale, supported);
  return supported;
}

/**
 * cents → display string, e.g. `-CA$1,234`, `€1,234.56`, `$1.2k`.
 *
 * The sign always leads the symbol (`-$1,234`, never `$-1,234`) — screens used
 * to disagree on this and the same value read differently card to card.
 */
export function formatMoney(
  cents: number | null | undefined,
  options: MoneyFormatOptions = {}
): string {
  const currency = options.code ? resolveCurrency(options.code) : currentCurrency();
  const symbol = currency.symbol;

  if (cents == null) {
    return options.fallback ?? `${symbol}${(0).toFixed(maxDecimals(currency, options))}`;
  }

  const units = cents / 100;
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);

  if (options.abbreviate && abs >= 1000) {
    const thousands = abs / 1000;
    return `${sign}${symbol}${thousands.toFixed(thousands >= 10 ? 0 : 1)}k`;
  }

  const decimals = maxDecimals(currency, options);
  const locale = groupingLocale(currency);
  const body = abs.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}${symbol}${body}`;
}

function maxDecimals(currency: CurrencyOption, options: MoneyFormatOptions): number {
  const requested = options.decimals ?? 0;
  return Math.min(requested, currency.decimalDigits);
}

/** Same as `formatMoney` but the input is already in whole units, not cents. */
export function formatMoneyUnits(
  units: number | null | undefined,
  options: MoneyFormatOptions = {}
): string {
  return formatMoney(units == null ? null : Math.round(units * 100), options);
}

/**
 * An estimated-cost range:
 *   • no bounds → the `empty` placeholder ("TBD" by default)
 *   • equal bounds or a missing max → a single figure
 *   • otherwise → "min - max"
 */
export function formatMoneyRange(
  minCents: number | null | undefined,
  maxCents: number | null | undefined,
  options: MoneyFormatOptions & { empty?: string } = {}
): string {
  if (!minCents && !maxCents) return options.empty ?? 'TBD';
  if (minCents === maxCents || !maxCents) return formatMoney(minCents, options);
  return `${formatMoney(minCents, options)} - ${formatMoney(maxCents, options)}`;
}
