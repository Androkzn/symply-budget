/**
 * RevenueCat REST client — sync subscriber state into D1.
 * Uses the V2 API (/v2/projects/{project}/customers/...), which is what the
 * modern `sk_` secret keys are authorized for. (The legacy V1 /subscribers
 * endpoint returns 403 for V2 keys.) getSubscriber assembles a V1-shaped
 * `RevenueCatSubscriber` from the V2 customer + entitlements + subscriptions so
 * the downstream sync logic is unchanged.
 * Secrets/vars: REVENUECAT_SECRET_API_KEY, REVENUECAT_PROJECT_ID,
 * REVENUECAT_PRO_ENTITLEMENT_ID.
 */

import type { Env } from '../types';
import { scrubForLogs } from '../utils/log-scrubber';

export class RevenueCatError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'RevenueCatError';
  }
}

export interface RevenueCatEntitlement {
  expires_date: string | null;
  product_identifier: string | null;
  purchase_date: string | null;
}

export interface RevenueCatSubscriber {
  original_app_user_id: string;
  entitlements: {
    active: Record<string, RevenueCatEntitlement>;
  };
  subscriptions?: Record<
    string,
    {
      expires_date: string | null;
      unsubscribe_detected_at: string | null;
      billing_issues_detected_at: string | null;
      is_sandbox: boolean;
      period_type?: string;
    }
  >;
}

// ---- V2 wire shapes (subset of fields we consume) ----
interface V2Customer {
  id: string;
}
interface V2ActiveEntitlement {
  entitlement_id: string;
  expires_at: number | null;
}
interface V2Subscription {
  id: string;
  product_id?: string | null;
  current_period_starts_at?: number | null;
  current_period_ends_at?: number | null;
  status?: string;
  environment?: string;
  auto_renewal_status?: string;
}
interface V2List<T> {
  items?: T[];
  next_page?: string | null;
}

const V2_BASE = 'https://api.revenuecat.com/v2';

function msToIso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function emptySubscriber(appUserId: string): RevenueCatSubscriber {
  return { original_app_user_id: appUserId, entitlements: { active: {} }, subscriptions: {} };
}

/** Fetch JSON with a shared abort signal. Returns status + parsed body. */
async function rcGet<T>(
  url: string,
  apiKey: string,
  signal: AbortSignal
): Promise<{ status: number; ok: boolean; body: T | null }> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal,
  });
  const body = res.ok ? ((await res.json()) as T) : null;
  return { status: res.status, ok: res.ok, body };
}

export async function getSubscriber(
  appUserId: string,
  env: Env
): Promise<RevenueCatSubscriber> {
  const apiKey = env.REVENUECAT_SECRET_API_KEY;
  if (!apiKey) {
    throw new RevenueCatError('REVENUECAT_SECRET_API_KEY is not configured');
  }
  const projectId = env.REVENUECAT_PROJECT_ID;
  if (!projectId) {
    throw new RevenueCatError('REVENUECAT_PROJECT_ID is not configured');
  }
  const proEntitlementId = env.REVENUECAT_PRO_ENTITLEMENT_ID;

  const cid = encodeURIComponent(appUserId);
  const base = `${V2_BASE}/projects/${projectId}/customers/${cid}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    // 1) Customer. A never-seen user 404s — treat as "no subscription".
    const customer = await rcGet<V2Customer>(base, apiKey, controller.signal);
    if (customer.status === 404) {
      return emptySubscriber(appUserId);
    }
    if (!customer.ok) {
      console.error('[revenuecat] getCustomer failed', scrubForLogs({ status: customer.status, appUserId }));
      throw new RevenueCatError(`RevenueCat HTTP ${customer.status}`, customer.status);
    }

    // 2) Active entitlements + 3) subscriptions.
    const [ents, subs] = await Promise.all([
      rcGet<V2List<V2ActiveEntitlement>>(`${base}/active_entitlements`, apiKey, controller.signal),
      rcGet<V2List<V2Subscription>>(`${base}/subscriptions`, apiKey, controller.signal),
    ]);
    if (!ents.ok) {
      throw new RevenueCatError(`RevenueCat HTTP ${ents.status}`, ents.status);
    }
    if (!subs.ok) {
      throw new RevenueCatError(`RevenueCat HTTP ${subs.status}`, subs.status);
    }

    return assembleSubscriber(
      customer.body?.id ?? appUserId,
      ents.body?.items ?? [],
      subs.body?.items ?? [],
      proEntitlementId
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Map V2 customer sub-resources back to the legacy subscriber shape. */
function assembleSubscriber(
  originalAppUserId: string,
  entitlements: V2ActiveEntitlement[],
  subscriptions: V2Subscription[],
  proEntitlementId: string | undefined
): RevenueCatSubscriber {
  const active: Record<string, RevenueCatEntitlement> = {};
  for (const e of entitlements) {
    // Only the entitlement id is available; label the known "pro" one so
    // downstream `entitlements.active.pro` checks work. Others keyed by id.
    const key = proEntitlementId && e.entitlement_id === proEntitlementId ? 'pro' : e.entitlement_id;
    active[key] = {
      expires_date: msToIso(e.expires_at),
      product_identifier: null, // not exposed on active_entitlement; filled from subs below
      purchase_date: null,
    };
  }

  const subs: NonNullable<RevenueCatSubscriber['subscriptions']> = {};
  for (const s of subscriptions) {
    const hasBillingIssue = s.status === 'in_grace_period' || s.status === 'in_billing_retry';
    const key = s.product_id || s.id;
    subs[key] = {
      expires_date: msToIso(s.current_period_ends_at),
      unsubscribe_detected_at:
        s.auto_renewal_status && s.auto_renewal_status !== 'will_renew'
          ? msToIso(s.current_period_starts_at)
          : null,
      billing_issues_detected_at: hasBillingIssue
        ? (msToIso(s.current_period_ends_at) ?? msToIso(s.current_period_starts_at))
        : null,
      is_sandbox: s.environment === 'sandbox',
      period_type: s.status === 'trialing' ? 'trial' : 'normal',
    };
  }

  return { original_app_user_id: originalAppUserId, entitlements: { active }, subscriptions: subs };
}

export function deriveBillingState(subscriber: RevenueCatSubscriber): 'normal' | 'grace' | 'paused' {
  const subs = subscriber.subscriptions ?? {};
  for (const sub of Object.values(subs)) {
    if (sub.billing_issues_detected_at) return 'grace';
  }
  return 'normal';
}

export function hasActivePro(subscriber: RevenueCatSubscriber): boolean {
  return Boolean(subscriber.entitlements?.active?.pro);
}
