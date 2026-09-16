/**
 * Runtime fail-closed checks for secrets required in staging/production (Track B B6).
 * Workers have no true boot hook — assert on first fetch/scheduled/queue invocation.
 */

import type { Env } from '../types';

export class MisconfiguredSecretsError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Missing required secrets: ${missing.join(', ')}`);
    this.name = 'MisconfiguredSecretsError';
    this.missing = missing;
  }
}

/** Environments that must have Lambda webhook auth configured. */
function requiresLambdaCallbackSecret(env: Env): boolean {
  return env.ENVIRONMENT === 'staging' || env.ENVIRONMENT === 'production';
}

/**
 * Throws MisconfiguredSecretsError when staging/production is missing
 * LAMBDA_CALLBACK_API_KEY (no JWT_SECRET fallback).
 */
export function assertRequiredSecrets(env: Env): void {
  if (!requiresLambdaCallbackSecret(env)) return;

  const missing: string[] = [];
  if (!env.LAMBDA_CALLBACK_API_KEY?.trim()) {
    missing.push('LAMBDA_CALLBACK_API_KEY');
  }
  if (missing.length > 0) {
    throw new MisconfiguredSecretsError(missing);
  }
}

let secretsChecked = false;

/** Run assertRequiredSecrets once per isolate. */
export function ensureRequiredSecrets(env: Env): void {
  if (secretsChecked) return;
  assertRequiredSecrets(env);
  secretsChecked = true;
}

/** Test helper — reset the once-per-isolate latch. */
export function resetRequiredSecretsLatchForTests(): void {
  secretsChecked = false;
}
