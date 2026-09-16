import { getAppBrand, type AppBrand } from '../config/brand';
import type { Env } from '../types';

import { ExpoPushClient } from './aihousekeeper/expo-push';

/** Opaque wake event — no financial fields in push data (BR-077 / TRD §14). */
export const BUDGET_SYNC_WAKE_TYPE = 'budget_sync_wake' as const;
export const HOUSE_SYNC_WAKE_TYPE = 'house_sync_wake' as const;
export const HEALTH_SYNC_WAKE_TYPE = 'health_sync_wake' as const;

export const LOCAL_FIRST_SYNC_WAKE_TYPES = [
  BUDGET_SYNC_WAKE_TYPE,
  HOUSE_SYNC_WAKE_TYPE,
  HEALTH_SYNC_WAKE_TYPE,
] as const;

export type LocalFirstSyncWakeType = (typeof LOCAL_FIRST_SYNC_WAKE_TYPES)[number];

/** Fields that must never appear in a budget sync wake payload. */
export const PROHIBITED_WAKE_PAYLOAD_KEYS = [
  'amount',
  'amountCents',
  'balance',
  'category',
  'categoryId',
  'merchant',
  'description',
  'note',
  'ciphertext',
  'transaction',
  'transactionId',
  'expense',
  'income',
  'loan',
  'budget',
  'account',
  'body',
  'title',
  'message',
  'chat',
  'document',
  'receipt',
  'secret',
  'signingPublicKey',
  'agreementPublicKey',
] as const;

export type BudgetSyncWakePayload = {
  type: typeof BUDGET_SYNC_WAKE_TYPE;
  householdId: string;
};

export type HouseSyncWakePayload = {
  type: typeof HOUSE_SYNC_WAKE_TYPE;
  householdId: string;
};

export type HealthSyncWakePayload = {
  type: typeof HEALTH_SYNC_WAKE_TYPE;
  householdId: string;
};

export type LocalFirstSyncWakePayload =
  | BudgetSyncWakePayload
  | HouseSyncWakePayload
  | HealthSyncWakePayload;

// Generic in `type` so the brand-specific builders below keep their narrow
// return types — a plain `LocalFirstSyncWakePayload` return widens to the union
// and is then not assignable back to either member.
export function buildSyncWakePayload<T extends LocalFirstSyncWakeType>(
  householdId: string,
  type: T,
): { type: T; householdId: string } {
  return { type, householdId };
}

export function buildBudgetSyncWakePayload(householdId: string): BudgetSyncWakePayload {
  return buildSyncWakePayload(householdId, BUDGET_SYNC_WAKE_TYPE);
}

export function buildHouseSyncWakePayload(householdId: string): HouseSyncWakePayload {
  return buildSyncWakePayload(householdId, HOUSE_SYNC_WAKE_TYPE);
}

export function buildHealthSyncWakePayload(householdId: string): HealthSyncWakePayload {
  return buildSyncWakePayload(householdId, HEALTH_SYNC_WAKE_TYPE);
}

/** Ensures wake data is limited to `{ type, householdId }` with no financial content. */
export function validateOpaqueWakePayload(
  data: Record<string, unknown>,
  allowedTypes: readonly LocalFirstSyncWakeType[] = LOCAL_FIRST_SYNC_WAKE_TYPES,
): void {
  const allowed = new Set(['type', 'householdId']);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      throw new Error(`prohibited_wake_field:${key}`);
    }
  }
  if (
    typeof data.type !== 'string' ||
    !(allowedTypes as readonly string[]).includes(data.type)
  ) {
    throw new Error('invalid_wake_type');
  }
  if (typeof data.householdId !== 'string' || data.householdId.length === 0) {
    throw new Error('invalid_household_id');
  }
  if (Object.keys(data).length !== 2) {
    throw new Error('wake_payload_wrong_key_count');
  }
}

