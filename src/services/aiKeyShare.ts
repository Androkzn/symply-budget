/**
 * Household AI key sharing — the device half.
 *
 * A member seals their own provider key under a subkey of the Household Data
 * Key and publishes the envelope; every other enrolled device can open it,
 * because they hold the same HDK and the control plane does not. The Worker
 * stores ciphertext it cannot read (see `backend/src/services/ai-key-share-service.ts`).
 *
 * ## Why a borrowed key is never written to the Keychain
 *
 * `aiKeyVault` is the durable home for a key you TYPED. A key someone else lent
 * you is a different thing: the lender must be able to take it back, and they
 * cannot if every member's Keychain holds a permanent copy. So a borrowed key is
 * fetched on use and cached in memory only — process memory, dropped on the TTL
 * below and gone when the app is killed. "Stop sharing" then genuinely stops
 * access.
 *
 * Be honest about the ceiling on that, because the UI copy is: a member who has
 * already used the key could have copied it out of the app by other means, and
 * no product decision undoes that. Revocation ends access THROUGH this app. The
 * only complete revocation is rotating the key in the provider's own console.
 *
 * Fetching on use costs nothing offline: a BYOK call goes to api.openai.com, so
 * the network is already required.
 *
 * ## Brand neutrality
 *
 * This module is imported by the shared AI Providers screen, so it must not
 * import a brand's engine at module scope. `householdCrypto()` resolves the
 * local-first engine lazily, per brand, and returns null where there is none —
 * which is also the capability check the UI uses to decide whether to render the
 * sharing section at all.
 */


import axios from 'axios';

import type { AIProviderId } from '@api/aiAccess';
import { apiClient } from '@api/client';
import { brand } from '@brand';
import { useAuthStore } from '@stores/authStore';
import {
  AI_KEY_SHARE_VERSION,
  aiKeyHint,
  openAiKeyShare,
  sealAiKeyShare,
} from '@symply/local-first';
import { getApiErrorMessage } from '@utils/apiError';

/**
 * How long an unsealed borrowed key stays in memory. Short enough that a
 * revocation takes effect within minutes, long enough that a burst of receipt
 * scans is one round trip rather than twenty.
 */
const BORROWED_KEY_TTL_MS = 5 * 60 * 1000;

/**
 * How long we remember that NOBODY is sharing a given provider.
 *
 * Without it, a member who has connected no key at all pays a round trip on
 * every scan to be told again that there is nothing to borrow. Much shorter
 * than the positive TTL: being slow to notice a NEW share is a member wondering
 * why the key they were just notified about is not there yet.
 */
const NO_SHARE_TTL_MS = 60 * 1000;

export interface SharedAiKeySummary {
  id: string;
  /**
   * Which household this share lives in.
   *
   * Not cosmetic: a device holds a session per household, and unsealing needs
   * THAT household's HDK. Carrying it on the summary is what lets every later
   * call (envelope, consent, revoke) address the household the share is
   * actually in rather than whichever one the UI happens to have active.
   */
  householdId: string;
  /** For the row's subtitle when this device holds more than one household. */
  householdName: string;
  provider: AIProviderId;
  ownerUserId: string;
  ownerName: string | null;
  keyHint: string;
  keyEpoch: number;
  envelopeVersion: string;
  createdAt: string;
  /** True for your own share — the UI shows "Sharing" rather than "Use". */
  isMine: boolean;
  /** Whether YOU have accepted the third-party data disclosure for this share. */
  consented: boolean;
}

interface ShareListResponse {
  shares: SharedAiKeySummary[];
  keyEpoch: number;
}

interface ShareEnvelopeResponse {
  envelope: {
    id: string;
    provider: AIProviderId;
    ownerUserId: string;
    ciphertext: string;
    keyEpoch: number;
    envelopeVersion: string;
  };
}

