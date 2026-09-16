import type { Env } from '../types';

import { hasBrandCapability } from './brand-capabilities';

/**
 * Local-first `/v2` control plane — House, Budget and **Health** Workers
 * (`LOCAL_FIRST_API_ENABLED` + capability). Health joined at He0; Kaizen is the
 * only brand without the capability.
 *
 * FAIL-CLOSED (Health V2 plan §1.7a): only the literal `'true'` enables. A
 * missing key, a typo (`'True'`, `'False'`), a half-finished rollout (`''`) or
 * a truthy-looking `'1'` must all mean OFF — the same convention
 * `isHealthSocialEnabled` (`src/routes/health-social.ts`) uses for a *less*
 * sensitive surface than the E2EE ledger this gate fronts.
 *
 * Every brand that wants `/v2` must therefore provision the value explicitly —
 * as a per-env **secret**, NOT a `[vars]` entry (plan §1.7a, Commit 3). Vars
 * and secrets share one namespace on `env`, so a `[vars]` line shadows the
 * secret and the next `wrangler deploy` re-arms `/v2` behind the operator's
 * back. House (`wrangler.toml`), Budget (`wrangler.budget.toml`) and Health
 * (`wrangler.health.toml`) carry it; Kaizen has no `localFirstApi` capability
 * and does not. Provision with `scripts/secrets/sync-child-worker-secrets.sh`;
 * `backend/scripts/verify-local-first-api-secret.sh` gates `deploy:fleet` on
 * it. This function ALSO gates the cron mailbox / checkpoint TTL sweeps
 * (`src/cron/scheduled.ts`), so a brand that loses the secret stops enforcing
 * the 14-day mailbox TTL as well as serving `/v2`.
 */
export function isLocalFirstApiEnabled(env: Env): boolean {
  return hasBrandCapability(env, 'localFirstApi') && env.LOCAL_FIRST_API_ENABLED === 'true';
}