/**
 * Per-brand wake policy — the single source of truth for both `/v2` wake call
 * sites (mailbox deposit and the explicit `POST .../sync-wake`).
 *
 * THE EXCLUSION IS THE DEPOSITING DEVICE, ON EVERY BRAND.
 * ------------------------------------------------------
 * A wake must reach every enrolled device in the household except the one that
 * just deposited — which is the only device that already has the data. "Peer"
 * is a DEVICE, never a user: the rest of the stack has always agreed on that
 * (`readPeers` in each brand's sync orchestrator keeps every active device but
 * its own, the mailbox addresses one blob per peer device, and the coordinator
 * fans `sync_available` out per socket), and this is the last place that did
 * not.
 *
 * It used to exclude the caller's whole `user_id` on Budget/House, on the
 * reasoning that their households hold several users so the depositor should
 * exclude themselves. That is true of the depositing DEVICE and false of the
 * depositing PERSON: a member with a phone and a tablet had their second device
 * excluded from every wake their first one caused. It was the one peer in the
 * household that could never be told, so a change made on the tablet reached a
 * housemate's phone in seconds and the author's own phone not until they next
 * opened the app. Health already had it right, because a personal ledger left
 * no other option (`user_id != <the only user>` matches zero rows).
 *
 * `fallbackExclusion` is what happens when a request names NO source device.
 * No shipped client does: all three brands stamp `sourceDeviceId` into the
 * deposit body in their own `controlPlaneClient`. But the field is optional on
 * the wire, so the server cannot assume it — and an older build in somebody's
 * pocket is exactly the caller that would omit it. With no exclusion at all the
 * caller is in its own fan-out,
 * which is a push loop (`syncOnce` → deposit → wake → `syncOnce`), not a
 * degraded sync. So each brand names the safest thing it can still do:
 *
 *  - `'caller-user'` — multi-user brands. Degrades to exactly the pre-fix
 *    behaviour: the caller's devices are all excluded, peers still get woken.
 *    Strictly worse than the device exclusion, and only ever a fallback.
 *  - `'refuse'` — personal brands, where that fallback matches zero rows and
 *    would emit a wake to nobody while looking like it worked. Better to say so
 *    at the call site, which is what `requiresSourceDeviceId` is for.
 */
export interface LocalFirstWakeBrandPolicy {
  readonly wakeType: LocalFirstSyncWakeType;
  /**
   * What to exclude when the request names no source device. Never reached on
   * a current client — see the note above.
   */
  readonly fallbackExclusion: 'caller-user' | 'refuse';
}

export const LOCAL_FIRST_WAKE_POLICY: Record<AppBrand, LocalFirstWakeBrandPolicy> = {
  'symply-budget': { wakeType: BUDGET_SYNC_WAKE_TYPE, fallbackExclusion: 'caller-user' },
  'symply-house': { wakeType: HOUSE_SYNC_WAKE_TYPE, fallbackExclusion: 'caller-user' },
  'symply-health': { wakeType: HEALTH_SYNC_WAKE_TYPE, fallbackExclusion: 'refuse' },
  // Kaizen has `localFirstApi: false`, so `requireLocalFirstApi()` 404s `/v2`
  // before any wake is emitted. Present only so the map is total over AppBrand
  // — a partial map would let a future brand fall through to `undefined`.
  'symply-kaizen': { wakeType: HOUSE_SYNC_WAKE_TYPE, fallbackExclusion: 'caller-user' },
};

export function resolveSyncWakePolicy(env: Env): LocalFirstWakeBrandPolicy {
  return LOCAL_FIRST_WAKE_POLICY[getAppBrand(env)];
}

/**
 * True when the brand has no usable fallback for a request that names no source
 * device, so a wake would either reach the caller or reach nobody. Callers must
 * reject the request instead.
 */
export function requiresSourceDeviceId(policy: LocalFirstWakeBrandPolicy): boolean {
  return policy.fallbackExclusion === 'refuse';
}

export interface SendSyncWakeInput {
  householdId: string;
  excludeDeviceId?: string | null;
  excludeUserId?: string | null;
  wakeType?: LocalFirstSyncWakeType;
}

/**
 * Translate a wake call site's inputs into the exclusion set for the brand.
 * Both `/v2` call sites go through this so the two paths cannot drift — the
 * asymmetry between them is exactly how a dead wake becomes a push loop.
 *
 * The device exclusion and the user exclusion are deliberately EXCLUSIVE rather
 * than cumulative. Applying both is what silently dropped the caller's own
 * other devices: `excludeDeviceId` had already removed the one device that must
 * not be woken, and `excludeUserId` on top of it removed several that must.
 */
