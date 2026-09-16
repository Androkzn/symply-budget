/**
 * Household AI key sharing — the control-plane half.
 *
 * A member offers their own BYOK provider key to their household. This service
 * stores and serves an OPAQUE envelope: the owner's device sealed the key under
 * a subkey derived from the Household Data Key, and the Worker holds no HDK and
 * cannot open it. Everything here is therefore authorization and bookkeeping,
 * never decryption.
 *
 * Two consequences worth stating, because they shape the API:
 *
 *  1. `key_hint` and `provider` are supplied by the client. The server cannot
 *     derive them, so it validates their SHAPE and nothing more. A lying client
 *     can only mislabel its own share.
 *  2. Recipients are handed the sealed blob, not a plaintext key, and are
 *     expected not to persist what they unseal. That is what makes `revoke`
 *     meaningful — see the honesty note on `revokeShare`.
 *
 * Membership is `lf_memberships`, not `household_members`: the HDK belongs to
 * the local-first household graph, and authorizing against the other one would
 * grant access on the strength of a membership the crypto knows nothing about.
 */

import { nanoid } from 'nanoid';

import type { Env } from '../types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { nowIso } from '../utils/id';

import { LocalFirstControlService } from './local-first-control-service';
import { NotificationService } from './notification-service';

export type AiKeyShareProvider = 'openai' | 'anthropic' | 'gemini';

export const AI_KEY_SHARE_PROVIDERS: readonly AiKeyShareProvider[] = [
  'openai',
  'anthropic',
  'gemini',
];

/**
 * Ceiling on a stored envelope. A sealed provider key is ~200 bytes of base64;
 * 4 KB is generous for a long key plus the AEAD overhead and stops the table
 * being used as free blob storage.
 */
const MAX_CIPHERTEXT_CHARS = 4096;

export interface AiKeyShareRow {
  id: string;
  household_id: string;
  owner_user_id: string;
  provider: AiKeyShareProvider;
  ciphertext: string;
  key_epoch: number;
  envelope_version: string;
  key_hint: string;
  status: 'active' | 'revoked';
  created_at: string;
  updated_at: string;
}

/** What a member sees when listing shares — metadata plus their own consent state. */
export interface AiKeyShareSummary {
  id: string;
  provider: AiKeyShareProvider;
  ownerUserId: string;
  ownerName: string | null;
  keyHint: string;
  keyEpoch: number;
  envelopeVersion: string;
  createdAt: string;
  /** True for the caller's own share — the UI shows "Sharing" rather than "Use". */
  isMine: boolean;
  /** Whether the CALLER has accepted the third-party data disclosure for this share. */
  consented: boolean;
}

function assertProvider(value: string): AiKeyShareProvider {
  if (!AI_KEY_SHARE_PROVIDERS.includes(value as AiKeyShareProvider)) {
    throw new ValidationError('Unsupported AI provider');
  }
  return value as AiKeyShareProvider;
}

export class AiKeyShareService {
  private readonly control: LocalFirstControlService;

  constructor(private readonly env: Env) {
    this.control = new LocalFirstControlService(env);
  }

  /**
   * Every entry point starts here. `assertMember` throws `not_a_member`, which
   * the routes map to 403 — matching how the rest of `/v2` reports it.
   */
  private async requireMember(householdId: string, userId: string): Promise<void> {
    try {
      await this.control.assertMember(householdId, userId);
    } catch (error) {
      if (error instanceof Error && error.message === 'not_a_member') {
        throw new ForbiddenError('Not a member of this household');
      }
      throw error;
    }
  }

  /** The household's current HDK epoch — the epoch a new share must be sealed under. */
  async currentKeyEpoch(householdId: string): Promise<number> {
    const row = await this.env.DB.prepare(
      `SELECT key_epoch FROM lf_households WHERE id = ?`,
    )
      .bind(householdId)
      .first<{ key_epoch: number }>();
    if (!row) throw new NotFoundError('Household');
    return row.key_epoch;
  }

