/**
 * Feature Flag Service
 *
 * Global, developer-controlled feature flags (a remote "kill switch") backed by
 * CONFIG_KV. The same config applies to every user — these flags answer
 * "is this feature released?", NOT "has this user paid?" (that is the mobile
 * SubscriptionContext's job).
 *
 * Resolution on the server is simply: KV overrides shallow-merged over the
 * build-time DEFAULT_FLAGS below. DEFAULT_FLAGS is the safe fallback when KV is
 * empty or unreachable, so a feature is never accidentally exposed.
 *
 * The canonical key list here MUST stay in sync with the mobile catalog in
 * src/config/features.ts. Unknown keys coming from KV are ignored.
 */

const KV_KEY = 'feature-flags:v1';

/**
 * Build-time defaults. Currently-shipped surfaces default to `true` (so adding
 * this service is behaviour-preserving). A brand-new / unfinished feature should
 * be added with a default of `false` so it stays hidden until explicitly flipped
 * on remotely.
 */
export const DEFAULT_FLAGS = {
  // Core surfaces — always on.
  myHome: true,
  dashboard: true,
  settings: true,

  // Extended surfaces — shipped today, default on. Flip to false in KV to hide
  // app-wide without an App Store release.
  gardening: true,
  reports: true,
  tasks: true,
  contractors: true,
  utilities: true,
  // Mira / AI housekeeper — enabled (no active users; soft launch).
  aiHousekeeper: true,

  // Smart Task Assistant — fast voice/text capture + async AI enrichment, with
  // Tasks promoted to the main tab. New/unfinished surface → default off until
  // flipped on in KV.
  smartTaskAssistant: false,

  // Smart Project — describe-to-draft for Home Projects (migration 0166).
  // ON. The server is authoritative: the client default cannot win over this.
  smartProject: true,

  // AI access. Keep in sync with src/config/features.ts.
  //
  // `aiRequiresAccess` is THE pricing switch: the apps are free and complete
  // without AI, and AI itself runs on either an Apple subscription or the
  // member's own provider key. With it ON, a member with neither is denied
  // before any request reaches a managed provider — which is the whole point,
  // since managed inference is the one cost that scales with free installs.
  //
  // It is `false` here ONLY as the soft-launch state: managed AI stays open
  // until the App Store subscription products are live, because until then
  // "subscribe" is not a route a member can actually take. Flipping it is a KV
  // write, no rebuild — see documents/requirements/as-built/ai-migration-phase0-checklist.md:
  //   PUT /features  {"aiRequiresAccess": true}   (X-Admin-Secret)
  // Everything behind it is already built and enforced; nothing else changes.
  subscriptionsEnabled: true,
  bringYourOwnAIEnabled: true,
  aiFeaturesEnabled: true,
  aiRequiresAccess: false,
  openAIProviderEnabled: true,
  anthropicProviderEnabled: true,
  geminiProviderEnabled: true,

  // Data Bridge UI chrome (never authorize — House D1 is authority).
  softTransferEnabled: true,
  lifeSnapshotEnabled: false,
  realtimeVoiceEnabled: false,
  platformRegistrationEnabled: true,
} as const;

export type FeatureFlagKey = keyof typeof DEFAULT_FLAGS;
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export interface FeatureFlagsPayload {
  flags: FeatureFlags;
  version: number;
  updatedAt: string | null;
}

interface StoredFlags {
  flags: Partial<Record<FeatureFlagKey, boolean>>;
  version: number;
  updatedAt: string | null;
}

const FLAG_KEYS = Object.keys(DEFAULT_FLAGS) as FeatureFlagKey[];

/** Keep only known boolean keys from an untrusted object. */
function sanitize(
  input: Partial<Record<string, unknown>> | null | undefined
): Partial<Record<FeatureFlagKey, boolean>> {
  const out: Partial<Record<FeatureFlagKey, boolean>> = {};
  if (!input) return out;
  for (const key of FLAG_KEYS) {
    const value = input[key];
    if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

async function readStored(kv: KVNamespace): Promise<StoredFlags> {
  const raw = await kv.get<StoredFlags>(KV_KEY, 'json');
  return {
    flags: sanitize(raw?.flags),
    version: typeof raw?.version === 'number' ? raw.version : 0,
    updatedAt: raw?.updatedAt ?? null,
  };
}

/**
 * Resolve effective flags: defaults overlaid with any KV overrides.
 */
export async function getFlags(kv: KVNamespace): Promise<FeatureFlagsPayload> {
  const stored = await readStored(kv);
  return {
    flags: { ...DEFAULT_FLAGS, ...stored.flags },
    version: stored.version,
    updatedAt: stored.updatedAt,
  };
}

/**
 * Merge a partial set of overrides into KV and bump the version. Pass a value of
 * `null` (or omit a key) to leave it untouched; the merge is shallow over the
 * previously-stored overrides, not over DEFAULT_FLAGS — i.e. a key present in
 * DEFAULT_FLAGS but absent from KV continues to fall through to its default.
 */
export async function setFlags(
  kv: KVNamespace,
  partial: Partial<Record<string, unknown>>,
  nowIso: string
): Promise<FeatureFlagsPayload> {
  const stored = await readStored(kv);
  const merged = { ...stored.flags, ...sanitize(partial) };
  const next: StoredFlags = {
    flags: merged,
    version: stored.version + 1,
    updatedAt: nowIso,
  };
  await kv.put(KV_KEY, JSON.stringify(next));
  return {
    flags: { ...DEFAULT_FLAGS, ...merged },
    version: next.version,
    updatedAt: next.updatedAt,
  };
}
