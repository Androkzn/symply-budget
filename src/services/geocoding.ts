/**
 * Address ⇄ coordinates, through the OPERATING SYSTEM's geocoder.
 *
 * `expo-location`'s `geocodeAsync` / `reverseGeocodeAsync` call CLGeocoder on
 * iOS and Android's `Geocoder` — Apple's and Google's own, already on the
 * device, already covered by the platform's privacy terms. That choice is the
 * whole reason this file is three functions rather than an HTTP client:
 *
 *  - **No API key.** Every hosted alternative (Mapbox, Google Places, OpenCage)
 *    needs one, and a key in a mobile bundle is a key on the internet. The
 *    Worker's own geocoding was retired for this reason (`MAP_PREVIEW_REMOVED`),
 *    and re-introducing it as a client-side key would be a step backwards.
 *  - **No neighbour address leaves the household.** This feature's rows describe
 *    people who never installed this app; sending their addresses to a service
 *    Symply operates — even to look one up — is exactly what the local-first
 *    design exists to prevent. The OS geocoder is a boundary the member has
 *    already accepted with their phone.
 *  - **It works offline more often than you would expect.** iOS caches
 *    aggressively around where the device has been, which is precisely the
 *    neighbourhood this feature is about.
 *
 * ## Everything here degrades rather than throws
 *
 * A geocoder can fail for reasons the member cannot act on: no network, a
 * rate limit, a rural address the provider has never heard of. None of those is
 * an error state for this feature, because a neighbour needs a POSITION and only
 * optionally an address. So every function returns `null` on failure and the
 * screens treat that as "we could not name this spot", not as a broken save.
 *
 * ## Permission is only ever needed for "where am I"
 *
 * Forward and reverse geocoding need **no** location permission — they are
 * lookups, not fixes. Only `getDevicePosition` asks, and it is called from one
 * place: the "centre on me" button. A member who declines it keeps the entire
 * feature; they lose one button.
 */
import * as Location from 'expo-location';

import { composeFormattedAddress, type LatLng, type ParsedAddress } from '@utils/neighbourGeo';

export type GeocodeResult = ParsedAddress & LatLng;

/**
 * Reverse geocode: a tapped point → an address.
 *
 * The platform returns a list; the first entry is the closest match and the rest
 * are progressively coarser (the block, the city). Taking `[0]` is correct here
 * and would not be for a search box.
 */
export async function reverseGeocode(point: LatLng): Promise<GeocodeResult | null> {
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: point.latitude,
      longitude: point.longitude,
    });
    const first = results?.[0];
    if (!first) return null;
    // `streetNumber` and `street` arrive separately and either may be absent —
    // a laneway address has no number, a rural one has no street. Joining what
    // exists beats a template with holes in it.
    const line1 =
      [first.streetNumber, first.street].filter((part) => !!part?.trim()).join(' ').trim() ||
      first.name?.trim() ||
      null;
    const parsed: ParsedAddress = {
      address_line1: line1 || null,
      city: first.city?.trim() || first.subregion?.trim() || null,
      state_province: first.region?.trim() || null,
      postal_code: first.postalCode?.trim() || null,
      country: first.isoCountryCode?.trim() || first.country?.trim() || null,
      formatted_address: null,
    };
    return {
      ...parsed,
      // The OS gives no single formatted string on every platform, so it is
      // composed once, here, and stored verbatim from then on. The migration's
      // header explains why it is never recomputed on read.
      formatted_address: composeFormattedAddress(parsed) || null,
      latitude: point.latitude,
      longitude: point.longitude,
    };
  } catch {
    return null;
  }
}

/**
 * Forward geocode: a typed address → a point.
 *
 * Used for two things: placing a pin the member typed rather than tapped, and
 * finding the HOUSEHOLD's own position so the map can open on the right street.
 * The second is why this returns coordinates only — the caller already has the
 * address it asked about, and the geocoder's idea of it is not more correct than
 * what the member typed.
 */
export async function geocodeAddress(query: string): Promise<LatLng | null> {
  const trimmed = query?.trim();
  if (!trimmed) return null;
  try {
    const results = await Location.geocodeAsync(trimmed);
    const first = results?.[0];
    if (!first) return null;
    return { latitude: first.latitude, longitude: first.longitude };
  } catch {
    return null;
  }
}

export type DevicePositionOutcome =
  | { status: 'ok'; point: LatLng }
  | { status: 'denied' }
  | { status: 'unavailable' };

/**
 * A one-shot fix for "centre the map on me".
 *
 * The three outcomes are distinguished rather than collapsed to `null` because
 * they need different answers on screen: `denied` offers Settings, `unavailable`
 * says the device could not get a fix and to try outside, and neither is the
 * generic failure toast that tells a member nothing.
 *
 * `Balanced` accuracy, not `Highest`: this centres a map on a street, and asking
 * for metre accuracy costs seconds of GPS warm-up for a precision that changes
 * nothing about the result.
 */
export async function getDevicePosition(): Promise<DevicePositionOutcome> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { status: 'denied' };
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      status: 'ok',
      point: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/** True when the member has already granted foreground location, without asking. */
export async function hasLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}
