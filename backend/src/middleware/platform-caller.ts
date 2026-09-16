/**
 * Helpers for trusted child→House auth calls.
 */
import type { Context } from 'hono';

import {
  isJoinedPlatformBrandId,
  isPlatformAuthorityBrand,
} from '../config/brand-capabilities';
import type { JoinedRuntimeBrandId } from '../config/platform-brands';
import { incomingCallerServiceToken } from '../config/platform-service-tokens';
import { platformMetric } from '../services/observability/platform-metrics';
import type { Env } from '../types';
import { ForbiddenError } from '../utils/errors';

function denyCaller(
  env: Env,
  reason: string,
  callerBrand?: string
): never {
  platformMetric(env, 'platform_bridge_auth_denial', 1, {
    reason,
    caller_brand: callerBrand ?? 'unknown',
  });
  throw new ForbiddenError(reason);
}

export function resolveTrustedCallerBrand(c: Context<{ Bindings: Env }>): JoinedRuntimeBrandId | null {
  const header = c.req.header('X-Platform-Caller-Brand')?.trim();
  if (!header) return null;
  if (!isJoinedPlatformBrandId(header)) {
    denyCaller(c.env, 'caller_brand_mismatch', header);
  }
  if (isPlatformAuthorityBrand(header)) return null;

  const token = c.req.header('X-Platform-Service-Token')?.trim();
  const expected = incomingCallerServiceToken(c.env, header as JoinedRuntimeBrandId);

  // Require service tokens in all deployed envs (staging + production). Only local
  // development may proceed without provisioned edge tokens.
  if (!expected) {
    if (c.env.ENVIRONMENT !== 'development') {
      denyCaller(c.env, 'service_token_required', header);
    }
    return header as JoinedRuntimeBrandId;
  }
  if (!token || token !== expected) {
    denyCaller(c.env, 'invalid_service_token', header);
  }
  return header as JoinedRuntimeBrandId;
}