export function buildSyncWakeRequest(
  env: Env,
  input: { householdId: string; callerUserId: string; sourceDeviceId?: string | null },
): SendSyncWakeInput {
  const policy = resolveSyncWakePolicy(env);
  if (input.sourceDeviceId) {
    return {
      householdId: input.householdId,
      wakeType: policy.wakeType,
      excludeDeviceId: input.sourceDeviceId,
      excludeUserId: null,
    };
  }
  return {
    householdId: input.householdId,
    wakeType: policy.wakeType,
    excludeDeviceId: null,
    excludeUserId: policy.fallbackExclusion === 'caller-user' ? input.callerUserId : null,
  };
}

export class LocalFirstSyncWakeService {
  private readonly expoPush: ExpoPushClient;

  constructor(private readonly env: Env) {
    this.expoPush = new ExpoPushClient(env.EXPO_ACCESS_TOKEN);
  }

  async registerPushToken(input: {
    householdId: string;
    userId: string;
    deviceId: string;
    token: string;
    platform: 'ios' | 'android' | 'web';
  }): Promise<void> {
    const row = await this.env.DB.prepare(
      `SELECT id FROM lf_devices
       WHERE id = ? AND household_id = ? AND user_id = ? AND status = 'active'`,
    )
      .bind(input.deviceId, input.householdId, input.userId)
      .first<{ id: string }>();
    if (!row) {
      throw new Error('device_not_found');
    }

    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE lf_devices
       SET expo_push_token = ?, push_platform = ?, push_updated_at = ?
       WHERE id = ? AND household_id = ?`,
    )
      .bind(input.token, input.platform, now, input.deviceId, input.householdId)
      .run();
  }

  /**
   * Best-effort opaque wake to peer devices. Uses Expo → APNs/FCM when
   * EXPO_ACCESS_TOKEN and EAS push credentials are configured.
   */
  async sendSyncWake(input: SendSyncWakeInput): Promise<{ attempted: number; sent: number }> {
    // Built from the exclusions actually supplied. The previous form bound `''`
    // for a missing exclusion and compared `id != ''` / `user_id != ''`, which
    // is true for every row — an omitted exclusion silently became "exclude
    // nothing", so a caller with no exclusions woke itself and looped.
    const conditions = [
      'household_id = ?',
      "status = 'active'",
      'expo_push_token IS NOT NULL',
    ];
    const binds: string[] = [input.householdId];

    const excludeDeviceId = input.excludeDeviceId ?? '';
    if (excludeDeviceId) {
      conditions.push('id != ?');
      binds.push(excludeDeviceId);
    }
    const excludeUserId = input.excludeUserId ?? '';
    if (excludeUserId) {
      conditions.push('user_id != ?');
      binds.push(excludeUserId);
    }

    if (binds.length === 1) {
      // Never expected: every `/v2` call site supplies at least one exclusion
      // (Budget/House the caller's user id, Health the source device id). If it
      // happens, the caller is in the fan-out and will wake itself.
      console.warn('[local-first-sync-wake] unexcluded fan-out — caller may wake itself', {
        householdId: input.householdId,
      });
    }

    const { results } = await this.env.DB.prepare(
      `SELECT id, expo_push_token FROM lf_devices
       WHERE ${conditions.join('\n         AND ')}`,
    )
      .bind(...binds)
      .all<{ id: string; expo_push_token: string }>();

    const rows = results ?? [];
    if (rows.length === 0) {
      return { attempted: 0, sent: 0 };
    }

    const wakeType = input.wakeType ?? BUDGET_SYNC_WAKE_TYPE;
    const payload = buildSyncWakePayload(input.householdId, wakeType);
    validateOpaqueWakePayload(payload, [wakeType]);

    const messages = rows
      .filter((row) => row.expo_push_token.startsWith('ExponentPushToken'))
      .map((row) => ({
        to: row.expo_push_token,
        data: payload,
        _contentAvailable: true,
        sound: null,
      }));

    if (messages.length === 0) {
      return { attempted: 0, sent: 0 };
    }

    try {
      const tickets = await this.expoPush.sendBatch(messages);
      const sent = tickets.filter((ticket) => ticket.status === 'ok').length;
      return { attempted: messages.length, sent };
    } catch (error) {
      console.warn('[local-first-sync-wake] expo push failed', error);
      return { attempted: messages.length, sent: 0 };
    }
  }
}
