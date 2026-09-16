/**
 * Brand-aware chart colors for dashboards and chat generative UI.
 * Always derive from `useAppColors()` / `getAppColors()` — never hardcode brand hex
 * at call sites (see documents/design/UI_Rules_For_Chat_Generated_UI.md §17).
 */
import { getAppColors, type AppColors } from '@theme/appColors';
import { mixHex } from '@theme/colors';

/** Progressive tint of the brand primary (strongest → lightest). */
export function categoryRampColor(base: string, index: number, white = '#FFFFFF'): string {
  return mixHex(base, white, Math.min(index * 0.16, 0.72));
}

/** Rotate through brand chart tokens for multi-series distinction. */
export function seriesColor(colors: AppColors, index: number): string {
  const series = [colors.primary, colors.chartWarm, colors.chartCool, colors.chartAlert, colors.accent];
  return series[index % series.length] ?? colors.primary;
}

/** Default slice/bar color for chat charts: primary ramp. */
export function chatSliceColor(colors: AppColors, index: number): string {
  return categoryRampColor(colors.primary, index, colors.white);
}

/** Convenience when a non-hook caller needs the current theme ramp. */
export function chatSliceColorFromTheme(index: number): string {
  const colors = getAppColors();
  return chatSliceColor(colors, index);
}
