/**
 * Platform edge service tokens — resolve child↔House credentials once (Track A A6).
 */
import type { Env } from '../types';

import { getAppBrand, type AppBrand } from './brand';
import { isAuthProxyToHouseEnabled, isPlatformAuthorityBrand, isPlatformAuthorityEnabled } from './brand-capabilities';
import type { JoinedRuntimeBrandId } from './platform-brands';

const CHILD_TO_HOUSE_TOKEN: Partial<Record<AppBrand, keyof Env>> = {
  'symply-budget': 'PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE',
  'symply-kaizen': 'PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE',
  'symply-health': 'PLATFORM_SERVICE_TOKEN_HEALTH_TO_HOUSE',
};

const CALLER_TO_HOUSE_TOKEN: Partial<Record<JoinedRuntimeBrandId, keyof Env>> = {
  'symply-budget': 'PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE',
  'symply-kaizen': 'PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE',
  'symply-health': 'PLATFORM_SERVICE_TOKEN_HEALTH_TO_HOUSE',
  'symply-language': 'PLATFORM_SERVICE_TOKEN_LANGUAGE_TO_HOUSE',
};

function envToken(env: Env, key: keyof Env): string | undefined {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Child Worker → House token when this Worker proxies auth or RPC. */
export function childToHouseServiceToken(env: Env): string | undefined {
  if (!isAuthProxyToHouseEnabled(env)) return undefined;
  const key = CHILD_TO_HOUSE_TOKEN[getAppBrand(env)];
  return key ? envToken(env, key) : undefined;
}

/** House Worker → child Worker token for outbound sibling HTTP/RPC. */
export function houseToChildServiceToken(
  env: Env,
  callee: 'budget' | 'kaizen' | 'health' | 'language'
): string | undefined {
  if (!isPlatformAuthorityEnabled(env)) return undefined;
  if (callee === 'budget') return envToken(env, 'PLATFORM_SERVICE_TOKEN_HOUSE_TO_BUDGET');
  if (callee === 'health') return envToken(env, 'PLATFORM_SERVICE_TOKEN_HOUSE_TO_HEALTH');
  if (callee === 'language') return envToken(env, 'PLATFORM_SERVICE_TOKEN_HOUSE_TO_LANGUAGE');
  return envToken(env, 'PLATFORM_SERVICE_TOKEN_HOUSE_TO_KAIZEN');
}

/** House-side validation of X-Platform-Caller-Brand service tokens. */
export function incomingCallerServiceToken(
  env: Env,
  callerBrand: JoinedRuntimeBrandId
): string | undefined {
  if (isPlatformAuthorityBrand(callerBrand)) return undefined;
  const key = CALLER_TO_HOUSE_TOKEN[callerBrand];
  return key ? envToken(env, key) : undefined;
}
