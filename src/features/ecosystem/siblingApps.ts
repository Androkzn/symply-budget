/**
 * Sibling-app catalog for the "Get the Symply apps" grid.
 *
 * Lists every OTHER Symply app (all brands except the active one) with the
 * metadata the grid needs: a short tagline, the store link to install it, the
 * URL scheme used to detect whether it is already installed, and the baseline
 * data-sharing (Soft Transfer) consent that can be granted once it is.
 *
 * Store IDs: Android store URLs derive from the brand's `androidPackage`. iOS
 * needs the numeric App Store ID, which does not exist until the app is
 * published — populate `appStoreId` per brand in APP_STORE_IDS as each ships.
 */
import { Platform } from 'react-native';

import { brand, brandId, getBrandById } from '@brand';
import {
  TRANSFER_PACKAGES,
  type TransferPackageId,
} from '@symply/contracts';

export type SiblingApp = {
  id: string;
  displayName: string;
  tagline: string;
  /** `<scheme>://` probe target for install detection. */
  scheme: string;
  /** Platform store URL, or null when the app is not yet published there. */
  storeUrl: string | null;
  /**
   * Baseline profile package this app can share with the newly installed
   * sibling, or null when no registered Soft Transfer route exists for the pair.
   */
  profileConsent: ProfileConsentRoute | null;
};

export type ProfileConsentRoute = {
  packageId: TransferPackageId;
  sourceBrandId: string;
  destinationBrandId: string;
};

/** One-line pitch per brand (identity copy — display name comes from the pack). */
const TAGLINES: Record<string, string> = {
  'symply-house': 'Your whole home, organized — tasks, docs & AI housekeeper.',
  'symply-budget': 'Personal budgeting and spending, made simple.',
  'symply-kaizen': 'Small daily improvements — habits, systems & growth.',
  'symply-language': 'Learn a language through real, guided dialogue.',
  'symply-health': 'Track check-ins and reach your health goals.',
};

/**
 * Numeric App Store IDs, keyed by brand id. Empty until each app is published;
 * a missing entry means the iOS Install button opens no store (shown as
 * "coming soon"). Android needs no entry — the Play URL derives from the package.
 */
const APP_STORE_IDS: Record<string, string> = {
  // 'symply-house': '0000000000',
};

/** All brand ids except the active one, in a stable ecosystem order. */
const ECOSYSTEM_ORDER = [
  'symply-house',
  'symply-budget',
  'symply-kaizen',
  'symply-language',
  'symply-health',
] as const;

export function getSiblingBrandIds(activeId: string = brandId): string[] {
  return ECOSYSTEM_ORDER.filter((id) => id !== activeId);
}

/**
 * Platform store URL for a brand, or null when it cannot be built (iOS with no
 * published App Store ID yet). Android always resolves from the package name.
 */
export function getStoreUrl(targetBrandId: string): string | null {
  const target = getBrandById(targetBrandId);
  if (Platform.OS === 'android') {
    return `https://play.google.com/store/apps/details?id=${target.androidPackage}`;
  }
  const appStoreId = APP_STORE_IDS[targetBrandId];
  return appStoreId ? `https://apps.apple.com/app/id${appStoreId}` : null;
}

/**
 * Resolve the baseline profile Soft Transfer route for sharing FROM the active
 * app TO a newly installed sibling, or null when no registered package covers
 * the pair. Mirrors backend `resolveTransferDirection` for profile packages:
 * `profile.core.v1` is bidirectional House ↔ Budget; the Health/Language
 * profile packages are one-directional House → child.
 */
export function resolveProfileConsent(
  sourceBrandId: string,
  destinationBrandId: string,
): ProfileConsentRoute | null {
  for (const def of Object.values(TRANSFER_PACKAGES)) {
    if (!def.packageId.startsWith('profile.core')) continue;

    if (
      def.sourceBrandId === sourceBrandId &&
      def.destinationBrandId === destinationBrandId
    ) {
      return {
        packageId: def.packageId,
        sourceBrandId,
        destinationBrandId,
      };
    }

    // profile.core.v1 is bidirectional House ↔ Budget.
    if (
      def.packageId === 'profile.core.v1' &&
      def.sourceBrandId === destinationBrandId &&
      def.destinationBrandId === sourceBrandId
    ) {
      return {
        packageId: def.packageId,
        sourceBrandId,
        destinationBrandId,
      };
    }
  }
  return null;
}

/** Build the full sibling-app list for the active brand. */
export function getSiblingApps(activeId: string = brandId): SiblingApp[] {
  return getSiblingBrandIds(activeId).map((id) => {
    const config = getBrandById(id);
    return {
      id,
      displayName: config.displayName,
      tagline: TAGLINES[id] ?? config.displayName,
      scheme: config.scheme,
      storeUrl: getStoreUrl(id),
      profileConsent: resolveProfileConsent(activeId, id),
    };
  });
}

/** Human label for the active app (source of the shared data). */
export function getActiveAppName(): string {
  return brand.displayName;
}