export interface HouseholdCrypto {
  householdId: string;
  /** The household's own name, for copy that has to say WHICH household. */
  displayName: string;
  /** True for the household (House: property) the brand's UI is showing. */
  isActive: boolean;
  hdk: Uint8Array;
  keyEpoch: number;
  /** `epoch → hdk` for shares published before the last rotation. */
  retired: Map<number, Uint8Array>;
  /** The header this brand's local-first Worker routes on. */
  headers: Record<string, string>;
  /**
   * Make sure the household has a control-plane row before we write to it.
   *
   * A household that has never invited anyone is local-only — it has no
   * `lf_households` row, so every `/v2` call 404s. Registration is deliberately
   * forced only by "the act that makes a household shared", and offering your AI
   * key to the household is exactly such an act. Without this, Share fails with
   * a bewildering "household not found" on the most common first-time path.
   */
  ensureRegistered: () => Promise<void>;
}

/**
 * One brand's local-first engine, reduced to what sealing a key share needs.
 *
 * Budget and House both hold several households (House calls them properties)
 * with per-household keys, both register those households on the same `/v2`
 * control plane, and both route on their own header. Everything else about the
 * two engines differs, so this is the seam: add a brand here and the whole
 * sharing feature — picker block, manage rows, borrowed-key ladder — lights up
 * for it, because every one of those reads `householdCryptos()`.
 */
interface LocalFirstShareAdapter {
  /** The header this brand's local-first Worker routes on. */
  headers: Record<string, string>;
  /** Name for a household whose own name is empty. */
  fallbackName: string;
  /** Every household on this device — including ones awaiting enrolment. */
  list: () => Array<{
    householdId: string;
    name: string;
    isActive: boolean;
    awaitingEnrolment: boolean;
  }>;
  /**
   * Key material for one household, or null when this device has none for it.
   * Per household, NOT the brand's global "active session" accessor — see the
   * bug described on `householdCryptos`.
   */
  keys: (
    householdId: string,
  ) => Promise<{ hdk: Uint8Array; keyEpoch: number; retired: Map<number, Uint8Array> } | null>;
  /** Claim the household's control-plane row — see `ensureRegistered`. */
  register: (householdId: string) => Promise<void>;
}

/**
 * Brand-keyed **lazy `require`**, matching `budget/local/flag.ts`. Deliberately
 * not a module-scope import (it would run an engine's init in every app that
 * renders the shared AI Providers screen) and deliberately not `await import()`:
 * Jest runs without `--experimental-vm-modules`, so a dynamic import throws at
 * runtime here and `householdCryptos` would silently answer "no household" in
 * every test — indistinguishable from the real not-enrolled case, and it would
 * hide regressions.
 */
function shareAdapter(): LocalFirstShareAdapter | null {
  if (brand.id === 'symply-budget') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy by design; see above
    const engine = require('@features/budget/local/engine') as typeof import('@features/budget/local/engine');
    return {
      headers: { 'X-Budget-Local-First': '1' },
      fallbackName: 'Your household',
      list: () => engine.listLocalBudgetHouseholds(),
      keys: async (householdId) => {
        const session = await engine.getLocalBudgetSession(householdId);
        const keys = session.householdKeys;
        if (!keys?.hdk?.length) return null;
        return {
          hdk: keys.hdk,
          keyEpoch: keys.keyEpoch,
          retired: session.retiredHouseholdKeys,
        };
      },
      register: async (householdId) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as above
        const cp = require('@features/budget/local/controlPlaneClient') as typeof import('@features/budget/local/controlPlaneClient');
        await cp.syncLocalHouseholdToControlPlane(householdId, { force: true });
      },
    };
  }

  if (brand.id === 'symply-house') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as above
    const engine = require('@features/house/local/engine') as typeof import('@features/house/local/engine');
    return {
      headers: { 'X-House-Local-First': '1' },
      fallbackName: 'Your home',
      list: () => engine.listLocalHouseProperties(),
      // The hydration-free accessor on purpose: `getLocalHouseSession` decrypts
      // the property's whole ledger, and a member with three properties would
      // pay three ledger decrypts to open the AI Providers screen.
      keys: async (householdId) => {
        const material = engine.getLocalHouseHouseholdKeys(householdId);
        if (!material?.householdKeys?.hdk?.length) return null;
        return {
          hdk: material.householdKeys.hdk,
          keyEpoch: material.householdKeys.keyEpoch,
          retired: material.retiredHouseholdKeys,
        };
      },
      register: async (householdId) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as above
        const cp = require('@features/house/local/controlPlaneClient') as typeof import('@features/house/local/controlPlaneClient');
        await cp.syncLocalHouseholdToControlPlane(householdId);
      },
    };
  }

  // Kaizen has no local-first engine; Health's is not wired to key sharing yet.
  return null;
}