  async listShares(householdId: string, userId: string): Promise<AiKeyShareSummary[]> {
    await this.requireMember(householdId, userId);

    const { results } = await this.env.DB.prepare(
      `SELECT s.id, s.provider, s.owner_user_id, s.key_hint, s.key_epoch,
              s.envelope_version, s.created_at,
              u.display_name AS owner_name,
              c.share_id IS NOT NULL AS consented
         FROM lf_ai_key_shares s
         LEFT JOIN users u ON u.id = s.owner_user_id
         LEFT JOIN lf_ai_key_share_consents c
                ON c.share_id = s.id AND c.user_id = ?
        WHERE s.household_id = ? AND s.status = 'active'
        ORDER BY s.created_at ASC`,
    )
      .bind(userId, householdId)
      .all<{
        id: string;
        provider: string;
        owner_user_id: string;
        key_hint: string;
        key_epoch: number;
        envelope_version: string;
        created_at: string;
        owner_name: string | null;
        consented: number;
      }>();

    return (results ?? []).map((row) => ({
      id: row.id,
      provider: row.provider as AiKeyShareProvider,
      ownerUserId: row.owner_user_id,
      ownerName: row.owner_name,
      keyHint: row.key_hint,
      keyEpoch: row.key_epoch,
      envelopeVersion: row.envelope_version,
      createdAt: row.created_at,
      isMine: row.owner_user_id === userId,
      consented: Boolean(row.consented),
    }));
  }

