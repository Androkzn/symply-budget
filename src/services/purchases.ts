/**
 * RevenueCat Purchases SDK wrapper for SimpleHouse.
 * Identity = SimpleHouse user id. Server sync is authoritative for AI access.
 */

import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesOfferings,
  LOG_LEVEL,
} from 'react-native-purchases';

import { subscriptionApi } from '@api/subscription';
import { brand } from '@brand';
import { ENV } from '@config/env';
import { trackEvent, AnalyticsEvent } from '@services/analytics';
import { captureException } from '@services/monitoring';
import { isFeatureEnabled } from '@stores/featureFlagStore';

let configured = false;

/**
 * Resolve public SDK key: brand pack first (per-app RC project), then
 * EXPO_PUBLIC_REVENUECAT_* env override for local/EAS experiments.
 */
export function getRevenueCatApiKey(): string | null {
  const fromBrand =
    Platform.OS === 'ios'
      ? brand.integrations.revenueCat?.iosApiKey
      : brand.integrations.revenueCat?.androidApiKey;
  if (fromBrand) return fromBrand;
  const fromEnv =
    Platform.OS === 'ios' ? ENV.REVENUECAT_IOS_API_KEY : ENV.REVENUECAT_ANDROID_API_KEY;
  return fromEnv || null;
}

export async function configurePurchases(): Promise<boolean> {
  if (configured) return true;
  if (!isFeatureEnabled('subscriptionsEnabled') && !__DEV__) {
    // Still configure in __DEV__ so sandbox testing works when flag flips.
  }
  const apiKey = getRevenueCatApiKey();
  if (!apiKey) {
    if (__DEV__) {
      console.warn('[RevenueCat] No public API key configured — purchases disabled');
    }
    return false;
  }
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO);
  if (__DEV__) {
    // The iOS Simulator can't reach StoreKit / App Store Connect, so RevenueCat
    // fails to fetch offerings and logs it at ERROR level. The SDK's default log
    // handler routes ERROR to console.error, which React Native turns into a
    // full-screen LogBox redbox — blocking manual dev *and* every Maestro E2E
    // flow (the overlay hides the screen under test). Install a dev-only handler
    // that keeps the logs visible but never calls console.error, so no redbox.
    // Production keeps the SDK's default handler (real errors reach monitoring).
    Purchases.setLogHandler((level, message) => {
      const line = `[RevenueCat] ${message}`;
      if (level === LOG_LEVEL.ERROR || level === LOG_LEVEL.WARN) {
        console.warn(line);
      } else if (level === LOG_LEVEL.INFO) {
        console.info(line);
      } else {
        console.log(line);
      }
    });
  }
  Purchases.configure({ apiKey });
  configured = true;
  return true;
}

export async function logInPurchases(userId: string): Promise<CustomerInfo | null> {
  if (!(await configurePurchases())) return null;
  const { customerInfo } = await Purchases.logIn(userId);
  return customerInfo;
}

/** Avoid routine logOut — creates anonymous IDs. Next session calls logIn. */
export async function clearLocalPurchaseState(): Promise<void> {
  // No Purchases.logOut() by design (plan §6.2).
}

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!(await configurePurchases())) return null;
  return Purchases.getOfferings();
}

/**
 * Resolve the offering for the active brand. All Symply brands share one
 * RevenueCat project, so `offerings.current` is project-wide and not
 * brand-specific. Each brand has its own offering keyed `<brand>-default`
 * (e.g. `house-default`); select it by id, falling back to `current`.
 */
export function resolveBrandOffering(
  offerings: PurchasesOfferings
): PurchasesOffering | null {
  const shortBrand = ENV.APP_BRAND?.replace(/^symply-/, '');
  const offeringId = shortBrand ? `${shortBrand}-default` : undefined;
  const brandOffering = offeringId ? offerings.all[offeringId] : undefined;
  if (brandOffering) return brandOffering;
  // The fallback is project-wide across all five brands, so a missing or
  // mis-keyed `<brand>-default` silently serves whichever brand's offering is
  // current. Make that observable instead of invisible (BUDGET-CORNER-022).
  console.warn(
    `[RevenueCat] No offering "${offeringId ?? '<unknown brand>'}" — falling back to ` +
      `project-wide current offering "${offerings.current?.identifier ?? 'none'}"`
  );
  return offerings.current ?? null;
}

export async function purchaseDefaultPackage(): Promise<CustomerInfo> {
  if (!(await configurePurchases())) {
    throw new Error('Purchases not configured');
  }
  const offerings = await Purchases.getOfferings();
  const pkg = resolveBrandOffering(offerings)?.availablePackages[0];
  if (!pkg) {
    throw new Error('No subscription package available');
  }
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  await syncSubscriptionWithBackend();
  trackEvent(AnalyticsEvent.SUBSCRIPTION_STARTED, {
    product: pkg.product.identifier,
    package: pkg.identifier,
  });
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo> {
  if (!(await configurePurchases())) {
    throw new Error('Purchases not configured');
  }
  const info = await Purchases.restorePurchases();
  await syncSubscriptionWithBackend();
  trackEvent(AnalyticsEvent.SUBSCRIPTION_RESTORED, { has_pro: hasProEntitlement(info) });
  return info;
}

export async function syncSubscriptionWithBackend(): Promise<void> {
  try {
    await subscriptionApi.sync();
  } catch (err) {
    console.warn('[RevenueCat] backend sync failed', err);
    captureException(err, { source: 'Purchases', phase: 'syncSubscriptionWithBackend' });
    throw err;
  }
}

export function addCustomerInfoListener(
  listener: (info: CustomerInfo) => void
): () => void {
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}

export function hasProEntitlement(info: CustomerInfo): boolean {
  return Boolean(info.entitlements.active.pro);
}