/**
 * EVERY local-first household this device holds, active first.
 *
 * ## Why this is a list and not "the active household"
 *
 * A Budget or House device is multi-household, and the two facts that decide
 * whether a shared key is usable live in different places: the MEMBERSHIP is on
 * the control plane, and the HDK that opens the envelope is in this device's
 * session for that household. Reading only the active session conflated them.
 *
 * That shipped, and this is what it did. A member of "Sweet Home" whose device
 * had also minted its own household on first launch — the ordinary state for
 * anyone who opened Budget before joining — sat on a device that was enrolled
 * in both. The owner shared three keys into Sweet Home; she got the push
 * notification, because notifications are addressed off `lf_memberships` and
 * she is a member. Then her device listed shares for its ACTIVE household, her
 * own, found none, and — having no local keys of its own to offer either —
 * rendered nothing at all. Three keys were waiting for her behind a section
 * that had decided it had nothing to say.
 *
 * So: fan out over the households this device actually holds. Active first,
 * which is what makes `find` on the flattened list prefer the household the
 * member is looking at when two of them lend the same provider.
 */
export async function householdCryptos(): Promise<HouseholdCrypto[]> {
  try {
    const adapter = shareAdapter();
    if (!adapter) return [];

    const out: HouseholdCrypto[] = [];
    for (const summary of adapter.list()) {
      // Claimed an invite but the owner has not wrapped the key to us yet: the
      // session holds a placeholder HDK, so anything sealed with it is junk.
      if (summary.awaitingEnrolment) continue;
      const keys = await adapter.keys(summary.householdId);
      if (!keys) continue;
      out.push({
        householdId: summary.householdId,
        displayName: summary.name || adapter.fallbackName,
        isActive: summary.isActive,
        hdk: keys.hdk,
        keyEpoch: keys.keyEpoch,
        retired: keys.retired,
        headers: adapter.headers,
        ensureRegistered: () => adapter.register(summary.householdId),
      });
    }
    return out.sort((a, b) => Number(b.isActive) - Number(a.isActive));
  } catch {
    // No engine started (not enrolled, or a brand without one) — not an error,
    // just "sharing is unavailable here".
    return [];
  }
}

/** Whether this build/device can share AI keys at all. */
export async function canShareAiKeys(): Promise<boolean> {
  return (await householdCryptos()).length > 0;
}

function requireUserId(): string {
  const id = useAuthStore.getState().user?.id;
  if (!id) throw new Error('Sign in before sharing your AI key.');
  return id;
}

/**
 * The key material for ONE household, by id.
 *
 * Every write path takes the household from the share it is acting on, so a
 * consent or a revoke can never land on a different household than the row the
 * member tapped.
 */
async function requireCrypto(householdId?: string): Promise<HouseholdCrypto> {
  const cryptos = await householdCryptos();
  if (cryptos.length === 0) throw new Error('Key sharing needs a household on this device.');
  if (!householdId) return cryptos[0];

  const match = cryptos.find((c) => c.householdId === householdId);
  if (!match) {
    // The share names a household this device no longer holds — it was dropped,
    // or the member was revoked from it. Nothing here can open that envelope.
    throw new Error('That household is no longer on this device.');
  }
  return match;
}

/**
 * Copy for a sharing action that failed.
 *
 * Two error vocabularies meet at every call site, and neither one alone is
 * right:
 *
 *  - The preconditions THIS module throws ("Sign in before sharing your AI
 *    key.") are already written for a person and name the fix, so they are
 *    surfaced verbatim.
 *  - An HTTP failure must never be. Axios's `.message` is
 *    "Request failed with status code 500" — which is exactly what a member was
 *    shown while the control plane was missing the share tables, a banner that
 *    said nothing about what broke or whether retrying could help. Those go
 *    through `getApiErrorMessage`, which prefers the Worker's own message and
 *    substitutes `fallback` for anything technical.
 */
