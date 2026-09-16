import { Ionicons } from '@expo/vector-icons';

import type { ProviderKey } from '@features/utilities/api/utilities';

export type IoniconName = keyof typeof Ionicons.glyphMap;

export const PROVIDER_META: Record<
  ProviderKey,
  { label: string; ionicon: IoniconName; billTypes: string[] }
> = {
  overview: { label: 'Overview', ionicon: 'stats-chart-outline', billTypes: [] },
  bc_hydro: { label: 'BC Hydro', ionicon: 'flash-outline', billTypes: ['electricity'] },
  fortisbc: { label: 'FortisBC', ionicon: 'flame-outline', billTypes: ['gas'] },
  city_of_surrey: {
    label: 'City of Surrey',
    ionicon: 'water-outline',
    billTypes: ['water', 'sewer'],
  },
  other: { label: 'Other', ionicon: 'document-text-outline', billTypes: ['other', 'garbage'] },
};

export const CHART_FILTER_TYPES: Array<{ id: string; label: string; ionicon: IoniconName }> = [
  { id: 'electricity', label: 'Electricity', ionicon: 'flash-outline' },
  { id: 'gas', label: 'Gas', ionicon: 'flame-outline' },
  { id: 'water', label: 'Water', ionicon: 'water-outline' },
  { id: 'sewer', label: 'Sewer', ionicon: 'rainy-outline' },
];

/**
 * Ionicon (outline) for a bill/utility type — the single source of truth so
 * every utilities screen shows the same glyph and matches the app's Ionicons
 * style (the rest of the app uses vector icons, not emoji).
 */
export function getBillTypeIonicon(billType: string): IoniconName {
  switch (billType) {
    case 'electricity':
      return 'flash-outline';
    case 'gas':
      return 'flame-outline';
    case 'water':
      return 'water-outline';
    case 'sewer':
      return 'rainy-outline';
    case 'garbage':
      return 'trash-outline';
    default:
      return 'document-text-outline';
  }
}
