/**
 * Inter-Worker transport helpers for Data Bridge.
 * Prefer service-binding RPC; HTTP fallback uses per-edge service tokens.
 */
import { getAppBrand } from '../config/brand';
import type { JoinedRuntimeBrandId } from '../config/platform-brands';
import {
  childToHouseServiceToken,
  houseToChildServiceToken,
} from '../config/platform-service-tokens';
import type { Env } from '../types';

export type BridgeCallerBrand = JoinedRuntimeBrandId;

export type PlatformBridgeRpc = {
  ping(): Promise<{ ok: true; brand: string }>;
  resolveSession?(args: {
    accessToken: string;
    callerBrand: BridgeCallerBrand;
  }): Promise<{ sub: string; ent_ver: number; sid: string } | null>;
};

function edgeTokenFor(
  env: Env,
  callee: 'house' | 'budget' | 'kaizen'
): string | undefined {
  if (callee === 'house') return childToHouseServiceToken(env);
  return houseToChildServiceToken(env, callee);
}

export function getHouseService(env: Env): PlatformBridgeRpc | undefined {
  return env.HOUSE_SERVICE as PlatformBridgeRpc | undefined;
}

export function getBudgetService(env: Env): PlatformBridgeRpc | undefined {
  return env.BUDGET_SERVICE as PlatformBridgeRpc | undefined;
}

export function getKaizenService(env: Env): PlatformBridgeRpc | undefined {
  return env.KAIZEN_SERVICE as PlatformBridgeRpc | undefined;
}

/**
 * HTTP fallback to a sibling Worker. Never used when service binding is present.
 */
export async function fetchSiblingHttp(
  env: Env,
  callee: 'house' | 'budget' | 'kaizen',
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const base =
    callee === 'house'
      ? env.HOUSE_API_FALLBACK_URL
      : callee === 'budget'
        ? env.BUDGET_API_FALLBACK_URL
        : env.KAIZEN_API_FALLBACK_URL;
  if (!base) {
    throw new Error(`${callee}_unreachable`);
  }
  const token = edgeTokenFor(env, callee);
  const headers = new Headers(init.headers);
  if (token) headers.set('X-Platform-Service-Token', token);
  headers.set('X-Platform-Caller-Brand', getAppBrand(env));
  return fetch(new URL(path, base.endsWith('/') ? base : `${base}/`), {
    ...init,
    headers,
  });
}