export function aiKeyShareErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error) && error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return getApiErrorMessage(error, fallback);
}

/**
 * Every share visible to this member, across every household on this device.
 *
 * One household's failure is contained to that household. A device that holds a
 * shared "Sweet Home" and a never-registered personal household would otherwise
 * lose the whole list to the personal one's 404 — the same "nothing to show"
 * that hid three waiting keys before this fanned out.
 */
export async function listSharedAiKeys(): Promise<{ shares: SharedAiKeySummary[] }> {
  const cryptos = await householdCryptos();
  if (cryptos.length === 0) throw new Error('Key sharing needs a household on this device.');

  const perHousehold = await Promise.all(
    cryptos.map(async (crypto) => {
      try {
        const res = await apiClient.get<ShareListResponse>(
          `/v2/households/${crypto.householdId}/ai-key-shares`,
          { headers: crypto.headers },
        );
        return (res.data.shares ?? []).map((share) => ({
          ...share,
          householdId: crypto.householdId,
          householdName: crypto.displayName,
        }));
      } catch {
        return [] as SharedAiKeySummary[];
      }
    }),
  );

  // Flattened in `householdCryptos` order — active household first — so a later
  // `find` prefers the household the member is actually looking at.
  return { shares: perHousehold.flat() };
}

/**
 * Publish this device's key for `provider` to one household.
 *
 * `householdId` is required rather than implied: on a multi-household device an
 * implied target means silently lending your key — and your provider bill — to
 * whichever household the UI happened to have active.
 *
 * Sealed with the CURRENT epoch — the server rejects anything else, because a
 * share sealed under a stale epoch is unopenable by everyone else and would
 * only surface later as "this shared key doesn't work".
 */
export async function shareAiKeyWithHousehold(input: {
  provider: AIProviderId;
  apiKey: string;
  householdId?: string;
}): Promise<{ id: string; keyHint: string }> {
  const crypto = await requireCrypto(input.householdId);
  const ownerUserId = requireUserId();

  // Claim the household's server row first — see `ensureRegistered`.
  await crypto.ensureRegistered();

  const ciphertext = sealAiKeyShare({
    hdk: crypto.hdk,
    ctx: {
      householdId: crypto.householdId,
      keyEpoch: crypto.keyEpoch,
      provider: input.provider,
      ownerUserId,
    },
    apiKey: input.apiKey,
  });

  const res = await apiClient.put<{ share: { id: string; keyHint: string } }>(
    `/v2/households/${crypto.householdId}/ai-key-shares/${input.provider}`,
    {
      ciphertext,
      keyEpoch: crypto.keyEpoch,
      envelopeVersion: `v${AI_KEY_SHARE_VERSION}`,
      keyHint: aiKeyHint(input.apiKey),
    },
    { headers: crypto.headers },
  );
  return res.data.share;
}

/** Stop sharing this member's key for `provider`, in one household. */
export async function stopSharingAiKey(
  provider: AIProviderId,
  householdId?: string,
): Promise<void> {
  const crypto = await requireCrypto(householdId);
  await apiClient.delete(`/v2/households/${crypto.householdId}/ai-key-shares/${provider}`, {
    headers: crypto.headers,
  });
  forgetBorrowedAiKey(provider);
}

/** Record acceptance of the third-party data disclosure for someone else's share. */
export async function acceptSharedAiKey(input: {
  householdId: string;
  shareId: string;
  provider: AIProviderId;
  consentVersion: string;
}): Promise<void> {
  const crypto = await requireCrypto(input.householdId);
  await apiClient.post(
    `/v2/households/${crypto.householdId}/ai-key-shares/${input.shareId}/consent`,
    { consentVersion: input.consentVersion },
    { headers: crypto.headers },
  );
  // Clear the negative cache so the next inference picks the key up now, rather
  // than after the back-off expires.
  forgetBorrowedAiKey(input.provider);
}

/** In-memory only. Never persisted, never written to the Keychain. */
interface BorrowedKey {
  apiKey: string;
  ownerUserId: string;
  fetchedAt: number;
}