  /**
   * Publish (or replace) the caller's share for one provider.
   *
   * The epoch is checked against the household's current one rather than
   * trusted: a share sealed under a stale epoch would be unopenable by every
   * other member, and the failure would surface much later as "this shared key
   * doesn't work" with nothing to point at.
   */
  async upsertShare(input: {
    householdId: string;
    userId: string;
    provider: string;
    ciphertext: string;
    keyEpoch: number;
    envelopeVersion: string;
    keyHint: string;
  }): Promise<{ id: string; provider: AiKeyShareProvider; keyHint: string; createdAt: string }> {
    const provider = assertProvider(input.provider);
    await this.requireMember(input.householdId, input.userId);

    if (!input.ciphertext || input.ciphertext.length > MAX_CIPHERTEXT_CHARS) {
      throw new ValidationError('Invalid sealed key');
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(input.ciphertext)) {
      throw new ValidationError('Sealed key must be base64');
    }
    if (input.keyHint.length > 4) {
      // Longer than four characters would mean the client sent more of the key
      // than a hint — refuse rather than store it.
      throw new ValidationError('Key hint must be at most 4 characters');
    }

    const epoch = await this.currentKeyEpoch(input.householdId);
    if (input.keyEpoch !== epoch) {
      throw new ValidationError('Sealed under a stale key epoch; re-share from an up-to-date device');
    }

    const now = nowIso();
    const existing = await this.env.DB.prepare(
      `SELECT id FROM lf_ai_key_shares
        WHERE household_id = ? AND owner_user_id = ? AND provider = ?`,
    )
      .bind(input.householdId, input.userId, provider)
      .first<{ id: string }>();

    const id = existing?.id ?? nanoid();

    if (existing) {
      await this.env.DB.prepare(
        `UPDATE lf_ai_key_shares
            SET ciphertext = ?, key_epoch = ?, envelope_version = ?, key_hint = ?,
                status = 'active', revoked_at = NULL, updated_at = ?
          WHERE id = ?`,
      )
        .bind(input.ciphertext, epoch, input.envelopeVersion, input.keyHint, now, id)
        .run();

      // A replaced key is a different secret. Consents recorded against the old
      // one said "I accept sending my data to Ann's OpenAI account" and still
      // hold, so they are deliberately KEPT — re-prompting on every key rotation
      // would train members to tap through the disclosure.
    } else {
      await this.env.DB.prepare(
        `INSERT INTO lf_ai_key_shares
           (id, household_id, owner_user_id, provider, ciphertext, key_epoch,
            envelope_version, key_hint, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
        .bind(
          id,
          input.householdId,
          input.userId,
          provider,
          input.ciphertext,
          epoch,
          input.envelopeVersion,
          input.keyHint,
          now,
          now,
        )
        .run();
    }

    return { id, provider, keyHint: input.keyHint, createdAt: now };
  }

  /**
   * Hand a member the sealed envelope so their device can unseal it in memory.
   *
   * Gated on a recorded consent (Apple 5.1.2(i)): the caller's prompts are about
   * to reach a third party under someone else's account and billing, and the
   * owner's own acknowledgement does not cover the recipient.
   *
   * Returns ciphertext. The plaintext key exists only on the two devices.
   */
  async readShareEnvelope(input: {
    householdId: string;
    userId: string;
    shareId: string;
  }): Promise<{
    id: string;
    provider: AiKeyShareProvider;
    ownerUserId: string;
    ciphertext: string;
    keyEpoch: number;
    envelopeVersion: string;
  }> {
    await this.requireMember(input.householdId, input.userId);

    const row = await this.env.DB.prepare(
      `SELECT id, provider, owner_user_id, ciphertext, key_epoch, envelope_version
         FROM lf_ai_key_shares
        WHERE id = ? AND household_id = ? AND status = 'active'`,
    )
      .bind(input.shareId, input.householdId)
      .first<{
        id: string;
        provider: string;
        owner_user_id: string;
        ciphertext: string;
        key_epoch: number;
        envelope_version: string;
      }>();

    if (!row) throw new NotFoundError('Shared key');

    // The owner reading their own share needs no consent — it is their key and
    // their account. Everyone else must have accepted the disclosure.
    if (row.owner_user_id !== input.userId) {
      const consent = await this.env.DB.prepare(
        `SELECT share_id FROM lf_ai_key_share_consents WHERE share_id = ? AND user_id = ?`,
      )
        .bind(input.shareId, input.userId)
        .first<{ share_id: string }>();
      if (!consent) {
        throw new ForbiddenError('Accept the data-sharing disclosure before using this key');
      }
    }

    const now = nowIso();
    // Usage stamps are best-effort telemetry for the owner's "who is using my
    // key" view; a failed stamp must never block inference.
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(`UPDATE lf_ai_key_shares SET last_used_at = ? WHERE id = ?`).bind(
          now,
          input.shareId,
        ),
        this.env.DB.prepare(
          `UPDATE lf_ai_key_share_consents SET last_used_at = ? WHERE share_id = ? AND user_id = ?`,
        ).bind(now, input.shareId, input.userId),
      ]);
    } catch (error) {
      console.error('[ai-key-share] usage stamp failed', error);
    }

    return {
      id: row.id,
      provider: row.provider as AiKeyShareProvider,
      ownerUserId: row.owner_user_id,
      ciphertext: row.ciphertext,
      keyEpoch: row.key_epoch,
      envelopeVersion: row.envelope_version,
    };
  }

  /** Record the recipient's acceptance of the third-party data disclosure. */
  async recordConsent(input: {
    householdId: string;
    userId: string;
    shareId: string;
    consentVersion: string;
  }): Promise<{ ok: true }> {
    await this.requireMember(input.householdId, input.userId);

    const share = await this.env.DB.prepare(
      `SELECT id FROM lf_ai_key_shares
        WHERE id = ? AND household_id = ? AND status = 'active'`,
    )
      .bind(input.shareId, input.householdId)
      .first<{ id: string }>();
    if (!share) throw new NotFoundError('Shared key');

    await this.env.DB.prepare(
      `INSERT INTO lf_ai_key_share_consents (share_id, user_id, consent_version, consent_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(share_id, user_id)
       DO UPDATE SET consent_version = excluded.consent_version, consent_at = excluded.consent_at`,
    )
      .bind(input.shareId, input.userId, input.consentVersion, nowIso())
      .run();

    return { ok: true };
  }

  /**
   * Stop sharing. Only the owner may revoke their own share.
   *
   * The row is deleted, so no member can fetch the envelope again. Be honest
   * about the limit of that: a member who already unsealed the key could have
   * copied it out of the app. Revocation ends ACCESS THROUGH SYMPLY; it cannot
   * un-know a secret. The only complete revocation is rotating the key in the
   * provider's console, which is why the UI says so at both ends.
   */
  async revokeShare(input: {
    householdId: string;
    userId: string;
    provider: string;
  }): Promise<{ ok: true; provider: AiKeyShareProvider; notify: string[] }> {
    const provider = assertProvider(input.provider);
    await this.requireMember(input.householdId, input.userId);

    const share = await this.env.DB.prepare(
      `SELECT id FROM lf_ai_key_shares
        WHERE household_id = ? AND owner_user_id = ? AND provider = ?`,
    )
      .bind(input.householdId, input.userId, provider)
      .first<{ id: string }>();
    if (!share) throw new NotFoundError('Shared key');

    // Collected BEFORE the delete: the consent rows cascade with the share, and
    // these are the only members who were actually using the key. Telling
    // everyone else about a key they never touched is noise.
    const { results } = await this.env.DB.prepare(
      `SELECT user_id FROM lf_ai_key_share_consents WHERE share_id = ?`,
    )
      .bind(share.id)
      .all<{ user_id: string }>();
    const notify = (results ?? [])
      .map((r) => r.user_id)
      .filter((id) => id !== input.userId);

    await this.env.DB.prepare(`DELETE FROM lf_ai_key_shares WHERE id = ?`).bind(share.id).run();

    return { ok: true, provider, notify };
  }

  /** Active member user ids for the household, excluding one. */
  async memberUserIds(householdId: string, excludeUserId?: string): Promise<string[]> {
    const { results } = await this.env.DB.prepare(
      `SELECT user_id FROM lf_memberships
        WHERE household_id = ? AND status = 'active'`,
    )
      .bind(householdId)
      .all<{ user_id: string }>();
    return (results ?? [])
      .map((r) => r.user_id)
      .filter((id) => id !== excludeUserId);
  }
}

const PROVIDER_LABEL: Record<AiKeyShareProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
};

/**
 * Tell the household a key became available, or stopped being.
 *
 * Never throws, and callers hand it to `waitUntil`: on Workers an un-awaited
 * promise is cancelled the moment the handler returns, and neither sharing nor
 * revoking may be reported as failed because somebody's push token was stale.
 *
 * The payload carries no key material — only the provider and who shared it.
 * Both events use one `type` so the client needs a single routing branch;
 * `data.event` distinguishes them for anything that cares.
 */
export async function notifyAiKeyShared(
  env: Env,
  input: {
    householdId: string;
    ownerUserId: string;
    ownerName: string | null;
    provider: AiKeyShareProvider;
    memberUserIds: string[];
    event?: 'shared' | 'revoked';
  },
): Promise<void> {
  if (input.memberUserIds.length === 0) return;

  const notifications = new NotificationService(env, env.DB);
  const who = input.ownerName?.trim() || 'Someone in your household';
  const label = PROVIDER_LABEL[input.provider];
  const event = input.event ?? 'shared';

  const { title, body } =
    event === 'shared'
      ? {
          title: `${who} shared their ${label} key`,
          body: `You can now use ${label} in this household. Their account is billed for what you use.`,
        }
      : {
          title: `${who} stopped sharing their ${label} key`,
          body: `AI features that were using it need your own ${label} key now.`,
        };

  await Promise.all(
    input.memberUserIds.map((memberUserId) =>
      notifications
        .sendNotification({
          userId: memberUserId,
          type: 'ai_key_shared',
          title,
          body,
          data: {
            screen: 'AIProviders',
            event,
            householdId: input.householdId,
            provider: input.provider,
            ownerUserId: input.ownerUserId,
          },
          referenceType: 'lf_ai_key_share',
          referenceId: input.householdId,
        })
        .catch((error) => {
          console.error('[ai-key-share] notify failed', memberUserId, error);
        }),
    ),
  );
}
