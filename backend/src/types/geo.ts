export interface NormalizedAddress {
  address_line1: string | null | undefined;
  address_line2?: string | null | undefined;
  city?: string | null | undefined;
  state_province?: string | null | undefined;
  postal_code?: string | null | undefined;
  country?: string | null | undefined;
}

export type GeoJsonPolygonGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
};

/** Reduce an address record to a single search-query string. */
export function formatAddressForGeocoding(addr: NormalizedAddress): string {
  return [
    addr.address_line1,
    addr.address_line2,
    addr.city,
    addr.state_province,
    addr.postal_code,
    addr.country,
  ]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0)
    .join(', ');
}

export const MAP_PREVIEW_REMOVED = 'map_preview_removed';