const borrowed = new Map<AIProviderId, BorrowedKey>();
const noShareUntil = new Map<AIProviderId, number>();

/** Drop every borrowed key — sign-out, household switch, or an explicit forget. */
export function forgetBorrowedAiKeys(): void {
  borrowed.clear();
  noShareUntil.clear();
}

/** Drop one provider's borrowed key, e.g. after the provider rejects it. */
export function forgetBorrowedAiKey(provider: AIProviderId): void {
  borrowed.delete(provider);
  noShareUntil.delete(provider);
}

/**
 * Fetch and unseal one share. The plaintext is returned and cached in memory;
 * it is never written to disk.
 *
 * Addressed by household, because the HDK that opens the envelope is the
 * SHARING household's — not whichever household this device has active.
 */
export async function borrowSharedAiKey(input: {
  householdId: string;
  shareId: string;
}): Promise<{
  provider: AIProviderId;
  apiKey: string;
  ownerUserId: string;
}> {
  const crypto = await requireCrypto(input.householdId);

  const res = await apiClient.post<ShareEnvelopeResponse>(
    `/v2/households/${crypto.householdId}/ai-key-shares/${input.shareId}/envelope`,
    {},
    { headers: crypto.headers },
  );
  const envelope = res.data.envelope;

  const hdk =
    crypto.keyEpoch === envelope.keyEpoch
      ? crypto.hdk
      : (crypto.retired.get(envelope.keyEpoch) ?? null);

  if (!hdk) {
    // The household key rotated and this device never received that retired
    // epoch. Say so plainly instead of failing later inside a provider call.
    throw new Error(
      'That shared key was locked with an older household key. Ask them to share it again.',
    );
  }

  const apiKey = openAiKeyShare({
    hdk,
    ctx: {
      householdId: crypto.householdId,
      keyEpoch: envelope.keyEpoch,
      provider: envelope.provider,
      ownerUserId: envelope.ownerUserId,
    },
    ciphertextB64: envelope.ciphertext,
  });

  borrowed.set(envelope.provider, {
    apiKey,
    ownerUserId: envelope.ownerUserId,
    fetchedAt: Date.now(),
  });

  return { provider: envelope.provider, apiKey, ownerUserId: envelope.ownerUserId };
}

/**
 * A usable borrowed key for `provider`, or null.
 *
 * Serves the memory cache while fresh, otherwise re-reads the share — which is
 * also how a revocation is noticed: the fetch 404s and this returns null, so the
 * caller falls through to "no key" rather than using a key that was taken back.
 *
 * Never throws. A borrowed key is a convenience on top of your own; a network
 * blip must degrade to "no shared key", not break the scan.
 */
export async function getBorrowedAiKey(
  provider: AIProviderId,
): Promise<{ provider: AIProviderId; apiKey: string; ownerUserId: string } | null> {
  const now = Date.now();

  const cached = borrowed.get(provider);
  if (cached && now - cached.fetchedAt < BORROWED_KEY_TTL_MS) {
    return { provider, apiKey: cached.apiKey, ownerUserId: cached.ownerUserId };
  }

  const backOffUntil = noShareUntil.get(provider);
  if (backOffUntil && now < backOffUntil) return null;

  try {
    const { shares } = await listSharedAiKeys();
    // `consented` matters: an unaccepted share is visible but not usable, the
    // server would refuse the envelope anyway, and borrowing it silently would
    // skip the disclosure the acceptance exists for.
    // `shares` is ordered active-household-first, so when two households both
    // lend this provider the member gets the one they are working in.
    const share = shares.find((s) => s.provider === provider && !s.isMine && s.consented);
    if (!share) {
      borrowed.delete(provider);
      noShareUntil.set(provider, now + NO_SHARE_TTL_MS);
      return null;
    }
    const result = await borrowSharedAiKey({
      householdId: share.householdId,
      shareId: share.id,
    });
    noShareUntil.delete(provider);
    return result;
  } catch {
    // Serving a stale cache here would defeat revocation, since the likeliest
    // reason the fetch failed is that the share is gone.
    borrowed.delete(provider);
    noShareUntil.set(provider, now + NO_SHARE_TTL_MS);
    return null;
  }
}
