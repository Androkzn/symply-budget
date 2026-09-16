/**
 * "Is this household local-first?" — the H7 P4 gate (plan §9).
 *
 * **Why this is needed at all, and why it did not used to be.** Under E2EE the
 * Worker's D1 holds no domain rows for a local-first household, so most cron work
 * degrades to a natural no-op: a reminder sweep over `tasks` simply finds
 * nothing. The plan accepted that for Budget.
 *
 * What broke the assumption is `mirrorLegacyMembership`. To keep chat and the
 * other `/households/:id/...` features working, V2 households ARE mirrored into
 * the legacy `households` / `household_members` tables — so anything that
 * enumerates households now *sees* local-first ones and does per-household work
 * against data that lives only on someone's phone. For the AI Housekeeper weekly
 * digest that is not a harmless no-op: it composes and **sends** an email or push
 * built from an empty week.
 *
 * The plan's locked assignment (§9, Q8) is explicit about the resolution:
 * briefings and weekly digests are **P1 in-app**, and **email/push delivery is
 * P4 — switched off** for local-first households. This is the switch.
 *
 * Membership in `lf_households` is the definition of "local-first": a row exists
 * there only once a device has registered the property with the control plane,
 * which is exactly the point after which its domain data stops reaching D1.
 */
import type { Env } from '../types';

/**
 * Every household id that has a local-first control-plane record.
 *
 * Returned as a Set and fetched once per cron tick rather than per household:
 * the digest pass iterates identities and would otherwise issue one query each.
 * The table holds one row per property, so this stays small.
 */
export async function localFirstHouseholdIds(env: Env): Promise<Set<string>> {
  try {
    const { results } = await env.DB.prepare(`SELECT id FROM lf_households`).all<{ id: string }>();
    return new Set((results ?? []).map((row) => row.id));
  } catch (error) {
    // The table is absent on a brand whose D1 predates 0152. Failing open (empty
    // set) preserves today's behaviour for those brands rather than taking the
    // whole cron tick down — and a brand with no `lf_households` has no
    // local-first households to skip in the first place.
    console.warn('[local-first] household gate unavailable', error);
    return new Set<string>();
  }
}

export async function isLocalFirstHousehold(env: Env, householdId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM lf_households WHERE id = ? LIMIT 1`)
    .bind(householdId)
    .first<{ ok: number }>();
  return !!row;
}
