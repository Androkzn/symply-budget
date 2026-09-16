import { describe, it, expect, beforeEach } from 'vitest';

import type { Env } from '../../types';
import {
  assertRequiredSecrets,
  ensureRequiredSecrets,
  MisconfiguredSecretsError,
  resetRequiredSecretsLatchForTests,
} from '../required-secrets';

function mkEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'staging',
    LAMBDA_CALLBACK_API_KEY: 'test-callback-key',
    ...overrides,
  } as Env;
}

describe('assertRequiredSecrets (B6)', () => {
  beforeEach(() => {
    resetRequiredSecretsLatchForTests();
  });

  it('passes when staging has LAMBDA_CALLBACK_API_KEY', () => {
    expect(() => assertRequiredSecrets(mkEnv())).not.toThrow();
  });

  it('throws MisconfiguredSecretsError when staging key is missing', () => {
    expect(() =>
      assertRequiredSecrets(mkEnv({ LAMBDA_CALLBACK_API_KEY: undefined }))
    ).toThrow(MisconfiguredSecretsError);
  });

  it('throws when staging key is blank', () => {
    expect(() => assertRequiredSecrets(mkEnv({ LAMBDA_CALLBACK_API_KEY: '   ' }))).toThrow(
      MisconfiguredSecretsError
    );
  });

  it('skips check in development', () => {
    expect(() =>
      assertRequiredSecrets(
        mkEnv({ ENVIRONMENT: 'development', LAMBDA_CALLBACK_API_KEY: undefined })
      )
    ).not.toThrow();
  });

  it('ensureRequiredSecrets only asserts once per isolate', () => {
    const env = mkEnv({ LAMBDA_CALLBACK_API_KEY: undefined });
    expect(() => ensureRequiredSecrets(env)).toThrow(MisconfiguredSecretsError);
    // Latch not set on throw — retry still fails
    expect(() => ensureRequiredSecrets(env)).toThrow(MisconfiguredSecretsError);

    resetRequiredSecretsLatchForTests();
    const ok = mkEnv();
    expect(() => ensureRequiredSecrets(ok)).not.toThrow();
    // After success, even a broken env is not re-checked (isolate already validated)
    expect(() =>
      ensureRequiredSecrets(mkEnv({ LAMBDA_CALLBACK_API_KEY: undefined }))
    ).not.toThrow();
  });
});
